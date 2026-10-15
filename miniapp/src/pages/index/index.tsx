import { useCallback, useState } from 'react'
import { Input, Slider, Text, Textarea, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import BottomNav from '@/components/BottomNav'
import {
  api,
  getUser,
  isLoggedIn,
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

const MOODS = [
  { value: 1, icon: '😣', label: '很糟' },
  { value: 2, icon: '🙁', label: '较差' },
  { value: 3, icon: '😐', label: '一般' },
  { value: 4, icon: '🙂', label: '较好' },
  { value: 5, icon: '😊', label: '很好' },
]

export default function HomePage() {
  const [score, setScore] = useState<StressScore | null>(null)
  const [physio, setPhysio] = useState<PhysioRecord | null>(null)
  const [checkins, setCheckins] = useState<Checkin[]>([])
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
      const [s, p, c] = await Promise.all([
        api.latestScore(),
        api.latestPhysio(),
        api.todayCheckins(),
      ])
      setScore(s)
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

  return (
    <View className="page">
      <View className="page-pad">
        <View className="hello">
          <Text className="hello-name">您好，{user?.name || '照护者'}</Text>
          <Text className="hello-date">
            {new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}
          </Text>
        </View>

        {error ? <Text className="error-line">{error}</Text> : null}

        {/* 压力状态卡片 */}
        <View className={`stress-card level-${level}`}>
          <View className="stress-head">
            <Text className="stress-label">今日压力状态</Text>
            <Text className={`pill pill-${level}`}>{LEVEL_TEXT[level]}</Text>
          </View>
          <View className="stress-body">
            <Text className="stress-value">{score ? score.hps.toFixed(0) : '--'}</Text>
            <Text className="stress-unit">HPS 混合压力指数</Text>
          </View>
          <Text className="stress-advice">
            {loading ? '正在评估…' : score?.advice || '暂无评估结果，完成一次打卡即可生成。'}
          </Text>
          <View className="stress-bar">
            {(['score_physio', 'score_psycho', 'score_context'] as const).map((key) => (
              <View className="stress-bar-item" key={key}>
                <Text className="bar-name">
                  {key === 'score_physio' ? '生理' : key === 'score_psycho' ? '心理' : '情境'}
                </Text>
                <View className="bar-track">
                  <View className="bar-fill" style={{ width: `${score ? score[key] : 0}%` }} />
                </View>
                <Text className="bar-value">{score ? score[key].toFixed(0) : '--'}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* 生理数据面板 */}
        <View className="section-title">
          <Text>生理指标</Text>
          {physio ? <Text className="muted">{SOURCE_TEXT[physio.source]}</Text> : null}
        </View>
        <View className="physio-grid">
          {[
            { name: 'HRV', value: physio ? `${physio.hrv}` : '--', unit: 'ms' },
            { name: 'GSR', value: physio ? `${physio.gsr}` : '--', unit: 'µS' },
            { name: '睡眠质量', value: physio ? `${physio.sleep_quality}` : '--', unit: '分' },
            { name: '活动量', value: physio ? `${physio.steps}` : '--', unit: '步' },
          ].map((item) => (
            <View className="physio-tile" key={item.name}>
              <Text className="tile-name">{item.name}</Text>
              <View className="tile-value-row">
                <Text className="tile-value">{item.value}</Text>
                <Text className="tile-unit">{item.unit}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* 打卡入口 */}
        <View className="section-title">
          <Text>今日打卡</Text>
          <Text className="muted">已完成 {checkins.length} 次</Text>
        </View>

        {!showForm ? (
          <View className="card checkin-entry">
            <View className="checkin-text">
              <Text className="checkin-title">
                {todayChecked ? '再记录一次此刻的感受' : '记录此刻的感受'}
              </Text>
              <Text className="muted">在自然情境下即时记录，避免回顾带来的偏差（EMA）</Text>
            </View>
            <View className="btn-primary checkin-btn" onClick={() => setShowForm(true)}>
              去打卡
            </View>
          </View>
        ) : (
          <View className="card-lg">
            <Text className="form-title">此刻的心情</Text>
            <View className="mood-row">
              {MOODS.map((m) => (
                <View
                  key={m.value}
                  className={`mood-item ${mood === m.value ? 'picked' : ''}`}
                  onClick={() => setMood(m.value)}
                >
                  <Text className="mood-icon">{m.icon}</Text>
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
                activeColor="#2E8B84"
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
                activeColor="#2E8B84"
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

            {error ? <Text className="error-line">{error}</Text> : null}

            <View className="form-actions">
              <View className="btn-ghost action" onClick={() => setShowForm(false)}>
                取消
              </View>
              <View className={`btn-primary action ${saving ? 'busy' : ''}`} onClick={submitCheckin}>
                {saving ? '提交中…' : '提交打卡'}
              </View>
            </View>
          </View>
        )}
      </View>

      <BottomNav active="index" />
    </View>
  )
}
