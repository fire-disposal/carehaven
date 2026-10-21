# carehaven（智护忆站）

失智症家庭照护者的压力是慢慢累积的：打卡、按等级找应对办法、临时问一句“这算正常吗”，需要一个地方一次做完。

**状态**：原型，链路已跑通并做过单机部署；未对外开放注册；**入口**：`miniapp` 的 H5 构建或微信开发者工具；**仓库**：`fire-disposal/carehaven`

## 本质

把打卡与生理记录合成 HPS、按三层给干预的失智症家庭照护者支持原型。

## 选型

基于 PocketBase 单二进制的原型，前端 Taro + React，后端 PocketBase JS hooks，数据内嵌 SQLite，部署单容器。

- 前端
  - Taro 4.3
    - React 18
    - TypeScript
    - Sass
  - Bun
- 后端
  - PocketBase
    - JS 迁移
    - JS hooks
- 数据
  - SQLite
    - API Rules
- 部署
  - Docker
  - Nginx
  - GitHub Actions

## 功能

- 压力监测：打卡（心情 1–5、焦虑 0–10、疲劳 0–10、睡眠、照护时长）与生理记录（HRV、GSR、睡眠质量、步数，`source` 区分 device / simulated / manual）
- HPS：生理分按 `physio_normal_range` 归一化，心理分 `0.45·心情 + 0.35·焦虑 + 0.2·疲劳`，上下文分按照护时长、干预记录、问答次数加权；缺生理数据时按实际权重和重新归一
- 分层阈值：默认 `0.4 / 0.4 / 0.2` 与 `40 / 70`，存在 `app_config`，改行记录即可调整
- 分层干预：8 个种子方案、四个分类，按等级推荐，记录完成与 1–5 星反馈
- 知识库问答：14 条 WHO iSupport 本土化条目，关键词命中 + 2-gram 检索取前 3 条拼接回答，历史落 `qa_sessions`
- 社群：经验分享 / 情绪树洞 / 照护技巧三分区，发帖、评论、点赞、匿名发布
- 我的：30 天趋势、干预记录、评分记录、生理数据补录
- 登录：邮箱密码；微信 `code` 换 openid 并绑定账号（需配置 AppID / Secret）
- 数据模型 12 个集合：users、checkins、physio_records、stress_scores、interventions、intervention_logs、kb_entries、qa_sessions、posts、comments、ratings、app_config

## 启动流程

```bash
./pocketbase migrate up
./pocketbase serve --http=127.0.0.1:8090
# 管理后台 http://127.0.0.1:8090/_/    REST http://127.0.0.1:8090/api/
```

```bash
cd miniapp
bun install
bun run build:h5      # 产物可放进 pb_public 由 PocketBase 托管
bun run build:weapp   # 微信开发者工具导入 dist
```

H5 同源托管一条命令：`bun run deploy:h5`。

## 边界与已知问题

- `physio_records.source = "simulated"` 是合成数据，用于演示链路，不是设备采集；汇报与论文必须如实标注。
- 知识问答不是 LLM：只做关键词与 2-gram 检索后拼接原文，检索不到会明确说没找到；接模型的换点在 `pb_hooks/lib/kb.js` 注释里。
- 没有审核、举报与处置留痕能力，社群一开放就触发 UGC 合规义务；短期只能不开放注册。
- README 拿 PocketBase cron 与 Celery Beat 对比，但仓库里没有 `cronAdd`，定时提醒并未实现。
- 数据删除只有接口能力（`remove`），界面没有入口；导出更没有。
- 多副本会重复执行进程内任务，只能单容器；扩容需要先把定时任务挪出进程。
- `app_config` 的写规则只对超级用户开放，普通账号改不了权重与阈值。
- 小程序与 H5 共用同一份后端；H5 同源托管时前端 `TARO_APP_API_BASE` 留空即可。

## 文档索引

- [docs/deploy.md](docs/deploy.md) — 单机部署
- [docs/wechat-onboarding.md](docs/wechat-onboarding.md) — 微信接入
