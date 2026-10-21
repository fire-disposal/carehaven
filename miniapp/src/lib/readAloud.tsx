import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Button, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import Icon from '@/components/Icon'
import { api, isLoggedIn } from './api'
import { speak, stopSpeaking } from './tts'
import './readAloud.scss'

// ---------------------------------------------------------------------------
// 全局朗读层：页面只声明「哪些文字适合被读」，不关心合成、播放与状态。
// 低层 tts.ts 只负责音频；这里负责页面内容、可用性、播放状态与统一入口。
// 不使用 DOM 抓取：小程序没有稳定的 DOM，抓屏也会把导航和按钮读进去。
// ---------------------------------------------------------------------------

interface ReadAloudContextValue {
  setPage: (id: string, text: string, label: string, withNav: boolean) => void
  clearPage: (id: string) => void
}

const ReadAloudContext = createContext<ReadAloudContextValue | null>(null)

interface PageContent {
  id: string
  text: string
  label: string
  withNav: boolean
}

export function ReadAloudProvider({ children }: { children: ReactNode }) {
  const pageRef = useRef<PageContent>({ id: '', text: '', label: '朗读本页', withNav: true })
  const [page, setPageState] = useState<PageContent>(pageRef.current)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [speaking, setSpeaking] = useState(false)
  const [busy, setBusy] = useState(false)

  const setPage = useCallback((id: string, text: string, label: string, withNav: boolean) => {
    const next = { id, text: text.trim(), label, withNav }
    if (
      pageRef.current.id === next.id &&
      pageRef.current.text === next.text &&
      pageRef.current.label === next.label &&
      pageRef.current.withNav === next.withNav
    ) {
      return
    }
    pageRef.current = next
    setPageState(next)
    // 切题/切结果时停掉上一段，避免读着上一题进入下一题
    stopSpeaking()
    setSpeaking(false)
    setBusy(false)
  }, [])

  const clearPage = useCallback((id: string) => {
    if (pageRef.current.id !== id) return
    pageRef.current = { id: '', text: '', label: '朗读本页', withNav: true }
    setPageState(pageRef.current)
    stopSpeaking()
    setSpeaking(false)
    setBusy(false)
  }, [])

  useEffect(() => {
    if (!page.text || available !== null || !isLoggedIn()) return
    let alive = true
    void api
      .ttsStatus()
      .then((res) => {
        if (alive) setAvailable(!!res.available)
      })
      .catch(() => {
        if (alive) setAvailable(false)
      })
    return () => {
      alive = false
    }
  }, [page.text, available])

  async function toggle() {
    if (busy) return
    if (speaking) {
      stopSpeaking()
      setSpeaking(false)
      return
    }
    if (!page.text) return

    setBusy(true)
    try {
      if (available === null) {
        const res = await api.ttsStatus()
        setAvailable(!!res.available)
        if (!res.available) {
          setBusy(false)
          Taro.showToast({ title: '语音暂未开通', icon: 'none' })
          return
        }
      }
      if (available === false) {
        setBusy(false)
        Taro.showToast({ title: '语音暂未开通', icon: 'none' })
        return
      }
      void speak(page.text, {
        onStart: () => {
          setBusy(false)
          setSpeaking(true)
        },
        onEnd: () => {
          setBusy(false)
          setSpeaking(false)
        },
        onError: (message) => {
          setBusy(false)
          setSpeaking(false)
          Taro.showToast({ title: message, icon: 'none' })
        },
      })
    } catch (e) {
      setBusy(false)
      Taro.showToast({
        title: e instanceof Error ? e.message : '语音暂不可用',
        icon: 'none',
      })
    }
  }

  const showDock = !!page.text && available !== false
  const contextValue = useMemo(() => ({ setPage, clearPage }), [setPage, clearPage])

  return (
    <ReadAloudContext.Provider value={contextValue}>
      {showDock ? (
        <Button
          className={`read-dock ${page.withNav ? 'with-nav' : 'no-nav'} ${speaking ? 'on' : ''}`}
          onClick={() => void toggle()}
          ariaLabel={speaking ? '停止朗读' : page.label}
        >
          <Icon
            name={speaking ? 'circle-xmark' : busy ? 'clock' : 'volume-high'}
            size={34}
          />
          <Text className="read-dock-label">
            {speaking ? '停止朗读' : busy ? '准备语音…' : page.label}
          </Text>
        </Button>
      ) : null}
      {children}
    </ReadAloudContext.Provider>
  )
}

/**
 * 页面声明可朗读内容。同一时刻只有一个页面生效；切页时旧内容自动清空。
 * `withNav` 用于让悬浮按钮避开底部导航。
 */
export function usePageReadAloud(
  text: string,
  label = '朗读本页',
  withNav = true
) {
  const ctx = useContext(ReadAloudContext)
  const idRef = useRef('')
  if (!idRef.current) {
    idRef.current = `read-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }

  useEffect(() => {
    if (!ctx) return
    ctx.setPage(idRef.current, text, label, withNav)
    return () => ctx.clearPage(idRef.current)
  }, [ctx, text, label, withNav])
}
