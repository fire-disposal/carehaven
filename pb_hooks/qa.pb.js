/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// 问答有用性反馈
//
// 每条回答可以标一次「有用 / 没用」。这既是给用户的轻量反馈入口，
// 也是检索质量的研究信号（配合 /api/zz/ask 的 matched_entries 做召回评估）。
// ---------------------------------------------------------------------------

routerAdd(
  'POST',
  '/api/zz/qa/{id}/helpful',
  function (e) {
    const info = e.requestInfo()
    const body = info.body || {}
    const id = e.request.pathValue('id')
    const value = String(body.value || '')

    if (value !== 'up' && value !== 'down') {
      return e.badRequestError('value 只能是 up 或 down', null)
    }

    let record
    try {
      record = $app.findRecordById('qa_sessions', id)
    } catch (err) {
      return e.notFoundError('这条问答不存在', null)
    }

    if (String(record.get('user')) !== String(info.auth.id)) {
      return e.notFoundError('这条问答不存在', null)
    }

    try {
      record.set('helpful', value)
      $app.save(record)
      return e.json(200, { id: id, helpful: value })
    } catch (err) {
      $app.logger().error('问答反馈保存失败', 'error', String(err))
      return e.json(500, { message: '反馈暂时没能记下，请稍后再试' })
    }
  },
  $apis.requireAuth()
)
