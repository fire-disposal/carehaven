import { useCallback, useEffect, useState } from 'react'
import { Input, ScrollView, Switch, Text, Textarea, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import BottomNav from '@/components/BottomNav'
import Icon from '@/components/Icon'
import { Button, Card, Pill, SectionHeader, StarRating, StateBlock, Stat } from '@/components/ui'
import type { PillTone } from '@/components/ui'
import { DEVICE_PROFILES } from '@/lib/ble'
import {
  api,
  clearSession,
  getUser,
  isLoggedIn,
  logout,
  wechatBind,
  type InterventionLog,
  type Level,
  type ScoreLevel,
  type PhysioRecord,
  type Rating,
  type Checkin,
  type ResearchConsent,
  type StudyMe,
  type StressScore,
} from '@/lib/api'
import { levelTone } from '@/lib/level'
import { SOURCE_LABEL, SOURCE_NOTE } from '@/content/glossary'
import { THEME } from '@/lib/theme'
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

/** 应用满意度星级的标签：StarRating 与下方说明共用这一份 */
const STARS_LABELS = ['很不满意', '不太满意', '一般', '比较满意', '非常满意']

/** pill 配色：模拟数据用黄色提醒，手动录入用主色，设备采集用绿色 */
const SOURCE_PILL: Record<PhysioRecord['source'], PillTone> = {
  device: 'green',
  simulated: 'yellow',
  manual: 'primary',
}

// 研究日程里的量表用标准缩写，比内部 key 更易读
const SCALE_LABEL: Record<string, string> = {
  phq9: 'PHQ-9',
  gad7: 'GAD-7',
  zbi12: 'ZBI-12',
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

  // 我的数据：导出 / 注销
  const [exporting, setExporting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [exportError, setExportError] = useState('')

  // 研究参与同意：默认未同意，只有显式打开才进入研究数据集
  const [consent, setConsent] = useState<ResearchConsent | null>(null)
  const [consentSaving, setConsentSaving] = useState(false)
  const [consentError, setConsentError] = useState('')

  // 研究参与：研究码入组、分组（受盲法控制）与依从概况
  const [checkins, setCheckins] = useState<Checkin[]>([])
  const [study, setStudy] = useState<StudyMe | null>(null)
  const [studyCode, setStudyCode] = useState('')
  const [studyBusy, setStudyBusy] = useState(false)
  const [studyError, setStudyError] = useState('')

  useEffect(() => {
    let alive = true
    api
      .researchConsent()
      .then((res) => {
        if (alive) setConsent(res)
      })
      .catch(() => {
        if (alive) setConsent(null)
      })
    api
      .studyMe()
      .then((res) => {
        if (alive) setStudy(res.study ? res : null)
      })
      .catch(() => {
        if (alive) setStudy(null)
      })
    return () => {
      alive = false
    }
  }, [])

  async function joinStudy() {
    const code = studyCode.trim().toUpperCase()
    if (!code || studyBusy) return
    setStudyBusy(true)
    setStudyError('')
    try {
      await api.enrollStudy(code)
      setStudy(await api.studyMe())
      setStudyCode('')
      Taro.showToast({ title: '已加入研究', icon: 'none' })
    } catch (e) {
      setStudyError(e instanceof Error ? e.message : '加入没有完成，请核对研究码')
    } finally {
      setStudyBusy(false)
    }
  }

  async function leaveStudy() {
    if (studyBusy) return
    const reasons = ['时间安排冲突', '不方便继续', '效果不明显', '其他原因']
    let index = -1
    try {
      const picked = await Taro.showActionSheet({ itemList: reasons })
      index = picked.tapIndex
    } catch (e) {
      return
    }
    setStudyBusy(true)
    setStudyError('')
    try {
      await api.withdrawStudy(reasons[index] || '其他原因')
      setStudy(await api.studyMe())
      Taro.showToast({ title: '已退出研究', icon: 'none' })
    } catch (e) {
      setStudyError(e instanceof Error ? e.message : '退出没有完成，请稍后再试')
    } finally {
      setStudyBusy(false)
    }
  }

  async function toggleConsent(next: boolean) {
    if (consentSaving) return
    if (!next) {
      const res = await Taro.showModal({
        title: '撤回研究同意',
        content: '撤回后，您不会再出现在之后生成的研究数据集中；已生成的历史数据集不会回改。',
        confirmText: '撤回',
        confirmColor: THEME.red,
      }).catch(() => ({ confirm: false }))
      if (!res.confirm) return
    }
    setConsentSaving(true)
    setConsentError('')
    try {
      const updated = await api.setResearchConsent(next)
      setConsent(updated)
      Taro.showToast({ title: next ? '已同意参与研究' : '已撤回同意', icon: 'none' })
    } catch (e) {
      setConsentError(e instanceof Error ? e.message : '同意状态没能保存')
    } finally {
      setConsentSaving(false)
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

  // 数据权利：导出自己的全部记录（JSON 包）
  async function exportData() {
    if (exporting) return
    setExporting(true)
    setExportError('')
    try {
      const result = await api.exportAccount()
      const payload = JSON.stringify(result)
      const collections = result.meta?.collections?.length ?? Object.keys(result.data || {}).length
      const records = Object.values(result.data || {}).reduce(
        (sum, list) => sum + (Array.isArray(list) ? list.length : 0),
        0
      )
      const kb = Math.max(1, Math.round(payload.length / 1024))
      // 弹窗正文里说明体量：太大时提示改用反馈联系，避免复制失败后无处可去
      const sizeNote =
        payload.length > 100 * 1024
          ? `数据约 ${kb} KB，体积较大，复制可能失败；建议通过「意见反馈」联系我们索取完整文件。`
          : `点「复制 JSON」可复制全部数据（约 ${kb} KB）。`
      Taro.showModal({
        title: '数据导出完成',
        content: `共 ${collections} 个集合、${records} 条记录，导出时间 ${fmtDateTime(result.meta.exported_at)}。\n${sizeNote}`,
        confirmText: '复制 JSON',
        cancelText: '关闭',
        success: (res) => {
          if (res.confirm) copyExport(payload)
        },
      })
    } catch (e) {
      setExportError(e instanceof Error ? e.message : '导出失败，请稍后再试')
    } finally {
      setExporting(false)
    }
  }

  function copyExport(payload: string) {
    Taro.setClipboardData({ data: payload })
      .then(() => Taro.showToast({ title: '已复制到剪贴板', icon: 'none' }))
      .catch(() => setExportError('复制失败，可通过「意见反馈」联系我们索取完整文件'))
  }

  // 注销：两次确认后才调用接口，成功后清本地会话并回到登录页
  async function deleteAccount() {
    if (deleting) return
    const first = await Taro.showModal({
      title: '注销账号',
      content: '将删除账号与全部记录（打卡、评分、量表、互助内容），无法恢复。',
      confirmText: '继续',
      cancelText: '取消',
    }).catch(() => ({ confirm: false, cancel: true, content: '' }))
    if (!first.confirm) return

    const second = await Taro.showModal({
      title: '确认注销',
      content: '请再次确认：账号与全部数据都将被永久删除，且无法恢复。',
      confirmText: '确认注销',
      cancelText: '取消',
    }).catch(() => ({ confirm: false, cancel: true, content: '' }))
    if (!second.confirm) return

    setDeleting(true)
    try {
      await api.deleteAccount()
      clearSession()
      Taro.reLaunch({ url: '/pages/login/index' })
    } catch (e) {
      Taro.showToast({ title: e instanceof Error ? e.message : '注销失败，请稍后再试', icon: 'none' })
    } finally {
      setDeleting(false)
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
      const [s, l, r, p, c] = await Promise.all([
        api.scores(30),
        api.interventionLogs(30),
        api.ratings(),
        api.latestPhysio(),
        api.recentCheckins(14).catch(() => [] as Checkin[]),
      ])
      setScores(s)
      setLogs(l)
      setRatings(r)
      setPhysio(p)
      setCheckins(c)
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
  // scrollLeft 没有过渡动画，所以「减少动态效果」下同样是直接跳转。
  useEffect(() => {
    if (chartRange !== 30) {
      setChartScrollLeft(0)
      return
    }
    // 按内容实际宽度滚到末尾：超出上限时 ScrollView 会夹到最大滚动位置
    const timer = setTimeout(() => {
      Taro.createSelectorQuery()
        .select('.pf-chart-inner')
        .boundingClientRect()
        .exec((res: unknown[]) => {
          const rect = Array.isArray(res) ? (res[0] as { width?: number } | undefined) : undefined
          // 量不到时按列数估算：每列 88rpx（与 index.scss 的 .pf-chart-col 一致）
          const days = Math.min(chartRange, scores.length)
          const estimated = (days * 88 * Taro.getWindowInfo().windowWidth) / 750
          const width = typeof rect?.width === 'number' && rect.width > 0 ? rect.width : estimated
          setChartScrollLeft(width)
        })
    }, 0)
    return () => clearTimeout(timer)
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

  const nextWindow =
    (study?.schedule || []).find((item) => item.open) ||
    (study?.schedule || []).find((item) => !item.late) ||
    null

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
      confirmColor: THEME.red,
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
        <Card className="pf-user-card">
          <View className="pf-user-top">
            <View className="pf-avatar">
              <Text className="pf-avatar-char">{(user?.name || '照').slice(0, 1)}</Text>
            </View>
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

        {/* ---------- 帮助与支持 ---------- */}
        <SectionHeader title="帮助与支持" />
        <Card flush className="pf-menu">
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
            onClick={() =>
              Taro.navigateTo({ url: '/pages/agreement/index?type=privacy' })
            }
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
            {/* ---------- 30 天压力趋势（CSS 柱状图） ---------- */}
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
                onAction={() => Taro.redirectTo({ url: '/pages/index/index' })}
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

                {activeScore ? (
                  <View className="pf-chart-active">
                    <Text className="pf-chart-active-date">{activeDateText}</Text>
                    <Text className="pf-chart-active-value">
                      {chartValues[activeIndex] === null
                        ? '--'
                        : chartValues[activeIndex]?.toFixed(0)}
                    </Text>
                    <Pill tone={levelTone(activeScore.level)}>{LEVEL_TEXT[activeScore.level] || '—'}</Pill>
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
                      // unknown 不再伪装成 green：柱子用弱化色，图例照旧只解释三档
                      const lv: ScoreLevel = s.level
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

            {/* ---------- 打卡记录（自查） ---------- */}
            <SectionHeader
              title="打卡记录"
              action={<Text className="muted">{checkins.length ? `最近 ${checkins.length} 次` : ''}</Text>}
            />
            {checkins.length === 0 ? (
              <StateBlock
                variant="empty"
                compact
                title="还没有打卡记录"
                desc="在首页记录一次，就会出现在这里。"
              />
            ) : (
              <Card flush className="pf-checkins">
                {checkins.map((item) => (
                  <View className="pf-checkin" key={item.id}>
                    <View className="pf-checkin-main">
                      <Text className="pf-checkin-title">
                        {fmtDateTime(item.created || item.date)} · 心情 {item.mood} · 焦虑 {item.anxiety} · 疲惫{' '}
                        {item.fatigue}
                      </Text>
                      <Text className="pf-checkin-meta">
                        睡眠 {item.sleep_hours} 小时 · 照护 {item.care_hours} 小时
                        {item.note ? ` · ${item.note}` : ''}
                      </Text>
                    </View>
                    <Pill tone="primary">{item.period === 'morning' ? '日间' : '晚间'}</Pill>
                  </View>
                ))}
              </Card>
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
                onAction={() => Taro.redirectTo({ url: '/pages/manage/index' })}
              />
            ) : (
              <Card className="pf-log-card">
                {visibleLogs.map((log, i) => (
                  <View className="pf-log-item" key={log.id || String(i)}>
                    <View className="pf-log-icon">
                      <Icon name="spa" size={34} color={THEME.primary} />
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
              </Card>
            )}

            {/* ---------- 星级反馈 ---------- */}
            <SectionHeader
              title="反馈与建议"
              action={<Text className="muted">历史 {ratings.length} 条</Text>}
            />

            <Card>
              <Text className="pf-form-title">您觉得这个程序好用吗？</Text>
              <StarRating
                value={stars}
                onChange={(n) => {
                  setStars(n)
                  setRatingError('')
                }}
                labels={STARS_LABELS}
                ariaLabel="对这个程序的整体满意度"
                className="pf-stars"
              />
              <Text className="pf-star-note">
                {stars > 0 ? `${stars} 星 · ${STARS_LABELS[stars - 1]}` : '请选择 1–5 星'}
              </Text>

              <Text className="pf-form-label">想说的话（可不填）</Text>
              <Textarea
                className="pf-textarea"
                value={comment}
                maxlength={200}
                ariaLabel="想说的话（可不填）"
                placeholder="哪里好用、哪里让您困惑，或者希望增加什么功能，都欢迎写下来。"
                onInput={(e) => setComment(e.detail.value)}
              />

              {ratingError ? (
                <StateBlock variant="error" compact desc={ratingError} />
              ) : null}

              <Button
                variant="primary"
                block
                className="pf-submit"
                disabled={submitting}
                ariaLabel="提交反馈"
                onClick={submitRating}
              >
                {submitting ? '提交中…' : '提交反馈'}
              </Button>

              {ratings.length === 0 ? (
                <Text className="pf-note-line">还没有提交过反馈，欢迎写下第一条。</Text>
              ) : (
                <View className="pf-rating-list">
                  {ratings.map((r, i) => {
                    const level = Math.max(
                      0,
                      Math.min(5, typeof r.stars === 'number' ? Math.round(r.stars) : 0)
                    )
                    return (
                      <View className="pf-rating-item" key={r.id || String(i)}>
                        <View className="pf-row">
                          <View className="pf-rating-stars">
                            {[1, 2, 3, 4, 5].map((n) => (
                              <Icon
                                key={n}
                                name="star"
                                size={26}
                                color={n <= level ? THEME.yellow : THEME.starOff}
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
            </Card>

            {/* ---------- 生理数据来源 ---------- */}
            <SectionHeader
              title="生理数据来源"
              action={<Text className="muted">数据来源</Text>}
            />

            <Card>
              <View className="pf-row">
                <Text className="pf-source-state">
                  {DEVICE_PROFILES.length === 0
                    ? '暂未登记蓝牙设备'
                    : `已登记 ${DEVICE_PROFILES.length} 款蓝牙设备`}
                </Text>
                <Pill tone={source ? SOURCE_PILL[source] : 'primary'}>
                  {physio ? (source ? SOURCE_LABEL[source] : '来源未标注') : '暂无记录'}
                </Pill>
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
                      <Stat
                        key={it.n}
                        className="pf-physio-cell"
                        label={it.n}
                        value={it.v}
                        unit={it.u}
                      />
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
                      ariaLabel="HRV（毫秒）"
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
                      ariaLabel="GSR（微西门子）"
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
                      ariaLabel="睡眠质量（0–100）"
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
                      ariaLabel="今日步数"
                      placeholder="如 3200"
                      onInput={(e) => {
                        setSteps(e.detail.value)
                        setPhysioDone(false)
                      }}
                    />
                  </View>
                </View>

                {physioError ? (
                  <StateBlock variant="error" compact desc={physioError} />
                ) : null}
                {physioDone && !physioError ? (
                  <Text className="pf-success-line">已写入，压力指数会随生理数据更新</Text>
                ) : null}

                <Button
                  variant="primary"
                  block
                  className="pf-submit"
                  disabled={savingPhysio}
                  ariaLabel="保存今日生理数据"
                  onClick={submitPhysio}
                >
                  {savingPhysio ? '写入中…' : '保存今日数据'}
                </Button>
              </View>
            </Card>
          </>
        ) : null}

        {/* ---------- 研究参与 ---------- */}
        <SectionHeader
          title="研究参与"
          action={<Text className="muted">{study?.study ? study.study.code : '可选'}</Text>}
        />
        <Card className="pf-study">
          {!study?.study ? (
            <>
              <Text className="pf-note-line">
                参与研究需要研究码。加入后按协议分组，并完成指定时间点的量表。
              </Text>
              <View className="pf-study-row">
                <Input
                  className="pf-study-input"
                  value={studyCode}
                  placeholder="输入研究码"
                  ariaLabel="研究码"
                  onInput={(e) => setStudyCode(e.detail.value.toUpperCase())}
                />
                <Button
                  className="pf-study-btn"
                  onClick={() => void joinStudy()}
                  disabled={!studyCode.trim() || studyBusy}
                  ariaLabel="加入研究"
                >
                  加入
                </Button>
              </View>
            </>
          ) : (
            <>
              <Text className="pf-study-title">{study.study.title}</Text>
              <Text className="pf-study-sub">
                研究码 {study.study.code} · 协议 {study.study.protocol_version} · 入组{' '}
                {fmtDateTime(study.enrollment?.assigned_at || '')}
              </Text>
              <View className="pf-study-grid">
                <Stat label="分组" value={study.arm?.code ? study.arm.code : '—'} />
                <Stat label="入组天数" value={study.adherence?.days_since_enroll ?? 0} unit="天" />
                <Stat label="打卡天数" value={study.adherence?.checkin_days ?? 0} unit="天" />
                <Stat label="量表次数" value={study.adherence?.assessments ?? 0} unit="次" />
              </View>
              {study.arm?.label ? <Text className="pf-note-line">{study.arm.label}</Text> : null}
              {nextWindow ? (
                <Text className="pf-study-window">
                  第 {nextWindow.day} 天评估（{nextWindow.scales.map((k) => SCALE_LABEL[k] || k).join(' / ')}）· 截止{' '}
                  {fmtDateTime(nextWindow.due_at)} ·{' '}
                  {nextWindow.open ? '可提交' : nextWindow.late ? '已过期' : '未开放'}
                </Text>
              ) : null}
              <View className="pf-study-actions">
                <Button
                  variant="ghost"
                  block
                  onClick={() => void leaveStudy()}
                  disabled={studyBusy || study.enrollment?.status !== 'active'}
                >
                  {study.enrollment?.status === 'active' ? '退出研究' : '已退出研究'}
                </Button>
              </View>
            </>
          )}
        </Card>
        {studyError ? <StateBlock variant="error" compact desc={studyError} /> : null}

        {/* ---------- 我的数据：导出与注销 ---------- */}
        <SectionHeader title="我的数据" action={<Text className="muted">数据权利</Text>} />
        <Card flush className="pf-data">
          <View className="pf-data-item pf-data-item-static">
            <View className="pf-menu-icon">
              <Icon name="shield-heart" size={32} color={THEME.primaryDark} />
            </View>
            <View className="pf-menu-main">
              <Text className="pf-menu-label">参与研究</Text>
              <Text className="pf-menu-desc">
                {consent?.granted
                  ? `已同意（条款 ${consent.version}）：仅使用去标识后的记录`
                  : '未同意：您的记录不会进入任何研究数据集'}
              </Text>
            </View>
            <Switch
              checked={consent?.granted === true}
              color={THEME.primary}
              disabled={consentSaving}
              ariaLabel="参与研究"
              onChange={(e) => void toggleConsent(e.detail.value)}
            />
          </View>
          <View
            className="pf-data-item"
            onClick={() => void exportData()}
            ariaRole="button"
            ariaLabel="导出我的数据"
          >
            <View className="pf-menu-icon">
              <Icon name="download" size={32} color={THEME.primaryDark} />
            </View>
            <View className="pf-menu-main">
              <Text className="pf-menu-label">导出我的数据</Text>
              <Text className="pf-menu-desc">
                {exporting ? '正在打包…' : '下载自己的全部记录（JSON）'}
              </Text>
            </View>
            <Icon name="chevron-right" size={28} color={THEME.muted} />
          </View>
          <View
            className="pf-data-item"
            onClick={() => void deleteAccount()}
            ariaRole="button"
            ariaLabel="注销账号"
          >
            <View className="pf-menu-icon pf-menu-icon-danger">
              <Icon name="trash-can" size={32} color={THEME.red} />
            </View>
            <View className="pf-menu-main">
              <Text className="pf-menu-label pf-menu-label-danger">注销账号</Text>
              <Text className="pf-menu-desc">
                {deleting ? '正在注销…' : '删除账号与全部记录，无法恢复'}
              </Text>
            </View>
            <Icon name="chevron-right" size={28} color={THEME.muted} />
          </View>
        </Card>
        {exportError ? <StateBlock variant="error" compact desc={exportError} /> : null}
        {consentError ? <StateBlock variant="error" compact desc={consentError} /> : null}
      </View>

      <BottomNav active="profile" />
    </View>
  )
}
