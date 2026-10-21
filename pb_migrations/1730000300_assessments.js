/// <reference path="../pb_data/types.d.ts" />
// 量表自评结果（ZBI-12 / PHQ-9 / GAD-7）
//
// 写入只走服务端路由 /api/zz/assessments：分数、分级与安全标记由服务端算，
// 客户端只提交量表与答案，避免前端改分或伪造结果。
// 删除保留给用户本人（数据权利：可删除自己的数据）。

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users')

    const assessments = new Collection({
      type: 'base',
      name: 'assessments',
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
          name: 'scale',
          type: 'select',
          values: ['zbi12', 'phq9', 'gad7'],
          maxSelect: 1,
          required: true,
        },
        { name: 'answers', type: 'json', maxSize: 2000 },
        { name: 'score', type: 'number', min: 0, max: 100 },
        { name: 'level', type: 'select', values: ['green', 'yellow', 'red'], maxSelect: 1 },
        { name: 'severity', type: 'text', max: 20 },
        { name: 'advice', type: 'text', max: 600 },
        { name: 'flag', type: 'bool' },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      listRule: 'user = @request.auth.id',
      viewRule: 'user = @request.auth.id',
      createRule: null, // 仅服务端路由可写
      updateRule: null,
      deleteRule: 'user = @request.auth.id',
    })

    app.save(assessments)
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId('assessments'))
  }
)
