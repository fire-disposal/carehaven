import { useCallback, useState } from 'react'
import { Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import BottomNav from '@/components/BottomNav'
import Icon from '@/components/Icon'
import { Button, Card, PageHead, Pill, SectionHeader, StateBlock } from '@/components/ui'
import type { IconName } from '@/lib/icons'
import { LEVEL_TITLE } from '@/content/glossary'
import { levelDesc, levelTone } from '@/lib/level'
import { scriptForIntervention } from '@/lib/guide'
import { THEME } from '@/lib/theme'
import {
  api,
  isLoggedIn,
  type Intervention,
  type InterventionLog,
  type Level,
  type ScoreLevel,
  type StressScore,
} from '@/lib/api'
import './index.scss'

const LOG_LIMIT = 10

/** 工具库的四个分类（与后端 interventions.category 取值一致） */
const CATEGORIES: Intervention['category'][] = ['呼吸放松', '冥想练习', '音乐疗法', '视频指导']

const CATEGORY_ICON: Record<Intervention['category'], IconName> = {
  呼吸放松: 'wind',
  冥想练习: 'spa',
  音乐疗法: 'music',
  视频指导: 'video',
}

const STAR_LABELS = ['没什么帮助', '帮助较小', '一般', '有帮助', '很有帮助']

interface LevelThresholds {
  t_green: number
  t_red: number
}

/** 后端 app_config 缺失时的兜底阈值，与迁移里的默认值一致 */
const FALLBACK_THRESHOLDS: LevelThresholds = { t_green: 40, t_red: 70 }


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

  // 展开 / 完成流程：key = 分区 + 方案 id，避免同一方案在推荐区与工具区同时展开

  const load = useCallback(async () => {
    if (!isLoggedIn()) {
      Taro.reLaunch({ url: '/pages/login/index' })
      return
    }
    setLoading(true)
    setError('')
    try {
      const latest = await api.latestScore()
      // unknown 表示数据不足：不按分级推荐，避免拿「没数据」去匹配方案
      const level = latest?.level && latest.level !== 'unknown' ? latest.level : null
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
      setRecommended(
        latest?.level && latest.level !== 'unknown' ? await api.interventions(latest.level) : []
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : '数据刷新失败，请下拉重试')
    }
  }, [])

  useDidShow(() => {
    void load()
  })

  const level: ScoreLevel | null = score?.level ?? null
  const hps = score && Number.isFinite(score.hps) ? Math.min(100, Math.max(0, Math.round(score.hps))) : null
  const { t_green, t_red } = thresholds

  const groups: { category: string; icon: IconName; items: Intervention[] }[] = [
    ...CATEGORIES.map((category) => ({
      category,
      icon: CATEGORY_ICON[category],
      items: allItems.filter((item) => item.category === category),
    })),
    {
      category: '其他',
      icon: 'puzzle-piece' as const,
      items: allItems.filter((item) => !CATEGORIES.includes(item.category)),
    },
  ].filter((group) => group.items.length > 0)

  function startGuide(item: Intervention) {
    const script = scriptForIntervention(item)
    void Taro.navigateTo({
      url: `/pages/guide/index?sid=${encodeURIComponent(item.id)}&title=${encodeURIComponent(item.title)}&cat=${encodeURIComponent(item.category)}&script=${script.id}`,
    })
  }

  function renderIntervention(item: Intervention, section: string, compact: boolean) {
    const planMinutes = validMinutes(item.duration_min)
    return (
      <Card flush className="mg-it" key={`${section}-${item.id}`}>
        <View className="mg-it-head">
          <View className="mg-it-icon">
            <Icon name={CATEGORY_ICON[item.category] || 'spa'} size={44} color={THEME.primaryDark} />
          </View>
          <View className="mg-it-main">
            <Text className="mg-it-title">{item.title || '未命名方案'}</Text>
            <View className="mg-it-meta">
              <Pill tone="primary">{item.category || '其他'}</Pill>
              <Text className="mg-duration">{planMinutes === null ? '时长未标注' : `约 ${planMinutes} 分钟`}</Text>
            </View>
            {compact || !item.description ? null : (
              <Text className="mg-it-summary">{item.description}</Text>
            )}
          </View>
        </View>
        <Button variant="primary" block className="mg-start" onClick={() => startGuide(item)} ariaLabel={`开始：${item.title || '未命名方案'}`}>
          {`开始 · ${scriptForIntervention(item).title}`}
        </Button>
      </Card>
    )
  }

  return (
    <View className="page">
      <View className="page-pad">
        <PageHead title="压力管理" note="按您当前的压力状态，给出对应的放松方案" />

        {error ? (
          <StateBlock
            variant="error"
            compact
            className="mg-error"
            desc={error}
            actionLabel={loading ? undefined : '重新加载'}
            onAction={loading ? undefined : () => void load()}
          />
        ) : null}
        {/* ---------- 1. 当前状态 ---------- */}
        <Card className={`mg-hero ${level ? `level-${level}` : 'level-none'}`}>
          <View className="mg-hero-head">
            <Text className="mg-hero-label">当前状态</Text>
            <Pill tone={level ? levelTone(level) : 'primary'}>
              {level ? LEVEL_TITLE[level] : loading ? '评估中…' : '暂无评估'}
            </Pill>
          </View>

          <View className="mg-hps">
            <Text className="mg-hps-value">{hps === null ? '--' : hps}</Text>
            <Text className="mg-hps-unit">综合压力指数（HPS）</Text>
          </View>

          <Text className="mg-hero-desc">
            {level
              ? levelDesc(level)
              : loading
                ? '正在读取您最近的评估结果…'
                : '还没有评估结果，先到首页完成一次打卡，就能看到自己的压力状态。'}
          </Text>

          {level === 'red' ? (
            <View className="mg-urgent">
              <View className="mg-urgent-title">
                <Icon name="triangle-exclamation" size={32} color={THEME.red} />
                <Text>现在就做一件事</Text>
              </View>
              <Text className="mg-urgent-text">
                立即完成一次紧急放松（推荐下方「标红的紧急放松练习」），并考虑向家人或专业人员求助。
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
        </Card>

        {/* ---------- 2. 推荐方案 ---------- */}
        <SectionHeader
          title="为您推荐"
          action={<Text className="muted">{level ? '匹配当前状态' : '等待评估'}</Text>}
        />

        {loading ? (
          <StateBlock variant="loading" title="正在加载推荐方案…" />
        ) : recommended.length > 0 ? (
          <View>{recommended.map((item) => renderIntervention(item, 'rec', false))}</View>
        ) : (
          <StateBlock
            variant="empty"
            desc={
              level
                ? '当前状态暂时没有专属方案，可以到下方「全部工具」里挑一项试试。'
                : '还没有评估结果。先到首页完成一次打卡，这里会按您的状态推荐方案。'
            }
          />
        )}

        {/* ---------- 3. 全部工具 ---------- */}
        <SectionHeader title="全部工具" action={<Text className="muted">{allItems.length} 项</Text>} />

        {loading ? (
          <StateBlock variant="loading" title="正在加载工具库…" />
        ) : groups.length === 0 ? (
          <StateBlock variant="empty" desc="工具库暂时没有内容，请稍后重新加载。" />
        ) : (
          <View>
            {groups.map((group) => (
              <View key={group.category}>
                <View className="mg-group-head">
                  <View className="mg-group-name">
                    <Icon name={group.icon} size={30} color={THEME.ink2} />
                    <Text>{group.category}</Text>
                  </View>
                  <Text className="muted">{group.items.length} 项</Text>
                </View>
                {group.items.map((item) => renderIntervention(item, `cat-${group.category}`, true))}
              </View>
            ))}
          </View>
        )}

        {/* ---------- 4. 最近完成记录 ---------- */}
        <SectionHeader
          title="最近完成记录"
          action={<Text className="muted">最近 {LOG_LIMIT} 条</Text>}
        />

        {loading ? (
          <StateBlock variant="loading" title="正在加载完成记录…" />
        ) : logs.length === 0 ? (
          <StateBlock
            variant="empty"
            desc="还没有完成记录。完成一次练习后，这里会显示完成时间、实际时长和您给的效果评分。"
          />
        ) : (
          <View>
            {logs.map((log) => {
              const logStars = clampStars(log.feeling)
              const logMinutes = validMinutes(log.duration_actual)
              return (
                <Card className="mg-log" key={log.id}>
                  <View className="mg-log-main">
                    <Text className="mg-log-title">{log.title_snapshot || '未命名方案'}</Text>
                    <Text className="mg-log-meta">
                      {formatLogTime(log.completed_at)} ·{' '}
                      {logMinutes === null ? '时长未记录' : `${logMinutes} 分钟`}
                    </Text>
                  </View>
                  <View className="mg-log-stars">
                    <View className="mg-log-star-icons">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Icon
                          key={n}
                          name="star"
                          size={28}
                          color={n <= logStars ? THEME.yellow : THEME.starOff}
                        />
                      ))}
                    </View>
                    <Text className="mg-log-star-label">
                      {logStars > 0 ? STAR_LABELS[logStars - 1] : '未评价'}
                    </Text>
                  </View>
                </Card>
              )
            })}
          </View>
        )}
      </View>

      <BottomNav active="manage" />
    </View>
  )
}
