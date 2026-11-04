import { useCallback, useMemo, useState } from 'react'
import { ScrollView, Switch, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import Icon from '@/components/Icon'
import BottomNav from '@/components/BottomNav'
import { Button, PageHead, StateBlock } from '@/components/ui'
import type { IconName } from '@/lib/icons'
import { THEME } from '@/lib/theme'
import { api, getUser, isLoggedIn } from '@/lib/api'
import type {
  ReactionKind,
  ReportReason,
  Whisper,
  WhisperKind,
  WhisperLexicon,
  WhisperSlot,
  WhisperTerms,
} from '@/lib/api'
import './index.scss'

/**
 * 结构化互助：只拼句，不打字。
 *
 * 用户能做的选择只有「分区 + 四个槽位的词元」。句子由服务端拼接，
 * 客户端只做同一份 render 规则的预览；任何自由文本都不会被发送。
 */

const KIND_ICON: Record<WhisperKind, IconName> = {
  分享: 'lightbulb',
  求助: 'circle-question',
  陪伴: 'hand-holding-heart',
}

const SLOT_LABEL: Record<WhisperSlot, { title: string; hint?: string }> = {
  scene: { title: '发生在什么时候', hint: '必选' },
  feeling: { title: '那一刻我是', hint: '必选' },
  tried: { title: '我试过的办法', hint: '可不选' },
  wish: { title: '我想对同路人说', hint: '必选' },
}

/** 与服务端 render 规则一致，仅用于本地预览 */
function previewOf(lexicon: WhisperLexicon | null, terms: WhisperTerms): string {
  if (!lexicon) return ''
  let text = ''
  for (const rule of lexicon.render) {
    const id = terms[rule.slot]
    if (!id) continue
    const term = lexicon.slots[rule.slot].find((item) => item.id === id)
    if (!term) continue
    text += term.text + rule.glue
  }
  return text
}

/** Taro 取消选择时抛的是带 errMsg 的对象，不当成错误提示 */
function isCancel(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'errMsg' in err &&
    String(err.errMsg).includes('cancel')
  )
}

function relativeTime(iso: string): string {
  if (!iso) return ''
  const time = new Date(iso.replace(' ', 'T')).getTime()
  if (!Number.isFinite(time)) return ''
  const diff = Date.now() - time
  if (diff < 60000) return '刚刚'
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} 个月前`
  return `${Math.floor(months / 12)} 年前`
}

export default function CommunityPage() {
  const [lexicon, setLexicon] = useState<WhisperLexicon | null>(null)
  const [items, setItems] = useState<Whisper[]>([])
  const [filter, setFilter] = useState<WhisperKind | '全部'>('全部')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [mine, setMine] = useState<Record<string, ReactionKind>>({})
  const [busyId, setBusyId] = useState('')

  const [sheetOpen, setSheetOpen] = useState(false)
  const [formKind, setFormKind] = useState<WhisperKind>('分享')
  const [formTerms, setFormTerms] = useState<WhisperTerms>({})
  const [formAnon, setFormAnon] = useState(true)
  const [formError, setFormError] = useState('')
  const [posting, setPosting] = useState(false)

  const me = getUser()
  const preview = useMemo(() => previewOf(lexicon, formTerms), [lexicon, formTerms])

  const load = useCallback(async (target: WhisperKind | '全部') => {
    if (!isLoggedIn()) {
      Taro.reLaunch({ url: '/pages/login/index' })
      return
    }
    setLoading(true)
    setLoadError('')
    try {
      const [lex, list, reactions] = await Promise.all([
        api.whisperLexicon(),
        api.whispers(target === '全部' ? undefined : target),
        api.myWhisperReactions(),
      ])
      setLexicon(lex)
      setItems(list)
      const map: Record<string, ReactionKind> = {}
      reactions.forEach((item) => {
        map[item.whisper] = item.kind
      })
      setMine(map)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '内容加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useDidShow(() => {
    void load(filter)
  })

  function switchFilter(next: WhisperKind | '全部') {
    if (next === filter) return
    setFilter(next)
    void load(next)
  }

  async function react(item: Whisper, kind: ReactionKind) {
    if (busyId) return
    if (mine[item.id] === kind) return
    setBusyId(item.id)
    try {
      const res = await api.reactWhisper(item.id, kind)
      setItems((prev) =>
        prev.map((w) =>
          w.id === item.id
            ? { ...w, reaction_counts: res.reaction_counts, reactions_count: res.reactions_count }
            : w
        )
      )
      setMine((prev) => ({ ...prev, [item.id]: res.kind }))
    } catch (e) {
      Taro.showToast({ title: e instanceof Error ? e.message : '回应失败', icon: 'none' })
    } finally {
      setBusyId('')
    }
  }

  async function report(item: Whisper) {
    const reasons = lexicon?.reportReasons ?? (['不合适', '其他'] as ReportReason[])
    try {
      const picked = await Taro.showActionSheet({ itemList: reasons as string[] })
      const reason = reasons[picked.tapIndex]
      const res = await api.reportWhisper(item.id, reason)
      Taro.showToast({ title: '已提交，等待复核', icon: 'none' })
      if (res.hidden) void load(filter)
    } catch (e) {
      if (isCancel(e)) return
      Taro.showToast({ title: e instanceof Error ? e.message : '举报失败', icon: 'none' })
    }
  }

  function openSheet() {
    setFormKind(filter === '全部' ? '分享' : filter)
    setFormTerms({})
    setFormAnon(true)
    setFormError('')
    setSheetOpen(true)
  }

  function applyPreset(preset: { kind: WhisperKind; terms: WhisperTerms }) {
    setFormKind(preset.kind)
    setFormTerms({ ...preset.terms })
    setFormError('')
  }

  function clearForm() {
    setFormTerms({})
    setFormError('')
  }

  function pick(slot: WhisperSlot, id: string) {
    setFormError('')
    setFormTerms((prev) => {
      const next = { ...prev }
      if (next[slot] === id) delete next[slot]
      else next[slot] = id
      return next
    })
  }

  async function submit() {
    if (posting) return
    if (!formTerms.scene || !formTerms.feeling || !formTerms.wish) {
      setFormError('场景、此刻和想说的话，各选一句再发出')
      return
    }
    setPosting(true)
    setFormError('')
    try {
      await api.createWhisper({
        kind: formKind,
        terms: formTerms,
        anonymous: formAnon,
      })
      setSheetOpen(false)
      setFilter(formKind)
      await load(formKind)
      Taro.showToast({ title: '已发布', icon: 'none' })
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '这句没能发出去，请稍后再试')
    } finally {
      setPosting(false)
    }
  }

  const kinds: (WhisperKind | '全部')[] = ['全部', '分享', '求助', '陪伴']
  const showEmpty = !loading && !loadError && items.length === 0

  return (
    <View className="page">
      <View className="page-pad">
        <PageHead
          title="互助留言"
          action={
            <View
              className="ch-help"
              onClick={() => {
                void Taro.showModal({
                  title: '互助留言说明',
                  content:
                    '只能从词库拼句，不能自己打字；回应是固定选项。留言默认匿名，发出前可以关掉。每人每天最多 5 句；被 3 人举报会先隐藏，等待复核。',
                  showCancel: false,
                  confirmText: '知道了',
                })
              }}
              ariaRole="button"
              ariaLabel="查看互助留言说明"
            >
              <Icon name="circle-info" size={36} color={THEME.muted} />
            </View>
          }
        />

        <View className="ch-filter">
          {kinds.map((kind) => (
            <View
              key={kind}
              className={`ch-filter-item ${kind === filter ? 'on' : ''}`}
              onClick={() => switchFilter(kind)}
            >
              {kind}
            </View>
          ))}
        </View>

        {loadError ? (
          <StateBlock
            variant="error"
            title={loadError}
            actionLabel="重新加载"
            onAction={() => void load(filter)}
          />
        ) : null}

        {loading ? <StateBlock variant="loading" title="正在加载…" /> : null}

        {showEmpty ? (
          <StateBlock
            variant="empty"
            title={filter === '全部' ? '还没有留言' : `「${filter}」暂无内容`}
            desc="从词库选几段，系统会拼成一句。"
            actionLabel="拼第一句"
            onAction={openSheet}
          />
        ) : null}

        {!loading && !loadError
          ? items.map((item) => {
              const selected = mine[item.id]
              return (
                <View className={`w-card ${item.hidden ? 'w-card-hidden' : ''}`} key={item.id}>
                  <View className="w-meta">
                    <View className="w-kind">
                      <Icon name={KIND_ICON[item.kind] ?? 'comment'} size={24} color={THEME.primary} />
                      <Text className="w-kind-text">{item.kind}</Text>
                    </View>
                    <Text className="w-who">{item.nickname || '照护者'}</Text>
                    <Text className="w-time">{relativeTime(item.created)}</Text>
                  </View>

                  <Text className="w-text">{item.text}</Text>

                  {item.hidden ? (
                    <Text className="w-hidden-note">这条已被隐藏，只有你自己能看到。</Text>
                  ) : null}

                  <View className="w-reacts">
                    {(lexicon?.reactions ?? []).map((kind) => {
                      const on = selected === kind
                      const count = item.reaction_counts?.[kind] ?? 0
                      return (
                        <View
                          key={kind}
                          className={`w-react ${on ? 'on' : ''} ${busyId === item.id ? 'busy' : ''}`}
                          onClick={() => void react(item, kind)}
                        >
                          <Text className="w-react-text">{kind}</Text>
                          {count > 0 ? <Text className="w-react-num">{count}</Text> : null}
                        </View>
                      )
                    })}
                  </View>

                  <View className="w-foot">
                    <Text className="w-total">
                      {item.reactions_count > 0
                        ? `${item.reactions_count} 人回应过`
                        : '还没有人回应'}
                    </Text>
                    {!item.hidden ? (
                      <Text className="w-report" onClick={() => void report(item)}>
                        举报
                      </Text>
                    ) : null}
                  </View>
                </View>
              )
            })
          : null}

      </View>

      {showEmpty ? null : (
        <View className="fab" onClick={openSheet}>
          <Icon name="pen-to-square" size={30} color={THEME.white} />
          <Text className="fab-label">拼一句</Text>
        </View>
      )}

      {sheetOpen ? (
        <View className="sheet-layer">
          <View className="sheet-mask" onClick={() => setSheetOpen(false)} />
          <View className="sheet">
            <View className="sheet-head">
              <Text className="sheet-title">拼一句</Text>
              <View
                className="sheet-close"
                onClick={() => setSheetOpen(false)}
                ariaRole="button"
                ariaLabel="关闭"
              >
                <Icon name="xmark" size={34} color={THEME.ink2} />
              </View>
            </View>

            <View className="preview">
              <View className="preview-head">
                <Text className="preview-label">预览</Text>
                {Object.keys(formTerms).length > 0 ? (
                  <Text className="preview-clear" onClick={clearForm} ariaRole="button" ariaLabel="清空选择">
                    清空
                  </Text>
                ) : null}
              </View>
              <Text className={`preview-text ${preview ? '' : 'empty'}`}>
                {preview || '从下面选组合或逐项挑词，句子会出现在这里'}
              </Text>
            </View>

            <ScrollView scrollY className="sheet-scroll">
              <View className="preset-head">
                <Text className="slot-title">快速开始</Text>
                <Text className="slot-hint">点一个组合，再按需改</Text>
              </View>
              <View className="preset-row">
                {(lexicon?.presets ?? []).map((preset) => {
                  const active =
                    formKind === preset.kind &&
                    formTerms.scene === preset.terms.scene &&
                    formTerms.feeling === preset.terms.feeling &&
                    formTerms.tried === preset.terms.tried &&
                    formTerms.wish === preset.terms.wish
                  return (
                    <View
                      key={preset.id}
                      className={`preset-chip ${active ? 'on' : ''}`}
                      onClick={() => applyPreset(preset)}
                      ariaRole="button"
                      ariaLabel={`使用组合：${preset.label}`}
                    >
                      <Text className="preset-label">{preset.label}</Text>
                    </View>
                  )
                })}
              </View>

              <Text className="sheet-label">属于哪一类</Text>
              <View className="chip-row">
                {(lexicon?.kinds ?? []).map((kind) => (
                  <View
                    key={kind}
                    className={`chip ${formKind === kind ? 'on' : ''}`}
                    onClick={() => setFormKind(kind)}
                  >
                    <Text className="chip-text">{kind}</Text>
                  </View>
                ))}
              </View>

              {(lexicon?.render ?? []).map((rule, index) => {
                const done = Boolean(formTerms[rule.slot])
                return (
                <View className="slot" key={rule.slot}>
                  <View className="slot-head">
                    <Text className={`slot-step ${done ? 'done' : ''}`}>
                      {done ? '✓' : index + 1}
                    </Text>
                    <Text className="slot-title">{SLOT_LABEL[rule.slot].title}</Text>
                    <Text className="slot-hint">{SLOT_LABEL[rule.slot].hint}</Text>
                  </View>
                  <View className="chip-row">
                    {(lexicon?.slots[rule.slot] ?? []).map((term) => (
                      <View
                        key={term.id}
                        className={`chip ${formTerms[rule.slot] === term.id ? 'on' : ''}`}
                        onClick={() => pick(rule.slot, term.id)}
                      >
                        <Text className="chip-text">{term.text}</Text>
                      </View>
                    ))}
                  </View>
                </View>
                )
              })}

              <View className="switch-line switch-line-lg">
                <View className="switch-text">
                  <Text className="switch-label">匿名发出</Text>
                  {formAnon ? null : (
                    <Text className="switch-hint">将以「{me?.name || '照护者'}」的名字出现</Text>
                  )}
                </View>
                <Switch
                  checked={formAnon}
                  color={THEME.primary}
                  onChange={(e) => setFormAnon(e.detail.value)}
                />
              </View>

              <View className="sheet-note">
                <Icon name="circle-info" size={28} color={THEME.yellow} />
                <Text className="sheet-note-text">
                  句子由词库拼接，不能自行改字。被 3 人以上举报会先隐藏，等待复核。
                </Text>
              </View>

              {formError ? <Text className="sheet-error">{formError}</Text> : null}
            </ScrollView>

            <View className="sheet-actions">
              <Button variant="ghost" className="sheet-action" onClick={() => setSheetOpen(false)}>
                取消
              </Button>
              <Button
                className="sheet-action"
                loading={posting}
                onClick={() => void submit()}
                ariaLabel="发出这句话"
              >
                发出去
              </Button>
            </View>
          </View>
        </View>
      ) : null}

      <BottomNav active="community" />
    </View>
  )
}
