import Taro from '@tarojs/taro'
import { api } from './api'

// 语音朗读：客户端只拿 base64 音频分片，密钥留在服务端。
// 小程序写成本地文件再交给 InnerAudioContext；H5 用 Blob URL。
// H5 与小程序共用 Taro.createInnerAudioContext，避免两套播放逻辑。

const IS_WEAPP = Taro.getEnv() === Taro.ENV_TYPE.WEAPP

const sourceCache = new Map<string, string>()
let currentAudio: Taro.InnerAudioContext | null = null
let sessionId = 0

export interface SpeakHandlers {
  onStart?: () => void
  onEnd?: () => void
  onError?: (message: string) => void
}

/** 文本短于一段直接读；长回答按句切分，避免单次超过服务端 200 字限制。 */
function splitText(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  const max = 90
  if (clean.length <= max) return [clean]

  const sentences = clean.match(/[^。！？!?；;\n]+[。！？!?；;]?/g) || [clean]
  const parts: string[] = []
  let buffer = ''

  for (const sentence of sentences) {
    if (sentence.length > max) {
      if (buffer) {
        parts.push(buffer)
        buffer = ''
      }
      for (let i = 0; i < sentence.length; i += max) {
        parts.push(sentence.slice(i, i + max))
      }
      continue
    }
    if (buffer.length + sentence.length > max) {
      parts.push(buffer)
      buffer = sentence
    } else {
      buffer += sentence
    }
  }
  if (buffer) parts.push(buffer)
  return parts
}

function hashText(text: string): string {
  let hash = 5381
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(36)
}

async function sourceFor(text: string): Promise<string> {
  const key = hashText(text)
  const cached = sourceCache.get(key)
  if (cached) return cached

  const result = await api.tts(text)
  const base64 = result.chunks.join('')
  if (!base64) throw new Error('没有取到语音')

  if (IS_WEAPP) {
    const filePath = `${Taro.env.USER_DATA_PATH}/tts-${key}.mp3`
    Taro.getFileSystemManager().writeFileSync(filePath, base64, 'base64')
    sourceCache.set(key, filePath)
    return filePath
  }

  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: result.contentType || 'audio/mpeg' }))
  sourceCache.set(key, url)
  return url
}

function playSource(src: string): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  const audio = Taro.createInnerAudioContext()
  currentAudio = audio
  let settled = false

  const finish = (error?: Error) => {
    if (settled) return
    settled = true
    if (currentAudio === audio) currentAudio = null
    try {
      audio.destroy()
    } catch {
      // 某些环境不支持 destroy；忽略即可，不能让它影响朗读结果
    }
    if (error) reject(error)
    else resolve()
  }

  audio.src = src
  // 用户主动点朗读，静音键不应让它变成「看起来在播但没有声音」
  audio.obeyMuteSwitch = false
  audio.onEnded(() => finish())
  audio.onStop(() => finish())
  audio.onError((err) => finish(new Error(err.errMsg || '语音播放失败')))
  audio.play()
  return promise
}

/** 停止当前朗读；正在等待下一段时会直接结束整个会话。 */
export function stopSpeaking() {
  sessionId += 1
  const audio = currentAudio
  currentAudio = null
  if (!audio) return
  try {
    audio.stop()
  } catch {
    // 忽略：对象可能已被回收
  }
  try {
    audio.destroy()
  } catch {
    // 同上
  }
}

/**
 * 朗读一段文字。长文本会按句切分后顺序播放；
 * 任意时刻只允许一个朗读会话，新的调用会停掉旧的。
 */
export async function speak(text: string, handlers: SpeakHandlers = {}) {
  stopSpeaking()
  const current = sessionId
  const parts = splitText(text)
  if (parts.length === 0) {
    handlers.onError?.('没有可朗读的内容')
    return
  }

  handlers.onStart?.()
  try {
    let pending: Promise<string> | null = null
    for (let i = 0; i < parts.length; i += 1) {
      if (current !== sessionId) return
      const request = pending ?? sourceFor(parts[i])
      pending = i + 1 < parts.length ? sourceFor(parts[i + 1]) : null
      // 预取下一段时先挂一个空 catch：真正 await 之前不能出现未处理的 rejection
      if (pending) pending.catch(() => {})
      const src = await request
      if (current !== sessionId) return
      await playSource(src)
    }
    if (current === sessionId) handlers.onEnd?.()
  } catch (e) {
    if (current !== sessionId) return
    stopSpeaking()
    handlers.onError?.(e instanceof Error ? e.message : '朗读失败，请稍后再试')
  }
}
