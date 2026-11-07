/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// 单次订阅提醒（微信小程序一次性订阅消息）
//
// 流程：小程序点「提醒我」→ wx.requestSubscribeMessage 拿到 accept/decline/ban
//      → 只有 accept 才 POST /api/zz/reminders 落库（一次授权 = 一张票）
//      → cron 每 10 分钟扫到期记录 → 调订阅消息接口发出 → 标记 sent / failed
//
// 为什么用「到期记录 + 扫描」而不是 cron 里直接算时间：
// PocketBase cron 是进程内触发，停机错过的时间点不会补跑；把「该不该发」写成数据状态，
// 重启后的第一轮就会补发。代价是 at-least-once：极端情况下重复尝试一次，
// 但一张票只能用一次，微信会拒绝第二次，记录标 failed 而不会重复打扰用户。
//
// JSVM 约束：处理器在各自运行时执行，本文件顶层的函数在处理器里不可见——
// kind 元数据、配置读取、模板拼装都放 lib/remind.js，处理器内 require。
// ---------------------------------------------------------------------------

routerAdd('GET', '/api/zz/reminders/config', function (e) {
  const remind = require(__hooks + '/lib/remind.js')
  const wechat = require(__hooks + '/lib/wechat.js')
  const conf = remind.settings()
  return e.json(200, {
    // 两个条件缺一不可：有模板 ID，且 AppID/Secret 齐备，否则消息发不出去
    enabled: conf.templateId !== '' && wechat.missingEnv().length === 0,
    template_id: conf.templateId,
  })
})

routerAdd(
  'POST',
  '/api/zz/reminders',
  function (e) {
    const remind = require(__hooks + '/lib/remind.js')
    const info = e.requestInfo()
    const body = info.body || {}
    const kind = String(body.kind || '')
    const action = String(body.action || '')
    const templateId = String(body.template_id || '')

    const spec = remind.KINDS[kind]
    if (!spec) {
      return e.badRequestError('未知的提醒类型', null)
    }
    if (action !== 'accept') {
      // decline / ban：用户没给票，不落库；回执只用于前端文案
      return e.json(200, { status: 'declined' })
    }

    const conf = remind.settings()
    if (!conf.templateId) {
      return e.badRequestError('提醒功能未开通', null)
    }
    if (!templateId || templateId !== conf.templateId) {
      return e.badRequestError('提醒模板不匹配，请更新小程序后再试', null)
    }

    let openid = ''
    try {
      const user = $app.findRecordById('users', info.auth.id)
      openid = String(user.get('wechat_openid') || '')
    } catch (err) {
      return e.json(404, { message: '账号不存在' })
    }
    if (!openid) {
      return e.badRequestError('请先在小程序里绑定微信', null)
    }

    const dueAt = remind.toPbDate(new Date(Date.now() + spec.days * 24 * 60 * 60 * 1000))

    try {
      // 同一 user+kind 只保留一条 pending：重复授权把到期时间往后推即可。
      // 一次性订阅是「再点一次再得一张票」，两次点击对应同一件事，不该堆出两条提醒。
      let record = null
      try {
        record = $app.findFirstRecordByFilter(
          'reminders',
          'user = {:user} && kind = {:kind} && status = "pending"',
          { user: info.auth.id, kind: kind }
        )
      } catch (err) {
        // 没有 pending 记录时 findFirstRecordByFilter 会报错，按「不存在」处理
        record = null
      }

      if (record) {
        record.set('due_at', dueAt)
        record.set('template_id', templateId)
        record.set('openid', openid)
        record.set('error', '')
        $app.save(record)
      } else {
        const created = new Record($app.findCollectionByNameOrId('reminders'))
        created.set('user', info.auth.id)
        created.set('kind', kind)
        created.set('template_id', templateId)
        created.set('openid', openid)
        created.set('due_at', dueAt)
        created.set('status', 'pending')
        $app.save(created)
        record = $app.findRecordById('reminders', created.id)
      }

      return e.json(200, {
        status: 'accepted',
        due_at: String(record.get('due_at')),
      })
    } catch (err) {
      $app.logger().error('提醒登记失败', 'user', info.auth.id, 'kind', kind, 'error', String(err))
      return e.json(500, { message: '提醒没能登记上，请稍后再试' })
    }
  },
  $apis.requireAuth()
)

// ---------------- 到期投递 ----------------
//
// 每 10 分钟扫一次，单批最多 20 条，避免一轮堆太久（一轮跑不完的记录留到下一轮）。
// 没配模板或缺 env 时整轮跳过，只记 debug——这是未开通的正常状态，不是故障。

cronAdd('reminders:dispatch', '*/10 * * * *', function () {
  const remind = require(__hooks + '/lib/remind.js')
  const wechat = require(__hooks + '/lib/wechat.js')

  const conf = remind.settings()
  if (!conf.templateId || wechat.missingEnv().length > 0) {
    $app.logger().debug('订阅提醒未开通，跳过本轮扫描')
    return
  }

  let records = []
  try {
    records = $app.findRecordsByFilter(
      'reminders',
      'status = "pending" && due_at <= {:now}',
      'due_at',
      20,
      0,
      { now: remind.toPbDate(new Date()) }
    )
  } catch (err) {
    $app.logger().error('提醒扫描失败', 'error', String(err))
    return
  }

  for (let i = 0; i < records.length; i += 1) {
    const record = records[i]
    const kind = String(record.get('kind') || '')
    const spec = remind.KINDS[kind]
    const openid = String(record.get('openid') || '')
    // 记录上的模板 ID 优先：授权时的模板比当前配置更贴近那张票
    const templateId = String(record.get('template_id') || '') || conf.templateId

    try {
      if (!openid) throw new Error('缺少 openid')
      wechat.sendSubscribeMessage({
        openid: openid,
        template_id: templateId,
        page: spec ? spec.page : 'pages/index/index',
        data: remind.templateData(conf.data, record.get('due_at'), kind),
      })
      record.set('status', 'sent')
      record.set('sent_at', remind.toPbDate(new Date()))
      record.set('error', '')
    } catch (err) {
      // 一次性订阅不重试：票已用过或已过期，重试也发不出去，只留原因
      record.set('status', 'failed')
      record.set('error', String(err && err.message ? err.message : err).slice(0, 500))
      $app.logger().warn('订阅提醒发送失败', 'reminder', record.id, 'error', String(err))
    }

    try {
      $app.save(record)
    } catch (saveErr) {
      $app.logger().error('提醒状态回写失败', 'reminder', record.id, 'error', String(saveErr))
    }
  }
})
