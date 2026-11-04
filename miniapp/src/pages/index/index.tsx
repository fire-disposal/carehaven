import { useCallback, useState } from 'react'
import { Input, Slider, Text, Textarea, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import BottomNav from '@/components/BottomNav'
import Icon from '@/components/Icon'
import { Button, Card, Pill, SectionHeader, Stat, StateBlock } from '@/components/ui'
import type { IconName } from '@/lib/icons'
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



const MOODS: { value: number; icon: IconName; label: string }[] = [
  { value: 1, icon: 'face-angry', label: '很糟' },
  { value: 2, icon: 'face-frown', label: '较差' },
  { value: 3, icon: 'face-meh', label: '一般' },
  { value: 4, icon: 'face-smile', label: '较好' },
  { value: 5, icon: 'face-grin-beam', label: '很好' },
]

type Prefill = { mood: number; anxiety: number; fatigue: number; sleep_hours: number; care_hours: number }

/** 上次提交的数值，用于下次打开表单时预填 */
function readPrefill(): Prefill | null {
  try {
    const raw = Taro.getStorageSync('zz_checkin_prefill')
    if (!raw) return null
    return JSON.parse(String(raw)) as Prefill
  } catch (e) {
    return null
  }
}

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
  const [showForm, setShowForm] = useState(false)

  // 打卡表单
  const prefill = readPrefill()
  const [mood, setMood] = useState(prefill?.mood ?? 3)
  const [anxiety, setAnxiety] = useState(prefill?.anxiety ?? 4)
  const [fatigue, setFatigue] = useState(prefill?.fatigue ?? 5)
  const [sleepHours, setSleepHours] = useState(String(prefill?.sleep_hours ?? 6.5))
  const [careHours, setCareHours] = useState(String(prefill?.care_hours ?? 8))
  const [note, setNote] = useState('')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

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

  async function submitCheckin() {
    if (saving) return
    const sleep = Number(sleepHours)
    const care = Number(careHours)
    if (!Number.isFinite(sleep) || sleep < 0 || sleep > 24) {
      setFormError('请填写 0–24 之间的睡眠时长')
      return
    }
    if (!Number.isFinite(care) || care < 0 || care > 24) {
      setFormError('请填写 0–24 之间的照护时长')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      const hour = new Date().getHours()
      await api.createCheckin({
        period: hour < 15 ? 'morning' : 'evening',
        mood,
        anxiety,
        fatigue,
        sleep_hours: sleep,
        care_hours: care,
        note,
      })
      Taro.setStorageSync(
        'zz_checkin_prefill',
        JSON.stringify({ mood, anxiety, fatigue, sleep_hours: sleep, care_hours: care })
      )
      setShowForm(false)
      setNote('')
      await load()
      Taro.showToast({ title: '打卡已记录，压力指数已更新', icon: 'none' })
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '提交失败')
    } finally {
      setSaving(false)
    }
  }

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
  const todayAssessed = sameLocalDay(latestAssessment?.created)
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
  const checkinSubtitle = latestAssessment
    ? `上次 ${latestAssessment.score} 分 · ${latestAssessment.flag ? '需关注' : latestAssessment.severity}`
    : '3 分钟了解自己'
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
          <View className="home-avatar" ariaHidden>
            <Text className="home-avatar-char">{(user?.name || '照').slice(0, 1)}</Text>
          </View>
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
                  <Text className="stress-scale">HPS · 0–100</Text>
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
                  onClick={() => setShowForm(!showForm)}
                  ariaLabel={todayChecked ? '再记录一次感受' : '记录此刻感受'}
                >
                  {todayChecked ? '再记一次' : '记录此刻'}
                </Button>
              </View>
            </View>

            {/* 打卡表单 */}
            {showForm ? (
              <Card className="checkin-form">
                <View className="form-head">
                  <Text className="form-title">此刻的心情</Text>
                  <View
                    className="form-close"
                    onClick={() => setShowForm(false)}
                    ariaRole="button"
                    ariaLabel="收起打卡表单"
                  >
                    <Icon name="xmark" size={30} color={THEME.muted} />
                  </View>
                </View>
                <View className="mood-row" ariaRole="radiogroup" ariaLabel="此刻的心情">
                  {MOODS.map((m) => (
                    <View
                      key={m.value}
                      className={`mood-item ${mood === m.value ? 'picked' : ''}`}
                      onClick={() => setMood(m.value)}
                      ariaRole="radio"
                      ariaChecked={mood === m.value}
                      ariaLabel={m.label}
                    >
                      <Icon name={m.icon} size={44} />
                      <Text className="mood-label">{m.label}</Text>
                    </View>
                  ))}
                </View>

                <View className="slider-row">
                  <View className="row-between">
                    <Text className="form-label">焦虑程度</Text>
                    <Text className="slider-value">{anxiety}</Text>
                  </View>
                  <Slider
                    min={0}
                    max={10}
                    step={1}
                    value={anxiety}
                    activeColor={THEME.primary}
                    backgroundColor={THEME.line}
                    blockColor={THEME.surface}
                    blockSize={22}
                    ariaLabel={`焦虑程度，当前 ${anxiety} 分，满分 10 分`}
                    ariaValuemin="0"
                    ariaValuemax="10"
                    ariaValuenow={String(anxiety)}
                    onChanging={(e) => setAnxiety(e.detail.value)}
                    onChange={(e) => setAnxiety(e.detail.value)}
                  />
                </View>

                <View className="slider-row">
                  <View className="row-between">
                    <Text className="form-label">疲惫程度</Text>
                    <Text className="slider-value">{fatigue}</Text>
                  </View>
                  <Slider
                    min={0}
                    max={10}
                    step={1}
                    value={fatigue}
                    activeColor={THEME.primary}
                    backgroundColor={THEME.line}
                    blockColor={THEME.surface}
                    blockSize={22}
                    ariaLabel={`疲惫程度，当前 ${fatigue} 分，满分 10 分`}
                    ariaValuemin="0"
                    ariaValuemax="10"
                    ariaValuenow={String(fatigue)}
                    onChanging={(e) => setFatigue(e.detail.value)}
                    onChange={(e) => setFatigue(e.detail.value)}
                  />
                </View>

                <View className="num-row">
                  <View className="num-field">
                    <Text className="form-label">昨夜睡眠（小时）</Text>
                    <Input
                      className="num-input"
                      type="digit"
                      value={sleepHours}
                      ariaLabel="昨夜睡眠时长，单位小时"
                      onInput={(e) => setSleepHours(e.detail.value)}
                    />
                  </View>
                  <View className="num-field">
                    <Text className="form-label">今日照护（小时）</Text>
                    <Input
                      className="num-input"
                      type="digit"
                      value={careHours}
                      ariaLabel="今日照护时长，单位小时"
                      onInput={(e) => setCareHours(e.detail.value)}
                    />
                  </View>
                </View>

                <Text className="form-label">想补充的话（可不填）</Text>
                <Textarea
                  className="note-area"
                  value={note}
                  maxlength={200}
                  placeholder="今天发生了什么让您感到压力的事？"
                  ariaLabel="想补充的话，可以不填"
                  onInput={(e) => setNote(e.detail.value)}
                />

                {formError ? (
                  <View className="form-error">
                    <StateBlock variant="error" compact title={formError} />
                  </View>
                ) : null}

                <View className="form-actions">
                  <Button variant="ghost" className="action" onClick={() => setShowForm(false)}>
                    取消
                  </Button>
                  <Button
                    variant="primary"
                    className="action"
                    loading={saving}
                    onClick={submitCheckin}
                  >
                    提交打卡
                  </Button>
                </View>
              </Card>
            ) : null}

            {/* 次级入口 */}
            {/* 今日完成度：三件事各一行，点一下去补 */}
            <View className="today-check">
              <View
                className={`today-check-item ${todayChecked ? 'done' : ''}`}
                onClick={() => (todayChecked ? undefined : setShowForm(true))}
                ariaRole="button"
                ariaLabel={todayChecked ? '今日已打卡' : '去打卡'}
              >
                <Text className="today-check-mark">{todayChecked ? '✓' : '○'}</Text>
                <Text className="today-check-label">打卡</Text>
              </View>
              <View
                className={`today-check-item ${todayPhysio ? 'done' : ''}`}
                onClick={() => Taro.switchTab({ url: '/pages/profile/index' })}
                ariaRole="button"
                ariaLabel={todayPhysio ? '今日已有生理数据' : '去补录生理数据'}
              >
                <Text className="today-check-mark">{todayPhysio ? '✓' : '○'}</Text>
                <Text className="today-check-label">生理</Text>
              </View>
              <View
                className={`today-check-item ${todayAssessed ? 'done' : ''}`}
                onClick={() => Taro.navigateTo({ url: '/pages/assessment/index' })}
                ariaRole="button"
                ariaLabel={todayAssessed ? '今日已完成量表' : '去做量表'}
              >
                <Text className="today-check-mark">{todayAssessed ? '✓' : '○'}</Text>
                <Text className="today-check-label">量表</Text>
              </View>
              <Text className="today-check-streak">连续 {streak} 天</Text>
            </View>

            <SectionHeader
              title="支持工具"
              action={<Text className="muted">按当前状态</Text>}
            />
            <View className="tool-grid">
              <View
                className="tool-tile tool-wide"
                onClick={() => Taro.navigateTo({ url: '/pages/assessment/index' })}
                ariaRole="button"
                ariaLabel={`量表自评，${checkinSubtitle}`}
              >
                <View className="tool-icon">
                  <Icon name="clipboard-list" size={36} />
                </View>
                <View className="tool-main">
                  <Text className="tool-title">量表自评</Text>
                  <Text className="tool-sub">{checkinSubtitle}</Text>
                </View>
                <Icon name="chevron-right" size={28} color={THEME.muted} />
              </View>
              <View
                className="tool-tile"
                onClick={() => Taro.redirectTo({ url: '/pages/manage/index' })}
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
                onClick={() => Taro.redirectTo({ url: '/pages/qa/index' })}
                ariaRole="button"
                ariaLabel="知识问答"
              >
                <View className="tool-icon tint-info">
                  <Icon name="comment-dots" size={36} />
                </View>
                <Text className="tool-title">知识问答</Text>
                <Text className="tool-sub">照护问题即时查</Text>
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
