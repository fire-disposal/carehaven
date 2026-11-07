# 科研工具

> 状态：可用（2026-11）。三个脚本都在仓库里，直接 `bun` 运行；不依赖 PocketBase 在跑（回放与数据集构建只读 SQLite）。

## 脚本

| 脚本 | 用途 | 依赖 |
|---|---|---|
| `research/seed.mjs` | 通过真实接口造一小组样本（注册 → 研究同意 → 打卡 → 生理 → 互助） | 运行中的 PocketBase |
| `research/replay.mjs` | 用「原始数据 + 事件里的参数快照」重算历史分数，逐条与库内比对 | 只读 `data.db` |
| `research/dataset.mjs` | 产出 HMAC 去标识的 CSV + `quality.json` + `manifest.json` | 只读 `data.db`，需 `RESEARCH_HMAC_SECRET` |
| `research/hps-core.js` | 评分内核的纯函数副本（与 `pb_hooks/lib/hps.js` 的 `hps-2` 同义） | 无 |

## 典型流程

```bash
# 1. 起一个空实例（不要 SEED_DEMO）
./pocketbase serve --http=127.0.0.1:8196 --dir /tmp/pb-dev \
  --migrationsDir=pb_migrations --hooksDir=pb_hooks

# 2. 造样本（date 由服务端取当前时间，不能造历史日期；--rounds 是同一天的多轮打卡）
bun research/seed.mjs --base http://127.0.0.1:8196 --users 3 --rounds 2

# 3. 回放：分数必须能由数据复算
bun research/replay.mjs --db /tmp/pb-dev/data.db --verbose

# 4. 出数据集
RESEARCH_HMAC_SECRET=dev-secret \
  bun research/dataset.mjs --db /tmp/pb-dev/data.db --out research/out/dev
```

退出码：`replay` 0 = 全部一致，1 = 存在不一致（先别用这批分数写材料），2 = 无法运行。

## 回放在验什么

两项独立校验，职责不同：

| 校验 | 用什么 | 容差 | 失败含义 |
|---|---|---|---|
| A 算术一致 | 事件里记录的分量 + `params` 按权重相加 | 0.11（分量落库保留 1 位小数） | 分数与自己的参数/分量对不上，属实现 bug |
| B 输入可复现 | 事件写入当刻之前的原始数据（打卡/生理/干预/问答）重算整条分数 | 0.05 | 同样的输入算不出同样的结果 |

`B` 会严格按 `created < 事件.created` 取数。若事件与数据的写入落在**同一毫秒**（脚本化写入常见），
重算会看到事件之后才落库的数据，覆盖度随之不同——这类归为 `timing`，单独提示、不计失败；
覆盖度相同却对不上才算真不一致。

旧版本事件（`algorithm_version` 不同）只统计、不判定——当前只核对 `hps-3` 事件，`hps-2` 及更早仅计数。

结论怎么写：A 与 B 都通过时，可以说「任意历史分数 = f(原始数据, 当年参数)，可复现」。

## 数据集默认排除什么

- 未在 `research_consents` 中同意、或已撤回的用户；
- `demo@zz.local` 一类演示账号；
- `physio_records.source = 'simulated'` 的合成生理数据；
- 所有自由文本：`checkins.note`、`qa_sessions.question/answer`、`whispers.text/terms`
  （确需文本时加 `--include-text`，前提是该批数据已单独取得文本同意）。

用户 ID 用 `HMAC-SHA256(user_id, RESEARCH_HMAC_SECRET)` 取前 16 位，同一密钥下可跨批次关联，换密钥即断开。

## manifest 里有什么

`generated_at`、`git_commit`、数据库路径、去标识算法、排除统计、`algorithm_versions`、
参数快照指纹（每份不同参数一个 sha256 前缀）、迁移清单、每个 CSV 的行数与 sha256。

引用数据时连 manifest 一起归档：它是「这批数据到底是什么」的唯一凭据。

## 已知限制

- 事件只在「当日重算」时产生：补录历史日期的打卡不会补出那天的历史事件（这是日级快照的设计，不是 bug）。
- 同一毫秒内的数据与事件无法用时间戳排序，回放只能归类为 timing；脚本化造数时建议每条记录间隔几十毫秒。
- 回放只校验 `hps` 与 `level`，不校验 `advice` 文案（文案随版本变化）。
- 数据量按 pilot 设计（单文件 SQLite、全表读入内存）；样本过万再考虑分页导出。
