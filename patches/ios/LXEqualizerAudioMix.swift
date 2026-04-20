import AVFoundation
import MediaToolbox

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

private struct LXDelayLine {
    var buffer: [Float]
    var writeIndex = 0
    var dampingStore: Float = 0

    init(size: Int) {
        buffer = Array(repeating: 0, count: max(size, 1))
    }

    mutating func process(input: Float, feedback: Float, damping: Float) -> Float {
        let delayed = buffer[writeIndex]
        dampingStore += damping * (delayed - dampingStore)
        let filtered = dampingStore
        buffer[writeIndex] = input + filtered * feedback
        writeIndex += 1
        if writeIndex >= buffer.count {
            writeIndex = 0
        }
        return filtered
    }
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

private struct LXConvolutionPreset {
    let delayTimes: [Float]
    let feedbacks: [Float]
    let damping: Float

    static func preset(for fileName: String) -> LXConvolutionPreset? {
        switch fileName {
        case "filter-telephone.wav":
            return LXConvolutionPreset(delayTimes: [0.010, 0.016], feedbacks: [0.22, 0.18], damping: 0.55)
        case "s2_r4_bd.wav":
            return LXConvolutionPreset(delayTimes: [0.070, 0.110, 0.170], feedbacks: [0.74, 0.70, 0.66], damping: 0.18)
        case "bright-hall.wav":
            return LXConvolutionPreset(delayTimes: [0.050, 0.085, 0.125], feedbacks: [0.60, 0.56, 0.50], damping: 0.24)
        case "cinema-diningroom.wav":
            return LXConvolutionPreset(delayTimes: [0.042, 0.072, 0.108], feedbacks: [0.54, 0.50, 0.46], damping: 0.26)
        case "dining-living-true-stereo.wav":
            return LXConvolutionPreset(delayTimes: [0.032, 0.058, 0.088], feedbacks: [0.46, 0.42, 0.38], damping: 0.30)
        case "living-bedroom-leveled.wav":
            return LXConvolutionPreset(delayTimes: [0.028, 0.048, 0.076], feedbacks: [0.42, 0.38, 0.34], damping: 0.34)
        case "spreader50-65ms.wav":
            return LXConvolutionPreset(delayTimes: [0.024, 0.050, 0.065], feedbacks: [0.35, 0.30, 0.25], damping: 0.28)
        case "s3_r1_bd.wav":
            return LXConvolutionPreset(delayTimes: [0.020, 0.040, 0.060], feedbacks: [0.38, 0.34, 0.30], damping: 0.33)
        case "matrix-reverb1.wav":
            return LXConvolutionPreset(delayTimes: [0.036, 0.063, 0.096], feedbacks: [0.48, 0.44, 0.40], damping: 0.27)
        case "matrix-reverb2.wav":
            return LXConvolutionPreset(delayTimes: [0.032, 0.058, 0.090], feedbacks: [0.45, 0.41, 0.37], damping: 0.28)
        case "cardiod-35-10-spread.wav":
            return LXConvolutionPreset(delayTimes: [0.018, 0.036, 0.072], feedbacks: [0.34, 0.30, 0.26], damping: 0.32)
        case "tim-omni-35-10-magnetic.wav":
            return LXConvolutionPreset(delayTimes: [0.014, 0.024, 0.046], feedbacks: [0.28, 0.24, 0.20], damping: 0.36)
        case "feedback-spring.wav":
            return LXConvolutionPreset(delayTimes: [0.030, 0.054, 0.090], feedbacks: [0.52, 0.48, 0.44], damping: 0.22)
        default:
            return nil
        }
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
    private var convolutionPreset: LXConvolutionPreset?
    private var convolutionStates: [[LXDelayLine]] = []
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
        convolutionStates.removeAll(keepingCapacity: false)
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

        convolutionPreset = LXConvolutionPreset.preset(for: config.convolutionFileName)
        if let preset = convolutionPreset {
            convolutionStates = (0..<channelsPerFrame).map { _ in
                preset.delayTimes.map { delayTime in
                    let lineSize = max(Int(sampleRate * Double(delayTime)), 1)
                    return LXDelayLine(size: lineSize)
                }
            }
        } else {
            convolutionStates = []
        }

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
            output = processConvolution(output, channel: channel)
            samples[channel] = max(min(output, 1), -1)
        }

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

    private func processConvolution(_ sample: Float, channel: Int) -> Float {
        guard config.hasConvolution,
              let preset = convolutionPreset,
              channel < convolutionStates.count else { return sample }

        let dryGain = config.convolutionMainGain / 10
        let wetGain = config.convolutionSendGain / 10
        if wetGain <= 0.0001 {
            return sample * dryGain
        }

        var wet: Float = 0
        for index in convolutionStates[channel].indices {
            let feedback = preset.feedbacks[min(index, preset.feedbacks.count - 1)]
            var delayLine = convolutionStates[channel][index]
            wet += delayLine.process(input: sample, feedback: feedback, damping: preset.damping)
            convolutionStates[channel][index] = delayLine
        }
        wet /= Float(max(convolutionStates[channel].count, 1))
        return sample * dryGain + wet * wetGain
    }

    private func applyPanner(to samples: inout [Float], activeChannels: Int) {
        guard config.hasPanner, activeChannels >= 2, sampleRate > 0 else { return }

        let amplitude = min(max(config.pannerSoundR / 10, 0), 1)
        let phaseStep = Float((Double.pi / 18.0) / (max(Double(config.pannerSpeed) * 0.002, 0.02) * sampleRate))
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
