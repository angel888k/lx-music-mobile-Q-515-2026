import { memo, useRef } from 'react'
import { useTheme } from '@/store/theme/hook'
import { useSetting } from '@/store/setting/hook'
import { isSoundEffectActive, soundEffectController } from '@/plugins/player/soundEffect'
import SoundEffectPopup, { type SoundEffectPopupType } from '@/screens/PlayDetail/components/SoundEffectPopup'
import Btn from './Btn'

export default memo(() => {
  const popupRef = useRef<SoundEffectPopupType>(null)
  const theme = useTheme()
  const setting = useSetting()

  if (!soundEffectController.isSupported) return null

  return (
    <>
      <Btn icon="slider" color={isSoundEffectActive(setting) ? theme['c-primary-font-active'] : theme['c-font-label']} onPress={() => { popupRef.current?.show() }} />
      <SoundEffectPopup ref={popupRef} position="left" />
    </>
  )
})
