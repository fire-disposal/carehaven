/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// 结构化互助：词元拼句
//
// 客户端不提交任何自由文本。请求体只有「分区 + 槽位词元 id」，
// 句子由 lib/lexicon.js 拼接；词库变更需发版（可审、可回滚）。
//
// JSVM 约束：处理器在独立运行时执行，常量与 require 都写在处理器内部。
// 文件名必须以 .pb.js 结尾，PocketBase 只加载该后缀（实测 0.40.5）。
// ---------------------------------------------------------------------------

routerAdd(
  'GET',
  '/api/zz/whispers/lexicon',
  function (e) {
    const lexicon = require(__hooks + '/lib/lexicon.js')
    return e.json(200, lexicon.publicLexicon())
  },
  $apis.requireAuth()
)

routerAdd(
  'POST',
  '/api/zz/whispers',
  function (e) {
    const lexicon = require(__hooks + '/lib/lexicon.js')
    const info = e.requestInfo()
    const body = info.body || {}
    const user = info.auth

    const kind = String(body.kind || '')
    if (!lexicon.isKind(kind)) {
      return e.badRequestError('请选择这条属于哪一类', null)
    }

    let composed
    try {
      composed = lexicon.compose(body.terms)
    } catch (err) {
      return e.badRequestError(String(err && err.message ? err.message : err), null)
    }

    // 每日上限：结构化内容也要防刷屏，同时压住写入侧滥用。
    const now = new Date()
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
    const limitStart = dayStart.toISOString().replace('T', ' ')
    const todayCount = $app.findRecordsByFilter(
      'whispers',
      'user = {:user} && created >= {:start}',
      '',
      lexicon.DAILY_POST_LIMITS,
      0,
      { user: user.id, start: limitStart }
    ).length
    if (todayCount >= lexicon.DAILY_POST_LIMITS) {
      return e.json(429, { message: '今天已经拼了 ' + lexicon.DAILY_POST_LIMITS + ' 句，明天再来吧' })
    }

    const anonymous = body.anonymous === true
    const displayName = anonymous ? '匿名' : String(user.get('name') || '').trim() || '照护者'

    let record
    try {
      record = new Record($app.findCollectionByNameOrId('whispers'))
      record.set('user', user.id)
      record.set('nickname', displayName)
      record.set('kind', kind)
      record.set('text', composed.text)
      record.set('terms', composed.terms)
      record.set('lexicon_version', lexicon.VERSION)
      record.set('anonymous', anonymous)
      record.set('reactions_count', 0)
      record.set('reaction_counts', {})
      record.set('report_count', 0)
      record.set('hidden', false)
      $app.save(record)
    } catch (err) {
      $app.logger().error('拼句保存失败', 'error', String(err))
      return e.json(500, { message: '这句话暂时没能发出去，请稍后再试' })
    }

    return e.json(200, {
      id: record.id,
      kind: kind,
      text: composed.text,
      terms: composed.terms,
      lexicon_version: lexicon.VERSION,
      nickname: displayName,
      anonymous: anonymous,
      reactions_count: 0,
      reaction_counts: {},
      report_count: 0,
      hidden: false,
      created: String(record.get('created') || ''),
    })
  },
  $apis.requireAuth()
)

// 固定回应：一人一帖一条，重复提交即改选。
routerAdd(
  'POST',
  '/api/zz/whispers/{id}/react',
  function (e) {
    const lexicon = require(__hooks + '/lib/lexicon.js')
    const info = e.requestInfo()
    const body = info.body || {}
    const whisperId = e.request.pathValue('id')
    const kind = String(body.kind || '')

    if (!lexicon.isReaction(kind)) {
      return e.badRequestError('不认识这种回应', null)
    }

    let whisper
    try {
      whisper = $app.findRecordById('whispers', whisperId)
    } catch (err) {
      return e.notFoundError('这句话不存在或已删除', null)
    }
    if (whisper.get('hidden') === true && String(whisper.get('user')) !== info.auth.id) {
      return e.notFoundError('这句话不存在或已删除', null)
    }

    try {
      const existing = $app.findRecordsByFilter(
        'whisper_reactions',
        'whisper = {:whisper} && user = {:user}',
        '',
        1,
        0,
        { whisper: whisperId, user: info.auth.id }
      )
      const reaction =
        existing.length > 0
          ? existing[0]
          : new Record($app.findCollectionByNameOrId('whisper_reactions'))
      if (existing.length === 0) {
        reaction.set('whisper', whisperId)
        reaction.set('user', info.auth.id)
      }
      reaction.set('kind', kind)
      $app.save(reaction)

      // 计数以库为准重算：避免 JSON 自增在并发下漂移。
      const all = $app.findRecordsByFilter(
        'whisper_reactions',
        'whisper = {:whisper}',
        '',
        2000,
        0,
        { whisper: whisperId }
      )
      const counts = {}
      for (let i = 0; i < lexicon.REACTIONS.length; i += 1) {
        counts[lexicon.REACTIONS[i]] = 0
      }
      for (let i = 0; i < all.length; i += 1) {
        const key = String(all[i].get('kind') || '')
        if (counts[key] !== undefined) counts[key] += 1
      }
      whisper.set('reaction_counts', counts)
      whisper.set('reactions_count', all.length)
      $app.save(whisper)

      return e.json(200, { kind: kind, reaction_counts: counts, reactions_count: all.length })
    } catch (err) {
      $app.logger().error('回应保存失败', 'error', String(err))
      return e.json(500, { message: '回应暂时没能记下，请稍后再试' })
    }
  },
  $apis.requireAuth()
)

// 举报：一人一帖一次；累计到阈值自动隐藏，进人工复核。
routerAdd(
  'POST',
  '/api/zz/whispers/{id}/report',
  function (e) {
    const lexicon = require(__hooks + '/lib/lexicon.js')
    const info = e.requestInfo()
    const body = info.body || {}
    const whisperId = e.request.pathValue('id')
    const reason = String(body.reason || '')

    if (!lexicon.isReportReason(reason)) {
      return e.badRequestError('请选择举报原因', null)
    }

    let whisper
    try {
      whisper = $app.findRecordById('whispers', whisperId)
    } catch (err) {
      return e.notFoundError('这句话不存在或已删除', null)
    }

    try {
      const existing = $app.findRecordsByFilter(
        'whisper_reports',
        'whisper = {:whisper} && user = {:user}',
        '',
        1,
        0,
        { whisper: whisperId, user: info.auth.id }
      )
      if (existing.length === 0) {
        const report = new Record($app.findCollectionByNameOrId('whisper_reports'))
        report.set('whisper', whisperId)
        report.set('user', info.auth.id)
        report.set('reason', reason)
        $app.save(report)
      }

      const all = $app.findRecordsByFilter(
        'whisper_reports',
        'whisper = {:whisper}',
        '',
        100,
        0,
        { whisper: whisperId }
      )
      const hidden = all.length >= lexicon.AUTO_HIDE_REPORTS
      whisper.set('report_count', all.length)
      if (hidden) whisper.set('hidden', true)
      $app.save(whisper)

      return e.json(200, { report_count: all.length, hidden: hidden })
    } catch (err) {
      $app.logger().error('举报保存失败', 'error', String(err))
      return e.json(500, { message: '举报暂时没能提交，请稍后再试' })
    }
  },
  $apis.requireAuth()
)
