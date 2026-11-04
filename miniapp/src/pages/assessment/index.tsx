import { useCallback, useMemo, useState } from 'react'
import { Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import Icon from '@/components/Icon'
import { Button, Card, Pill, SectionHeader, StateBlock, TopBar } from '@/components/ui'
import { SAFETY } from '@/content/glossary'
import { THEME } from '@/lib/theme'
import { usePageReadAloud } from '@/lib/readAloud'
import { api, isLoggedIn, type AssessmentRecord } from '@/lib/api'
import { SCALES, type ScaleDef } from '@/lib/scales'
import './index.scss'

type Mode = 'list' | 'quiz' | 'result'

const SAFETY_ADVICE =
  '总分不高，不代表这一题可以忽略。请先确保自己安全，把现在的想法告诉一位可信任的人，并尽快联系专业人员。'

function formatDate(raw: string): string {
  if (!raw) return ''
  const date = new Date(raw.includes(' ') ? raw.replace(' ', 'T') : raw)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export default function AssessmentPage() {
  const [mode, setMode] = useState<Mode>('list')
  const [active, setActive] = useState<ScaleDef | null>(null)
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<number[]>([])
  const [advancing, setAdvancing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<AssessmentRecord | null>(null)
  const [history, setHistory] = useState<AssessmentRecord[]>([])
  const [historyError, setHistoryError] = useState('')
  const [historyLoading, setHistoryLoading] = useState(true)

  const loadHistory = useCallback(async () => {
    if (!isLoggedIn()) {
      Taro.reLaunch({ url: '/pages/login/index' })
      return
    }
    setHistoryError('')
    try {
      setHistory(await api.assessments(20))
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : '历史记录加载失败')
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  useDidShow(() => {
    void loadHistory()
  })

  const latestByScale = useMemo(() => {
    const map: Partial<Record<ScaleDef['key'], AssessmentRecord>> = {}
    for (const item of history) {
      if (!map[item.scale]) map[item.scale] = item
    }
    return map
  }, [history])

  const flaggedResult = result?.flag === true
  const resultAdvice = result
    ? flaggedResult
      ? SAFETY_ADVICE
      : result.advice || '结果已保存，可稍后在最近自评里回看。'
    : ''

  // 页面只声明可朗读的文字；合成与播放由全局朗读层负责。
  const readableText =
    mode === 'list'
      ? `量表自评。三份标准化量表：${SCALES.map(
          (s) => `${s.name}，${s.items.length} 题`
        ).join('；')}。选择一份开始，答题时可以随时点朗读。`
      : mode === 'quiz' && active
        ? `第 ${index + 1} 题，共 ${active.items.length} 题。${
            active.items[index]
          }。选项：${active.options.map((o) => o.label).join('、')}。`
        : result
          ? `${result.scaleName || '量表自评'}。得分 ${result.score} 分，满分 ${
              result.maxScore ?? 27
            }。${flaggedResult ? '需要立即关注' : result.severity}。${
              flaggedResult
                ? `${resultAdvice} 请优先照顾自己的安全，必要时拨打 ${SAFETY.emergency} 或${SAFETY.hotlineLabel} ${SAFETY.hotline}。`
                : resultAdvice
            }`
          : ''

  usePageReadAloud(readableText, mode === 'quiz' ? '朗读题目' : '朗读本页', false)

  function start(def: ScaleDef) {
    setActive(def)
    setAnswers([])
    setIndex(0)
    setAdvancing(false)
    setSaving(false)
    setError('')
    setResult(null)
    setMode('quiz')
  }

  function quit() {
    setMode('list')
    setActive(null)
    setError('')
  }

  function backQuestion() {
    if (saving || advancing) return
    setError('')
    if (index <= 0) {
      quit()
      return
    }
    setIndex(index - 1)
  }

  async function submit(def: ScaleDef, nextAnswers: number[]) {
    setSaving(true)
    setError('')
    try {
      const res = await api.submitAssessment(def.key, nextAnswers)
      setResult(res)
      setMode('result')
      void loadHistory()
    } catch (e) {
      setError(e instanceof Error ? e.message : '提交失败，请检查网络后重试')
    } finally {
      setSaving(false)
    }
  }

  function choose(value: number) {
    if (!active || advancing || saving) return
    const next = answers.slice()
    next[index] = value
    setAnswers(next)
    setError('')

    if (index >= active.items.length - 1) {
      void submit(active, next)
      return
    }

    setAdvancing(true)
    setTimeout(() => {
      setIndex((prev) => prev + 1)
      setAdvancing(false)
    }, 160)
  }

  function retrySubmit() {
    if (!active || answers.length !== active.items.length) return
    void submit(active, answers)
  }

  const backHome = () => {
    Taro.redirectTo({ url: '/pages/index/index' })
  }

  // ---------------- 列表 ----------------

  if (mode === 'list') {
    return (
      <View className="page">
        <TopBar title="量表自评" onBack={backHome} backLabel="返回首页" />

        <View className="page-pad">
          <Card tone="tint" className="as-intro">
            <Text className="as-intro-title">三份自评量表</Text>
            <Text className="as-intro-text">
              分别评估照护负担、情绪与焦虑。结果为筛查提示，不构成诊断。
            </Text>
            <View className="as-intro-meta">
              <View className="as-intro-item">
                <Icon name="clock" size={28} color={THEME.primaryDark} />
                <Text>每份 2–3 分钟</Text>
              </View>
              <View className="as-intro-item">
                <Icon name="lock" size={28} color={THEME.primaryDark} />
                <Text>仅自己可见</Text>
              </View>
            </View>
          </Card>

          {SCALES.map((def) => {
            const last = latestByScale[def.key]
            return (
              <View
                className="as-scale-hit"
                key={def.key}
                onClick={() => start(def)}
                ariaRole="button"
                ariaLabel={`开始${def.name}，${def.items.length} 题`}
              >
                <Card className="as-scale">
                  <View className={`as-scale-icon tint-${def.tint}`}>
                    <Icon name={def.icon} size={44} />
                  </View>
                  <View className="as-scale-main">
                    <View className="as-scale-head">
                      <Text className="as-scale-name">{def.name}</Text>
                      <Text className="as-scale-short">{def.short}</Text>
                    </View>
                    <Text className="as-scale-intro">{def.intro}</Text>
                    <View className="as-scale-meta">
                      <Text>{def.items.length} 题</Text>
                      <Text className="as-dot">·</Text>
                      <Text>{def.duration}</Text>
                      {last ? (
                        <Pill
                          tone={last.flag ? 'red' : last.level}
                          className="as-scale-last"
                        >
                          {`上次 ${last.score} 分${last.flag ? ' · 需关注' : ''}`}
                        </Pill>
                      ) : null}
                    </View>
                  </View>
                  <Icon name="chevron-right" size={32} color={THEME.muted} />
                </Card>
              </View>
            )
          })}

          <SectionHeader
            title="最近自评"
            action={
              <Text className="muted">{history.length ? `${history.length} 次` : '暂无'}</Text>
            }
          />

          {historyLoading ? (
            <StateBlock variant="loading" title="正在读取自评记录…" />
          ) : historyError ? (
            <StateBlock
              variant="error"
              title={historyError}
              desc="网络不太稳，稍后再试一次。"
              actionLabel="重新加载"
              onAction={() => {
                setHistoryLoading(true)
                void loadHistory()
              }}
            />
          ) : history.length === 0 ? (
            <StateBlock
              variant="empty"
              title="还没有自评记录"
              desc="选一份量表开始，完成后这里会按时间留下分数与分级，方便回看变化。"
            />
          ) : (
            <Card>
              {history.map((item) => {
                const def = SCALES.find((s) => s.key === item.scale)
                const flagged = item.flag === true
                return (
                  <View className="as-history-item" key={item.id || item.created}>
                    <View className="as-history-main">
                      <Text className="as-history-name">{def?.name || '量表自评'}</Text>
                      <Text className="as-history-date">{formatDate(item.created)}</Text>
                    </View>
                    <View className="as-history-score">
                      <Text className="as-history-value">{item.score}</Text>
                      <Pill tone={flagged ? 'red' : item.level}>
                        {flagged ? '需关注' : item.severity}
                      </Pill>
                    </View>
                  </View>
                )
              })}
            </Card>
          )}

          <Text className="as-disclaimer">
            量表来自公开的 ZBI-12、PHQ-9、GAD-7。分数会随近期状态变化，单次结果不能替代专业评估。
          </Text>
        </View>
      </View>
    )
  }

  // ---------------- 答题 / 结果 ----------------

  if (!active) return null

  if (mode === 'quiz') {
    const question = active.items[index]
    const progress = ((index + 1) / active.items.length) * 100
    const selected = answers[index]

    return (
      <View className="page">
        <TopBar
          title={`${active.name} · ${index + 1} / ${active.items.length}`}
          onBack={backQuestion}
          backLabel={index === 0 ? '退出量表' : '上一题'}
        />

        <View className="as-progress">
          <View className="as-progress-fill" style={{ width: `${progress}%` }} />
        </View>

        <View className="as-quiz-scroll">
          <View className="as-quiz-body">
            <Text className="as-quiz-index">第 {index + 1} 题</Text>
            <Text className="as-quiz-question">{question}</Text>
            <Text className="as-quiz-hint">选择最接近的一项，自动进入下一题</Text>

            <View className="as-options" ariaRole="radiogroup" ariaLabel="选项">
              {active.options.map((opt) => (
                <View
                  key={opt.value}
                  className={`as-option ${selected === opt.value ? 'picked' : ''}`}
                  onClick={() => choose(opt.value)}
                  ariaRole="radio"
                  ariaLabel={opt.label}
                  ariaChecked={selected === opt.value}
                >
                  <Text className="as-option-label">{opt.label}</Text>
                  {selected === opt.value ? (
                    <Icon name="check" size={32} color={THEME.primary} />
                  ) : null}
                </View>
              ))}
            </View>

            {saving ? <Text className="as-saving">正在计算并保存结果…</Text> : null}
            {error ? (
              <StateBlock
                variant="error"
                compact
                title={error}
                actionLabel={answers.length === active.items.length ? '重新提交' : undefined}
                onAction={retrySubmit}
              />
            ) : null}
          </View>
        </View>
      </View>
    )
  }

  if (!result) return null
  const resultDef = SCALES.find((s) => s.key === result.scale) || active
  const percent = result.maxScore ? Math.round((result.score / result.maxScore) * 100) : 0
  const flagged = flaggedResult
  const tone = flaggedResult ? 'red' : result.level
  const adviceText = resultAdvice

  return (
    <View className="page">
      <TopBar title="自评结果" onBack={quit} backLabel="返回量表列表" />

      <View className="page-pad">
        <Card className={`as-result tone-${tone}`}>
          <View className="as-result-head">
            <Text className="as-result-name">{result.scaleName || resultDef.name}</Text>
            <Pill tone={tone}>{flagged ? '需立即关注' : result.severity}</Pill>
          </View>
          <View className="as-result-score">
            <Text className="as-result-value">{result.score}</Text>
            <Text className="as-result-total">/ {result.maxScore ?? resultDef.maxScore}</Text>
          </View>
          <View className="as-result-bar">
            <View className={`as-result-fill lv-${tone}`} style={{ width: `${percent}%` }} />
          </View>
        </Card>

        <Card className="as-advice">
          <View className="as-advice-head">
            <Icon name="circle-info" size={32} color={THEME.primaryDark} />
            <Text className="as-advice-title">结果说明</Text>
          </View>
          <Text className="as-advice-text">{adviceText}</Text>
          <Text className="as-advice-note">
            {SAFETY.disclaimer}
          </Text>
          <Text className="as-advice-followup">
            {result.level === 'green'
              ? '可在一个月后复测，观察趋势即可。'
              : '建议两周后复测；若持续没有缓解，请联系专业人员。'}
          </Text>
        </Card>

        {result.flag ? (
          <View ariaRole="alert">
            <Card className="as-safety">
              <View className="as-safety-head">
                <Icon name="triangle-exclamation" size={36} color={THEME.red} />
                <Text className="as-safety-title">请优先照顾自己的安全</Text>
              </View>
              <Text className="as-safety-text">
                您刚才提到过伤害自己的想法。请现在就联系一位信任的家人或朋友，不要独自待着；
                如有立即危险，请拨打 {SAFETY.emergency}。也可以拨打{SAFETY.hotlineLabel} {SAFETY.hotline}，和专业人员聊一聊。
              </Text>
              <Button
                variant="primary"
                block
                className="as-safety-btn"
                ariaLabel="拨打 {SAFETY.hotline} 心理援助热线"
                onClick={() =>
                  Taro.makePhoneCall({ phoneNumber: SAFETY.hotline }).catch(() =>
                    Taro.showToast({ title: `请拨打 ${SAFETY.hotline}`, icon: 'none' })
                  )
                }
              >
                {`拨打 ${SAFETY.hotline}`}
              </Button>
            </Card>
          </View>
        ) : null}

        <View className="as-result-actions">
          <Button variant="ghost" block onClick={quit}>
            返回量表列表
          </Button>
          <Button variant="primary" block onClick={() => start(resultDef)}>
            再测一次
          </Button>
        </View>

        {error ? <StateBlock variant="error" compact title={error} /> : null}
      </View>
    </View>
  )
}
