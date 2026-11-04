// 音频播放抽象。
//
// 目标：引导类页面只依赖 AudioBus 接口，不关心用的是 WebAudio、InnerAudioContext
// 还是未来的音频文件/旁白。当前实现：
//   - H5：WebAudio 合成提示音 + 可控环境声（雨声白噪），无需下载音频资源；
//   - 小程序/无 WebAudio：静音实现，界面按同一时序照常运行。
//
// 以后要接真人旁白或 TTS，实现 Narrator 接口（play(url)/stop）并在页面注入即可，
// 引导脚本与动画不需要改动。

export type CueKind = 'start' | 'phase' | 'end'
export type AmbientKind = 'none' | 'rain'

export interface AudioBus {
  /** 首次交互时调用，解锁浏览器音频权限 */
  unlock(): Promise<void>
  cue(kind: CueKind): void
  setAmbient(kind: AmbientKind): void
  setMuted(muted: boolean): void
  readonly muted: boolean
  destroy(): void
}

type Ctx = AudioContext & { state: string }

class SilentBus implements AudioBus {
  muted = true
  async unlock() {}
  cue() {}
  setAmbient() {}
  setMuted() {}
  destroy() {}
}

class WebAudioBus implements AudioBus {
  muted = false
  private ctx: Ctx | null = null
  private ambientGain: GainNode | null = null
  private ambientSource: AudioBufferSourceNode | null = null
  private ambient: AmbientKind = 'none'

  constructor(private readonly makeContext: () => Ctx) {}

  private ensure(): Ctx | null {
    if (typeof window === 'undefined') return null
    if (!this.ctx) {
      try {
        this.ctx = this.makeContext()
      } catch {
        this.ctx = null
      }
    }
    return this.ctx
  }

  async unlock(): Promise<void> {
    const ctx = this.ensure()
    if (!ctx) return
    if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined)
  }

  cue(kind: CueKind): void {
    if (this.muted) return
    const ctx = this.ensure()
    if (!ctx) return
    const now = ctx.currentTime
    const tones: Record<CueKind, number[]> = {
      start: [523.25, 659.25],
      phase: [783.99],
      end: [523.25, 392.0],
    }
    tones[kind].forEach((freq, index) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const t0 = now + index * 0.18
      gain.gain.setValueAtTime(0, t0)
      gain.gain.linearRampToValueAtTime(0.12, t0 + 0.03)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t0)
      osc.stop(t0 + 1)
    })
  }

  setAmbient(kind: AmbientKind): void {
    this.ambient = kind
    const ctx = this.ensure()
    if (!ctx) return
    this.stopAmbient()
    if (kind === 'none' || this.muted) return

    const seconds = 2
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1

    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.loop = true

    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 900

    const gain = ctx.createGain()
    gain.gain.value = 0.06

    src.connect(filter).connect(gain).connect(ctx.destination)
    src.start()
    this.ambientSource = src
    this.ambientGain = gain
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    if (muted) {
      this.stopAmbient()
    } else {
      this.setAmbient(this.ambient)
    }
  }

  destroy(): void {
    this.stopAmbient()
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined)
      this.ctx = null
    }
  }

  private stopAmbient(): void {
    if (this.ambientSource) {
      try {
        this.ambientSource.stop()
      } catch {
        /* 已停止 */
      }
      this.ambientSource.disconnect()
      this.ambientSource = null
    }
    if (this.ambientGain) {
      this.ambientGain.disconnect()
      this.ambientGain = null
    }
  }
}

let bus: AudioBus | null = null

/** 单例音频总线；环境不支持时返回静音实现，引导流程照常可用 */
export function getAudioBus(): AudioBus {
  if (bus) return bus
  if (typeof window !== 'undefined') {
    const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
    const Ctor = w.AudioContext || w.webkitAudioContext
    if (Ctor) {
      bus = new WebAudioBus(() => new Ctor())
      return bus
    }
  }
  bus = new SilentBus()
  return bus
}
