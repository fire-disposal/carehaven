/// <reference path="../pb_data/types.d.ts" />
// 单次订阅提醒：reminders
//
// 微信小程序的一次性订阅：用户点「一周后提醒我复测」时授权一次，后端只拥有一张「票」，
// 用完即失效。所以提醒不排队、不重试，而是落成一条到期记录，由 cron 扫到即发。
//
// 写入只走服务端（/api/zz/reminders 与 cron），因此 create/update/delete 规则为 null；
// 用户能看到的只有自己的那几条（list/view 限定 user = @request.auth.id）。
//
// 与既有 app_config 的两个 key 配合：
//   wechat_remind_template —— 订阅模板 ID（空 = 功能未开通，前端不显示入口）
//   wechat_remind_data     —— 模板字段映射，如 {"thing1":"量表复测提醒","time2":"{date}"}

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users')

    const reminders = new Collection({
      type: 'base',
      name: 'reminders',
      fields: [
        {
          name: 'user',
          type: 'relation',
          required: true,
          collectionId: users.id,
          maxSelect: 1,
          cascadeDelete: true,
        },
        // 提醒类型：决定到期时间与跳转页（见 pb_hooks/remind.pb.js）
        { name: 'kind', type: 'select', values: ['assessment_review', 'checkin_next_day'], maxSelect: 1, required: true },
        // 授权时的模板 ID：模板换版后仍能看出这条是哪个模板发的
        { name: 'template_id', type: 'text', max: 120 },
        // 发送目标：授权时的 openid 快照（用户后续换绑也不影响这次投递）
        { name: 'openid', type: 'text', max: 120 },
        { name: 'due_at', type: 'date', required: true },
        {
          name: 'status',
          type: 'select',
          values: ['pending', 'sent', 'failed'],
          maxSelect: 1,
          required: true,
        },
        { name: 'error', type: 'text', max: 500 },
        { name: 'sent_at', type: 'date' },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      // cron 只扫 pending 且已到期的行，这个索引让扫描量与到期数相关而非表大小
      indexes: [
        'CREATE INDEX idx_reminders_due ON reminders (status, due_at)',
        'CREATE INDEX idx_reminders_user_kind ON reminders (user, kind)',
      ],
      listRule: '@request.auth.id != "" && user = @request.auth.id',
      viewRule: '@request.auth.id != "" && user = @request.auth.id',
      createRule: null, // 服务端写入（订阅授权后由 /api/zz/reminders 落库）
      updateRule: null,
      deleteRule: null,
    })
    app.save(reminders)
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('reminders'))
    } catch (e) {
      // 忽略不存在的集合
    }
  }
)
