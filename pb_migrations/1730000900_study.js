/// <reference path="../pb_data/types.d.ts" />
// 研究实验：研究、分组、入组与事件留痕
//
// 目标：让平台成为可靠的实验数据来源，而不是"能用的 App"。
// 这一层解决四件事：
//   1. 研究有编码、协议版本、状态与时间窗；
//   2. 受试者入组时按配比分配组别（区组分配），分配可审计；
//   3. 组别可对受试者隐藏（盲法），但导出仍带真实组别；
//   4. 入组/退出/分配都留事件，导出时按 ITT 口径统计。

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users')

    const studies = new Collection({
      type: 'base',
      name: 'studies',
      fields: [
        { name: 'code', type: 'text', required: true, max: 32 },
        { name: 'title', type: 'text', required: true, max: 120 },
        { name: 'protocol_version', type: 'text', required: true, max: 20 },
        { name: 'status', type: 'select', values: ['draft', 'active', 'closed'], maxSelect: 1, required: true },
        { name: 'opens_at', type: 'date' },
        { name: 'closes_at', type: 'date' },
        // none：受试者知道组别；arm_hidden：只显示"已分组"
        { name: 'blinding', type: 'select', values: ['none', 'arm_hidden'], maxSelect: 1 },
        // [{ day: 0, scales: ["phq9","gad7","zbi12"], window: 3 }]，day 相对入组日
        { name: 'schedule', type: 'json', maxSize: 4000 },
        { name: 'notes', type: 'text', max: 1000 },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_studies_code ON studies (code)'],
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: null,
      updateRule: null,
      deleteRule: null,
    })
    app.save(studies)

    const arms = new Collection({
      type: 'base',
      name: 'study_arms',
      fields: [
        {
          name: 'study',
          type: 'relation',
          required: true,
          collectionId: studies.id,
          maxSelect: 1,
          cascadeDelete: true,
        },
        { name: 'code', type: 'text', required: true, max: 16 },
        { name: 'label', type: 'text', required: true, max: 60 },
        // 分配配比；同研究内应约成整数比
        { name: 'ratio', type: 'number', min: 0, max: 100 },
        { name: 'created', type: 'autodate', onCreate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_arm_study_code ON study_arms (study, code)'],
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: null,
      updateRule: null,
      deleteRule: null,
    })
    app.save(arms)

    const enrollments = new Collection({
      type: 'base',
      name: 'study_enrollments',
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
          name: 'study',
          type: 'relation',
          required: true,
          collectionId: studies.id,
          maxSelect: 1,
          cascadeDelete: true,
        },
        { name: 'arm', type: 'relation', required: true, collectionId: arms.id, maxSelect: 1, cascadeDelete: false },
        { name: 'assigned_at', type: 'date', required: true },
        { name: 'method', type: 'select', values: ['block', 'manual'], maxSelect: 1 },
        {
          name: 'status',
          type: 'select',
          values: ['active', 'withdrawn', 'completed'],
          maxSelect: 1,
          required: true,
        },
        { name: 'withdrawn_at', type: 'date' },
        { name: 'reason', type: 'text', max: 200 },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_enroll_user_study ON study_enrollments (user, study)'],
      listRule: 'user = @request.auth.id',
      viewRule: 'user = @request.auth.id',
      createRule: null,
      updateRule: null,
      deleteRule: null,
    })
    app.save(enrollments)

    const events = new Collection({
      type: 'base',
      name: 'study_events',
      fields: [
        { name: 'study', type: 'relation', collectionId: studies.id, maxSelect: 1, cascadeDelete: true },
        { name: 'user', type: 'relation', collectionId: users.id, maxSelect: 1, cascadeDelete: true },
        {
          name: 'type',
          type: 'select',
          values: ['enrolled', 'withdrawn', 'completed', 'arm_revealed', 'deviation'],
          maxSelect: 1,
          required: true,
        },
        { name: 'detail', type: 'json', maxSize: 2000 },
        { name: 'actor', type: 'text', max: 120 },
        { name: 'created', type: 'autodate', onCreate: true },
      ],
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    })
    app.save(events)
  },
  (app) => {
    for (const name of ['study_events', 'study_enrollments', 'study_arms', 'studies']) {
      try {
        app.delete(app.findCollectionByNameOrId(name))
      } catch (e) {
        // 忽略
      }
    }
  }
)
