/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// 意见反馈：客户端只提交分类与内容，服务端补用户、来源页面和状态
//
// 注意：hook 处理器在独立 JSVM 运行时执行，顶层 const/函数在处理器里不可见，
// 常量与校验必须写在处理器内部（见 zhihu.pb.js 的同类说明）。
// ---------------------------------------------------------------------------

routerAdd(
  'POST',
  '/api/zz/feedback',
  function (e) {
    const categories = ['功能建议', '使用困难', '内容问题', '违规举报', '其他']
    const info = e.requestInfo()
    const body = info.body || {}
    const category = String(body.category || '')
    const content = String(body.content || '').trim()
    const contact = String(body.contact || '').trim()
    const page = String(body.page || '').trim()

    if (categories.indexOf(category) < 0) {
      return e.badRequestError('请选择反馈类型', null)
    }
    if (content.length < 5) {
      return e.badRequestError('请至少写 5 个字，方便我们理解问题', null)
    }
    if (content.length > 1000) {
      return e.badRequestError('内容请控制在 1000 字以内', null)
    }
    if (contact.length > 100) {
      return e.badRequestError('联系方式请控制在 100 字以内', null)
    }

    try {
      const record = new Record($app.findCollectionByNameOrId('feedback'))
      record.set('user', info.auth ? info.auth.id : '')
      record.set('category', category)
      record.set('content', content)
      record.set('contact', contact)
      record.set('page', page)
      record.set('status', 'new')
      $app.save(record)
      return e.json(200, { id: record.id, created: String(record.get('created') || '') })
    } catch (err) {
      $app.logger().error('反馈保存失败', 'error', String(err))
      return e.json(500, { message: '反馈暂时没能提交，请稍后再试' })
    }
  },
  $apis.requireAuth()
)
