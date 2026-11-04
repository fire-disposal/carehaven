// 用户级日配额：问答与 TTS
//
// 目的：成本可控 + 滥用可止损。计数落在 usage_counters（user, date, kind 唯一），
// 上限来自 app_config 的 daily_quota，缺省 { ask: 60, tts: 20 }。
//
// hook 处理器在独立运行时执行，因此本文件只导出函数，由处理器 require 后调用。

const DEFAULT_LIMITS = { ask: 60, tts: 20 }

function decodeJsonBytes(bytes) {
  let out = ''
  let i = 0
  while (i < bytes.length) {
    const b = bytes[i]
    if (b < 0x80) {
      out += String.fromCharCode(b)
      i += 1
    } else if (b >= 0xc0 && b < 0xe0) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f))
      i += 2
    } else if (b >= 0xe0 && b < 0xf0) {
      out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f))
      i += 3
    } else {
      out += '\uFFFD'
      i += 4
    }
  }
  return out
}

function readLimits() {
  try {
    const rec = $app.findFirstRecordByFilter('app_config', 'key = {:key}', { key: 'daily_quota' })
    const raw = rec.get('value')
    let value = raw
    if (Array.isArray(raw)) value = JSON.parse(decodeJsonBytes(raw))
    else if (typeof raw === 'string') value = JSON.parse(raw)
    if (value && typeof value === 'object') {
      return {
        ask: Number.isFinite(Number(value.ask)) ? Number(value.ask) : DEFAULT_LIMITS.ask,
        tts: Number.isFinite(Number(value.tts)) ? Number(value.tts) : DEFAULT_LIMITS.tts,
      }
    }
  } catch (err) {
    // 配置缺失/损坏都退回默认值，不能因为限流把功能打挂
  }
  return DEFAULT_LIMITS
}

function dayStart() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
  return start.toISOString().replace('T', ' ')
}

/**
 * 记一次用量。
 * 返回 { allowed, used, limit }；allowed=false 时调用方应返回 429。
 */
function consume(userId, kind) {
  const limits = readLimits()
  const limit = kind === 'tts' ? limits.tts : limits.ask
  const start = dayStart()

  let counter = null
  try {
    const found = $app.findRecordsByFilter(
      'usage_counters',
      'user = {:user} && date >= {:start} && kind = {:kind}',
      '',
      1,
      0,
      { user: userId, start: start, kind: kind }
    )
    counter = found.length > 0 ? found[0] : null
  } catch (err) {
    counter = null
  }

  if (!counter) {
    counter = new Record($app.findCollectionByNameOrId('usage_counters'))
    counter.set('user', userId)
    counter.set('date', start)
    counter.set('kind', kind)
    counter.set('count', 0)
  }

  const used = Number(counter.get('count')) || 0
  if (used >= limit) {
    return { allowed: false, used: used, limit: limit }
  }

  counter.set('count', used + 1)
  $app.save(counter)
  return { allowed: true, used: used + 1, limit: limit }
}

function messageFor(kind, limit) {
  if (kind === 'tts') {
    return '今天的朗读次数已用完（每日 ' + limit + ' 次），明天会自动恢复'
  }
  return '今天的提问次数已用完（每日 ' + limit + ' 次），明天会自动恢复'
}

module.exports = { consume: consume, messageFor: messageFor, readLimits: readLimits }
