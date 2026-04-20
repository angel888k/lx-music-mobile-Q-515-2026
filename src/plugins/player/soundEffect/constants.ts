import settingState from '@/store/setting/state'
import type {
  EqualizerFrequency,
  EqualizerPreset,
  SoundEffectBandSettingKey,
  SoundEffectSettingKey,
} from './types'

const bandSettingKeyMap: Record<EqualizerFrequency, SoundEffectBandSettingKey> = {
  31: 'player.soundEffect.eq.31',
  62: 'player.soundEffect.eq.62',
  125: 'player.soundEffect.eq.125',
  250: 'player.soundEffect.eq.250',
  500: 'player.soundEffect.eq.500',
  1000: 'player.soundEffect.eq.1000',
  2000: 'player.soundEffect.eq.2000',
  4000: 'player.soundEffect.eq.4000',
  8000: 'player.soundEffect.eq.8000',
  16000: 'player.soundEffect.eq.16000',
}

export const equalizerFrequencies: readonly EqualizerFrequency[] = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]

export const equalizerPresets: readonly EqualizerPreset[] = Object.freeze([
  {
    id: 'none',
    nameKey: 'setting_play_sound_effect_preset_none',
    gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  {
    id: 'pop',
    nameKey: 'setting_play_sound_effect_preset_pop',
    gains: [6, 5, -3, -2, 5, 4, -4, -3, 6, 4],
  },
  {
    id: 'dance',
    nameKey: 'setting_play_sound_effect_preset_dance',
    gains: [4, 3, -4, -6, 0, 0, 3, 4, 4, 5],
  },
  {
    id: 'rock',
    nameKey: 'setting_play_sound_effect_preset_rock',
    gains: [7, 6, 2, 1, -3, -4, 2, 1, 4, 5],
  },
  {
    id: 'classical',
    nameKey: 'setting_play_sound_effect_preset_classical',
    gains: [6, 7, 1, 2, -1, 1, -4, -6, -7, -8],
  },
  {
    id: 'vocal',
    nameKey: 'setting_play_sound_effect_preset_vocal',
    gains: [-5, -6, -4, -3, 3, 4, 5, 4, -3, -3],
  },
  {
    id: 'slow',
    nameKey: 'setting_play_sound_effect_preset_slow',
    gains: [5, 4, 2, 0, -2, 0, 3, 6, 7, 8],
  },
  {
    id: 'electronic',
    nameKey: 'setting_play_sound_effect_preset_electronic',
    gains: [6, 5, 0, -5, -4, 0, 6, 8, 8, 7],
  },
  {
    id: 'subwoofer',
    nameKey: 'setting_play_sound_effect_preset_subwoofer',
    gains: [8, 7, 5, 4, 0, 0, 0, 0, 0, 0],
  },
  {
    id: 'soft',
    nameKey: 'setting_play_sound_effect_preset_soft',
    gains: [-5, -5, -4, -4, 3, 2, 4, 4, 0, 0],
  },
])

const presetAliasMap: Partial<Record<LX.SoundEffectPresetId, Exclude<LX.SoundEffectPresetId, 'custom'>>> = {
  loudness: 'pop',
  slowSong: 'slow',
  bass: 'subwoofer',
  speech: 'vocal',
  deep: 'soft',
}

export const normalizeEqualizerPresetId = (presetId: LX.SoundEffectPresetId): LX.SoundEffectPresetId => {
  return presetAliasMap[presetId] ?? presetId
}

export const getEqualizerBandSettingKey = (frequency: EqualizerFrequency): SoundEffectBandSettingKey => {
  return bandSettingKeyMap[frequency]
}

export const soundEffectSettingKeys: readonly SoundEffectSettingKey[] = Object.freeze([
  'player.soundEffect.enabled',
  'player.soundEffect.preset',
  ...equalizerFrequencies.map(getEqualizerBandSettingKey),
])

export const createEqualizerGainsRecord = (gains?: readonly number[]) => {
  const result: Record<EqualizerFrequency, number> = {
    31: 0,
    62: 0,
    125: 0,
    250: 0,
    500: 0,
    1000: 0,
    2000: 0,
    4000: 0,
    8000: 0,
    16000: 0,
  }
  if (!gains) return result
  equalizerFrequencies.forEach((frequency, index) => {
    result[frequency] = gains[index] ?? 0
  })
  return result
}

export const normalizeEqualizerGain = (gain: number) => Math.round(gain * 10) / 10

export const hasEnabledEqualizerGains = (gains: readonly number[]) => {
  return gains.some(gain => normalizeEqualizerGain(gain) != 0)
}

export const getEqualizerPreset = (presetId: LX.SoundEffectPresetId) => {
  const normalizedPresetId = normalizeEqualizerPresetId(presetId)
  return equalizerPresets.find(preset => preset.id == normalizedPresetId) ?? equalizerPresets[0]
}

export const getEqualizerGains = (setting = settingState.setting) => {
  return createEqualizerGainsRecord(equalizerFrequencies.map(frequency => setting[getEqualizerBandSettingKey(frequency)]))
}

export const isSoundEffectActive = (setting = settingState.setting) => {
  return hasEnabledEqualizerGains(equalizerFrequencies.map(frequency => setting[getEqualizerBandSettingKey(frequency)]))
}

const createEqualizerSettingPatch = (presetId: LX.SoundEffectPresetId, gains: readonly number[]): Partial<LX.AppSetting> => {
  const patch: Partial<LX.AppSetting> = {
    'player.soundEffect.preset': hasEnabledEqualizerGains(gains) ? presetId : 'none',
    'player.soundEffect.enabled': hasEnabledEqualizerGains(gains),
  }
  equalizerFrequencies.forEach((frequency, index) => {
    patch[getEqualizerBandSettingKey(frequency)] = normalizeEqualizerGain(gains[index] ?? 0)
  })
  return patch
}

export const createPresetSettingPatch = (presetId: Exclude<LX.SoundEffectPresetId, 'custom'>): Partial<LX.AppSetting> => {
  const preset = getEqualizerPreset(presetId)
  return createEqualizerSettingPatch(preset.id, preset.gains)
}

export const createCustomBandSettingPatch = (
  frequency: EqualizerFrequency,
  gain: number,
  setting = settingState.setting,
): Partial<LX.AppSetting> => {
  const nextGains = equalizerFrequencies.map(item => item == frequency ? gain : setting[getEqualizerBandSettingKey(item)])
  return createEqualizerSettingPatch('custom', nextGains)
}

export const isSoundEffectSettingKey = (key: keyof LX.AppSetting): key is SoundEffectSettingKey => {
  return soundEffectSettingKeys.includes(key as SoundEffectSettingKey)
}
