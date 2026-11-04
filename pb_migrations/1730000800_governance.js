/// <reference path="../pb_data/types.d.ts" />
// 治理与运营闭环：处置留痕、研究同意、用量计数
//
// 解决三个"文档里写了、代码里没有"的缺口：
//   1. 举报后隐藏了谁、谁恢复的、为什么——没有台账（docs/console.md C1）。
//   2. 研究导出没有同意门控（docs/platform.md B6）。
//   3. 问答与 TTS 没有用户级日配额，成本不可控（docs/platform.md A5）。

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users')

    // ---------- 1. 处置留痕 ----------
    const actions = new Collection({
      type: 'base',
      name: 'moderation_actions',
      fields: [
        { name: 'actor', type: 'text', max: 120 },
        { name: 'target_collection', type: 'text', required: true, max: 40 },
        { name: 'target_id', type: 'text', required: true, max: 40 },
        { name: 'action', type: 'select', values: ['hidden', 'restored'], maxSelect: 1, required: true },
        { name: 'reason', type: 'text', max: 300 },
        { name: 'before', type: 'json', maxSize: 1000 },
        { name: 'after', type: 'json', maxSize: 1000 },
        { name: 'created', type: 'autodate', onCreate: true },
      ],
      indexes: [
        'CREATE INDEX idx_moderation_target ON moderation_actions (target_collection, target_id)',
        'CREATE INDEX idx_moderation_created ON moderation_actions (created DESC)',
      ],
      // 只对管理员可见；写入只走服务端
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    })
    app.save(actions)

    // ---------- 2. 研究同意 ----------
    const consents = new Collection({
      type: 'base',
      name: 'research_consents',
      fields: [
        {
          name: 'user',
          type: 'relation',
          required: true,
          collectionId: users.id,
          maxSelect: 1,
          cascadeDelete: true,
        },
        {
          name: 'scope',
          type: 'select',
          values: ['research'],
          maxSelect: 1,
          required: true,
        },
        { name: 'version', type: 'text', required: true, max: 20 },
        { name: 'granted_at', type: 'date' },
        { name: 'withdrawn_at', type: 'date' },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_research_consent_one ON research_consents (user)'],
      listRule: 'user = @request.auth.id',
      viewRule: 'user = @request.auth.id',
      createRule: null, // 只走 /api/zz/research/consent
      updateRule: null,
      deleteRule: null,
    })
    app.save(consents)

    // ---------- 3. 用量计数（问答 / TTS） ----------
    const usage = new Collection({
      type: 'base',
      name: 'usage_counters',
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
        { name: 'kind', type: 'select', values: ['ask', 'tts'], maxSelect: 1, required: true },
        { name: 'count', type: 'number', min: 0 },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_usage_once ON usage_counters (user, date, kind)'],
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    })
    app.save(usage)

    // ---------- 4. 问答有用性反馈 ----------
    const qa = app.findCollectionByNameOrId('qa_sessions')
    qa.fields.add(new Field({ name: 'helpful', type: 'select', values: ['up', 'down'], maxSelect: 1 }))
    qa.indexes = qa.indexes.concat([
      'CREATE INDEX idx_qa_user_created ON qa_sessions (user, created DESC)',
    ])
    app.save(qa)

    // ---------- 5. 研究常用查询的索引 ----------
    const assessments = app.findCollectionByNameOrId('assessments')
    assessments.indexes = assessments.indexes.concat([
      'CREATE INDEX idx_assessments_user_created ON assessments (user, created)',
    ])
    app.save(assessments)

    const whispers = app.findCollectionByNameOrId('whispers')
    whispers.indexes = whispers.indexes.concat([
      'CREATE INDEX idx_whispers_user_created ON whispers (user, created DESC)',
    ])
    app.save(whispers)
  },
  (app) => {
    for (const name of ['usage_counters', 'research_consents', 'moderation_actions']) {
      try {
        app.delete(app.findCollectionByNameOrId(name))
      } catch (e) {
        // 忽略
      }
    }
    const qa = app.findCollectionByNameOrId('qa_sessions')
    try {
      qa.fields.removeByName('helpful')
      app.save(qa)
    } catch (e) {
      // 忽略
    }
  }
)
