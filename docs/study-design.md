# 实验组设计与数据可信采集

> 状态：**已实现最小闭环**（2026-11）。平台负责"把实验做对"：分组、盲法、窗口、留痕、按臂导出。
> 模型训练与推理不在平台内，平台只保证**数据可作为分析输入**。

## 1. 要解决的问题

一个能用的 App ≠ 一个可靠的实验数据来源。后者至少需要：

| 问题 | 本系统的做法 |
|---|---|
| 受试者进的是哪一组？ | 入组时按配比分配，写 `study_enrollments`，分配动作写 `study_events` |
| 分配有没有被改过？ | 分配只走服务端；事件表 append-only，含 actor 与当时计数 |
| 受试者知道组别会不会影响行为？ | 研究级 `blinding=arm_hidden`：客户端只显示「已分组」 |
| 评估是否按方案时间点完成？ | 研究 `schedule`（相对入组日的 day + window），导出时计算准时/超窗 |
| 退出后数据还能用吗？ | 状态置 `withdrawn`，记录保留；导出按 ITT 口径，另给完成者口径 |
| 分析时怎么知道每组质量？ | `quality.json` 输出按臂的入组数、退出率、打卡天数均值 |

## 2. 数据模型

| 集合 | 关键字段 | 说明 |
|---|---|---|
| `studies` | code(唯一), title, protocol_version, status(draft/active/closed), opens_at, closes_at, blinding(none/arm_hidden), schedule(json) | 研究主表；由管理员在后台创建 |
| `study_arms` | study, code, label, ratio | 组别与配比；`ratio` 同研究内约成整数比 |
| `study_enrollments` | user, study, arm, assigned_at, method(block/manual), status(active/withdrawn/completed), withdrawn_at, reason | 一个用户一个研究一条（唯一索引） |
| `study_events` | study, user, type(enrolled/withdrawn/completed/arm_revealed/deviation), detail(json), actor | 只读留痕，仅管理员可见 |

`schedule` 示例：

```json
[{ "day": 0, "scales": ["phq9", "gad7", "zbi12"], "window": 3 },
 { "day": 14, "scales": ["phq9"], "window": 2 },
 { "day": 28, "scales": ["phq9", "gad7"], "window": 2 }]
```

## 3. 分配与盲法

- **分配**：选择 `已入组人数 / ratio` 最小的臂，并列时随机；退出**不**从分母移除，因此组间比例始终贴近设计配比。
- **幂等**：同一用户重复入组返回现状，不重复分配。
- **开放期**：`status=active` 且当前时间落在 `opens_at`–`closes_at` 内才接受入组。
- **盲法**：`arm_hidden` 时 `GET /api/zz/study/me` 只返回 `label="已分组"` 与空 `code`；导出保留真实组别。
- **揭盲**：预留 `study_events.type=arm_revealed`，当前由管理员在后台记录（无自动接口）。

## 4. 窗口与依从

- 窗口按 `assigned_at + day` 计算，`window` 为允许天数（前后各 window 天）。
- **准时判定不在客户端**：导出时用 `assessments.created` 与 `due_at` 比对，客户端无法伪造"按时完成"。
- 依从指标：入组后天数、打卡天数、量表次数（`/api/zz/study/me` 实时返回）；导出附按臂均值与退出率。

## 5. 运营手册

1. 管理员在后台创建 `studies`（先 `draft`），配置 `schedule` 与 `blinding`；
2. 创建 `study_arms`（如 `A/B`，ratio 1:1）；
3. 状态改为 `active`，把 `code` 发给受试者；
4. 受试者在「我的 - 研究参与」输入研究码入组；
5. 定期导出（`research/dataset.mjs`）查看 `quality.json.by_arm`；
6. 结题把状态改为 `closed`。

## 6. 验收（已实测）

| 项 | 结果 |
|---|---|
| 入组分配 | 两用户依次入组，按 1:1 落到不同臂；重复入组幂等 |
| 盲法 | `arm_hidden` 下 `/me` 不返回组别代码，只返回「已分组」 |
| 退出 | 状态转 withdrawn 并写事件；`/me` 仍可见历史 |
| 导出 | `studies.csv` / `study_arms.csv` / `study_enrollments.csv`；`quality.json.by_arm` 含退出率与打卡均值 |
| UI | 「我的 - 研究参与」支持研究码入组、分组/入组天数/打卡天数/量表次数、退出 |

## 7. 已知缺口（下一步）

- 分层随机（按站点/年龄）尚未实现，目前是最小化分配的简化版；
- 电子知情同意与协议版本未绑定到入组记录（`research_consents.version` 独立演进）；
- 方案偏离（deviation）只有事件类型，没有录入入口；
- 揭盲与 DSMB 导出没有专用接口，靠后台与离线脚本；
- 无提醒能力：窗口到期依赖用户自行查看（小程序订阅消息未接）。
