import { memo, useEffect, useMemo, useState } from 'react'
import { TouchableOpacity, View } from 'react-native'

import { Icon } from '@/components/common/Icon'
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
  normalizeEqualizerPresetId,
  soundEffectController,
} from '@/plugins/player/soundEffect'

const minGain = -15
const maxGain = 15
type PreviewGains = Record<typeof equalizerFrequencies[number], number>
type PlaceholderConvolutionId =
  | 'telephone'
  | 'church'
  | 'hall'
  | 'cinema'
  | 'restaurant'
  | 'bathroom'
  | 'indoor'
  | 'stereo'
  | 'matrix1'
  | 'matrix2'
  | 'cardioid'
  | 'magnetic'
  | 'spring'

const convolutionOptions: Array<{ id: PlaceholderConvolutionId, labelKey: string }> = [
  { id: 'telephone', labelKey: 'setting_play_sound_effect_env_telephone' },
  { id: 'church', labelKey: 'setting_play_sound_effect_env_church' },
  { id: 'hall', labelKey: 'setting_play_sound_effect_env_hall' },
  { id: 'cinema', labelKey: 'setting_play_sound_effect_env_cinema' },
  { id: 'restaurant', labelKey: 'setting_play_sound_effect_env_restaurant' },
  { id: 'bathroom', labelKey: 'setting_play_sound_effect_env_bathroom' },
  { id: 'indoor', labelKey: 'setting_play_sound_effect_env_indoor' },
  { id: 'stereo', labelKey: 'setting_play_sound_effect_env_stereo' },
  { id: 'matrix1', labelKey: 'setting_play_sound_effect_env_matrix_1' },
  { id: 'matrix2', labelKey: 'setting_play_sound_effect_env_matrix_2' },
  { id: 'cardioid', labelKey: 'setting_play_sound_effect_env_cardioid' },
  { id: 'magnetic', labelKey: 'setting_play_sound_effect_env_magnetic' },
  { id: 'spring', labelKey: 'setting_play_sound_effect_env_spring' },
]

const formatGain = (gain: number) => `${gain > 0 ? '+' : ''}${Number.isInteger(gain) ? gain : gain.toFixed(1)}db`
const formatPercent = (value: number) => `${Math.round(value)}%`
const formatPlaybackRate = (value: number) => `${value.toFixed(2)}x`
const formatPlain = (value: number) => `${Math.round(value)}`

const PlaceholderCheckbox = memo(({
  checked,
  label,
  onPress,
}: {
  checked: boolean
  label: string
  onPress: () => void
}) => {
  const theme = useTheme()
  return (
    <TouchableOpacity style={styles.placeholderCheckbox} activeOpacity={0.7} onPress={onPress}>
      <Icon name={checked ? 'checkbox-marked' : 'checkbox-blank-outline'} size={15} color={checked ? theme['c-primary-font-active'] : theme['c-font-label']} />
      <Text size={13}>{label}</Text>
    </TouchableOpacity>
  )
})

const PlaceholderSliderRow = memo(({
  label,
  value,
  minimumValue,
  maximumValue,
  step,
  onValueChange,
  onSlidingComplete,
  formatter,
}: {
  label: string
  value: number
  minimumValue: number
  maximumValue: number
  step: number
  onValueChange: (value: number) => void
  onSlidingComplete?: (value: number) => void
  formatter: (value: number) => string
}) => {
  const theme = useTheme()
  return (
    <View style={styles.placeholderSliderItem}>
      <Text size={13}>{label}</Text>
      <View style={styles.placeholderSliderContent}>
        <Slider
          minimumValue={minimumValue}
          maximumValue={maximumValue}
          step={step}
          value={value}
          onValueChange={onValueChange}
          onSlidingComplete={onSlidingComplete}
        />
        <Text size={12} color={theme['c-font-label']} style={styles.placeholderValue}>{formatter(value)}</Text>
      </View>
    </View>
  )
})

export default memo(({ showTip = true }: {
  showTip?: boolean
}) => {
  const t = useI18n()
  const theme = useTheme()
  const setting = useSetting()
  const [previewGains, setPreviewGains] = useState<PreviewGains>(() => getEqualizerGains(setting))
  const [selectedConvolutionId, setSelectedConvolutionId] = useState<PlaceholderConvolutionId | null>(null)
  const [originGain, setOriginGain] = useState(0)
  const [effectGain, setEffectGain] = useState(300)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [surroundEnabled, setSurroundEnabled] = useState(false)
  const [surroundSpeed, setSurroundSpeed] = useState(25)
  const [soundDistance, setSoundDistance] = useState(5)

  const presetId = normalizeEqualizerPresetId(setting['player.soundEffect.preset'])
  const equalizerRows = useMemo(() => {
    const result: Array<Array<typeof equalizerFrequencies[number]>> = []
    for (let index = 0; index < equalizerFrequencies.length; index += 2) {
      result.push(equalizerFrequencies.slice(index, index + 2))
    }
    return result
  }, [])

  useEffect(() => {
    setPreviewGains(getEqualizerGains(setting))
  }, [setting])

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
      <View style={styles.layout}>
        <View style={styles.leftColumn}>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('setting_play_sound_effect_environment')}</Text>
            <View style={styles.envList}>
              {convolutionOptions.map(item => (
                <PlaceholderCheckbox
                  key={item.id}
                  checked={selectedConvolutionId == item.id}
                  label={t(item.labelKey as never)}
                  onPress={() => {
                    setSelectedConvolutionId(prev => prev == item.id ? null : item.id)
                  }}
                />
              ))}
            </View>

            <View style={styles.placeholderGroup}>
              <PlaceholderSliderRow
                label={t('setting_play_sound_effect_environment_origin_gain')}
                value={originGain}
                minimumValue={0}
                maximumValue={100}
                step={1}
                onValueChange={value => { setOriginGain(Number(value)) }}
                formatter={formatPercent}
              />
              <PlaceholderSliderRow
                label={t('setting_play_sound_effect_environment_effect_gain')}
                value={effectGain}
                minimumValue={0}
                maximumValue={300}
                step={1}
                onValueChange={value => { setEffectGain(Number(value)) }}
                formatter={formatPercent}
              />
            </View>

            <TouchableOpacity activeOpacity={0.7} style={styles.addPresetButton}>
              <Text size={16} color={theme['c-font-label']}>+</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.sectionDivider} />

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionHeaderTitle}>
                <Text style={styles.sectionTitle}>{t('setting_play_sound_effect_pitch')}</Text>
                <Icon name="help" size={14} color={theme['c-font-label']} />
              </View>
              <TouchableOpacity activeOpacity={0.7} onPress={() => { setPlaybackRate(1) }} style={{ ...styles.resetButton, backgroundColor: theme['c-button-background'] }}>
                <Text size={12} color={theme['c-button-font']}>{t('setting_play_sound_effect_reset')}</Text>
              </TouchableOpacity>
            </View>
            <PlaceholderSliderRow
              label=""
              value={playbackRate}
              minimumValue={0.5}
              maximumValue={2}
              step={0.01}
              onValueChange={value => { setPlaybackRate(Number(value)) }}
              formatter={formatPlaybackRate}
            />
          </View>

          <View style={styles.sectionDivider} />

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{t('setting_play_sound_effect_surround')}</Text>
              <PlaceholderCheckbox
                checked={surroundEnabled}
                label={t('setting_play_sound_effect_enable')}
                onPress={() => { setSurroundEnabled(value => !value) }}
              />
            </View>
            <View style={{ opacity: surroundEnabled ? 1 : 0.45 }}>
              <PlaceholderSliderRow
                label={t('setting_play_sound_effect_surround_speed')}
                value={surroundSpeed}
                minimumValue={0}
                maximumValue={50}
                step={1}
                onValueChange={value => { setSurroundSpeed(Number(value)) }}
                formatter={formatPlain}
              />
              <PlaceholderSliderRow
                label={t('setting_play_sound_effect_surround_distance')}
                value={soundDistance}
                minimumValue={0}
                maximumValue={10}
                step={1}
                onValueChange={value => { setSoundDistance(Number(value)) }}
                formatter={formatPlain}
              />
            </View>
          </View>

          {showTip ? (
            <View style={styles.tip}>
              <Text size={12} color={theme['c-font-label']}>{t('setting_play_sound_effect_tip')}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.columnDivider} />

        <View style={styles.rightColumn}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t('setting_play_sound_effect_equalizer')}</Text>
            <TouchableOpacity activeOpacity={0.7} onPress={handleReset} style={{ ...styles.resetButton, backgroundColor: theme['c-button-background'] }}>
              <Text size={12} color={theme['c-button-font']}>{t('setting_play_sound_effect_reset')}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.equalizerGrid}>
            {equalizerRows.map((row, rowIndex) => (
              <View key={rowIndex} style={styles.equalizerRow}>
                {row.map((frequency, frequencyIndex) => (
                  <View
                    key={frequency}
                    style={{
                      ...styles.equalizerItem,
                      borderRightWidth: frequencyIndex == 0 ? 1 : 0,
                      borderRightColor: theme['c-primary-alpha-900'],
                    }}>
                    <View style={styles.equalizerSliderRow}>
                      <Text size={13} style={styles.equalizerLabel}>{frequency >= 1000 ? `${frequency / 1000}k` : `${frequency}`}</Text>
                      <Slider
                        minimumValue={minGain}
                        maximumValue={maxGain}
                        step={0.1}
                        value={previewGains[frequency]}
                        onValueChange={value => { handleValueChange(frequency, Number(value)) }}
                        onSlidingComplete={value => { handleSlidingComplete(frequency, Number(value)) }}
                      />
                      <Text size={12} color={theme['c-font-label']} style={styles.equalizerValue}>{formatGain(previewGains[frequency])}</Text>
                    </View>
                  </View>
                ))}
              </View>
            ))}
          </View>

          <View style={styles.presetList}>
            {equalizerPresets.filter(preset => preset.id != 'none').map(preset => {
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
        </View>
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
  layout: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 14,
  },
  leftColumn: {
    flex: 1,
    minWidth: 0,
  },
  rightColumn: {
    flex: 1,
    minWidth: 0,
  },
  columnDivider: {
    width: 1,
    borderRightWidth: 1,
    borderStyle: 'dashed',
    borderRightColor: 'rgba(120, 180, 160, 0.5)',
  },
  section: {
    paddingBottom: 10,
  },
  sectionTitle: {
    fontWeight: '600',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 12,
  },
  sectionHeaderTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionDivider: {
    borderTopWidth: 1,
    borderStyle: 'dashed',
    borderTopColor: 'rgba(120, 180, 160, 0.5)',
    marginBottom: 12,
    paddingTop: 12,
  },
  resetButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
  },
  envList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  placeholderCheckbox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 14,
    marginBottom: 8,
    gap: 4,
  },
  placeholderGroup: {
    gap: 8,
    marginBottom: 10,
  },
  placeholderSliderItem: {
    gap: 4,
  },
  placeholderSliderContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  placeholderValue: {
    width: 46,
    textAlign: 'right',
  },
  addPresetButton: {
    width: 28,
    height: 24,
    borderRadius: 4,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(120, 180, 160, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tip: {
    marginTop: 8,
  },
  equalizerGrid: {
    marginBottom: 10,
  },
  equalizerRow: {
    flexDirection: 'row',
  },
  equalizerItem: {
    flex: 1,
    paddingRight: 10,
    marginBottom: 6,
  },
  equalizerSliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  equalizerLabel: {
    width: 30,
  },
  equalizerValue: {
    width: 46,
    textAlign: 'right',
  },
  presetList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  presetButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
    marginRight: 10,
    marginBottom: 10,
  },
})
