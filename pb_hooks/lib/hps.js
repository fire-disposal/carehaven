// HPS（混合压力指数）计算模块
//
// 设计约束（见 docs/hps-method.md）：
//   1. 分数必须可回放：每次计算都落 append-only 事件，并携带算法版本与参数快照。
//   2. 缺失 ≠ 0：未采集的分量为 null 并计入 coverage，不写 0。
//   3. 数据不足时不给绿色：缺分量且落在绿区时分级为 unknown。
//   4. 生理数据只取当日，不再回退到「最近一条」——跨期数据会污染当天判断。
//
// 注意：本文件由 pb_hooks 通过 require() 加载，不能依赖 hook 文件顶层作用域。

const ALGORITHM_VERSION = 'hps-3'
const copy = require(__hooks + '/lib/copy.js')

function toPbDate(d) {
  return d.toISOString().replace('T', ' ')
}

function dayBounds() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
  const end = new Date(start.getTime() + 86400000)
  return [toPbDate(start), toPbDate(end)]
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
  return x === null || x === undefined ? null : Math.round(x * 10) / 10
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
 * 三个分量：每个要么是 0-100 的数，要么是 null（未采集）。
 * 返回 {physio, psycho, context, coverage}
 */
function components(userId, dayStart, dayEnd, ranges) {
  // 1) 生理：只认当日；多条取最新一条
  const todayPhysio = $app.findRecordsByFilter(
    'physio_records',
    'user = {:user} && date >= {:start} && date < {:end}',
    '-date',
    1,
    0,
    { user: userId, start: dayStart, end: dayEnd }
  )

  let physio = null
  let physioParts = 0
  if (todayPhysio.length > 0) {
    const p = todayPhysio[0]
    const hrv = Number(p.get('hrv'))
    const gsr = Number(p.get('gsr'))
    const sleep = Number(p.get('sleep_quality'))
    let sum = 0
    if (Number.isFinite(hrv)) {
      sum += 100 - rangeScore(hrv, ranges.hrv[0], ranges.hrv[1])
      physioParts += 1
    }
    if (Number.isFinite(gsr)) {
      sum += rangeScore(gsr, ranges.gsr[0], ranges.gsr[1])
      physioParts += 1
    }
    if (Number.isFinite(sleep)) {
      sum += 100 - rangeScore(sleep, ranges.sleep_quality[0], ranges.sleep_quality[1])
      physioParts += 1
    }
    // 三项全空视为未采集，而不是 0 分
    physio = physioParts > 0 ? sum / physioParts : null
  }

  // 2) 心理：当日全部 EMA 打卡的平均
  const checkins = $app.findRecordsByFilter(
    'checkins',
    'user = {:user} && date >= {:start} && date < {:end}',
    '-date',
    50,
    0,
    { user: userId, start: dayStart, end: dayEnd }
  )

  let psycho = null
  let careHoursTotal = 0
  let sleepHoursTotal = 0
  if (checkins.length > 0) {
    let sum = 0
    for (let i = 0; i < checkins.length; i++) {
      const c = checkins[i]
      const moodScore = ((5 - Number(c.get('mood'))) / 4) * 100
      const anxietyScore = (Number(c.get('anxiety')) / 10) * 100
      const fatigueScore = (Number(c.get('fatigue')) / 10) * 100
      sum += 0.45 * moodScore + 0.35 * anxietyScore + 0.2 * fatigueScore
      careHoursTotal += Number(c.get('care_hours')) || 0
      sleepHoursTotal += Number(c.get('sleep_hours')) || 0
    }
    psycho = sum / checkins.length
  }

  // 3) 负荷：照护时长 + 睡眠不足
  //
  // hps-2 曾把「干预次数 / 问答次数」算进情境分，等于"用得越多压力越高"，
  // 与构念纠缠且制造反馈环。hps-3 只保留两个与负荷直接相关、且用户能如实回答的量：
  //   - 平均照护时长（/16 小时封顶）
  //   - 睡眠缺口（8 小时及以上记 0，3 小时及以下记满）
  let context = null
  let avgCareHours = 0
  let avgSleepHours = 0
  if (checkins.length > 0) {
    avgCareHours = careHoursTotal / checkins.length
    avgSleepHours = sleepHoursTotal / checkins.length
    const careLoad = clamp01(avgCareHours / 16)
    const sleepDeficit = clamp01((8 - avgSleepHours) / 5)
    context = 0.6 * careLoad * 100 + 0.4 * sleepDeficit * 100
  }

  const missing = []
  if (physio === null) missing.push('physio')
  if (psycho === null) missing.push('psycho')
  if (context === null) missing.push('context')

  return {
    physio: physio,
    psycho: psycho,
    context: context,
    care_hours_avg: checkins.length > 0 ? careHoursTotal / checkins.length : 0,
    sleep_hours_avg: checkins.length > 0 ? sleepHoursTotal / checkins.length : 0,
    coverage: {
      physio: physio !== null,
      psycho: psycho !== null,
      context: context !== null,
      physio_fields: physioParts,
      missing: missing,
      checkins: checkins.length,
    },
  }
}

function adviceOf(level) {
  return copy.LEVEL_ADVICE[level] || copy.LEVEL_ADVICE.unknown
}

/**
 * 重算某用户当日压力得分。
 * 结果 upsert 进 stress_scores（当日展示用），同时 append 一条 stress_score_events（研究/回放用）。
 * 返回写入的快照字段；数据完全不足时返回 null 且不写库。
 */
function recomputeScore(userId, trigger) {
  if (!userId) return null

  const weights = config('hps_weights', { w1: 0.4, w2: 0.4, w3: 0.2 })
  const thresholds = config('level_thresholds', { t_green: 40, t_red: 70 })
  const ranges = config('physio_normal_range', {
    hrv: [20, 60],
    gsr: [2, 8],
    sleep_quality: [40, 90],
  })

  const bounds = dayBounds()
  const parts = components(userId, bounds[0], bounds[1], ranges)

  const weighted = []
  if (parts.physio !== null) weighted.push({ w: Number(weights.w1), v: parts.physio })
  if (parts.psycho !== null) weighted.push({ w: Number(weights.w2), v: parts.psycho })
  if (parts.context !== null) weighted.push({ w: Number(weights.w3), v: parts.context })

  let weightSum = 0
  let sum = 0
  for (let i = 0; i < weighted.length; i++) {
    weightSum += weighted[i].w
    sum += weighted[i].w * weighted[i].v
  }

  const coverage = {
    physio: parts.coverage.physio,
    psycho: parts.coverage.psycho,
    context: parts.coverage.context,
    physio_fields: parts.coverage.physio_fields,
    missing: parts.coverage.missing,
    checkins: parts.coverage.checkins,
    care_hours_avg: Math.round(parts.care_hours_avg * 10) / 10,
    sleep_hours_avg: Math.round(parts.sleep_hours_avg * 10) / 10,
    weight_sum: Math.round(weightSum * 1000) / 1000,
  }

  if (weightSum <= 0) {
    // 完全没有任何分量：不写分数，避免造出一个「绿色的空值」
    $app.logger().info('HPS 数据不足，跳过写入', 'user', userId, 'missing', coverage.missing.join(','))
    return null
  }

  const hps = sum / weightSum
  let level
  if (hps < Number(thresholds.t_green)) {
    level = coverage.missing.length > 0 ? 'unknown' : 'green'
  } else if (hps < Number(thresholds.t_red)) {
    level = 'yellow'
  } else {
    level = 'red'
  }

  const params = {
    weights: { w1: Number(weights.w1), w2: Number(weights.w2), w3: Number(weights.w3) },
    thresholds: { t_green: Number(thresholds.t_green), t_red: Number(thresholds.t_red) },
    ranges: ranges,
  }
  const computedAt = new Date().toISOString().replace('T', ' ')
  // 分量列是 number（PocketBase 里为 NOT NULL），缺失一律写 0；
  // 「是否真的采集到」由 coverage 承担，读数据的人必须同时看 coverage。
  const fields = {
    hps: round1(hps),
    score_physio: parts.physio === null ? 0 : round1(parts.physio),
    score_psycho: parts.psycho === null ? 0 : round1(parts.psycho),
    score_context: parts.context === null ? 0 : round1(parts.context),
    level: level,
    advice: adviceOf(level),
    algorithm_version: ALGORITHM_VERSION,
    params: params,
    coverage: coverage,
    computed_at: computedAt,
  }

  // 展示用：当日唯一一行
  const existing = $app.findRecordsByFilter(
    'stress_scores',
    'user = {:user} && date >= {:start} && date < {:end}',
    '-date',
    1,
    0,
    { user: userId, start: bounds[0], end: bounds[1] }
  )

  const record =
    existing.length > 0 ? existing[0] : new Record($app.findCollectionByNameOrId('stress_scores'))
  if (existing.length === 0) {
    record.set('user', userId)
    // 按「日」落库：date 取当日零点，配合 (user, date) 唯一索引，一天一行
    record.set('date', bounds[0])
  }
  record.set('hps', fields.hps)
  record.set('score_physio', fields.score_physio)
  record.set('score_psycho', fields.score_psycho)
  record.set('score_context', fields.score_context)
  record.set('level', fields.level)
  record.set('advice', fields.advice)
  record.set('algorithm_version', fields.algorithm_version)
  record.set('params', fields.params)
  record.set('coverage', fields.coverage)
  record.set('computed_at', fields.computed_at)
  $app.save(record)

  // 研究用：append-only，永不覆盖
  const event = new Record($app.findCollectionByNameOrId('stress_score_events'))
  event.set('user', userId)
  event.set('date', bounds[0])
  event.set('hps', fields.hps)
  event.set('score_physio', fields.score_physio)
  event.set('score_psycho', fields.score_psycho)
  event.set('score_context', fields.score_context)
  event.set('level', fields.level)
  event.set('algorithm_version', fields.algorithm_version)
  event.set('params', fields.params)
  event.set('coverage', fields.coverage)
  event.set('trigger', String(trigger || 'manual'))
  event.set('computed_at', fields.computed_at)
  $app.save(event)

  return fields
}

/** 钩子里调用：任何异常都不应让用户的写入失败，只记录日志 */
function safeRecompute(userId, trigger) {
  try {
    return recomputeScore(userId, trigger)
  } catch (err) {
    $app.logger().error('HPS 重算失败', 'user', userId, 'error', String(err))
    return null
  }
}

function userIdOf(record) {
  if (!record) return ''
  const value = record.get('user')
  return value === null || value === undefined ? '' : String(value)
}

module.exports = {
  ALGORITHM_VERSION: ALGORITHM_VERSION,
  recomputeScore: recomputeScore,
  safeRecompute: safeRecompute,
  userIdOf: userIdOf,
}
