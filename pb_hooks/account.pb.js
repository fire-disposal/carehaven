/// <reference path="../pb_data/types.d.ts" />

// ---------------------------------------------------------------------------
// 数据权利：导出与注销
//
// 导出：逐集合取该用户的记录（不含他人数据、不含系统表），返回一份 JSON 包。
// 注销：删除 users 记录；所有 user 关系字段都是 cascadeDelete=true，
//       打卡、生理、评分事件、量表、问答、互助内容随之删除。需要显式确认。
//
// JSVM 约束：处理器在独立运行时执行，本文件顶层常量在处理器里不可见——
// 清单与序列化都放 lib/account.js，处理器内 require。
// ---------------------------------------------------------------------------

routerAdd(
  'GET',
  '/api/zz/account/export',
  function (e) {
    const acc = require(__hooks + '/lib/account.js')
    const info = e.requestInfo()
    const userId = info.auth.id

    try {
      const bundle = {
        meta: {
          exported_at: new Date().toISOString(),
          user_id: userId,
          collections: acc.EXPORT_COLLECTIONS,
          note: '互助内容为词元组合与拼接结果；评分含算法版本与参数快照。',
        },
        account: acc.serialize(info.auth),
        data: {},
      }

      for (let i = 0; i < acc.EXPORT_COLLECTIONS.length; i += 1) {
        const name = acc.EXPORT_COLLECTIONS[i]
        try {
          const records = $app.findRecordsByFilter(
            name,
            'user = {:user}',
            '-created',
            2000,
            0,
            { user: userId }
          )
          const rows = []
          for (let j = 0; j < records.length; j += 1) rows.push(acc.serialize(records[j]))
          bundle.data[name] = rows
        } catch (err) {
          // 集合不存在（归档中的表）时留空，不阻断整份导出
          bundle.data[name] = []
        }
      }

      return e.json(200, bundle)
    } catch (err) {
      $app.logger().error('账号导出失败', 'user', userId, 'error', String(err))
      return e.json(500, { message: '导出暂时没能完成，请稍后再试' })
    }
  },
  $apis.requireAuth()
)

routerAdd(
  'POST',
  '/api/zz/account/delete',
  function (e) {
    const info = e.requestInfo()
    const body = info.body || {}
    if (String(body.confirm || '') !== 'DELETE') {
      return e.badRequestError('如需注销，请先确认', null)
    }

    try {
      const user = $app.findRecordById('users', info.auth.id)
      $app.delete(user)
    } catch (err) {
      $app.logger().error('账号删除失败', 'user', info.auth.id, 'error', String(err))
      return e.json(500, { message: '注销没能完成，请稍后再试或通过反馈联系我们' })
    }

    return e.json(200, { deleted: true })
  },
  $apis.requireAuth()
)
