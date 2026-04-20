// Patch dependency sources after install when upstream packages need local integration fixes.

const fs = require('node:fs')
const path = require('node:path')

const rootPath = __dirname
const equalizerAudioMixSwiftSource = `import AVFoundation
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

final class LXEqualizerAudioMixController {
    private let lock = NSLock()
    private var enabled = false
    private var gains = LXEqualizerAudioMixController.normalizeGains([])
    private var coefficients = Array(repeating: LXBiquadCoefficients.bypass, count: lxSoundEffectBandFrequencies.count)
    private var states: [[LXBiquadState]] = []
    private var sampleRate: Double = 0
    private var channelsPerFrame = 0
    private var bitsPerChannel: UInt32 = 0
    private var isFloat = false
    private var isInterleaved = false

    init(enabled: Bool, gains: [Float]) {
        updateConfig(enabled: enabled, gains: gains)
    }

    func updateConfig(enabled: Bool, gains: [Float]) {
        lock.lock()
        defer { lock.unlock() }

        self.enabled = enabled
        self.gains = Self.normalizeGains(gains)
        if sampleRate > 0 {
            coefficients = Self.makeCoefficients(sampleRate: sampleRate, gains: self.gains)
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
                guard let storage = MTAudioProcessingTapGetStorage(tap) else { return }
                Unmanaged<LXEqualizerAudioMixController>.fromOpaque(storage).release()
            },
            prepare: { tap, _, processingFormat in
                guard let storage = MTAudioProcessingTapGetStorage(tap) else { return }
                let processor = Unmanaged<LXEqualizerAudioMixController>.fromOpaque(storage).takeUnretainedValue()
                processor.prepare(with: processingFormat.pointee)
            },
            unprepare: { tap in
                guard let storage = MTAudioProcessingTapGetStorage(tap) else { return }
                let processor = Unmanaged<LXEqualizerAudioMixController>.fromOpaque(storage).takeUnretainedValue()
                processor.unprepare()
            },
            process: { tap, numberFrames, _, bufferListInOut, numberFramesOut, flagsOut in
                guard let storage = MTAudioProcessingTapGetStorage(tap) else { return noErr }
                let processor = Unmanaged<LXEqualizerAudioMixController>.fromOpaque(storage).takeUnretainedValue()
                return processor.process(
                    tap: tap,
                    numberFrames: numberFrames,
                    bufferListInOut: bufferListInOut,
                    numberFramesOut: numberFramesOut,
                    flagsOut: flagsOut
                )
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
        coefficients = Self.makeCoefficients(sampleRate: sampleRate, gains: gains)
        states = Array(
            repeating: Array(repeating: LXBiquadState(), count: coefficients.count),
            count: channelsPerFrame
        )
    }

    private func unprepare() {
        lock.lock()
        defer { lock.unlock() }

        sampleRate = 0
        channelsPerFrame = 0
        bitsPerChannel = 0
        isFloat = false
        isInterleaved = false
        states.removeAll(keepingCapacity: false)
        coefficients = Array(repeating: LXBiquadCoefficients.bypass, count: lxSoundEffectBandFrequencies.count)
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

        guard enabled, channelsPerFrame > 0, coefficients.contains(where: { !$0.isBypass }) else {
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

            for frame in 0..<frameCount {
                let baseIndex = frame * channelsPerFrame
                for channel in 0..<channelsPerFrame {
                    data[baseIndex + channel] = processSample(data[baseIndex + channel], channel: channel)
                }
            }
            return
        }

        let availableChannels = min(audioBuffers.count, channelsPerFrame)
        for channel in 0..<availableChannels {
            guard let data = audioBuffers[channel].mData?.assumingMemoryBound(to: Float.self) else { continue }
            for frame in 0..<frameCount {
                data[frame] = processSample(data[frame], channel: channel)
            }
        }
    }

    private func processInt16(_ audioBuffers: UnsafeMutableAudioBufferListPointer, frameCount: Int) {
        let scale = Float(Int16.max)
        if isInterleaved {
            guard let audioBuffer = audioBuffers.first,
                  let data = audioBuffer.mData?.assumingMemoryBound(to: Int16.self) else { return }

            for frame in 0..<frameCount {
                let baseIndex = frame * channelsPerFrame
                for channel in 0..<channelsPerFrame {
                    let index = baseIndex + channel
                    let sample = Float(data[index]) / scale
                    data[index] = Int16(clamping: Int(processSample(sample, channel: channel) * scale))
                }
            }
            return
        }

        let availableChannels = min(audioBuffers.count, channelsPerFrame)
        for channel in 0..<availableChannels {
            guard let data = audioBuffers[channel].mData?.assumingMemoryBound(to: Int16.self) else { continue }
            for frame in 0..<frameCount {
                let sample = Float(data[frame]) / scale
                data[frame] = Int16(clamping: Int(processSample(sample, channel: channel) * scale))
            }
        }
    }

    private func processInt32(_ audioBuffers: UnsafeMutableAudioBufferListPointer, frameCount: Int) {
        let scale = Float(Int32.max)
        if isInterleaved {
            guard let audioBuffer = audioBuffers.first,
                  let data = audioBuffer.mData?.assumingMemoryBound(to: Int32.self) else { return }

            for frame in 0..<frameCount {
                let baseIndex = frame * channelsPerFrame
                for channel in 0..<channelsPerFrame {
                    let index = baseIndex + channel
                    let sample = Float(data[index]) / scale
                    data[index] = Int32(clamping: Int(processSample(sample, channel: channel) * scale))
                }
            }
            return
        }

        let availableChannels = min(audioBuffers.count, channelsPerFrame)
        for channel in 0..<availableChannels {
            guard let data = audioBuffers[channel].mData?.assumingMemoryBound(to: Int32.self) else { continue }
            for frame in 0..<frameCount {
                let sample = Float(data[frame]) / scale
                data[frame] = Int32(clamping: Int(processSample(sample, channel: channel) * scale))
            }
        }
    }

    private func processSample(_ sample: Float, channel: Int) -> Float {
        guard channel < states.count else { return sample }

        var output = sample
        for bandIndex in coefficients.indices {
            let coeff = coefficients[bandIndex]
            if coeff.isBypass { continue }

            var state = states[channel][bandIndex]
            let filtered = coeff.b0 * output + state.z1
            state.z1 = coeff.b1 * output - coeff.a1 * filtered + state.z2
            state.z2 = coeff.b2 * output - coeff.a2 * filtered
            states[channel][bandIndex] = state
            output = filtered
        }

        return min(max(output, -1), 1)
    }

    static func normalizeGains(_ gains: [Float]) -> [Float] {
        var normalized = Array(repeating: Float(0), count: lxSoundEffectBandFrequencies.count)
        for index in 0..<normalized.count {
            normalized[index] = index < gains.count ? gains[index] : 0
        }
        return normalized
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
`

/**
 * @typedef {{ from: string, to: string }} PatchChange
 * @typedef {{ filePath: string, changes: PatchChange[] }} PatchTarget
 */

/** @type {PatchTarget[]} */
const patchTargets = [
  {
    filePath: 'node_modules/react-native-track-player/ios/RNTrackPlayer/RNTrackPlayer.swift',
    changes: [
      {
        from: `import Foundation
import MediaPlayer
import SwiftAudioEx

@objc(RNTrackPlayer)
public class RNTrackPlayer: RCTEventEmitter {
`,
        to: `import Foundation
import MediaPlayer
import SwiftAudioEx

private let lxTrackPlayerLifecycleNotification = Notification.Name("LXTrackPlayerLifecycle")

@objc(RNTrackPlayer)
public class RNTrackPlayer: RCTEventEmitter {
`,
      },
      {
        from: `    private var hasInitialized = false
    private let player = QueuedAudioPlayer()

    // MARK: - Lifecycle Methods
`,
        to: `    private var hasInitialized = false
    private let player = QueuedAudioPlayer()

    private func lifecycleStateName(_ state: AVPlayerWrapperState) -> String {
        switch state {
        case .idle: return "idle"
        case .ready: return "ready"
        case .playing: return "playing"
        case .paused: return "paused"
        case .loading: return "loading"
        default: return "unknown"
        }
    }

    private func postLifecycleEvent(_ event: String, state: AVPlayerWrapperState? = nil, position: Double? = nil, rate: Float? = nil, extra: [String: Any] = [:]) {
        var userInfo = extra
        let lifecycleState = state ?? player.playerState
        userInfo["event"] = event
        userInfo["state"] = lifecycleStateName(lifecycleState)
        userInfo["position"] = position ?? player.currentTime
        userInfo["rate"] = rate ?? player.rate
        userInfo["track"] = player.currentIndex

        NotificationCenter.default.post(name: lxTrackPlayerLifecycleNotification, object: self, userInfo: userInfo)
    }

    // MARK: - Lifecycle Methods
`,
      },
      {
        from: `    @objc(destroy)
    public func destroy() {
        print("Destroying player")
        self.player.stop()
        self.player.nowPlayingInfoController.clear()
        try? AVAudioSession.sharedInstance().setActive(false)
        hasInitialized = false
    }
`,
        to: `    @objc(destroy)
    public func destroy() {
        print("Destroying player")
        self.player.stop()
        self.player.nowPlayingInfoController.clear()
        postLifecycleEvent("destroy", state: .idle, position: 0, rate: 0)
        try? AVAudioSession.sharedInstance().setActive(false)
        hasInitialized = false
    }
`,
      },
      {
        from: `    @objc(reset:rejecter:)
    public func reset(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        print("Resetting player.")
        player.stop()
        resolve(NSNull())
        DispatchQueue.main.async {
            UIApplication.shared.endReceivingRemoteControlEvents();
        }
    }
`,
        to: `    @objc(reset:rejecter:)
    public func reset(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        print("Resetting player.")
        player.stop()
        postLifecycleEvent("reset", state: .idle, position: 0, rate: 0)
        resolve(NSNull())
        DispatchQueue.main.async {
            UIApplication.shared.endReceivingRemoteControlEvents();
        }
    }
`,
      },
      {
        from: `    @objc(seekTo:resolver:rejecter:)
    public func seek(to time: Double, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        print("Seeking to \\(time) seconds")
        player.seek(to: time)
        resolve(NSNull())
    }
`,
        to: `    @objc(seekTo:resolver:rejecter:)
    public func seek(to time: Double, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        print("Seeking to \\(time) seconds")
        player.seek(to: time)
        postLifecycleEvent("seek", position: time)
        resolve(NSNull())
    }
`,
      },
      {
        from: `    @objc(stop:rejecter:)
    public func stop(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        print("Stopping playback")
        player.stop()
        resolve(NSNull())
    }
`,
        to: `    @objc(stop:rejecter:)
    public func stop(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        print("Stopping playback")
        player.stop()
        postLifecycleEvent("stop", state: .idle, position: 0, rate: 0)
        resolve(NSNull())
    }
`,
      },
      {
        from: `    func handleAudioPlayerStateChange(state: AVPlayerWrapperState) {
        sendEvent(withName: "playback-state", body: ["state": state.rawValue])
    }
`,
        to: `    func handleAudioPlayerStateChange(state: AVPlayerWrapperState) {
        sendEvent(withName: "playback-state", body: ["state": state.rawValue])
        postLifecycleEvent("state", state: state)
    }
`,
      },
      {
        from: `    func handleAudioPlayerFailed(error: Error?) {
        sendEvent(withName: "playback-error", body: ["error": error?.localizedDescription])
    }
`,
        to: `    func handleAudioPlayerFailed(error: Error?) {
        sendEvent(withName: "playback-error", body: ["error": error?.localizedDescription])
        postLifecycleEvent("error", extra: ["error": error?.localizedDescription ?? ""])
    }
`,
      },
      {
        from: `        var capabilitiesStr = options["capabilities"] as? [String] ?? []
        if (capabilitiesStr.contains("play") && capabilitiesStr.contains("pause")) {
            capabilitiesStr.append("togglePlayPause");
        }
        let capabilities = capabilitiesStr.compactMap { Capability(rawValue: $0) }
`,
        to: `        let capabilitiesStr = options["capabilities"] as? [String] ?? []
        let capabilities = capabilitiesStr.compactMap { Capability(rawValue: $0) }
`,
      },
    ],
  },
  {
    filePath: 'node_modules/react-native-track-player/ios/RNTrackPlayer/RNTrackPlayer.swift',
    changes: [
      {
        from: `import Foundation
import MediaPlayer
import SwiftAudioEx

private let lxTrackPlayerLifecycleNotification = Notification.Name("LXTrackPlayerLifecycle")
`,
        to: `import Foundation
import AVFoundation
import MediaPlayer
import SwiftAudioEx

private let lxTrackPlayerLifecycleNotification = Notification.Name("LXTrackPlayerLifecycle")
`,
      },
      {
        from: `    private var hasInitialized = false
    private let player = QueuedAudioPlayer()

    private func lifecycleStateName(_ state: AVPlayerWrapperState) -> String {
`,
        to: `    private var hasInitialized = false
    private let player = QueuedAudioPlayer()
    private var equalizerEnabled = false
    private var equalizerGains = LXEqualizerAudioMixController.normalizeGains([])
    private var equalizerTapProcessor: LXEqualizerAudioMixController?
    private weak var equalizedPlayerItem: AVPlayerItem?

    private func lifecycleStateName(_ state: AVPlayerWrapperState) -> String {
`,
      },
      {
        from: `    deinit {
        reset(resolve: { _ in }, reject: { _, _, _  in })
    }
`,
        to: `    deinit {
        NotificationCenter.default.removeObserver(self, name: lxSoundEffectConfigNotification, object: nil)
        reset(resolve: { _ in }, reject: { _, _, _  in })
    }
`,
      },
      {
        from: `        setupInterruptionHandling();

        // configure if player waits to play
`,
        to: `        setupInterruptionHandling();
        NotificationCenter.default.addObserver(self,
                                               selector: #selector(handleSoundEffectConfigChanged),
                                               name: lxSoundEffectConfigNotification,
                                               object: nil)

        // configure if player waits to play
`,
      },
      {
        from: `    @objc(destroy)
    public func destroy() {
        print("Destroying player")
        self.player.stop()
        self.player.nowPlayingInfoController.clear()
        postLifecycleEvent("destroy", state: .idle, position: 0, rate: 0)
        try? AVAudioSession.sharedInstance().setActive(false)
        hasInitialized = false
    }
`,
        to: `    @objc(destroy)
    public func destroy() {
        print("Destroying player")
        self.player.stop()
        equalizedPlayerItem = nil
        equalizerTapProcessor = nil
        self.player.nowPlayingInfoController.clear()
        postLifecycleEvent("destroy", state: .idle, position: 0, rate: 0)
        try? AVAudioSession.sharedInstance().setActive(false)
        hasInitialized = false
    }
`,
      },
      {
        from: `    @objc(reset:rejecter:)
    public func reset(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        print("Resetting player.")
        player.stop()
        postLifecycleEvent("reset", state: .idle, position: 0, rate: 0)
        resolve(NSNull())
        DispatchQueue.main.async {
            UIApplication.shared.endReceivingRemoteControlEvents();
        }
    }
`,
        to: `    @objc(reset:rejecter:)
    public func reset(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        print("Resetting player.")
        player.stop()
        equalizedPlayerItem = nil
        equalizerTapProcessor = nil
        postLifecycleEvent("reset", state: .idle, position: 0, rate: 0)
        resolve(NSNull())
        DispatchQueue.main.async {
            UIApplication.shared.endReceivingRemoteControlEvents();
        }
    }
`,
      },
      {
        from: `    @objc(updateNowPlayingMetadata:resolver:rejecter:)
    public func updateNowPlayingMetadata(metadata: [String: Any], resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        Metadata.update(for: player, with: metadata)
    }

    // MARK: - QueuedAudioPlayer Event Handlers
`,
        to: `    @objc(updateNowPlayingMetadata:resolver:rejecter:)
    public func updateNowPlayingMetadata(metadata: [String: Any], resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        Metadata.update(for: player, with: metadata)
    }

    @objc private func handleSoundEffectConfigChanged(_ notification: Notification) {
        applySoundEffectConfig(notification.userInfo)
        refreshEqualizerAudioMix()
    }

    private func applySoundEffectConfig(_ userInfo: [AnyHashable: Any]?) {
        equalizerEnabled = userInfo?["enabled"] as? Bool ?? false
        let inputGains = userInfo?["gains"] as? [NSNumber] ?? []
        equalizerGains = LXEqualizerAudioMixController.normalizeGains(inputGains.map { $0.floatValue })
        equalizerTapProcessor?.updateConfig(enabled: equalizerEnabled, gains: equalizerGains)
    }

    private func refreshEqualizerAudioMix() {
        guard let currentItem = player.currentPlayerItem else {
            equalizedPlayerItem = nil
            equalizerTapProcessor = nil
            return
        }

        if equalizedPlayerItem === currentItem, let processor = equalizerTapProcessor {
            processor.updateConfig(enabled: equalizerEnabled, gains: equalizerGains)
            return
        }

        guard equalizerEnabled else {
            equalizedPlayerItem = nil
            equalizerTapProcessor = nil
            return
        }

        let processor = LXEqualizerAudioMixController(enabled: equalizerEnabled, gains: equalizerGains)
        guard let audioMix = processor.makeAudioMix(for: currentItem.asset) else {
            equalizedPlayerItem = nil
            equalizerTapProcessor = nil
            return
        }

        currentItem.audioMix = audioMix
        equalizedPlayerItem = currentItem
        equalizerTapProcessor = processor
    }

    // MARK: - QueuedAudioPlayer Event Handlers
`,
      },
      {
        from: `    func handleAudioPlayerStateChange(state: AVPlayerWrapperState) {
        sendEvent(withName: "playback-state", body: ["state": state.rawValue])
        postLifecycleEvent("state", state: state)
    }
`,
        to: `    func handleAudioPlayerStateChange(state: AVPlayerWrapperState) {
        refreshEqualizerAudioMix()
        sendEvent(withName: "playback-state", body: ["state": state.rawValue])
        postLifecycleEvent("state", state: state)
    }
`,
      },
      {
        from: `    func handleAudioPlayerQueueIndexChange(previousIndex: Int?, nextIndex: Int?) {
        var dictionary: [String: Any] = [ "position": player.currentTime ]
`,
        to: `    func handleAudioPlayerQueueIndexChange(previousIndex: Int?, nextIndex: Int?) {
        refreshEqualizerAudioMix()
        var dictionary: [String: Any] = [ "position": player.currentTime ]
`,
      },
    ],
  },
]

const patchFile = async({ filePath, changes }) => {
  const resolvedPath = path.join(rootPath, filePath)
  console.log(`Patching ${filePath}`)

  const file = await fs.promises.readFile(resolvedPath, 'utf8')
  const eol = file.includes('\r\n') ? '\r\n' : '\n'
  let normalizedFile = file.replace(/\r\n/g, '\n')
  const originalFile = normalizedFile

  for (const { from, to } of changes) {
    if (normalizedFile.includes(to)) continue
    if (!normalizedFile.includes(from)) continue
    normalizedFile = normalizedFile.replace(from, to)
  }

  if (normalizedFile != originalFile) await fs.promises.writeFile(resolvedPath, normalizedFile.replace(/\n/g, eol))
}

const walkFiles = async(dirPath, visitor) => {
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) await walkFiles(entryPath, visitor)
    else await visitor(entryPath)
  }
}

const findFile = async(dirPath, fileName) => {
  let matchedPath = null
  await walkFiles(dirPath, async(filePath) => {
    if (matchedPath || path.basename(filePath) != fileName) return
    matchedPath = filePath
  })
  return matchedPath
}

const patchFileByRegex = async({ filePath, pattern, replacement }) => {
  const resolvedPath = path.join(rootPath, filePath)
  console.log(`Patching ${filePath}`)

  const file = await fs.promises.readFile(resolvedPath, 'utf8')
  const eol = file.includes('\r\n') ? '\r\n' : '\n'
  const normalizedFile = file.replace(/\r\n/g, '\n')
  if (normalizedFile.includes(replacement.trim())) return
  const nextFile = normalizedFile.replace(pattern, replacement)

  if (nextFile == normalizedFile) throw new Error('Patch pattern not found')
  if (nextFile != normalizedFile) await fs.promises.writeFile(resolvedPath, nextFile.replace(/\n/g, eol))
}

const ensureFileContent = async({ filePath, content }) => {
  const resolvedPath = path.join(rootPath, filePath)
  console.log(`Ensuring ${filePath}`)

  await fs.promises.mkdir(path.dirname(resolvedPath), { recursive: true })
  const file = await fs.promises.readFile(resolvedPath, 'utf8').catch(() => '')
  const eol = file.includes('\r\n') ? '\r\n' : '\n'
  const normalizedFile = file.replace(/\r\n/g, '\n')
  const normalizedContent = content.replace(/\r\n/g, '\n')

  if (normalizedFile == normalizedContent) return
  await fs.promises.writeFile(resolvedPath, normalizedContent.replace(/\n/g, eol))
}

const patchSwiftAudioSeek = async() => {
  const baseDir = path.join(rootPath, 'node_modules/react-native-track-player/ios/RNTrackPlayer')
  if (!fs.existsSync(baseDir)) {
    console.log('Skip SwiftAudio seek patch: react-native-track-player source not found')
    return
  }
  const wrapperPath = await findFile(baseDir, 'AVPlayerWrapper.swift')
  if (!wrapperPath) {
    console.log('Skip SwiftAudio seek patch: AVPlayerWrapper.swift not found')
    return
  }

  const relativePath = path.relative(rootPath, wrapperPath)
  await patchFileByRegex({
    filePath: relativePath,
    pattern: /func seek\(to seconds: TimeInterval\) \{[\s\S]*?func seek\(by seconds: TimeInterval\) \{/,
    replacement: `func seek(to seconds: TimeInterval) {
        // if the player is loading then we need to defer seeking until it's ready.
        if (avPlayer.currentItem == nil) {
            timeToSeekToAfterLoading = seconds
        } else {
            let time = CMTimeMakeWithSeconds(seconds, preferredTimescale: CMTimeScale(NSEC_PER_SEC))
            let performSeek = { [weak self] (completion: @escaping (Bool) -> Void) in
                guard let self = self else {
                    completion(false)
                    return
                }
                self.currentItem?.cancelPendingSeeks()
                self.avPlayer.seek(to: time, toleranceBefore: CMTime.zero, toleranceAfter: CMTime.zero, completionHandler: completion)
            }

            performSeek { [weak self] finished in
                guard let self = self else { return }
                let currentTime = self.avPlayer.currentTime().seconds
                if finished && !currentTime.isNaN && abs(currentTime - seconds) > 0.2 {
                    performSeek { [weak self] retryFinished in
                        guard let self = self else { return }
                        self.delegate?.AVWrapper(seekTo: Double(seconds), didFinish: retryFinished)
                    }
                    return
                }
                self.delegate?.AVWrapper(seekTo: Double(seconds), didFinish: finished)
            }
        }
    }
    func seek(by seconds: TimeInterval) {`,
  })
}

;(async() => {
  for (const target of patchTargets) {
    try {
      await patchFile(target)
    } catch (err) {
      console.error(`Patch ${target.filePath} failed: ${err.message}`)
    }
  }
  try {
    await patchSwiftAudioSeek()
  } catch (err) {
    console.error(`Patch SwiftAudio seek failed: ${err.message}`)
  }
  try {
    await ensureFileContent({
      filePath: 'node_modules/react-native-track-player/ios/RNTrackPlayer/LXEqualizerAudioMix.swift',
      content: equalizerAudioMixSwiftSource,
    })
  } catch (err) {
    console.error(`Ensure LXEqualizerAudioMix.swift failed: ${err.message}`)
  }
  console.log('\nDependencies patch finished.\n')
})()
