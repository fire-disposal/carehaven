import { useCallback, useState } from 'react'
import { Input, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import BottomNav from '@/components/BottomNav'
import {
  api,
  isLoggedIn,
  type Intervention,
  type InterventionLog,
  type Level,
  type StressScore,
} from '@/lib/api'
import './index.scss'

const LOG_LIMIT = 10
const SUCCESS_MSG = '已记录，压力指数会随干预数据更新'

/** 工具库的四个分类（与后端 interventions.category 取值一致） */
const CATEGORIES: Intervention['category'][] = ['呼吸放松', '冥想练习', '音乐疗法', '视频指导']

const CATEGORY_EMOJI: Record<Intervention['category'], string> = {
  呼吸放松: '🌬️',
  冥想练习: '🧘',
  音乐疗法: '🎵',
  视频指导: '🎬',
}

const STAR_LABELS = ['没什么帮助', '帮助较小', '一般', '有帮助', '很有帮助']

interface LevelThresholds {
  t_green: number
  t_red: number
}

/** 后端 app_config 缺失时的兜底阈值，与迁移里的默认值一致 */
const FALLBACK_THRESHOLDS: LevelThresholds = { t_green: 40, t_red: 70 }

const LEVEL_TITLE: Record<Level, string> = {
  green: '绿色 · 压力平稳',
  yellow: '黄色 · 压力预警',
  red: '红色 · 压力偏高',
}

const LEVEL_DESC: Record<Level, string> = {
  green: '当前压力处在平稳区间，保持规律作息与日常放松练习就可以。',
  yellow: '压力已经有所累积，建议今天完成一次放松练习，并留意睡眠与照护负担。',
  red: '压力已明显偏高，请先照顾好自己，才有余力照顾家人。',
}

/** 阈值来自后端配置，可能缺失或格式异常，统一收敛成可用数值 */
function readThresholds(raw: unknown): LevelThresholds {
  if (!raw || typeof raw !== 'object') return FALLBACK_THRESHOLDS
  const row = raw as Record<string, unknown>
  const green = typeof row.t_green === 'number' && Number.isFinite(row.t_green) ? row.t_green : FALLBACK_THRESHOLDS.t_green
  const red = typeof row.t_red === 'number' && Number.isFinite(row.t_red) ? row.t_red : FALLBACK_THRESHOLDS.t_red
  const t_green = Math.min(90, Math.max(10, Math.round(green)))
  const t_red = Math.min(99, Math.max(t_green + 1, Math.round(red)))
  return { t_green, t_red }
}

/** 方案库里的计划时长可能缺失，缺失时按 5 分钟起算，供完成表单预填 */
function validMinutes(value: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null
}

function formatLogTime(raw: string): string {
  const date = raw ? new Date(raw.replace(' ', 'T')) : null
  if (!date || Number.isNaN(date.getTime())) return raw || '时间未知'
  const pad = (n: number) => String(n).padStart(2, '0')
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const now = new Date()
  if (date.toDateString() === now.toDateString()) return `今天 ${clock}`
  const yesterday = new Date(now.getTime() - 86400000)
  if (date.toDateString() === yesterday.toDateString()) return `昨天 ${clock}`
  return `${date.getMonth() + 1}月${date.getDate()}日 ${clock}`
}

function clampStars(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(5, Math.max(0, Math.round(value)))
}

export default function ManagePage() {
  const [score, setScore] = useState<StressScore | null>(null)
  const [recommended, setRecommended] = useState<Intervention[]>([])
  const [allItems, setAllItems] = useState<Intervention[]>([])
  const [logs, setLogs] = useState<InterventionLog[]>([])
  const [thresholds, setThresholds] = useState<LevelThresholds>(FALLBACK_THRESHOLDS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // 展开 / 完成流程：key = 分区 + 方案 id，避免同一方案在推荐区与工具区同时展开
  const [expandedKey, setExpandedKey] = useState('')
  const [completingKey, setCompletingKey] = useState('')
  const [stars, setStars] = useState(0)
  const [duration, setDuration] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!isLoggedIn()) {
      Taro.reLaunch({ url: '/pages/login/index' })
      return
    }
    setLoading(true)
    setError('')
    setNotice('')
    try {
      const latest = await api.latestScore()
      const level = latest?.level ?? null
      const [all, recent, rawThresholds, recommend] = await Promise.all([
        api.interventions(),
        api.interventionLogs(LOG_LIMIT),
        api.appConfig<unknown>('level_thresholds', null),
        level ? api.interventions(level) : Promise.resolve<Intervention[]>([]),
      ])
      setScore(latest)
      setAllItems(all)
      setLogs(recent)
      setThresholds(readThresholds(rawThresholds))
      setRecommended(recommend)
      setExpandedKey('')
      setCompletingKey('')
    } catch (e) {
      setError(e instanceof Error ? e.message : '数据加载失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [])

  /** 完成练习后的轻量刷新：不动 loading，只更新压力指数与最近记录 */
  const refresh = useCallback(async () => {
    try {
      const [latest, recent] = await Promise.all([api.latestScore(), api.interventionLogs(LOG_LIMIT)])
      setScore(latest)
      setLogs(recent)
      setRecommended(latest?.level ? await api.interventions(latest.level) : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : '数据刷新失败，请下拉重试')
    }
  }, [])

  useDidShow(() => {
    void load()
  })

  function toggleCard(key: string) {
    setError('')
    if (expandedKey === key) {
      setExpandedKey('')
      setCompletingKey('')
      return
    }
    setExpandedKey(key)
    setCompletingKey('')
    setStars(0)
  }

  function startPractice(key: string, item: Intervention) {
    setError('')
    setNotice('')
    setCompletingKey(key)
    setStars(0)
    setDuration(String(validMinutes(item.duration_min) ?? 5))
  }

  async function complete(item: Intervention) {
    if (saving) return
    const minutes = Number(duration)
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 240) {
      setError('请填写 1–240 分钟之间的实际时长')
      return
    }
    const chosenStars = clampStars(stars)
    if (chosenStars < 1) {
      setError('请先选择这次练习的效果（1–5 星）')
      return
    }
    const actual = Math.round(minutes)

    setSaving(true)
    setError('')
    setNotice('')
    try {
      await api.logIntervention({ intervention: item, duration_actual: actual, feeling: chosenStars })
    } catch (e) {
      setError(e instanceof Error ? e.message : '记录失败，请稍后重试')
      setSaving(false)
      return
    }

    // 完成记录已落库：无论评分是否成功，都先收起表单并刷新列表
    setExpandedKey('')
    setCompletingKey('')
    setStars(0)
    setDuration('')
    setNotice(SUCCESS_MSG)
    Taro.showToast({ title: SUCCESS_MSG, icon: 'none' })
    await refresh()

    try {
      await api.createRating({ target: 'intervention', target_id: item.id, stars: chosenStars })
    } catch {
      setError('练习已记录，但效果评分未保存，可稍后再评一次。')
    }
    setSaving(false)
  }

  const level: Level | null = score?.level ?? null
  const hps = score && Number.isFinite(score.hps) ? Math.min(100, Math.max(0, Math.round(score.hps))) : null
  const { t_green, t_red } = thresholds

  const groups: { category: string; emoji: string; items: Intervention[] }[] = [
    ...CATEGORIES.map((category) => ({
      category,
      emoji: CATEGORY_EMOJI[category],
      items: allItems.filter((item) => item.category === category),
    })),
    {
      category: '其他',
      emoji: '🧩',
      items: allItems.filter((item) => !CATEGORIES.includes(item.category)),
    },
  ].filter((group) => group.items.length > 0)

  function renderIntervention(item: Intervention, section: string, compact: boolean) {
    const key = `${section}-${item.id}`
    const expanded = expandedKey === key
    const completing = completingKey === key
    const planMinutes = validMinutes(item.duration_min)
    return (
      <View className={`mg-it ${compact ? 'compact' : ''}`} key={key}>
        <View className="mg-it-head" onClick={() => toggleCard(key)}>
          <Text className="mg-emoji">{item.cover_emoji || '🧘'}</Text>
          <View className="mg-it-main">
            <Text className="mg-it-title">{item.title || '未命名方案'}</Text>
            <View className="mg-it-meta">
              <Text className="pill pill-primary">{item.category || '其他'}</Text>
              <Text className="mg-duration">{planMinutes === null ? '时长未标注' : `约 ${planMinutes} 分钟`}</Text>
            </View>
            {compact || expanded || !item.description ? null : (
              <Text className="mg-it-summary">{item.description}</Text>
            )}
          </View>
          <Text className="mg-toggle">{expanded ? '收起' : '详情'}</Text>
        </View>

        {expanded ? (
          <View className="mg-it-body">
            <Text className="mg-desc">{item.description || '暂无详细说明。'}</Text>

            {completing ? (
              <View className="mg-form">
                <Text className="mg-hint">练习结束后再记录：选择这次的效果，并填写实际用时。</Text>

                <View className="mg-field">
                  <Text className="mg-label">实际时长（分钟）</Text>
                  <Input
                    className="mg-input"
                    type="digit"
                    value={duration}
                    onInput={(e) => setDuration(e.detail.value)}
                  />
                </View>

                <Text className="mg-label">这次练习的效果</Text>
                <View className="mg-star-row">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <View
                      key={n}
                      className={`mg-star ${stars >= n ? 'on' : ''}`}
                      onClick={() => setStars(n)}
                    >
                      <Text className="mg-star-icon">{stars >= n ? '★' : '☆'}</Text>
                      <Text className="mg-star-label">{STAR_LABELS[n - 1]}</Text>
                    </View>
                  ))}
                </View>

                <View className="mg-form-actions">
                  <View
                    className="btn-ghost mg-action"
                    onClick={() => {
                      setCompletingKey('')
                      setStars(0)
                    }}
                  >
                    稍后再记
                  </View>
                  <View
                    className={`btn-primary mg-action ${saving ? 'busy' : ''}`}
                    onClick={() => void complete(item)}
                  >
                    {saving ? '保存中…' : '完成'}
                  </View>
                </View>
              </View>
            ) : (
              <View className="btn-primary mg-start" onClick={() => startPractice(key, item)}>
                开始练习
              </View>
            )}
          </View>
        ) : null}
      </View>
    )
  }

  return (
    <View className="page">
      <View className="page-pad">
        <View className="mg-page-head">
          <Text className="mg-page-title">压力管理</Text>
          <Text className="mg-page-sub">按您当前的压力分层，给出对应的放松方案</Text>
        </View>

        {error ? <Text className="mg-error">{error}</Text> : null}
        {error && !loading ? (
          <View className="btn-ghost mg-retry" onClick={() => void load()}>
            重新加载
          </View>
        ) : null}
        {notice ? <Text className="mg-notice">✅ {notice}</Text> : null}

        {/* ---------- 1. 当前分层 ---------- */}
        <View className={`mg-hero ${level ? `level-${level}` : 'level-none'}`}>
          <View className="mg-hero-head">
            <Text className="mg-hero-label">当前分层</Text>
            <Text className={`pill ${level ? `pill-${level}` : 'pill-primary'}`}>
              {level ? LEVEL_TITLE[level] : loading ? '评估中…' : '暂无评估'}
            </Text>
          </View>

          <View className="mg-hps">
            <Text className="mg-hps-value">{hps === null ? '--' : hps}</Text>
            <Text className="mg-hps-unit">HPS 混合压力指数</Text>
          </View>

          <Text className="mg-hero-desc">
            {level
              ? LEVEL_DESC[level]
              : loading
                ? '正在读取您最近的评估结果…'
                : '还没有评估结果，先到首页完成一次打卡，就能看到自己的压力分层。'}
          </Text>

          {score?.advice ? <Text className="mg-advice">系统提示：{score.advice}</Text> : null}

          {level === 'red' ? (
            <View className="mg-urgent">
              <Text className="mg-urgent-title">🚨 现在就做一件事</Text>
              <Text className="mg-urgent-text">
                立即完成一次紧急放松（推荐下方「红区紧急放松包」），并考虑向家人或专业人员求助。
                您先稳住，才有力气继续照护。
              </Text>
            </View>
          ) : null}

          <View className="mg-scale">
            <View className="mg-scale-bar">
              <View className="mg-seg seg-green" style={{ width: `${t_green}%` }} />
              <View className="mg-seg seg-yellow" style={{ width: `${t_red - t_green}%` }} />
              <View className="mg-seg seg-red" style={{ width: `${100 - t_red}%` }} />
              {hps === null ? null : <View className="mg-pointer" style={{ left: `${hps}%` }} />}
            </View>
            <View className="mg-legend">
              <View className="mg-legend-item">
                <View className="mg-dot dot-green" />
                <Text>绿色 &lt; {t_green}</Text>
              </View>
              <View className="mg-legend-item">
                <View className="mg-dot dot-yellow" />
                <Text>黄色 {t_green}–{t_red}</Text>
              </View>
              <View className="mg-legend-item">
                <View className="mg-dot dot-red" />
                <Text>红色 ≥ {t_red}</Text>
              </View>
            </View>
          </View>

          <Text className="mg-threshold-note">
            阈值 {t_green} / {t_red}，由专家意见与临床证据设定，可在系统配置中调整。
          </Text>
        </View>

        {/* ---------- 2. 推荐方案 ---------- */}
        <View className="section-title">
          <Text>为您推荐</Text>
          <Text className="muted">{level ? '匹配当前分层' : '等待评估'}</Text>
        </View>

        {loading ? (
          <View className="card mg-empty">
            <Text className="muted">正在加载推荐方案…</Text>
          </View>
        ) : recommended.length > 0 ? (
          <View>{recommended.map((item) => renderIntervention(item, 'rec', false))}</View>
        ) : (
          <View className="card mg-empty">
            <Text className="muted">
              {level
                ? '当前分层暂时没有专属方案，可以到下方「全部工具」里挑一项试试。'
                : '还没有评估结果。先到首页完成一次打卡，这里会按您的分层推荐方案。'}
            </Text>
          </View>
        )}

        {/* ---------- 3. 全部工具 ---------- */}
        <View className="section-title">
          <Text>全部工具</Text>
          <Text className="muted">{allItems.length} 项</Text>
        </View>

        {loading ? (
          <View className="card mg-empty">
            <Text className="muted">正在加载工具库…</Text>
          </View>
        ) : groups.length === 0 ? (
          <View className="card mg-empty">
            <Text className="muted">工具库暂时没有内容，请稍后重新加载。</Text>
          </View>
        ) : (
          <View>
            {groups.map((group) => (
              <View key={group.category}>
                <View className="mg-group-head">
                  <Text className="mg-group-name">
                    {group.emoji} {group.category}
                  </Text>
                  <Text className="muted">{group.items.length} 项</Text>
                </View>
                {group.items.map((item) => renderIntervention(item, `cat-${group.category}`, true))}
              </View>
            ))}
          </View>
        )}

        {/* ---------- 4. 最近完成记录 ---------- */}
        <View className="section-title">
          <Text>最近完成记录</Text>
          <Text className="muted">最近 {LOG_LIMIT} 条</Text>
        </View>

        {loading ? (
          <View className="card mg-empty">
            <Text className="muted">正在加载完成记录…</Text>
          </View>
        ) : logs.length === 0 ? (
          <View className="card mg-empty">
            <Text className="muted">
              还没有完成记录。完成一次练习后，这里会显示完成时间、实际时长和您给的效果评分。
            </Text>
          </View>
        ) : (
          <View>
            {logs.map((log) => {
              const logStars = clampStars(log.feeling)
              const logMinutes = validMinutes(log.duration_actual)
              return (
                <View className="card mg-log" key={log.id}>
                  <View className="mg-log-main">
                    <Text className="mg-log-title">{log.title_snapshot || '未命名方案'}</Text>
                    <Text className="mg-log-meta">
                      {formatLogTime(log.completed_at)} ·{' '}
                      {logMinutes === null ? '时长未记录' : `${logMinutes} 分钟`}
                    </Text>
                  </View>
                  <View className="mg-log-stars">
                    <Text className="mg-log-star-icons">
                      {'★'.repeat(logStars)}
                      {'☆'.repeat(5 - logStars)}
                    </Text>
                    <Text className="mg-log-star-label">
                      {logStars > 0 ? STAR_LABELS[logStars - 1] : '未评价'}
                    </Text>
                  </View>
                </View>
              )
            })}
          </View>
        )}
      </View>

      <BottomNav active="manage" />
    </View>
  )
}
