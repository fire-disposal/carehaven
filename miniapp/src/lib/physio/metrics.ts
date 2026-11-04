import type { PhysioMetric } from './types'

interface MetricSpec {
  label: string
  unit: string
  min: number
  max: number
  integer: boolean
}

/**
 * 指标定义。范围先与手动表单/服务端校验保持一致；
 * 换设备或换算法时只改这里，来源与 HPS 不需要跟着改。
 */
export const METRIC_SPECS: Record<PhysioMetric, MetricSpec> = {
  hrv: { label: 'HRV', unit: 'ms', min: 0, max: 300, integer: false },
  gsr: { label: 'GSR', unit: 'µS', min: 0, max: 50, integer: false },
  sleep_quality: { label: '睡眠质量', unit: '', min: 0, max: 100, integer: true },
  steps: { label: '步数', unit: '步', min: 0, max: 100000, integer: true },
}

export const PHYSIO_METRICS = Object.keys(METRIC_SPECS) as PhysioMetric[]

/** 逐指标校验并归一（整数四舍五入）；返回 null 表示该指标不可用 */
export function normalizeMetric(metric: PhysioMetric, raw: number): number | null {
  const spec = METRIC_SPECS[metric]
  if (!Number.isFinite(raw)) return null
  const value = spec.integer ? Math.round(raw) : Math.round(raw * 10) / 10
  if (value < spec.min || value > spec.max) return null
  return value
}
