export type EqualizerFrequency = 31 | 62 | 125 | 250 | 500 | 1000 | 2000 | 4000 | 8000 | 16000

export type SoundEffectBandSettingKey =
  | 'player.soundEffect.eq.31'
  | 'player.soundEffect.eq.62'
  | 'player.soundEffect.eq.125'
  | 'player.soundEffect.eq.250'
  | 'player.soundEffect.eq.500'
  | 'player.soundEffect.eq.1000'
  | 'player.soundEffect.eq.2000'
  | 'player.soundEffect.eq.4000'
  | 'player.soundEffect.eq.8000'
  | 'player.soundEffect.eq.16000'

export type SoundEffectSettingKey =
  | SoundEffectBandSettingKey
  | 'player.soundEffect.enabled'
  | 'player.soundEffect.preset'

export type EqualizerPresetNameKey =
  | 'setting_play_sound_effect_preset_none'
  | 'setting_play_sound_effect_preset_electronic'
  | 'setting_play_sound_effect_preset_slow_song'
  | 'setting_play_sound_effect_preset_bass'
  | 'setting_play_sound_effect_preset_classical'
  | 'setting_play_sound_effect_preset_speech'
  | 'setting_play_sound_effect_preset_deep'
  | 'setting_play_sound_effect_preset_loudness'

export interface EqualizerPreset {
  id: Exclude<LX.SoundEffectPresetId, 'custom'>
  nameKey: EqualizerPresetNameKey
  gains: number[]
}

export interface SoundEffectEqualizerConfig {
  enabled: boolean
  gains: number[]
}

export type SoundEffectAdapterId = 'native_ios_equalizer'
export type SoundEffectPlaybackPath = 'nativeFlac' | 'trackPlayer'
export type SoundEffectPlaybackCoverage = 'unsupported' | 'partial' | 'supported'

export interface SoundEffectAdapterCapabilities {
  equalizer: boolean
  presets: boolean
  realTimePreview: boolean
  playbackPathCoverage: Partial<Record<SoundEffectPlaybackPath, SoundEffectPlaybackCoverage>>
}

export interface SoundEffectAdapter {
  id: SoundEffectAdapterId
  capabilities: SoundEffectAdapterCapabilities
  isSupported: () => boolean
  apply: (config: SoundEffectEqualizerConfig) => Promise<void> | void
}

export interface SoundEffectSupportState extends SoundEffectAdapterCapabilities {
  isSupported: boolean
  adapters: SoundEffectAdapterId[]
}
