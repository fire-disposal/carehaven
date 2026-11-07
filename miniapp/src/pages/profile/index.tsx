import { useCallback, useState } from 'react'
import { Image, Text, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import Icon from '@/components/Icon'
import BottomNav from '@/components/BottomNav'
import TrendChart from '@/components/TrendChart'
import type { TrendPoint } from '@/components/TrendChart'
import { Button, Card, Pill, SectionHeader, StateBlock, Stat } from '@/components/ui'
import { AVATARS, avatarById } from '@/lib/avatar'
import {
  api,
  getUser,
  isLoggedIn,
  logout,
  wechatBind,
  type InterventionLog,
  type Level,
  type Rating,
  type StressScore,
} from '@/lib/api'
import { levelTone } from '@/lib/level'
import { THEME } from '@/lib/theme'
import './index.scss'

// 微信绑定只在小程序端有意义（网页端拿不到微信登录凭证），H5 下整块不渲染。
const IS_WEAPP = Taro.getEnv() === Taro.ENV_TYPE.WEAPP

// ---------- 文案表 ----------

const LEVEL_TEXT: Record<Level, string> = { green: '平稳', yellow: '预警', red: '偏高' }
const LEVEL_RANGE: Record<Level, string> = { green: '0–39', yellow: '40–69', red: '70–100' }
const LEVEL_KEYS: Level[] = ['green', 'yellow', 'red']

const DAY_MS = 86400000
const LOG_WINDOW_DAYS = 30

// ---------- 工具函数 ----------

/** PocketBase 的日期形如 `2026-10-15 08:20:00.000Z`，空格换成 T 才能被各端 Date 解析 */
function toDate(raw: string): Date | null {
  if (!raw) return null
  const d = new Date(raw.includes(' ') ? raw.replace(' ', 'T') : raw)
  return Number.isNaN(d.getTime()) ? null : d
}

/** 干预效果 / 星级都是 1–5 分，同时把缺失字段挡在类型之外 */
function isOneToFive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 5
}

export default function ProfilePage() {
  const [scores, setScores] = useState<StressScore[]>([])
  const [logs, setLogs] = useState<InterventionLog[]>([])
  const [ratings, setRatings] = useState<Rating[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [chartRange, setChartRange] = useState<7 | 30>(30)
  const [selectedBar, setSelectedBar] = useState(-1)

  // 微信绑定（仅小程序端）：初始值取自本地会话里的用户记录
  const [boundOpenid, setBoundOpenid] = useState(() => getUser()?.wechat_openid || '')
  const [binding, setBinding] = useState(false)

  const [avatarOpen, setAvatarOpen] = useState(false)
  const [avatarSaving, setAvatarSaving] = useState(false)
  const [, setAvatarTick] = useState(0)

  async function chooseAvatar(id: string) {
    if (avatarSaving || avatarById(getUser()?.avatar_preset).id === id) {
      setAvatarOpen(false)
      return
    }
    setAvatarSaving(true)
    try {
      await api.updateAvatar(id)
      setAvatarTick((v) => v + 1)
      setAvatarOpen(false)
      Taro.showToast({ title: '头像已更新', icon: 'none' })
    } catch (e) {
      Taro.showToast({ title: e instanceof Error ? e.message : '头像保存失败', icon: 'none' })
    } finally {
      setAvatarSaving(false)
    }
  }

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
      const [s, l, r] = await Promise.all([
        api.scores(30),
        api.interventionLogs(30),
        api.ratings(),
      ])
      setScores(s)
      setLogs(l)
      setRatings(r)
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

  // 图表只展示所选窗口；下方 30 天摘要仍用全量数据。
  // 与 emoguard 的趋势页一致：按「连续自然日」取点，没记录的日子是 null（断点），不补 0。
  const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
  const scoreByDay = new Map<string, (typeof scores)[number]>()
  for (const s of scores) {
    const d = toDate(s.date)
    if (d) scoreByDay.set(dayKey(d), s)
  }
  const chartPoints: TrendPoint[] = []
  const chartDayScores: ((typeof scores)[number] | null)[] = []
  for (let i = chartRange - 1; i >= 0; i -= 1) {
    const d = new Date(Date.now() - i * DAY_MS)
    const record = scoreByDay.get(dayKey(d)) || null
    const value =
      record && typeof record.hps === 'number' && Number.isFinite(record.hps)
        ? Math.max(0, Math.min(100, record.hps))
        : null
    chartPoints.push({
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      dateLabel: `${d.getMonth() + 1}月${d.getDate()}日`,
      value,
    })
    chartDayScores.push(record)
  }
  // 数据还很少时，裁掉开头一长串没记录的日子（保留 2 天缓冲），
  // 否则 30 天视图里所有点都挤在右端，左侧大片空白。
  const firstValid = chartPoints.findIndex((p) => p.value !== null)
  if (firstValid > 2) {
    chartPoints.splice(0, firstValid - 2)
    chartDayScores.splice(0, firstValid - 2)
  }
  const chartValues = chartPoints.map((p) => p.value)
  const chartValid = chartValues.filter((v): v is number => v !== null)
  const chartAvg = chartValid.length
    ? chartValid.reduce((a, b) => a + b, 0) / chartValid.length
    : null
  const lastValidIndex = chartValues.reduce<number>((acc, v, i) => (v === null ? acc : i), -1)
  const activeIndex =
    selectedBar >= 0 && selectedBar < chartPoints.length ? selectedBar : lastValidIndex
  const activeScore = activeIndex >= 0 ? chartDayScores[activeIndex] : null
  const activeDateText = activeIndex >= 0 ? chartPoints[activeIndex]?.dateLabel || '' : ''

  // 近 7 天 vs 前 7 天（emoguard 的周对比）：任一侧没有数据就不显示
  const lastWeek: number[] = []
  const prevWeek: number[] = []
  for (const s of scores) {
    const d = toDate(s.date)
    if (!d || typeof s.hps !== 'number' || !Number.isFinite(s.hps)) continue
    const ageDays = (Date.now() - d.getTime()) / DAY_MS
    if (ageDays <= 7) lastWeek.push(s.hps)
    else if (ageDays <= 14) prevWeek.push(s.hps)
  }
  const mean = (list: number[]) => list.reduce((a, b) => a + b, 0) / list.length
  const weekDelta = lastWeek.length && prevWeek.length ? mean(lastWeek) - mean(prevWeek) : null

  const hasAnyData = scores.length > 0 || logs.length > 0 || ratings.length > 0

  // ---------- 交互 ----------

  function confirmLogout() {
    Taro.showModal({
      title: '确认退出登录？',
      content: '退出后需要重新输入邮箱和密码才能进入，已记录的数据不会丢失。',
      confirmText: '退出登录',
      cancelText: '再想想',
      confirmColor: THEME.red,
    })
      .then((res) => {
        if (res.confirm) logout()
      })
      .catch(() => {
        // 弹窗被系统打断时忽略，用户可再次点击退出
      })
  }

  const user = getUser()

  return (
    <View className="page">
      <View className="page-pad">
        {/* ---------- 用户卡 ---------- */}
        <Card className="pf-user-card">
          <View className="pf-user-top">
            <Image
              className="pf-avatar"
              src={avatarById(user?.avatar_preset).src}
              mode="aspectFill"
              onClick={() => setAvatarOpen(true)}
              ariaRole="button"
              ariaLabel="更换头像"
            />
            <View className="pf-user-info">
              <Text className="pf-user-name">{user?.name || '照护者'}</Text>
              <Text className="pf-user-email">{user?.email || '未获取到邮箱'}</Text>
            </View>
          </View>
        </Card>

        {/* ---------- 微信绑定（仅小程序端） ---------- */}
        {IS_WEAPP ? (
          <Card className="pf-wechat">
            <View className="pf-row">
              <View className="pf-wechat-text">
                <Text className="pf-wechat-title">微信绑定</Text>
                <Text className="pf-wechat-desc">
                  {boundOpenid
                    ? '已绑定微信，网页端与小程序使用同一个账号。'
                    : '绑定后可用微信一键登录，并与网页端共用同一账号。'}
                </Text>
              </View>
              <Pill tone={boundOpenid ? 'green' : 'primary'}>
                {boundOpenid ? '已绑定' : '未绑定'}
              </Pill>
            </View>
            {!boundOpenid ? (
              <Button
                variant="primary"
                block
                className="pf-wechat-btn"
                disabled={binding}
                ariaLabel="绑定微信"
                onClick={bindWechat}
              >
                {binding ? '绑定中…' : '绑定微信'}
              </Button>
            ) : null}
          </Card>
        ) : null}

        {error ? (
          <StateBlock
            variant="error"
            compact={hasAnyData}
            title={hasAnyData ? undefined : '记录没能加载出来'}
            desc={error}
            actionLabel="重新加载"
            onAction={() => void load()}
          />
        ) : null}

        {loading ? <StateBlock variant="loading" title="正在加载您的记录…" /> : null}

        {!loading && (!error || hasAnyData) ? (
          <>
            {/* ---------- 30 天压力趋势 ---------- */}
            <SectionHeader
              title="压力趋势"
              action={<Text className="muted">{countDays ? `近 ${chartRange} 天` : '暂无数据'}</Text>}
            />

            {countDays === 0 ? (
              <StateBlock
                variant="empty"
                title="还没有压力评估记录"
                desc="在首页完成一次打卡，系统就会算出当天的压力指数，这里便能看到 30 天的变化曲线。"
                actionLabel="去首页打卡"
                onAction={() => void Taro.switchTab({ url: '/pages/index/index' })}
              />
            ) : (
              <Card className="pf-chart-card">
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

                {activeScore || activeIndex >= 0 ? (
                  <View className="pf-chart-active">
                    <Text className="pf-chart-active-date">{activeDateText}</Text>
                    <Text className="pf-chart-active-value">
                      {activeIndex >= 0 && chartValues[activeIndex] !== null
                        ? chartValues[activeIndex]?.toFixed(0)
                        : '--'}
                    </Text>
                    {activeScore ? (
                      <Pill tone={levelTone(activeScore.level)}>
                        {LEVEL_TEXT[activeScore.level] || '—'}
                      </Pill>
                    ) : (
                      <Pill tone="quiet">当天无记录</Pill>
                    )}
                  </View>
                ) : null}

                <TrendChart
                  points={chartPoints}
                  active={activeIndex}
                  onSelect={setSelectedBar}
                  average={chartAvg}
                />
                <View className="pf-chart-foot">
                  <Text className="pf-chart-hint">点曲线上的圆点看当天数值，虚线为均值</Text>
                  {weekDelta !== null ? (
                    <Text
                      className={`pf-chart-delta ${weekDelta > 0.5 ? 'up' : weekDelta < -0.5 ? 'down' : ''}`}
                    >
                      较上周 {Math.abs(weekDelta) <= 0.5 ? '持平' : `${weekDelta > 0 ? '↑' : '↓'} ${Math.abs(weekDelta).toFixed(1)} 分`}
                    </Text>
                  ) : null}
                </View>
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
              </Card>
            )}

            {/* ---------- 近 30 天摘要 ---------- */}
            <SectionHeader
              title="近 30 天摘要"
              action={<Text className="muted">{hpsDays ? `已统计 ${hpsDays} 天` : '暂无数据'}</Text>}
            />

            {countDays === 0 ? (
              <StateBlock
                variant="empty"
                compact
                desc="有了压力记录之后，这里会自动汇总平均压力、最高的一天与三色天数。"
              />
            ) : (
              <View className="pf-stat-grid">
                <View className="pf-stat-tile">
                  <Stat
                    label="平均压力指数"
                    value={avgHps === null ? '--' : avgHps.toFixed(1)}
                    unit="分"
                  />
                  <Text className="pf-stat-hint">{hpsDays} 天的平均值</Text>
                </View>

                <View className="pf-stat-tile">
                  <Stat
                    label="平均效果评分"
                    value={avgFeeling === null ? '--' : avgFeeling.toFixed(1)}
                    unit="/ 5"
                  />
                  <Text className="pf-stat-hint">
                    {feelings.length ? `干预后自评，共 ${feelings.length} 次` : '还没有评分'}
                  </Text>
                </View>

                <View className="pf-stat-tile">
                  <Stat label="干预次数" value={recentLogs.length} unit="次" />
                  <Text className="pf-stat-hint">近 30 天完成的减压练习</Text>
                </View>

                <View className="pf-stat-tile">
                  <Stat
                    label="平均星级反馈"
                    value={avgStars === null ? '--' : avgStars.toFixed(1)}
                    unit="星"
                  />
                  <Text className="pf-stat-hint">
                    {starValues.length ? `来自 ${starValues.length} 条反馈` : '还没有反馈'}
                  </Text>
                </View>

                <View className="pf-stat-tile wide">
                  <Stat
                    label="最高的一天"
                    value={peak && peakIndex >= 0 ? peakValue.toFixed(0) : '--'}
                    unit={
                      peak && peakIndex >= 0
                        ? `${peakDayText} · ${LEVEL_TEXT[peak.level] || '—'}`
                        : undefined
                    }
                  />
                  {peak && peakIndex >= 0 ? null : (
                    <Text className="pf-stat-hint">暂无有效数值</Text>
                  )}
                </View>

                <View className="pf-stat-tile wide">
                  <Text className="pf-stat-name">三色天数分布</Text>
                  <View className="pf-stat-pills">
                    {LEVEL_KEYS.map((k) => (
                      <Pill tone={k} key={k}>{`${LEVEL_TEXT[k]} ${counts[k]} 天`}</Pill>
                    ))}
                  </View>
                </View>
              </View>
            )}

            {/* ---------- 菜单：记录 / 数据 / 帮助 ---------- */}
            <Card flush className="pf-menu">
              <View
                className="pf-menu-item"
                onClick={() => void Taro.navigateTo({ url: '/pages/records/index' })}
                ariaRole="button"
                ariaLabel="我的记录"
              >
                <View className="pf-menu-icon">
                  <Icon name="calendar-days" size={32} color={THEME.primaryDark} />
                </View>
                <View className="pf-menu-main">
                  <Text className="pf-menu-label">我的记录</Text>
                  <Text className="pf-menu-desc">打卡、减压练习与完成记录</Text>
                </View>
                <Icon name="chevron-right" size={28} color={THEME.muted} />
              </View>
              <View
                className="pf-menu-item"
                onClick={() => void Taro.navigateTo({ url: '/pages/account/index' })}
                ariaRole="button"
                ariaLabel="数据与来源"
              >
                <View className="pf-menu-icon">
                  <Icon name="heart-pulse" size={32} color={THEME.primaryDark} />
                </View>
                <View className="pf-menu-main">
                  <Text className="pf-menu-label">数据与来源</Text>
                  <Text className="pf-menu-desc">生理来源、研究参与、导出与注销</Text>
                </View>
                <Icon name="chevron-right" size={28} color={THEME.muted} />
              </View>
              <View
                className="pf-menu-item"
                onClick={() => Taro.navigateTo({ url: '/pages/feedback/index' })}
                ariaRole="button"
                ariaLabel="意见反馈"
              >
                <View className="pf-menu-icon">
                  <Icon name="pen-to-square" size={32} color={THEME.primaryDark} />
                </View>
                <View className="pf-menu-main">
                  <Text className="pf-menu-label">意见反馈</Text>
                  <Text className="pf-menu-desc">问题、建议与违规举报</Text>
                </View>
                <Icon name="chevron-right" size={28} color={THEME.muted} />
              </View>
              <View
                className="pf-menu-item"
                onClick={() => Taro.navigateTo({ url: '/pages/about/index' })}
                ariaRole="button"
                ariaLabel="关于智护忆站"
              >
                <View className="pf-menu-icon">
                  <Icon name="circle-info" size={32} color={THEME.primaryDark} />
                </View>
                <View className="pf-menu-main">
                  <Text className="pf-menu-label">关于智护忆站</Text>
                  <Text className="pf-menu-desc">版本、方法与数据说明</Text>
                </View>
                <Icon name="chevron-right" size={28} color={THEME.muted} />
              </View>
              <View
                className="pf-menu-item"
                onClick={() => Taro.navigateTo({ url: '/pages/agreement/index?type=privacy' })}
                ariaRole="button"
                ariaLabel="用户协议与隐私政策"
              >
                <View className="pf-menu-icon">
                  <Icon name="shield-heart" size={32} color={THEME.primaryDark} />
                </View>
                <View className="pf-menu-main">
                  <Text className="pf-menu-label">用户协议与隐私政策</Text>
                  <Text className="pf-menu-desc">数据如何使用与保护</Text>
                </View>
                <Icon name="chevron-right" size={28} color={THEME.muted} />
              </View>
            </Card>
          </>
        ) : null}

        {/* ---------- 退出登录 ---------- */}
        <Card flush className="pf-menu">
          <View
            className="pf-menu-item"
            onClick={confirmLogout}
            ariaRole="button"
            ariaLabel="退出登录"
          >
            <View className="pf-menu-icon pf-menu-icon-danger">
              <Icon name="lock" size={32} color={THEME.red} />
            </View>
            <View className="pf-menu-main">
              <Text className="pf-menu-label pf-menu-label-danger">退出登录</Text>
              <Text className="pf-menu-desc">退出后需要重新登录</Text>
            </View>
            <Icon name="chevron-right" size={28} color={THEME.muted} />
          </View>
        </Card>
      </View>

      {avatarOpen ? (
        <View className="pf-sheet-mask" onClick={() => setAvatarOpen(false)}>
          <View className="pf-sheet" onClick={(e) => e.stopPropagation()}>
            <Text className="pf-sheet-title">选择头像</Text>
            <Text className="pf-sheet-desc">选好会保存在账号里，换设备也会同步。</Text>
            <View className="pf-avatar-grid">
              {AVATARS.map((item) => (
                <View
                  key={item.id}
                  className={`pf-avatar-option${avatarById(user?.avatar_preset).id === item.id ? ' on' : ''}`}
                  onClick={() => void chooseAvatar(item.id)}
                  ariaRole="button"
                  ariaLabel={`选择${item.label}头像`}
                >
                  <Image className="pf-avatar-img" src={item.src} mode="aspectFill" />
                  <Text className="pf-avatar-label">{item.label}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      ) : null}

      <BottomNav active="profile" />
    </View>
  )
}
