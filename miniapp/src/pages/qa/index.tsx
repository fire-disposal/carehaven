import { useCallback, useMemo, useRef, useState } from 'react'
import { Input, ScrollView, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import BottomNav from '@/components/BottomNav'
import { Button, Card, Pill, SectionHeader, StateBlock } from '@/components/ui'
import Icon from '@/components/Icon'
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
const QUICK_QUESTIONS = ['晚上不睡觉', '拒绝洗澡', '动手打人', '患者走失了怎么办', '我自己撑不住了']

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
  sources: Source[]
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

/** 历史记录只存了回答正文，可由正文里的【条目标题】与知识库对上来源 */
function deriveSources(answer: string, entries: KbEntry[]): Source[] {
  if (!answer) return []
  return entries
    .filter((entry) => !!entry && !!entry.title && answer.indexOf(entry.title) >= 0)
    .sort((a, b) => answer.indexOf(a.title) - answer.indexOf(b.title))
    .map((entry) => ({
      id: typeof entry.id === 'string' ? entry.id : '',
      title: entry.title,
      category: typeof entry.category === 'string' ? entry.category : '',
    }))
}

function toTurn(item: QaSession, index: number, entries: KbEntry[]): Turn {
  const answer = String(item.answer ?? '')
  return {
    id: `h${index}-${String(item.id ?? '')}`,
    question: String(item.question ?? ''),
    answer,
    sources: deriveSources(answer, entries),
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
  const [anchorTick, setAnchorTick] = useState(0)
  const seq = useRef(0)

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

  const groups = useMemo(() => {
    const result: KbGroup[] = []
    for (const entry of entries) {
      const name = String(entry.category ?? '').trim() || UNKNOWN_CATEGORY
      if (category !== ALL_CATEGORY && name !== category) continue
      const group = result.find((item) => item.category === name)
      if (group) group.items.push(entry)
      else result.push({ category: name, items: [entry] })
    }
    return result
  }, [entries, category])

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
    setDraft('')
    setAnchorTick((tick) => tick + 1)
    void runAsk(id, question)
  }

  function switchMode(next: 'chat' | 'kb' | 'graph') {
    setMode(next)
    setAnchorTick((tick) => tick + 1)
  }

  function renderSource(turn: Turn, source: Source) {
    const key = `${turn.id}:${source.id || source.title}`
    const open = openSource === key
    const entry = source.id ? entries.find((item) => item.id === source.id) : undefined
    return (
      <View className="src-item" key={key} ariaRole="button" ariaLabel={`${source.title}，展开或收起全文`} onClick={() => setOpenSource(open ? '' : key)}>
        <View className="src-head">
          {source.category ? (
            <Pill tone="primary" className="src-cat">
              {source.category}
            </Pill>
          ) : null}
          <Text className="src-title">{source.title}</Text>
          <Text className="src-toggle">{open ? '收起' : '全文'}</Text>
        </View>
        {open ? (
          <View className="src-body">
            {entry ? (
              <Text className="src-content">{String(entry.content ?? '')}</Text>
            ) : (
              <Text className="src-content">这条内容的全文暂时取不到，可以切到「知识库」按分类查看。</Text>
            )}
            {entry && entry.source ? <Text className="src-from">依据：{entry.source}</Text> : null}
          </View>
        ) : null}
      </View>
    )
  }

  function renderChat() {
    if (booting) {
      return <StateBlock variant="loading" title="正在读取问答记录…" />
    }
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

        {turns.length === 0 ? (
          <StateBlock
            variant="empty"
            icon="comment-dots"
            title="输入您的问题"
            desc="系统会从照护知识库里检索相关内容，并列出出处。"
          />
        ) : null}

        <View className="qa-suggest-block">
          <Text className="qa-suggest-title">{turns.length === 0 ? '常见问题' : '继续提问'}</Text>
          <View className="qa-suggest-chips">
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
        </View>

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
                  <View className="bubble bubble-ai bubble-pending">
                    <View className="dots">
                      <View className="dot" />
                      <View className="dot" />
                      <View className="dot" />
                    </View>
                    <Text className="pending-text">正在检索…</Text>
                  </View>
                ) : null}

                {turn.status === 'error' ? (
                  <View className="bubble bubble-ai bubble-error">
                    <View className="bubble-error-text inline-alert">
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
                    <Text className="bubble-text">{turn.answer}</Text>
                    {turn.sources.length > 0 ? (
                      <View className="src-list">
                        <Text className="src-caption">来源 {turn.sources.length} 条 · 点标题看全文</Text>
                        {turn.sources.map((source) => renderSource(turn, source))}
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
                          <Icon name="thumbs-up" size={26} />
                          <Text className="qa-helpful-text">有用</Text>
                        </View>
                        <View
                          className={`qa-helpful-btn${turn.helpful === 'down' ? ' on' : ''}`}
                          ariaRole="button"
                          ariaLabel="这个回答没帮助"
                          onClick={() => void markHelpful(turn, 'down')}
                        >
                          <Text className="qa-helpful-text">没用</Text>
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

    // 版面：以中心节点为圆心，分类节点按角度均匀分布
    const SIZE = 600
    const CENTER = SIZE / 2
    const RADIUS = 152
    const nodes = categories.map((name, index) => {
      const angle = (-90 + (360 / categories.length) * index) * (Math.PI / 180)
      const group = groups.find((g) => g.category === name)
      return {
        name: name,
        count: group ? group.items.length : 0,
        x: CENTER + RADIUS * Math.cos(angle),
        y: CENTER + RADIUS * Math.sin(angle),
        deg: (-90 + (360 / categories.length) * index),
      }
    })
    const activeGroup = groups.find((g) => g.category === graphCategory)

    return (
      <View className="kg">
        <View className="qa-anchor" id={`graph-anchor-${anchorTick}`} />
        <View className="kg-canvas" style={{ width: Taro.pxTransform(SIZE), height: Taro.pxTransform(SIZE), margin: '0 auto' }}>
          {nodes.map((node, index) => (
            <View
              key={`line-${node.name}`}
              className="kg-line"
              style={{
                left: Taro.pxTransform(CENTER),
                top: Taro.pxTransform(CENTER),
                width: Taro.pxTransform(RADIUS),
                transform: `rotate(${node.deg}deg)`,
                animationDelay: `${index * 40}ms`,
              }}
            />
          ))}

          <View className="kg-node kg-node--center" style={{ left: Taro.pxTransform(CENTER), top: Taro.pxTransform(CENTER) }}>
            <Text className="kg-center-title">知识库</Text>
            <Text className="kg-center-count">{entries.length} 条</Text>
          </View>

          {nodes.map((node, index) => {
            const on = graphCategory === node.name
            return (
              <View
                key={node.name}
                className={`kg-node ${on ? 'on' : ''}`}
                style={{ left: Taro.pxTransform(node.x), top: Taro.pxTransform(node.y), animationDelay: `${index * 40}ms` }}
                onClick={() => {
                  setGraphCategory(on ? '' : node.name)
                  setGraphEntry('')
                }}
                ariaRole="button"
                ariaLabel={`查看分类：${node.name}`}
              >
                <Text className="kg-node-title">{node.name}</Text>
                <Text className="kg-node-count">{node.count}</Text>
              </View>
            )
          })}
        </View>

        <Text className="kg-hint">
          {graphCategory ? `「${graphCategory}」下的条目` : '点分类节点查看条目'}
        </Text>

        {activeGroup ? (
          <Card flush className="kg-panel">
            {activeGroup.items.map((entry) => {
              const open = graphEntry === entry.id
              return (
                <View className="kg-entry" key={entry.id}>
                  <View
                    className="kg-entry-head"
                    onClick={() => setGraphEntry(open ? '' : entry.id)}
                    ariaRole="button"
                    ariaLabel={`${String(entry.title || '')}，${open ? '收起' : '展开'}全文`}
                  >
                    <Text className="kg-entry-title">{String(entry.title || '')}</Text>
                    <Text className="kg-entry-more">{open ? '收起' : '展开'}</Text>
                  </View>
                  <Text className={`kg-entry-text ${open ? 'open' : ''}`}>{String(entry.content || '')}</Text>
                </View>
              )
            })}
          </Card>
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
        <Text className="kb-count">
          共 {shownCount} 条 · {categories.length} 个分类
        </Text>

        {groups.length === 0 ? (
          <Text className="kb-note">这个分类下暂时没有条目。</Text>
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
                    className="kb-card"
                    key={entry.id}
                    ariaRole="button"
                    ariaLabel={`${String(entry.title ?? '')}，展开或收起全文`}
                    onClick={() => setOpenEntry(open ? '' : entry.id)}
                  >
                    <View className="kb-head">
                      <Text className="kb-title">{String(entry.title ?? '')}</Text>
                      <Text className="kb-toggle">{open ? '收起' : '展开'}</Text>
                    </View>
                    {open ? (
                      <View className="kb-body">
                        <Text className="kb-content">{String(entry.content ?? '')}</Text>
                        {entry.source ? <Text className="kb-from">来源：{entry.source}</Text> : null}
                        {entry.keywords ? <Text className="kb-keywords">关键词：{entry.keywords}</Text> : null}
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
        <Text className="qa-disclaimer">
          {agent && agent.enabled
            ? `助手回答仅供参考，不替代医生建议${agent.remaining_requests >= 0 ? ` · 今日剩余 ${agent.remaining_requests} 次` : ''}`
            : '内容来自照护知识库，不能替代医生建议'}
        </Text>
        {mode === 'chat' ? (
          <View className="qa-input-row">
            <Input
              className="qa-input"
              ariaLabel="输入照护问题"
              value={draft}
              maxlength={MAX_QUESTION}
              confirmType="send"
              placeholder="输入问题，例如：晚上不睡觉"
              placeholderStyle={`color:${THEME.ink2}`}
              onInput={(e) => setDraft(e.detail.value)}
              onConfirm={() => send(draft)}
            />
            <Button
              className="qa-send"
              onClick={() => send(draft)}
              disabled={!draft.trim()}
              ariaLabel="发送问题"
            >
              发送
            </Button>
          </View>
        ) : null}
      </View>
      )}

      <BottomNav active="qa" />
    </View>
  )
}
