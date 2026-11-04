/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// 研究参与同意
//
// 只有显式同意的用户才会进入研究数据集（dataset.mjs 与导出都按此过滤）。
// 同意与撤回写同一条记录：granted_at / withdrawn_at 互补，version 记录条款版本。
//
// JSVM 约束：顶层常量在处理器里不可见，版本号与判定放在 lib/consent.js。
// ---------------------------------------------------------------------------

routerAdd(
  'GET',
  '/api/zz/research/consent',
  function (e) {
    const consent = require(__hooks + '/lib/consent.js')
    const info = e.requestInfo()
    const userId = info.auth.id

    try {
      const rows = $app.findRecordsByFilter(
        'research_consents',
        'user = {:user}',
        '',
        1,
        0,
        { user: userId }
      )
      if (rows.length === 0) {
        return e.json(200, { granted: false, version: consent.CONSENT_VERSION, updated_at: '' })
      }
      const row = rows[0]
      return e.json(200, {
        granted: consent.isGranted(row),
        version: String(row.get('version') || consent.CONSENT_VERSION),
        updated_at: String(row.get('updated') || row.get('created') || ''),
      })
    } catch (err) {
      $app.logger().error('读取研究同意失败', 'error', String(err))
      return e.json(500, { message: '暂时读不到同意状态' })
    }
  },
  $apis.requireAuth()
)

routerAdd(
  'POST',
  '/api/zz/research/consent',
  function (e) {
    const consent = require(__hooks + '/lib/consent.js')
    const info = e.requestInfo()
    const body = info.body || {}
    const userId = info.auth.id
    const granted = body.granted === true
    const now = new Date().toISOString().replace('T', ' ')

    try {
      const rows = $app.findRecordsByFilter(
        'research_consents',
        'user = {:user}',
        '',
        1,
        0,
        { user: userId }
      )
      const record =
        rows.length > 0
          ? rows[0]
          : new Record($app.findCollectionByNameOrId('research_consents'))
      if (rows.length === 0) {
        record.set('user', userId)
        record.set('scope', 'research')
      }
      record.set('version', consent.CONSENT_VERSION)
      if (granted) {
        record.set('granted_at', now)
        record.set('withdrawn_at', '')
      } else {
        if (!record.get('granted_at')) record.set('granted_at', now)
        record.set('withdrawn_at', now)
      }
      $app.save(record)

      return e.json(200, {
        granted: granted,
        version: consent.CONSENT_VERSION,
        updated_at: String(record.get('updated') || now),
      })
    } catch (err) {
      $app.logger().error('写入研究同意失败', 'error', String(err))
      return e.json(500, { message: '同意状态暂时没能保存，请稍后再试' })
    }
  },
  $apis.requireAuth()
)
