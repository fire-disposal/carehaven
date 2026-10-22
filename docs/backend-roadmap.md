# 后端基础与数据治理路线

> 状态：P0 尚未全部完成。当前 PocketBase + SQLite 单容器可支撑 pilot，但不满足真实用户数据、研究导出与审计要求。本文只列工作与验收，不代替实现。

## 1. P0：接真实用户前必须完成

| 工作 | 现状 | 验收 |
|---|---|---|
| 写入入口收口 | `checkins`/`physio_records` 由客户端直接写，`source`/`date` 可伪造 | 打卡、生理、设备上报各走服务端路由；服务端写 `received_at`、`source`、`device_id`；设备入口用 token |
| 评分快照 | `stress_scores` 只有结果；同日 upsert 覆盖 | `algorithm_version`、`params`、`coverage`、`quality`、`computed_at`；新增 append-only `stress_score_events` |
| 缺失语义 | 缺生理写 0；context 永远入模 | 分量可空；`coverage` 标明缺失；数据不足不返回分层颜色 |
| 配置治理 | `app_config` 无校验/历史 | 校验 Σw=1、0≤w≤1、阈值有序；`app_config_history` 记录作者/理由/生效时间 |
| 角色与审计 | 只有 PB superuser | `role`/`cohort`/`org`；`audit_logs` 记录操作者、前后值、IP/UA；研究导出、内容审核、配置修改分权 |
| 数据权利 | 无导出/删除/注销接口 | `GET /api/zz/account/export`、`POST /api/zz/account/delete`；`research_consents` 记录版本/范围/撤回 |
| UGC 边界 | 社群可发帖，无审核队列 | 按 [ugc-archive.md](ugc-archive.md) 归档并剥离，或补齐举报→处置→留痕；能力未就绪就关闭 |
| 限流与成本 | `/api/zz/ask`、`/api/zz/tts` 无配额 | 用户/IP 限流；TTS 日配额；异常调用告警；降级到本地 KB |
| 测试与 CI | CI 只有 `tsc` | 评分/量表单测、迁移 up/down、API 冒烟（登录→打卡→评分→量表→反馈） |

## 2. P1：研究与运营就绪

| 工作 | 内容 |
|---|---|
| 研究数据管道 | `research_id`/`cohort`；HMAC 化用户 ID；排除 `note`/社区/TTS 文本与 `simulated`/demo；数据字典 + manifest + 数据集版本 |
| 量表锚定 | `assessments` 与 `stress_scores` 按用户+日期关联；支持 baseline/每周窗口查询 |
| 影子评分 | 候选权重/阈值离线回放或写 `stress_scores_shadow`，不影响线上展示 |
| 异步评分 | 写入只落事件，评分异步重算；避免在写入 hook 里同步查多表 |
| 内容后台 | KB/干预方案从迁移脚本改为后台 CRUD + 版本；发布前审核；检索命中日志用于评估 |
| 反馈队列 | 反馈状态流转、分类 SLA、管理员回复；举报与反馈分开统计 |
| 提醒任务 | 站内提醒先行；微信订阅消息需模板、逐次授权、发送记录；任务幂等、可补跑 |
| 可观测性 | 结构化日志 + request id；错误追踪；受保护的 metrics；告警：5xx、DB 大小、备份失败、TTS 支出、红线事件 |
| 备份恢复 | 恢复演练、备份加密、恢复后一致性校验 |
| 索引 | `checkins(user,date)`、`physio_records(user,date)`、`stress_scores(user,date)`、`assessments(user,created)`、`intervention_logs(user,completed_at)`、`qa_sessions(user,created)`；`stress_scores` 用户+日唯一索引 |

## 3. 目标数据模型

- `stress_score_events`：append-only 评分事件（hps、三分量、params、coverage、computed_at、trigger）。
- `app_config_history`：配置变更（key、value、author、reason、effective_from）。
- `research_consents`：研究同意（user、version、scope、granted_at、withdrawn_at）。
- `audit_logs`：管理员/审核/导出/配置操作。
- `moderation_reports` / `moderation_actions`：举报与处置留痕（若保留 UGC）。
- `device_registry` / `device_tokens`：设备上报鉴权与轮换。
- `qa_sessions` 扩展：`model`、`prompt_version`、`tokens`、`latency`、`tool_calls`、`safety_flag`、`conversation_id`。

历史迁移不改；新增迁移做表结构与规则变更。删除表属于不可逆操作，先导出并保留至少一个备份周期。

## 4. API 轮廓

| 接口 | 用途 |
|---|---|
| `POST /api/zz/checkins` | 服务端校验并写入打卡，返回当日 HPS |
| `POST /api/zz/physio/manual` | 手动录入生理数据 |
| `POST /api/zz/physio/device` | 设备上报（token 鉴权） |
| `GET /api/zz/scores?from=&to=` | 评分历史（含 coverage/params） |
| `GET /api/zz/account/export` | 用户数据导出 |
| `POST /api/zz/account/delete` | 注销/删除请求 |
| `POST /api/zz/ask` | 现有检索式问答；可选接 LLM，见 [ai-agent.md](ai-agent.md) |
| `POST /api/zz/feedback` | 反馈；增加状态流转接口 |
| `POST /api/zz/admin/config` | 管理员改权重/阈值（校验 + 审计） |

## 5. 非目标

- 现在不换 Postgres、不上微服务、不拆多副本；pilot 阶段 SQLite + 单容器足够。
- 现在不把评分放进消息队列；先保证写入收口与快照，数据量上来再异步化。
- 现在不做实时流式评分；HPS 是日级快照。

## 6. 验收顺序

1. 评分可回放 + 缺失语义 + 配置治理。
2. 写入收口 + 设备来源可信 + 模拟数据隔离。
3. 角色/审计 + 用户导出/删除 + 研究同意。
4. UGC 归档（或审核闭环）。
5. 限流/成本/可观测性 + 测试进 CI。
6. 再启动 HPS 研究 pilot 与 AI agent 试点。
