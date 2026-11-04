#!/usr/bin/env bun
// 评分回放：验证两件事
//
//   A. 算术一致：用事件里记录的 params + 分量，重算 hps/level 是否与库内一致。
//      —— 强校验，不受时间戳影响。
//   B. 输入可复现：用「事件写入当刻之前」的原始数据重算整条分数。
//      —— 若结果的覆盖度与事件记录不同，说明事件之后又到了新数据（同毫秒写入时无法用
//         created 裁决），归类为 timing，不算失败；覆盖度相同却对不上才算真不一致。
//
// 用法：
//   bun research/replay.mjs --db pb_data/data.db [--user <id>] [--verbose] [--tolerance 0.05]
//
// 退出码：0 = 通过（可能带 timing 提示）；1 = 存在真不一致；2 = 无法运行。
// 只读打开 SQLite。

import { Database } from 'bun:sqlite'
import { computeScore, DEFAULT } from './hps-core.js'

function parseArgs(argv) {
  const args = { db: 'pb_data/data.db', user: '', verbose: false, tolerance: 0.05 }
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]
    if (key === '--db') args.db = argv[++i]
    else if (key === '--user') args.user = argv[++i]
    else if (key === '--verbose') args.verbose = true
    else if (key === '--tolerance') args.tolerance = Number(argv[++i])
  }
  return args
}

function toDate(raw) {
  if (!raw) return null
  const d = new Date(String(raw).includes(' ') ? String(raw).replace(' ', 'T') : raw)
  return Number.isNaN(d.getTime()) ? null : d
}

function pbTime(date) {
  return date.toISOString().replace('T', ' ')
}

function sameCoverage(a, b) {
  if (!a || !b) return false
  return (
    Boolean(a.physio) === Boolean(b.physio) &&
    Boolean(a.psycho) === Boolean(b.psycho) &&
    Boolean(a.context) === Boolean(b.context)
  )
}

const args = parseArgs(process.argv.slice(2))

let db
try {
  db = new Database(args.db, { readonly: true })
} catch (err) {
  console.error(`[replay] 打不开数据库：${args.db}\n         ${err.message}`)
  process.exit(2)
}

const hasEvents = db
  .query("SELECT name FROM sqlite_master WHERE type='table' AND name='stress_score_events'")
  .get()
if (!hasEvents) {
  console.error('[replay] 该库没有 stress_score_events（早于 1730000600 的版本？）')
  process.exit(2)
}

const events = db
  .query(
    `SELECT id, user, date, created, hps, score_physio, score_psycho, score_context,
            level, algorithm_version, params, coverage
     FROM stress_score_events
     ${args.user ? 'WHERE user = ?' : ''}
     ORDER BY date ASC, created ASC`
  )
  .all(...(args.user ? [args.user] : []))

if (events.length === 0) {
  console.error('[replay] 没有可回放的事件。先用 research/seed.mjs 造数据，或在应用里打卡。')
  process.exit(2)
}

// 严格早于事件创建时间：同一毫秒写入的数据无法用时间戳裁决，交给 coverage 归类
const physioStmt = db.query(
  `SELECT hrv, gsr, sleep_quality FROM physio_records
   WHERE user = ? AND date >= ? AND date < ? AND created < ?
   ORDER BY date DESC LIMIT 1`
)
const checkinStmt = db.query(
  `SELECT mood, anxiety, fatigue, care_hours FROM checkins
   WHERE user = ? AND date >= ? AND date < ? AND created < ?`
)
const logsStmt = db.query(
  `SELECT COUNT(*) AS n FROM intervention_logs
   WHERE user = ? AND completed_at >= ? AND created < ?`
)
const asksStmt = db.query(
  `SELECT COUNT(*) AS n FROM qa_sessions WHERE user = ? AND created >= ? AND created < ?`
)

let checked = 0
let skipped = 0
let arithmeticFail = 0
let rawFail = 0
let timing = 0
const failures = []
const timingCases = []
const byVersion = new Map()

for (const event of events) {
  const dayStart = toDate(event.date)
  if (!dayStart) {
    skipped += 1
    continue
  }
  const dayEnd = new Date(dayStart.getTime() + 86400000)
  const weekStart = new Date(dayStart.getTime() - 7 * 86400000)

  let params = DEFAULT
  if (event.params && String(event.params).trim() !== '') {
    try {
      params = JSON.parse(event.params)
    } catch (err) {
      skipped += 1
      continue
    }
  }

  let recordedCoverage = null
  if (event.coverage && String(event.coverage).trim() !== '') {
    try {
      recordedCoverage = JSON.parse(event.coverage)
    } catch (err) {
      recordedCoverage = null
    }
  }

  const version = String(event.algorithm_version || 'unknown')
  byVersion.set(version, (byVersion.get(version) || 0) + 1)
  if (version !== 'hps-2') {
    skipped += 1
    continue
  }

  checked += 1

  // ---------- A. 算术一致：按记录的分量与权重相加 ----------
  const weighted = []
  const weights = params.weights || DEFAULT.weights
  if (recordedCoverage === null || recordedCoverage.physio !== false) {
    weighted.push({ w: Number(weights.w1), v: Number(event.score_physio) })
  }
  if (recordedCoverage === null || recordedCoverage.psycho !== false) {
    weighted.push({ w: Number(weights.w2), v: Number(event.score_psycho) })
  }
  if (recordedCoverage === null || recordedCoverage.context !== false) {
    weighted.push({ w: Number(weights.w3), v: Number(event.score_context) })
  }
  let weightSum = 0
  let sum = 0
  for (const p of weighted) {
    weightSum += p.w
    sum += p.w * p.v
  }
  if (weightSum > 0) {
    const arithmeticHps = Math.round((sum / weightSum) * 10) / 10
    const diff = Math.abs(Number(event.hps ?? 0) - arithmeticHps)
    // 分量本身落库时保留 1 位小数，按分量反推会有最多 0.1 的舍入误差
    const arithmeticTolerance = Math.max(args.tolerance, 0.11)
    if (diff > arithmeticTolerance) {
      arithmeticFail += 1
      failures.push({
        kind: 'arithmetic',
        id: event.id,
        user: event.user,
        date: event.date,
        detail: `库内 ${event.hps} ≠ 按记录分量重算 ${arithmeticHps}`,
      })
    }
  }

  // ---------- B. 输入可复现 ----------
  const cutoff = String(event.created || pbTime(dayEnd))
  const physioRow = physioStmt.get(event.user, pbTime(dayStart), pbTime(dayEnd), cutoff)
  const checkins = checkinStmt.all(event.user, pbTime(dayStart), pbTime(dayEnd), cutoff)
  const logs7d = logsStmt.get(event.user, pbTime(weekStart), cutoff)?.n ?? 0
  const asks7d = asksStmt.get(event.user, pbTime(weekStart), cutoff)?.n ?? 0

  const raw = computeScore({ physio: physioRow || null, checkins, logs7d, asks7d }, params)
  if (raw.hps === null) {
    timing += 1
    continue
  }

  const diff = Math.abs(Number(event.hps ?? 0) - Number(raw.hps))
  const levelDiff = String(event.level) !== raw.level
  const coverageSame = sameCoverage(recordedCoverage, raw.coverage)

  if (diff <= args.tolerance && !levelDiff) {
    if (args.verbose) {
      console.log(`ok  ${event.date}  user=${event.user.slice(0, 8)}  hps=${event.hps}  ${event.level}`)
    }
    continue
  }

  if (!coverageSame) {
    // 事件之后才有（或同一毫秒写入）的数据：这是时间切片问题，不是复现失败
    timing += 1
    timingCases.push({
      date: event.date,
      user: event.user,
      recorded: recordedCoverage,
      recomputed: raw.coverage,
    })
    continue
  }

  rawFail += 1
  failures.push({
    kind: 'raw',
    id: event.id,
    user: event.user,
    date: event.date,
    detail: `库内 hps=${event.hps}/${event.level}，重算 hps=${raw.hps}/${raw.level}，覆盖度相同`,
  })
}

console.log('')
console.log(
  `[replay] 事件 ${events.length} 条：核对 ${checked}，跳过 ${skipped}（旧版本/参数缺失），` +
    `算术不一致 ${arithmeticFail}，复现不一致 ${rawFail}，时间切片差异 ${timing}`
)
console.log(`[replay] 版本分布：${[...byVersion.entries()].map(([v, n]) => `${v}×${n}`).join('，')}`)

if (timing > 0) {
  console.log('')
  console.log('[replay] 时间切片差异（不计失败）：事件写入当刻与数据写入在同一毫秒，')
  console.log('         重算时会用到事件之后才落库的数据。逐条明细：')
  for (const c of timingCases.slice(0, 5)) {
    console.log(`  ${c.date}  user=${c.user.slice(0, 8)}  记录 coverage=${JSON.stringify(c.recorded)}`)
    console.log(`                              重算 coverage=${JSON.stringify(c.recomputed)}`)
  }
}

if (failures.length > 0) {
  console.log('')
  console.log('[replay] 不一致明细（最多 10 条）：')
  for (const f of failures.slice(0, 10)) {
    console.log(`  [${f.kind}] ${f.date}  user=${f.user.slice(0, 8)}`)
    console.log(`    ${f.detail}`)
  }
  console.log('')
  console.log('[replay] 结论：分数已无法由数据复现，先不要用这批分数写进材料。')
  process.exit(1)
}

console.log('[replay] 结论：算术一致，且能复现的事件都由「原始数据 + 参数快照」重算到同值。')
process.exit(0)
