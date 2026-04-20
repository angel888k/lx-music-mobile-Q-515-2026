import { memo, useEffect, useMemo, useState } from 'react'
import { TouchableOpacity, View } from 'react-native'

import Text from '@/components/common/Text'
import Slider from '@/components/common/Slider'
import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useSetting } from '@/store/setting/hook'
import {
  createEqualizerGainsRecord,
  createCustomBandSettingPatch,
  createPresetSettingPatch,
  equalizerFrequencies,
  equalizerPresets,
  getEqualizerGains,
  isSoundEffectActive,
  soundEffectController,
} from '@/plugins/player/soundEffect'

const minGain = -12
const maxGain = 12
type PreviewGains = Record<typeof equalizerFrequencies[number], number>

const formatGain = (gain: number) => `${gain > 0 ? '+' : ''}${gain.toFixed(1)}dB`

export default memo(({ showTip = true }: {
  showTip?: boolean
}) => {
  const t = useI18n()
  const theme = useTheme()
  const setting = useSetting()
  const [previewGains, setPreviewGains] = useState<PreviewGains>(() => getEqualizerGains(setting))

  const presetId = setting['player.soundEffect.preset']
  const isActive = isSoundEffectActive(setting)

  useEffect(() => {
    setPreviewGains(getEqualizerGains(setting))
  }, [setting])

  const customPresetLabel = useMemo(() => {
    if (presetId != 'custom') return null
    return (
      <View style={{ ...styles.customPresetBadge, borderColor: theme['c-primary'] }}>
        <Text size={13} color={theme['c-primary']}>{t('setting_play_sound_effect_preset_custom')}</Text>
      </View>
    )
  }, [presetId, t, theme])

  const handleReset = () => {
    updateSetting(createPresetSettingPatch('none'))
  }

  const handlePresetPress = (nextPresetId: Exclude<LX.SoundEffectPresetId, 'custom'>) => {
    const preset = equalizerPresets.find(item => item.id == nextPresetId)
    if (!preset) return
    const nextPreview = createEqualizerGainsRecord(preset.gains)
    setPreviewGains(nextPreview)
    updateSetting(createPresetSettingPatch(nextPresetId))
  }

  const handleValueChange = (frequency: typeof equalizerFrequencies[number], value: number) => {
    value = Math.round(value * 10) / 10
    setPreviewGains(prev => {
      const next = {
        ...prev,
        [frequency]: value,
      }
      void soundEffectController.applyCurrentEqualizerConfig(next)
      return next
    })
  }

  const handleSlidingComplete = (frequency: typeof equalizerFrequencies[number], value: number) => {
    updateSetting(createCustomBandSettingPatch(frequency, value, setting))
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text>{isActive ? t('setting_play_sound_effect_preset') : t('setting_play_sound_effect_preset_none')}</Text>
        <TouchableOpacity activeOpacity={0.7} onPress={handleReset} style={{ ...styles.resetButton, backgroundColor: theme['c-button-background'] }}>
          <Text size={12} color={theme['c-button-font']}>{t('setting_play_sound_effect_reset')}</Text>
        </TouchableOpacity>
      </View>
      {showTip ? (
        <View style={styles.tip}>
          <Text size={12} color={theme['c-font-label']}>{t('setting_play_sound_effect_tip')}</Text>
        </View>
      ) : null}

      <View style={styles.presetHeader}>
        <Text>{t('setting_play_sound_effect_preset')}</Text>
        {customPresetLabel}
      </View>
      <View style={styles.presetList}>
        {equalizerPresets.map(preset => {
          const isActive = preset.id == presetId
          return (
            <TouchableOpacity
              key={preset.id}
              activeOpacity={0.7}
              style={{
                ...styles.presetButton,
                backgroundColor: isActive ? theme['c-button-background-selected'] : theme['c-button-background'],
              }}
              onPress={() => { handlePresetPress(preset.id) }}>
              <Text size={13} color={isActive ? theme['c-button-font-selected'] : theme['c-button-font']}>
                {t(preset.nameKey)}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>

      <View style={styles.bandList}>
        {equalizerFrequencies.map(frequency => (
          <View key={frequency} style={styles.bandItem}>
            <View style={styles.bandHeader}>
              <Text>{frequency >= 1000 ? `${frequency / 1000}kHz` : `${frequency}Hz`}</Text>
              <Text size={12} color={theme['c-font-label']}>{formatGain(previewGains[frequency])}</Text>
            </View>
            <Slider
              minimumValue={minGain}
              maximumValue={maxGain}
              step={0.1}
              value={previewGains[frequency]}
              onValueChange={value => { handleValueChange(frequency, Number(value)) }}
              onSlidingComplete={value => { handleSlidingComplete(frequency, Number(value)) }}
            />
          </View>
        ))}
      </View>
    </View>
  )
})

const styles = createStyle({
  container: {
    paddingTop: 5,
    paddingLeft: 15,
    paddingRight: 15,
    paddingBottom: 15,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 12,
  },
  resetButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  tip: {
    marginBottom: 10,
  },
  presetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  customPresetBadge: {
    marginLeft: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
    borderRadius: 999,
  },
  presetList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  presetButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
    marginRight: 10,
    marginBottom: 10,
  },
  bandList: {},
  bandItem: {
    marginBottom: 6,
  },
  bandHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: -6,
  },
})
