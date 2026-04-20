import { isSoundEffectSupported, updateNativeEqualizerConfig } from '@/utils/nativeModules/soundEffect'
import type { SoundEffectAdapter } from '../types'

export const nativeEqualizerAdapter: SoundEffectAdapter = {
  id: 'native_ios_equalizer',
  capabilities: {
    equalizer: true,
    presets: true,
    realTimePreview: true,
    playbackPathCoverage: {
      nativeFlac: 'supported',
      trackPlayer: 'partial',
    },
  },
  isSupported() {
    return isSoundEffectSupported
  },
  async apply(config) {
    await updateNativeEqualizerConfig(config)
  },
}
