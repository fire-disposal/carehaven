import { useEffect, useMemo, useRef, useState } from 'react'
import { Input, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Button, Card, StarRating, TopBar } from '@/components/ui'
import SceneBackdrop from '@/components/guide/SceneBackdrop'
import BreathingOrb from '@/components/guide/BreathingOrb'
import PhaseTrack from '@/components/guide/PhaseTrack'
import { backOrSwitchTab } from '@/lib/nav'
import { getAudioBus } from '@/lib/audio'
import { scriptById, useGuideSession } from '@/lib/guide'
import { NarrationPlayer } from '@/lib/narration'
import type { PhaseKind } from '@/lib/guide'
import { api, type Intervention } from '@/lib/api'
import './index.scss'

const STAR_LABELS = ['没什么帮助', '帮助较小', '一般', '有帮助', '很有帮助']

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export default function GuidePage() {
  const params = Taro.getCurrentInstance().router?.params ?? {}
  const title = params.title ? decodeURIComponent(params.title) : ''
  const category = params.cat ? decodeURIComponent(params.cat) : ''
  const interventionId = params.sid || ''
  const script = useMemo(() => scriptById(params.script), [params.script])

  const [started, setStarted] = useState(false)
  const [ended, setEnded] = useState(false)
  const [voiceOn, setVoiceOn] = useState(() => Taro.getStorageSync('zz_guide_voice') !== '0')
  const [stars, setStars] = useState(0)
  const [minutes, setMinutes] = useState(String(Math.max(1, Math.round(script.phases.reduce((s, p) => s + p.seconds, 0) / 60))))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const startedAt = useRef(0)
  const audio = useRef(getAudioBus())
  const narrator = useRef(new NarrationPlayer())
  const voiceRef = useRef(voiceOn)
  voiceRef.current = voiceOn

  const session = useGuideSession(
    script,
    {
      onPhase: (phase, index) => {
        audio.current.cue('phase')
        if (voiceRef.current && (index > 0 || !script.introVoice)) narrator.current.play(phase.voice)
      },
      onEnd: () => {
        audio.current.cue('end')
        audio.current.setAmbient('none')
        narrator.current.stop()
        setEnded(true)
      },
    },
    started && !ended
  )

  useEffect(() => () => {
    narrator.current.destroy()
    audio.current.setAmbient('none')
  }, [])

  const holdScale = session.phase.kind === 'inhale' ? 1.08 : 0.8

  function begin() {
    setStarted(true)
    startedAt.current = Date.now()
    void audio.current.unlock()
    audio.current.cue('start')
    audio.current.setAmbient(script.ambient)
    if (voiceRef.current) {
      if (script.introVoice) narrator.current.play(script.introVoice)
      else narrator.current.play(script.phases[0]?.voice)
    }
  }

  function toggleVoice() {
    const next = !voiceOn
    setVoiceOn(next)
    Taro.setStorageSync('zz_guide_voice', next ? '1' : '0')
    if (!next) {
      narrator.current.stop()
    } else if (started && !ended) {
      narrator.current.play(session.phase.voice)
    }
  }

  function togglePause() {
    if (session.paused) {
      session.resume()
      if (voiceOn) narrator.current.play(session.phase.voice)
    } else {
      session.pause()
      narrator.current.stop()
    }
  }

  async function save() {
    if (!interventionId) {
      void backOrSwitchTab('/pages/manage/index')
      return
    }
    const chosen = Math.min(5, Math.max(0, Math.round(stars)))
    if (chosen < 1) {
      setError('请先选择这次练习的效果')
      return
    }
    const actual = Math.round(Number(minutes))
    if (!Number.isFinite(actual) || actual < 1 || actual > 240) {
      setError('请填写 1–240 分钟之间的实际时长')
      return
    }
    const intervention: Intervention = {
      id: interventionId,
      title: title || script.title,
      category: (category || '冥想练习') as Intervention['category'],
      level_target: 'green',
      duration_min: actual,
      description: '',
      cover_emoji: '',
      sort: 0,
    }
    setSaving(true)
    setError('')
    try {
      await api.logIntervention({ intervention, duration_actual: actual, feeling: chosen })
      await api.createRating({ target: 'intervention', target_id: interventionId, stars: chosen }).catch(() => undefined)
      Taro.showToast({ title: '已记录，压力指数会更新', icon: 'none' })
      void backOrSwitchTab('/pages/manage/index')
    } catch (e) {
      setError(e instanceof Error ? e.message : '记录失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }


  return (
    <View className="gd-page">
      <SceneBackdrop scene={script.scene} />
      <TopBar title={script.title} backLabel="退出" onBack={() => void backOrSwitchTab('/pages/manage/index')} />

      {!started ? (
        <View className="gd-body gd-start">
          <Text className="gd-title">{script.title}</Text>
          <Text className="gd-sub">{script.subtitle}</Text>
          <Text className="gd-minutes">{Math.max(1, Math.round(session.totalSeconds / 60))} 分钟</Text>
          <Button variant="primary" block onClick={begin} ariaLabel="开始引导">
            开始
          </Button>
        </View>
      ) : ended ? (
        <View className="gd-body gd-done">
          <Text className="gd-done-title">完成了</Text>
          {interventionId ? (
            <Card className="gd-rate">
              <Text className="gd-rate-title">这次练习有帮助吗</Text>
              <StarRating value={stars} onChange={setStars} labels={STAR_LABELS} ariaLabel="这次练习的效果" />
              <View className="gd-duration">
                <Text className="gd-rate-label">实际时长（分钟）</Text>
                <Input
                  className="gd-duration-input"
                  type="number"
                  value={minutes}
                  onInput={(e) => setMinutes(e.detail.value)}
                  ariaLabel="实际练习时长"
                />
              </View>
              {error ? <Text className="gd-error">{error}</Text> : null}
              <Button variant="primary" block loading={saving} disabled={saving} onClick={() => void save()}>
                保存记录
              </Button>
              <Button variant="ghost" block onClick={() => void backOrSwitchTab('/pages/manage/index')}>
                不记录，直接返回
              </Button>
            </Card>
          ) : (
            <Button variant="primary" block onClick={() => void backOrSwitchTab('/pages/manage/index')}>
              返回减压
            </Button>
          )}
        </View>
      ) : (
        <View className="gd-body gd-live">
          <PhaseTrack script={script} index={session.index} />

          {script.scene === 'breath' ? (
            <BreathingOrb
              kind={session.phase.kind as PhaseKind}
              seconds={session.phase.seconds}
              holdScale={holdScale}
              paused={session.paused}
              label={session.phase.label}
              remaining={session.remaining}
            />
          ) : (
            <View className="gd-prompt">
              <Text className="gd-prompt-label">{session.phase.label}</Text>
              <Text className="gd-prompt-detail">{session.phase.detail}</Text>
              <Text className="gd-prompt-remain">还剩 {session.remaining} 秒</Text>
            </View>
          )}

          <Text className="gd-clock">
            {pad(Math.floor(session.elapsedSeconds / 60))}:{pad(Math.floor(session.elapsedSeconds % 60))}
          </Text>

          <View className="gd-controls">
            <Button variant="secondary" onClick={togglePause} ariaLabel={session.paused ? '继续' : '暂停'}>
              {session.paused ? '继续' : '暂停'}
            </Button>
            <Button variant="ghost" onClick={toggleVoice} ariaLabel={voiceOn ? '关闭语音' : '打开语音'}>
              {voiceOn ? '语音开' : '语音关'}
            </Button>
            <Button variant="ghost" onClick={() => {
              narrator.current.stop()
              audio.current.setAmbient('none')
              setEnded(true)
            }} ariaLabel="提前结束">
              结束
            </Button>
          </View>
        </View>
      )}
    </View>
  )
}
