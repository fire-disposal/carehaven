/// <reference path="../pb_data/types.d.ts" />
// 评分可复现：快照字段 + 事件表 + 配置历史 + 演示数据清理
//
// 背景（docs/platform.md）：
//   旧实现只存结果，改权重后历史不可复算；缺分量写 0 无法与「真的为 0」区分；
//   演示 seed 把 demo 账号与 simulated 数据写进了任何环境。
//
// 本迁移做四件事：
//   1. stress_scores 增加算法版本、参数快照、覆盖度、计算时间；level 增加 unknown。
//   2. 新增 append-only 的 stress_score_events。
//   3. 新增 app_config_history（配置变更留痕）。
//   4. 清理 seed 写入的 demo 账号与模拟生理数据（级联删除其全部记录）。

migrate(
  (app) => {
    const scores = app.findCollectionByNameOrId('stress_scores')

    scores.fields.add(new Field({ name: 'algorithm_version', type: 'text', max: 20 }))
    scores.fields.add(new Field({ name: 'params', type: 'json', maxSize: 4000 }))
    scores.fields.add(new Field({ name: 'coverage', type: 'json', maxSize: 2000 }))
    scores.fields.add(new Field({ name: 'computed_at', type: 'date' }))

    // 数据不足时不再伪装饰成「绿色」
    const level = scores.fields.getByName('level')
    if (level) {
      level.values = ['green', 'yellow', 'red', 'unknown']
      scores.fields.add(level)
    }

    scores.indexes = scores.indexes.concat([
      'CREATE UNIQUE INDEX idx_stress_scores_user_date ON stress_scores (user, date)',
    ])
    app.save(scores)

    const users = app.findCollectionByNameOrId('users')

    const events = new Collection({
      type: 'base',
      name: 'stress_score_events',
      fields: [
        {
          name: 'user',
          type: 'relation',
          required: true,
          collectionId: users.id,
          maxSelect: 1,
          cascadeDelete: true,
        },
        { name: 'date', type: 'date', required: true },
        // 分量可为空：空表示「未采集」，与 0 分语义不同
        { name: 'hps', type: 'number', min: 0, max: 100 },
        { name: 'score_physio', type: 'number', min: 0, max: 100 },
        { name: 'score_psycho', type: 'number', min: 0, max: 100 },
        { name: 'score_context', type: 'number', min: 0, max: 100 },
        { name: 'level', type: 'select', values: ['green', 'yellow', 'red', 'unknown'], maxSelect: 1 },
        { name: 'algorithm_version', type: 'text', max: 20 },
        { name: 'params', type: 'json', maxSize: 4000 },
        { name: 'coverage', type: 'json', maxSize: 2000 },
        {
          name: 'trigger',
          type: 'select',
          values: ['checkin', 'physio', 'intervention', 'qa', 'manual', 'replay'],
          maxSelect: 1,
        },
        { name: 'computed_at', type: 'date' },
        { name: 'created', type: 'autodate', onCreate: true },
      ],
      indexes: [
        'CREATE INDEX idx_score_events_user_date ON stress_score_events (user, date)',
        'CREATE INDEX idx_score_events_created ON stress_score_events (created DESC)',
      ],
      listRule: 'user = @request.auth.id',
      viewRule: 'user = @request.auth.id',
      createRule: null, // 仅评分内核写入
      updateRule: null,
      deleteRule: null,
    })
    app.save(events)

    const history = new Collection({
      type: 'base',
      name: 'app_config_history',
      fields: [
        { name: 'key', type: 'text', required: true },
        { name: 'value', type: 'json', maxSize: 4000 },
        { name: 'author', type: 'text', max: 120 },
        { name: 'reason', type: 'text', max: 300 },
        { name: 'effective_from', type: 'date' },
        { name: 'created', type: 'autodate', onCreate: true },
      ],
      indexes: ['CREATE INDEX idx_config_history_key ON app_config_history (key, created DESC)'],
      listRule: null, // 仅管理员
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    })
    app.save(history)

    // ---------- 清理演示数据 ----------
    // 先删账号（relation 上 cascadeDelete=true，会带走其打卡/生理/评分/帖子等）
    for (const email of ['demo@zz.local', 'demo2@zz.local']) {
      try {
        const demo = app.findFirstRecordByFilter('users', 'email = {:email}', { email: email })
        app.delete(demo)
      } catch (e) {
        // 不存在即跳过：新装库在 seed 关闭时没有这两个账号
      }
    }

    // 兜底：任何残留的模拟生理数据（研究红线：simulated 不得进入结论）
    try {
      const simulated = app.findRecordsByFilter('physio_records', "source = 'simulated'", '', 1000, 0)
      for (const record of simulated) app.delete(record)
    } catch (e) {
      // 集合或字段不存在时跳过
    }
  },
  (app) => {
    for (const name of ['app_config_history', 'stress_score_events']) {
      try {
        app.delete(app.findCollectionByNameOrId(name))
      } catch (e) {
        // 忽略
      }
    }

    const scores = app.findCollectionByNameOrId('stress_scores')
    for (const field of ['algorithm_version', 'params', 'coverage', 'computed_at']) {
      try {
        scores.fields.removeByName(field)
      } catch (e) {
        // 忽略
      }
    }
    app.save(scores)
  }
)
