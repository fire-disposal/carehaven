// 单次订阅提醒：配置读取与模板数据拼装
//
// 为什么单独成文件：hook 处理器在各自的 JSVM 运行时里执行，pb_hooks/remind.pb.js 顶层的
// 常量与函数在处理器内不可见（与 config.pb.js / account.pb.js 的处理方式一致）。
// 因此 kind 元数据、app_config 读取、模板字段拼装都放这里，处理器内 require 后调用。

// kind → 到期天数 + 跳转页 + 默认字段
const KINDS = {
  assessment_review: {
    days: 7,
    page: 'pages/assessment/index',
    label: '量表复测提醒',
  },
  checkin_next_day: {
    days: 1,
    page: 'pages/index/index',
    label: '照护提醒',
  },
}

const FALLBACK_LABEL = '照护提醒'

/** PocketBase 的 date 字段形如 "YYYY-MM-DD HH:mm:ss.sssZ"（UTC） */
function toPbDate(date) {
  return date.toISOString().replace('T', ' ')
}

/** json 字段可能以 UTF-8 字节数组返回，也可能是字符串或对象 */
function configValue(key) {
  let raw
  try {
    const rec = $app.findFirstRecordByFilter('app_config', 'key = {:key}', { key: key })
    raw = rec.get('value')
  } catch (err) {
    return null
  }
  if (raw === null || raw === undefined) return null

  if (Array.isArray(raw)) {
    let text = ''
    for (let i = 0; i < raw.length; i += 1) text += String.fromCharCode(raw[i])
    if (!text) return null
    try {
      return JSON.parse(text)
    } catch (err) {
      return text
    }
  }
  if (typeof raw === 'string') {
    if (!raw.trim()) return null
    try {
      return JSON.parse(raw)
    } catch (err) {
      return raw
    }
  }
  return raw
}

/** 模板 ID 与字段映射；模板 ID 为空视为功能未开通 */
function settings() {
  const template = configValue('wechat_remind_template')
  const mapped = configValue('wechat_remind_data')
  return {
    templateId: typeof template === 'string' ? template.trim() : '',
    data: mapped && typeof mapped === 'object' && !Array.isArray(mapped) ? mapped : null,
  }
}

/** 展示给用户的日期时间（服务器本地时区），替换模板里的 {date} */
function templateDate(dueAt) {
  const parsed = new Date(String(dueAt).replace(' ', 'T'))
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed
  const pad = function (n) {
    return String(n).padStart(2, '0')
  }
  return (
    date.getFullYear() +
    '-' + pad(date.getMonth() + 1) +
    '-' + pad(date.getDate()) +
    ' ' + pad(date.getHours()) +
    ':' + pad(date.getMinutes())
  )
}

/**
 * 模板字段拼装：微信要求每个值都是 { value: string }。
 * mapping 为 null 时用默认 {"thing1": <该 kind 的标签>}。
 */
function templateData(mapping, dueAt, kind) {
  const spec = KINDS[kind]
  const source = mapping || { thing1: spec ? spec.label : FALLBACK_LABEL }
  const stamp = templateDate(dueAt)
  const out = {}
  const keys = Object.keys(source)
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i]
    const raw = source[key]
    const text = String(raw === null || raw === undefined ? '' : raw).replace('{date}', stamp)
    out[key] = { value: text }
  }
  return out
}

module.exports = {
  KINDS: KINDS,
  toPbDate: toPbDate,
  settings: settings,
  templateData: templateData,
}
