import { useCallback, useMemo, useRef, useState } from 'react'
import { Input, ScrollView, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import BottomNav from '@/components/BottomNav'
import { api, isLoggedIn, type KbEntry, type QaSession } from '@/lib/api'
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
  }
}

export default function QaPage() {
  const [mode, setMode] = useState<'chat' | 'kb'>('chat')
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [booting, setBooting] = useState(true)
  const [chatError, setChatError] = useState('')
  const [entries, setEntries] = useState<KbEntry[]>([])
  const [kbError, setKbError] = useState('')
  const [category, setCategory] = useState(ALL_CATEGORY)
  const [openSource, setOpenSource] = useState('')
  const [openEntry, setOpenEntry] = useState('')
  const [anchorTick, setAnchorTick] = useState(0)
  const seq = useRef(0)

  // 锚点 id 每次变化都会把滚动视图带到目标位置：问答看最新一条，知识库回到列表顶部
  const anchor = mode === 'chat' ? `qa-anchor-${anchorTick}` : `kb-anchor-${anchorTick}`

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
    const [history, knowledge] = await Promise.allSettled([api.qaHistory(30), api.knowledge()])

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
      const result = await withTimeout(api.ask(question), ASK_TIMEOUT)
      const answer = typeof result?.answer === 'string' ? result.answer.trim() : ''
      if (!answer) throw new Error('没有取到回答内容，请重试')
      setTurns((prev) =>
        prev.map((turn) =>
          turn.id === turnId ? { ...turn, status: 'ok', answer, sources: normalizeSources(result?.sources) } : turn
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

  function switchMode(next: 'chat' | 'kb') {
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
          {source.category ? <Text className="pill pill-primary src-cat">{source.category}</Text> : null}
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
      return (
        <View className="qa-state">
          <Text className="state-emoji">⏳</Text>
          <Text className="state-title">正在读取问答记录…</Text>
        </View>
      )
    }
    return (
      <View className="qa-thread">
        {chatError ? (
          <View className="err-card">
            <Text className="err-card-text">⚠️ {chatError}</Text>
            <View className="err-card-btn" ariaRole="button" ariaLabel="重新加载" onClick={() => void load()}>
              <Text className="err-card-btn-text">重新加载</Text>
            </View>
          </View>
        ) : null}

        {turns.length === 0 ? (
          <View className="welcome">
            <Text className="welcome-emoji">💬</Text>
            <Text className="welcome-title">有困扰，随时问</Text>
            <Text className="welcome-desc">
              用平常说话的方式描述您遇到的问题，我会从照护知识库里帮您找办法。
            </Text>
          </View>
        ) : null}

        <View className="quick-block">
          <Text className="quick-title">{turns.length === 0 ? '试试这样问' : '快捷提问'}</Text>
          <View className="quick-chips">
            {QUICK_QUESTIONS.map((item) => (
              <View
                className="quick-chip"
                key={item}
                ariaRole="button"
                ariaLabel={`提问：${item}`}
                onClick={() => send(item)}
              >
                <Text className="quick-chip-text">{item}</Text>
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
                    <Text className="pending-text">正在查找照护知识…</Text>
                  </View>
                ) : null}

                {turn.status === 'error' ? (
                  <View className="bubble bubble-ai bubble-error">
                    <Text className="bubble-error-text">⚠️ {turn.error || '没能取到回答'}</Text>
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
                    ) : kbReady ? (
                      <Text className="src-note">
                        这次没有匹配到知识库条目。可以换个说法再问，或到「知识库」里逐条浏览。
                      </Text>
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

  function renderKnowledge() {
    if (booting) {
      return (
        <View className="qa-state">
          <Text className="state-emoji">📚</Text>
          <Text className="state-title">正在读取知识库…</Text>
        </View>
      )
    }
    if (kbError && !kbReady) {
      return (
        <View className="kb-wrap">
          <View className="err-card">
            <Text className="err-card-text">⚠️ {kbError}</Text>
            <View className="err-card-btn" ariaRole="button" ariaLabel="重新加载知识库" onClick={() => void load()}>
              <Text className="err-card-btn-text">重新加载</Text>
            </View>
          </View>
        </View>
      )
    }
    if (!kbReady) {
      return (
        <View className="qa-state">
          <Text className="state-emoji">📭</Text>
          <Text className="state-title">知识库暂时没有内容</Text>
          <Text className="state-desc">内容补充后会显示在这里，您也可以切回问答直接提问。</Text>
        </View>
      )
    }
    return (
      <View className="kb-wrap">
        <View className="qa-anchor" id={`kb-anchor-${anchorTick}`} />
        {kbError ? (
          <View className="err-card">
            <Text className="err-card-text">⚠️ {kbError}</Text>
            <View className="err-card-btn" ariaRole="button" ariaLabel="重新加载知识库" onClick={() => void load()}>
              <Text className="err-card-btn-text">重新加载</Text>
            </View>
          </View>
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
              <View className="section-title">
                <Text>{group.category}</Text>
                <Text className="muted">{group.items.length} 条</Text>
              </View>
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
          ariaLabel="切换到问答"
          onClick={() => switchMode('chat')}
        >
          <Text className="qa-tab-text">💬 问答</Text>
        </View>
        <View
          className={`qa-tab${mode === 'kb' ? ' on' : ''}`}
          ariaRole="button"
          ariaLabel="切换到知识库"
          onClick={() => switchMode('kb')}
        >
          <Text className="qa-tab-text">📚 知识库</Text>
        </View>
      </View>

      <ScrollView className="qa-scroll" scrollY scrollWithAnimation scrollIntoView={anchor}>
        {mode === 'chat' ? renderChat() : renderKnowledge()}
      </ScrollView>

      <View className="qa-composer">
        <Text className="qa-disclaimer">回答来自项目知识库检索，不能替代专业医疗建议</Text>
        {mode === 'chat' ? (
          <View className="qa-input-row">
            <Input
              className="qa-input"
              value={draft}
              maxlength={MAX_QUESTION}
              confirmType="send"
              placeholder="说说遇到的困扰，例如：晚上不睡觉"
              placeholderStyle="color:#45585a"
              onInput={(e) => setDraft(e.detail.value)}
              onConfirm={() => send(draft)}
            />
            <View
              className={`qa-send${draft.trim() ? '' : ' quiet'}`}
              ariaRole="button"
              ariaLabel="发送问题"
              onClick={() => send(draft)}
            >
              <Text className="qa-send-text">发送</Text>
            </View>
          </View>
        ) : null}
      </View>

      <BottomNav active="qa" />
    </View>
  )
}
