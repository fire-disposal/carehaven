/// <reference path="../pb_data/types.d.ts" />
// 结构化互助：whispers / whisper_reactions / whisper_reports
//
// 决策背景见 docs/ugc-archive.md：
//   自由文本 UGC 不回归；互助以「词元拼句」形式回归——
//   用户只能从词库选择，句子由服务端拼接，因此不存在用户自造文本，
//   随之取消的是自由评论，改为固定回应（一人一帖一个）。
//
// 同时下线旧的自由文本表：posts / comments 的 API 规则全部置空。
// 表与历史数据保留（可逆），需要时可从 archive/ugc 分支对照恢复。

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users')

    const whispers = new Collection({
      type: 'base',
      name: 'whispers',
      fields: [
        {
          name: 'user',
          type: 'relation',
          required: true,
          collectionId: users.id,
          maxSelect: 1,
          cascadeDelete: true,
        },
        { name: 'nickname', type: 'text', max: 24 },
        {
          name: 'kind',
          type: 'select',
          values: ['分享', '求助', '陪伴'],
          maxSelect: 1,
          required: true,
        },
        // 服务端渲染后的整句：唯一可展示的正文，客户端不回写
        { name: 'text', type: 'text', required: true, max: 200 },
        // 词元 id：{ scene, feeling?, tried?, wish }
        { name: 'terms', type: 'json', maxSize: 1000 },
        // 词库版本：词库发版后仍可还原当年这句话的语义
        { name: 'lexicon_version', type: 'text', max: 20 },
        { name: 'anonymous', type: 'bool' },
        { name: 'reactions_count', type: 'number', min: 0 },
        // 每种回应的人数：{ 我也是: 3, 抱抱: 1 }
        { name: 'reaction_counts', type: 'json', maxSize: 1000 },
        { name: 'report_count', type: 'number', min: 0 },
        { name: 'hidden', type: 'bool' },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_whispers_created ON whispers (created DESC)',
        'CREATE INDEX idx_whispers_visible ON whispers (hidden, created DESC)',
      ],
      listRule: '@request.auth.id != "" && (hidden = false || user = @request.auth.id)',
      viewRule: '@request.auth.id != "" && (hidden = false || user = @request.auth.id)',
      createRule: null, // 只走 /api/zz/whispers 服务端路由
      updateRule: null,
      deleteRule: 'user = @request.auth.id',
    })
    app.save(whispers)

    const reactions = new Collection({
      type: 'base',
      name: 'whisper_reactions',
      fields: [
        {
          name: 'whisper',
          type: 'relation',
          required: true,
          collectionId: whispers.id,
          maxSelect: 1,
          cascadeDelete: true,
        },
        {
          name: 'user',
          type: 'relation',
          required: true,
          collectionId: users.id,
          maxSelect: 1,
          cascadeDelete: true,
        },
        { name: 'kind', type: 'select', values: ['我也是', '抱抱', '有用', '加油'], maxSelect: 1, required: true },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_whisper_reactions_once ON whisper_reactions (whisper, user)'],
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: null, // 由服务端路由写入，保证一人一帖一条
      updateRule: null,
      deleteRule: 'user = @request.auth.id',
    })
    app.save(reactions)

    const reports = new Collection({
      type: 'base',
      name: 'whisper_reports',
      fields: [
        {
          name: 'whisper',
          type: 'relation',
          required: true,
          collectionId: whispers.id,
          maxSelect: 1,
          cascadeDelete: true,
        },
        {
          name: 'user',
          type: 'relation',
          required: true,
          collectionId: users.id,
          maxSelect: 1,
          cascadeDelete: true,
        },
        {
          name: 'reason',
          type: 'select',
          values: ['暴露隐私', '攻击他人', '不合适', '其他'],
          maxSelect: 1,
          required: true,
        },
        { name: 'created', type: 'autodate', onCreate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_whisper_reports_once ON whisper_reports (whisper, user)'],
      // 举报记录含举报人关联：只对管理员可见，前台不暴露
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    })
    app.save(reports)

    // 下线自由文本社群：保留表与数据，关闭全部 API 规则
    for (const name of ['posts', 'comments']) {
      const col = app.findCollectionByNameOrId(name)
      col.listRule = null
      col.viewRule = null
      col.createRule = null
      col.updateRule = null
      col.deleteRule = null
      app.save(col)
    }
  },
  (app) => {
    for (const name of ['whisper_reports', 'whisper_reactions', 'whispers']) {
      try {
        app.delete(app.findCollectionByNameOrId(name))
      } catch (e) {
        // 不存在则忽略
      }
    }

    // 恢复自由文本社群的可访问规则（回到本次迁移之前的形态）
    const postsRules = {
      posts: {
        listRule: '@request.auth.id != ""',
        viewRule: '@request.auth.id != ""',
        createRule: '@request.auth.id != ""',
        updateRule: 'user = @request.auth.id',
        deleteRule: 'user = @request.auth.id',
      },
      comments: {
        listRule: '@request.auth.id != ""',
        viewRule: '@request.auth.id != ""',
        createRule: '@request.auth.id != ""',
        updateRule: 'user = @request.auth.id',
        deleteRule: 'user = @request.auth.id',
      },
    }
    for (const name of ['posts', 'comments']) {
      const col = app.findCollectionByNameOrId(name)
      const r = postsRules[name]
      col.listRule = r.listRule
      col.viewRule = r.viewRule
      col.createRule = r.createRule
      col.updateRule = r.updateRule
      col.deleteRule = r.deleteRule
      app.save(col)
    }
  }
)
