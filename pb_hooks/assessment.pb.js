/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// 量表自评：服务端计分入口
//
// 客户端只提交 { scale, answers }；分数、分级、安全标记与建议都在服务端生成，
// 因此 assessments 集合的 createRule 保持 null，客户端无法直接写分。
// ---------------------------------------------------------------------------

routerAdd(
  'POST',
  '/api/zz/assessments',
  function (e) {
    const scales = require(__hooks + '/lib/scales.js')
    const info = e.requestInfo()
    const body = info.body || {}
    let result
    try {
      result = scales.score(String(body.scale || ''), body.answers)
    } catch (err) {
      return e.badRequestError(String(err && err.message ? err.message : err), null)
    }

    try {
      const record = new Record($app.findCollectionByNameOrId('assessments'))
      record.set('user', info.auth ? info.auth.id : '')
      record.set('scale', result.scale)
      record.set('answers', body.answers)
      record.set('score', result.score)
      record.set('level', result.level)
      record.set('severity', result.severity)
      record.set('advice', result.advice)
      record.set('flag', result.flag)
      $app.save(record)
      result.id = record.id
      result.created = String(record.get('created') || '')
    } catch (err) {
      $app.logger().error('量表结果保存失败', 'error', String(err))
      return e.json(500, { message: '结果暂时无法保存，请稍后重试' })
    }

    return e.json(200, result)
  },
  $apis.requireAuth()
)
