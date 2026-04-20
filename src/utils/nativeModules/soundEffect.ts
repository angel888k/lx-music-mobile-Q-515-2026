import { NativeModules, Platform } from 'react-native'

export interface NativeEqualizerConfig {
  enabled: boolean
  gains: number[]
}

interface NativeSoundEffectModule {
  updateEqualizerConfig?: (config: NativeEqualizerConfig) => Promise<void>
}

const SoundEffectModule = NativeModules.SoundEffectModule as NativeSoundEffectModule | undefined

export const isSoundEffectSupported = Platform.OS == 'ios' && typeof SoundEffectModule?.updateEqualizerConfig == 'function'

export const updateNativeEqualizerConfig = async(config: NativeEqualizerConfig) => {
  if (!isSoundEffectSupported) return
  return SoundEffectModule?.updateEqualizerConfig?.(config)
}
