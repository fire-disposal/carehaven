import { useCallback, useState } from 'react'
import { Image, Text, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import Icon from '@/components/Icon'
import BottomNav from '@/components/BottomNav'
import { Button, Card, Pill, SectionHeader, Stat, StateBlock } from '@/components/ui'
import type { IconName } from '@/lib/icons'
import { MOODS } from '@/lib/mood'
import { avatarById } from '@/lib/avatar'
import { levelLabel, levelTone } from '@/lib/level'
import { NO_SCORE_ADVICE, SOURCE_LABEL, SOURCE_NOTE } from '@/content/glossary'
import { THEME } from '@/lib/theme'
import {
  api,
  getUser,
  isLoggedIn,
  remove,
  type AssessmentRecord,
  type Checkin,
  type PhysioRecord,
  type StressScore,
} from '@/lib/api'
import './index.scss'




function greetingOf(hour: number): string {
  if (hour < 5) return '夜深了'
  if (hour < 11) return '早上好'
  if (hour < 13) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

/** 打卡记录的时间：有 created 用 created，旧数据退回 date */
function checkinTime(item: Checkin): string {
  const raw = item.created || item.date
  const date = new Date(raw.includes(' ') ? raw.replace(' ', 'T') : raw)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export default function HomePage() {
  const [score, setScore] = useState<StressScore | null>(null)
  const [physio, setPhysio] = useState<PhysioRecord | null>(null)
  const [checkins, setCheckins] = useState<Checkin[]>([])
  const [latestAssessment, setLatestAssessment] = useState<AssessmentRecord | null>(null)
  const [recent, setRecent] = useState<Checkin[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const load = useCallback(async () => {
    if (!isLoggedIn()) {
      Taro.reLaunch({ url: '/pages/login/index' })
      return
    }
    setLoading(true)
    setLoadError('')
    try {
      const [s, p, c, a, r] = await Promise.all([
        api.latestScore(),
        api.latestPhysio(),
        api.todayCheckins(),
        api.assessments(1).catch(() => [] as AssessmentRecord[]),
        api.recentCheckins(30).catch(() => [] as Checkin[]),
      ])
      setScore(s)
      setPhysio(p)
      setCheckins(c)
      setLatestAssessment(a[0] || null)
      setRecent(r)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '数据加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useDidShow(() => {
    void load()
  })

  // index.config.ts 开了 enablePullDownRefresh，下拉手势接这里
  usePullDownRefresh(() => {
    void load().finally(() => Taro.stopPullDownRefresh())
  })

  async function deleteCheckin(id: string) {
    const res = await Taro.showModal({
      title: '删除这条打卡',
      content: '删除后当天指数会重新计算，操作不可恢复。',
      confirmText: '删除',
    }).catch(() => ({ confirm: false }))
    if (!res.confirm) return
    try {
      await remove('checkins', id)
      await load()
      Taro.showToast({ title: '已删除', icon: 'none' })
    } catch (e) {
      Taro.showToast({ title: e instanceof Error ? e.message : '删除失败', icon: 'none' })
    }
  }

  const user = getUser()
  const todayChecked = checkins.length > 0
  const sameLocalDay = (raw: string | undefined) => {
    if (!raw) return false
    const d = new Date(raw.includes(' ') ? raw.replace(' ', 'T') : raw)
    if (Number.isNaN(d.getTime())) return false
    return d.toDateString() === new Date().toDateString()
  }
  const todayPhysio = sameLocalDay(physio?.date)
  // 量表是「每周一次」：7 天内做过就算已完成，而不是只看当天
  const assessmentTime = latestAssessment
    ? new Date(latestAssessment.created.replace(' ', 'T')).getTime()
    : NaN
  const assessedThisWeek =
    Number.isFinite(assessmentTime) && Date.now() - assessmentTime < 7 * 86400000
  const streak = (() => {
    const days = new Set(
      recent
        .map((item) => new Date((item.created || item.date || '').replace(' ', 'T')))
        .filter((d) => !Number.isNaN(d.getTime()))
        .map((d) => d.toDateString())
    )
    let count = 0
    const cursor = new Date()
    // 今天没打卡时，从昨天开始算，避免早上打开就断签
    if (!days.has(cursor.toDateString())) cursor.setDate(cursor.getDate() - 1)
    while (days.has(cursor.toDateString())) {
      count += 1
      cursor.setDate(cursor.getDate() - 1)
    }
    return count
  })()
  const level = score?.level ?? null
  const now = new Date()
  const greeting = greetingOf(now.getHours())
  const todayText = now.toLocaleDateString('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  })
  // 首次加载才铺骨架；下拉刷新时保留旧内容，避免整页闪一下
  const firstLoad = loading && score === null && physio === null && checkins.length === 0

  return (
    <View className="page">
      <View className="page-pad">
        <View className="home-head">
          <View className="home-hello">
            <Text className="eyebrow">今日 · {todayText}</Text>
            <Text className="hello-name">
              {greeting}，{user?.name || '照护者'}
            </Text>
          </View>
          <Image
            className="home-avatar"
            src={avatarById(user?.avatar_preset).src}
            mode="aspectFill"
            onClick={() => void Taro.switchTab({ url: '/pages/profile/index' })}
            ariaRole="button"
            ariaLabel="打开我的"
          />
        </View>

        {firstLoad ? <StateBlock variant="loading" title="正在加载今日状态…" /> : null}

        {loadError ? (
          <StateBlock
            variant="error"
            title={loadError}
            actionLabel="重新加载"
            onAction={() => void load()}
          />
        ) : null}

        {firstLoad ? null : (
          <>
            {/* 压力状态 + 打卡主入口 */}
            <View className={`stress-card level-${level ?? 'unknown'}`}>
              <View className="stress-head">
                <Text className="eyebrow">今日压力状态</Text>
                <Pill tone={levelTone(level)}>{levelLabel(level)}</Pill>
              </View>
              <View className="stress-body">
                <Text className="stress-value">{score ? score.hps.toFixed(0) : '--'}</Text>
                <View className="stress-unit-wrap">
                  <Text className="stress-unit">综合压力指数</Text>
                  <Text className="stress-scale">0–100</Text>
                </View>
              </View>
              <Text className="stress-advice">
                {score?.advice || NO_SCORE_ADVICE}
              </Text>
              <View className="stress-bars">
                {(['score_physio', 'score_psycho', 'score_context'] as const).map((key) => {
                  const label =
                    key === 'score_physio' ? '生理' : key === 'score_psycho' ? '心理' : '生活'
                  // 缺分量的 0 是「没采集」，不是「压力为 0」：显示 -- 而不是 0
                  const collected =
                    score?.coverage === undefined
                      ? Boolean(score)
                      : key === 'score_physio'
                        ? score.coverage.physio
                        : key === 'score_psycho'
                          ? score.coverage.psycho
                          : score.coverage.context
                  const value = score && collected ? score[key] : null
                  return (
                    <View className="stress-bar-item" key={key}>
                      <Stat label={label} value={value === null ? '--' : value.toFixed(0)} />
                      <View className="bar-track">
                        <View
                          className="bar-fill"
                          style={{ width: `${value === null ? 0 : value}%` }}
                        />
                      </View>
                    </View>
                  )
                })}
              </View>

              <View className="stress-foot">
                <View className="stress-checkin-state">
                  <Icon name="calendar-days" size={26} color={THEME.muted} />
                  <Text>
                    今日{checkins.length ? `已记录 ${checkins.length} 次` : '还没有记录'}
                  </Text>
                </View>
                <Button
                  variant="primary"
                  className="stress-cta"
                  onClick={() => void Taro.navigateTo({ url: '/pages/checkin/index' })}
                  ariaLabel={todayChecked ? '再记录一次感受' : '记录此刻感受'}
                >
                  {todayChecked ? '再记一次' : '记录此刻'}
                </Button>
              </View>
            </View>

            {/* 今日安排：三件事各一行，写清「做什么、为什么」，已完成的有勾选 */}
            <SectionHeader
              title="今日安排"
              action={<Text className="muted">连续 {streak} 天</Text>}
            />
            <Card flush className="plan">
              <View
                className={`plan-row ${todayChecked ? 'is-done' : ''}`}
                onClick={() => void Taro.navigateTo({ url: '/pages/checkin/index' })}
                ariaRole="button"
                ariaLabel={todayChecked ? `今日已记录 ${checkins.length} 次，再记一次` : '记录此刻心情'}
              >
                <View className="plan-icon">
                  <Icon name="calendar-days" size={36} />
                </View>
                <View className="plan-main">
                  <Text className="plan-title">记录此刻心情</Text>
                  <Text className="plan-sub">
                    {todayChecked ? `今天已记录 ${checkins.length} 次，可以补充` : '两分钟，记下现在的感受'}
                  </Text>
                </View>
                {todayChecked ? (
                  <Icon name="circle-check" size={36} color={THEME.green} />
                ) : (
                  <Icon name="chevron-right" size={28} color={THEME.muted} />
                )}
              </View>
              <View
                className={`plan-row ${todayPhysio ? 'is-done' : ''}`}
                onClick={() =>
                  void Taro.navigateTo({ url: '/pages/account/index?focus=physio' })
                }
                ariaRole="button"
                ariaLabel={todayPhysio ? '今日已有生理数据，可继续补录' : '去补录生理数据'}
              >
                <View className="plan-icon">
                  <Icon name="heart-pulse" size={36} />
                </View>
                <View className="plan-main">
                  <Text className="plan-title">生理数据</Text>
                  <Text className="plan-sub">
                    {todayPhysio ? '今天已有记录，可以继续补录' : '睡眠、心率等，手动填写也可以'}
                  </Text>
                </View>
                {todayPhysio ? (
                  <Icon name="circle-check" size={36} color={THEME.green} />
                ) : (
                  <Icon name="chevron-right" size={28} color={THEME.muted} />
                )}
              </View>
              <View
                className={`plan-row ${assessedThisWeek ? 'is-done' : ''}`}
                onClick={() => Taro.navigateTo({ url: '/pages/assessment/index' })}
                ariaRole="button"
                ariaLabel={assessedThisWeek ? '本周已完成量表，可回看结果' : '去做量表自评'}
              >
                <View className="plan-icon">
                  <Icon name="clipboard-list" size={36} />
                </View>
                <View className="plan-main">
                  <Text className="plan-title">量表自评</Text>
                  <Text className="plan-sub">
                    {assessedThisWeek && latestAssessment
                      ? `上次 ${latestAssessment.score} 分，本周已完成`
                      : '每周一次，跟踪照护负担与情绪'}
                  </Text>
                </View>
                {assessedThisWeek ? (
                  <Icon name="circle-check" size={36} color={THEME.green} />
                ) : (
                  <Icon name="chevron-right" size={28} color={THEME.muted} />
                )}
              </View>
            </Card>

            <SectionHeader title="支持工具" />
            <View className="tool-grid">
              <View
                className="tool-tile"
                onClick={() => void Taro.switchTab({ url: '/pages/manage/index' })}
                ariaRole="button"
                ariaLabel="减压练习"
              >
                <View className="tool-icon tint-warm">
                  <Icon name="spa" size={36} />
                </View>
                <Text className="tool-title">减压练习</Text>
                <Text className="tool-sub">按当前状态推荐</Text>
              </View>
              <View
                className="tool-tile"
                onClick={() => void Taro.switchTab({ url: '/pages/qa/index' })}
                ariaRole="button"
                ariaLabel="知识问答"
              >
                <View className="tool-icon tint-info">
                  <Icon name="comment-dots" size={36} />
                </View>
                <Text className="tool-title">知识问答</Text>
                <Text className="tool-sub">照护问题即时查</Text>
              </View>
              <View
                className="tool-tile"
                onClick={() => void Taro.switchTab({ url: '/pages/community/index' })}
                ariaRole="button"
                ariaLabel="互助留言"
              >
                <View className="tool-icon">
                  <Icon name="users" size={36} />
                </View>
                <Text className="tool-title">互助留言</Text>
                <Text className="tool-sub">和同路人互相打气</Text>
              </View>
            </View>

            {/* 今日记录 */}
            {checkins.length > 0 ? (
              <>
                <SectionHeader
                  title="今日记录"
                  action={<Text className="muted">{checkins.length} 次打卡</Text>}
                />
                <Card flush className="today-list">
                  {checkins.map((item) => {
                    const m = MOODS.find((x) => x.value === item.mood) || MOODS[2]
                    return (
                      <View className="today-item" key={item.id}>
                        <View className="today-icon">
                          <Icon name={m.icon} size={32} color={THEME.primary} />
                        </View>
                        <View className="today-main">
                          <Text className="today-title">
                            {m.label} · 焦虑 {item.anxiety} · 疲惫 {item.fatigue}
                          </Text>
                          <Text className="today-meta">
                            {checkinTime(item)} · 睡眠 {item.sleep_hours} 小时 · 照护 {item.care_hours} 小时
                          </Text>
                        </View>
                        <Pill tone="primary">{item.period === 'morning' ? '日间' : '晚间'}</Pill>
                        <Text
                          className="today-del"
                          onClick={() => void deleteCheckin(item.id)}
                          ariaRole="button"
                          ariaLabel="删除这条打卡"
                        >
                          删除
                        </Text>
                      </View>
                    )
                  })}
                </Card>
              </>
            ) : null}

            {/* 身体状态 */}
            <SectionHeader
              title="身体状态"
              action={
                <Text className="muted">{physio ? SOURCE_LABEL[physio.source] : '暂无记录'}</Text>
              }
            />
            <View className="physio-grid">
              {[
                {
                  name: 'HRV',
                  icon: 'heart-pulse' as IconName,
                  value: physio ? `${physio.hrv}` : '--',
                  unit: 'ms',
                },
                {
                  name: 'GSR',
                  icon: 'wind' as IconName,
                  value: physio ? `${physio.gsr}` : '--',
                  unit: 'µS',
                },
                {
                  name: '睡眠质量',
                  icon: 'bed' as IconName,
                  value: physio ? `${physio.sleep_quality}` : '--',
                  unit: '分',
                },
                {
                  name: '活动量',
                  icon: 'person-walking' as IconName,
                  value: physio ? `${physio.steps}` : '--',
                  unit: '步',
                },
              ].map((item) => (
                <Card className="physio-tile" key={item.name}>
                  <View className="physio-head">
                    <View className="physio-icon">
                      <Icon name={item.icon} size={24} color={THEME.muted} />
                    </View>
                    <Stat
                      label={item.name}
                      value={item.value}
                      unit={item.unit}
                      className="physio-stat"
                    />
                  </View>
                </Card>
              ))}
            </View>
            {physio?.source === 'simulated' ? (
              <Text className="source-note">{SOURCE_NOTE.simulated}</Text>
            ) : null}
          </>
        )}
      </View>

      <BottomNav active="index" />
    </View>
  )
}
