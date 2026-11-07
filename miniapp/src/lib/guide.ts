import { useCallback, useEffect, useRef, useState } from 'react'

// 引导课：纯数据脚本 + 时间线状态机。
// 动画组件只消费「当前阶段 + 该阶段时长」，因此新增课程不需要改动画代码。
// 台词原则：少而关键；不逐拍重复，呼吸课只留一段开场。

export type PhaseKind = 'inhale' | 'hold' | 'exhale' | 'rest' | 'prompt'
export type SceneKind = 'breath' | 'scan' | 'ground'

export interface GuidePhase {
  kind: PhaseKind
  label: string
  detail?: string
  seconds: number
  /** 预录语音片段 id（见 lib/narration.ts）；为空则不播语音 */
  voice?: string
}

export interface GuideScript {
  id: string
  title: string
  subtitle: string
  scene: SceneKind
  ambient: 'none' | 'rain'
  /** 开始页播一次的开场语音；呼吸课不逐拍念 */
  introVoice?: string
  phases: GuidePhase[]
}

const cycle = (phases: GuidePhase[], times: number): GuidePhase[] =>
  Array.from({ length: times }).flatMap(() => phases)

const BREATH_PHASES: GuidePhase[] = [
  { kind: 'inhale', label: '吸气', detail: '数四拍', seconds: 4 },
  { kind: 'hold', label: '停', detail: '轻轻停住', seconds: 4 },
  { kind: 'exhale', label: '呼气', detail: '数四拍，慢慢放掉', seconds: 4 },
  { kind: 'rest', label: '停', detail: '什么都不用做', seconds: 4 },
]

export const GUIDE_SCRIPTS: Record<string, GuideScript> = {
  'breath-box': {
    id: 'breath-box',
    title: '四拍呼吸',
    subtitle: '吸气、停、呼气、停，各四拍。跟着圆形就好。',
    scene: 'breath',
    ambient: 'none',
    introVoice: 'intro-breath',
    phases: cycle(BREATH_PHASES, 6),
  },
  'breath-478': {
    id: 'breath-478',
    title: '4-7-8 放松呼吸',
    subtitle: '更适合睡前。屏息不舒服，就直接呼气。',
    scene: 'breath',
    ambient: 'rain',
    introVoice: 'intro-478',
    phases: cycle(
      [
        { kind: 'inhale', label: '吸气', detail: '四拍', seconds: 4 },
        { kind: 'hold', label: '屏息', detail: '七拍，按舒适度调整', seconds: 7 },
        { kind: 'exhale', label: '呼气', detail: '八拍，像吹灭一支蜡烛', seconds: 8 },
      ],
      6
    ),
  },
  'body-scan': {
    id: 'body-scan',
    title: '身体扫描',
    subtitle: '给自己几分钟，从头到脚，慢慢松开。',
    scene: 'scan',
    ambient: 'none',
    introVoice: 'intro-scan',
    phases: [
      { kind: 'prompt', label: '坐稳', detail: '双脚踩地，肩膀松下来。先自然呼吸三次。', seconds: 40, voice: 'scan-1' },
      { kind: 'prompt', label: '肩膀与下巴', detail: '呼气时让肩膀下沉，牙齿分开，舌头放松。', seconds: 40, voice: 'scan-2' },
      { kind: 'prompt', label: '双手', detail: '感受手掌的温度，手指不用力。', seconds: 40, voice: 'scan-3' },
      { kind: 'prompt', label: '胸口与腹部', detail: '注意呼吸起伏，不用刻意加深。', seconds: 40, voice: 'scan-4' },
      { kind: 'prompt', label: '双腿与脚', detail: '让重量落到地面，脚趾松开。', seconds: 40, voice: 'scan-5' },
      { kind: 'prompt', label: '回到此刻', detail: '慢慢睁眼，动动手指。今天也很不容易。', seconds: 40, voice: 'scan-6' },
    ],
  },
  grounding: {
    id: 'grounding',
    title: '五感落地',
    subtitle: '用看见、摸到、听见，把自己带回这个房间。',
    scene: 'ground',
    ambient: 'none',
    introVoice: 'intro-ground',
    phases: [
      { kind: 'prompt', label: '看见 5 样东西', detail: '看清它们的颜色就好。', seconds: 30, voice: 'ground-1' },
      { kind: 'prompt', label: '摸到 4 样东西', detail: '桌面、衣角、椅背，感受温度。', seconds: 30, voice: 'ground-2' },
      { kind: 'prompt', label: '听见 3 种声音', detail: '近处、远处，各有什么。', seconds: 30, voice: 'ground-3' },
      { kind: 'prompt', label: '闻到 2 种气味', detail: '闻不到也没关系，注意呼吸就好。', seconds: 30, voice: 'ground-4' },
      { kind: 'prompt', label: '尝到 1 种味道', detail: '喝一口水，感受口腔里的感觉。', seconds: 30, voice: 'ground-5' },
    ],
  },
}

export function scriptById(id: string | undefined): GuideScript {
  return GUIDE_SCRIPTS[id || ''] ?? GUIDE_SCRIPTS['breath-box']
}

export function scriptForIntervention(item: { title: string; category: string }): GuideScript {
  const title = item.title || ''
  if (title.includes('4-7-8')) return GUIDE_SCRIPTS['breath-478']
  if (title.includes('扫描')) return GUIDE_SCRIPTS['body-scan']
  if (title.includes('五感') || title.includes('落地')) return GUIDE_SCRIPTS.grounding
  if (title.includes('四拍') || title.includes('腹式呼吸')) return GUIDE_SCRIPTS['breath-box']
  if (item.category === '呼吸放松') return GUIDE_SCRIPTS['breath-box']
  if (item.category === '冥想练习') return GUIDE_SCRIPTS['body-scan']
  return GUIDE_SCRIPTS.grounding
}

/**
 * 减压卡片的按钮文案。
 * 只有按标题命中了具体课时才报课名；音乐、视频这类还没有专属引导课的条目，
 * 一律「开始练习」，避免卡片写「音乐疗愈」、按钮却写「开始 · 4-7-8 放松呼吸」的错配。
 */
export function ctaForIntervention(item: { title: string; category: string }): string {
  const title = item.title || ''
  const matched =
    title.includes('4-7-8') ||
    title.includes('扫描') ||
    title.includes('五感') ||
    title.includes('落地') ||
    title.includes('四拍') ||
    title.includes('腹式呼吸')
  return matched ? `开始 · ${scriptForIntervention(item).title}` : '开始练习'
}

export function scriptSeconds(script: GuideScript): number {
  return script.phases.reduce((sum, phase) => sum + phase.seconds, 0)
}

interface SessionHandlers {
  onPhase?: (phase: GuidePhase, index: number) => void
  onEnd?: () => void
}

/**
 * 时间线：日期驱动而不是简单自减，切后台再回来也不会走偏。
 * 只暴露「当前阶段 / 剩余秒数 / 暂停」，动画与音频由调用方订阅。
 */
export function useGuideSession(script: GuideScript, handlers: SessionHandlers = {}, active = true) {
  const [index, setIndex] = useState(0)
  const [remaining, setRemaining] = useState(script.phases[0]?.seconds ?? 0)
  const [paused, setPaused] = useState(false)
  const [done, setDone] = useState(false)
  const startedAt = useRef(Date.now())
  const pauseAt = useRef(0)
  const elapsedBefore = useRef(0)
  const firedIndex = useRef(0)
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  const phase = script.phases[index]

  useEffect(() => {
    if (!active) return
    startedAt.current = Date.now()
    elapsedBefore.current = 0
    pauseAt.current = 0
    firedIndex.current = 0
    handlersRef.current.onPhase?.(script.phases[0], 0)
    const timer = setInterval(() => {
      if (pauseAt.current) return
      const elapsed = elapsedBefore.current + (Date.now() - startedAt.current) / 1000
      let acc = 0
      let nextIndex = script.phases.length - 1
      for (let i = 0; i < script.phases.length; i++) {
        acc += script.phases[i].seconds
        if (elapsed < acc) {
          nextIndex = i
          break
        }
      }
      const offset = acc - script.phases[nextIndex].seconds
      const left = Math.max(0, Math.ceil(script.phases[nextIndex].seconds - (elapsed - offset)))
      setIndex(nextIndex)
      setRemaining(left)
      if (nextIndex !== firedIndex.current) {
        firedIndex.current = nextIndex
        handlersRef.current.onPhase?.(script.phases[nextIndex], nextIndex)
      }
      if (elapsed >= scriptSeconds(script)) {
        setDone(true)
        clearInterval(timer)
        handlersRef.current.onEnd?.()
      }
    }, 200)
    return () => clearInterval(timer)
    // script / 开始状态变化才重开一局
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [script, active])

  const pause = useCallback(() => {
    if (pauseAt.current) return
    pauseAt.current = Date.now()
    elapsedBefore.current += (Date.now() - startedAt.current) / 1000
    setPaused(true)
  }, [])

  const resume = useCallback(() => {
    if (!pauseAt.current) return
    pauseAt.current = 0
    startedAt.current = Date.now()
    setPaused(false)
  }, [])

  const elapsedSeconds = Math.min(
    scriptSeconds(script),
    script.phases.slice(0, index).reduce((sum, p) => sum + p.seconds, 0) + (phase ? phase.seconds - remaining : 0)
  )

  return {
    phase,
    index,
    remaining,
    paused,
    done,
    elapsedSeconds,
    pause,
    resume,
    progress: Math.min(1, (index + (phase ? 1 - remaining / phase.seconds : 0)) / script.phases.length),
    totalSeconds: scriptSeconds(script),
  }
}
