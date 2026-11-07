import Taro from '@tarojs/taro'
import { request } from '@/lib/api'

// ---------------------------------------------------------------------------
// 单次订阅提醒（微信一次性订阅消息）
//
// 顺序不能反：必须先 wx.requestSubscribeMessage 拿到授权，再告诉后端「这张票可以用」。
// 后端只有收到 accept 才落库——没授权就落库等于给用户留一条发不出去的提醒。
//
// 仅小程序端可用：H5 没有 requestSubscribeMessage，返回 'unsupported'，
// 页面据此不渲染入口（而不是渲染一个点了没反应的按钮）。
//
// 提示文案由页面统一弹：这里只回结果，避免同一个失败弹两次 toast。
// ---------------------------------------------------------------------------

export type ReminderKind = 'assessment_review' | 'checkin_next_day'

/**
 * accept：用户同意；decline：这次拒绝；ban：勾了「总是保持以上选择」并拒绝；
 * rejected：后端明确拒绝（未绑定微信 / 模板不匹配），原因已在 notice 里；
 * unknown：网络故障；unsupported：非小程序端
 */
export type ReminderResult = 'accept' | 'decline' | 'ban' | 'rejected' | 'unknown' | 'unsupported'

export interface ReminderConfig {
  enabled: boolean
  template_id: string
}

/** subscribeReminder 的完整结果：status 之外带上后端给的拒绝原因 */
export interface ReminderOutcome {
  status: ReminderResult
  notice: string
}

const DISABLED: ReminderConfig = { enabled: false, template_id: '' }

/** 功能开关与模板 ID 都由后端下发：模板写在 app_config，改模板不必发版 */
export async function getReminderConfig(): Promise<ReminderConfig> {
  if (process.env.TARO_ENV !== 'weapp') return DISABLED
  try {
    const cfg = await request<ReminderConfig>('/api/zz/reminders/config')
    return {
      enabled: cfg?.enabled === true,
      template_id: typeof cfg?.template_id === 'string' ? cfg.template_id : '',
    }
  } catch (e) {
    return DISABLED
  }
}

/**
 * 弹订阅授权，并把结果同步给后端。
 * 微信把每个模板的结果放在 res[tmplId] 上，值域 accept / reject / ban / filter。
 * 网络失败返回 'unknown'——此时用户的票已消耗但我们没能登记，需要用户再点一次。
 * 后端明确拒绝（未绑定微信、模板不匹配）返回 'rejected' 并带上原话，页面直接展示。
 */
export async function subscribeReminder(
  kind: ReminderKind,
  templateId: string
): Promise<ReminderOutcome> {
  if (process.env.TARO_ENV !== 'weapp') return { status: 'unsupported', notice: '' }
  if (!templateId) return { status: 'unknown', notice: '' }

  let raw = ''
  try {
    const res = (await Taro.requestSubscribeMessage({
      tmplIds: [templateId],
      // Taro 4.3 的 BaseOption 把支付宝专用 entityIds 误标成必填；weapp 下空数组不参与调用
      entityIds: [],
    })) as unknown as Record<string, unknown>
    raw = String((res || {})[templateId] || '')
  } catch (e) {
    // 用户取消、系统不允许等情况都走这里：不当作错误，只是没订阅上
    return { status: 'decline', notice: '' }
  }

  if (raw === 'ban') {
    await syncOutcome(kind, templateId, 'ban')
    return { status: 'ban', notice: '' }
  }
  // reject 与 filter（模板被后台过滤）都等于没拿到票
  if (raw !== 'accept') {
    await syncOutcome(kind, templateId, 'decline')
    return { status: 'decline', notice: '' }
  }

  return syncOutcome(kind, templateId, 'accept')
}

/** 把授权结果同步给后端：只有 accept 会落库，decline/ban 只是让后端留个回执 */
async function syncOutcome(
  kind: ReminderKind,
  templateId: string,
  action: 'accept' | 'decline' | 'ban'
): Promise<ReminderOutcome> {
  try {
    const result = await request<{ status: string }>('/api/zz/reminders', {
      method: 'POST',
      data: { kind, template_id: templateId, action },
    })
    if (action !== 'accept') return { status: action, notice: '' }
    return result?.status === 'accepted'
      ? { status: 'accept', notice: '' }
      : { status: 'unknown', notice: '' }
  } catch (e) {
    // 拒绝路径不同步成功也无所谓：本来就没票要登记
    if (action !== 'accept') return { status: action, notice: '' }
    // 4xx 是后端有话说（例如「请先在小程序里绑定微信」）；5xx 与网络错误按未知处理
    return { status: 'rejected', notice: e instanceof Error ? e.message : '' }
  }
}


