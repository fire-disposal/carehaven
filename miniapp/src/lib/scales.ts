import type { IconName } from './icons'
import type { Level } from './api'

// 量表题库与分级说明。
// 计分在服务端（pb_hooks/lib/scales.js）完成；这里的分级只用于展示规则，
// 改题或改分级时必须与服务端同步，否则同一份答案会出现两套结论。

export type ScaleKey = 'zbi12' | 'phq9' | 'gad7'

export interface ScaleOption {
  value: number
  label: string
}

export interface ScaleBand {
  upTo: number
  severity: string
  level: Level
}

export interface ScaleDef {
  key: ScaleKey
  name: string
  short: string
  icon: IconName
  tint: 'primary' | 'yellow' | 'red'
  duration: string
  intro: string
  items: string[]
  options: ScaleOption[]
  maxScore: number
  bands: ScaleBand[]
}

const FREQ_OPTIONS: ScaleOption[] = [
  { value: 0, label: '完全不会' },
  { value: 1, label: '好几天' },
  { value: 2, label: '一半以上的天数' },
  { value: 3, label: '几乎每天' },
]

const ZBI_OPTIONS: ScaleOption[] = [
  { value: 0, label: '从不' },
  { value: 1, label: '偶尔' },
  { value: 2, label: '有时' },
  { value: 3, label: '经常' },
  { value: 4, label: '几乎总是' },
]

export const SCALES: ScaleDef[] = [
  {
    key: 'zbi12',
    name: '照护负担自评',
    short: 'ZBI-12',
    icon: 'hand-holding-heart',
    tint: 'primary',
    duration: '约 3 分钟',
    intro: '了解照护工作对您生活、情绪与关系的影响，共 12 题。',
    items: [
      '因为照顾家人，您是否觉得没有足够的时间做自己的事？',
      '因为照顾家人，您是否觉得不得不放弃自己的生活？',
      '照顾家人时，您是否感到生气？',
      '照顾家人是否影响了您与其他家人或朋友的关系？',
      '因为照顾家人，您是否担心自己的未来？',
      '照顾家人是否让您感到紧张？',
      '您是否觉得不能像以前那样照顾自己？',
      '照顾家人是否让您感到孤独？',
      '照顾家人是否让您感到疲惫？',
      '照顾家人是否让您感到不堪重负？',
      '因为照顾家人，您是否觉得没有足够的钱做自己想做的事？',
      '您是否觉得自己做得不够好？',
    ],
    options: ZBI_OPTIONS,
    maxScore: 48,
    bands: [
      { upTo: 20, severity: '低负担', level: 'green' },
      { upTo: 40, severity: '中等负担', level: 'yellow' },
      { upTo: 48, severity: '高负担', level: 'red' },
    ],
  },
  {
    key: 'phq9',
    name: '情绪状态自评',
    short: 'PHQ-9',
    icon: 'heart-pulse',
    tint: 'red',
    duration: '约 3 分钟',
    intro: '回顾过去两周的情绪与兴趣变化，共 9 题。',
    items: [
      '做事时提不起劲或没有兴趣',
      '感到心情低落、沮丧或绝望',
      '入睡困难、睡不安稳或睡眠过多',
      '感觉疲倦或没有活力',
      '食欲不振或吃太多',
      '觉得自己很糟，或觉得自己很失败，或让自己、家人失望',
      '对事物专注有困难，例如阅读报纸或看电视时',
      '动作或说话速度缓慢到别人已经察觉；或正好相反，烦躁、坐立不安、动来动去的情况比平时更多',
      '有不如死掉或用某种方式伤害自己的念头',
    ],
    options: FREQ_OPTIONS,
    maxScore: 27,
    bands: [
      { upTo: 4, severity: '无或极少', level: 'green' },
      { upTo: 9, severity: '轻度', level: 'yellow' },
      { upTo: 14, severity: '中度', level: 'yellow' },
      { upTo: 19, severity: '中重度', level: 'red' },
      { upTo: 27, severity: '重度', level: 'red' },
    ],
  },
  {
    key: 'gad7',
    name: '焦虑状态自评',
    short: 'GAD-7',
    icon: 'cloud-rain',
    tint: 'yellow',
    duration: '约 2 分钟',
    intro: '回顾过去两周的紧张与担忧程度，共 7 题。',
    items: [
      '感觉紧张、焦虑或急切',
      '不能停止或控制担忧',
      '对各种各样的事情担忧过多',
      '很难放松下来',
      '由于不安而无法静坐',
      '变得容易烦恼或急躁',
      '感到似乎将有可怕的事情发生而害怕',
    ],
    options: FREQ_OPTIONS,
    maxScore: 21,
    bands: [
      { upTo: 4, severity: '无或极少', level: 'green' },
      { upTo: 9, severity: '轻度', level: 'yellow' },
      { upTo: 14, severity: '中度', level: 'yellow' },
      { upTo: 21, severity: '重度', level: 'red' },
    ],
  },
]

/** 与服务端一致的分级；仅在展示历史记录、服务端字段缺失时兜底 */
export function bandOf(def: ScaleDef, score: number): ScaleBand {
  for (const band of def.bands) {
    if (score <= band.upTo) return band
  }
  return def.bands[def.bands.length - 1]
}
