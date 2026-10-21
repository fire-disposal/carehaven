/// <reference path="../pb_data/types.d.ts" />
// 意见反馈
//
// 反馈可能包含联系方式与个人经历，默认只对管理员可见：
// list/view/create/update/delete 全部留给后台，写入走 /api/zz/feedback 服务端路由。

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users')

    const feedback = new Collection({
      type: 'base',
      name: 'feedback',
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
          name: 'category',
          type: 'select',
          values: ['功能建议', '使用困难', '内容问题', '违规举报', '其他'],
          maxSelect: 1,
          required: true,
        },
        { name: 'content', type: 'text', required: true, max: 1000 },
        { name: 'contact', type: 'text', max: 100 },
        { name: 'page', type: 'text', max: 100 },
        {
          name: 'status',
          type: 'select',
          values: ['new', 'read', 'done'],
          maxSelect: 1,
        },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    })

    app.save(feedback)
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId('feedback'))
  }
)
