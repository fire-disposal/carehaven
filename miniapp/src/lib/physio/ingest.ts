import { api } from '@/lib/api'
import { normalizeMetric } from './metrics'
import type { PhysioMetric, PhysioReading, PhysioSource } from './types'
import { AppBridgePhysioSource } from './sources/app-bridge'
import { BlePhysioSource, DEVICE_PROFILES } from './sources/ble'

export type IngestTransport = 'manual' | 'device'

export interface IngestResult {
  id: string
  date: string
  source: PhysioReading['source']
  metrics: PhysioReading['metrics']
}

/** 手动录入需要四个指标齐全（表单本来就要求全部填写） */
function requireAllMetrics(reading: PhysioReading): Record<PhysioMetric, number> {
  const out = {} as Record<PhysioMetric, number>
  for (const key of ['hrv', 'gsr', 'sleep_quality', 'steps'] as const) {
    const raw = reading.metrics[key]
    const value = raw === undefined ? null : normalizeMetric(key, raw)
    if (value === null) {
      throw new Error('手动录入需要完整且有效的 HRV、GSR、睡眠质量与步数')
    }
    out[key] = value
  }
  return out
}

/**
 * 统一入库入口。
 *
 * - manual：走 /api/zz/physio/manual，服务端固定写 source=manual 与当日 date。
 * - device：走 /api/zz/physio/device（设备 token）。当前服务端路由尚未开放，
 *   在此显式失败，避免把蓝牙/原生数据伪装成手动数据污染研究样本。
 *
 * 新增来源时只在这里补一个分支，UI 与 HPS 不动。
 */
export async function ingestPhysio(reading: PhysioReading): Promise<IngestResult> {
  if (reading.source === 'simulated') {
    throw new Error('模拟数据不进入正式库（仅用于演示）')
  }

  if (reading.source === 'manual') {
    const metrics = requireAllMetrics(reading)
    const res = await api.createPhysioRecord(metrics)
    return { ...res, source: reading.source, metrics }
  }

  // ble / app-bridge：需要设备 token，服务端路由就绪后在此接入
  throw new Error('设备上报接口尚未开放；请先使用手动录入，或在服务端启用 /api/zz/physio/device')
}

/** 按优先级挑选可用来源；无可用来源返回 null，界面应引导手动录入 */
export async function pickPhysioSource(): Promise<PhysioSource | null> {
  const candidates: PhysioSource[] = [
    new AppBridgePhysioSource(),
    ...DEVICE_PROFILES.map((profile) => new BlePhysioSource(profile)),
  ]
  for (const source of candidates) {
    if (await source.isAvailable()) return source
  }
  return null
}
