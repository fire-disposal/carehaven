/// <reference path="../pb_data/types.d.ts" />
// 微信登录支持：给 users 增加 openid / unionid 字段与唯一索引
//
// 说明：PocketBase 自定义登录流程需要把微信身份绑定到一条 users 记录上，
// 因此同一自然人在 H5（邮箱）与小程序（微信）两端能落到同一条记录，
// 不会分裂成两套账号。

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users')

    users.fields.add(new Field({ name: 'wechat_openid', type: 'text' }))
    users.fields.add(new Field({ name: 'wechat_unionid', type: 'text' }))

    // openid 唯一（空值不参与唯一约束，故用部分索引）
    users.indexes = users.indexes.concat([
      'CREATE UNIQUE INDEX `idx_users_wechat_openid` ON `users` (`wechat_openid`) WHERE `wechat_openid` != ""',
    ])

    app.save(users)
  },
  (app) => {
    const users = app.findCollectionByNameOrId('users')
    users.indexes = users.indexes.filter((idx) => idx.indexOf('idx_users_wechat_openid') === -1)
    users.fields.removeByName('wechat_openid')
    users.fields.removeByName('wechat_unionid')
    app.save(users)
  }
)
