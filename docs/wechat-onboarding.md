# 微信小程序接入备忘（注册 → 接入 → 上线）

> 当前状态：**工程已能编译出微信小程序产物**（编译验证见本文第一节），但**尚未注册小程序、未接入微信登录**。
> 本文是「要做什么、按什么顺序做、每步的坑」的备忘，不是已经完成的事项清单。

---

## 一、编译验证（已完成，可复现）

```bash
cd miniapp
bun install
bun run build:weapp
```

产物在 `miniapp/dist/`，为标准小程序结构：

```
app.js / app.json / app.wxss        应用入口与全局配置
pages/{login,index,manage,qa,community,profile}/
                                   六个页面的 .wxml / .wxss / .js / .json
base.wxml / taro.js / common.js    Taro 运行时
project.config.json                开发者工具工程配置
```

用**微信开发者工具**打开 `miniapp/` 目录即可预览（`project.config.json` 的 `miniprogramRoot` 指向 `dist`）。

已验证：2026-10-15 在本地执行 `bun run build:weapp` 成功，产物齐全；H5 与小程序共用同一套源码与同一后端。

---

## 二、注册与资质（决定能否上线）

### 1. 主体选择

| 主体 | 能做 | 不能做 |
|---|---|---|
| 个人 | 简单工具类 | **医疗健康、社区/论坛类目开不了**；微信支付不可用 |
| 企业 / 事业单位 / 学校 | 完整类目 | — |

本项目涉及**健康相关数据（情绪、睡眠、照护负担）**与**UGC（社群发帖/评论）**，
建议用**学校或合作机构主体**注册，个人主体基本走不通。

### 2. 类目与资质

- 本项目归入**健康管理**类目，**该类目无需特殊资质**；同类产品的过审先例已存在
  （EmoGuard 小程序 `wxfa9eb24a85ff200d` 即同体裁的健康管理小程序）。
  要区分的是另一类：「医疗健康」下涉及**诊疗、处方、医疗器械**的功能才需要资质证明，
  本项目做的是压力监测与支持，不涉诊疗。
- **UGC（社群/评论）是独立的门槛**：开通社区/论坛类目需提供内容审核能力说明。
  这一项与健康管理类目无关，未具备审核能力前不要开放该功能。
- 名称查重：小程序名称全网唯一，注册前先在小程序后台查名是否被占用
  （「智护忆站 / CareHaven」目前未注册，但需实时查询）。
- 微信认证：企业/机构主体 300 元/年；部分接口（订阅消息等）要求已认证主体。
  个人主体可开健康管理类目，但**不能开通社区/论坛类目**，社群功能会受限。

### 3. 备案

- 小程序本身需在微信侧完成备案（个人/企业均需），备案信息需与主体一致；
- 后台服务域名 `care.example.com` 已解析到境内服务器（境内 VPS），**服务器在中国大陆需完成 ICP 备案**——
  这是当前最可能卡住上线的一步，需提前走流程。

---

## 三、接入步骤（拿到 AppID 之后）

### 1. 填 AppID

`miniapp/project.config.json` 的 `appid` 由 `touristappid` 改为正式 AppID。

### 2. 配置服务器域名

小程序后台 → 开发 → 开发管理 → 开发设置 → 服务器域名：

```
request 合法域名:  https://care.example.com
```

（H5 与 API 同域，只需一条。小程序请求不受 CORS 限制，无需额外 CORS 配置。）

### 3. 微信登录（后端已预留位置）

当前登录是**邮箱 + 密码**（`miniapp/src/pages/login/index.tsx` + `api.login`）。
换成微信登录需要新增一段服务端逻辑，位置在 `pb_hooks/`：

```
POST /api/zz/wechat/login   { code }
  1. 用 APPID/APPSECRET 调 https://api.weixin.qq.com/sns/jscode2session 换 openid
  2. 按 openid 找 users 记录：命中则登录；未命中则创建（邮箱可留空，openid 存自定义字段）
  3. 用 record.newAuthToken() 签发 PocketBase token 返回
```

注意事项：

- **openid 必须绑定到同一条 users 记录**，否则同一人用 H5 与小程序会变成两个账号；
  若将来做多端统一，建议同时保存 unionid（需开放平台绑定）。
- 小程序端用 `Taro.login()` 拿 code，再调上面这个接口；
- APPID/APPSECRET 放服务器 `/srv/carehaven/.env`，不要进 git；
- 现有的邮箱登录**保留**（管理员/演示账号仍需要它）。

### 4. 订阅消息（消息推送）

- 需要在微信后台申请模板（如「测评提醒」），拿到模板 ID；
- 每次下发都需用户**逐次授权**（`wx.requestSubscribeMessage`），配额有限、不能当推送通道用；
- 因此原型期的提醒策略：进入小程序时弹「今日还没打卡」提示，不依赖订阅消息。

### 5. 蓝牙设备（不需要资质）

小程序蓝牙 API（`openBluetoothAdapter` / `createBLEConnection` / `notifyBLECharacteristicValueChange`）
**不需要额外资质**，只需用户授权。接口与帧协议已在 `miniapp/src/lib/ble.ts` 预留：

- `DEVICE_PROFILES` 为空 = 尚未登记设备型号；硬件确定后填入 GATT 服务/特征值 UUID 与帧格式（`json-v1`）；
- 数据写入 `physio_records`，用 `source: 'device'` 与模拟数据区分；
- 注意：iOS/Android 对后台蓝牙与广播包过滤行为不同，真机联调时需分平台验证。

---

## 四、上线前检查清单

- [ ] 主体与类目确定（UGC 与健康数据是两道硬门槛）
- [ ] 域名 ICP 备案完成
- [ ] 内容审核能力就绪**之前**，社群/评论功能保持关闭（`posts`/`comments` 的规则可临时收紧）
- [ ] 隐私保护指引填写并公示（收集情绪、睡眠等敏感个人信息，需单独同意）
- [ ] `app_config` 的 HPS 权重与阈值经专家确认
- [ ] 模拟数据（`source = simulated`）与真实数据在界面与材料中区分标注
- [ ] 体验版验收通过后再提交审核

---

## 五、已知平台差异（写进代码的约束）

| 能力 | H5 | 微信小程序 | 本项目处理 |
|---|---|---|---|
| 实时推送 | SSE 可用 | **不支持 EventSource** | 小程序端改用轮询；H5 可用 SSE |
| 本地存储 | localStorage | 小程序 storage | `Taro.getStorageSync` 统一（`api.ts` 已封装） |
| 蓝牙 | 不可用 | 可用 | 设备接入只在小程序端实现 |
| 域名要求 | 备案 + HTTPS | 备案 + HTTPS + 后台白名单 | 域名 `care.example.com` 同时满足两者 |
