import type { ScoreLevel } from '@/lib/api'

export type LevelTone = 'green' | 'yellow' | 'red' | 'quiet'

/**
 * 分级 → 视觉语义。
 * `unknown` 表示数据不足以判断（hps-2 引入）：它既不是绿色，也不该显示成预警。
 */
export function levelTone(level: ScoreLevel | null | undefined): LevelTone {
  if (!level || level === 'unknown') return 'quiet'
  return level
}

/** 分级 → 中文短语；null 表示还没有任何评估结果 */
export function levelLabel(level: ScoreLevel | null | undefined): string {
  if (!level) return '尚未评估'
  if (level === 'unknown') return '数据不足'
  if (level === 'green') return '压力平稳'
  if (level === 'yellow') return '压力预警'
  return '压力偏高'
}

export function levelDesc(level: ScoreLevel | null | undefined): string {
  if (!level) return ''
  if (level === 'unknown') {
    return '今天的数据还不够判断。补一次打卡或生理记录，结果会自动更新。'
  }
  if (level === 'green') return '当前压力处在平稳区间，保持规律作息与日常放松练习就可以。'
  if (level === 'yellow') return '压力已经有所累积，建议今天完成一次放松练习，并留意睡眠与照护负担。'
  return '压力已明显偏高，请先照顾好自己，才有余力照顾家人。'
}
