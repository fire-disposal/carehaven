import Taro from '@tarojs/taro'
import introBreath from '@/assets/voice/intro-breath.mp3'
import intro478 from '@/assets/voice/intro-478.mp3'
import introScan from '@/assets/voice/intro-scan.mp3'
import introGround from '@/assets/voice/intro-ground.mp3'
import scan1 from '@/assets/voice/scan-1.mp3'
import scan2 from '@/assets/voice/scan-2.mp3'
import scan3 from '@/assets/voice/scan-3.mp3'
import scan4 from '@/assets/voice/scan-4.mp3'
import scan5 from '@/assets/voice/scan-5.mp3'
import scan6 from '@/assets/voice/scan-6.mp3'
import ground1 from '@/assets/voice/ground-1.mp3'
import ground2 from '@/assets/voice/ground-2.mp3'
import ground3 from '@/assets/voice/ground-3.mp3'
import ground4 from '@/assets/voice/ground-4.mp3'
import ground5 from '@/assets/voice/ground-5.mp3'

// 预录旁白清单。台词本身在 guide.ts 的阶段里，这里只做 id → 音频文件。
// 换成 CDN 地址时只改这张表，页面与课程不动。
export const VOICE_CLIPS: Record<string, string> = {
  'intro-breath': introBreath,
  'intro-478': intro478,
  'intro-scan': introScan,
  'intro-ground': introGround,
  'scan-1': scan1,
  'scan-2': scan2,
  'scan-3': scan3,
  'scan-4': scan4,
  'scan-5': scan5,
  'scan-6': scan6,
  'ground-1': ground1,
  'ground-2': ground2,
  'ground-3': ground3,
  'ground-4': ground4,
  'ground-5': ground5,
}

export interface Narrator {
  play(id?: string): void
  stop(): void
  destroy(): void
}

/**
 * 语音播放：一次只允许一个片段，阶段切换即停上一条。
 * 用 Taro InnerAudioContext，H5 与小程序同一实现；文件缺失时静默。
 */
export class NarrationPlayer implements Narrator {
  private current: Taro.InnerAudioContext | null = null
  private web: HTMLAudioElement | null = null

  play(id?: string): void {
    if (!id) return
    const src = VOICE_CLIPS[id]
    if (!src) return
    this.stop()

    if (Taro.getEnv() === Taro.ENV_TYPE.WEB && typeof Audio !== 'undefined') {
      const audio = new Audio(src)
      audio.volume = 0.95
      audio.preload = 'auto'
      audio.style.display = 'none'
      document.body.appendChild(audio)
      const cleanup = () => {
        audio.remove()
        if (this.web === audio) this.web = null
      }
      audio.onended = cleanup
      audio.onerror = cleanup
      void audio.play().catch(cleanup)
      this.web = audio
      return
    }

    const ctx = Taro.createInnerAudioContext()
    ctx.src = src
    ctx.volume = 0.95
    ctx.onEnded(() => {
      ctx.destroy()
      if (this.current === ctx) this.current = null
    })
    ctx.onError(() => {
      ctx.destroy()
      if (this.current === ctx) this.current = null
    })
    ctx.play()
    this.current = ctx
  }

  stop(): void {
    if (this.web) {
      try {
        this.web.pause()
        this.web.remove()
      } catch {
        /* 已释放 */
      }
      this.web = null
    }
    if (!this.current) return
    try {
      this.current.stop()
      this.current.destroy()
    } catch {
      /* 已释放 */
    }
    this.current = null
  }

  destroy(): void {
    this.stop()
  }
}
