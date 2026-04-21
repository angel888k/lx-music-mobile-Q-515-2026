const fs = require('node:fs')
const path = require('node:path')

const rootPath = path.resolve(__dirname, '..')
const profile = JSON.parse(fs.readFileSync(path.join(rootPath, 'config/soundEffectDspProfile.json'), 'utf8'))
const appDelegate = fs.readFileSync(path.join(rootPath, 'ios/LxMusicMobile/AppDelegate.mm'), 'utf8')
const swiftPatch = fs.readFileSync(path.join(rootPath, 'patches/ios/LXEqualizerAudioMix.swift'), 'utf8')

const errors = []

const expectIncludes = (source, snippet, label) => {
  if (!source.includes(snippet)) errors.push(`Missing ${label}: ${snippet}`)
}

const expectCountAtLeast = (source, pattern, minCount, label) => {
  const count = (source.match(pattern) ?? []).length
  if (count < minCount) errors.push(`Expected at least ${minCount} matches for ${label}, found ${count}`)
}

const expectOrdered = (source, tokens, label) => {
  let lastIndex = -1
  for (const token of tokens) {
    const index = source.indexOf(token, lastIndex + 1)
    if (index < 0) {
      errors.push(`Missing token for ${label}: ${token}`)
      return
    }
    if (index < lastIndex) {
      errors.push(`Unexpected order for ${label}: ${token}`)
      return
    }
    lastIndex = index
  }
}

const frequencyList = profile.equalizerFrequencies.join(', ')
const pitchBypass = profile.pitch.bypassThreshold
const eqBypass = profile.equalizerBypassThreshold
const q = profile.equalizerQ
const headroomThresholdDb = profile.equalizerHeadroomThresholdDb
const headroomRatio = profile.equalizerHeadroomRatio
const blockSize = profile.phaseVocoder.blockSize
const hopSize = profile.phaseVocoder.hopSize
const windowScale = profile.phaseVocoder.windowScale
const pitchMin = profile.pitch.minRate
const pitchMax = profile.pitch.maxRate
const pitchDefault = profile.pitch.defaultRate
const dynamicsThresholdDb = profile.dynamics.thresholdDb
const dynamicsRatio = profile.dynamics.ratio
const dynamicsAttack = profile.dynamics.attackSeconds
const dynamicsRelease = profile.dynamics.releaseSeconds
const dynamicsMakeupRatio = profile.dynamics.makeupRatio

expectIncludes(appDelegate, `frequencies = @[ @${profile.equalizerFrequencies.join(', @')} ];`, 'AppDelegate equalizer frequencies')
expectIncludes(swiftPatch, `let lxSoundEffectBandFrequencies: [Float] = [${frequencyList}]`, 'Swift equalizer frequencies')

expectIncludes(appDelegate, `const float q = ${q}f;`, 'AppDelegate equalizer Q')
expectIncludes(swiftPatch, `let q: Float = ${q}`, 'Swift equalizer Q')

expectIncludes(swiftPatch, `init?(channelCount: Int, blockSize: Int = ${blockSize}, hopSize: Int = ${hopSize}) {`, 'Swift phase vocoder sizes')
expectCountAtLeast(appDelegate, new RegExp(`_blockSize = ${blockSize};`, 'g'), 2, 'AppDelegate phase vocoder block size')
expectCountAtLeast(appDelegate, new RegExp(`_hopSize = ${hopSize};`, 'g'), 2, 'AppDelegate phase vocoder hop size')

expectCountAtLeast(appDelegate, new RegExp(`${windowScale.toFixed(1)} \\* \\(1\\.0 - cos`, 'g'), 2, 'AppDelegate Hann window scale')
expectIncludes(swiftPatch, `${windowScale.toFixed(1)} * (1 - cos`, 'Swift Hann window scale')

expectCountAtLeast(appDelegate, new RegExp(`fabsf\\(pitchFactor - ${pitchDefault.toFixed(1)}f\\) < ${pitchBypass.toFixed(2)}f`, 'g'), 3, 'AppDelegate pitch bypass threshold')
expectIncludes(swiftPatch, `abs(pitchPlaybackRate - ${pitchDefault}) >= ${pitchBypass.toFixed(2)}`, 'Swift pitch bypass threshold')

expectCountAtLeast(appDelegate, new RegExp(`fabsf\\(gain\\) < ${eqBypass.toFixed(2)}f`, 'g'), 1, 'AppDelegate EQ bypass threshold')
expectIncludes(swiftPatch, `if abs(gain) < ${eqBypass.toFixed(2)} { return .bypass }`, 'Swift EQ bypass threshold')
expectIncludes(appDelegate, 'makeHeadroomGain', 'AppDelegate equalizer headroom helper')
expectIncludes(swiftPatch, 'makeHeadroomGain', 'Swift equalizer headroom helper')
expectIncludes(appDelegate, `const float thresholdDb = ${headroomThresholdDb.toFixed(1)}f;`, 'AppDelegate equalizer headroom threshold')
expectIncludes(appDelegate, `const float ratio = ${headroomRatio.toFixed(1)}f;`, 'AppDelegate equalizer headroom ratio')
expectIncludes(swiftPatch, `let thresholdDb: Float = ${headroomThresholdDb.toFixed(0)}`, 'Swift equalizer headroom threshold')
expectIncludes(swiftPatch, `let ratio: Float = ${headroomRatio.toFixed(0)}`, 'Swift equalizer headroom ratio')
expectIncludes(appDelegate, `levelDb > ${dynamicsThresholdDb.toFixed(1)}f`, 'AppDelegate dynamics threshold')
expectIncludes(appDelegate, `(${dynamicsAttack.toFixed(3)}f * (float)sampleRate)`, 'AppDelegate dynamics attack')
expectIncludes(appDelegate, `(${dynamicsRelease.toFixed(2)}f * (float)sampleRate)`, 'AppDelegate dynamics release')
expectIncludes(appDelegate, `compressedDb = ${dynamicsThresholdDb.toFixed(1)}f + (levelDb + ${(-dynamicsThresholdDb).toFixed(1)}f) / ${dynamicsRatio.toFixed(1)}f`, 'AppDelegate dynamics ratio expression')
expectIncludes(appDelegate, `_makeupRatio = ${dynamicsMakeupRatio.toFixed(1)}f`, 'AppDelegate dynamics makeup ratio')
expectIncludes(swiftPatch, `if levelDb > ${dynamicsThresholdDb.toFixed(0)}`, 'Swift dynamics threshold')
expectIncludes(swiftPatch, '0.003 * Float(sampleRate)', 'Swift dynamics attack')
expectIncludes(swiftPatch, '0.25 * Float(sampleRate)', 'Swift dynamics release')
expectIncludes(swiftPatch, 'compressedDb = -24 + (levelDb + 24) / 12', 'Swift dynamics ratio expression')
expectIncludes(swiftPatch, `private let makeupRatio: Float = ${dynamicsMakeupRatio.toFixed(1)}`, 'Swift dynamics makeup ratio')

expectCountAtLeast(appDelegate, new RegExp(`LXSoundEffectClampFloatValue\\([^\\n]+${pitchDefault.toFixed(1)}f, ${pitchMin.toFixed(1)}f, ${pitchMax.toFixed(1)}f\\)`, 'g'), 2, 'AppDelegate pitch clamp range')
expectIncludes(swiftPatch, `pitchPlaybackRate: clampedFloat(pitchInfo?["playbackRate"], defaultValue: ${pitchDefault}, minValue: ${pitchMin}, maxValue: ${pitchMax})`, 'Swift pitch clamp range')

expectOrdered(
  appDelegate,
  [
    'equalizerProcessor->processPCMChannels',
    'pitchProcessor->processPCMChannels',
    'convolutionProcessor->processPCMChannels',
    'dynamicsProcessor->processPCMChannels',
    'pannerProcessor->processPCMChannels',
  ],
  'AppDelegate processing order',
)

expectOrdered(
  swiftPatch,
  [
    'processEqualizer(samples[channel], channel: channel)',
    'processPitch(&samples',
    'processConvolution(&samples',
    'processDynamics(&samples',
    'applyPanner(to: &samples',
  ],
  'Swift processing order',
)

if (errors.length) {
  console.error('Sound effect DSP profile check failed.')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log('Sound effect DSP profile check passed.')
