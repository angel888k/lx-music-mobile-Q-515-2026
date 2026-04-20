import { storageDataPrefix } from '@/config/constant'
import { getData, saveData } from '@/plugins/storage'

const createId = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

let userEqPresetList: LX.SoundEffect.EQPreset[] | null = null
let userConvolutionPresetList: LX.SoundEffect.ConvolutionPreset[] | null = null
let userPitchPresetList: LX.SoundEffect.PitchShifterPreset[] | null = null

const getCachedList = async<T>(key: string, cache: T[] | null) => {
  if (cache != null) return cache
  return (await getData<T[]>(key)) ?? []
}

const savePresetList = async<T>(key: string, list: T[]) => {
  await saveData(key, list)
  return list
}

export const getUserEQPresetList = async() => {
  // eslint-disable-next-line require-atomic-updates
  userEqPresetList = await getCachedList<LX.SoundEffect.EQPreset>(storageDataPrefix.soundEffectEQPresetList, userEqPresetList)
  return [...userEqPresetList]
}

export const saveUserEQPreset = async(preset: Omit<LX.SoundEffect.EQPreset, 'id'>) => {
  // eslint-disable-next-line require-atomic-updates
  userEqPresetList = await getCachedList<LX.SoundEffect.EQPreset>(storageDataPrefix.soundEffectEQPresetList, userEqPresetList)
  const index = userEqPresetList.findIndex(item => item.name == preset.name)
  const nextPreset: LX.SoundEffect.EQPreset = {
    ...preset,
    id: index > -1 ? userEqPresetList[index].id : createId(),
  }
  if (index > -1) userEqPresetList[index] = nextPreset
  else userEqPresetList.push(nextPreset)
  await savePresetList(storageDataPrefix.soundEffectEQPresetList, userEqPresetList)
  return [...userEqPresetList]
}

export const removeUserEQPreset = async(id: string) => {
  // eslint-disable-next-line require-atomic-updates
  userEqPresetList = await getCachedList<LX.SoundEffect.EQPreset>(storageDataPrefix.soundEffectEQPresetList, userEqPresetList)
  // eslint-disable-next-line require-atomic-updates
  userEqPresetList = userEqPresetList.filter(item => item.id != id)
  await savePresetList(storageDataPrefix.soundEffectEQPresetList, userEqPresetList)
  return [...userEqPresetList]
}

export const getUserConvolutionPresetList = async() => {
  // eslint-disable-next-line require-atomic-updates
  userConvolutionPresetList = await getCachedList<LX.SoundEffect.ConvolutionPreset>(storageDataPrefix.soundEffectConvolutionPresetList, userConvolutionPresetList)
  return [...userConvolutionPresetList]
}

export const saveUserConvolutionPreset = async(preset: Omit<LX.SoundEffect.ConvolutionPreset, 'id'>) => {
  // eslint-disable-next-line require-atomic-updates
  userConvolutionPresetList = await getCachedList<LX.SoundEffect.ConvolutionPreset>(storageDataPrefix.soundEffectConvolutionPresetList, userConvolutionPresetList)
  const index = userConvolutionPresetList.findIndex(item => item.name == preset.name)
  const nextPreset: LX.SoundEffect.ConvolutionPreset = {
    ...preset,
    id: index > -1 ? userConvolutionPresetList[index].id : createId(),
  }
  if (index > -1) userConvolutionPresetList[index] = nextPreset
  else userConvolutionPresetList.push(nextPreset)
  await savePresetList(storageDataPrefix.soundEffectConvolutionPresetList, userConvolutionPresetList)
  return [...userConvolutionPresetList]
}

export const removeUserConvolutionPreset = async(id: string) => {
  // eslint-disable-next-line require-atomic-updates
  userConvolutionPresetList = await getCachedList<LX.SoundEffect.ConvolutionPreset>(storageDataPrefix.soundEffectConvolutionPresetList, userConvolutionPresetList)
  // eslint-disable-next-line require-atomic-updates
  userConvolutionPresetList = userConvolutionPresetList.filter(item => item.id != id)
  await savePresetList(storageDataPrefix.soundEffectConvolutionPresetList, userConvolutionPresetList)
  return [...userConvolutionPresetList]
}

export const getUserPitchShifterPresetList = async() => {
  // eslint-disable-next-line require-atomic-updates
  userPitchPresetList = await getCachedList<LX.SoundEffect.PitchShifterPreset>(storageDataPrefix.soundEffectPitchPresetList, userPitchPresetList)
  return [...userPitchPresetList]
}

export const saveUserPitchShifterPreset = async(preset: Omit<LX.SoundEffect.PitchShifterPreset, 'id'>) => {
  // eslint-disable-next-line require-atomic-updates
  userPitchPresetList = await getCachedList<LX.SoundEffect.PitchShifterPreset>(storageDataPrefix.soundEffectPitchPresetList, userPitchPresetList)
  const index = userPitchPresetList.findIndex(item => item.name == preset.name)
  const nextPreset: LX.SoundEffect.PitchShifterPreset = {
    ...preset,
    id: index > -1 ? userPitchPresetList[index].id : createId(),
  }
  if (index > -1) userPitchPresetList[index] = nextPreset
  else userPitchPresetList.push(nextPreset)
  await savePresetList(storageDataPrefix.soundEffectPitchPresetList, userPitchPresetList)
  return [...userPitchPresetList]
}

export const removeUserPitchShifterPreset = async(id: string) => {
  // eslint-disable-next-line require-atomic-updates
  userPitchPresetList = await getCachedList<LX.SoundEffect.PitchShifterPreset>(storageDataPrefix.soundEffectPitchPresetList, userPitchPresetList)
  // eslint-disable-next-line require-atomic-updates
  userPitchPresetList = userPitchPresetList.filter(item => item.id != id)
  await savePresetList(storageDataPrefix.soundEffectPitchPresetList, userPitchPresetList)
  return [...userPitchPresetList]
}
