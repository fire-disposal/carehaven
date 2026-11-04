// 助手原型：DeepSeek 适配、只读工具、配额与计费
//
// 设计约束（见 docs/ai-agent.md）：
//   - 模型不碰数据库：工具在服务端执行，user 由调用方注入；
//   - 工具返回白名单字段，自由文本（备注/问答原文）不出库；
//   - 每用户每日有请求数、token、费用三重上限；另设全局 token 上限；
//   - 无密钥 / 超限 / 上游失败时返回可识别的错误，客户端回退检索问答。

const PROMPT_VERSION = 'agent-1'
const DEFAULT_LIMITS = {
  enabled: true,
  requests_per_day: 20,
  tokens_per_day: 60000,
  budget_yuan_per_day: 1.0,
  global_tokens_per_day: 400000,
}
const DEFAULT_PRICING = { input_per_million: 2, output_per_million: 8 }

const TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'get_today_status',
      description: '读取本人今天的压力指数、分级、数据完整度与打卡次数',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_recent_checkins',
      description: '读取本人最近若干天的打卡（心情、焦虑、疲惫、睡眠、照护时长），不含备注',
      parameters: {
        type: 'object',
        properties: { days: { type: 'integer', minimum: 1, maximum: 30 } },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_recent_assessments',
      description: '读取本人最近的量表结果（量表、分数、分级、是否需关注），不含原始答案',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'integer', minimum: 1, maximum: 10 } },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_trend',
      description: '读取本人近 7 或 30 天的压力趋势摘要（天数、均值、峰值、三色分布）',
      parameters: {
        type: 'object',
        properties: { days: { type: 'integer', enum: [7, 30] } },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_kb',
      description: '在照护知识库里检索条目，返回标题、分类与正文片段',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' }, top: { type: 'integer', minimum: 1, maximum: 5 } },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
]

const SYSTEM_PROMPT =
  '你是失智症家庭照护者的助手，只处理照护与自我照护相关的问题。' +
  '涉及用户自己的数据时，必须先调用工具，不得凭空给出数字；工具报错就说明读不到。' +
  '引用知识库时点明条目名称。不做诊断、不给药物剂量、不替代医生。' +
  '回答用简体中文，控制在 180 字以内，先给结论再给一到两条可执行建议。' +
  '如果用户表达自伤或危机，立即给出求助路径，不要继续分析数据。'

function decodeBytes(bytes) {
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

function config(key, fallback) {
  try {
    const rec = $app.findFirstRecordByFilter('app_config', 'key = {:key}', { key: key })
    const raw = rec.get('value')
    let value = raw
    if (Array.isArray(raw)) value = JSON.parse(decodeBytes(raw))
    else if (typeof raw === 'string') value = JSON.parse(raw)
    if (value && typeof value === 'object') {
      const merged = {}
      const baseKeys = Object.keys(fallback || {})
      for (let i = 0; i < baseKeys.length; i += 1) merged[baseKeys[i]] = fallback[baseKeys[i]]
      const keys = Object.keys(value)
      for (let i = 0; i < keys.length; i += 1) merged[keys[i]] = value[keys[i]]
      return merged
    }
  } catch (err) {
    // 缺失或损坏时退回默认值
  }
  return fallback
}

function limits() {
  return config('agent_limits', DEFAULT_LIMITS)
}

function pricing() {
  return config('agent_pricing', DEFAULT_PRICING)
}

function dayStart() {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
    .toISOString()
    .replace('T', ' ')
}

function isEnabled() {
  return Boolean($os.getenv('DEEPSEEK_API_KEY')) && limits().enabled === true
}

function usageToday(userId) {
  const start = dayStart()
  const out = { requests: 0, tokens: 0, cost: 0 }
  try {
    const filter = userId
      ? 'source = "agent" && created >= {:start} && user = {:user}'
      : 'source = "agent" && created >= {:start}'
    const params = userId ? { start: start, user: userId } : { start: start }
    const rows = $app.findRecordsByFilter('qa_sessions', filter, '', 500, 0, params)
    for (let i = 0; i < rows.length; i += 1) {
      out.requests += 1
      out.tokens += (Number(rows[i].get('tokens_in')) || 0) + (Number(rows[i].get('tokens_out')) || 0)
      out.cost += Number(rows[i].get('cost_yuan')) || 0
    }
  } catch (err) {
    // 读取失败按 0 计
  }
  out.cost = Math.round(out.cost * 10000) / 10000
  return out
}

/** 配额检查：请求数、单用户 token、单用户费用、全局 token */
function checkQuota(userId) {
  const cfg = limits()
  const mine = usageToday(userId)
  const all = usageToday('')
  if (mine.requests >= Number(cfg.requests_per_day)) {
    return { ok: false, reason: 'daily_requests', mine: mine, limits: cfg }
  }
  if (mine.tokens >= Number(cfg.tokens_per_day)) {
    return { ok: false, reason: 'daily_tokens', mine: mine, limits: cfg }
  }
  if (mine.cost >= Number(cfg.budget_yuan_per_day)) {
    return { ok: false, reason: 'daily_budget', mine: mine, limits: cfg }
  }
  if (all.tokens >= Number(cfg.global_tokens_per_day)) {
    return { ok: false, reason: 'global_tokens', mine: mine, limits: cfg }
  }
  return { ok: true, mine: mine, limits: cfg }
}

// ---------------- 工具实现（本人数据、白名单字段） ----------------

function todayStatus(userId) {
  const start = dayStart()
  let score = null
  try {
    const rows = $app.findRecordsByFilter(
      'stress_scores',
      'user = {:user} && date >= {:start}',
      '-date',
      1,
      0,
      { user: userId, start: start }
    )
    if (rows.length > 0) {
      const row = rows[0]
      score = {
        hps: Number(row.get('hps')) || 0,
        level: String(row.get('level') || 'unknown'),
        coverage: row.get('coverage') || null,
      }
    }
  } catch (err) {
    score = null
  }
  let checkins = 0
  try {
    checkins = $app.findRecordsByFilter(
      'checkins',
      'user = {:user} && created >= {:start}',
      '',
      50,
      0,
      { user: userId, start: start }
    ).length
  } catch (err) {
    checkins = 0
  }
  return { score: score, checkins_today: checkins }
}

function recentCheckins(userId, days) {
  const span = Math.min(30, Math.max(1, Number(days) || 7))
  const since = new Date(Date.now() - span * 86400000).toISOString().replace('T', ' ')
  const rows = $app.findRecordsByFilter(
    'checkins',
    'user = {:user} && created >= {:start}',
    '-created',
    60,
    0,
    { user: userId, start: since }
  )
  const items = []
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]
    items.push({
      date: String(row.get('created')).slice(0, 10),
      mood: Number(row.get('mood')),
      anxiety: Number(row.get('anxiety')),
      fatigue: Number(row.get('fatigue')),
      sleep_hours: Number(row.get('sleep_hours')),
      care_hours: Number(row.get('care_hours')),
    })
  }
  return { days: span, count: items.length, items: items }
}

function recentAssessments(userId, limit) {
  const top = Math.min(10, Math.max(1, Number(limit) || 3))
  const rows = $app.findRecordsByFilter('assessments', 'user = {:user}', '-created', top, 0, {
    user: userId,
  })
  const items = []
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]
    items.push({
      scale: String(row.get('scale')),
      date: String(row.get('created')).slice(0, 10),
      score: Number(row.get('score')),
      level: String(row.get('level')),
      flag: row.get('flag') === true,
    })
  }
  return { count: items.length, items: items }
}

function trend(userId, days) {
  const span = Number(days) === 30 ? 30 : 7
  const since = new Date(Date.now() - span * 86400000).toISOString().replace('T', ' ')
  const rows = $app.findRecordsByFilter(
    'stress_scores',
    'user = {:user} && date >= {:start}',
    'date',
    60,
    0,
    { user: userId, start: since }
  )
  let sum = 0
  let n = 0
  let peak = null
  const levels = { green: 0, yellow: 0, red: 0, unknown: 0 }
  for (let i = 0; i < rows.length; i += 1) {
    const hps = Number(rows[i].get('hps'))
    if (Number.isFinite(hps)) {
      sum += hps
      n += 1
      if (!peak || hps > peak.hps) peak = { hps: hps, date: String(rows[i].get('date')).slice(0, 10) }
    }
    const level = String(rows[i].get('level') || 'unknown')
    if (levels[level] !== undefined) levels[level] += 1
  }
  return {
    days: span,
    scored_days: n,
    mean_hps: n ? Math.round((sum / n) * 10) / 10 : null,
    peak: peak,
    by_level: levels,
  }
}

function searchKb(query) {
  const kb = require(__hooks + '/lib/kb.js')
  const result = kb.answer(String(query || ''))
  const sources = []
  for (let i = 0; i < result.sources.length; i += 1) {
    const src = result.sources[i]
    sources.push({ title: src.title, category: src.category })
  }
  return { answer_excerpt: result.answer.slice(0, 600), sources: sources }
}

function runTool(name, args, userId) {
  if (name === 'get_today_status') return todayStatus(userId)
  if (name === 'list_recent_checkins') return recentCheckins(userId, args.days)
  if (name === 'list_recent_assessments') return recentAssessments(userId, args.limit)
  if (name === 'get_trend') return trend(userId, args.days)
  if (name === 'search_kb') return searchKb(args.query)
  throw new Error('未授权的工具：' + name)
}

// ---------------- 模型调用 ----------------

function callModel(messages, tools) {
  const base = String($os.getenv('DEEPSEEK_BASE_URL') || 'https://api.deepseek.com').replace(/\/$/, '')
  const model = String($os.getenv('DEEPSEEK_MODEL') || 'deepseek-flash')
  const payload = {
    model: model,
    messages: messages,
    temperature: 0.3,
    max_tokens: 600,
  }
  if (tools && tools.length > 0) {
    payload.tools = tools
    payload.tool_choice = 'auto'
  }
  const res = $http.send({
    url: base + '/chat/completions',
    method: 'POST',
    timeout: 40,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + String($os.getenv('DEEPSEEK_API_KEY') || ''),
    },
    body: JSON.stringify(payload),
  })
  if (res.statusCode !== 200) {
    let detail = ''
    try {
      detail = toString(res.body).slice(0, 200)
    } catch (err) {
      detail = ''
    }
    throw new Error('upstream ' + res.statusCode + ' ' + detail)
  }
  return res.json
}

const CRISIS_WORDS = ['不想活', '自杀', '活不下去', '结束生命', '伤害自己', '不如死']

function hasCrisis(text) {
  for (let i = 0; i < CRISIS_WORDS.length; i += 1) {
    if (text.indexOf(CRISIS_WORDS[i]) >= 0) return true
  }
  return false
}

function history(userId, conversationId) {
  if (!conversationId) return []
  const rows = $app.findRecordsByFilter(
    'qa_sessions',
    'user = {:user} && conversation_id = {:cid}',
    '-created',
    6,
    0,
    { user: userId, cid: conversationId }
  )
  const out = []
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    out.push({ role: 'user', content: String(rows[i].get('question') || '') })
    out.push({ role: 'assistant', content: String(rows[i].get('answer') || '') })
  }
  return out
}

/**
 * 一轮对话：装配上下文 → 模型 → （工具调用循环）→ 最终回答
 * 返回 { answer, tools_used, usage:{tokens_in,tokens_out,cost_yuan}, safety }
 */
function chat(userId, message, conversationId) {
  const cfg = limits()
  const pricingCfg = pricing()
  const model = String($os.getenv('DEEPSEEK_MODEL') || 'deepseek-flash')

  const messages = [{ role: 'system', content: SYSTEM_PROMPT }]
  const past = history(userId, conversationId)
  for (let i = 0; i < past.length; i += 1) messages.push(past[i])
  messages.push({ role: 'user', content: message })

  let tokensIn = 0
  let tokensOut = 0
  const toolsUsed = []
  let answer = ''

  for (let round = 0; round < 3; round += 1) {
    const data = callModel(messages, TOOL_DEFS)
    const usage = data.usage || {}
    tokensIn += Number(usage.prompt_tokens) || 0
    tokensOut += Number(usage.completion_tokens) || 0

    const choice = (data.choices && data.choices[0]) || null
    const msg = choice && choice.message ? choice.message : null
    if (!msg) throw new Error('模型没有返回内容')

    const calls = msg.tool_calls || []
    if (calls.length === 0) {
      answer = String(msg.content || '').trim()
      break
    }

    // 把工具调用回填给模型
    messages.push({ role: 'assistant', content: msg.content || '', tool_calls: calls })
    for (let i = 0; i < calls.length; i += 1) {
      const call = calls[i]
      let args = {}
      try {
        args = JSON.parse(call.function.arguments || '{}')
      } catch (err) {
        args = {}
      }
      let result
      let ok = true
      try {
        result = runTool(call.function.name, args, userId)
      } catch (err) {
        ok = false
        result = { error: String(err && err.message ? err.message : err) }
      }
      toolsUsed.push({ name: call.function.name, ok: ok })
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result).slice(0, 4000),
      })
    }
  }

  if (!answer) throw new Error('模型没有给出最终回答')

  const cost =
    (tokensIn / 1000000) * Number(pricingCfg.input_per_million) +
    (tokensOut / 1000000) * Number(pricingCfg.output_per_million)

  return {
    answer: answer,
    tools_used: toolsUsed,
    usage: {
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      cost_yuan: Math.round(cost * 10000) / 10000,
    },
    model: model,
    limits: cfg,
  }
}

function crisisReply() {
  return (
    '听起来您现在很难受。请先联系一位信任的人陪着您，不要独处；' +
    '如果有伤害自己的想法，请拨打 120 或前往最近的急诊，也可以拨打心理援助热线 12356。' +
    '您不必一个人扛。'
  )
}

module.exports = {
  PROMPT_VERSION: PROMPT_VERSION,
  isEnabled: isEnabled,
  limits: limits,
  pricing: pricing,
  usageToday: usageToday,
  checkQuota: checkQuota,
  chat: chat,
  hasCrisis: hasCrisis,
  crisisReply: crisisReply,
  TOOL_DEFS: TOOL_DEFS,
}
