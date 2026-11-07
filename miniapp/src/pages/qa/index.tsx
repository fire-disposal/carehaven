import { useCallback, useMemo, useRef, useState } from 'react'
import { Input, ScrollView, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { Button, Card, Pill, SectionHeader, StateBlock } from '@/components/ui'
import Icon from '@/components/Icon'
import BottomNav from '@/components/BottomNav'
import { THEME } from '@/lib/theme'
import { ApiError, api, isLoggedIn, type AgentStatus, type KbEntry, type QaSession } from '@/lib/api'
import './index.scss'

/** 一次问答的等待上限：超时后气泡内给出「重试」，不让用户对着空白气泡等下去 */
const ASK_TIMEOUT = 15000
/** 与后端 /api/zz/ask 的长度校验保持一致 */
const MAX_QUESTION = 200
const ALL_CATEGORY = '全部'
const UNKNOWN_CATEGORY = '未分类'

// 快捷问题：措辞已逐条在实际知识库中验证过，点下去都能命中对应条目
const QUICK_QUESTIONS = [
  '晚上不睡觉',
  '拒绝洗澡',
  '动手打人',
  '患者走失了怎么办',
  '吃不下饭',
  '总是重复问同一件事',
  '我自己撑不住了',
]

// ---- 图谱几何 ----------------------------------------------------------------
// 画布按「可用宽度」等比缩放：中心节点 + 一圈分类节点，半径由图元尺寸推出来，
// 而不是写死一个 600rpx 的画布再让它横向溢出（390px 屏只有约 686rpx 可用）。
const KG_NODE_W = 128 // 分类节点参照宽（设计稿单位，与 .kg-node min-width 一致）
const KG_NODE_H = 100 // 分类节点参照高（同上，与 min-height 一致）
const KG_CENTER = 152 // 中心圆直径参照值（与 .kg-node--center 一致）
/** 连线离圆心的可视角：用来保证线不会穿过中心节点的字 */
const KG_LINE_START = 58
/** 节点边缘与画布边框之间留的空，给 pressable 缩放下沉留余量 */
const KG_PAD = 12
/** 给 ScrollView 的溢出判据留一点余量，免得画布刚好卡在临界值上抖出横向滚动 */
const KG_SCROLLBAR = 8

const sceneWidth = (): number => {
  try {
    return Taro.getSystemInfoSync().windowWidth || 375
  } catch (e) {
    return 375
  }
}

// 设计稿单位 → 真实像素：字号与触控尺寸必须用 px 才能保底，画布坐标反过来要跟屏宽等比。
// 模块级算一次即可，页面固定竖屏、不跟随旋转。
const RPX = sceneWidth() / 750

interface GraphNode {
  name: string
  count: number
  left: number
  top: number
  /** 连线长度，从中心节点边缘之外起步 */
  line: number
  deg: number
}

interface GraphLayout {
  width: number
  height: number
  center: number
  nodes: GraphNode[]
}

/**
 * 半径由「节点自身尺寸」反推：分类节点外接圆半径 r = hypot(w, h) / 2，
 * 再按角度间距算相邻节点不重叠所需半径，然后把整体压进可用宽度。
 */
function layoutGraph(names: string[], counts: number[], availWidth: number): GraphLayout {
  const count = names.length
  const radius = Math.min(Math.hypot(KG_NODE_W, KG_NODE_H) / 2, KG_NODE_H / 2)
  let ring = KG_CENTER / 2 + radius + 28
  if (count > 1) {
    const step = (2 * Math.PI) / count
    ring = Math.max(ring, radius / Math.sin(step / 2) + 10)
  }
  // 左右各留 r + KG_PAD，否则转过 90° 的节点会被裁掉一半
  const limit = Math.max(KG_CENTER / 2 + 48, availWidth / 2 - radius - KG_PAD)
  ring = Math.min(ring, limit)
  const size = Math.ceil(Math.max(KG_CENTER + 2 * KG_PAD, (ring + radius + KG_PAD) * 2))
  const center = size / 2
  const start = count % 2 === 1 ? -90 : -180 / count - 90
  return {
    width: size,
    height: size,
    center,
    nodes: names.map((name, index) => {
      const deg = start + (360 / count) * index
      const rad = (deg * Math.PI) / 180
      return {
        name,
        count: counts[index] ?? 0,
        left: center + ring * Math.cos(rad),
        top: center + ring * Math.sin(rad),
        line: ring - KG_LINE_START,
        deg,
      }
    }),
  }
}

/** 条目摘要：正文去掉换行与多余空白，卡片收起时只露两行 */
function entrySummary(entry: KbEntry): string {
  const content = String(entry.content ?? '')
  if (!content) return '这条内容暂时没有正文，展开也看不到更多。'
  return content.replace(/\s+/g, ' ').trim()
}

interface Source {
  id: string
  title: string
  category: string
}

/** 一轮问答：用户问题 + 对应的回答气泡 */
interface Turn {
  id: string
  question: string
  answer: string
  /**
   * 来源条目。实时回答只带标题与分类，自建历史记录能对出正文；
   * 渲染时再按标题回填知识库正文，这样新老两种记录共用一套展开逻辑。
   */
  sources: Source[]
  /** 历史记录里只在正文中留下标题：渲染时据此回填 */
  sourceTitles?: string[]
  status: 'pending' | 'ok' | 'error'
  error: string
  created: string
  /** 服务端问答记录 id（拿到才允许提交有用性反馈） */
  sessionId?: string
  helpful?: 'up' | 'down'
  /** 助手元信息：用了哪些工具、token 与是否为回退 */
  meta?: {
    tools: string[]
    model: string
    fallback?: boolean
    safety?: boolean
  }
}

interface KbGroup {
  category: string
  items: KbEntry[]
}

/** 给请求加超时保护：超时按失败处理，走气泡内的重试路径 */
function withTimeout<T>(task: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('查找超时了，请检查网络后重试')), ms)
    task.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (reason) => {
        clearTimeout(timer)
        reject(reason)
      }
    )
  })
}

function normalizeSources(list: Source[] | undefined): Source[] {
  if (!Array.isArray(list)) return []
  const out: Source[] = []
  for (const item of list) {
    if (!item || !item.title) continue
    out.push({
      id: typeof item.id === 'string' ? item.id : '',
      title: item.title,
      category: typeof item.category === 'string' ? item.category : '',
    })
  }
  return out
}

/** PocketBase 的 created 形如 "2025-10-15 12:34:56.789Z" */
function parseDate(value: string): Date | null {
  if (!value) return null
  const date = new Date(value.replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? null : date
}

function dayLabel(date: Date): string {
  const now = new Date()
  if (now.toDateString() === date.toDateString()) return '今天'
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (yesterday.toDateString() === date.toDateString()) return '昨天'
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`
}

function clockLabel(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

/** 同一天只在第一条消息前显示一次日期分隔 */
function dayStamp(turn: Turn, previous: Turn | undefined): string {
  const date = parseDate(turn.created)
  if (!date) return ''
  const prev = previous ? parseDate(previous.created) : null
  if (prev && prev.toDateString() === date.toDateString()) return ''
  return `${dayLabel(date)} ${clockLabel(date)}`
}

/** 历史记录只存了回答正文，可由正文里出现的【条目标题】与知识库对上来源 */
function deriveSourceTitles(answer: string, entries: KbEntry[]): string[] {
  if (!answer) return []
  return entries
    .filter((entry) => !!entry && !!entry.title && answer.indexOf(entry.title) >= 0)
    .sort((a, b) => answer.indexOf(a.title) - answer.indexOf(b.title))
    .map((entry) => entry.title)
}

function toTurn(item: QaSession, index: number, entries: KbEntry[]): Turn {
  const answer = String(item.answer ?? '')
  return {
    id: `h${index}-${String(item.id ?? '')}`,
    question: String(item.question ?? ''),
    answer,
    sources: [],
    sourceTitles: deriveSourceTitles(answer, entries),
    status: answer.trim() ? 'ok' : 'error',
    error: '这条历史记录没有保存下回答内容，可以重新提问。',
    created: String(item.created ?? ''),
    // 历史记录同样可以补反馈
    sessionId: item.id,
    helpful: item.helpful === 'up' || item.helpful === 'down' ? item.helpful : undefined,
  }
}

const TOOL_LABELS: Record<string, string> = {
  get_today_status: '今日状态',
  list_recent_checkins: '最近打卡',
  list_recent_assessments: '量表结果',
  get_trend: '压力趋势',
  search_kb: '知识库',
}

function toolLabel(name: string): string {
  return TOOL_LABELS[name] || name
}

export default function QaPage() {
  const [mode, setMode] = useState<'chat' | 'kb' | 'graph'>('chat')
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [booting, setBooting] = useState(true)
  const [agent, setAgent] = useState<AgentStatus | null>(null)
  const conversationRef = useRef('')
  const [chatError, setChatError] = useState('')
  const [entries, setEntries] = useState<KbEntry[]>([])
  const [kbError, setKbError] = useState('')
  const [category, setCategory] = useState(ALL_CATEGORY)
  const [openSource, setOpenSource] = useState('')
  const [openEntry, setOpenEntry] = useState('')
  const [graphCategory, setGraphCategory] = useState('')
  const [graphEntry, setGraphEntry] = useState('')
  const [query, setQuery] = useState('')
  const [anchorTick, setAnchorTick] = useState(0)
  const seq = useRef(0)
  /**
   * 输入框要不要立刻弹键盘。H5 上带焦点重绘 = 直接聚焦（浏览器只允许在用户手势里这么做，
   * 而发送/点 chip 本身就是手势）；小程序里 focus 属性是「拉起键盘」的一次性信号，
   * 所以挂载时给 false，之后每次发送才抬成 true，页面别处重渲染也不会重新弹键盘。
   */
  const [composerFocus, setComposerFocus] = useState(false)

  // 锚点 id 每次变化都会把滚动视图带到目标位置：问答看最新一条，知识库回到列表顶部
  const anchor =
    mode === 'kb' ? `kb-anchor-${anchorTick}` : mode === 'chat' ? `qa-anchor-${anchorTick}` : `graph-anchor-${anchorTick}`

  const categories = useMemo(() => {
    const list: string[] = []
    for (const entry of entries) {
      const name = String(entry.category ?? '').trim() || UNKNOWN_CATEGORY
      if (list.indexOf(name) < 0) list.push(name)
    }
    return list
  }, [entries])

  /** 搜索词按空白拆成多段，每段都要命中；大小写不敏感，标题/摘要/正文/关键词/来源一起搜 */
  const searchTerms = useMemo(
    () =>
      query
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean),
    [query]
  )

  /** 命中的条目：过滤后保留知识库里的原始序号，列表键与「第 n / 共 m 条」都还指向同一条 */
  const matched = useMemo(() => {
    if (searchTerms.length === 0) return entries.map((entry, index) => ({ entry, index }))
    const hits: { entry: KbEntry; index: number; score: number }[] = []
    entries.forEach((entry, index) => {
      const title = String(entry.title ?? '').toLowerCase()
      const body = [title, entry.content, entry.keywords, entry.source]
        .map((value) => String(value ?? '').toLowerCase())
        .join('\n')
      if (!searchTerms.every((term) => body.indexOf(term) >= 0)) return
      // 标题命中排在前面，其余按知识库顺序，避免搜索结果每次检索都跳来跳去
      hits.push({ entry, index, score: searchTerms.filter((term) => title.indexOf(term) >= 0).length })
    })
    return hits
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map((hit) => ({ entry: hit.entry, index: hit.index }))
  }, [entries, searchTerms])

  const groups = useMemo(() => {
    const result: KbGroup[] = []
    for (const { entry } of matched) {
      const name = String(entry.category ?? '').trim() || UNKNOWN_CATEGORY
      if (category !== ALL_CATEGORY && name !== category) continue
      const group = result.find((item) => item.category === name)
      if (group) group.items.push(entry)
      else result.push({ category: name, items: [entry] })
    }
    return result
  }, [matched, category])

  const shownCount = useMemo(() => groups.reduce((sum, group) => sum + group.items.length, 0), [groups])
  const kbReady = entries.length > 0

  const load = useCallback(async () => {
    if (!isLoggedIn()) {
      Taro.reLaunch({ url: '/pages/login/index' })
      return
    }
    setBooting(true)
    setChatError('')
    // 知识库挂了不该连带把问答记录也判定为失败，所以两条请求分别结算
    const [history, knowledge, agentState] = await Promise.allSettled([
      api.qaHistory(30),
      api.knowledge(),
      api.agentStatus(),
    ])
    if (agentState.status === 'fulfilled') setAgent(agentState.value)
    else setAgent(null)

    const kbList = knowledge.status === 'fulfilled' && Array.isArray(knowledge.value) ? knowledge.value : []
    if (knowledge.status === 'fulfilled') {
      setEntries(kbList)
      setKbError('')
    } else {
      setKbError(
        knowledge.reason instanceof Error && knowledge.reason.message
          ? knowledge.reason.message
          : '知识库加载失败，请稍后重试'
      )
    }

    if (history.status === 'fulfilled') {
      const list = Array.isArray(history.value) ? history.value : []
      setTurns(
        list
          .slice()
          .reverse()
          .map((item, index) => toTurn(item, index, kbList))
      )
    } else {
      setChatError(
        history.reason instanceof Error && history.reason.message
          ? history.reason.message
          : '问答记录加载失败，请稍后重试'
      )
    }

    setBooting(false)
    setAnchorTick((tick) => tick + 1)
  }, [])

  useDidShow(() => {
    void load()
  })

  const runAsk = useCallback(async (turnId: string, question: string) => {
    setTurns((prev) =>
      prev.map((turn) => (turn.id === turnId ? { ...turn, status: 'pending', answer: '', sources: [], error: '' } : turn))
    )
    try {
      if (agent && agent.enabled) {
        try {
          const res = await withTimeout(api.agentChat(question, conversationRef.current), ASK_TIMEOUT)
          conversationRef.current = res.conversationId
          setAgent((prev) =>
            prev && typeof res.remaining_requests === 'number'
              ? { ...prev, remaining_requests: res.remaining_requests }
              : prev
          )
          setTurns((prev) =>
            prev.map((turn) =>
              turn.id === turnId
                ? {
                    ...turn,
                    status: 'ok',
                    answer: res.answer,
                    sources: [],
                    sessionId: res.id,
                    meta: {
                      tools: (res.tools || []).map((t) => t.name),
                      model: res.model,
                      safety: res.safety,
                    },
                  }
                : turn
            )
          )
          return
        } catch (err) {
          const status = err instanceof ApiError ? err.status : 0
          const recoverable = status === 429 || status === 502 || status === 503
          if (!recoverable) throw err
          // 额度用完或上游不可用：回退检索，并在气泡上标注
          const note = err instanceof Error ? err.message : '助手暂不可用'
          Taro.showToast({ title: note, icon: 'none' })
        }
      }

      const result = await withTimeout(api.ask(question), ASK_TIMEOUT)
      const answer = typeof result?.answer === 'string' ? result.answer.trim() : ''
      if (!answer) throw new Error('没有取到回答内容，请重试')
      setTurns((prev) =>
        prev.map((turn) =>
          turn.id === turnId
            ? {
                ...turn,
                status: 'ok',
                answer,
                sources: normalizeSources(result?.sources),
                sessionId: result?.id,
                helpful: undefined,
                meta: { tools: [], model: 'kb', fallback: Boolean(agent && agent.enabled) },
              }
            : turn
        )
      )
    } catch (e) {
      const message = e instanceof Error && e.message ? e.message : '没能取到回答，请检查网络后重试'
      setTurns((prev) =>
        prev.map((turn) => (turn.id === turnId ? { ...turn, status: 'error', error: message } : turn))
      )
    } finally {
      setAnchorTick((tick) => tick + 1)
    }
  }, [agent])

  const markHelpful = useCallback(async (turn: Turn, value: 'up' | 'down') => {
    if (!turn.sessionId) return
    try {
      await api.markAnswerHelpful(turn.sessionId, value)
      setTurns((prev) =>
        prev.map((item) => (item.id === turn.id ? { ...item, helpful: value } : item))
      )
      Taro.showToast({ title: value === 'up' ? '已记下，谢谢' : '已记下，我们会改进', icon: 'none' })
    } catch (e) {
      Taro.showToast({ title: e instanceof Error ? e.message : '反馈没能提交', icon: 'none' })
    }
  }, [])

  function send(raw: string) {
    const question = raw.trim()
    if (!question) {
      Taro.showToast({ title: '请先输入您想问的问题', icon: 'none' })
      return
    }
    seq.current += 1
    const id = `t${Date.now()}-${seq.current}`
    setTurns((prev) => [
      ...prev,
      {
        id,
        question,
        answer: '',
        sources: [],
        status: 'pending',
        error: '',
        created: new Date().toISOString(),
      },
    ])
    // 发完这句话接着问下一句：清空输入框并把焦点留在原地
    setDraft('')
    setComposerFocus(true)
    setAnchorTick((tick) => tick + 1)
  }

  /** 知识库搜索无结果时把关键词带到助手：切 tab + 填进输入框 + 聚焦，用户按发送即可 */
  function askWithQuery() {
    const keyword = query.trim()
    setDraft(keyword)
    setMode('chat')
    setComposerFocus(true)
    setAnchorTick((tick) => tick + 1)
  }

  function switchMode(next: 'chat' | 'kb' | 'graph') {
    setMode(next)
    if (next !== 'chat') setComposerFocus(false)
    setAnchorTick((tick) => tick + 1)
  }

  // 来源行：整行都是按钮，收起时露两行摘要，展开后是全文。列表里显式的「收起」让人知道还能再点。
  // 实时回答只带回标题与分类，正文按标题回知识库里取；取不到就退化成说明文字。
  function renderSource(turn: Turn, source: Source, order: number) {
    const key = `${turn.id}:${source.id || source.title}`
    const open = openSource === key
    const entry = entries.find(
      (item) => (source.id && item.id === source.id) || (!!source.title && item.title === source.title)
    )
    return (
      <View
        className={`src-item${open ? ' open' : ''}`}
        key={key}
        ariaRole="button"
        ariaLabel={`来源 ${order}：${source.title}，${open ? '收起' : '展开'}全文`}
        onClick={() => setOpenSource(open ? '' : key)}
      >
        <View className="src-head">
          <View className="src-order">
            <Text className="src-order-text">{order}</Text>
          </View>
          <Text className="src-title">{source.title}</Text>
          <Icon name="chevron-down" size={24} className={`src-caret${open ? ' open' : ''}`} color={THEME.primary} />
        </View>
        <View className="src-cats">
          {source.category ? <Pill tone="primary">{source.category}</Pill> : null}
          {entry && entry.source ? <Pill tone="quiet">{entry.source}</Pill> : null}
        </View>
        {open ? (
          <View className="src-body">
            {entry ? (
              <>
                <Text className="src-content">{String(entry.content ?? '')}</Text>
                {entry.keywords ? <Text className="src-from">关键词：{entry.keywords}</Text> : null}
              </>
            ) : (
              <Text className="src-content">这条内容的全文暂时取不到，可以切到「知识库」按分类查看。</Text>
            )}
          </View>
        ) : entry ? (
          <Text className="src-teaser">{entrySummary(entry)}</Text>
        ) : (
          <Text className="src-teaser">这篇原文没有随回答带回来，展开也取不到正文时可以到「知识库」里找。</Text>
        )}
      </View>
    )
  }

  // 首屏：图标 + 标题 + 说明 + 两列常见问题。空态不是「什么都没有」，而是直接给出能点的入口。
  function renderChatEmpty() {
    return (
      <View className="qa-hero">
        <View className="qa-hero-mark">
          <Icon name="comment-dots" size={56} color={THEME.primary} />
        </View>
        <Text className="qa-hero-title">问一个照护问题</Text>
        <Text className="qa-hero-desc">
          说清当下的情况，比如时间、行为和您已经试过的办法。回答会检索照护知识库并列出出处。
        </Text>

        <Text className="qa-hero-caption">常见问题</Text>
        <View className="qa-hero-grid">
          {QUICK_QUESTIONS.map((item) => (
            <View
              className="qa-hero-chip"
              key={item}
              ariaRole="button"
              ariaLabel={`提问：${item}`}
              onClick={() => send(item)}
            >
              <Text className="qa-hero-chip-text">{item}</Text>
              <Icon name="arrow-right" size={24} color={THEME.muted} />
            </View>
          ))}
        </View>
      </View>
    )
  }

  /** 历史记录只留了正文标题，按标题回知识库补分类 */
  function displaySources(turn: Turn): Source[] {
    if (turn.sources.length > 0) return turn.sources
    return (turn.sourceTitles || []).map((title) => {
      const entry = entries.find((item) => item.title === title)
      return { id: entry ? entry.id : '', title, category: entry ? String(entry.category ?? '') : '' }
    })
  }

  function renderChat() {
    if (booting) {
      return <StateBlock variant="loading" title="正在读取问答记录…" />
    }
    const empty = turns.length === 0
    return (
      <View className="qa-thread">
        {chatError ? (
          <StateBlock
            variant="error"
            title={chatError}
            actionLabel="重新加载"
            onAction={() => void load()}
          />
        ) : null}

        {empty ? renderChatEmpty() : null}

        {!empty ? (
          <View className="qa-suggest-block">
            <Text className="qa-suggest-title">继续提问</Text>
            <ScrollView className="qa-suggest-scroll" scrollX enableFlex>
              <View className="qa-suggest-row">
                {QUICK_QUESTIONS.map((item) => (
                  <View
                    className="qa-suggest-chip"
                    key={item}
                    ariaRole="button"
                    ariaLabel={`提问：${item}`}
                    onClick={() => send(item)}
                  >
                    <Text className="qa-suggest-chip-text">{item}</Text>
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>
        ) : null}

        {turns.map((turn, index) => {
          const stamp = dayStamp(turn, turns[index - 1])
          return (
            <View key={turn.id}>
              {stamp ? (
                <View className="day-stamp">
                  <Text className="day-stamp-text">{stamp}</Text>
                </View>
              ) : null}

              <View className="msg-row msg-row-user">
                <View className="bubble bubble-user">
                  <Text className="bubble-text">{turn.question}</Text>
                </View>
              </View>

              <View className="msg-row msg-row-ai">
                {turn.status === 'pending' ? (
                  <View className="bubble bubble-ai bubble-pending" ariaRole="status" ariaLabel="正在检索知识库">
                    <View className="dots">
                      <View className="dot" />
                      <View className="dot" />
                      <View className="dot" />
                    </View>
                    <Text className="pending-text">正在检索知识库…</Text>
                  </View>
                ) : null}

                {turn.status === 'error' ? (
                  <View className="bubble bubble-ai bubble-error">
                    <View className="bubble-error-text inline-alert" ariaRole="alert">
                      <Icon name="triangle-exclamation" size={28} color={THEME.red} />
                      <Text>{turn.error || '没能取到回答'}</Text>
                    </View>
                    <View
                      className="retry-btn"
                      ariaRole="button"
                      ariaLabel="重试这个问题"
                      onClick={() => void runAsk(turn.id, turn.question)}
                    >
                      <Text className="retry-btn-text">重试</Text>
                    </View>
                  </View>
                ) : null}

                {turn.status === 'ok' ? (
                  <View className="bubble bubble-ai">
                    <Text className="bubble-text">
                      {turn.answer.replace(/\n[ \t]*(?=\n)/g, '')}
                    </Text>
                    {displaySources(turn).length > 0 ? (
                      <View className="src-list">
                        <Text className="src-caption">
                          来源 {displaySources(turn).length} 条 · 点一行看全文
                        </Text>
                        {displaySources(turn).map((source, order) => renderSource(turn, source, order + 1))}
                      </View>
                    ) : kbReady && !turn.meta ? (
                      <Text className="src-note">
                        这次没有匹配到知识库条目。可以换个说法再问，或到「知识库」里逐条浏览。
                      </Text>
                    ) : null}

                    {turn.meta && (turn.meta.tools.length > 0 || turn.meta.fallback) ? (
                      <View className="qa-meta">
                        {turn.meta.tools.length > 0 ? (
                          <Text className="qa-meta-text">
                            已读取：{turn.meta.tools.map(toolLabel).join('、')}
                          </Text>
                        ) : (
                          <Text className="qa-meta-text">助手暂时不可用，本条为知识库检索结果</Text>
                        )}
                      </View>
                    ) : null}

                    {turn.sessionId ? (
                      <View className="qa-helpful">
                        <Text className="qa-helpful-label">
                          {turn.helpful ? '已记录这条反馈' : '这个回答对您有帮助吗'}
                        </Text>
                        <View
                          className={`qa-helpful-btn${turn.helpful === 'up' ? ' on' : ''}`}
                          ariaRole="button"
                          ariaLabel="这个回答有帮助"
                          onClick={() => void markHelpful(turn, 'up')}
                        >
                          <Icon
                            name="thumbs-up"
                            size={28}
                            color={turn.helpful === 'up' ? THEME.onPrimaryContainer : THEME.ink2}
                          />
                          <Text className="qa-helpful-text">有用</Text>
                          <Icon
                            name={turn.helpful === 'up' ? 'circle-check' : 'circle-question'}
                            size={24}
                            color={turn.helpful === 'up' ? THEME.onPrimaryContainer : THEME.muted}
                          />
                        </View>
                        <View
                          className={`qa-helpful-btn${turn.helpful === 'down' ? ' on' : ''}`}
                          ariaRole="button"
                          ariaLabel="这个回答没帮助"
                          onClick={() => void markHelpful(turn, 'down')}
                        >
                          <Icon
                            name="face-meh"
                            size={28}
                            color={turn.helpful === 'down' ? THEME.onPrimaryContainer : THEME.ink2}
                          />
                          <Text className="qa-helpful-text">没用</Text>
                          <Icon
                            name={turn.helpful === 'down' ? 'circle-check' : 'circle-question'}
                            size={24}
                            color={turn.helpful === 'down' ? THEME.onPrimaryContainer : THEME.muted}
                          />
                        </View>
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </View>
            </View>
          )
        })}

        <View className="qa-anchor" id={anchor} />
      </View>
    )
  }

  function renderGraph() {
    if (booting) return <StateBlock variant="loading" title="正在整理知识图谱…" />
    if (kbError && !kbReady) {
      return (
        <StateBlock
          variant="error"
          title={kbError}
          actionLabel="重新加载"
          onAction={() => void load()}
        />
      )
    }
    if (categories.length === 0) {
      return <StateBlock variant="empty" icon="book-open" title="知识库还没有内容" desc="内容补充后，这里会按分类展开。" />
    }

    // 画布宽度按「屏宽 - 页面留白 - 滚动条」算，再等比缩进去；左对齐 + 负边距把画布边距借回来，
    // 否则 390px 屏上 600rpx 的固定画布会横向溢出。
    const avail = Math.max(220, sceneWidth() - 2 * 32 * RPX - KG_SCROLLBAR)
    const counts = categories.map((name) => {
      const group = groups.find((item) => item.category === name)
      return group ? group.items.length : 0
    })
    const layout = layoutGraph(categories, counts, avail)
    const centerNode = layout.nodes.find((node) => node.name === graphCategory)
    const centerEntries = graphCategory
      ? entries.filter((entry) => (String(entry.category ?? '').trim() || UNKNOWN_CATEGORY) === graphCategory)
      : []
    const maxCount = counts.reduce((max, value) => Math.max(max, value), 1)

    return (
      <View className="kg">
        <View className="qa-anchor" id={`graph-anchor-${anchorTick}`} />
        <View className="kg-head">
          <SectionHeader
            title="知识图谱"
            eyebrow="照护知识库"
            action={
              <Text className="muted">
                {categories.length} 个分类 · {entries.length} 条
              </Text>
            }
          />
        </View>

        <ScrollView className="kg-scroll" scrollX={layout.width > avail} enableFlex>
          <View className="kg-stage" style={{ width: `${layout.width}px` }}>
            <View
              className="kg-canvas"
              style={{ width: `${layout.width}px`, height: `${layout.height}px` }}
            >
              {layout.nodes.map((node, index) => (
                <View
                  key={`line-${node.name}`}
                  className={`kg-line${graphCategory === node.name ? ' on' : ''}`}
                  style={{
                    left: `${layout.center}px`,
                    top: `${layout.center}px`,
                    width: `${node.line}px`,
                    transform: `rotate(${node.deg}deg)`,
                    animationDelay: `${index * 40}ms`,
                  }}
                />
              ))}

              {/* 圆点放在连线终点：让「线指向节点」而不是插进节点 */}
              {layout.nodes.map((node) => (
                <View
                  key={`dot-${node.name}`}
                  className={`kg-dot${graphCategory === node.name ? ' on' : ''}`}
                  style={{
                    left: `${layout.center + node.line * Math.cos((node.deg * Math.PI) / 180)}px`,
                    top: `${layout.center + node.line * Math.sin((node.deg * Math.PI) / 180)}px`,
                  }}
                />
              ))}

              <View
                className="kg-node kg-node--center"
                style={{ left: `${layout.center}px`, top: `${layout.center}px` }}
                ariaRole="status"
                ariaLabel={`知识库共 ${entries.length} 条，${categories.length} 个分类`}
              >
                <Text className="kg-center-title">知识库</Text>
                <Text className="kg-center-count">{entries.length} 条</Text>
              </View>

              {layout.nodes.map((node, index) => {
                const on = graphCategory === node.name
                // 字号只做轻微加权：16→19px，避免条目多的分类把卡片撑得和别的不一样大
                const weight = Math.round(16 + (node.count / maxCount) * 3)
                return (
                  <View
                    key={node.name}
                    className={`kg-node${on ? ' on' : ''}`}
                    style={{
                      left: `${node.left}px`,
                      top: `${node.top}px`,
                      fontSize: `${weight}px`,
                      animationDelay: `${index * 40}ms`,
                    }}
                    onClick={() => {
                      setGraphCategory(on ? '' : node.name)
                      setGraphEntry('')
                      setAnchorTick((tick) => tick + 1)
                    }}
                    ariaRole="button"
                    ariaLabel={`查看分类：${node.name}，${node.count} 条${on ? '，已展开' : ''}`}
                  >
                    <Text className="kg-node-title">{node.name}</Text>
                    <Text className="kg-node-count">{node.count} 条</Text>
                  </View>
                )
              })}
            </View>
          </View>
        </ScrollView>

        <Text className="kg-hint">
          {graphCategory
            ? `已选中「${graphCategory}」，共 ${centerEntries.length} 条`
            : '点一个分类，看里面的条目'}
        </Text>

        {centerNode ? (
          <View className="kg-panel">
            <View className="kg-panel-head">
              <View className="kg-panel-title-wrap">
                <Text className="kg-panel-title">{graphCategory}</Text>
                <Text className="kg-panel-count">{centerEntries.length} 条</Text>
              </View>
              <View
                className="kg-panel-close"
                ariaRole="button"
                ariaLabel="收起分类列表"
                onClick={() => {
                  setGraphCategory('')
                  setGraphEntry('')
                }}
              >
                <Text className="kg-panel-close-text">收起列表</Text>
              </View>
            </View>

            <Card flush className="kg-panel-body">
              {centerEntries.map((entry) => {
                const open = graphEntry === String(entry.id)
                return (
                  <View className={`kg-entry${open ? ' open' : ''}`} key={entry.id}>
                    <View
                      className="kg-entry-head"
                      onClick={() => setGraphEntry(open ? '' : String(entry.id))}
                      ariaRole="button"
                      ariaLabel={`${String(entry.title || '')}，${open ? '收起' : '展开'}全文`}
                    >
                      <Text className="kg-entry-title">{String(entry.title || '')}</Text>
                      <Icon
                        name="chevron-down"
                        size={24}
                        className={`kg-entry-caret${open ? ' open' : ''}`}
                        color={THEME.primary}
                      />
                    </View>
                    <Text className="kg-entry-text">{entrySummary(entry)}</Text>
                    {open ? (
                      <View className="kg-entry-body">
                        <Text className="kg-entry-full">{String(entry.content || '')}</Text>
                        {entry.source ? <Text className="kg-entry-from">来源：{entry.source}</Text> : null}
                      </View>
                    ) : null}
                  </View>
                )
              })}
            </Card>
          </View>
        ) : null}
      </View>
    )
  }

  function renderKnowledge() {
    if (booting) {
      return <StateBlock variant="loading" title="正在读取知识库…" />
    }
    if (kbError && !kbReady) {
      return (
        <StateBlock
          variant="error"
          title={kbError}
          actionLabel="重新加载知识库"
          onAction={() => void load()}
        />
      )
    }
    if (!kbReady) {
      return (
        <StateBlock
          variant="empty"
          icon="book-open"
          title="知识库暂时没有内容"
          desc="内容补充后会显示在这里，您也可以切回问答直接提问。"
        />
      )
    }
    const searching = searchTerms.length > 0
    return (
      <View className="kb-wrap">
        <View className="qa-anchor" id={`kb-anchor-${anchorTick}`} />
        {kbError ? (
          <StateBlock
            variant="error"
            compact
            title={kbError}
            actionLabel="重新加载"
            onAction={() => void load()}
          />
        ) : null}

        <View className="kb-search">
          <Icon name="magnifying-glass" size={32} color={THEME.muted} />
          <Input
            className="kb-search-input"
            ariaLabel="搜索知识库"
            value={query}
            placeholder="搜索标题、摘要或正文"
            placeholderStyle={`color:${THEME.muted}`}
            confirmType="search"
            onInput={(e) => setQuery(e.detail.value)}
          />
          {query ? (
            <View
              className="kb-search-clear"
              ariaRole="button"
              ariaLabel="清空搜索"
              onClick={() => setQuery('')}
            >
              <Icon name="circle-xmark" size={32} color={THEME.muted} />
            </View>
          ) : null}
        </View>

        <View className="kb-count-row">
          <Text className="kb-count">
            {searching ? `「${query.trim()}」命中 ${matched.length} 条` : `共 ${entries.length} 条`}
          </Text>
          {/* 右侧是「当前筛选下实际显示的条数」，搜索与分类两重过滤同时生效时也能对账 */}
          <Text className="kb-count-sub">
            {searching ? `当前分类 ${shownCount} 条` : `${categories.length} 个分类`}
          </Text>
        </View>

        <View className="kb-filter">
          {[ALL_CATEGORY, ...categories].map((name) => (
            <View
              className={`kb-chip${category === name ? ' on' : ''}`}
              key={name}
              ariaRole="button"
              ariaLabel={`筛选分类：${name}`}
              onClick={() => setCategory(name)}
            >
              <Text className="kb-chip-text">{name}</Text>
            </View>
          ))}
        </View>

        {matched.length === 0 ? (
          <StateBlock
            variant="empty"
            icon="magnifying-glass"
            title="没有匹配的内容"
            desc="换个关键词试试，或者直接去问助手。"
            actionLabel="换个关键词，或到助手提问"
            onAction={askWithQuery}
          />
        ) : groups.length === 0 ? (
          <StateBlock
            variant="empty"
            icon="book-open"
            title="这个分类下没有匹配的条目"
            desc="切到「全部」看看其他分类，或者换个关键词。"
            actionLabel="看全部分类"
            onAction={() => setCategory(ALL_CATEGORY)}
          />
        ) : (
          groups.map((group) => (
            <View key={group.category}>
              <SectionHeader
                title={group.category}
                action={<Text className="muted">{group.items.length} 条</Text>}
              />
              {group.items.map((entry) => {
                const open = openEntry === entry.id
                return (
                  <View
                    className={`kb-card${open ? ' open' : ''}`}
                    key={entry.id}
                    ariaRole="button"
                    ariaLabel={`${String(entry.title ?? '')}，${open ? '收起' : '展开'}全文`}
                    onClick={() => setOpenEntry(open ? '' : entry.id)}
                  >
                    <View className="kb-head">
                      <Text className="kb-title">{String(entry.title ?? '')}</Text>
                      <Icon
                        name="chevron-down"
                        size={28}
                        className={`kb-caret${open ? ' open' : ''}`}
                        color={THEME.primary}
                      />
                    </View>
                    <Text className="kb-summary">{entrySummary(entry)}</Text>
                    <View className="kb-meta">
                      {entry.category ? <Pill tone="primary">{String(entry.category)}</Pill> : null}
                      {entry.source ? (
                        <Text className="kb-meta-text">依据：{String(entry.source)}</Text>
                      ) : null}
                    </View>
                    {open ? (
                      <View className="kb-body">
                        <Text className="kb-content">{String(entry.content ?? '')}</Text>
                        {entry.keywords ? (
                          <Text className="kb-keywords">关键词：{entry.keywords}</Text>
                        ) : null}
                        <View className="kb-fold" ariaRole="button" ariaLabel="收起全文">
                          <Icon name="chevron-down" size={24} color={THEME.primary} className="kb-fold-icon" />
                          <Text className="kb-fold-text">收起</Text>
                        </View>
                      </View>
                    ) : null}
                  </View>
                )
              })}
            </View>
          ))
        )}
      </View>
    )
  }

  return (
    <View className="page qa-page">
      <View className="qa-top">
        <View
          className={`qa-tab${mode === 'chat' ? ' on' : ''}`}
          ariaRole="button"
          ariaLabel="切换到助手"
          onClick={() => switchMode('chat')}
        >
          <Icon name="comment-dots" size={32} />
          <Text className="qa-tab-text">助手</Text>
        </View>
        <View
          className={`qa-tab${mode === 'kb' ? ' on' : ''}`}
          ariaRole="button"
          ariaLabel="切换到知识库"
          onClick={() => switchMode('kb')}
        >
          <Icon name="book-open" size={32} />
          <Text className="qa-tab-text">知识库</Text>
        </View>
        <View
          className={`qa-tab${mode === 'graph' ? ' on' : ''}`}
          ariaRole="button"
          ariaLabel="切换到知识图谱"
          onClick={() => switchMode('graph')}
        >
          <Icon name="chart-line" size={32} />
          <Text className="qa-tab-text">图谱</Text>
        </View>
      </View>

      <ScrollView className="qa-scroll" scrollY scrollWithAnimation scrollIntoView={anchor}>
        {mode === 'chat' ? renderChat() : mode === 'kb' ? renderKnowledge() : renderGraph()}
      </ScrollView>

      {mode === 'graph' ? null : (
        <View className="qa-composer">
          {/* 免责声明 + 剩余次数挤在同一行：拆两行会把输入区顶掉 */}
          <Text className="qa-disclaimer">
            {agent && agent.enabled
              ? `助手回答仅供参考，不替代医生建议${
                  agent.remaining_requests >= 0 ? ` · 今日剩余 ${agent.remaining_requests} 次` : ''
                }`
              : '内容来自照护知识库，不能替代医生建议'}
          </Text>
          {mode === 'chat' ? (
            <View className="qa-input-row">
              <View className="qa-field">
                <Input
                  className="qa-input"
                  ariaLabel="输入照护问题"
                  value={draft}
                  maxlength={MAX_QUESTION}
                  confirmType="send"
                  focus={composerFocus}
                  placeholder="输入问题，例如：晚上不睡觉"
                  placeholderStyle={`color:${THEME.muted}`}
                  onInput={(e) => setDraft(e.detail.value)}
                  onConfirm={() => send(draft)}
                />
              </View>
              <Button
                className="qa-send"
                onClick={() => send(draft)}
                disabled={!draft.trim()}
                ariaLabel="发送问题"
              >
                发送
              </Button>
            </View>
          ) : (
            <View
              className="qa-kb-shortcut"
              ariaRole="button"
              ariaLabel="去助手提问"
              onClick={askWithQuery}
            >
              <Icon name="comment-dots" size={32} color={THEME.primary} />
              <Text className="qa-kb-shortcut-text">
                {query.trim() ? `带着「${query.trim()}」去问助手` : '有问题？直接问助手'}
              </Text>
              <Icon name="arrow-right" size={28} color={THEME.primary} />
            </View>
          )}
        </View>
      )}

      <BottomNav active="qa" />
    </View>
  )
}
