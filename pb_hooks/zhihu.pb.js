/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// 智护忆站 —— 服务端钩子与自定义路由
//
// ⚠️ PocketBase JSVM 关键约束（踩过的坑）：
//    hook 处理器在**独立运行时**中执行，本文件顶层定义的函数在处理器里不可见
//    （报错形如 "xxx is not defined at .../pb.js"）。
//    因此共享逻辑一律放 pb_hooks/lib/ 并由处理器内部 require() 加载。
// ---------------------------------------------------------------------------

// ---------------- HPS 重算：数据变化即刷新当日压力得分 ----------------
// 主观打卡

onRecordAfterCreateSuccess(function (e) {
  const hps = require(__hooks + '/lib/hps.js')
  hps.safeRecompute(hps.userIdOf(e.record))
  return e.next()
}, 'checkins')

onRecordAfterUpdateSuccess(function (e) {
  const hps = require(__hooks + '/lib/hps.js')
  hps.safeRecompute(hps.userIdOf(e.record))
  return e.next()
}, 'checkins')

onRecordAfterDeleteSuccess(function (e) {
  const hps = require(__hooks + '/lib/hps.js')
  hps.safeRecompute(hps.userIdOf(e.record))
  return e.next()
}, 'checkins')

// 生理数据（含未来蓝牙设备写入）

onRecordAfterCreateSuccess(function (e) {
  const hps = require(__hooks + '/lib/hps.js')
  hps.safeRecompute(hps.userIdOf(e.record))
  return e.next()
}, 'physio_records')

onRecordAfterUpdateSuccess(function (e) {
  const hps = require(__hooks + '/lib/hps.js')
  hps.safeRecompute(hps.userIdOf(e.record))
  return e.next()
}, 'physio_records')

onRecordAfterDeleteSuccess(function (e) {
  const hps = require(__hooks + '/lib/hps.js')
  hps.safeRecompute(hps.userIdOf(e.record))
  return e.next()
}, 'physio_records')

// 干预完成记录（影响情境得分：干预次数）

onRecordAfterCreateSuccess(function (e) {
  const hps = require(__hooks + '/lib/hps.js')
  hps.safeRecompute(hps.userIdOf(e.record))
  return e.next()
}, 'intervention_logs')

onRecordAfterUpdateSuccess(function (e) {
  const hps = require(__hooks + '/lib/hps.js')
  hps.safeRecompute(hps.userIdOf(e.record))
  return e.next()
}, 'intervention_logs')

onRecordAfterDeleteSuccess(function (e) {
  const hps = require(__hooks + '/lib/hps.js')
  hps.safeRecompute(hps.userIdOf(e.record))
  return e.next()
}, 'intervention_logs')

// ---------------- 照护知识问答 ----------------

routerAdd(
  'POST',
  '/api/zz/ask',
  function (e) {
    const kb = require(__hooks + '/lib/kb.js')
    const info = e.requestInfo()
    const body = info.body || {}
    const question = String(body.question || '').trim()

    if (question.length === 0) {
      return e.badRequestError('请输入您想问的问题', null)
    }
    if (question.length > 200) {
      return e.badRequestError('问题过长，请精简到 200 字以内', null)
    }

    const result = kb.answer(question)
    const userId = info.auth ? info.auth.id : ''

    try {
      const record = new Record($app.findCollectionByNameOrId('qa_sessions'))
      record.set('user', userId)
      record.set('question', question)
      record.set('answer', result.answer)
      record.set(
        'matched_entries',
        result.sources.map(function (s) {
          return s.id
        })
      )
      $app.save(record)
    } catch (err) {
      $app.logger().error('问答记录保存失败', 'error', String(err))
    }

    return e.json(200, result)
  },
  $apis.requireAuth()
)

// ---------------- 帖子点赞（服务端自增） ----------------
// posts 的 updateRule 只允许作者改自己的帖子，因此点赞不能由客户端 PATCH，
// 改由服务端路由自增计数。

routerAdd(
  'POST',
  '/api/zz/posts/{id}/like',
  function (e) {
    const postId = e.request.pathValue('id')
    const post = $app.findRecordById('posts', postId)
    const likes = Number(post.get('likes')) || 0
    post.set('likes', likes + 1)
    $app.save(post)
    return e.json(200, { likes: likes + 1 })
  },
  $apis.requireAuth()
)

// ---------------- 评论计数维护（服务端） ----------------
// posts.comments_count 不能由客户端回写（updateRule 仅允许作者改自己的帖子），
// 因此在评论增删时由服务端维护计数。

onRecordAfterCreateSuccess(function (e) {
  try {
    const post = $app.findRecordById('posts', String(e.record.get('post')))
    post.set('comments_count', (Number(post.get('comments_count')) || 0) + 1)
    $app.save(post)
  } catch (err) {
    $app.logger().warn('评论计数更新失败', 'error', String(err))
  }
  return e.next()
}, 'comments')

onRecordAfterDeleteSuccess(function (e) {
  try {
    const post = $app.findRecordById('posts', String(e.record.get('post')))
    const next = (Number(post.get('comments_count')) || 0) - 1
    post.set('comments_count', next < 0 ? 0 : next)
    $app.save(post)
  } catch (err) {
    $app.logger().warn('评论计数更新失败', 'error', String(err))
  }
  return e.next()
}, 'comments')

// ---------------- 微信一键登录（小程序端） ----------------
// 小程序 wx.login 取 code → 这里换取 openid 并签发 PocketBase token。
// 无需登录态（本身就是登录入口）；未配置 AppID/Secret 时返回 503 并说明原因。

routerAdd('POST', '/api/zz/wechat/login', function (e) {
  const wechat = require(__hooks + '/lib/wechat.js')
  const missing = wechat.missingEnv()
  if (missing.length > 0) {
    return e.json(503, { message: '微信登录未配置，缺少环境变量：' + missing.join(' / ') })
  }
  const info = e.requestInfo()
  const body = info.body || {}
  try {
    return e.json(200, wechat.loginWithCode(String(body.code || '')))
  } catch (err) {
    return e.badRequestError(String(err && err.message ? err.message : err), null)
  }
})

// ---------------- 微信绑定（把 openid 绑到当前账号） ----------------
// 需要登录态：先用邮箱登录，再绑定微信，实现跨端同账号。

routerAdd(
  'POST',
  '/api/zz/wechat/bind',
  function (e) {
    const wechat = require(__hooks + '/lib/wechat.js')
    const missing = wechat.missingEnv()
    if (missing.length > 0) {
      return e.json(503, { message: '微信登录未配置，缺少环境变量：' + missing.join(' / ') })
    }
    const info = e.requestInfo()
    const body = info.body || {}
    try {
      const record = wechat.bindWithCode(info.auth ? info.auth.id : '', String(body.code || ''))
      return e.json(200, { record: record })
    } catch (err) {
      return e.badRequestError(String(err && err.message ? err.message : err), null)
    }
  },
  $apis.requireAuth()
)
