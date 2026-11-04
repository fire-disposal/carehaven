/// <reference path="../pb_data/types.d.ts" />
// 预置插画头像：存预设 id（如 sun / leaf），不占用 users.avatar 文件字段。
migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users')
    users.fields.add(new Field({ name: 'avatar_preset', type: 'text', max: 32 }))
    app.save(users)
  },
  (app) => {
    const users = app.findCollectionByNameOrId('users')
    users.fields.removeByName('avatar_preset')
    app.save(users)
  }
)
