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
- 量表自评：ZBI-12 照护负担 / PHQ-9 情绪 / GAD-7 焦虑；分数、分级与自伤念头安全提示全部由服务端算，客户端只提交答案
- 知识库问答：14 条 WHO iSupport 本土化条目 + 36 条迁入的照护图谱节点，关键词命中 + 2-gram 检索取前 3 条拼接回答，历史落 `qa_sessions`
- 语音朗读：豆包 Seed TTS 2.0（HTTP 单向流式）由 `/api/zz/tts` 代理，密钥只在服务端；全局朗读层统一播放入口
- 社群：经验分享 / 情绪树洞 / 照护技巧三分区，发帖、评论、点赞、匿名发布
- 我的：30 天趋势、干预记录、评分记录、生理数据补录
- 反馈与协议：意见反馈（分类 + 联系方式）、关于、用户协议与隐私政策
- 登录：邮箱密码；微信 `code` 换 openid 并绑定账号（需配置 AppID / Secret）
- 数据模型 14 个集合：users、checkins、physio_records、stress_scores、interventions、intervention_logs、kb_entries、qa_sessions、posts、comments、ratings、app_config、assessments、feedback

## 语音朗读（TTS，可选）

量表与页面内容支持「朗读」，走豆包 Seed TTS 2.0 的 **HTTP 单向流式**接口（v3 凭据 `X-Api-Key` + `Resource-Id`）。
客户端不接触密钥：`/api/zz/tts` 由 PocketBase 代理上游，返回 base64 音频分片；H5 走 Blob URL，小程序写本地 mp3 后交给 `InnerAudioContext`。
页面通过 `usePageReadAloud` 声明可读文字，全局朗读层负责合成、播放与停止。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `VOLC_TTS_API_KEY` | 空 | 未配置时页面不显示朗读入口 |
| `VOLC_TTS_RESOURCE_ID` | `seed-tts-2.0` | v3 资源 ID |
| `VOLC_TTS_SPEAKER` | `zh_female_vv_uranus_bigtts` | 音色 |
| `VOLC_TTS_MODEL` | `seed-tts-2.0-standard` | 模型 |
| `VOLC_TTS_SAMPLE_RATE` | `24000` | 采样率 |

```bash
cp .env.example .env
# 填 VOLC_TTS_API_KEY 后重启容器
```

约束与取舍见 [docs/tts-feasibility.md](docs/tts-feasibility.md)：单次文本上限 200 字（客户端约 90 字切分并预取下一段）、服务端按文字 + 音色持久化缓存（命中约 6ms）、实测首段约 2–4 秒、按字符计费。缓存文件在 `pb_data/tts-cache/`，可随时删除。

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

运行时配置复制 `.env.example` 为 `.env`（不进 git）；留空的键对应的功能降级并返回 503，不会崩。

## 部署（Docker + GitHub Actions）

单容器：后端与 H5 产物打进同一个镜像，替换镜像标签即完成发布。

```
main 分支推送      → 自动构建镜像推送到 GHCR（不部署）
Actions 手动触发   → 自动部署：备份 → 切换 → 健康检查 → 失败自动回滚
```

- 镜像：`ghcr.io/fire-disposal/carehaven:sha-<8位>`，单架构 linux/amd64，层缓存走 Actions cache
- CI 相关文件：`Dockerfile`、`.dockerignore`、`docker-compose.yml`、`docker/{entrypoint,deploy,backup}.sh`、`.github/workflows/build-and-deploy.yml`
- 需要的仓库 Secrets：`SSH_HOST`、`SSH_USER`、`SSH_PRIVATE_KEY`、`GHCR_TOKEN`
- 完整步骤、备份与回滚：[docs/deploy.md](docs/deploy.md)

⚠️ 不要起多副本：PocketBase 的定时任务是进程内的，多副本会重复执行。

## 边界与已知问题

- `physio_records.source = "simulated"` 是合成数据，用于演示链路，不是设备采集；汇报与论文必须如实标注。
- 知识问答不是 LLM：只做关键词与 2-gram 检索后拼接原文，检索不到会明确说没找到；接模型的换点在 `pb_hooks/lib/kb.js` 注释里。
- 量表计分与分级阈值（ZBI-12 / PHQ-9 / GAD-7）需经专业确认后才可用于对外结论。
- 没有审核、举报与处置留痕能力，社群一开放就触发 UGC 合规义务；短期只能不开放注册。
- 收集的是情绪、睡眠、照护负担等敏感个人信息：上线前需单独同意、最小必要、境内存储与查询/导出/删除入口。
- README 拿 PocketBase cron 与 Celery Beat 对比，但仓库里没有 `cronAdd`，定时提醒并未实现。
- 数据删除只有接口能力（`remove`），界面没有入口；导出更没有。
- 多副本会重复执行进程内任务，只能单容器；扩容需要先把定时任务挪出进程。
- `app_config` 的写规则只对超级用户开放，普通账号改不了权重与阈值。
- 小程序与 H5 共用同一份后端；H5 同源托管时前端 `TARO_APP_API_BASE` 留空即可。

## 文档索引

- [docs/deploy.md](docs/deploy.md) — 单机部署与运维
- [docs/wechat-onboarding.md](docs/wechat-onboarding.md) — 小程序接入与备案
- [docs/tts-feasibility.md](docs/tts-feasibility.md) — 小程序集成豆包 TTS 的可行性（已验证）
- [docs/emoguard-vs-carehaven.md](docs/emoguard-vs-carehaven.md) — 与前作 EmoGuard 的设计取舍
- [docs/from-zhiyi/](docs/from-zhiyi/) — 迁入的照护知识语料与架构存档
- [docs/icon-license.md](docs/icon-license.md) — 图标许可与生成
- 界面截图：[docs/screenshots](docs/screenshots)
