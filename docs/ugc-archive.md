# UGC 归档与主线剥离

> 状态：**方案已定，尚未执行**。当前 `main` 仍包含社群页面、`posts`/`comments` 表与相关 hooks。本文是执行清单，不代表已完成。

## 1. 决策

UGC 不长期留在主线靠 feature flag 开关，而是：

- 从当前 `main` 建 `archive/ugc` 分支并打 tag，完整封存代码与历史；
- 主线移除社群入口、页面、API 客户端、点赞/评论 hooks；
- 数据先导出、再下线、最后按保留策略 drop；
- 未来恢复不从归档分支整支 merge，而是按 tag 对照重做，并先补审核能力。

原因：UGC 不只是页面，还带来内容审核、举报处置、实名/留痕、隐私政策与微信社区类目义务。代码留在主线，义务和攻击面就留在主线。

## 2. 分支操作

```bash
# 先确保当前工作区干净
git status

git switch -c archive/ugc
git push -u origin archive/ugc
git tag -a ugc-archive-2026-10 -m "UGC feature before removal from main"
git push origin ugc-archive-2026-10

git switch main
git switch -c chore/remove-ugc
```

归档分支保留、不合并回主线；tag 作为恢复参照。

## 3. 主线拆除清单

| 层 | 动作 |
|---|---|
| 前端入口 | `app.config.ts` 移除 `pages/community/index`；`BottomNav.tsx` 去掉“互助”（5 → 4）；删除 `pages/community/` |
| 前端 API | `lib/api.ts` 删除 `Post`/`Comment` 类型、`posts`/`createPost`/`likePost`/`comments`/`createComment`；保留 `ratings`（干预评分） |
| 文案 | `about` 去掉“互助社区”；`agreement` 去掉社区内容、发帖/评论数据、匿名说明；`profile` 反馈描述改“问题、建议与内容纠错”；`feedback` 去掉“违规举报”或改“内容纠错” |
| 后端路由 | `pb_hooks/zhihu.pb.js` 删除 `POST /api/zz/posts/{id}/like`、评论计数 hooks |
| 数据规则 | 新迁移把 `posts`/`comments` 的 list/view/create/update/delete 全部设为 `null` |
| 种子数据 | 不改历史迁移；新增迁移清理 seed 写入的帖子/评论 |
| 文档 | README 功能列表、集合数（14 → 12）、合规边界；`wechat-onboarding.md` 去掉社区类目；`emoguard-vs-carehaven.md` 标注归档 |
| 截图 | 移除或标注 `docs/screenshots/04-社群互助.png` 为归档态 |

`ratings` 不是 UGC：`target` 是 `intervention/app`，继续保留。

## 4. 数据与迁移

分两步，避免一上来不可逆：

1. **下线（可逆）**：`1730000500_disable_ugc.js` 把 `posts`/`comments` 的 API 规则设为 `null`；前端入口移除。
2. **清理（不可逆）**：导出 `posts`、`comments` 为 JSON/CSV（含用户关联、时间、内容），加密存仓库外；确认备份保留策略后，用迁移 `delete` 两个 collection。

老备份仍可能含 UGC 数据；隐私政策与留存期限要同步，用户要求删除时按策略处理备份。

## 5. 验证

```bash
rg -n "pages/community|/api/zz/posts|collections/posts|collections/comments|互助社区|发帖" \
  miniapp/src pb_hooks pb_migrations README.md docs

cd miniapp && bun run typecheck && bun run build:h5 && bun run build:weapp
```

- 底部导航只剩 4 项；
- `/api/collections/posts/records` 返回 403/404；
- `/api/zz/posts/:id/like` 返回 404；
- 新装库跑完迁移后没有 `posts`/`comments`（或规则全关）；
- 旧分享链接行为明确（404 或不带 UGC 的“功能已关闭”页）。

## 6. 风险

- 删表不可逆；先导出，再保留至少一个备份周期。
- 旧客户端仍可能请求社区接口；接口下线要返回明确错误。
- 微信类目：移除 UGC 后不再需要社区/论坛类目与审核能力说明，备案材料同步改。
- 未来恢复：不要整支 merge `archive/ugc`，会带回旧 schema 与旧合规面。
