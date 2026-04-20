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
type LayoutMode = 'split' | 'stacked'
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
      <Icon
        name={checked ? 'checkbox-marked' : 'checkbox-blank-outline'}
        size={15}
        color={checked ? theme['c-primary-font-active'] : theme['c-font-label']}
      />
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
      {label ? <Text size={13}>{label}</Text> : null}
      <View style={styles.placeholderSliderContent}>
        <View style={styles.sliderWrap}>
          <Slider
            minimumValue={minimumValue}
            maximumValue={maximumValue}
            step={step}
            value={value}
            onValueChange={onValueChange}
            onSlidingComplete={onSlidingComplete}
          />
        </View>
        <Text size={12} color={theme['c-font-label']} style={styles.placeholderValue}>{formatter(value)}</Text>
      </View>
    </View>
  )
})

const EqualizerSection = memo(({
  presetId,
  previewGains,
  onReset,
  onPresetPress,
  onValueChange,
  onSlidingComplete,
  layoutMode,
}: {
  presetId: LX.SoundEffectPresetId
  previewGains: PreviewGains
  onReset: () => void
  onPresetPress: (presetId: Exclude<LX.SoundEffectPresetId, 'custom'>) => void
  onValueChange: (frequency: typeof equalizerFrequencies[number], value: number) => void
  onSlidingComplete: (frequency: typeof equalizerFrequencies[number], value: number) => void
  layoutMode: LayoutMode
}) => {
  const t = useI18n()
  const theme = useTheme()
  const dividerColor = theme['c-primary-alpha-500']

  const equalizerRows = useMemo(() => {
    const result: Array<Array<typeof equalizerFrequencies[number]>> = []
    for (let index = 0; index < equalizerFrequencies.length; index += 2) {
      result.push(equalizerFrequencies.slice(index, index + 2))
    }
    return result
  }, [])

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{t('setting_play_sound_effect_equalizer')}</Text>
        <TouchableOpacity activeOpacity={0.7} onPress={onReset} style={{ ...styles.resetButton, backgroundColor: theme['c-button-background'] }}>
          <Text size={12} color={theme['c-button-font']}>{t('setting_play_sound_effect_reset')}</Text>
        </TouchableOpacity>
      </View>

      {layoutMode == 'split'
        ? (
            <View style={styles.equalizerGrid}>
              {equalizerRows.map((row, rowIndex) => (
                <View key={rowIndex} style={styles.equalizerRow}>
                  {row.map((frequency, frequencyIndex) => (
                    <View
                      key={frequency}
                      style={{
                        ...styles.equalizerItem,
                        borderRightWidth: frequencyIndex == 0 ? 1 : 0,
                        borderRightColor: dividerColor,
                        paddingRight: frequencyIndex == 0 ? 8 : 0,
                        paddingLeft: frequencyIndex == 1 ? 8 : 0,
                      }}>
                      <View style={styles.equalizerSliderRow}>
                        <Text size={13} style={styles.equalizerLabel}>{frequency >= 1000 ? `${frequency / 1000}k` : `${frequency}`}</Text>
                        <View style={styles.sliderWrap}>
                          <Slider
                            minimumValue={minGain}
                            maximumValue={maxGain}
                            step={0.1}
                            value={previewGains[frequency]}
                            onValueChange={value => { onValueChange(frequency, Number(value)) }}
                            onSlidingComplete={value => { onSlidingComplete(frequency, Number(value)) }}
                          />
                        </View>
                        <Text size={12} color={theme['c-font-label']} style={styles.equalizerValue}>{formatGain(previewGains[frequency])}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          )
        : (
            <View style={styles.stackedEqualizerList}>
              {equalizerFrequencies.map(frequency => (
                <View key={frequency} style={styles.stackedEqualizerItem}>
                  <View style={styles.equalizerSliderRow}>
                    <Text size={13} style={styles.equalizerLabel}>{frequency >= 1000 ? `${frequency / 1000}k` : `${frequency}`}</Text>
                    <View style={styles.sliderWrap}>
                      <Slider
                        minimumValue={minGain}
                        maximumValue={maxGain}
                        step={0.1}
                        value={previewGains[frequency]}
                        onValueChange={value => { onValueChange(frequency, Number(value)) }}
                        onSlidingComplete={value => { onSlidingComplete(frequency, Number(value)) }}
                      />
                    </View>
                    <Text size={12} color={theme['c-font-label']} style={styles.equalizerValue}>{formatGain(previewGains[frequency])}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}

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
              onPress={() => { onPresetPress(preset.id) }}>
              <Text size={13} color={isActive ? theme['c-button-font-selected'] : theme['c-button-font']}>
                {t(preset.nameKey)}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>
    </View>
  )
})

const EnvironmentSection = memo(({
  selectedConvolutionId,
  originGain,
  effectGain,
  onToggleConvolution,
  onOriginGainChange,
  onEffectGainChange,
}: {
  selectedConvolutionId: PlaceholderConvolutionId | null
  originGain: number
  effectGain: number
  onToggleConvolution: (id: PlaceholderConvolutionId) => void
  onOriginGainChange: (value: number) => void
  onEffectGainChange: (value: number) => void
}) => {
  const t = useI18n()
  const theme = useTheme()

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{t('setting_play_sound_effect_environment')}</Text>
      <View style={styles.envList}>
        {convolutionOptions.map(item => (
          <PlaceholderCheckbox
            key={item.id}
            checked={selectedConvolutionId == item.id}
            label={t(item.labelKey as never)}
            onPress={() => { onToggleConvolution(item.id) }}
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
          onValueChange={value => { onOriginGainChange(Number(value)) }}
          formatter={formatPercent}
        />
        <PlaceholderSliderRow
          label={t('setting_play_sound_effect_environment_effect_gain')}
          value={effectGain}
          minimumValue={0}
          maximumValue={300}
          step={1}
          onValueChange={value => { onEffectGainChange(Number(value)) }}
          formatter={formatPercent}
        />
      </View>

      <TouchableOpacity activeOpacity={0.7} style={styles.addPresetButton}>
        <Text size={16} color={theme['c-font-label']}>+</Text>
      </TouchableOpacity>
    </View>
  )
})

const PitchSection = memo(({
  playbackRate,
  onReset,
  onValueChange,
}: {
  playbackRate: number
  onReset: () => void
  onValueChange: (value: number) => void
}) => {
  const t = useI18n()
  const theme = useTheme()

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionHeaderTitle}>
          <Text style={styles.sectionTitle}>{t('setting_play_sound_effect_pitch')}</Text>
          <Icon name="help" size={14} color={theme['c-font-label']} />
        </View>
        <TouchableOpacity activeOpacity={0.7} onPress={onReset} style={{ ...styles.resetButton, backgroundColor: theme['c-button-background'] }}>
          <Text size={12} color={theme['c-button-font']}>{t('setting_play_sound_effect_reset')}</Text>
        </TouchableOpacity>
      </View>
      <PlaceholderSliderRow
        label=""
        value={playbackRate}
        minimumValue={0.5}
        maximumValue={2}
        step={0.01}
        onValueChange={value => { onValueChange(Number(value)) }}
        formatter={formatPlaybackRate}
      />
    </View>
  )
})

const SurroundSection = memo(({
  enabled,
  speed,
  distance,
  onToggle,
  onSpeedChange,
  onDistanceChange,
}: {
  enabled: boolean
  speed: number
  distance: number
  onToggle: () => void
  onSpeedChange: (value: number) => void
  onDistanceChange: (value: number) => void
}) => {
  const t = useI18n()

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{t('setting_play_sound_effect_surround')}</Text>
        <PlaceholderCheckbox
          checked={enabled}
          label={t('setting_play_sound_effect_surround_enable')}
          onPress={onToggle}
        />
      </View>
      <View style={{ opacity: enabled ? 1 : 0.45 }}>
        <PlaceholderSliderRow
          label={t('setting_play_sound_effect_surround_speed')}
          value={speed}
          minimumValue={0}
          maximumValue={50}
          step={1}
          onValueChange={value => { onSpeedChange(Number(value)) }}
          formatter={formatPlain}
        />
        <PlaceholderSliderRow
          label={t('setting_play_sound_effect_surround_distance')}
          value={distance}
          minimumValue={0}
          maximumValue={10}
          step={1}
          onValueChange={value => { onDistanceChange(Number(value)) }}
          formatter={formatPlain}
        />
      </View>
    </View>
  )
})

export default memo(({ showTip = true, layoutMode = 'split' }: {
  showTip?: boolean
  layoutMode?: LayoutMode
}) => {
  const t = useI18n()
  const theme = useTheme()
  const dividerColor = theme['c-primary-alpha-500']
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

  if (layoutMode == 'stacked') {
    return (
      <View style={styles.container}>
        <View style={styles.sectionBlock}>
          <EnvironmentSection
            selectedConvolutionId={selectedConvolutionId}
            originGain={originGain}
            effectGain={effectGain}
            onToggleConvolution={(id) => { setSelectedConvolutionId(prev => prev == id ? null : id) }}
            onOriginGainChange={setOriginGain}
            onEffectGainChange={setEffectGain}
          />
        </View>
        <View style={{ ...styles.sectionBlock, ...styles.sectionBlockWithDivider, borderTopColor: dividerColor }}>
          <EqualizerSection
            presetId={presetId}
            previewGains={previewGains}
            onReset={handleReset}
            onPresetPress={handlePresetPress}
            onValueChange={handleValueChange}
            onSlidingComplete={handleSlidingComplete}
            layoutMode={layoutMode}
          />
        </View>
        <View style={{ ...styles.sectionBlock, ...styles.sectionBlockWithDivider, borderTopColor: dividerColor }}>
          <PitchSection playbackRate={playbackRate} onReset={() => { setPlaybackRate(1) }} onValueChange={setPlaybackRate} />
        </View>
        <View style={{ ...styles.sectionBlock, ...styles.sectionBlockWithDivider, borderTopColor: dividerColor }}>
          <SurroundSection
            enabled={surroundEnabled}
            speed={surroundSpeed}
            distance={soundDistance}
            onToggle={() => { setSurroundEnabled(value => !value) }}
            onSpeedChange={setSurroundSpeed}
            onDistanceChange={setSoundDistance}
          />
        </View>
        {showTip ? (
          <View style={styles.tip}>
            <Text size={12} color={theme['c-font-label']}>{t('setting_play_sound_effect_tip')}</Text>
          </View>
        ) : null}
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <View style={styles.layout}>
        <View style={styles.leftColumn}>
          <View style={styles.sectionBlock}>
            <EnvironmentSection
              selectedConvolutionId={selectedConvolutionId}
              originGain={originGain}
              effectGain={effectGain}
              onToggleConvolution={(id) => { setSelectedConvolutionId(prev => prev == id ? null : id) }}
              onOriginGainChange={setOriginGain}
              onEffectGainChange={setEffectGain}
            />
          </View>
          <View style={{ ...styles.sectionBlock, ...styles.sectionBlockWithDivider, borderTopColor: dividerColor }}>
            <PitchSection playbackRate={playbackRate} onReset={() => { setPlaybackRate(1) }} onValueChange={setPlaybackRate} />
          </View>
          <View style={{ ...styles.sectionBlock, ...styles.sectionBlockWithDivider, borderTopColor: dividerColor }}>
            <SurroundSection
              enabled={surroundEnabled}
              speed={surroundSpeed}
              distance={soundDistance}
              onToggle={() => { setSurroundEnabled(value => !value) }}
              onSpeedChange={setSurroundSpeed}
              onDistanceChange={setSoundDistance}
            />
          </View>
          {showTip ? (
            <View style={styles.tip}>
              <Text size={12} color={theme['c-font-label']}>{t('setting_play_sound_effect_tip')}</Text>
            </View>
          ) : null}
        </View>

        <View style={{ ...styles.columnDivider, borderRightColor: dividerColor }} />

        <View style={styles.rightColumn}>
          <View style={styles.sectionBlock}>
            <EqualizerSection
              presetId={presetId}
              previewGains={previewGains}
              onReset={handleReset}
              onPresetPress={handlePresetPress}
              onValueChange={handleValueChange}
              onSlidingComplete={handleSlidingComplete}
              layoutMode={layoutMode}
            />
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
    gap: 12,
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
    marginVertical: 2,
  },
  sectionBlock: {
    minWidth: 0,
  },
  sectionBlockWithDivider: {
    borderTopWidth: 1,
    borderStyle: 'dashed',
    paddingTop: 14,
    marginTop: 12,
  },
  section: {
    paddingBottom: 2,
  },
  sectionTitle: {
    fontWeight: '600',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 8,
  },
  sectionHeaderTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  resetButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
  },
  envList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  placeholderCheckbox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 10,
    marginBottom: 6,
    gap: 3,
  },
  placeholderGroup: {
    gap: 8,
    marginBottom: 10,
  },
  placeholderSliderItem: {
    gap: 2,
  },
  placeholderSliderContent: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  placeholderValue: {
    width: 38,
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
    marginTop: 10,
  },
  equalizerGrid: {
    marginBottom: 10,
  },
  equalizerRow: {
    flexDirection: 'row',
  },
  equalizerItem: {
    flex: 1,
    marginBottom: 6,
  },
  equalizerSliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  equalizerLabel: {
    width: 24,
  },
  equalizerValue: {
    width: 38,
    textAlign: 'right',
  },
  stackedEqualizerList: {
    marginBottom: 10,
  },
  stackedEqualizerItem: {
    marginBottom: 6,
  },
  presetList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  presetButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginRight: 8,
    marginBottom: 8,
  },
  sliderWrap: {
    flex: 1,
    minWidth: 0,
  },
})
