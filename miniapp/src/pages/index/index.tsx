import { useCallback, useState } from 'react'
import { Input, Slider, Text, Textarea, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import BottomNav from '@/components/BottomNav'
import Icon from '@/components/Icon'
import type { IconName } from '@/lib/icons'
import {
  api,
  getUser,
  isLoggedIn,
  type AssessmentRecord,
  type Checkin,
  type PhysioRecord,
  type StressScore,
} from '@/lib/api'
import './index.scss'

const LEVEL_TEXT: Record<StressScore['level'], string> = {
  green: '压力平稳',
  yellow: '压力预警',
  red: '压力偏高',
}

const SOURCE_TEXT: Record<PhysioRecord['source'], string> = {
  device: '设备采集',
  simulated: '模拟数据',
  manual: '手动录入',
}

const MOODS: { value: number; icon: IconName; label: string }[] = [
  { value: 1, icon: 'face-angry', label: '很糟' },
  { value: 2, icon: 'face-frown', label: '较差' },
  { value: 3, icon: 'face-meh', label: '一般' },
  { value: 4, icon: 'face-smile', label: '较好' },
  { value: 5, icon: 'face-grin-beam', label: '很好' },
]

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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)

  // 打卡表单
  const [mood, setMood] = useState(3)
  const [anxiety, setAnxiety] = useState(4)
  const [fatigue, setFatigue] = useState(5)
  const [sleepHours, setSleepHours] = useState('6.5')
  const [careHours, setCareHours] = useState('8')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!isLoggedIn()) {
      Taro.reLaunch({ url: '/pages/login/index' })
      return
    }
    setLoading(true)
    setError('')
    try {
      const [s, p, c, a] = await Promise.all([
        api.latestScore(),
        api.latestPhysio(),
        api.todayCheckins(),
        api.assessments(1).catch(() => [] as AssessmentRecord[]),
      ])
      setScore(s)
      setPhysio(p)
      setCheckins(c)
      setLatestAssessment(a[0] || null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '数据加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useDidShow(() => {
    void load()
  })

  async function submitCheckin() {
    if (saving) return
    const sleep = Number(sleepHours)
    const care = Number(careHours)
    if (!Number.isFinite(sleep) || sleep < 0 || sleep > 24) {
      setError('请填写 0–24 之间的睡眠时长')
      return
    }
    if (!Number.isFinite(care) || care < 0 || care > 24) {
      setError('请填写 0–24 之间的照护时长')
      return
    }
    setSaving(true)
    setError('')
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
      setShowForm(false)
      setNote('')
      await load()
      Taro.showToast({ title: '打卡已记录，压力指数已更新', icon: 'none' })
    } catch (e) {
      setError(e instanceof Error ? e.message : '提交失败')
    } finally {
      setSaving(false)
    }
  }

  const user = getUser()
  const todayChecked = checkins.length > 0
  const level = score?.level ?? 'green'
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

  return (
    <View className="page">
      <View className="page-pad">
        <View className="home-head">
          <View className="home-hello">
            <Text className="hello-name">
              {greeting}，{user?.name || '照护者'}
            </Text>
            <Text className="hello-date">{todayText}</Text>
          </View>
          <View className="home-avatar" ariaHidden>
            <Icon name="leaf" size={40} color="#1f6b65" />
          </View>
        </View>

        {error ? <Text className="error-line">{error}</Text> : null}

        {/* 压力状态 + 打卡主入口 */}
        <View className={`stress-card level-${level}`}>
          <View className="stress-head">
            <View className="stress-title-row">
              <Icon name="heart-pulse" size={36} color="currentColor" />
              <Text className="stress-label">今日压力状态</Text>
            </View>
            <Text className={`pill pill-${level}`}>{LEVEL_TEXT[level]}</Text>
          </View>
          <View className="stress-body">
            <Text className="stress-value">{score ? score.hps.toFixed(0) : '--'}</Text>
            <Text className="stress-unit">综合压力指数（HPS）</Text>
          </View>
          <Text className="stress-advice">
            {loading ? '正在评估…' : score?.advice || '暂无评估结果，完成一次打卡即可生成。'}
          </Text>
          <View className="stress-bar">
            {(['score_physio', 'score_psycho', 'score_context'] as const).map((key) => (
              <View className="stress-bar-item" key={key}>
                <Text className="bar-name">
                  {key === 'score_physio' ? '生理' : key === 'score_psycho' ? '心理' : '生活'}
                </Text>
                <View className="bar-track">
                  <View className="bar-fill" style={{ width: `${score ? score[key] : 0}%` }} />
                </View>
                <Text className="bar-value">{score ? score[key].toFixed(0) : '--'}</Text>
              </View>
            ))}
          </View>

          <View className="stress-foot">
            <View className="stress-checkin-state">
              <Icon name="calendar-days" size={28} color="#45585a" />
              <Text>
                今日{checkins.length ? `已记录 ${checkins.length} 次` : '还没有记录'}
              </Text>
            </View>
            <View
              className="btn-primary stress-cta"
              onClick={() => setShowForm(!showForm)}
              ariaRole="button"
              ariaLabel={todayChecked ? '再记录一次感受' : '记录此刻感受'}
            >
              {todayChecked ? '再记一次' : '记录此刻'}
            </View>
          </View>
        </View>

        {/* 打卡表单 */}
        {showForm ? (
          <View className="card-lg checkin-form">
            <View className="form-head">
              <Text className="form-title">此刻的心情</Text>
              <View
                className="form-close"
                onClick={() => setShowForm(false)}
                ariaRole="button"
                ariaLabel="收起打卡表单"
              >
                <Icon name="xmark" size={32} color="#5b7074" />
              </View>
            </View>
            <View className="mood-row">
              {MOODS.map((m) => (
                <View
                  key={m.value}
                  className={`mood-item ${mood === m.value ? 'picked' : ''}`}
                  onClick={() => setMood(m.value)}
                  ariaRole="button"
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
                activeColor="#287a73"
                blockSize={22}
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
                activeColor="#287a73"
                blockSize={22}
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
                  onInput={(e) => setSleepHours(e.detail.value)}
                />
              </View>
              <View className="num-field">
                <Text className="form-label">今日照护（小时）</Text>
                <Input
                  className="num-input"
                  type="digit"
                  value={careHours}
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
              onInput={(e) => setNote(e.detail.value)}
            />

            <View className="form-actions">
              <View className="btn-ghost action" onClick={() => setShowForm(false)}>
                取消
              </View>
              <View className={`btn-primary action ${saving ? 'busy' : ''}`} onClick={submitCheckin}>
                {saving ? '提交中…' : '提交打卡'}
              </View>
            </View>
          </View>
        ) : null}

        {/* 次级入口 */}
        <View className="quick-grid">
          <View
            className="quick-tile quick-wide"
            onClick={() => Taro.navigateTo({ url: '/pages/assessment/index' })}
            ariaRole="button"
            ariaLabel={`量表自评，${checkinSubtitle}`}
          >
            <View className="quick-icon">
              <Icon name="clipboard-list" size={40} />
            </View>
            <View className="quick-main">
              <Text className="quick-title">量表自评</Text>
              <Text className="quick-sub">{checkinSubtitle}</Text>
            </View>
            <Icon name="chevron-right" size={32} color="#5b7074" />
          </View>
          <View
            className="quick-tile"
            onClick={() => Taro.redirectTo({ url: '/pages/manage/index' })}
            ariaRole="button"
            ariaLabel="减压练习"
          >
            <View className="quick-icon tint-yellow">
              <Icon name="spa" size={40} />
            </View>
            <Text className="quick-title">减压练习</Text>
            <Text className="quick-sub">按当前状态推荐</Text>
          </View>
          <View
            className="quick-tile"
            onClick={() => Taro.redirectTo({ url: '/pages/qa/index' })}
            ariaRole="button"
            ariaLabel="知识问答"
          >
            <View className="quick-icon tint-blue">
              <Icon name="comment-dots" size={40} />
            </View>
            <Text className="quick-title">知识问答</Text>
            <Text className="quick-sub">照护问题即时查</Text>
          </View>
        </View>

        {/* 今日记录 */}
        {checkins.length > 0 ? (
          <>
            <View className="section-title">
              <Text>今日记录</Text>
              <Text className="muted">{checkins.length} 次打卡</Text>
            </View>
            <View className="card today-list">
              {checkins.map((item) => {
                const m = MOODS.find((x) => x.value === item.mood) || MOODS[2]
                return (
                  <View className="today-item" key={item.id}>
                    <View className="today-icon">
                      <Icon name={m.icon} size={36} color="#2e8b84" />
                    </View>
                    <View className="today-main">
                      <Text className="today-title">
                        {m.label} · 焦虑 {item.anxiety} · 疲惫 {item.fatigue}
                      </Text>
                      <Text className="today-meta">
                        {checkinTime(item)} · 睡眠 {item.sleep_hours} 小时 · 照护 {item.care_hours} 小时
                      </Text>
                    </View>
                    <Text className="pill pill-primary">{item.period === 'morning' ? '日间' : '晚间'}</Text>
                  </View>
                )
              })}
            </View>
          </>
        ) : null}

        {/* 身体状态 */}
        <View className="section-title">
          <Text>身体状态</Text>
          <Text className="muted">{physio ? SOURCE_TEXT[physio.source] : '暂无记录'}</Text>
        </View>
        <View className="physio-grid">
          {[
            { name: 'HRV', icon: 'heart-pulse' as IconName, value: physio ? `${physio.hrv}` : '--', unit: 'ms' },
            { name: 'GSR', icon: 'wind' as IconName, value: physio ? `${physio.gsr}` : '--', unit: 'µS' },
            { name: '睡眠质量', icon: 'bed' as IconName, value: physio ? `${physio.sleep_quality}` : '--', unit: '分' },
            { name: '活动量', icon: 'person-walking' as IconName, value: physio ? `${physio.steps}` : '--', unit: '步' },
          ].map((item) => (
            <View className="physio-tile" key={item.name}>
              <View className="tile-head">
                <Icon name={item.icon} size={28} color="#5b7074" />
                <Text className="tile-name">{item.name}</Text>
              </View>
              <View className="tile-value-row">
                <Text className="tile-value">{item.value}</Text>
                <Text className="tile-unit">{item.unit}</Text>
              </View>
            </View>
          ))}
        </View>
        {physio?.source === 'simulated' ? (
          <Text className="source-note">
            这些是模拟数据，用于展示系统效果，不是设备的真实测量结果。
          </Text>
        ) : null}
      </View>

      <BottomNav active="index" />
    </View>
  )
}
