/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// 配置写入护栏
//
// app_config 是政策参数（HPS 权重、分层阈值、生理区间）。改一次，历史分数就换了一套口径，
// 所以：写入前校验（Σw=1、0≤w≤1、阈值有序、区间 lo<hi），写入后留痕（app_config_history）。
//
// JSVM 约束：处理器在独立运行时执行，本文件顶层的函数在处理器里不可见——
// 共享逻辑一律放 lib/ 并在处理器内 require（见 lib/config.js）。
// ---------------------------------------------------------------------------

onRecordCreateRequest(function (e) {
  const cfg = require(__hooks + '/lib/config.js')
  try {
    cfg.validate(String(e.record.get('key') || ''), e.record.get('value'))
  } catch (err) {
    if (err && err.isValidation) {
      throw new BadRequestError(String(err.message))
    }
    throw err
  }
  return e.next()
}, 'app_config')

onRecordUpdateRequest(function (e) {
  const cfg = require(__hooks + '/lib/config.js')
  try {
    cfg.validate(String(e.record.get('key') || ''), e.record.get('value'))
  } catch (err) {
    if (err && err.isValidation) {
      throw new BadRequestError(String(err.message))
    }
    throw err
  }
  return e.next()
}, 'app_config')

onRecordAfterCreateSuccess(function (e) {
  const cfg = require(__hooks + '/lib/config.js')
  let author = 'admin'
  try {
    const info = typeof e.requestInfo === 'function' ? e.requestInfo() : null
    if (info && info.auth && info.auth.id) {
      author = String(info.auth.get('email') || info.auth.id)
    }
  } catch (err) {
    // 取不到操作者时保留 admin：留痕价值高于身份精度
  }
  try {
    cfg.recordHistory(e.record, author, 'create')
  } catch (err2) {
    $app.logger().warn('配置历史写入失败', 'error', String(err2))
  }
  return e.next()
}, 'app_config')

onRecordAfterUpdateSuccess(function (e) {
  const cfg = require(__hooks + '/lib/config.js')
  let author = 'admin'
  try {
    const info = typeof e.requestInfo === 'function' ? e.requestInfo() : null
    if (info && info.auth && info.auth.id) {
      author = String(info.auth.get('email') || info.auth.id)
    }
  } catch (err) {
    // 同上
  }
  try {
    cfg.recordHistory(e.record, author, 'update')
  } catch (err2) {
    $app.logger().warn('配置历史写入失败', 'error', String(err2))
  }
  return e.next()
}, 'app_config')
