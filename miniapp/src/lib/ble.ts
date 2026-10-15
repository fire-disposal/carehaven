import Taro from '@tarojs/taro'

// ---------------------------------------------------------------------------
// 生理数据来源适配层（蓝牙接口预留）
//
// 现状：小程序蓝牙 API（wx.openBluetoothAdapter / createBLEConnection /
//      notifyBLECharacteristicValueChange 等）**不需要医疗类资质**，仅需用户授权。
//      但本项目尚无配套硬件，因此这里完成的是「接口 + 数据协议」的预留，
//      **未在真机验证**。硬件到位后只需补 DEVICE_PROFILES 里的 UUID 与帧格式。
//
// 数据协议（json-v1）：设备通过 notify 特征值推送 UTF-8 JSON 文本帧
//      {"hrv":30.4,"gsr":5.06,"sleep_quality":65,"steps":2835}
// 如需二进制帧，新增 decoder 实现即可，上层无需改动。
//
// 三种数据来源在数据层用 physio_records.source 区分（device / manual / simulated），
// 因此接入真实设备不会影响既有界面与 HPS 计算逻辑。
// ---------------------------------------------------------------------------

export interface PhysioSample {
  hrv: number
  gsr: number
  sleep_quality: number
  steps: number
  measuredAt: Date
}

export interface ZzDeviceProfile {
  /** 设备标识，仅用于日志与文档 */
  id: string
  /** 蓝牙广播名匹配前缀 */
  namePrefix: string
  /** GATT 服务 UUID */
  serviceId: string
  /** 数据通知特征值 UUID */
  notifyCharacteristicId: string
  /** 数据帧格式 */
  frame: 'json-v1'
  /** 单次读数超时（毫秒） */
  readTimeoutMs: number
}

/**
 * 已登记的设备型号。
 * 硬件与厂商协议确认后在此填入 UUID；在此之前列表为空，
 * 前端据此显示「暂未接入设备」而不是假装可用。
 */
export const DEVICE_PROFILES: ZzDeviceProfile[] = []

export type PhysioSourceKind = 'ble' | 'manual'

export interface PhysioSource {
  readonly kind: PhysioSourceKind
  /** 判断该来源当前是否可用（蓝牙需授权 + 适配器开启 + 找到设备） */
  isAvailable(): Promise<boolean>
  connect(): Promise<void>
  disconnect(): Promise<void>
  /** 读取一帧最新数据 */
  readLatest(): Promise<PhysioSample>
}

// ---------------- 帧解析 ----------------

function decodeUtf8(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let out = ''
  let i = 0
  while (i < bytes.length) {
    const b = bytes[i]
    if (b < 0x80) {
      out += String.fromCharCode(b)
      i += 1
    } else if (b >= 0xc0 && b < 0xe0) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f))
      i += 2
    } else if (b >= 0xe0 && b < 0xf0) {
      out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f))
      i += 3
    } else {
      out += '\uFFFD'
      i += 4
    }
  }
  return out
}

function readNumber(source: Record<string, unknown>, key: string): number {
  const raw = source[key]
  const value = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(value) ? value : 0
}

/** json-v1 帧 → 结构化样本；格式不符时抛错，避免把脏数据写进库 */
export function parseJsonV1Frame(buffer: ArrayBuffer): PhysioSample {
  const text = decodeUtf8(buffer).trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('设备数据帧不是合法 JSON')
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('设备数据帧结构不符合 json-v1 协议')
  }
  const frame = parsed as Record<string, unknown>
  return {
    hrv: readNumber(frame, 'hrv'),
    gsr: readNumber(frame, 'gsr'),
    sleep_quality: readNumber(frame, 'sleep_quality'),
    steps: readNumber(frame, 'steps'),
    measuredAt: new Date(),
  }
}

// ---------------- 蓝牙来源实现 ----------------

export class BlePhysioSource implements PhysioSource {
  readonly kind = 'ble' as const
  private deviceId = ''

  constructor(private readonly profile: ZzDeviceProfile) {}

  async isAvailable(): Promise<boolean> {
    try {
      await Taro.openBluetoothAdapter()
      return true
    } catch {
      return false
    }
  }

  async connect(): Promise<void> {
    await Taro.openBluetoothAdapter()
    const deviceId = await this.discover()
    if (!deviceId) {
      throw new Error(`未找到名称以「${this.profile.namePrefix}」开头的设备`)
    }
    await Taro.createBLEConnection({ deviceId })
    await Taro.notifyBLECharacteristicValueChange({
      deviceId,
      serviceId: this.profile.serviceId,
      characteristicId: this.profile.notifyCharacteristicId,
      state: true,
    })
    this.deviceId = deviceId
  }

  async disconnect(): Promise<void> {
    if (this.deviceId) {
      await Taro.closeBLEConnection({ deviceId: this.deviceId })
      this.deviceId = ''
    }
    await Taro.closeBluetoothAdapter()
  }

  /** 等待一帧 notify 数据并解析；超时抛错，由调用方决定重试 */
  readLatest(): Promise<PhysioSample> {
    if (!this.deviceId) {
      return Promise.reject(new Error('尚未连接设备'))
    }
    return new Promise<PhysioSample>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('读取设备数据超时'))
      }, this.profile.readTimeoutMs)

      Taro.onBLECharacteristicValueChange((res) => {
        clearTimeout(timer)
        try {
          resolve(parseJsonV1Frame(res.value))
        } catch (err) {
          reject(err instanceof Error ? err : new Error('设备数据解析失败'))
        }
      })
    })
  }

  private discover(): Promise<string> {
    return new Promise<string>((resolve) => {
      const timer = setTimeout(() => resolve(''), this.profile.readTimeoutMs)

      Taro.onBluetoothDeviceFound((res) => {
        const hit = res.devices.find((d) => (d.name || d.localName || '').startsWith(this.profile.namePrefix))
        if (hit) {
          clearTimeout(timer)
          resolve(hit.deviceId)
        }
      })
      void Taro.startBluetoothDevicesDiscovery({ allowDuplicatesKey: false })
    })
  }
}

// ---------------- 来源工厂 ----------------

/**
 * 选择当前可用的生理数据来源。
 * 返回值可能是 null：表示既没有登记的蓝牙设备，也没有可用的接入方式，
 * 此时界面应引导用户手动录入，而不是展示伪造数据。
 */
export async function pickPhysioSource(): Promise<PhysioSource | null> {
  for (const profile of DEVICE_PROFILES) {
    const source = new BlePhysioSource(profile)
    if (await source.isAvailable()) return source
  }
  return null
}
