import type { ScoreLevel } from '@/lib/api'
import { LEVEL_DESC, LEVEL_TEXT, NO_SCORE_TEXT, type LevelTone } from '@/content/glossary'

export type { LevelTone }

/** 分级 → 视觉语义。unknown 既不是绿色，也不该显示成预警。 */
export function levelTone(level: ScoreLevel | null | undefined): LevelTone {
  if (!level || level === 'unknown') return 'quiet'
  return level
}

export function levelLabel(level: ScoreLevel | null | undefined): string {
  if (!level) return NO_SCORE_TEXT
  return LEVEL_TEXT[level]
}

export function levelDesc(level: ScoreLevel | null | undefined): string {
  if (!level) return ''
  return LEVEL_DESC[level]
}
