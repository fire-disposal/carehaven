/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// 助手：状态与一轮对话
//
//   GET  /api/zz/agent/status   是否可用、模型、今日用量与剩余额度
//   POST /api/zz/agent/chat     一轮对话（工具调用在服务端完成）
//
// 所有数据访问限定为本人；模型密钥只从环境变量读取（DEEPSEEK_API_KEY），
// 客户端不接触密钥，也不参与工具执行。
// ---------------------------------------------------------------------------

routerAdd(
  'GET',
  '/api/zz/agent/status',
  function (e) {
    const agent = require(__hooks + '/lib/agent.js')
    const info = e.requestInfo()
    const enabled = agent.isEnabled()
    const limits = agent.limits()
    const mine = agent.usageToday(info.auth.id)
    return e.json(200, {
      enabled: enabled,
      model: String($os.getenv('DEEPSEEK_MODEL') || 'deepseek-flash'),
      limits: limits,
      usage: mine,
      remaining_requests: Math.max(0, Number(limits.requests_per_day) - mine.requests),
    })
  },
  $apis.requireAuth()
)

routerAdd(
  'POST',
  '/api/zz/agent/chat',
  function (e) {
    const agent = require(__hooks + '/lib/agent.js')
    const info = e.requestInfo()
    const body = info.body || {}
    const userId = info.auth.id
    const message = String(body.message || '').trim()
    const conversationId = String(body.conversationId || '').trim() || 'c' + $security.randomString(16)

    if (message.length === 0) return e.badRequestError('请输入问题', null)
    if (message.length > 500) return e.badRequestError('问题请控制在 500 字以内', null)
    if (!agent.isEnabled()) {
      return e.json(503, { message: '助手暂未启用（未配置模型密钥）' })
    }

    // 危机识别：不调用模型，直接给固定求助路径
    if (agent.hasCrisis(message)) {
      const answer = agent.crisisReply()
      const chat = (function () {
        return {
          answer: answer,
          tools_used: [],
          usage: { tokens_in: 0, tokens_out: 0, cost_yuan: 0 },
          model: 'rule',
        }
      })()
      try {
        const record = new Record($app.findCollectionByNameOrId('qa_sessions'))
        record.set('user', userId)
        record.set('question', message)
        record.set('answer', answer)
        record.set('source', 'agent')
        record.set('conversation_id', conversationId)
        record.set('model', 'rule')
        record.set('prompt_version', agent.PROMPT_VERSION)
        record.set('tokens_in', 0)
        record.set('tokens_out', 0)
        record.set('cost_yuan', 0)
        record.set('tools', [])
        record.set('safety_flag', true)
        $app.save(record)
      } catch (err) {
        $app.logger().warn('助手会话保存失败', 'error', String(err))
      }
      return e.json(200, {
        conversationId: conversationId,
        answer: answer,
        tools: [],
        usage: chat.usage,
        safety: true,
        model: 'rule',
      })
    }

    const quota = agent.checkQuota(userId)
    if (!quota.ok) {
      const reasonText = {
        daily_requests: '今天的助手次数已用完',
        daily_tokens: '今天的助手用量已用完',
        daily_budget: '今天的助手额度已用完',
        global_tokens: '助手今日总用量已达上限',
      }
      return e.json(429, {
        message: (reasonText[quota.reason] || '今天的助手额度已用完') + '，明天会自动恢复',
        reason: quota.reason,
        usage: quota.mine,
      })
    }

    let result
    try {
      result = agent.chat(userId, message, conversationId)
    } catch (err) {
      const code = err && err.code ? String(err.code) : ''
      if (code === 'projected_tokens' || code === 'projected_budget') {
        return e.json(429, {
          message: code === 'projected_budget' ? '预计超出今日费用额度，明天会自动恢复' : '预计超出今日 token 额度，明天会自动恢复',
          reason: code,
        })
      }
      $app.logger().error('助手调用失败', 'error', String(err))
      return e.json(502, { message: '助手暂时不可用，已切换到知识库检索' })
    }

    let sessionId = ''
    try {
      const record = new Record($app.findCollectionByNameOrId('qa_sessions'))
      record.set('user', userId)
      record.set('question', message)
      record.set('answer', result.answer)
      record.set('source', 'agent')
      record.set('conversation_id', conversationId)
      record.set('model', result.model)
      record.set('prompt_version', agent.PROMPT_VERSION)
      record.set('tokens_in', result.usage.tokens_in)
      record.set('tokens_out', result.usage.tokens_out)
      record.set('cost_yuan', result.usage.cost_yuan)
      record.set('tools', result.tools_used)
      record.set('safety_flag', false)
      $app.save(record)
      sessionId = record.id
    } catch (err) {
      $app.logger().warn('助手会话保存失败', 'error', String(err))
    }

    const after = agent.usageToday(userId)
    return e.json(200, {
      id: sessionId,
      conversationId: conversationId,
      answer: result.answer,
      tools: result.tools_used,
      usage: result.usage,
      remaining_requests: Math.max(0, Number(result.limits.requests_per_day) - after.requests),
      estimate: result.estimate,
      model: result.model,
      safety: false,
    })
  },
  $apis.requireAuth()
)
