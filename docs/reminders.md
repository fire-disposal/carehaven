# 单次订阅提醒（小程序一次性订阅消息）

> 用途：自评结果页的「一周后提醒我复测」与打卡完成页的「明天提醒我打卡」。
> 用的是微信**一次性订阅消息**——用户每点一次「提醒我」，我们就得到一张只能用一次的票。
> 因此这里没有推送队列、没有重试，只有「到期就用掉」的一条记录。

---

## 一、开通步骤

1. **申请模板**：小程序后台 →「订阅消息」→ 选「一次性订阅」，从公共模板库里挑一个含
   「提醒事由（thing）+ 提醒时间（time）」的模板，或申请自定义模板（主体需已微信认证）。
   拿到**模板 ID**（形如 `AbCdEf...`，长度 43）。

2. **配两个 key 到 app_config**（用超级用户在管理端口写入，改完即时生效、不用重新部署）：

   | key | 值 | 说明 |
   |---|---|---|
   | `wechat_remind_template` | `AbCdEf...` | 模板 ID。**为空 = 功能未开通**，前端不显示任何按钮 |
   | `wechat_remind_data` | `{"thing1":"量表复测提醒","time2":"{date}"}` | 模板字段映射，键必须与模板里的字段名一致 |

   写入时 `app_config` 的校验对未知 key 放行（见 `pb_hooks/lib/config.js`），
   变更会自动进 `app_config_history` 留痕。

3. **配环境变量**：`WECHAT_APP_ID` / `WECHAT_APP_SECRET`（与微信登录共用同一对）。
   缺任意一个时 `/api/zz/reminders/config` 返回 `enabled: false`，cron 静默跳过。

4. **用户要有 openid**：`users.wechat_openid` 非空。小程序内用微信一键登录、
   或在「我的」里绑定微信都会写入。没有 openid 时授权接口返回 400「请先在小程序里绑定微信」。

5. **迁移**：`pb_migrations/1730001300_reminders.js` 建 `reminders` 集合；随正常发布流程执行。

---

## 二、两个提醒的语义

| kind | 入口 | 到期时间 | 点击消息跳到 |
|---|---|---|---|
| `assessment_review` | 量表结果页「一周后提醒我复测」 | 授权时刻 + 7 天 | `pages/assessment/index` |
| `checkin_next_day` | 打卡完成页「明天提醒我打卡」 | 授权时刻 + 1 天 | `pages/index/index` |

- 到期时间是**授权那一刻**往后推 7 天 / 1 天，不是当天零点——用户早上点就早上收到，晚上点就晚上收到。
- 结果页文案写「已开启，一周前提醒你」，与后端 +7 天一致。
- 同一 `user + kind` 只有一条 pending：再点一次是**把到期时间往后推**（幂等），
  不会堆出两条提醒——一次性订阅是「再点一次再得一张票」，两次点击对应同一件事。

### 模板字段映射

- `wechat_remind_data` 的每个值里，`{date}` 会替换成该条记录的 `due_at`，
  格式 `YYYY-MM-DD HH:mm`（服务器本地时区）。
- 未配置 `wechat_remind_data` 时的默认值：`{"thing1":"照护提醒"}`。
- 值会按微信要求包成 `{ "value": "..." }` 再提交；键名必须与模板字段一致，
  不一致时微信返回 `errcode`，该条记录标 `failed` 并把 errmsg 写进 `error`。

---

## 三、投递：cron 与失败处理

```
cronAdd('reminders:dispatch', '*/10 * * * *', ...)   // 每 10 分钟
```

- 每轮扫 `status = pending && due_at <= now`，按 `due_at` 升序**最多 20 条**
  （索引 `idx_reminders_due (status, due_at)`，扫描量与到期数相关，不随表增长变慢）。
- 发送成功 → `status = sent` + `sent_at`；失败 → `status = failed` + `error`（截断 500 字）。
- **失败不重试**：一次性订阅的票已经消耗（或已过期），重试发不出去，只会反复报错。
  用户下次打开页面再点一次即可拿到新票。
- 未配模板或缺 env：整轮直接跳过，只记一条 debug 日志（这是未开通的正常状态，不算故障）。
- access_token 取不到（如 Secret 写错）时，本轮所有记录都会标 `failed`，
  原因写进 `error`，可以直接在管理端 `reminders` 集合里看到。

> **为什么不直接按时间算、非要落成记录**：PocketBase 的 cron 是进程内触发，
> 停机错过的时间点不会补跑（见 [deploy.md](deploy.md)）。
> 把「该发」写成 `status = pending && due_at <= now` 的数据状态后，服务重启的第一轮就会补发，
> 不会因为一次发布窗口丢掉提醒。代价是 at-least-once：极端情况下可能重复尝试一次，
> 但同一张票只能用一次，微信会拒绝第二次，记录标 `failed` 而不是重复打扰用户。

---

## 四、为什么 H5 不显示入口

`requestSubscribeMessage` 是微信小程序专有 API，网页端没有对应能力，
订阅也只能由小程序客户端发起（openid 与订阅关系都挂在微信侧）。

前端因此做了两层拦截：

1. `miniapp/src/lib/remind.ts` 的 `getReminderConfig()` 在 `TARO_ENV !== 'weapp'` 时直接返回
   `{ enabled: false }`，H5 端连配置接口都不会请求；
2. 页面只在 `remindConfig.enabled === true` 时渲染按钮，所以 H5 产物里这些按钮不存在。

H5 上替代做法：结果页已有「可在一个月后复测」的文案提示，不额外做站内通知
——本站没有 Web Push 能力，做站内红点容易变成打扰。

---

## 五、实现位置

| 位置 | 职责 |
|---|---|
| `pb_migrations/1730001300_reminders.js` | `reminders` 集合、索引、规则（list/view 只本人，写只服务端） |
| `pb_hooks/remind.pb.js` | `GET /api/zz/reminders/config`、`POST /api/zz/reminders`、`cronAdd` 投递 |
| `pb_hooks/lib/wechat.js` | `accessToken()`（模块级缓存，提前 5 分钟过期）、`sendSubscribeMessage()` |
| `miniapp/src/lib/remind.ts` | 取配置、弹订阅授权、把 accept/decline/ban 同步给后端 |
| `miniapp/src/pages/assessment/index.tsx` | 结果页「一周后提醒我复测」 |
| `miniapp/src/pages/checkin/index.tsx` | 完成屏「明天提醒我打卡」 |

### 接口

```
GET  /api/zz/reminders/config          → { enabled: boolean, template_id: string }   （无需登录）
POST /api/zz/reminders                 → { status: 'accepted', due_at } | { status: 'declined' }
      body: { kind, template_id, action }      action ∈ accept / decline / ban
```

`decline` / `ban` 不落库——没拿到票就不该留记录。只有 `accept` 会校验模板一致性、
openid 存在性，然后写入或更新那条 pending 记录。

### reminders 集合

| 字段 | 类型 | 说明 |
|---|---|---|
| `user` | relation → users | 级联删除：注销账号同时清掉提醒 |
| `kind` | select | `assessment_review` / `checkin_next_day` |
| `template_id` | text | 授权时的模板 ID（模板换版后仍可追溯） |
| `openid` | text | 授权时的 openid 快照 |
| `due_at` | date | 到期时刻（UTC 存储） |
| `status` | select | `pending` / `sent` / `failed` |
| `error` | text | 失败原因（微信 errmsg） |
| `sent_at` | date | 实际发出时间 |

排障时直接看这张表：`status = failed` 的行就是没发出去的提醒，`error` 里是微信给的原话。
