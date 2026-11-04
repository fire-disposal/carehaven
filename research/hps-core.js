// HPS 计算内核（纯函数，无 PocketBase 依赖）
//
// 与 pb_hooks/lib/hps.js 的 hps-2 语义保持一致：
//   - 分量未采集为 null，不参与加权；
//   - 生理只取当日记录；
//   - 情境分需要当日打卡；
//   - 缺分量且落在绿区 → unknown。
//
// 这里是「唯一真源」的离线副本：线上 hooks 与科研回放共用同一套公式，
// 改动时必须两边同步，并用 research/test/hps-core.test.mjs 的 golden vectors 兜底。

export const ALGORITHM_VERSION = 'hps-3'

export function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

export function rangeScore(value, lo, hi) {
  if (hi === lo) return 0
  return 100 * clamp01((value - lo) / (hi - lo))
}

const DEFAULT_PARAMS = {
  weights: { w1: 0.4, w2: 0.4, w3: 0.2 },
  thresholds: { t_green: 40, t_red: 70 },
  ranges: { hrv: [20, 60], gsr: [2, 8], sleep_quality: [40, 90] },
}

/**
 * @param {object} input
 * @param {object|null} input.physio  {hrv, gsr, sleep_quality} 或 null
 * @param {Array<{mood:number, anxiety:number, fatigue:number, care_hours:number, sleep_hours:number}>} input.checkins
 * @param {object} params             与快照一致：{weights, thresholds, ranges}
 */
export function computeScore(input, params = DEFAULT_PARAMS) {
  const ranges = params.ranges || DEFAULT_PARAMS.ranges
  const weights = params.weights || DEFAULT_PARAMS.weights
  const thresholds = params.thresholds || DEFAULT_PARAMS.thresholds

  // 生理
  let physio = null
  let physioFields = 0
  if (input.physio) {
    const { hrv, gsr, sleep_quality: sleep } = input.physio
    let sum = 0
    if (Number.isFinite(hrv)) {
      sum += 100 - rangeScore(hrv, ranges.hrv[0], ranges.hrv[1])
      physioFields += 1
    }
    if (Number.isFinite(gsr)) {
      sum += rangeScore(gsr, ranges.gsr[0], ranges.gsr[1])
      physioFields += 1
    }
    if (Number.isFinite(sleep)) {
      sum += 100 - rangeScore(sleep, ranges.sleep_quality[0], ranges.sleep_quality[1])
      physioFields += 1
    }
    physio = physioFields > 0 ? sum / physioFields : null
  }

  // 心理
  const checkins = Array.isArray(input.checkins) ? input.checkins : []
  let psycho = null
  let careHoursTotal = 0
  let sleepHoursTotal = 0
  if (checkins.length > 0) {
    let sum = 0
    for (const c of checkins) {
      const moodScore = ((5 - Number(c.mood)) / 4) * 100
      const anxietyScore = (Number(c.anxiety) / 10) * 100
      const fatigueScore = (Number(c.fatigue) / 10) * 100
      sum += 0.45 * moodScore + 0.35 * anxietyScore + 0.2 * fatigueScore
      careHoursTotal += Number(c.care_hours) || 0
      sleepHoursTotal += Number(c.sleep_hours) || 0
    }
    psycho = sum / checkins.length
  }

  // 负荷：照护时长 + 睡眠缺口（与线上 hps-3 一致）
  let context = null
  if (checkins.length > 0) {
    const avgCareHours = careHoursTotal / checkins.length
    const avgSleepHours = sleepHoursTotal / checkins.length
    context = 0.6 * (clamp01(avgCareHours / 16) * 100) + 0.4 * (clamp01((8 - avgSleepHours) / 5) * 100)
  }

  const missing = []
  if (physio === null) missing.push('physio')
  if (psycho === null) missing.push('psycho')
  if (context === null) missing.push('context')

  const parts = []
  if (physio !== null) parts.push({ w: Number(weights.w1), v: physio })
  if (psycho !== null) parts.push({ w: Number(weights.w2), v: psycho })
  if (context !== null) parts.push({ w: Number(weights.w3), v: context })

  let weightSum = 0
  let weighted = 0
  for (const p of parts) {
    weightSum += p.w
    weighted += p.w * p.v
  }

  if (weightSum <= 0) {
    return {
      algorithm_version: ALGORITHM_VERSION,
      hps: null,
      level: 'unknown',
      components: { physio: null, psycho: null, context: null },
      coverage: { physio: false, psycho: false, context: false, missing, weight_sum: 0 },
    }
  }

  const hps = weighted / weightSum
  let level
  if (hps < Number(thresholds.t_green)) {
    level = missing.length > 0 ? 'unknown' : 'green'
  } else if (hps < Number(thresholds.t_red)) {
    level = 'yellow'
  } else {
    level = 'red'
  }

  return {
    algorithm_version: ALGORITHM_VERSION,
    hps: Math.round(hps * 10) / 10,
    level,
    components: {
      physio: physio === null ? null : Math.round(physio * 10) / 10,
      psycho: psycho === null ? null : Math.round(psycho * 10) / 10,
      context: context === null ? null : Math.round(context * 10) / 10,
    },
    coverage: {
      physio: physio !== null,
      psycho: psycho !== null,
      context: context !== null,
      missing,
      weight_sum: Math.round(weightSum * 1000) / 1000,
    },
  }
}

/** 与线上一致的缺省参数，供快照缺失时回放使用 */
export const DEFAULT = DEFAULT_PARAMS
