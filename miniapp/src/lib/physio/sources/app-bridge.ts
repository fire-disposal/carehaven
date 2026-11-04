import type { PhysioReading, PhysioSource } from '../types'

// 原生 App / 系统健康数据（HealthKit、Health Connect）接入位。
//
// 设计：小程序不直接读系统健康库。原生端（Flutter / Kotlin）负责采集，
// 用同一份 PhysioReading 契约直接 POST 到服务端设备入口，再由服务端写库。
// 小程序只在「原生壳」里通过注入的 bridge 读最近一次读数用于展示，不负责回传。
//
// 当前无原生壳，故 isAvailable() 恒为 false；接入时由宿主注入实现：
//   registerAppBridge(async () => ({ metrics, capturedAt, source: 'app-bridge', deviceId }))
//
// 这样 HPS、手动表单、研究导出都不需要为「换平台」改动。

export type AppBridgeReader = () => Promise<PhysioReading>

let injectedReader: AppBridgeReader | null = null

/** 原生壳启动时调用；未注入时小程序按「不可用」处理，不显示伪造数据 */
export function registerAppBridge(reader: AppBridgeReader | null): void {
  injectedReader = reader
}

export class AppBridgePhysioSource implements PhysioSource {
  readonly kind = 'app-bridge' as const
  readonly label = '手机健康数据'

  async isAvailable(): Promise<boolean> {
    return injectedReader !== null
  }

  async capture(): Promise<PhysioReading> {
    if (!injectedReader) {
      throw new Error('当前环境没有可用的原生健康数据桥')
    }
    const reading = await injectedReader()
    return { ...reading, source: 'app-bridge' }
  }
}

/**
 * 原生端直传服务端的字段契约（与 /api/zz/physio/device 对齐）。
 * 原生 App 开发者照此实现即可，无需依赖小程序代码。
 */
export const APP_INGEST_CONTRACT = {
  path: '/api/zz/physio/device',
  auth: 'Authorization: Bearer <device_token>',
  body: {
    source: 'app-bridge',
    device_id: '<stable-device-id>',
    captured_at: '<ISO-8601>',
    metrics: { hrv: 0, gsr: 0, sleep_quality: 0, steps: 0 },
  },
} as const
