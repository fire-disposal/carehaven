// HPS（混合压力指数）计算模块
// 注意：本文件由 pb_hooks 通过 require() 加载，不能依赖 hook 文件顶层作用域。

function toPbDate(d) {
  return d.toISOString().replace('T', ' ')
}

function dayBounds() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
  const end = new Date(start.getTime() + 86400000)
  return [toPbDate(start), toPbDate(end)]
}

function daysAgo(days) {
  return toPbDate(new Date(Date.now() - days * 86400000))
}

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

/** 指标 → 0-100：达到 hi 记 100，低于 lo 记 0 */
function rangeScore(value, lo, hi) {
  if (hi === lo) return 0
  return 100 * clamp01((value - lo) / (hi - lo))
}

function round1(x) {
  return Math.round(x * 10) / 10
}

/** JSON 字段在 JSVM 中以 UTF-8 字节数组返回，需先解码再解析 */
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
      // 四字节序列（表情等）在配置项中不会出现，按替换字符处理
      out += '\uFFFD'
      i += 4
    }
  }
  return out
}

function config(key, fallback) {
  try {
    const rec = $app.findFirstRecordByFilter('app_config', 'key = {:key}', { key: key })
    let value = rec.get('value')
    if (value === null || value === undefined) return fallback

    let text = null
    if (Array.isArray(value)) {
      text = decodeJsonBytes(value)
    } else if (typeof value === 'string') {
      text = value
    }

    if (text !== null) {
      try {
        value = JSON.parse(text)
      } catch (parseErr) {
        $app.logger().warn('配置不是合法 JSON，使用默认值', 'key', key)
        return fallback
      }
    }
    return value
  } catch (err) {
    $app.logger().warn('读取配置失败，使用默认值', 'key', key, 'error', String(err))
    return fallback
  }
}

/**
 * 重算某用户当日压力得分（缺失分量按剩余权重归一化，避免把「未采集」当成「低压力」）。
 * 结果 upsert 进 stress_scores，同一用户同一天只有一行。
 */
function recomputeScore(userId) {
  if (!userId) return

  const weights = config('hps_weights', { w1: 0.4, w2: 0.4, w3: 0.2 })
  const thresholds = config('level_thresholds', { t_green: 40, t_red: 70 })
  const ranges = config('physio_normal_range', {
    hrv: [20, 60],
    gsr: [2, 8],
    sleep_quality: [40, 90],
  })

  const bounds = dayBounds()
  const dayStart = bounds[0]
  const dayEnd = bounds[1]

  // 1) 生理得分：优先今日记录，缺失回退到最近一条
  const todayPhysio = $app.findRecordsByFilter(
    'physio_records',
    'user = {:user} && date >= {:start} && date < {:end}',
    '-date',
    1,
    0,
    { user: userId, start: dayStart, end: dayEnd }
  )
  const physioList =
    todayPhysio.length > 0
      ? todayPhysio
      : $app.findRecordsByFilter('physio_records', 'user = {:user}', '-date', 1, 0, { user: userId })

  let physioScore = null
  if (physioList.length > 0) {
    const p = physioList[0]
    const hrvScore = 100 - rangeScore(Number(p.get('hrv')), ranges.hrv[0], ranges.hrv[1])
    const gsrScore = rangeScore(Number(p.get('gsr')), ranges.gsr[0], ranges.gsr[1])
    const sleepScore =
      100 - rangeScore(Number(p.get('sleep_quality')), ranges.sleep_quality[0], ranges.sleep_quality[1])
    physioScore = (hrvScore + gsrScore + sleepScore) / 3
  }

  // 2) 心理得分：当日全部 EMA 打卡的平均
  const checkins = $app.findRecordsByFilter(
    'checkins',
    'user = {:user} && date >= {:start} && date < {:end}',
    '-date',
    50,
    0,
    { user: userId, start: dayStart, end: dayEnd }
  )

  let psychoScore = null
  let careHoursTotal = 0
  if (checkins.length > 0) {
    let sum = 0
    for (let i = 0; i < checkins.length; i++) {
      const c = checkins[i]
      const moodScore = ((5 - Number(c.get('mood'))) / 4) * 100
      const anxietyScore = (Number(c.get('anxiety')) / 10) * 100
      const fatigueScore = (Number(c.get('fatigue')) / 10) * 100
      sum += 0.45 * moodScore + 0.35 * anxietyScore + 0.2 * fatigueScore
      careHoursTotal += Number(c.get('care_hours')) || 0
    }
    psychoScore = sum / checkins.length
  }

  // 3) 情境得分：照护时长 60% + 近 7 天干预次数 25% + 近 7 天求助次数 15%
  const avgCareHours = checkins.length > 0 ? careHoursTotal / checkins.length : 0
  const weekStart = daysAgo(7)
  const logs = $app.findRecordsByFilter('intervention_logs', 'user = {:user} && completed_at >= {:start}', '', 100, 0, {
    user: userId,
    start: weekStart,
  })
  const asks = $app.findRecordsByFilter('qa_sessions', 'user = {:user} && created >= {:start}', '', 100, 0, {
    user: userId,
    start: weekStart,
  })
  const contextScore =
    0.6 * (clamp01(avgCareHours / 16) * 100) +
    0.25 * (clamp01(logs.length / 5) * 100) +
    0.15 * (clamp01(asks.length / 5) * 100)

  // 4) 加权求和
  const parts = []
  if (physioScore !== null) parts.push({ w: Number(weights.w1), v: physioScore })
  if (psychoScore !== null) parts.push({ w: Number(weights.w2), v: psychoScore })
  parts.push({ w: Number(weights.w3), v: contextScore })

  let weightSum = 0
  let weighted = 0
  for (let i = 0; i < parts.length; i++) {
    weightSum += parts[i].w
    weighted += parts[i].w * parts[i].v
  }
  const hps = weightSum > 0 ? weighted / weightSum : 0

  const level = hps < Number(thresholds.t_green) ? 'green' : hps < Number(thresholds.t_red) ? 'yellow' : 'red'
  const advice =
    level === 'green'
      ? '压力处于安全区间，保持规律作息与日常放松练习即可。'
      : level === 'yellow'
        ? '压力已进入预警区间，建议今天完成一次呼吸放松或冥想练习，并留意睡眠。'
        : '压力水平显著超标，建议立即进行一次紧急放松，并考虑向家人或专业人员寻求支持。'

  // 5) upsert 当日得分
  const existing = $app.findRecordsByFilter(
    'stress_scores',
    'user = {:user} && date >= {:start} && date < {:end}',
    '-date',
    1,
    0,
    { user: userId, start: dayStart, end: dayEnd }
  )

  const record =
    existing.length > 0 ? existing[0] : new Record($app.findCollectionByNameOrId('stress_scores'))
  if (existing.length === 0) {
    record.set('user', userId)
    record.set('date', toPbDate(new Date()))
  }
  record.set('hps', round1(hps))
  record.set('score_physio', physioScore === null ? 0 : round1(physioScore))
  record.set('score_psycho', psychoScore === null ? 0 : round1(psychoScore))
  record.set('score_context', round1(contextScore))
  record.set('level', level)
  record.set('advice', advice)
  $app.save(record)
}

/** 钩子里调用：任何异常都不应让用户的写入失败，只记录日志 */
function safeRecompute(userId) {
  try {
    recomputeScore(userId)
  } catch (err) {
    $app.logger().error('HPS 重算失败', 'user', userId, 'error', String(err))
  }
}

function userIdOf(record) {
  if (!record) return ''
  const value = record.get('user')
  return value === null || value === undefined ? '' : String(value)
}

module.exports = {
  recomputeScore: recomputeScore,
  safeRecompute: safeRecompute,
  userIdOf: userIdOf,
}
