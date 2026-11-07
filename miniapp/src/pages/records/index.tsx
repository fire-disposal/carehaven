import { useCallback, useState } from 'react'
import { Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import Icon from '@/components/Icon'
import { Card, Pill, SectionHeader, StateBlock, TopBar } from '@/components/ui'
import { api, isLoggedIn, type Checkin, type InterventionLog } from '@/lib/api'
import { PAGE_TITLES } from '@/content/site'
import { THEME } from '@/lib/theme'
import { backOrSwitchTab } from '@/lib/nav'
import './index.scss'

// ---------- 文案表 ----------

const FEELING_TEXT: Record<number, string> = {
  1: '几乎没有缓解',
  2: '略有缓解',
  3: '有些缓解',
  4: '明显放松',
  5: '非常放松',
}

const DAY_MS = 86400000
const LOG_WINDOW_DAYS = 30
const LOG_PREVIEW = 5

// ---------- 工具函数 ----------

/** PocketBase 的日期形如 `2026-10-15 08:20:00.000Z`，空格换成 T 才能被各端 Date 解析 */
function toDate(raw: string): Date | null {
  if (!raw) return null
  const d = new Date(raw.includes(' ') ? raw.replace(' ', 'T') : raw)
  return Number.isNaN(d.getTime()) ? null : d
}

function fmtDateTime(raw: string): string {
  const d = toDate(raw)
  if (!d) return raw || '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 数值展示：字段缺失或非数字时给占位符，避免页面出现 undefined */
function showNum(value: unknown, digits = 0): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  return digits > 0 ? value.toFixed(digits) : String(Math.round(value))
}

/** 干预效果是 1–5 分，同时把缺失字段挡在类型之外 */
function isOneToFive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 5
}

/** 按自然日分组：同一「年-月-日」的打卡归到一组，顺序沿用后端给出的时间倒序 */
function groupByDay(list: Checkin[]): { key: string; label: string; items: Checkin[] }[] {
  const groups: { key: string; label: string; items: Checkin[] }[] = []
  for (const item of list) {
    const d = toDate(item.created || item.date)
    const key = d
      ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
      : (item.created || item.date || '').slice(0, 10)
    const label = d
      ? `${d.getMonth() + 1}月${d.getDate()}日`
      : (item.date || '').slice(0, 10) || '日期未知'
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.items.push(item)
    else groups.push({ key, label, items: [item] })
  }
  return groups
}

export default function RecordsPage() {
  const [checkins, setCheckins] = useState<Checkin[]>([])
  const [logs, setLogs] = useState<InterventionLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showAllLogs, setShowAllLogs] = useState(false)
  const [deletingId, setDeletingId] = useState('')

  const backProfile = () => {
    void backOrSwitchTab('/pages/profile/index')
  }

  const load = useCallback(async () => {
    if (!isLoggedIn()) {
      Taro.reLaunch({ url: '/pages/login/index' })
      return
    }
    setLoading(true)
    setError('')
    try {
      const [c, l] = await Promise.all([api.recentCheckins(14), api.interventionLogs(30)])
      setCheckins(c)
      setLogs(l)
    } catch (e) {
      setError(e instanceof Error ? e.message : '记录没能加载出来')
    } finally {
      setLoading(false)
    }
  }, [])

  useDidShow(() => {
    void load()
  })

  // 删除单条打卡：集合规则按 user 限定，删掉后从列表里移除即可
  async function deleteCheckin(item: Checkin) {
    if (deletingId) return
    const res = await Taro.showModal({
      title: '删除这条打卡？',
      content: `${fmtDateTime(item.created || item.date)} 的记录删除后无法恢复。`,
      confirmText: '删除',
      cancelText: '保留',
      confirmColor: THEME.red,
    }).catch(() => ({ confirm: false }))
    if (!res.confirm) return
    setDeletingId(item.id)
    try {
      await api.deleteCheckin(item.id)
      setCheckins((list) => list.filter((c) => c.id !== item.id))
      Taro.showToast({ title: '已删除', icon: 'none' })
    } catch (e) {
      Taro.showToast({ title: e instanceof Error ? e.message : '删除失败，请稍后再试', icon: 'none' })
    } finally {
      setDeletingId('')
    }
  }

  const windowStart = Date.now() - LOG_WINDOW_DAYS * DAY_MS
  const recentLogs = logs.filter((l) => {
    const d = toDate(l.completed_at)
    return d !== null && d.getTime() >= windowStart
  })
  const visibleLogs = showAllLogs ? recentLogs : recentLogs.slice(0, LOG_PREVIEW)
  const checkinGroups = groupByDay(checkins)

  return (
    <View className="page">
      <TopBar title={PAGE_TITLES.records} onBack={backProfile} backLabel="返回我的" />

      <View className="page-pad">
        {error ? (
          <StateBlock
            variant="error"
            compact={checkins.length > 0 || logs.length > 0}
            title={checkins.length > 0 || logs.length > 0 ? undefined : '记录没能加载出来'}
            desc={error}
            actionLabel="重新加载"
            onAction={() => void load()}
          />
        ) : null}

        {loading ? <StateBlock variant="loading" title="正在加载您的记录…" /> : null}

        {!loading && (!error || checkins.length > 0 || logs.length > 0) ? (
          <>
            {/* ---------- 打卡记录（按日分组） ---------- */}
            <SectionHeader
              title="打卡记录"
              action={
                <Text className="muted">
                  {checkins.length ? `最近 ${checkins.length} 次` : ''}
                </Text>
              }
            />

            {checkins.length === 0 ? (
              <StateBlock
                variant="empty"
                compact
                title="还没有打卡记录"
                desc="在首页记录一次，就会出现在这里。"
              />
            ) : (
              <View className="rc-days">
                {checkinGroups.map((group) => (
                  <Card flush className="rc-checkins" key={group.key}>
                    <View className="rc-day-head">
                      <Text className="rc-day-label">{group.label}</Text>
                      <Text className="rc-day-count">{group.items.length} 次</Text>
                    </View>
                    {group.items.map((item) => (
                      <View className="rc-checkin" key={item.id}>
                        <View className="rc-checkin-main">
                          <Text className="rc-checkin-title">
                            {fmtDateTime(item.created || item.date)} · 心情 {item.mood} · 焦虑{' '}
                            {item.anxiety} · 疲惫 {item.fatigue}
                          </Text>
                          <Text className="rc-checkin-meta">
                            睡眠 {item.sleep_hours} 小时 · 照护 {item.care_hours} 小时
                            {item.note ? ` · ${item.note}` : ''}
                          </Text>
                        </View>
                        <Pill tone="primary">
                          {item.period === 'morning' ? '日间' : '晚间'}
                        </Pill>
                        <View
                          className="rc-checkin-del"
                          onClick={() => void deleteCheckin(item)}
                          ariaRole="button"
                          ariaLabel={`删除 ${fmtDateTime(item.created || item.date)} 的打卡`}
                        >
                          <Icon
                            name="trash-can"
                            size={28}
                            color={deletingId === item.id ? THEME.muted : THEME.red}
                          />
                        </View>
                      </View>
                    ))}
                  </Card>
                ))}
              </View>
            )}

            {/* ---------- 干预记录 ---------- */}
            <SectionHeader
              title="干预记录"
              action={<Text className="muted">近 30 天 {recentLogs.length} 次</Text>}
            />

            {recentLogs.length === 0 ? (
              <StateBlock
                variant="empty"
                title="近 30 天还没有完成的减压练习"
                desc="前往「减压」页，挑一个适合此刻的方案做完并记录感受，这里会留下您的完成情况。"
                actionLabel="去减压"
                onAction={() => void Taro.switchTab({ url: '/pages/manage/index' })}
              />
            ) : (
              <Card className="rc-log-card">
                {visibleLogs.map((log, i) => (
                  <View className="rc-log-item" key={log.id || String(i)}>
                    <View className="rc-log-icon">
                      <Icon name="spa" size={34} color={THEME.primary} />
                    </View>
                    <View className="rc-log-main">
                      <Text className="rc-log-title">{log.title_snapshot || '减压练习'}</Text>
                      <Text className="rc-log-meta">
                        {fmtDateTime(log.completed_at)} · 用时 {showNum(log.duration_actual)} 分钟
                      </Text>
                      <Text className="rc-log-feel">
                        效果：
                        {isOneToFive(log.feeling) ? FEELING_TEXT[log.feeling] : '未评分'}
                      </Text>
                    </View>
                  </View>
                ))}

                {recentLogs.length > LOG_PREVIEW ? (
                  <View className="rc-expand-row" onClick={() => setShowAllLogs(!showAllLogs)}>
                    {showAllLogs ? '收起，只看最近 5 条' : `展开全部 ${recentLogs.length} 条`}
                  </View>
                ) : null}
              </Card>
            )}
          </>
        ) : null}
      </View>
    </View>
  )
}
