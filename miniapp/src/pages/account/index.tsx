import { useCallback, useEffect, useState } from 'react'
import { Input, Switch, Text, View } from '@tarojs/components'
import Taro, { useRouter } from '@tarojs/taro'
import Icon from '@/components/Icon'
import { Button, Card, Pill, SectionHeader, StateBlock, Stat, TopBar } from '@/components/ui'
import type { PillTone } from '@/components/ui'
import { DEVICE_PROFILES, ingestPhysio } from '@/lib/physio'
import {
  api,
  clearSession,
  isLoggedIn,
  type PhysioRecord,
  type ResearchConsent,
  type StudyMe,
} from '@/lib/api'
import { SOURCE_LABEL, SOURCE_NOTE } from '@/content/glossary'
import { PAGE_TITLES } from '@/content/site'
import { THEME } from '@/lib/theme'
import { backOrSwitchTab } from '@/lib/nav'
import './index.scss'

// ---------- 文案表 ----------

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

/** 数据来源是三个固定取值，异常值不冒充设备采集 */
function isPhysioSource(value: unknown): value is PhysioRecord['source'] {
  return value === 'device' || value === 'simulated' || value === 'manual'
}

export default function AccountPage() {
  const router = useRouter()
  // 首页「生理数据」入口带 ?focus=physio 进来：加载完成后定位到手动录入
  const focusParam = router.params?.focus || ''

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [physio, setPhysio] = useState<PhysioRecord | null>(null)
  const [focusPhysio, setFocusPhysio] = useState(false)

  // 手动录入生理数据
  const [hrv, setHrv] = useState('')
  const [gsr, setGsr] = useState('')
  const [sleepQuality, setSleepQuality] = useState('')
  const [steps, setSteps] = useState('')
  const [physioError, setPhysioError] = useState('')
  const [physioDone, setPhysioDone] = useState(false)
  const [savingPhysio, setSavingPhysio] = useState(false)

  // 我的数据：导出 / 注销
  const [exporting, setExporting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [exportError, setExportError] = useState('')

  // 研究参与同意：默认未同意，只有显式打开才进入研究数据集
  const [consent, setConsent] = useState<ResearchConsent | null>(null)
  const [consentSaving, setConsentSaving] = useState(false)
  const [consentError, setConsentError] = useState('')

  // 研究参与：研究码入组、分组（受盲法控制）与依从概况
  const [study, setStudy] = useState<StudyMe | null>(null)
  const [studyCode, setStudyCode] = useState('')
  const [studyBusy, setStudyBusy] = useState(false)
  const [studyError, setStudyError] = useState('')

  const backProfile = () => {
    void backOrSwitchTab('/pages/profile/index')
  }

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
      const [p, consentState, studyState] = await Promise.all([
        api.latestPhysio(),
        api.researchConsent().catch(() => null),
        api.studyMe().catch(() => null),
      ])
      setPhysio(p)
      setConsent(consentState)
      setStudy(studyState && studyState.study ? studyState : null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '数据加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // 首页「生理数据」入口带 ?focus=physio 进来：首次定位到手动录入并短暂高亮
  useEffect(() => {
    if (focusParam !== 'physio') return
    setFocusPhysio(true)
    Taro.pageScrollTo({ selector: '.ac-form-block', duration: 300 }).catch(() => {})
    const timer = setTimeout(() => setFocusPhysio(false), 2400)
    return () => clearTimeout(timer)
  }, [focusParam])

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
      await ingestPhysio({
        source: 'manual',
        capturedAt: new Date(),
        metrics: { hrv: hrvValue, gsr: gsrValue, sleep_quality: sleepValue, steps: stepsValue },
      })
      setHrv('')
      setGsr('')
      setSleepQuality('')
      setSteps('')
      setPhysioDone(true)
      setPhysio(await api.latestPhysio())
      Taro.showToast({ title: '已写入，压力指数会随生理数据更新', icon: 'none' })
    } catch (e) {
      setPhysioError(e instanceof Error ? e.message : '写入失败，请稍后再试')
    } finally {
      setSavingPhysio(false)
    }
  }

  const source = physio && isPhysioSource(physio.source) ? physio.source : null

  const nextWindow =
    (study?.schedule || []).find((item) => item.open) ||
    (study?.schedule || []).find((item) => !item.late) ||
    null

  return (
    <View className="page">
      <TopBar title={PAGE_TITLES.account} onBack={backProfile} backLabel="返回我的" />

      <View className="page-pad">
        {error ? (
          <StateBlock
            variant="error"
            compact={physio !== null}
            title={physio !== null ? undefined : '数据没能加载出来'}
            desc={error}
            actionLabel="重新加载"
            onAction={() => void load()}
          />
        ) : null}

        {loading ? <StateBlock variant="loading" title="正在加载…" /> : null}

        {/* ---------- 生理数据来源 ---------- */}
        <SectionHeader title="生理数据来源" action={<Text className="muted">数据来源</Text>} />

        {loading ? null : (
          <Card>
            <View className="ac-row">
              <Text className="ac-source-state">
                {DEVICE_PROFILES.length === 0
                  ? '暂未登记蓝牙设备'
                  : `已登记 ${DEVICE_PROFILES.length} 款蓝牙设备`}
              </Text>
              <Pill tone={source ? SOURCE_PILL[source] : 'primary'}>
                {physio ? (source ? SOURCE_LABEL[source] : '来源未标注') : '暂无记录'}
              </Pill>
            </View>

            <Text className="ac-source-desc">
              当前没有连接蓝牙设备。您可以在下方手动填写手环或手机健康应用里的读数；
              接入设备后，数据会自动同步到这里。
            </Text>

            {physio ? (
              <>
                <View className="ac-physio-grid">
                  {[
                    { n: 'HRV', v: showNum(physio.hrv, 1), u: 'ms' },
                    { n: 'GSR', v: showNum(physio.gsr, 2), u: 'µS' },
                    { n: '睡眠质量', v: showNum(physio.sleep_quality), u: '分' },
                    { n: '步数', v: showNum(physio.steps), u: '步' },
                  ].map((it) => (
                    <Stat
                      key={it.n}
                      className="ac-physio-cell"
                      label={it.n}
                      value={it.v}
                      unit={it.u}
                    />
                  ))}
                </View>
                <Text className="ac-source-desc">
                  最新一条记录时间：{fmtDateTime(physio.date)}
                </Text>
                <Text className={`ac-source-note note-${source ?? 'manual'}`}>
                  {source
                    ? SOURCE_NOTE[source]
                    : '这条记录没有标注来源，请勿当作设备测量结果。'}
                </Text>
              </>
            ) : (
              <Text className="ac-source-note note-manual">
                还没有生理数据，可以在下方手动填写。
              </Text>
            )}

            <View className={`ac-form-block ${focusPhysio ? 'ac-physio-focus' : ''}`}>
              <Text className="ac-form-title">手动录入今日数据</Text>
              <Text className="ac-form-desc">
                按您手边能得到的读数填写即可（例如手环或手机健康应用）。保存后来源会标注为
                「手动录入」，不会被当成设备采集的数据。
              </Text>

              <View className="ac-num-row">
                <View className="ac-num-field">
                  <Text className="ac-form-label">HRV（毫秒）</Text>
                  <Input
                    className="ac-num-input"
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
                <View className="ac-num-field">
                  <Text className="ac-form-label">GSR（微西门子）</Text>
                  <Input
                    className="ac-num-input"
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

              <View className="ac-num-row">
                <View className="ac-num-field">
                  <Text className="ac-form-label">睡眠质量（0–100）</Text>
                  <Input
                    className="ac-num-input"
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
                <View className="ac-num-field">
                  <Text className="ac-form-label">今日步数</Text>
                  <Input
                    className="ac-num-input"
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

              {physioError ? <StateBlock variant="error" compact desc={physioError} /> : null}
              {physioDone && !physioError ? (
                <Text className="ac-success-line">已写入，压力指数会随生理数据更新</Text>
              ) : null}

              <Button
                variant="primary"
                block
                className="ac-submit"
                disabled={savingPhysio}
                ariaLabel="保存今日生理数据"
                onClick={submitPhysio}
              >
                {savingPhysio ? '写入中…' : '保存今日数据'}
              </Button>
            </View>
          </Card>
        )}

        {/* ---------- 研究参与 ---------- */}
        <SectionHeader title="研究参与" />
        <Card flush className="ac-data">
          <View className="ac-data-item ac-data-item-static">
            <View className="ac-menu-icon">
              <Icon name="shield-heart" size={32} color={THEME.primaryDark} />
            </View>
            <View className="ac-menu-main">
              <Text className="ac-menu-label">研究数据使用</Text>
              <Text className="ac-menu-desc">
                {consent?.granted
                  ? `已同意（条款 ${consent.version}）：仅使用去标识后的记录`
                  : '未同意：您的记录不会进入任何研究数据集'}
              </Text>
            </View>
            <Switch
              checked={consent?.granted === true}
              color={THEME.primary}
              disabled={consentSaving}
              ariaLabel="研究数据使用"
              onChange={(e) => void toggleConsent(e.detail.value)}
            />
          </View>
        </Card>

        <Card className="ac-study">
          {!study?.study ? (
            <>
              <Text className="ac-note-line">
                参与研究需要研究码。加入后按协议分组，并完成指定时间点的量表。
              </Text>
              <View className="ac-study-row">
                <Input
                  className="ac-study-input"
                  value={studyCode}
                  placeholder="输入研究码"
                  ariaLabel="研究码"
                  onInput={(e) => setStudyCode(e.detail.value.toUpperCase())}
                />
                <Button
                  className="ac-study-btn"
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
              <Text className="ac-study-title">{study.study.title}</Text>
              <Text className="ac-study-sub">
                研究码 {study.study.code} · 协议 {study.study.protocol_version} · 入组{' '}
                {fmtDateTime(study.enrollment?.assigned_at || '')}
              </Text>
              <View className="ac-study-grid">
                <Stat label="分组" value={study.arm?.code ? study.arm.code : '—'} />
                <Stat label="入组天数" value={study.adherence?.days_since_enroll ?? 0} unit="天" />
                <Stat label="打卡天数" value={study.adherence?.checkin_days ?? 0} unit="天" />
                <Stat label="量表次数" value={study.adherence?.assessments ?? 0} unit="次" />
              </View>
              {study.arm?.label ? <Text className="ac-note-line">{study.arm.label}</Text> : null}
              {nextWindow ? (
                <Text className="ac-study-window">
                  第 {nextWindow.day} 天评估（{nextWindow.scales.map((k) => SCALE_LABEL[k] || k).join(' / ')}）· 截止{' '}
                  {fmtDateTime(nextWindow.due_at)} ·{' '}
                  {nextWindow.open ? '可提交' : nextWindow.late ? '已过期' : '未开放'}
                </Text>
              ) : null}
              {nextWindow && (nextWindow.open || nextWindow.late) ? (
                <Button
                  variant="primary"
                  block
                  onClick={() => void Taro.navigateTo({ url: '/pages/assessment/index' })}
                  ariaLabel={`去做第 ${nextWindow.day} 天评估`}
                >
                  {`去做第 ${nextWindow.day} 天评估`}
                </Button>
              ) : null}
              <View className="ac-study-actions">
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
        <SectionHeader title="我的数据" />
        <Card flush className="ac-data">
          <View
            className="ac-data-item"
            onClick={() => void exportData()}
            ariaRole="button"
            ariaLabel="导出我的数据"
          >
            <View className="ac-menu-icon">
              <Icon name="download" size={32} color={THEME.primaryDark} />
            </View>
            <View className="ac-menu-main">
              <Text className="ac-menu-label">导出我的数据</Text>
              <Text className="ac-menu-desc">
                {exporting ? '正在打包…' : '下载自己的全部记录（JSON）'}
              </Text>
            </View>
            <Icon name="chevron-right" size={28} color={THEME.muted} />
          </View>
          <View
            className="ac-data-item"
            onClick={() => void deleteAccount()}
            ariaRole="button"
            ariaLabel="注销账号"
          >
            <View className="ac-menu-icon ac-menu-icon-danger">
              <Icon name="trash-can" size={32} color={THEME.red} />
            </View>
            <View className="ac-menu-main">
              <Text className="ac-menu-label ac-menu-label-danger">注销账号</Text>
              <Text className="ac-menu-desc">
                {deleting ? '正在注销…' : '删除账号与全部记录，无法恢复'}
              </Text>
            </View>
            <Icon name="chevron-right" size={28} color={THEME.muted} />
          </View>
        </Card>
        {exportError ? <StateBlock variant="error" compact desc={exportError} /> : null}
        {consentError ? <StateBlock variant="error" compact desc={consentError} /> : null}
      </View>
    </View>
  )
}
