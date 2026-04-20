import { memo, useEffect, useMemo, useState } from 'react'
import { TouchableOpacity, View } from 'react-native'

import Text from '@/components/common/Text'
import Slider from '@/components/common/Slider'
import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useSetting } from '@/store/setting/hook'
import CheckBoxItem from '../../components/CheckBoxItem'
import SubTitle from '../../components/SubTitle'
import {
  createEqualizerGainsRecord,
  createCustomBandSettingPatch,
  createPresetSettingPatch,
  equalizerFrequencies,
  equalizerPresets,
  getEqualizerGains,
  soundEffectController,
} from '@/plugins/player/soundEffect'

const minGain = -12
const maxGain = 12
type PreviewGains = Record<typeof equalizerFrequencies[number], number>

const formatGain = (gain: number) => `${gain > 0 ? '+' : ''}${gain.toFixed(1)}dB`

export default memo(() => {
  const t = useI18n()
  const theme = useTheme()
  const setting = useSetting()
  const [previewGains, setPreviewGains] = useState<PreviewGains>(() => getEqualizerGains(setting))

  const presetId = setting['player.soundEffect.preset']
  const enabled = setting['player.soundEffect.enabled']

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

  const handleToggle = (check: boolean) => {
    updateSetting({ 'player.soundEffect.enabled': check })
  }

  const handlePresetPress = (presetId: Exclude<LX.SoundEffectPresetId, 'custom'>) => {
    const preset = equalizerPresets.find(item => item.id == presetId)
    if (!preset) return
    const nextPreview = createEqualizerGainsRecord(preset.gains)
    setPreviewGains(nextPreview)
    updateSetting(createPresetSettingPatch(presetId))
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
    updateSetting(createCustomBandSettingPatch(frequency, value))
  }

  return (
    <SubTitle title={t('setting_play_sound_effect')}>
      <CheckBoxItem check={enabled} onChange={handleToggle} label={t('setting_play_sound_effect_enable')} />
      <View style={styles.tip}>
        <Text size={12} color={theme['c-font-label']}>{t('setting_play_sound_effect_tip')}</Text>
      </View>

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
                backgroundColor: isActive ? theme['c-primary'] : theme['c-button-background'],
              }}
              onPress={() => { handlePresetPress(preset.id) }}>
              <Text size={13} color={isActive ? theme['c-primary-font'] : theme['c-button-font']}>
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
    </SubTitle>
  )
})

const styles = createStyle({
  tip: {
    marginRight: 15,
    marginBottom: 10,
  },
  presetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    marginRight: 15,
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
  bandList: {
    marginRight: 15,
  },
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
