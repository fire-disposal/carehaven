import { useCallback, useState } from 'react'
import { Input, ScrollView, Text, Textarea, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import BottomNav from '@/components/BottomNav'
import { DEVICE_PROFILES } from '@/lib/ble'
import {
  api,
  getUser,
  isLoggedIn,
  logout,
  type InterventionLog,
  type Level,
  type PhysioRecord,
  type Rating,
  type StressScore,
} from '@/lib/api'
import './index.scss'

// ---------- 文案表 ----------

const LEVEL_TEXT: Record<Level, string> = { green: '平稳', yellow: '预警', red: '偏高' }
const LEVEL_RANGE: Record<Level, string> = { green: '0–39', yellow: '40–69', red: '70–100' }
const LEVEL_KEYS: Level[] = ['green', 'yellow', 'red']

const FEELING_TEXT: Record<number, string> = {
  1: '几乎没有缓解',
  2: '略有缓解',
  3: '有些缓解',
  4: '明显放松',
  5: '非常放松',
}

const STARS_TEXT: Record<number, string> = {
  1: '很不满意',
  2: '不太满意',
  3: '一般',
  4: '比较满意',
  5: '非常满意',
}

const SOURCE_TEXT: Record<PhysioRecord['source'], string> = {
  device: '设备采集',
  simulated: '模拟数据',
  manual: '手动录入',
}

/** pill 配色：模拟数据用黄色提醒，手动录入用主色，设备采集用绿色 */
const SOURCE_PILL: Record<PhysioRecord['source'], string> = {
  device: 'green',
  simulated: 'yellow',
  manual: 'primary',
}

/**
 * 来源说明：按 README 的数据来源声明如实标注，
 * 模拟数据不得描述为设备采集，手动录入也不得说成自动采集。
 */
const SOURCE_NOTE: Record<PhysioRecord['source'], string> = {
  device: '由已登记的蓝牙设备同步写入。',
  simulated:
    '这是模拟数据（由生理学约束生成的合成数据，用于验证系统链路），不是可穿戴设备真实采集的结果，请不要当成真实测量值引用。',
  manual: '这是您手动录入的自报数据，不是设备自动采集。',
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

/** 干预效果 / 星级都是 1–5 分，同时把缺失字段挡在类型之外 */
function isOneToFive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 5
}

/** 数据来源是三个固定取值，异常值不冒充设备采集 */
function isPhysioSource(value: unknown): value is PhysioRecord['source'] {
  return value === 'device' || value === 'simulated' || value === 'manual'
}

export default function ProfilePage() {
  const [scores, setScores] = useState<StressScore[]>([])
  const [logs, setLogs] = useState<InterventionLog[]>([])
  const [ratings, setRatings] = useState<Rating[]>([])
  const [physio, setPhysio] = useState<PhysioRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showAllLogs, setShowAllLogs] = useState(false)

  // 星级反馈
  const [stars, setStars] = useState(0)
  const [comment, setComment] = useState('')
  const [ratingError, setRatingError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // 手动录入生理数据
  const [hrv, setHrv] = useState('')
  const [gsr, setGsr] = useState('')
  const [sleepQuality, setSleepQuality] = useState('')
  const [steps, setSteps] = useState('')
  const [physioError, setPhysioError] = useState('')
  const [physioDone, setPhysioDone] = useState(false)
  const [savingPhysio, setSavingPhysio] = useState(false)

  const load = useCallback(async () => {
    if (!isLoggedIn()) {
      Taro.reLaunch({ url: '/pages/login/index' })
      return
    }
    setLoading(true)
    setError('')
    try {
      const [s, l, r, p] = await Promise.all([
        api.scores(30),
        api.interventionLogs(30),
        api.ratings(),
        api.latestPhysio(),
      ])
      setScores(s)
      setLogs(l)
      setRatings(r)
      setPhysio(p)
    } catch (e) {
      setError(e instanceof Error ? e.message : '数据加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useDidShow(() => {
    void load()
  })

  usePullDownRefresh(() => {
    void load().finally(() => Taro.stopPullDownRefresh())
  })

  // ---------- 近 30 天统计（全部由真实数据算出） ----------

  const countDays = scores.length
  const counts: Record<Level, number> = { green: 0, yellow: 0, red: 0 }
  let hpsSum = 0
  let hpsDays = 0
  let peakIndex = -1
  let peakValue = 0

  for (let i = 0; i < scores.length; i += 1) {
    const s = scores[i]
    if (typeof s.hps === 'number' && Number.isFinite(s.hps)) {
      hpsSum += s.hps
      hpsDays += 1
      if (peakIndex < 0 || s.hps > peakValue) {
        peakValue = s.hps
        peakIndex = i
      }
    }
    if (s.level === 'green' || s.level === 'yellow' || s.level === 'red') {
      counts[s.level] += 1
    }
  }

  const avgHps = hpsDays > 0 ? hpsSum / hpsDays : null
  const peak = peakIndex >= 0 ? scores[peakIndex] : null

  const windowStart = Date.now() - LOG_WINDOW_DAYS * DAY_MS
  const recentLogs = logs.filter((l) => {
    const d = toDate(l.completed_at)
    return d !== null && d.getTime() >= windowStart
  })
  const feelings = recentLogs.map((l) => l.feeling).filter(isOneToFive)
  const avgFeeling = feelings.length
    ? feelings.reduce((a, b) => a + b, 0) / feelings.length
    : null

  const starValues = ratings.map((r) => r.stars).filter(isOneToFive)
  const avgStars = starValues.length
    ? starValues.reduce((a, b) => a + b, 0) / starValues.length
    : null

  const peakDate = peak ? toDate(peak.date) : null
  const peakDayText = peakDate
    ? `${peakDate.getMonth() + 1}月${peakDate.getDate()}日`
    : peak?.date || '—'

  // 首 / 中 / 末三根柱子下面标日期刻度
  const tickLabels = scores.map(() => '')
  if (countDays) {
    const ticks = new Set([0, Math.floor((countDays - 1) / 2), countDays - 1])
    ticks.forEach((i) => {
      const d = toDate(scores[i].date)
      tickLabels[i] = d ? `${d.getMonth() + 1}/${d.getDate()}` : ''
    })
  }

  const visibleLogs = showAllLogs ? recentLogs : recentLogs.slice(0, LOG_PREVIEW)

  const hasAnyData =
    scores.length > 0 || logs.length > 0 || ratings.length > 0 || physio !== null

  // ---------- 交互 ----------

  function confirmLogout() {
    Taro.showModal({
      title: '确认退出登录？',
      content: '退出后需要重新输入邮箱和密码才能进入，已记录的数据不会丢失。',
      confirmText: '退出登录',
      cancelText: '再想想',
      confirmColor: '#A83A34',
    })
      .then((res) => {
        if (res.confirm) logout()
      })
      .catch(() => {
        // 弹窗被系统打断时忽略，用户可再次点击退出
      })
  }

  async function submitRating() {
    if (submitting) return
    if (stars < 1) {
      setRatingError('请先选择 1–5 星，再提交反馈')
      return
    }
    setSubmitting(true)
    setRatingError('')
    try {
      await api.createRating({ target: 'app', stars, comment: comment.trim() })
      setStars(0)
      setComment('')
      setRatings(await api.ratings())
      Taro.showToast({ title: '反馈已提交，谢谢您', icon: 'none' })
    } catch (e) {
      setRatingError(e instanceof Error ? e.message : '提交失败，请稍后再试')
    } finally {
      setSubmitting(false)
    }
  }

  async function submitPhysio() {
    if (savingPhysio) return
    if (hrv.trim() === '' || gsr.trim() === '' || sleepQuality.trim() === '' || steps.trim() === '') {
      setPhysioError('四项都请填写，填不出的可以先估算一个大概值')
      return
    }
    const hrvValue = Number(hrv)
    const gsrValue = Number(gsr)
    const sleepValue = Number(sleepQuality)
    const stepsValue = Number(steps)

    if (!Number.isFinite(hrvValue) || hrvValue <= 0 || hrvValue > 200) {
      setPhysioError('HRV 请填写 1–200 之间的数值（单位：毫秒）')
      return
    }
    if (!Number.isFinite(gsrValue) || gsrValue <= 0 || gsrValue > 50) {
      setPhysioError('GSR 请填写 0.1–50 之间的数值（单位：微西门子）')
      return
    }
    if (!Number.isFinite(sleepValue) || sleepValue < 0 || sleepValue > 100) {
      setPhysioError('睡眠质量请填写 0–100 之间的分数（越高睡得越好）')
      return
    }
    if (!Number.isFinite(stepsValue) || stepsValue < 0 || stepsValue > 100000) {
      setPhysioError('步数请填写 0–100000 之间的整数')
      return
    }

    setSavingPhysio(true)
    setPhysioError('')
    setPhysioDone(false)
    try {
      await api.createPhysioRecord({
        hrv: hrvValue,
        gsr: gsrValue,
        sleep_quality: Math.round(sleepValue),
        steps: Math.round(stepsValue),
        source: 'manual',
      })
      setHrv('')
      setGsr('')
      setSleepQuality('')
      setSteps('')
      setPhysioDone(true)
      // 手动数据写入后压力指数会重算，这里同步刷新
      const [p, s] = await Promise.all([api.latestPhysio(), api.scores(30)])
      setPhysio(p)
      setScores(s)
      Taro.showToast({ title: '已写入，压力指数会随生理数据更新', icon: 'none' })
    } catch (e) {
      setPhysioError(e instanceof Error ? e.message : '写入失败，请稍后再试')
    } finally {
      setSavingPhysio(false)
    }
  }

  const user = getUser()
  const source = physio && isPhysioSource(physio.source) ? physio.source : null

  return (
    <View className="page">
      <View className="page-pad">
        {/* ---------- 用户卡 ---------- */}
        <View className="card">
          <View className="pf-user-top">
            <View className="pf-avatar">🌿</View>
            <View className="pf-user-info">
              <Text className="pf-user-name">{user?.name || '照护者'}</Text>
              <Text className="pf-user-email">{user?.email || '未获取到邮箱'}</Text>
            </View>
          </View>
          <Text className="pf-user-hint">
            当前为内部原型环境，数据保存在本机服务器；请勿在此填写真实身份信息。
          </Text>
          <View className="btn-ghost pf-logout" onClick={confirmLogout}>
            退出登录
          </View>
        </View>

        {error && hasAnyData ? <Text className="pf-error-line">{error}</Text> : null}

        {loading ? (
          <View className="card">
            <Text className="muted">正在加载您的记录…</Text>
          </View>
        ) : null}

        {!loading && error && !hasAnyData ? (
          <View className="card pf-error-card">
            <Text className="pf-error-title">记录没能加载出来</Text>
            <Text className="pf-error-desc">{error}</Text>
            <View className="btn-ghost pf-retry" onClick={() => void load()}>
              重新加载
            </View>
          </View>
        ) : null}

        {!loading && (!error || hasAnyData) ? (
          <>
            {/* ---------- 30 天压力趋势（CSS 柱状图） ---------- */}
            <View className="section-title">
              <Text>压力趋势</Text>
              <Text className="muted">{countDays ? `近 ${countDays} 天` : '暂无数据'}</Text>
            </View>

            {countDays === 0 ? (
              <View className="card">
                <Text className="pf-empty-title">还没有压力评估记录</Text>
                <Text className="pf-empty-desc">
                  在首页完成一次打卡，系统就会算出当天的压力指数，这里便能看到 30 天的变化曲线。
                </Text>
                <View
                  className="btn-ghost pf-empty-action"
                  onClick={() => Taro.redirectTo({ url: '/pages/index/index' })}
                >
                  去首页打卡
                </View>
              </View>
            ) : (
              <View className="card pf-chart-card">
                <ScrollView scrollX className="pf-chart-scroll">
                  <View className="pf-chart-inner">
                    {scores.map((s, i) => {
                      const value =
                        typeof s.hps === 'number' && Number.isFinite(s.hps)
                          ? Math.max(0, Math.min(100, s.hps))
                          : null
                      const lv: Level =
                        s.level === 'yellow' || s.level === 'red' ? s.level : 'green'
                      return (
                        <View
                          key={s.id || String(i)}
                          className={`pf-chart-col ${i === peakIndex ? 'is-peak' : ''}`}
                        >
                          <Text className="pf-bar-val">
                            {value === null ? '--' : value.toFixed(0)}
                          </Text>
                          <View className="pf-bar-track">
                            <View
                              className={`pf-bar-fill lv-${lv}`}
                              style={{ height: `${value === null ? 0 : Math.max(3, value)}%` }}
                            />
                          </View>
                          <Text className="pf-bar-date">{tickLabels[i]}</Text>
                        </View>
                      )
                    })}
                  </View>
                </ScrollView>
                <Text className="pf-chart-hint">
                  左右滑动可看全部 {countDays} 天；柱高 = 当天 HPS ÷ 100，日期刻度标在首 / 中 / 末
                </Text>
                <View className="pf-legend">
                  {LEVEL_KEYS.map((k) => (
                    <View className="pf-legend-item" key={k}>
                      <View className={`pf-legend-dot pf-dot-${k}`} />
                      <Text className="pf-legend-text">
                        {LEVEL_TEXT[k]} {LEVEL_RANGE[k]}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* ---------- 近 30 天摘要 ---------- */}
            <View className="section-title">
              <Text>近 30 天摘要</Text>
              <Text className="muted">{hpsDays ? `已统计 ${hpsDays} 天` : '暂无数据'}</Text>
            </View>

            {countDays === 0 ? (
              <View className="card">
                <Text className="muted">
                  有了压力记录之后，这里会自动汇总平均压力、最高的一天与三色天数。
                </Text>
              </View>
            ) : (
              <View className="pf-stat-grid">
                <View className="pf-stat-tile">
                  <Text className="pf-stat-name">平均压力指数</Text>
                  <View className="pf-stat-value-row">
                    <Text className="pf-stat-value">
                      {avgHps === null ? '--' : avgHps.toFixed(1)}
                    </Text>
                    <Text className="pf-stat-unit">HPS</Text>
                  </View>
                  <Text className="pf-stat-hint">{hpsDays} 天的平均值</Text>
                </View>

                <View className="pf-stat-tile">
                  <Text className="pf-stat-name">平均效果评分</Text>
                  <View className="pf-stat-value-row">
                    <Text className="pf-stat-value">
                      {avgFeeling === null ? '--' : avgFeeling.toFixed(1)}
                    </Text>
                    <Text className="pf-stat-unit">/ 5</Text>
                  </View>
                  <Text className="pf-stat-hint">
                    {feelings.length ? `干预后自评，共 ${feelings.length} 次` : '还没有评分'}
                  </Text>
                </View>

                <View className="pf-stat-tile">
                  <Text className="pf-stat-name">干预次数</Text>
                  <View className="pf-stat-value-row">
                    <Text className="pf-stat-value">{recentLogs.length}</Text>
                    <Text className="pf-stat-unit">次</Text>
                  </View>
                  <Text className="pf-stat-hint">近 30 天完成的减压练习</Text>
                </View>

                <View className="pf-stat-tile">
                  <Text className="pf-stat-name">平均星级反馈</Text>
                  <View className="pf-stat-value-row">
                    <Text className="pf-stat-value">
                      {avgStars === null ? '--' : avgStars.toFixed(1)}
                    </Text>
                    <Text className="pf-stat-unit">星</Text>
                  </View>
                  <Text className="pf-stat-hint">
                    {starValues.length ? `来自 ${starValues.length} 条反馈` : '还没有反馈'}
                  </Text>
                </View>

                <View className="pf-stat-tile wide">
                  <Text className="pf-stat-name">最高的一天</Text>
                  {peak && peakIndex >= 0 ? (
                    <>
                      <View className="pf-stat-value-row">
                        <Text className="pf-stat-value">{peakValue.toFixed(0)}</Text>
                        <Text className="pf-stat-unit">
                          HPS · {peakDayText}
                          {peak.level === 'green' || peak.level === 'yellow' || peak.level === 'red'
                            ? ` · ${LEVEL_TEXT[peak.level]}`
                            : ''}
                        </Text>
                      </View>
                      <Text className="pf-stat-hint">
                        压力最高的一天往往也是最需要留出休息时间的一天。
                      </Text>
                    </>
                  ) : (
                    <Text className="pf-stat-hint">暂无有效数值</Text>
                  )}
                </View>

                <View className="pf-stat-tile wide">
                  <Text className="pf-stat-name">三色天数分布</Text>
                  <View className="pf-stat-pills">
                    {LEVEL_KEYS.map((k) => (
                      <Text className={`pill pill-${k}`} key={k}>
                        {LEVEL_TEXT[k]} {counts[k]} 天
                      </Text>
                    ))}
                  </View>
                  <Text className="pf-stat-hint">
                    绿 / 黄 / 红分别对应 HPS 的 {LEVEL_RANGE.green}、{LEVEL_RANGE.yellow}、
                    {LEVEL_RANGE.red}
                  </Text>
                </View>
              </View>
            )}

            {/* ---------- 干预记录 ---------- */}
            <View className="section-title">
              <Text>干预记录</Text>
              <Text className="muted">近 30 天 {recentLogs.length} 次</Text>
            </View>

            {recentLogs.length === 0 ? (
              <View className="card">
                <Text className="pf-empty-title">近 30 天还没有完成的减压练习</Text>
                <Text className="pf-empty-desc">
                  前往「减压」页，挑一个适合此刻的方案做完并记录感受，这里会留下您的完成情况。
                </Text>
                <View
                  className="btn-ghost pf-empty-action"
                  onClick={() => Taro.redirectTo({ url: '/pages/manage/index' })}
                >
                  去减压
                </View>
              </View>
            ) : (
              <View className="card pf-log-card">
                {visibleLogs.map((log, i) => (
                  <View className="pf-log-item" key={log.id || String(i)}>
                    <Text className="pf-log-icon">🧘</Text>
                    <View className="pf-log-main">
                      <Text className="pf-log-title">{log.title_snapshot || '减压练习'}</Text>
                      <Text className="pf-log-meta">
                        {fmtDateTime(log.completed_at)} · 用时{' '}
                        {showNum(log.duration_actual)} 分钟
                      </Text>
                      <Text className="pf-log-feel">
                        效果：
                        {isOneToFive(log.feeling)
                          ? FEELING_TEXT[log.feeling]
                          : '未评分'}
                      </Text>
                    </View>
                  </View>
                ))}

                {recentLogs.length > LOG_PREVIEW ? (
                  <View className="pf-expand-row" onClick={() => setShowAllLogs(!showAllLogs)}>
                    {showAllLogs
                      ? '收起，只看最近 5 条'
                      : `展开全部 ${recentLogs.length} 条`}
                  </View>
                ) : null}
              </View>
            )}

            {/* ---------- 星级反馈 ---------- */}
            <View className="section-title">
              <Text>反馈与建议</Text>
              <Text className="muted">历史 {ratings.length} 条</Text>
            </View>

            <View className="card-lg">
              <Text className="pf-form-title">您觉得这个程序好用吗？</Text>
              <View className="pf-star-row">
                {[1, 2, 3, 4, 5].map((n) => (
                  <View
                    key={n}
                    className={`pf-star-item ${stars >= n ? 'picked' : ''}`}
                    onClick={() => {
                      setStars(n)
                      setRatingError('')
                    }}
                  >
                    <Text className="pf-star-icon">{stars >= n ? '★' : '☆'}</Text>
                  </View>
                ))}
              </View>
              <Text className="pf-star-note">
                {stars > 0 ? `${stars} 星 · ${STARS_TEXT[stars]}` : '请选择 1–5 星'}
              </Text>

              <Text className="pf-form-label">想说的话（可不填）</Text>
              <Textarea
                className="pf-textarea"
                value={comment}
                maxlength={200}
                placeholder="哪里好用、哪里让您困惑，或者希望增加什么功能，都欢迎写下来。"
                onInput={(e) => setComment(e.detail.value)}
              />

              {ratingError ? <Text className="pf-error-line">{ratingError}</Text> : null}

              <View
                className={`btn-primary pf-submit ${submitting ? 'busy' : ''}`}
                onClick={submitRating}
              >
                {submitting ? '提交中…' : '提交反馈'}
              </View>

              {ratings.length === 0 ? (
                <Text className="pf-empty-desc">还没有提交过反馈，欢迎写下第一条。</Text>
              ) : (
                <View className="pf-rating-list">
                  {ratings.map((r, i) => {
                    const level = Math.max(
                      0,
                      Math.min(5, typeof r.stars === 'number' ? Math.round(r.stars) : 0)
                    )
                    return (
                      <View className="pf-rating-item" key={r.id || String(i)}>
                        <View className="row-between">
                          <Text className="pf-rating-stars">
                            {'★'.repeat(level)}
                            {'☆'.repeat(5 - level)}
                          </Text>
                          <Text className="pf-rating-meta">
                            {r.target === 'app' ? '应用反馈' : '方案反馈'} · {fmtDateTime(r.created)}
                          </Text>
                        </View>
                        <Text className="pf-rating-comment">
                          {r.comment ? r.comment : '（未填写文字建议）'}
                        </Text>
                      </View>
                    )
                  })}
                </View>
              )}
            </View>

            {/* ---------- 生理数据来源 ---------- */}
            <View className="section-title">
              <Text>生理数据来源</Text>
              <Text className="muted">诚实标注</Text>
            </View>

            <View className="card">
              <View className="row-between">
                <Text className="pf-source-state">
                  {DEVICE_PROFILES.length === 0
                    ? '暂未登记蓝牙设备'
                    : `已登记 ${DEVICE_PROFILES.length} 款蓝牙设备`}
                </Text>
                <Text className={`pill pill-${source ? SOURCE_PILL[source] : 'primary'}`}>
                  {physio ? (source ? SOURCE_TEXT[source] : '来源未标注') : '暂无记录'}
                </Text>
              </View>

              <Text className="pf-source-desc">
                蓝牙接入的接口与数据帧协议已经写好并预留（代码位置：小程序端 src/lib/ble.ts）：
                设备发现、连接、取值、写入数据库的通道都已具备，但当前没有配套硬件，
                所以这条链路还没有在真机上验证过。硬件到位后，只需补上设备的 UUID 与帧格式，
                界面和压力计算都不需要改动。
              </Text>

              {physio ? (
                <>
                  <View className="pf-physio-grid">
                    {[
                      { n: 'HRV', v: showNum(physio.hrv, 1), u: 'ms' },
                      { n: 'GSR', v: showNum(physio.gsr, 2), u: 'µS' },
                      { n: '睡眠质量', v: showNum(physio.sleep_quality), u: '分' },
                      { n: '步数', v: showNum(physio.steps), u: '步' },
                    ].map((it) => (
                      <View className="pf-physio-tile" key={it.n}>
                        <Text className="pf-physio-name">{it.n}</Text>
                        <View className="pf-physio-value-row">
                          <Text className="pf-physio-value">{it.v}</Text>
                          <Text className="pf-physio-unit">{it.u}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                  <Text className="pf-source-desc">
                    最新一条记录时间：{fmtDateTime(physio.date)}
                  </Text>
                  <Text className={`pf-source-note note-${source ?? 'manual'}`}>
                    {source
                      ? SOURCE_NOTE[source]
                      : '这条记录没有标注数据来源，请不要当作设备采集的数据引用。'}
                  </Text>
                </>
              ) : (
                <Text className="pf-source-note note-manual">
                  目前还没有任何生理数据，下面的手动录入是唯一的数据入口。
                </Text>
              )}

              <View className="pf-form-block">
                <Text className="pf-form-title">手动录入今日数据</Text>
                <Text className="pf-form-desc">
                  按您手边能得到的读数填写即可（例如手环或手机健康应用）。保存后来源会标注为
                  「手动录入」，不会被当成设备采集的数据。
                </Text>

                <View className="pf-num-row">
                  <View className="pf-num-field">
                    <Text className="pf-form-label">HRV（毫秒）</Text>
                    <Input
                      className="pf-num-input"
                      type="digit"
                      value={hrv}
                      placeholder="如 45"
                      onInput={(e) => {
                        setHrv(e.detail.value)
                        setPhysioDone(false)
                      }}
                    />
                  </View>
                  <View className="pf-num-field">
                    <Text className="pf-form-label">GSR（微西门子）</Text>
                    <Input
                      className="pf-num-input"
                      type="digit"
                      value={gsr}
                      placeholder="如 4.2"
                      onInput={(e) => {
                        setGsr(e.detail.value)
                        setPhysioDone(false)
                      }}
                    />
                  </View>
                </View>

                <View className="pf-num-row">
                  <View className="pf-num-field">
                    <Text className="pf-form-label">睡眠质量（0–100）</Text>
                    <Input
                      className="pf-num-input"
                      type="number"
                      value={sleepQuality}
                      placeholder="如 70"
                      onInput={(e) => {
                        setSleepQuality(e.detail.value)
                        setPhysioDone(false)
                      }}
                    />
                  </View>
                  <View className="pf-num-field">
                    <Text className="pf-form-label">今日步数</Text>
                    <Input
                      className="pf-num-input"
                      type="number"
                      value={steps}
                      placeholder="如 3200"
                      onInput={(e) => {
                        setSteps(e.detail.value)
                        setPhysioDone(false)
                      }}
                    />
                  </View>
                </View>

                {physioError ? <Text className="pf-error-line">{physioError}</Text> : null}
                {physioDone && !physioError ? (
                  <Text className="pf-success-line">已写入，压力指数会随生理数据更新</Text>
                ) : null}

                <View
                  className={`btn-primary pf-submit ${savingPhysio ? 'busy' : ''}`}
                  onClick={submitPhysio}
                >
                  {savingPhysio ? '写入中…' : '保存今日数据'}
                </View>
              </View>
            </View>
          </>
        ) : null}
      </View>

      <BottomNav active="profile" />
    </View>
  )
}
