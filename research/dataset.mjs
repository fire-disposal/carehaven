#!/usr/bin/env bun
// 数据集构建器：从 PocketBase 的 SQLite 直接产出可引用的研究数据集。
//
// 产出：
//   <out>/csv/*.csv      逐表数据（用户 ID 用 HMAC 去标识）
//   <out>/quality.json   覆盖率 / 依从率 / 排除统计
//   <out>/manifest.json  版本、行数、每文件 sha256、参数指纹
//
// 默认排除：未同意研究者、demo 账号、source=simulated 的生理数据，
//           以及所有自由文本（打卡备注、问答原文、互助句子）。
//
// 用法：
//   RESEARCH_HMAC_SECRET=... bun research/dataset.mjs --db pb_data/data.db --out research/out/run1
//   ... --include-text      # 仅在该批数据已单独取得文本同意时使用
//
// 只读打开数据库。

import { Database } from 'bun:sqlite'
import { createHash, createHmac } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

function parseArgs(argv) {
  const args = { db: 'pb_data/data.db', out: '', includeText: false }
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i]
    if (k === '--db') args.db = argv[++i]
    else if (k === '--out') args.out = argv[++i]
    else if (k === '--include-text') args.includeText = true
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const secret = process.env.RESEARCH_HMAC_SECRET || ''
if (!secret) {
  console.error('[dataset] 缺少 RESEARCH_HMAC_SECRET：去标识需要固定密钥，缺失会产出不可关联的假 ID。')
  process.exit(2)
}
if (!args.out) {
  console.error('[dataset] 需要 --out 指定输出目录')
  process.exit(2)
}

const db = new Database(args.db, { readonly: true })

const tableExists = (name) =>
  Boolean(db.query("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name))

const hmacId = (id) =>
  createHmac('sha256', secret).update(String(id)).digest('hex').slice(0, 16)

const demoLike = new Set(
  db
    .query("SELECT id FROM users WHERE email LIKE '%@zz.local'")
    .all()
    .map((r) => r.id)
)

const consented = new Set(
  tableExists('research_consents')
    ? db
        .query("SELECT user FROM research_consents WHERE withdrawn_at = '' AND granted_at != ''")
        .all()
        .map((r) => r.user)
    : []
)

const included = db
  .query('SELECT id FROM users')
  .all()
  .map((r) => r.id)
  .filter((id) => consented.has(id) && !demoLike.has(id))

const includedSet = new Set(included)
const exclusions = {
  users_total: db.query('SELECT COUNT(*) AS n FROM users').get().n,
  users_without_consent:
    db.query('SELECT COUNT(*) AS n FROM users').get().n - consented.size,
  users_demo: demoLike.size,
  users_included: included.length,
}
if (included.size === 0) {
  console.warn('[dataset] 没有任何已同意研究的用户：会输出空数据集（manifest 仍会生成）。')
}

const outCsv = join(args.out, 'csv')
mkdirSync(outCsv, { recursive: true })

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const s =
    typeof value === 'object' ? JSON.stringify(value) : String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const files = {}

function writeCsv(name, columns, rows) {
  const lines = [columns.join(',')]
  for (const row of rows) {
    lines.push(columns.map((c) => csvEscape(row[c])).join(','))
  }
  const path = join(outCsv, `${name}.csv`)
  const body = lines.join('\n') + '\n'
  writeFileSync(path, body)
  files[`csv/${name}.csv`] = {
    rows: rows.length,
    sha256: createHash('sha256').update(body).digest('hex'),
  }
  console.log(`[dataset] ${name}.csv  ${rows.length} 行`)
}

function byIncluded(rows) {
  return rows.filter((r) => includedSet.has(r.user))
}

// ---------- users ----------
writeCsv(
  'users',
  ['research_id', 'created'],
  included.map((id) => {
    const u = db.query('SELECT id, created FROM users WHERE id = ?').get(id)
    return { research_id: hmacId(u.id), created: u.created }
  })
)

// ---------- checkins ----------
if (tableExists('checkins')) {
  const rows = byIncluded(
    db
      .query(
        `SELECT user, date, period, mood, anxiety, fatigue, sleep_hours, care_hours
         FROM checkins ORDER BY date ASC`
      )
      .all()
  )
  writeCsv(
    'checkins',
    ['research_id', 'date', 'period', 'mood', 'anxiety', 'fatigue', 'sleep_hours', 'care_hours'],
    rows.map((r) => ({ ...r, research_id: hmacId(r.user) }))
  )
}

// ---------- physio（排除 simulated） ----------
if (tableExists('physio_records')) {
  const rows = byIncluded(
    db
      .query(
        `SELECT user, date, hrv, gsr, sleep_quality, steps, source
         FROM physio_records WHERE source != 'simulated' ORDER BY date ASC`
      )
      .all()
  )
  writeCsv(
    'physio_records',
    ['research_id', 'date', 'hrv', 'gsr', 'sleep_quality', 'steps', 'source'],
    rows.map((r) => ({ ...r, research_id: hmacId(r.user) }))
  )
}

// ---------- 评分事件 ----------
if (tableExists('stress_score_events')) {
  const rows = byIncluded(
    db
      .query(
        `SELECT user, date, hps, score_physio, score_psycho, score_context, level,
                algorithm_version, coverage, trigger
         FROM stress_score_events ORDER BY date ASC`
      )
      .all()
  ).map((r) => {
    let coverage = {}
    try {
      coverage = r.coverage ? JSON.parse(r.coverage) : {}
    } catch (err) {
      coverage = {}
    }
    return {
      ...r,
      research_id: hmacId(r.user),
      coverage_missing: (coverage.missing || []).join('|'),
      coverage_weight_sum: coverage.weight_sum ?? '',
    }
  })
  writeCsv(
    'stress_score_events',
    [
      'research_id',
      'date',
      'hps',
      'score_physio',
      'score_psycho',
      'score_context',
      'level',
      'algorithm_version',
      'coverage_missing',
      'coverage_weight_sum',
      'trigger',
    ],
    rows
  )
}

// ---------- 量表 ----------
if (tableExists('assessments')) {
  const rows = byIncluded(
    db
      .query(
        `SELECT user, created, scale, score, level, severity, flag, answers
         FROM assessments ORDER BY created ASC`
      )
      .all()
  )
  writeCsv(
    'assessments',
    ['research_id', 'created', 'scale', 'score', 'level', 'severity', 'flag', 'answers'],
    rows.map((r) => ({ ...r, research_id: hmacId(r.user) }))
  )
}

// ---------- 干预完成 ----------
if (tableExists('intervention_logs')) {
  const rows = byIncluded(
    db
      .query(
        `SELECT user, completed_at, duration_actual, feeling
         FROM intervention_logs ORDER BY completed_at ASC`
      )
      .all()
  )
  writeCsv(
    'intervention_logs',
    ['research_id', 'completed_at', 'duration_actual', 'feeling'],
    rows.map((r) => ({ ...r, research_id: hmacId(r.user) }))
  )
}

// ---------- 问答（默认不含原文） ----------
if (tableExists('qa_sessions')) {
  const rows = byIncluded(
    db
      .query(
        `SELECT user, created, matched_entries, helpful${args.includeText ? ', question, answer' : ''}
         FROM qa_sessions ORDER BY created ASC`
      )
      .all()
  ).map((r) => {
    let matched = 0
    try {
      const parsed = r.matched_entries ? JSON.parse(r.matched_entries) : []
      matched = Array.isArray(parsed) ? parsed.length : 0
    } catch (err) {
      matched = 0
    }
    return { ...r, research_id: hmacId(r.user), matched_count: matched }
  })
  writeCsv(
    'qa_sessions',
    [
      'research_id',
      'created',
      'matched_count',
      'helpful',
      ...(args.includeText ? ['question', 'answer'] : []),
    ],
    rows
  )
}

// ---------- 互助（默认不含句子） ----------
if (tableExists('whispers')) {
  const rows = byIncluded(
    db
      .query(
        `SELECT user, created, kind, anonymous, lexicon_version, reactions_count, report_count, hidden${args.includeText ? ', text, terms' : ''}
         FROM whispers ORDER BY created ASC`
      )
      .all()
  )
  writeCsv(
    'whispers',
    [
      'research_id',
      'created',
      'kind',
      'anonymous',
      'lexicon_version',
      'reactions_count',
      'report_count',
      'hidden',
      ...(args.includeText ? ['text', 'terms'] : []),
    ],
    rows.map((r) => ({ ...r, research_id: hmacId(r.user) }))
  )
}

// ---------- 质量报表 ----------
const quality = { generated_at: new Date().toISOString(), exclusions, users: [] }

if (tableExists('stress_score_events')) {
  const events = byIncluded(
    db.query('SELECT user, date, coverage FROM stress_score_events').all()
  )
  const perUser = new Map()
  const coverageCount = { physio: 0, psycho: 0, context: 0, total: 0 }
  for (const e of events) {
    let cov = {}
    try {
      cov = e.coverage ? JSON.parse(e.coverage) : {}
    } catch (err) {
      cov = {}
    }
    coverageCount.total += 1
    if (cov.physio) coverageCount.physio += 1
    if (cov.psycho) coverageCount.psycho += 1
    if (cov.context) coverageCount.context += 1
    const day = String(e.date).slice(0, 10)
    if (!perUser.has(e.user)) perUser.set(e.user, new Set())
    perUser.get(e.user).add(day)
  }

  const checkinDays = new Map()
  if (tableExists('checkins')) {
    for (const c of byIncluded(db.query('SELECT user, date FROM checkins').all())) {
      const day = String(c.date).slice(0, 10)
      if (!checkinDays.has(c.user)) checkinDays.set(c.user, new Set())
      checkinDays.get(c.user).add(day)
    }
  }

  const days = (date) => {
    const d = new Date(String(date).includes(' ') ? String(date).replace(' ', 'T') : date)
    return Number.isNaN(d.getTime()) ? null : d
  }

  for (const userId of included) {
    const daysWithScore = [...(perUser.get(userId) || [])]
    let spanStart = null
    let spanEnd = null
    const scoredDates = (perUser.get(userId) || new Set())
    for (const d of scoredDates) {
      const parsed = days(d)
      if (!parsed) continue
      if (!spanStart || parsed < spanStart) spanStart = parsed
      if (!spanEnd || parsed > spanEnd) spanEnd = parsed
    }
    const spanDays =
      spanStart && spanEnd ? Math.round((spanEnd - spanStart) / 86400000) + 1 : 0
    quality.users.push({
      research_id: hmacId(userId),
      days_with_score: daysWithScore.length,
      days_with_checkin: (checkinDays.get(userId) || new Set()).size,
      span_days: spanDays,
      ema_compliance: spanDays > 0 ? Number((daysWithScore.length / spanDays).toFixed(3)) : null,
    })
  }

  quality.coverage_rate = {
    physio: coverageCount.total ? Number((coverageCount.physio / coverageCount.total).toFixed(3)) : null,
    psycho: coverageCount.total ? Number((coverageCount.psycho / coverageCount.total).toFixed(3)) : null,
    context: coverageCount.total ? Number((coverageCount.context / coverageCount.total).toFixed(3)) : null,
    events: coverageCount.total,
  }
}

writeFileSync(join(args.out, 'quality.json'), JSON.stringify(quality, null, 2))
files['quality.json'] = {
  sha256: createHash('sha256').update(JSON.stringify(quality)).digest('hex'),
}

// ---------- manifest ----------
const migrations = tableExists('_migrations')
  ? db.query('SELECT file FROM _migrations ORDER BY file ASC').all().map((r) => r.file)
  : []

const algorithms = tableExists('stress_score_events')
  ? [
      ...new Set(
        db
          .query('SELECT DISTINCT algorithm_version FROM stress_score_events')
          .all()
          .map((r) => r.algorithm_version)
          .filter(Boolean)
      ),
    ]
  : []

const paramDigests = tableExists('stress_score_events')
  ? [
      ...new Set(
        db
          .query("SELECT DISTINCT params FROM stress_score_events WHERE params IS NOT NULL AND params != ''")
          .all()
          .map((r) => createHash('sha256').update(String(r.params)).digest('hex').slice(0, 16))
      ),
    ]
  : []

const git = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: import.meta.dir })
const manifest = {
  generated_at: new Date().toISOString(),
  git_commit: git.success ? git.stdout.toString().trim() : null,
  database: args.db,
  include_text: args.includeText,
  deidentification: 'HMAC-SHA256(user id, key=RESEARCH_HMAC_SECRET) → 16 hex chars',
  exclusions: {
    ...exclusions,
    physio_simulated_rows: tableExists('physio_records')
      ? db.query("SELECT COUNT(*) AS n FROM physio_records WHERE source = 'simulated'").get().n
      : 0,
  },
  algorithm_versions: algorithms,
  params_digests: paramDigests,
  migrations,
  files,
}

writeFileSync(join(args.out, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(`[dataset] manifest.json  ${outCsv}`)
console.log(
  `[dataset] 用户 ${included.length} / 已同意 ${consented.size} / 总用户 ${exclusions.users_total}`
)
console.log('[dataset] 引用这批数据时请连同 manifest.json 一起归档。')
