import Taro from '@tarojs/taro'
import type { DeviceProfile, PhysioReading, PhysioSource } from '../types'

// 蓝牙来源适配。数据协议 json-v1：设备通过 notify 特征值推送 UTF-8 JSON 文本帧，
// 例如 {"hrv":30.4,"gsr":5.06,"sleep_quality":65,"steps":2835}。
// 换二进制帧只加 decoder；上层（ingest / HPS）保持不变。
//
// 未在真机验证：当前无配套硬件，DEVICE_PROFILES 为空，界面据此显示「暂未接入」，
// 不伪造设备数据。

/**
 * 已登记的设备型号。硬件协议确认后填入 UUID 与帧格式即可接入，
 * 无需改动手动录入、HPS 或研究导出。
 */
export const DEVICE_PROFILES: DeviceProfile[] = []

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

/** json-v1 帧 → 读数。只保留帧里真实出现的指标；解析失败直接抛错。 */
export function parseJsonV1Frame(buffer: ArrayBuffer, capturedAt = new Date()): PhysioReading {
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
  const metrics: PhysioReading['metrics'] = {}
  for (const key of ['hrv', 'gsr', 'sleep_quality', 'steps'] as const) {
    if (frame[key] === undefined || frame[key] === null) continue
    const value = Number(frame[key])
    if (Number.isFinite(value)) metrics[key] = value
  }
  if (Object.keys(metrics).length === 0) {
    throw new Error('设备数据帧里没有可识别指标')
  }
  return { metrics, capturedAt, source: 'ble' }
}

export class BlePhysioSource implements PhysioSource {
  readonly kind = 'ble' as const
  readonly label: string
  private deviceId = ''

  constructor(private readonly profile: DeviceProfile) {
    this.label = profile.name
  }

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

  /** 读取一帧 notify 数据；超时抛错，由调用方决定是否重试 */
  capture(): Promise<PhysioReading> {
    if (!this.deviceId) {
      return Promise.reject(new Error('尚未连接设备'))
    }
    return new Promise<PhysioReading>((resolve, reject) => {
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
