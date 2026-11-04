// 生理数据接入契约。
//
// 所有来源（手动、蓝牙、未来原生 App / HealthKit / Health Connect）都先产出
// 同一份 PhysioReading，再由 ingest 层校验、标注来源并提交服务端。
// 来源只影响「数据可信度与入库路由」，不影响 HPS 计算。

export type PhysioMetric = 'hrv' | 'gsr' | 'sleep_quality' | 'steps'

/** 数据来源；服务端会原样落到 physio_records.source，研究导出据此过滤 */
export type PhysioSourceKind = 'manual' | 'ble' | 'app-bridge' | 'simulated'

/** 一次采集的最小单元。metrics 允许只带部分指标，缺失即「没测到」，不是 0。 */
export interface PhysioReading {
  metrics: Partial<Record<PhysioMetric, number>>
  capturedAt: Date
  source: PhysioSourceKind
  /** 硬件/桥接来源的稳定标识，用于溯源与去重；手动来源为空 */
  deviceId?: string
}

/**
 * 采集端接口。实现方只负责「拿到一帧读数」，不负责校验与入库；
 * 校验、归一化、去重与路由统一在 ingest.ts。
 */
export interface PhysioSource {
  readonly kind: PhysioSourceKind
  readonly label: string
  /** 当前环境是否可用（授权、适配器、原生桥是否注入等） */
  isAvailable(): Promise<boolean>
  /** 产出一帧读数；失败应抛出可展示的错误 */
  capture(): Promise<PhysioReading>
}

/** 蓝牙设备登记项：硬件协议确认后填入 UUID 与帧格式即可接入 */
export interface DeviceProfile {
  id: string
  name: string
  /** 广播名匹配前缀 */
  namePrefix: string
  serviceId: string
  notifyCharacteristicId: string
  frame: 'json-v1'
  readTimeoutMs: number
}
