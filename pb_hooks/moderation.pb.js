/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// 处置接口：隐藏 / 恢复互助内容，并留痕
//
// 这是唯一受支持的处置入口：动作、理由、操作者、前后状态都写进 moderation_actions。
// 不走「后台直接改 hidden」——那样没有理由，也没有可举证的记录。
//
// 权限：仅超管（$apis.requireSuperuserAuth）。
// ---------------------------------------------------------------------------

routerAdd(
  'POST',
  '/api/zz/moderation/whispers/{id}',
  function (e) {
    const moderation = require(__hooks + '/lib/moderation.js')
    const info = e.requestInfo()
    const body = info.body || {}
    const id = e.request.pathValue('id')
    const action = String(body.action || '')
    const reason = String(body.reason || '').trim()

    if (action !== 'hide' && action !== 'restore') {
      return e.badRequestError('action 只能是 hide 或 restore', null)
    }
    if (reason.length < 4) {
      return e.badRequestError('请填写处置理由（至少 4 个字）', null)
    }

    let whisper
    try {
      whisper = $app.findRecordById('whispers', id)
    } catch (err) {
      return e.notFoundError('内容不存在或已删除', null)
    }

    const before = whisper.get('hidden') === true
    const after = action === 'hide'
    if (before === after) {
      return e.json(200, { id: id, hidden: after, unchanged: true })
    }

    whisper.set('hidden', after)
    $app.save(whisper)

    try {
      moderation.recordAction({
        actor: String(info.auth.get('email') || info.auth.id),
        collection: 'whispers',
        id: id,
        action: after ? 'hidden' : 'restored',
        reason: reason,
        before: { hidden: before },
        after: { hidden: after },
      })
    } catch (err) {
      // 留痕失败不回滚处置，但必须能在日志里看到
      $app.logger().error('处置留痕写入失败', 'whisper', id, 'error', String(err))
      return e.json(500, { message: '内容状态已更新，但处置记录写入失败，请告知维护者' })
    }

    return e.json(200, { id: id, hidden: after })
  },
  $apis.requireSuperuserAuth()
)
