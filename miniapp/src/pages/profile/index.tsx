import { useCallback, useEffect, useState } from 'react'
import { Input, ScrollView, Text, Textarea, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import BottomNav from '@/components/BottomNav'
import Icon from '@/components/Icon'
import { DEVICE_PROFILES } from '@/lib/ble'
import {
  api,
  getUser,
  isLoggedIn,
  logout,
  wechatBind,
  type InterventionLog,
  type Level,
  type PhysioRecord,
  type Rating,
  type StressScore,
} from '@/lib/api'
import './index.scss'

// 微信绑定只在小程序端有意义（网页端拿不到微信登录凭证），H5 下整块不渲染。
const IS_WEAPP = Taro.getEnv() === Taro.ENV_TYPE.WEAPP

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
  device: '由已登记的蓝牙设备同步。',
  simulated: '这些是模拟数据，用于展示系统效果，不是设备的真实测量结果。',
  manual: '这是您手动填写的记录，不是设备测量。',
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
  const [chartRange, setChartRange] = useState<7 | 30>(30)
  const [selectedBar, setSelectedBar] = useState(-1)
  const [chartScrollLeft, setChartScrollLeft] = useState(0)

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

  // 微信绑定（仅小程序端）：初始值取自本地会话里的用户记录
  const [boundOpenid, setBoundOpenid] = useState(() => getUser()?.wechat_openid || '')
  const [binding, setBinding] = useState(false)

  async function bindWechat() {
    if (binding) return
    setBinding(true)
    try {
      const res = await Taro.login()
      if (!res.code) {
        throw new Error('未能获取微信登录凭证')
      }
      const updated = await wechatBind(res.code)
      setBoundOpenid(updated.wechat_openid || '')
      Taro.showToast({ title: '微信已绑定', icon: 'success' })
    } catch (e) {
      Taro.showToast({ title: e instanceof Error ? e.message : '绑定失败，请稍后重试', icon: 'none' })
    } finally {
      setBinding(false)
    }
  }

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

  // 30 天窗口默认滚到最右端：详情卡展示的是最新一天，不能让它停在屏幕外。
  // 只在切窗口或数据量变化时改 scrollLeft，用户手动滑动不会被拉回。
  useEffect(() => {
    setChartScrollLeft(chartRange === 30 ? 99999 : 0)
  }, [chartRange, scores.length])

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

  // 图表只展示所选窗口；下方 30 天摘要仍用全量数据
  const chartScores = scores.slice(-chartRange)
  const chartValues = chartScores.map((s) =>
    typeof s.hps === 'number' && Number.isFinite(s.hps) ? Math.max(0, Math.min(100, s.hps)) : null
  )
  const chartValid = chartValues.filter((v): v is number => v !== null)
  const chartAvg = chartValid.length
    ? chartValid.reduce((a, b) => a + b, 0) / chartValid.length
    : null
  let chartPeakIndex = -1
  let chartPeakValue = -1
  chartValues.forEach((v, i) => {
    if (v !== null && v > chartPeakValue) {
      chartPeakValue = v
      chartPeakIndex = i
    }
  })
  const activeIndex =
    selectedBar >= 0 && selectedBar < chartScores.length
      ? selectedBar
      : chartScores.length - 1
  const activeScore = activeIndex >= 0 ? chartScores[activeIndex] : null
  const activeDate = activeScore ? toDate(activeScore.date) : null
  const activeDateText = activeDate
    ? `${activeDate.getMonth() + 1}月${activeDate.getDate()}日`
    : ''

  // 7 天显示全部日期；30 天每 5 天标一次（再加最后一天），滚动到右端也能看到近几日刻度
  const tickLabels = chartScores.map((s, i) => {
    const d = toDate(s.date)
    if (!d) return ''
    const last = chartScores.length - 1
    const show = chartRange === 7 || i === 0 || i === last || i % 5 === 0
    return show ? `${d.getMonth() + 1}/${d.getDate()}` : ''
  })

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
      confirmColor: '#963b33',
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
            <View className="pf-avatar">
              <Text className="pf-avatar-char">{(user?.name || '照').slice(0, 1)}</Text>
            </View>
            <View className="pf-user-info">
              <Text className="pf-user-name">{user?.name || '照护者'}</Text>
              <Text className="pf-user-email">{user?.email || '未获取到邮箱'}</Text>
            </View>
          </View>
        </View>

        {/* ---------- 微信绑定（仅小程序端） ---------- */}
        {IS_WEAPP ? (
          <View className="card pf-wechat">
            <View className="row-between">
              <View className="pf-wechat-text">
                <Text className="pf-wechat-title">微信绑定</Text>
                <Text className="pf-wechat-desc">
                  {boundOpenid
                    ? '已绑定微信，网页端与小程序使用同一个账号。'
                    : '绑定后可用微信一键登录，并与网页端共用同一账号。'}
                </Text>
              </View>
              <Text className={boundOpenid ? 'pill pill-green' : 'pill pill-primary'}>
                {boundOpenid ? '已绑定' : '未绑定'}
              </Text>
            </View>
            {!boundOpenid ? (
              <View className={`btn-primary pf-wechat-btn ${binding ? 'busy' : ''}`} onClick={bindWechat}>
                {binding ? '绑定中…' : '绑定微信'}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* ---------- 帮助与支持 ---------- */}
        <View className="section-title">
          <Text>帮助与支持</Text>
        </View>
        <View className="card pf-menu">
          <View
            className="pf-menu-item"
            onClick={() => Taro.navigateTo({ url: '/pages/feedback/index' })}
            ariaRole="button"
            ariaLabel="意见反馈"
          >
            <View className="pf-menu-icon">
              <Icon name="pen-to-square" size={32} color="#16443c" />
            </View>
            <View className="pf-menu-main">
              <Text className="pf-menu-label">意见反馈</Text>
              <Text className="pf-menu-desc">问题、建议与违规举报</Text>
            </View>
            <Icon name="chevron-right" size={28} color="#626b65" />
          </View>
          <View
            className="pf-menu-item"
            onClick={() => Taro.navigateTo({ url: '/pages/about/index' })}
            ariaRole="button"
            ariaLabel="关于智护忆站"
          >
            <View className="pf-menu-icon">
              <Icon name="circle-info" size={32} color="#16443c" />
            </View>
            <View className="pf-menu-main">
              <Text className="pf-menu-label">关于智护忆站</Text>
              <Text className="pf-menu-desc">版本、方法与数据说明</Text>
            </View>
            <Icon name="chevron-right" size={28} color="#626b65" />
          </View>
          <View
            className="pf-menu-item"
            onClick={() =>
              Taro.navigateTo({ url: '/pages/agreement/index?type=privacy' })
            }
            ariaRole="button"
            ariaLabel="用户协议与隐私政策"
          >
            <View className="pf-menu-icon">
              <Icon name="shield-heart" size={32} color="#16443c" />
            </View>
            <View className="pf-menu-main">
              <Text className="pf-menu-label">用户协议与隐私政策</Text>
              <Text className="pf-menu-desc">数据如何使用与保护</Text>
            </View>
            <Icon name="chevron-right" size={28} color="#626b65" />
          </View>
          <View
            className="pf-menu-item"
            onClick={confirmLogout}
            ariaRole="button"
            ariaLabel="退出登录"
          >
            <View className="pf-menu-icon pf-menu-icon-danger">
              <Icon name="lock" size={32} color="#963b33" />
            </View>
            <View className="pf-menu-main">
              <Text className="pf-menu-label pf-menu-label-danger">退出登录</Text>
              <Text className="pf-menu-desc">退出后需要重新登录</Text>
            </View>
            <Icon name="chevron-right" size={28} color="#626b65" />
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
              <Text className="muted">{countDays ? `近 ${chartRange} 天` : '暂无数据'}</Text>
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
                <View className="pf-chart-head">
                  <View>
                    <Text className="pf-chart-title">每日压力指数</Text>
                    <Text className="pf-chart-sub">数值越高，压力越大</Text>
                  </View>
                  <View className="pf-range">
                    {([7, 30] as const).map((v) => (
                      <View
                        key={v}
                        className={`pf-range-item ${chartRange === v ? 'on' : ''}`}
                        onClick={() => {
                          setChartRange(v)
                          setSelectedBar(-1)
                        }}
                        ariaRole="button"
                        ariaLabel={`查看最近 ${v} 天`}
                      >
                        <Text>{v} 天</Text>
                      </View>
                    ))}
                  </View>
                </View>

                {activeScore ? (
                  <View className="pf-chart-active">
                    <Text className="pf-chart-active-date">{activeDateText}</Text>
                    <Text className="pf-chart-active-value">
                      {chartValues[activeIndex] === null
                        ? '--'
                        : chartValues[activeIndex]?.toFixed(0)}
                    </Text>
                    <Text className={`pill pill-${activeScore.level}`}>
                      {LEVEL_TEXT[activeScore.level] || '—'}
                    </Text>
                  </View>
                ) : null}

                <ScrollView scrollX scrollLeft={chartScrollLeft} className="pf-chart-scroll">
                  <View className={`pf-chart-inner ${chartRange === 7 ? 'range-7' : ''}`}>
                    {chartAvg !== null ? (
                      <View
                        className="pf-avg-line"
                        style={{
                          bottom: Taro.pxTransform(36 + (chartAvg / 100) * 240),
                        }}
                      >
                        <Text className="pf-avg-label">平均 {chartAvg.toFixed(0)}</Text>
                      </View>
                    ) : null}
                    {chartScores.map((s, i) => {
                      const value = chartValues[i]
                      const lv: Level =
                        s.level === 'yellow' || s.level === 'red' ? s.level : 'green'
                      const showValue =
                        chartRange === 7 || i === chartPeakIndex || i === activeIndex
                      return (
                        <View
                          key={s.id || String(i)}
                          className={`pf-chart-col ${i === chartPeakIndex ? 'is-peak' : ''} ${i === activeIndex ? 'is-active' : ''}`}
                          onClick={() => setSelectedBar(i)}
                          ariaRole="button"
                          ariaLabel={`${tickLabels[i] || '当天'}，压力指数 ${value === null ? '无数据' : value}`}
                        >
                          <View className="pf-bar-val">
                            {showValue ? (value === null ? '--' : value.toFixed(0)) : ''}
                          </View>
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
                <Text className="pf-chart-hint">点柱子看数值，虚线是平均值</Text>
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
                    <Text className="pf-stat-unit">分</Text>
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
                          {peakDayText} · {LEVEL_TEXT[peak.level] || '—'}
                        </Text>
                      </View>
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
                    <View className="pf-log-icon">
                      <Icon name="spa" size={34} color="#1f5a50" />
                    </View>
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
                    <Icon
                      name="star"
                      size={44}
                      color={stars >= n ? '#7a5310' : '#cfc6b6'}
                    />
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
                          <View className="pf-rating-stars">
                            {[1, 2, 3, 4, 5].map((n) => (
                              <Icon
                                key={n}
                                name="star"
                                size={26}
                                color={n <= level ? '#7a5310' : '#d8cebf'}
                              />
                            ))}
                          </View>
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
              <Text className="muted">数据来源</Text>
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
                当前没有连接蓝牙设备。您可以在下方手动填写手环或手机健康应用里的读数；
                接入设备后，数据会自动同步到这里。
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
                      : '这条记录没有标注来源，请勿当作设备测量结果。'}
                  </Text>
                </>
              ) : (
                <Text className="pf-source-note note-manual">
                  还没有生理数据，可以在下方手动填写。
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
