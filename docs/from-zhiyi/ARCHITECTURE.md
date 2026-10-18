> 来源：[zhiyi-tongxing](https://github.com/fire-disposal/zhiyi-tongxing) @ `ea1027b`（已归档，2026-10-18 迁入 carehaven 存档）。本文为原文保留，所述 Elysia / Vue / 小程序架构是 zhiyi 当时的方案，并非 carehaven（PocketBase + Taro）的现状。

# 智忆同行 · 系统架构说明

> 本文档描述《智忆同行：基于 AI 与知识图谱的失智症居家照护者实时情绪监测与支持系统》原型的整体架构。

## 1. 总体架构

```
┌─────────────────────────────────────────────────────────────┐
│  客户端（小程序 / Web 管理台）                    │
│   微信小程序（原生 TS，五页签）· Web 管理后台（Vue+Element Plus）│
└──────────────────────────┬──────────────────────────────────┘
                           │ REST + JSON（fetch / /api/*）
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                      Elysia API 层（Bun）                     │
│  ┌──────────┬──────────┬───────────┬──────────┬───────────┐ │
│  │ ① 压力监测 │ ② 分层干预 │ ③ 照护支持  │ ④ 智能反馈 │  社群/用户  │ │
│  │  /evaluate│ /interv..│  /qa      │ /feedback│ /community│ │
│  └──────────┴──────────┴───────────┴──────────┴───────────┘ │
│   TypeBox 请求校验 · Swagger/OpenAPI · onError 统一处理       │
└──────────────────────────┬──────────────────────────────────┘
                           │ Drizzle ORM（类型安全查询）
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                       SQLite（bun:sqlite）                    │
│  users · stress_log · interventions_log · feedback           │
│  posts · replies · kg_nodes · kg_edges（知识图谱三元组）       │
└─────────────────────────────────────────────────────────────┘
```

## 2. 分层设计

| 层 | 目录 | 职责 | 依赖方向 |
| --- | --- | --- | --- |
| 表现层 | `web/` | Vue 3 组件、页面交互、fetch 调用 | → API |
| API 层 | `server/index.ts` | Elysia 路由、参数校验、响应组装 | → 领域层 + 数据层 |
| 领域层 | `server/domain/` | 纯业务逻辑（算法内核、生理数据源、干预推荐、图谱问答） | → 类型（`types.ts`），不依赖 HTTP/存储 |
| 数据层 | `db/` | Drizzle schema / client / migrate | → SQLite |

领域层为**纯函数 + 接口注入**设计（`GraphStore` 接口），便于单测与替换存储实现。

### 2.1 可替换性接缝（面向未知未来接入）

两个开放接缝，均通过环境变量切换、注册表 + 接口注入实现：

| 接缝 | 模块 | 切换变量 | 接入方式 |
| --- | --- | --- | --- |
| 压力评估算法 | `server/domain/algorithm.ts` | `STRESS_ALGORITHM` | 实现 `StressAlgorithm`，启动时 `register()` |
| 生理数据源（可穿戴） | `server/domain/physio.ts` | `PHYSIO_PROVIDERS` | 实现 `PhysioProvider`，`registerProviderFactory()` 或内置工厂 |

- **算法内核**：默认 `HpsStressAlgorithm`（经典 HPS）；结果携带 `algorithm{id,version,name}` 溯源字段。未来 ML 模型实现 `StressAlgorithm` 注册即可，未知/未配置 id 自动回退默认。
- **生理数据源**：`/api/evaluate` 解析优先级 —— 请求体显式上报 > 已启用适配器按注册序拉取 > `DEFAULT_PHYSIO` 演示回退值。内置 `stored`（读取设备上报存储）与 `mock`（模拟设备，含离线断连场景）；自建设备/第三方设备经 `POST /api/physio/report`（可选 `DEVICE_REPORT_TOKEN` 令牌）上报，写入 `physio_readings` 表；外部设备（华为/小米/Apple Health 等）实现 `PhysioProvider` 后经 `PHYSIO_PROVIDERS` 启用。自建设备固件见 `firmware/`（ESP-IDF）。
- 运维自检：`GET /api/physio/providers`（已启用数据源）、`GET /api/algorithm`（当前算法与注册表）。

## 3. 核心模型

### 3.1 混合压力指数 HPS

```
HPS = w1·S_physio + w2·S_psych + w3·S_context        （w1+w2+w3 = 1）
S_physio  = f(HRV-RMSSD, GSR, 睡眠时长)    → 0-100   （生理）
S_psych   = f(心情打卡 1-5, 主观量表 0-100) → 0-100   （心理）
S_context = f(照护时长, 求助频率, 干预次数)  → 0-100   （上下文）

分层：HPS < tGreen(40) → 🟢 绿；tGreen ≤ HPS < tRed(70) → 🟡 黄；HPS ≥ tRed → 🔴 红
```

- 默认权重 `0.5 / 0.35 / 0.15`、阈值 `40 / 70`，均为 `evaluateStress()` 可注入参数
- 权重与阈值按申请书"专家指导 + 机器学习动态可调"预留（`feedback` 表持续积累训练数据）
- 评估入口经 `StressAlgorithm` 接口调用，可整体替换（见 2.1 接缝）

### 3.2 知识图谱（实体-关系-实体）

- **存储**：`kg_nodes`（实体）+ `kg_edges`（三元组边），Drizzle/SQLite 实现，`GraphStore` 接口可切换 Neo4j
- **构建**：自顶向下 —— 本体层（术语/关系类型）→ 实例层（三元组填充），种子含 36 节点 / 33 边
- **问答**：问题 → 节点命中（label 匹配 + 中文别名表）→ 沿「应对策略/缓解/途径」等关系收集建议 → 组装回答
- **内容来源**：WHO iSupport 本土化（游走/攻击/幻觉/重复提问/睡眠紊乱等行为症状及应对策略）

### 3.3 数据流闭环（监测—干预—支持—反馈）

```
可穿戴设备 + 心情打卡 ──► /api/evaluate ──► HPS + 三色分层 ──► 推送干预方案
                                                              │
  反馈评分 + HPS 前后差值 ◄── /api/feedback ◄── 干预完成记录 ──┘
        │
        └──► feedback 表 ──► 趋势/报告（我的页） + 模型再训练数据
```

## 4. 请求/响应约定

- 全部端点返回 JSON；错误统一由 `onError` 处理：校验失败 `400`、服务器错误 `500`，体为 `{ "error": "..." }`
- 校验：Elysia + TypeBox（如 `/api/feedback` 的 `rating` 限定 1-5 整数）
- API 文档：`GET /swagger`（Swagger UI）、`GET /swagger/json`（OpenAPI 3）

## 5. 部署拓扑

| 模式 | 前端 | 后端 | 说明 |
| --- | --- | --- | --- |
| 本地开发 | Vite :5173 | bun :3000 | Vite 代理 `/api` → 3000，热更新 |
| 生产（裸机） | `web/dist` 静态产物 | bun :3000 | Elysia 兜底路由托管前端 |
| Docker | 多阶段构建产物 | bun 容器 :3000 | 单容器，SQLite 卷持久化 |

详见 [DEPLOYMENT.md](./DEPLOYMENT.md)。

## 6. 扩展方向

1. **PostgreSQL**：Drizzle schema 换 `pg-core` 方言 + `postgres-js` 驱动，`docker-compose.yml` 已预留服务块
2. **Neo4j**：实现 `GraphStore` 的 Neo4j 适配器，问答质量升级（Cypher 语义检索）
3. **语音交互**：`/api/qa` 已支持文本，前端接入 Web Speech API / 微信录音 + ASR
4. **模型迭代**：基于 `feedback` 表实现强化学习权重/阈值校准脚本（`scripts/analyze.py` 已提供数据导出）
5. **小程序端**：产品最终形态为原生微信小程序；如需 H5/App 再做跨端框架评估（当前不引入）
