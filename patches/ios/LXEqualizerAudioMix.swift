import AVFoundation
import MediaToolbox
import Accelerate

let lxSoundEffectConfigNotification = Notification.Name("LXSoundEffectConfigDidChangeNotification")
let lxSoundEffectBandFrequencies: [Float] = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]

private struct LXBiquadCoefficients {
    var b0: Float
    var b1: Float
    var b2: Float
    var a1: Float
    var a2: Float

    static let bypass = LXBiquadCoefficients(b0: 1, b1: 0, b2: 0, a1: 0, a2: 0)

    var isBypass: Bool {
        b0 == 1 && b1 == 0 && b2 == 0 && a1 == 0 && a2 == 0
    }
}

private struct LXBiquadState {
    var z1: Float = 0
    var z2: Float = 0
}

private struct LXPitchShifterState {
    var buffer: [Float]
    var writeIndex = 0
    var phase: Float = 0
    let windowSize: Int

    init(windowSize: Int) {
        self.windowSize = max(windowSize, 512)
        self.buffer = Array(repeating: 0, count: self.windowSize * 3 + 2)
    }

    mutating func process(_ input: Float, factor: Float) -> Float {
        buffer[writeIndex] = input

        guard abs(factor - 1) > 0.001 else {
            advanceWriteIndex()
            return input
        }

        let phaseA = phase
        let phaseB = wrappedPhase(phase + Float(windowSize) * 0.5)
        let baseDelay = Float(windowSize)
        let sampleA = read(delay: baseDelay + phaseA)
        let sampleB = read(delay: baseDelay + phaseB)
        let gainA = triangle(phaseA / Float(windowSize))
        let gainB = triangle(phaseB / Float(windowSize))
        let output = sampleA * gainA + sampleB * gainB

        phase = wrappedPhase(phase + (1 - factor))
        advanceWriteIndex()
        return max(min(output, 1), -1)
    }

    private mutating func advanceWriteIndex() {
        writeIndex += 1
        if writeIndex >= buffer.count {
            writeIndex = 0
        }
    }

    private func wrappedPhase(_ value: Float) -> Float {
        let period = Float(windowSize)
        guard period > 0 else { return 0 }
        var wrapped = value
        while wrapped < 0 {
            wrapped += period
        }
        while wrapped >= period {
            wrapped -= period
        }
        return wrapped
    }

    private func triangle(_ normalized: Float) -> Float {
        let clamped = max(0, min(1, normalized))
        return 1 - abs(clamped * 2 - 1)
    }

    private func read(delay: Float) -> Float {
        let bufferCount = buffer.count
        guard bufferCount > 1 else { return buffer.first ?? 0 }

        var readPosition = Float(writeIndex) - delay
        let countFloat = Float(bufferCount)
        while readPosition < 0 {
            readPosition += countFloat
        }
        while readPosition >= countFloat {
            readPosition -= countFloat
        }

        let index0 = Int(readPosition)
        let index1 = (index0 + 1) % bufferCount
        let fraction = readPosition - Float(index0)
        return buffer[index0] * (1 - fraction) + buffer[index1] * fraction
    }
}

struct LXSoundEffectConfiguration {
    var equalizerEnabled = false
    var gains = LXEqualizerAudioMixController.normalizeGains([])
    var convolutionFileName = ""
    var convolutionAssetUri = ""
    var convolutionMainGain: Float = 10
    var convolutionSendGain: Float = 0
    var pannerEnabled = false
    var pannerSoundR: Float = 5
    var pannerSpeed: Float = 25
    var pitchPlaybackRate: Float = 1

    var hasEqualizer: Bool {
        equalizerEnabled && gains.contains(where: { abs($0) >= 0.01 })
    }

    var hasConvolution: Bool {
        !convolutionFileName.isEmpty
    }

    var hasPanner: Bool {
        pannerEnabled
    }

    var hasPitchShift: Bool {
        abs(pitchPlaybackRate - 1) >= 0.01
    }

    var isActive: Bool {
        hasEqualizer || hasConvolution || hasPanner || hasPitchShift
    }

    static func fromUserInfo(_ userInfo: [AnyHashable: Any]?) -> LXSoundEffectConfiguration {
        let equalizerInfo = userInfo?["equalizer"] as? [AnyHashable: Any] ?? userInfo
        let convolutionInfo = userInfo?["convolution"] as? [AnyHashable: Any]
        let pannerInfo = userInfo?["panner"] as? [AnyHashable: Any]
        let pitchInfo = userInfo?["pitchShifter"] as? [AnyHashable: Any]

        let inputGains = equalizerInfo?["gains"] as? [NSNumber] ?? []
        var gains = Array(repeating: Float(0), count: lxSoundEffectBandFrequencies.count)
        for index in 0..<gains.count {
            gains[index] = index < inputGains.count ? inputGains[index].floatValue : 0
        }

        return LXSoundEffectConfiguration(
            equalizerEnabled: equalizerInfo?["enabled"] as? Bool ?? false,
            gains: LXEqualizerAudioMixController.normalizeGains(gains),
            convolutionFileName: (convolutionInfo?["fileName"] as? String) ?? "",
            convolutionAssetUri: (convolutionInfo?["assetUri"] as? String) ?? "",
            convolutionMainGain: clampedFloat(convolutionInfo?["mainGain"], defaultValue: 10, minValue: 0, maxValue: 50),
            convolutionSendGain: clampedFloat(convolutionInfo?["sendGain"], defaultValue: 0, minValue: 0, maxValue: 50),
            pannerEnabled: pannerInfo?["enabled"] as? Bool ?? false,
            pannerSoundR: clampedFloat(pannerInfo?["soundR"], defaultValue: 5, minValue: 1, maxValue: 30),
            pannerSpeed: clampedFloat(pannerInfo?["speed"], defaultValue: 25, minValue: 1, maxValue: 50),
            pitchPlaybackRate: clampedFloat(pitchInfo?["playbackRate"], defaultValue: 1, minValue: 0.5, maxValue: 1.5)
        )
    }

    private static func clampedFloat(_ value: Any?, defaultValue: Float, minValue: Float, maxValue: Float) -> Float {
        let result: Float
        if let number = value as? NSNumber {
            result = number.floatValue
        } else {
            result = defaultValue
        }
        return min(max(result, minValue), maxValue)
    }
}

final class LXEqualizerAudioMixController {
    private let lock = NSLock()
    private var config = LXSoundEffectConfiguration()
    private var coefficients = Array(repeating: LXBiquadCoefficients.bypass, count: lxSoundEffectBandFrequencies.count)
    private var eqStates: [[LXBiquadState]] = []
    private var convolutionEngine: LXConvolutionEngine?
    private var pitchStates: [LXPitchShifterState] = []
    private var sampleRate: Double = 0
    private var channelsPerFrame = 0
    private var bitsPerChannel: UInt32 = 0
    private var isFloat = false
    private var isInterleaved = false
    private var processedSamples: Double = 0

    init(enabled: Bool, gains: [Float]) {
        updateConfig(enabled: enabled, gains: gains)
    }

    init(config: LXSoundEffectConfiguration) {
        updateConfig(config)
    }

    func updateConfig(enabled: Bool, gains: [Float]) {
        var config = self.config
        config.equalizerEnabled = enabled
        config.gains = Self.normalizeGains(gains)
        updateConfig(config)
    }

    func updateConfig(_ config: LXSoundEffectConfiguration) {
        lock.lock()
        defer { lock.unlock() }

        self.config = config
        if sampleRate > 0 {
            rebuildProcessingStateLocked(resetTime: false)
        }
    }

    func makeAudioMix(for asset: AVAsset) -> AVAudioMix? {
        guard let audioTrack = asset.tracks(withMediaType: .audio).first else { return nil }
        guard let tap = makeAudioProcessingTap() else { return nil }

        let params = AVMutableAudioMixInputParameters(track: audioTrack)
        params.audioTapProcessor = tap

        let audioMix = AVMutableAudioMix()
        audioMix.inputParameters = [params]
        return audioMix
    }

    private func makeAudioProcessingTap() -> MTAudioProcessingTap? {
        var callbacks = MTAudioProcessingTapCallbacks(
            version: kMTAudioProcessingTapCallbacksVersion_0,
            clientInfo: UnsafeMutableRawPointer(Unmanaged.passRetained(self).toOpaque()),
            init: { _, clientInfo, tapStorageOut in
                tapStorageOut.pointee = clientInfo
            },
            finalize: { tap in
                let storage = MTAudioProcessingTapGetStorage(tap)
                Unmanaged<LXEqualizerAudioMixController>.fromOpaque(storage).release()
            },
            prepare: { tap, _, processingFormat in
                let storage = MTAudioProcessingTapGetStorage(tap)
                let processor = Unmanaged<LXEqualizerAudioMixController>.fromOpaque(storage).takeUnretainedValue()
                processor.prepare(with: processingFormat.pointee)
            },
            unprepare: { tap in
                let storage = MTAudioProcessingTapGetStorage(tap)
                let processor = Unmanaged<LXEqualizerAudioMixController>.fromOpaque(storage).takeUnretainedValue()
                processor.unprepare()
            },
            process: { tap, numberFrames, _, bufferListInOut, numberFramesOut, flagsOut in
                let storage = MTAudioProcessingTapGetStorage(tap)
                let processor = Unmanaged<LXEqualizerAudioMixController>.fromOpaque(storage).takeUnretainedValue()
                let status = processor.process(
                    tap: tap,
                    numberFrames: numberFrames,
                    bufferListInOut: bufferListInOut,
                    numberFramesOut: numberFramesOut,
                    flagsOut: flagsOut
                )
                if status != noErr {
                    numberFramesOut.pointee = 0
                    flagsOut.pointee = 0
                }
            }
        )

        var tap: Unmanaged<MTAudioProcessingTap>?
        let status = MTAudioProcessingTapCreate(
            kCFAllocatorDefault,
            &callbacks,
            kMTAudioProcessingTapCreationFlag_PostEffects,
            &tap
        )
        guard status == noErr else { return nil }
        return tap?.takeRetainedValue()
    }

    private func prepare(with format: AudioStreamBasicDescription) {
        lock.lock()
        defer { lock.unlock() }

        sampleRate = format.mSampleRate
        channelsPerFrame = max(Int(format.mChannelsPerFrame), 1)
        bitsPerChannel = format.mBitsPerChannel
        isFloat = (format.mFormatFlags & kAudioFormatFlagIsFloat) != 0
        isInterleaved = (format.mFormatFlags & kAudioFormatFlagIsNonInterleaved) == 0
        rebuildProcessingStateLocked(resetTime: true)
    }

    private func unprepare() {
        lock.lock()
        defer { lock.unlock() }

        sampleRate = 0
        channelsPerFrame = 0
        bitsPerChannel = 0
        isFloat = false
        isInterleaved = false
        processedSamples = 0
        eqStates.removeAll(keepingCapacity: false)
        convolutionEngine = nil
        pitchStates.removeAll(keepingCapacity: false)
        coefficients = Array(repeating: LXBiquadCoefficients.bypass, count: lxSoundEffectBandFrequencies.count)
    }

    private func rebuildProcessingStateLocked(resetTime: Bool) {
        coefficients = config.hasEqualizer
            ? Self.makeCoefficients(sampleRate: sampleRate, gains: config.gains)
            : Array(repeating: .bypass, count: lxSoundEffectBandFrequencies.count)
        eqStates = Array(
            repeating: Array(repeating: LXBiquadState(), count: coefficients.count),
            count: channelsPerFrame
        )

        convolutionEngine = config.hasConvolution
            ? LXConvolutionEngine(
                config: config,
                sampleRate: sampleRate,
                channelCount: channelsPerFrame
            )
            : nil

        let pitchWindow = Self.pitchWindowSize(sampleRate: sampleRate)
        pitchStates = Array(repeating: LXPitchShifterState(windowSize: pitchWindow), count: channelsPerFrame)
        if resetTime {
            processedSamples = 0
        }
    }

    private func process(
        tap: MTAudioProcessingTap,
        numberFrames: CMItemCount,
        bufferListInOut: UnsafeMutablePointer<AudioBufferList>,
        numberFramesOut: UnsafeMutablePointer<CMItemCount>,
        flagsOut: UnsafeMutablePointer<MTAudioProcessingTapFlags>
    ) -> OSStatus {
        let status = MTAudioProcessingTapGetSourceAudio(
            tap,
            numberFrames,
            bufferListInOut,
            flagsOut,
            nil,
            numberFramesOut
        )
        guard status == noErr else { return status }

        let frameCount = Int(numberFramesOut.pointee)
        guard frameCount > 0 else { return noErr }

        lock.lock()
        defer { lock.unlock() }

        guard config.isActive, channelsPerFrame > 0 else {
            return noErr
        }

        let audioBuffers = UnsafeMutableAudioBufferListPointer(bufferListInOut)
        if isFloat && bitsPerChannel == 32 {
            processFloat32(audioBuffers, frameCount: frameCount)
        } else if !isFloat && bitsPerChannel == 16 {
            processInt16(audioBuffers, frameCount: frameCount)
        } else if !isFloat && bitsPerChannel == 32 {
            processInt32(audioBuffers, frameCount: frameCount)
        }

        return noErr
    }

    private func processFloat32(_ audioBuffers: UnsafeMutableAudioBufferListPointer, frameCount: Int) {
        if isInterleaved {
            guard let audioBuffer = audioBuffers.first,
                  let data = audioBuffer.mData?.assumingMemoryBound(to: Float.self) else { return }

            var frameSamples = Array(repeating: Float(0), count: channelsPerFrame)
            for frame in 0..<frameCount {
                let baseIndex = frame * channelsPerFrame
                for channel in 0..<channelsPerFrame {
                    frameSamples[channel] = data[baseIndex + channel]
                }
                processFrame(&frameSamples)
                for channel in 0..<channelsPerFrame {
                    data[baseIndex + channel] = frameSamples[channel]
                }
            }
            return
        }

        let activeChannels = min(audioBuffers.count, channelsPerFrame)
        guard activeChannels > 0 else { return }
        var frameSamples = Array(repeating: Float(0), count: activeChannels)
        for frame in 0..<frameCount {
            for channel in 0..<activeChannels {
                guard let data = audioBuffers[channel].mData?.assumingMemoryBound(to: Float.self) else { continue }
                frameSamples[channel] = data[frame]
            }
            processFrame(&frameSamples)
            for channel in 0..<activeChannels {
                guard let data = audioBuffers[channel].mData?.assumingMemoryBound(to: Float.self) else { continue }
                data[frame] = frameSamples[channel]
            }
        }
    }

    private func processInt16(_ audioBuffers: UnsafeMutableAudioBufferListPointer, frameCount: Int) {
        let scale = Float(Int16.max)
        if isInterleaved {
            guard let audioBuffer = audioBuffers.first,
                  let data = audioBuffer.mData?.assumingMemoryBound(to: Int16.self) else { return }

            var frameSamples = Array(repeating: Float(0), count: channelsPerFrame)
            for frame in 0..<frameCount {
                let baseIndex = frame * channelsPerFrame
                for channel in 0..<channelsPerFrame {
                    frameSamples[channel] = Float(data[baseIndex + channel]) / scale
                }
                processFrame(&frameSamples)
                for channel in 0..<channelsPerFrame {
                    data[baseIndex + channel] = Int16(clamping: Int(frameSamples[channel] * scale))
                }
            }
            return
        }

        let activeChannels = min(audioBuffers.count, channelsPerFrame)
        guard activeChannels > 0 else { return }
        var frameSamples = Array(repeating: Float(0), count: activeChannels)
        for frame in 0..<frameCount {
            for channel in 0..<activeChannels {
                guard let data = audioBuffers[channel].mData?.assumingMemoryBound(to: Int16.self) else { continue }
                frameSamples[channel] = Float(data[frame]) / scale
            }
            processFrame(&frameSamples)
            for channel in 0..<activeChannels {
                guard let data = audioBuffers[channel].mData?.assumingMemoryBound(to: Int16.self) else { continue }
                data[frame] = Int16(clamping: Int(frameSamples[channel] * scale))
            }
        }
    }

    private func processInt32(_ audioBuffers: UnsafeMutableAudioBufferListPointer, frameCount: Int) {
        let scale = Float(Int32.max)
        if isInterleaved {
            guard let audioBuffer = audioBuffers.first,
                  let data = audioBuffer.mData?.assumingMemoryBound(to: Int32.self) else { return }

            var frameSamples = Array(repeating: Float(0), count: channelsPerFrame)
            for frame in 0..<frameCount {
                let baseIndex = frame * channelsPerFrame
                for channel in 0..<channelsPerFrame {
                    frameSamples[channel] = Float(data[baseIndex + channel]) / scale
                }
                processFrame(&frameSamples)
                for channel in 0..<channelsPerFrame {
                    data[baseIndex + channel] = Int32(clamping: Int(frameSamples[channel] * scale))
                }
            }
            return
        }

        let activeChannels = min(audioBuffers.count, channelsPerFrame)
        guard activeChannels > 0 else { return }
        var frameSamples = Array(repeating: Float(0), count: activeChannels)
        for frame in 0..<frameCount {
            for channel in 0..<activeChannels {
                guard let data = audioBuffers[channel].mData?.assumingMemoryBound(to: Int32.self) else { continue }
                frameSamples[channel] = Float(data[frame]) / scale
            }
            processFrame(&frameSamples)
            for channel in 0..<activeChannels {
                guard let data = audioBuffers[channel].mData?.assumingMemoryBound(to: Int32.self) else { continue }
                data[frame] = Int32(clamping: Int(frameSamples[channel] * scale))
            }
        }
    }

    private func processFrame(_ samples: inout [Float]) {
        let activeChannels = min(samples.count, channelsPerFrame)
        guard activeChannels > 0 else { return }

        for channel in 0..<activeChannels {
            var output = processEqualizer(samples[channel], channel: channel)
            output = processPitch(output, channel: channel)
            samples[channel] = max(min(output, 1), -1)
        }

        processConvolution(&samples, activeChannels: activeChannels)

        applyPanner(to: &samples, activeChannels: activeChannels)
        processedSamples += 1
    }

    private func processEqualizer(_ sample: Float, channel: Int) -> Float {
        guard config.hasEqualizer, channel < eqStates.count else { return sample }

        var output = sample
        for bandIndex in coefficients.indices {
            let coeff = coefficients[bandIndex]
            if coeff.isBypass { continue }

            var state = eqStates[channel][bandIndex]
            let filtered = coeff.b0 * output + state.z1
            state.z1 = coeff.b1 * output - coeff.a1 * filtered + state.z2
            state.z2 = coeff.b2 * output - coeff.a2 * filtered
            eqStates[channel][bandIndex] = state
            output = filtered
        }
        return output
    }

    private func processPitch(_ sample: Float, channel: Int) -> Float {
        guard config.hasPitchShift, channel < pitchStates.count else { return sample }
        var state = pitchStates[channel]
        let output = state.process(sample, factor: config.pitchPlaybackRate)
        pitchStates[channel] = state
        return output
    }

    private func processConvolution(_ samples: inout [Float], activeChannels: Int) {
        guard let engine = convolutionEngine else {
            let dryGain = config.hasConvolution ? (config.convolutionMainGain / 10) : 1
            if dryGain != 1 {
                for channel in 0..<activeChannels {
                    samples[channel] *= dryGain
                }
            }
            return
        }
        engine.processFrame(&samples, activeChannels: activeChannels)
    }

    private func applyPanner(to samples: inout [Float], activeChannels: Int) {
        guard config.hasPanner, activeChannels >= 2, sampleRate > 0 else { return }

        let amplitude = min(max(config.pannerSoundR / 10, 0), 1)
        let phaseStep = Float((Double.pi / 180.0) / (max(Double(config.pannerSpeed) * 0.002, 0.02) * sampleRate))
        let pan = sin(Float(processedSamples) * phaseStep) * amplitude
        let leftGain: Float = pan > 0 ? 1 - pan : 1
        let rightGain: Float = pan < 0 ? 1 + pan : 1
        samples[0] *= leftGain
        samples[1] *= rightGain
    }

    static func normalizeGains(_ gains: [Float]) -> [Float] {
        var normalized = Array(repeating: Float(0), count: lxSoundEffectBandFrequencies.count)
        for index in 0..<normalized.count {
            normalized[index] = index < gains.count ? gains[index] : 0
        }
        return normalized
    }

    private static func pitchWindowSize(sampleRate: Double) -> Int {
        let target = max(Int(sampleRate * 0.03), 1024)
        return min(target, 4096)
    }

    private static func makeCoefficients(sampleRate: Double, gains: [Float]) -> [LXBiquadCoefficients] {
        guard sampleRate > 0 else {
            return Array(repeating: .bypass, count: lxSoundEffectBandFrequencies.count)
        }

        let q: Float = 1.41
        return lxSoundEffectBandFrequencies.enumerated().map { index, frequency in
            let gain = index < gains.count ? gains[index] : 0
            if abs(gain) < 0.01 { return .bypass }

            let amplitude = pow(10, gain / 40)
            let omega = 2 * Float.pi * frequency / Float(sampleRate)
            let cosOmega = cos(omega)
            let sinOmega = sin(omega)
            let alpha = sinOmega / (2 * q)

            let b0 = 1 + alpha * amplitude
            let b1 = -2 * cosOmega
            let b2 = 1 - alpha * amplitude
            let a0 = 1 + alpha / amplitude
            let a1 = -2 * cosOmega
            let a2 = 1 - alpha / amplitude

            return LXBiquadCoefficients(
                b0: b0 / a0,
                b1: b1 / a0,
                b2: b2 / a0,
                a1: a1 / a0,
                a2: a2 / a0
            )
        }
    }
}

private final class LXFFTConvolution {
    private let blockSize: Int
    private let fftSize: Int
    private let partitionCount: Int
    private let inputChannels: Int
    private let outputChannels: Int
    private var filterReal: [[[Float]]]
    private var filterImag: [[[Float]]]
    private var historyReal: [[[Float]]]
    private var historyImag: [[[Float]]]
    private var overlaps: [[Float]]
    private let fftSetup: FFTSetup
    private let log2n: vDSP_Length

    init?(irChannels: [[Float]], inputChannels: Int, outputChannels: Int, blockSize: Int = 512) {
        guard !irChannels.isEmpty else { return nil }

        self.blockSize = blockSize
        self.fftSize = blockSize * 2
        self.inputChannels = max(1, inputChannels)
        self.outputChannels = max(1, outputChannels)

        let impulseLength = irChannels.map(\.count).max() ?? 0
        guard impulseLength > 0 else { return nil }
        self.partitionCount = max(1, Int(ceil(Double(impulseLength) / Double(blockSize))))

        let log2Value = Int(log2(Double(fftSize)))
        guard (1 << log2Value) == fftSize else { return nil }
        self.log2n = vDSP_Length(log2Value)
        guard let setup = vDSP_create_fftsetup(self.log2n, FFTRadix(kFFTRadix2)) else { return nil }
        self.fftSetup = setup

        let routeCount = self.inputChannels * self.outputChannels
        self.filterReal = Array(
            repeating: Array(repeating: Array(repeating: 0, count: fftSize), count: partitionCount),
            count: routeCount
        )
        self.filterImag = Array(
            repeating: Array(repeating: Array(repeating: 0, count: fftSize), count: partitionCount),
            count: routeCount
        )
        self.historyReal = Array(
            repeating: Array(repeating: Array(repeating: 0, count: fftSize), count: partitionCount),
            count: self.inputChannels
        )
        self.historyImag = Array(
            repeating: Array(repeating: Array(repeating: 0, count: fftSize), count: partitionCount),
            count: self.inputChannels
        )
        self.overlaps = Array(repeating: Array(repeating: 0, count: blockSize), count: self.outputChannels)

        let routeMapping = Self.makeRouteMapping(irChannelCount: irChannels.count, inputChannels: self.inputChannels, outputChannels: self.outputChannels)
        for route in routeMapping {
            let impulse = irChannels[min(route.irChannel, irChannels.count - 1)]
            for partition in 0..<partitionCount {
                let start = partition * blockSize
                let end = min(start + blockSize, impulse.count)
                var real = Array(repeating: Float(0), count: fftSize)
                if start < end {
                    real.replaceSubrange(0..<(end - start), with: impulse[start..<end])
                }
                var imag = Array(repeating: Float(0), count: fftSize)
                Self.performFFT(setup: setup, log2n: self.log2n, real: &real, imag: &imag, direction: FFTDirection(FFT_FORWARD))
                filterReal[route.routeIndex][partition] = real
                filterImag[route.routeIndex][partition] = imag
            }
        }
    }

    deinit {
        vDSP_destroy_fftsetup(fftSetup)
    }

    func processBlock(_ inputBlock: [[Float]]) -> [[Float]] {
        guard !inputBlock.isEmpty else { return Array(repeating: Array(repeating: 0, count: blockSize), count: outputChannels) }

        let historyIndex = 0
        for channel in 0..<inputChannels {
            let source = channel < inputBlock.count ? inputBlock[channel] : Array(repeating: 0, count: blockSize)
            var real = Array(repeating: Float(0), count: fftSize)
            real.replaceSubrange(0..<min(source.count, blockSize), with: source.prefix(blockSize))
            var imag = Array(repeating: Float(0), count: fftSize)
            Self.performFFT(setup: fftSetup, log2n: log2n, real: &real, imag: &imag, direction: FFTDirection(FFT_FORWARD))
            historyReal[channel].insert(real, at: historyIndex)
            historyImag[channel].insert(imag, at: historyIndex)
            if historyReal[channel].count > partitionCount {
                historyReal[channel].removeLast()
                historyImag[channel].removeLast()
            }
        }

        var outputs = Array(repeating: Array(repeating: Float(0), count: blockSize), count: outputChannels)
        for outputChannel in 0..<outputChannels {
            var sumReal = Array(repeating: Float(0), count: fftSize)
            var sumImag = Array(repeating: Float(0), count: fftSize)

            for inputChannel in 0..<inputChannels {
                let routeIndex = outputChannel * inputChannels + inputChannel
                for partition in 0..<partitionCount {
                    let inputReal = historyReal[inputChannel][partition]
                    let inputImag = historyImag[inputChannel][partition]
                    let filterRealPart = filterReal[routeIndex][partition]
                    let filterImagPart = filterImag[routeIndex][partition]
                    for index in 0..<fftSize {
                        let real = filterRealPart[index] * inputReal[index] - filterImagPart[index] * inputImag[index]
                        let imag = filterRealPart[index] * inputImag[index] + filterImagPart[index] * inputReal[index]
                        sumReal[index] += real
                        sumImag[index] += imag
                    }
                }
            }

            Self.performFFT(setup: fftSetup, log2n: log2n, real: &sumReal, imag: &sumImag, direction: FFTDirection(FFT_INVERSE))
            let scale = 1 / Float(fftSize)
            for index in 0..<fftSize {
                sumReal[index] *= scale
            }

            for index in 0..<blockSize {
                outputs[outputChannel][index] = sumReal[index] + overlaps[outputChannel][index]
            }
            overlaps[outputChannel] = Array(sumReal[blockSize..<fftSize])
        }
        return outputs
    }

    private static func makeRouteMapping(irChannelCount: Int, inputChannels: Int, outputChannels: Int) -> [(routeIndex: Int, irChannel: Int)] {
        if inputChannels >= 2 && outputChannels >= 2 && irChannelCount >= 4 {
            return [
                (0 * inputChannels + 0, 0),
                (0 * inputChannels + 1, 2),
                (1 * inputChannels + 0, 1),
                (1 * inputChannels + 1, 3),
            ]
        }

        if outputChannels >= 2 && irChannelCount >= 2 && inputChannels == 1 {
            return [
                (0, 0),
                (1, 1),
            ]
        }

        if inputChannels >= 2 && outputChannels >= 2 && irChannelCount >= 2 {
            return [
                (0 * inputChannels + 0, 0),
                (1 * inputChannels + 1, 1),
            ]
        }

        if inputChannels >= 2 && outputChannels >= 2 {
            return [
                (0 * inputChannels + 0, 0),
                (1 * inputChannels + 1, 0),
            ]
        }

        return [
            (0, 0),
        ]
    }

    private static func performFFT(setup: FFTSetup, log2n: vDSP_Length, real: inout [Float], imag: inout [Float], direction: FFTDirection) {
        real.withUnsafeMutableBufferPointer { realPointer in
            imag.withUnsafeMutableBufferPointer { imagPointer in
                var splitComplex = DSPSplitComplex(realp: realPointer.baseAddress!, imagp: imagPointer.baseAddress!)
                vDSP_fft_zip(setup, &splitComplex, 1, log2n, direction)
            }
        }
    }
}

private final class LXConvolutionEngine {
    private let channelCount: Int
    private let outputChannels: Int
    private let blockSize: Int
    private let dryGain: Float
    private let wetGain: Float
    private let convolution: LXFFTConvolution?
    private var inputBuffer: [[Float]]
    private var inputFill = 0
    private var outputQueue: [[Float]]
    private var outputReadIndex = 0

    init?(config: LXSoundEffectConfiguration, sampleRate: Double, channelCount: Int) {
        let effectiveChannels = max(1, min(channelCount, 2))
        guard let response = Self.loadImpulseResponse(
            assetUri: config.convolutionAssetUri,
            fileName: config.convolutionFileName,
            sampleRate: sampleRate
        ) else { return nil }

        self.channelCount = effectiveChannels
        self.outputChannels = max(1, min(effectiveChannels, 2))
        self.blockSize = 512
        self.dryGain = config.convolutionMainGain / 10
        self.wetGain = config.convolutionSendGain / 10
        self.convolution = LXFFTConvolution(
            irChannels: response,
            inputChannels: effectiveChannels,
            outputChannels: self.outputChannels,
            blockSize: self.blockSize
        )
        self.inputBuffer = Array(repeating: Array(repeating: 0, count: self.blockSize), count: effectiveChannels)
        self.outputQueue = Array(repeating: [], count: self.outputChannels)
    }

    func processFrame(_ samples: inout [Float], activeChannels: Int) {
        let usedChannels = min(activeChannels, channelCount)
        guard usedChannels > 0 else { return }

        for channel in 0..<usedChannels {
            inputBuffer[channel][inputFill] = samples[channel]
        }
        inputFill += 1
        if inputFill >= blockSize {
            processBufferedBlock()
            inputFill = 0
        }

        if outputReadIndex < outputQueue[0].count {
            for channel in 0..<usedChannels {
                let wet = channel < outputChannels ? outputQueue[channel][outputReadIndex] : 0
                samples[channel] = wet
            }
            outputReadIndex += 1
            if outputReadIndex >= outputQueue[0].count {
                outputQueue = Array(repeating: [], count: outputChannels)
                outputReadIndex = 0
            }
        } else {
            for channel in 0..<usedChannels {
                samples[channel] = 0
            }
        }
    }

    private func processBufferedBlock() {
        let dryBlock = inputBuffer
        let wetBlock = convolution?.processBlock(inputBuffer) ?? Array(repeating: Array(repeating: 0, count: blockSize), count: outputChannels)
        outputQueue = Array(repeating: Array(repeating: 0, count: blockSize), count: outputChannels)
        outputReadIndex = 0

        for channel in 0..<outputChannels {
            for index in 0..<blockSize {
                let dry = channel < dryBlock.count ? dryBlock[channel][index] * dryGain : 0
                let wet = wetBlock[channel][index] * wetGain
                outputQueue[channel][index] = max(min(dry + wet, 1), -1)
            }
        }
    }

    private static func loadImpulseResponse(assetUri: String, fileName: String, sampleRate: Double) -> [[Float]]? {
        guard let url = resolveAssetURL(assetUri: assetUri, fileName: fileName) else { return nil }
        guard let audioFile = try? AVAudioFile(forReading: url) else { return nil }

        let frameCapacity = AVAudioFrameCount(audioFile.length)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: audioFile.processingFormat, frameCapacity: frameCapacity) else { return nil }
        do {
            try audioFile.read(into: buffer)
        } catch {
            return nil
        }

        guard let floatChannelData = buffer.floatChannelData else { return nil }
        let frameLength = Int(buffer.frameLength)
        let channelCount = Int(buffer.format.channelCount)
        guard frameLength > 0, channelCount > 0 else { return nil }

        var channels = (0..<channelCount).map { channel in
            Array(UnsafeBufferPointer(start: floatChannelData[channel], count: frameLength))
        }
        if abs(buffer.format.sampleRate - sampleRate) > 1 {
            channels = channels.map { resample($0, from: buffer.format.sampleRate, to: sampleRate) }
        }

        let normalizationScale = calculateNormalizationScale(channels: channels, sampleRate: sampleRate)
        if normalizationScale != 1 {
            channels = channels.map { channel in channel.map { $0 * normalizationScale } }
        }
        return channels
    }

    private static func resolveAssetURL(assetUri: String, fileName: String) -> URL? {
        if let url = URL(string: assetUri), url.scheme != nil {
            return url
        }
        if assetUri.hasPrefix("/") {
            return URL(fileURLWithPath: assetUri)
        }

        let nsFileName = fileName as NSString
        let resource = nsFileName.deletingPathExtension
        let ext = nsFileName.pathExtension.isEmpty ? nil : nsFileName.pathExtension
        if let bundleURL = Bundle.main.url(forResource: resource, withExtension: ext) {
            return bundleURL
        }
        return nil
    }

    private static func resample(_ input: [Float], from inputSampleRate: Double, to outputSampleRate: Double) -> [Float] {
        guard !input.isEmpty, inputSampleRate > 0, outputSampleRate > 0, abs(inputSampleRate - outputSampleRate) > 0.5 else {
            return input
        }

        let ratio = outputSampleRate / inputSampleRate
        let outputLength = max(1, Int(round(Double(input.count) * ratio)))
        if outputLength == input.count {
            return input
        }

        var output = Array(repeating: Float(0), count: outputLength)
        let maxIndex = input.count - 1
        for index in 0..<outputLength {
            let position = Double(index) / ratio
            let lower = max(0, min(Int(floor(position)), maxIndex))
            let upper = max(0, min(lower + 1, maxIndex))
            let fraction = Float(position - Double(lower))
            if lower == upper {
                output[index] = input[lower]
            } else {
                output[index] = input[lower] * (1 - fraction) + input[upper] * fraction
            }
        }
        return output
    }

    private static func calculateNormalizationScale(channels: [[Float]], sampleRate: Double) -> Float {
        let gainCalibration: Float = 0.00125
        let gainCalibrationSampleRate: Float = 44100
        let minPower: Float = 0.000125
        let numberOfChannels = channels.count
        let length = channels.map(\.count).max() ?? 0
        guard numberOfChannels > 0, length > 0 else { return 1 }

        var power: Float = 0
        for channel in channels {
            var channelPower: Float = 0
            for sample in channel {
                channelPower += sample * sample
            }
            power += channelPower
        }
        power = sqrt(power / Float(numberOfChannels * length))
        if !power.isFinite || power.isNaN || power < minPower {
            power = minPower
        }

        var scale = (1 / power) * gainCalibration
        scale *= gainCalibrationSampleRate / Float(sampleRate)
        if numberOfChannels == 4 {
            scale *= 0.5
        }
        return scale
    }
}
