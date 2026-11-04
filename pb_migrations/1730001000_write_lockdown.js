/// <reference path="../pb_data/types.d.ts" />
// 写入收口 + 量表日期关联
//
// 逻辑问题：
//   1. 打卡与生理由客户端直写，`date`、`source`、`user` 全可伪造——研究样本不可信；
//   2. 量表只有 created 时间，没有"哪一天"的语义，与同日评分关联要靠时间戳猜；
//
// 本迁移：
//   - 关闭 checkins / physio_records 的客户端创建与更新（改走服务端路由）；
//   - 给 assessments 增加 date（服务端按日写入），并建 (user, date) 索引；
//   - 补 checkins / physio_records 的 (user, date) 索引，便于按日查询与导出。

migrate(
  (app) => {
    for (const name of ['checkins', 'physio_records']) {
      const col = app.findCollectionByNameOrId(name)
      col.createRule = null // 只走 /api/zz/checkins、/api/zz/physio/manual
      col.updateRule = null
      col.indexes = col.indexes.concat([
        'CREATE INDEX idx_' + name + '_user_date ON ' + name + ' (user, date)',
      ])
      app.save(col)
    }

    const assessments = app.findCollectionByNameOrId('assessments')
    assessments.fields.add(new Field({ name: 'date', type: 'date' }))
    assessments.indexes = assessments.indexes.concat([
      'CREATE INDEX idx_assessments_user_date ON assessments (user, date)',
    ])
    app.save(assessments)

    // 回填：把已有记录的 created 落到 date（服务端时区按本地日）
    const rows = app.findRecordsByFilter('assessments', "date = ''", '', 5000, 0)
    for (const row of rows) {
      const created = String(row.get('created') || '')
      if (!created) continue
      row.set('date', created)
      app.save(row)
    }
  },
  (app) => {
    for (const name of ['checkins', 'physio_records']) {
      const col = app.findCollectionByNameOrId(name)
      col.createRule = 'user = @request.auth.id'
      col.updateRule = 'user = @request.auth.id'
      app.save(col)
    }
    const assessments = app.findCollectionByNameOrId('assessments')
    try {
      assessments.fields.removeByName('date')
      app.save(assessments)
    } catch (e) {
      // 忽略
    }
  }
)
