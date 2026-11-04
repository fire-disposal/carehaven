import type { IconName } from './icons'

/** 心情 1–5；首页记录列表与打卡页共用，避免两处漂移 */
export const MOODS: { value: number; icon: IconName; label: string }[] = [
  { value: 1, icon: 'face-angry', label: '很糟' },
  { value: 2, icon: 'face-frown', label: '较差' },
  { value: 3, icon: 'face-meh', label: '一般' },
  { value: 4, icon: 'face-smile', label: '较好' },
  { value: 5, icon: 'face-grin-beam', label: '很好' },
]
