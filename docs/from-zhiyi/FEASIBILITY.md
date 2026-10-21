> 来源：[zhiyi-tongxing](https://github.com/fire-disposal/zhiyi-tongxing) @ `ea1027b`（已归档，2026-10-18 迁入 carehaven 存档）。本文为原文保留，所述 Elysia / Vue / 小程序架构是 zhiyi 当时的方案，并非 carehaven（PocketBase + Taro）的现状。

# 智忆同行 · 可行路径分析（2026-08）

> 目标：复用 `emoguard_project` 小程序端经验 + 师承 `另一项目` 的 CI/CD，
> 在既有 Elysia 骨架 `zhiyi-tongxing` 上继续推进：补全后端 → 微信小程序（现代 TS 方案）→ 单一服务器流水线。

## 1. 结论摘要

| 决策点 | 选择 | 依据 |
| --- | --- | --- |
| 后端框架 | **Elysia（Bun）**，维持骨架现状 | 骨架已按 Elysia + Drizzle + bun:sqlite 搭好；Bun 原生、端到端类型推导、内置 OpenAPI |
| 小程序方案 | **微信原生 + TypeScript**（最终形态） | 复用 emoguard 原生经验；Web 端收敛为管理后台，不引入 Taro/uni-app 跨端框架 |
| CI/CD | **单服务器**（无 staging/prod 双环境） | 课题原型规模；师承其流程但砍掉 staging 门禁与监控栈 |
| 认证 | wx.login → code2session → JWT（access+refresh） | 与 emoguard 完全同构，Elysia 侧用 @elysiajs/jwt 重写 |

## 2. emoguard 小程序经验 → 复用映射

emoguard（Django + 微信原生 JS）经验沉淀为四层，全部在 `miniprogram/` 中 TS 化落地：

| emoguard 资产 | 经验点 | zhiyi-tongxing 落地 |
| --- | --- | --- |
| `utils/request.js` | 401 单飞刷新（锁/队列）、网络静默重试、自动带 token | `miniprogram/utils/request.ts`（TS + 泛型） |
| `utils/authCenter.js` | token 唯一可信源、登录态管理、熔断 | `miniprogram/utils/auth.ts` + `utils/storage.ts` |
| `config/token_views.py` + `jwt_auth_adapter.py` | 后端签发/轮换令牌契约 | `server/auth.ts`（Elysia 版：wx-login / refresh / me） |
| `app.json` 多页签 + 页面结构 | tabBar 导航、页面职责划分 | 5 页签（首页/压力/问答/社群/我的），小程序为唯一用户产品面 |

> emoguard 与 zhiyi 的业务差异：emoguard 是情绪记录小程序（多量表/报告），
> zhiyi 是照护者压力监测 + 知识图谱问答。复用的是**工程模式**而非业务代码。

## 3. 后端补全（本阶段完成）

骨架原缺三块，已补齐并验证：

1. **依赖缺失**：`elysia` / `drizzle-orm` / `@elysiajs/jwt` / `typescript` / `vue` / `vite` / `@vitejs/plugin-vue` 未声明 → 已 `bun add`，`bun run typecheck` 全绿。
2. **认证链路**：`server/auth.ts` 新增
   - `POST /api/auth/wx-login`（code2session；未配微信凭据时开发 mock，`openid=dev_<code>`，本地零配置联调）
   - `POST /api/auth/refresh`（轮换）、`GET /api/auth/me`
   - 用户主键即 openid，无表结构变更；`requireAuth` 派生守卫供后续业务端点接入
3. **小程序端**：原生 TS 五页签 + 走纸图表签名组件，全部接口走类型化 `api/` 客户端；Web 端同步收敛为纯管理后台（用户端代码已从 web/ 移除）。

## 4. CI/CD：师承另一项目的简化映射

另一项目共 5 个 workflow（commit-format / ci 类 / staging / production / rollback）。
简化策略：**只保留「打 tag → 构建 → 单机部署」一条主干**，去掉 staging 门禁、双服务器、监控栈、nginx 配置管理。

| 另一项目步骤 | 简化后（zhiyi） |
| --- | --- |
| `deploy-staging.yml`：tag 触发，校验迁移 → 构建双镜像 → 部署 staging | `deploy.yml`：tag 触发，typecheck+构建单镜像 → 直部署生产 |
| `deploy-production.yml`：dispatch，要求版本与 staging 完全一致 | 去掉「必须先在 staging 验证」门禁，dispatch 直发（输入版本号回查对应 tag） |
| 双 compose（staging/prod）+ 双服务器 | 单 `deploy/docker-compose.prod.yml`，`/opt/zhiyi-tongxing` |
| alembic 迁移链校验 | Drizzle 迁移自动应用（启动时 `runMigrations`），不做链校验 |
| 数据库 pg_dump 备份 + alembic downgrade 回滚 | SQLite 文件级备份（卷内 backups/）+ 镜像回滚 + 备份恢复（`rollback.sh`） |
| monitor.py / 日报周报 / nginx 配置下发 | 移除（原型阶段不引入） |
| DingTalk 通知 | 保留（`DINGTALK_WEBHOOK` 未配置自动跳过） |

**部署拓扑（单服务器）**：

```
GitHub tag v* ──► deploy.yml
                    ├─ typecheck + build:web（构建门禁）
                    ├─ docker buildx → ghcr.io/<owner>/zhiyi-tongxing:<版本>
                    └─ SSH 单服务器
                        ├─ 备份 SQLite（容器内 cp → backups/）
                        ├─ IMAGE_VERSION=<版本> compose pull（重试×3）
                        ├─ compose up -d（重启策略 unless-stopped）
                        ├─ 健康检查循环（30×2s，失败自动回滚旧镜像+恢复备份）
                        └─ .version-history 记录 + 镜像清理（留 5 版缓冲）
```

**服务器前置**（首次部署）：`/opt/zhiyi-tongxing/.env` 写入 `ADMIN_PASSWORD`、`JWT_SECRET`、`WECHAT_APPID`、`WECHAT_SECRET`；`SSH_HOST/SSH_USER/SSH_PRIVATE_KEY` 配置为仓库 Secrets；放行 3000 端口（或前置 Nginx 反代 + HTTPS）。

## 5. 风险与取舍

| 取舍 | 说明 |
| --- | --- |
| JWT 无状态轮换，旧 refresh 到期前仍可用 | 无黑名单；课题原型可接受，生产需引入撤销存储 |
| SQLite 文件备份非强一致 | 部署窗口极短，单容器场景足够；Postgres 化后换 pg_dump（compose 已预留） |
| 单服务器无回滚演练 | `deploy/rollback.sh` 已落地可手动演练；原型阶段不再扩展 |
| 小程序无自动化测试 | 微信生态无法在 CI 跑真机；以 `typecheck:mp` + DevTools 手工验证兜底 |

## 6. 后续路线

1. 业务端点接入 `requireAuth`（发帖/评估记名）；小程序端同步登录态
2. 小程序体验版/正式版发布 + 服务器域名校验（`docs/MINIPROGRAM.md`）
3. 知识图谱 Neo4j 化 / Postgres 化（架构文档已预留）
4. 反馈数据驱动的 HPS 权重校准脚本（`scripts/analyze.py` 已有导出）
