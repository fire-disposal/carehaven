import { useEffect, useState } from 'react'
import Taro from '@tarojs/taro'
import { Input, Slider, Text, Textarea, View } from '@tarojs/components'
import Icon from '@/components/Icon'
import { Button, Card, SectionHeader, TopBar } from '@/components/ui'
import { MOODS } from '@/lib/mood'
import { backOrSwitchTab } from '@/lib/nav'
import { THEME } from '@/lib/theme'
import { api } from '@/lib/api'
import { getReminderConfig, subscribeReminder, type ReminderConfig } from '@/lib/remind'
import './index.scss'


type Prefill = { mood: number; anxiety: number; fatigue: number; sleep_hours: number; care_hours: number }

function readPrefill(): Prefill | null {
  try {
    const raw = Taro.getStorageSync('zz_checkin_prefill')
    return raw ? (JSON.parse(String(raw)) as Prefill) : null
  } catch {
    return null
  }
}

function todayLabel(): string {
  const now = new Date()
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()]
  return `${now.getMonth() + 1}月${now.getDate()}日 · ${week}`
}

export default function CheckinPage() {
  const prefill = readPrefill()
  const [mood, setMood] = useState(prefill?.mood ?? 3)
  const [anxiety, setAnxiety] = useState(prefill?.anxiety ?? 4)
  const [fatigue, setFatigue] = useState(prefill?.fatigue ?? 5)
  const [sleepHours, setSleepHours] = useState(String(prefill?.sleep_hours ?? 6.5))
  const [careHours, setCareHours] = useState(String(prefill?.care_hours ?? 8))
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  // 订阅提醒：与量表结果页同一套逻辑，只是 kind 与到期时间不同
  const [remindConfig, setRemindConfig] = useState<ReminderConfig>({ enabled: false, template_id: '' })
  const [remindState, setRemindState] = useState<'idle' | 'busy' | 'done'>('idle')

  useEffect(() => {
    void getReminderConfig().then(setRemindConfig)
  }, [])

  // 一次性订阅：授权成功才登记；拒绝与失败都给出温和提示
  async function turnOnReminder() {
    if (remindState === 'busy') return
    setRemindState('busy')
    const outcome = await subscribeReminder('checkin_next_day', remindConfig.template_id)
    if (outcome.status === 'accept') {
      setRemindState('done')
      return
    }
    setRemindState('idle')
    if (outcome.status === 'rejected' && outcome.notice) {
      void Taro.showToast({ title: outcome.notice, icon: 'none', duration: 2500 })
    } else if (outcome.status === 'decline' || outcome.status === 'ban') {
      void Taro.showToast({ title: '未开启提醒', icon: 'none' })
    } else if (outcome.status === 'unknown') {
      void Taro.showToast({ title: '授权成功，但提醒登记失败，请重试', icon: 'none', duration: 2500 })
    }
  }

  async function submit() {
    if (saving) return
    const sleep = Number(sleepHours)
    if (!Number.isFinite(sleep) || sleep < 0 || sleep > 24) {
      setError('请填写 0–24 之间的睡眠时长')
      return
    }
    const care = Number(careHours)
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
      Taro.setStorageSync(
        'zz_checkin_prefill',
        JSON.stringify({ mood, anxiety, fatigue, sleep_hours: sleep, care_hours: care })
      )
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : '提交失败，请稍后再试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <View className="ck-page">
      <TopBar title="记录此刻" backLabel="返回" onBack={() => void backOrSwitchTab('/pages/index/index')} />

      {done ? (
        <View className="page-pad ck-done">
          <View className="ck-done-icon">
            <Icon name="check" size={64} color={THEME.primary} />
          </View>
          <Text className="ck-done-title">今天的记录已保存</Text>
          <Text className="ck-done-desc">压力指数是日级快照，打卡次数越多，它越贴近你这一天的真实状态。</Text>
          <Card className="ck-done-card">
            <Text className="ck-done-label">接下来</Text>
            <Text className="ck-done-tip">如果现在还紧绷，可以做一个两分钟的呼吸练习。</Text>
          </Card>
          <Button variant="primary" block onClick={() => void Taro.switchTab({ url: '/pages/manage/index' })}>
            去减压练习
          </Button>
          <Button variant="secondary" block onClick={() => void Taro.switchTab({ url: '/pages/index/index' })}>
            返回首页
          </Button>
          {remindConfig.enabled ? (
            <Button variant="secondary" block disabled={remindState === 'done'} onClick={turnOnReminder}>
              {remindState === 'done' ? '已开启，明天提醒你' : '明天提醒我打卡'}
            </Button>
          ) : null}
        </View>
      ) : (
        <>
          <View className="page-pad ck-body">
            <Text className="ck-date">{todayLabel()}</Text>
            <Text className="ck-intro">两分钟，记下今天的感受。只用于生成你的压力指数，不会公开。</Text>

            <View className="ck-section">
              <SectionHeader title="此刻的心情" />
              <View className="ck-moods" ariaRole="radiogroup" ariaLabel="此刻的心情">
                {MOODS.map((m) => (
                  <View
                    key={m.value}
                    className={`ck-mood ${mood === m.value ? 'picked' : ''}`}
                    onClick={() => setMood(m.value)}
                    ariaRole="radio"
                    ariaChecked={mood === m.value}
                    ariaLabel={m.label}
                  >
                    <Icon name={m.icon} size={48} />
                    <Text className="ck-mood-label">{m.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View className="ck-section">
              <SectionHeader title="身体与情绪" />
              <Card className="ck-card">
                <View className="ck-slider-head">
                  <Text className="ck-label">焦虑程度</Text>
                  <Text className="ck-value">{anxiety}</Text>
                </View>
                <Slider
                  min={0}
                  max={10}
                  step={1}
                  value={anxiety}
                  activeColor={THEME.primary}
                  backgroundColor={THEME.line}
                  blockColor={THEME.primary}
                  blockSize={24}
                  ariaLabel={`焦虑程度，当前 ${anxiety} 分，满分 10 分`}
                  onChanging={(e) => setAnxiety(e.detail.value)}
                  onChange={(e) => setAnxiety(e.detail.value)}
                />
                <View className="ck-scale">
                  <Text className="ck-scale-text">不焦虑</Text>
                  <Text className="ck-scale-text">很焦虑</Text>
                </View>

                <View className="ck-slider-head">
                  <Text className="ck-label">疲惫程度</Text>
                  <Text className="ck-value">{fatigue}</Text>
                </View>
                <Slider
                  min={0}
                  max={10}
                  step={1}
                  value={fatigue}
                  activeColor={THEME.primary}
                  backgroundColor={THEME.line}
                  blockColor={THEME.primary}
                  blockSize={24}
                  ariaLabel={`疲惫程度，当前 ${fatigue} 分，满分 10 分`}
                  onChanging={(e) => setFatigue(e.detail.value)}
                  onChange={(e) => setFatigue(e.detail.value)}
                />
                <View className="ck-scale">
                  <Text className="ck-scale-text">不累</Text>
                  <Text className="ck-scale-text">筋疲力尽</Text>
                </View>
              </Card>
            </View>

            <View className="ck-section">
              <SectionHeader title="昨夜与今天" />
              <Card className="ck-card">
                <View className="ck-num-row">
                  <View className="ck-num-field">
                    <Text className="ck-label">昨夜睡眠</Text>
                    <View className="ck-input-line">
                      <Input
                        className="ck-input"
                        type="digit"
                        value={sleepHours}
                        ariaLabel="昨夜睡眠时长，单位小时"
                        onInput={(e) => setSleepHours(e.detail.value)}
                      />
                      <Text className="ck-unit">小时</Text>
                    </View>
                  </View>
                  <View className="ck-num-field">
                    <Text className="ck-label">今日照护</Text>
                    <View className="ck-input-line">
                      <Input
                        className="ck-input"
                        type="digit"
                        value={careHours}
                        ariaLabel="今日照护时长，单位小时"
                        onInput={(e) => setCareHours(e.detail.value)}
                      />
                      <Text className="ck-unit">小时</Text>
                    </View>
                  </View>
                </View>
              </Card>
            </View>

            <View className="ck-section">
              <SectionHeader title="想补充的话" action={<Text className="muted">可不填</Text>} />
              <Textarea
                className="ck-note"
                value={note}
                maxlength={200}
                placeholder="今天发生了什么让您感到压力的事？"
                ariaLabel="想补充的话，可以不填"
                onInput={(e) => setNote(e.detail.value)}
              />
            </View>

            {error ? <Text className="ck-error">{error}</Text> : null}
          </View>

          <View className="ck-footer">
            <Button variant="primary" block loading={saving} disabled={saving} onClick={() => void submit()}>
              完成打卡
            </Button>
            <Text className="ck-footnote">只记录在您的账号下，不会公开</Text>
          </View>
        </>
      )}
    </View>
  )
}
