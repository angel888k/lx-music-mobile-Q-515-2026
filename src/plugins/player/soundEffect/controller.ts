import settingState from '@/store/setting/state'
import {
  equalizerFrequencies,
  getEqualizerBandSettingKey,
  isSoundEffectSettingKey,
  isSoundEffectActive,
  normalizeEqualizerGain,
} from './constants'
import { nativeEqualizerAdapter } from './adapters/nativeEqualizerAdapter'
import type {
  EqualizerFrequency,
  SoundEffectAdapter,
  SoundEffectAdapterCapabilities,
  SoundEffectEqualizerConfig,
  SoundEffectPlaybackCoverage,
  SoundEffectPlaybackPath,
  SoundEffectSupportState,
} from './types'

const soundEffectAdapters: readonly SoundEffectAdapter[] = [nativeEqualizerAdapter]
const coveragePriority: Record<SoundEffectPlaybackCoverage, number> = {
  unsupported: 0,
  partial: 1,
  supported: 2,
}

const mergePlaybackCoverage = (
  currentCoverage: Partial<Record<SoundEffectPlaybackPath, SoundEffectPlaybackCoverage>>,
  nextCoverage: Partial<Record<SoundEffectPlaybackPath, SoundEffectPlaybackCoverage>>,
) => {
  const mergedCoverage = { ...currentCoverage }
  for (const [path, coverage] of Object.entries(nextCoverage) as Array<[SoundEffectPlaybackPath, SoundEffectPlaybackCoverage]>) {
    const prevCoverage = mergedCoverage[path] ?? 'unsupported'
    mergedCoverage[path] = coveragePriority[coverage] > coveragePriority[prevCoverage] ? coverage : prevCoverage
  }
  return mergedCoverage
}

const createSupportState = (adapters: readonly SoundEffectAdapter[]): SoundEffectSupportState => {
  const supportedAdapters = adapters.filter(adapter => adapter.isSupported())
  const baseCapabilities: SoundEffectAdapterCapabilities = {
    equalizer: false,
    presets: false,
    realTimePreview: false,
    playbackPathCoverage: {
      nativeFlac: 'unsupported',
      trackPlayer: 'unsupported',
    },
  }

  const capabilities = supportedAdapters.reduce<SoundEffectAdapterCapabilities>((result, adapter) => {
    result.equalizer = result.equalizer || adapter.capabilities.equalizer
    result.presets = result.presets || adapter.capabilities.presets
    result.realTimePreview = result.realTimePreview || adapter.capabilities.realTimePreview
    result.playbackPathCoverage = mergePlaybackCoverage(result.playbackPathCoverage, adapter.capabilities.playbackPathCoverage)
    return result
  }, baseCapabilities)

  return {
    isSupported: supportedAdapters.length > 0,
    adapters: supportedAdapters.map(adapter => adapter.id),
    ...capabilities,
  }
}

const buildCurrentEqualizerConfig = (gainsOverride?: Partial<Record<EqualizerFrequency, number>>): SoundEffectEqualizerConfig => {
  const setting = settingState.setting
  const gains = equalizerFrequencies.map(frequency => normalizeEqualizerGain(gainsOverride?.[frequency] ?? setting[getEqualizerBandSettingKey(frequency)]))
  return {
    enabled: gainsOverride == null ? isSoundEffectActive(setting) : gains.some(gain => gain != 0),
    gains,
  }
}

const applyCurrentEqualizerConfig = async(gainsOverride?: Partial<Record<EqualizerFrequency, number>>) => {
  const config = buildCurrentEqualizerConfig(gainsOverride)
  const supportedAdapters = soundEffectAdapters.filter(adapter => adapter.isSupported())
  if (!supportedAdapters.length) return
  await Promise.all(supportedAdapters.map(async adapter => adapter.apply(config)))
}

const supportState = createSupportState(soundEffectAdapters)

export const soundEffectController = {
  adapters: soundEffectAdapters,
  supportState,
  isSupported: supportState.isSupported,
  isSettingKey: isSoundEffectSettingKey,
  buildCurrentEqualizerConfig,
  applyCurrentEqualizerConfig,
}
