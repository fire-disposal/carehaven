# 从 zhiyi-tongxing 迁入的存档

| 项目 | 内容 |
| --- | --- |
| 来源仓库 | `fire-disposal/zhiyi-tongxing`（private，已归档） |
| 来源提交 | `ea1027b`（`docs: rewrite README around essence and selection`） |
| 迁移日期 | 2026-10-18 |
| 来源状态 | GitHub archived（只读，private）；内容已迁入本仓库 |

## 为什么搬

`zhiyi-tongxing`（智忆同行）是失智症居家照护者支持系统的早期原型：Bun/Elysia + Drizzle + Vue/微信小程序。
项目已决定把 `carehaven`（PocketBase + Taro）作为唯一在研路径，zhiyi 随后只保留为归档仓库。
归档前把仍然有价值的两类内容搬进来，避免随仓库一起沉没：

1. **知识语料**：WHO iSupport 本土化整理的 36 个失智症照护图谱节点与 33 条关系，可直接充当 carehaven 知识库条目；
2. **设计判断**：可行性分析与架构文档里关于技术选型、CI/CD 简化、可替换接缝、风险取舍的推理过程。

## 搬了什么

- `FEASIBILITY.md`：可行路径分析原文，仅在顶部加来源说明。
- `ARCHITECTURE.md`：系统架构说明原文，仅在顶部加来源说明。
- `knowledge-graph.json`：`seed.ts` 中 `NODES` / `EXTRA_NODES` / `EDGES` 的原样导出（36 节点 / 33 边），作为语料出处。
- 语料落地：`pb_migrations/1730000300_import_zhiyi_kb.js`
  - 36 个节点全部导入 `kb_entries`，`title` = 节点 label，`content` = 节点 desc；
  - `category` 收编到 carehaven 既有的五个分类（行为应对 / 情绪调适 / 日常照护 / 沟通技巧 / 自我关怀）；
  - `keywords` 覆盖 label、zhiyi `server/domain/graph.ts` 的 `ALIASES` 别名与描述中的关键名词，供 `pb_hooks/lib/kb.js` 的关键词 + 2-gram 检索；
  - `source` 统一写 `zhiyi-tongxing@ea1027b（已归档）`，下行迁移按该前缀删除；
  - 按 `title` 幂等：与 carehaven 原有 14 条 iSupport 条目无同名冲突，重复执行时全部跳过。

## 没搬什么

- **代码**：`server/`（Elysia/Bun API）、`db/` 与 `drizzle/`（Drizzle schema/迁移）、`web/`（Vue 管理台）、`miniprogram/`（微信原生 TS 小程序）、`firmware/`（ESP-IDF）、`deploy/` 与 GitHub Actions。
- **其他文档**：`DEPLOYMENT.md`、`MINIPROGRAM.md`、`SETUP.md` 与 zhiyi 的部署拓扑强绑定，未搬。
- **演示数据**：社群种子帖、演示用户、14 天压力趋势等只服务 zhiyi 演示，未搬。
- **运行方式**：zhiyi 的 Bun + SQLite + Drizzle 栈与 carehaven 的 PocketBase 栈不兼容，迁移只取内容，不引新依赖。

## 阅读提示

两份原文中的相对链接（如 `DEPLOYMENT.md`、`MINIPROGRAM.md`、`../../scripts/`）指向未搬迁的 zhiyi 文件，在 carehaven 中会失效；
需要时请到归档仓库的对应 commit 查看。文中提到的 Elysia/Drizzle/Neo4j 方案属于 zhiyi 的设计记录，不代表 carehaven 的现状。

## 与现有知识库的关系

carehaven 原有 14 条 WHO iSupport 本土化条目（偏「问题 → 具体做法」的长文），本次迁入的是图谱节点（偏「概念 → 简短定义 / 应对要点」）。
两者主题相邻但粒度不同；个别条目存在近义覆盖（如原有《喘息服务与外部资源》与新增《喘息服务》），保留两条以便图谱式短答与长文并存。
