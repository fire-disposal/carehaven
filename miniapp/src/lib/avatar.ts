import leaf from '@/assets/avatars/leaf.png'
import sun from '@/assets/avatars/sun.png'
import cloud from '@/assets/avatars/cloud.png'
import cat from '@/assets/avatars/cat.png'
import flower from '@/assets/avatars/flower.png'
import wave from '@/assets/avatars/wave.png'

export interface AvatarPreset {
  id: string
  label: string
  src: string
}

/** 预置插画头像；id 存入 users.avatar，插画本身由前端随包发布 */
export const AVATARS: AvatarPreset[] = [
  { id: 'leaf', label: '叶', src: leaf },
  { id: 'sun', label: '暖阳', src: sun },
  { id: 'cloud', label: '云', src: cloud },
  { id: 'cat', label: '猫', src: cat },
  { id: 'flower', label: '花', src: flower },
  { id: 'wave', label: '水波', src: wave },
]

export function avatarById(id?: string): AvatarPreset {
  return AVATARS.find((item) => item.id === id) ?? AVATARS[0]
}
