# 视觉方向：纸本 · 松烟

> 状态：2026-10 选定并落地第一批页面。适用 `miniapp`（H5 与微信小程序共用）。

## 1. 方向：暖中性，而不是“纸本”

视觉基调是**暖中性 + 清晰层级**：浅暖底色、墨色文字、一种主色、发丝线与近直角。
“纸本 · 松烟”是这套方向最早的比喻，用来帮助定色调和排版节奏；它**不是硬约束**——
不需要到处出现衬线、边框、阴影去暗示纸张，也不该为了“像纸”牺牲可读性或现代界面的利落。

因此：

- **近直角**：卡片 0–8rpx，按钮 4rpx，标签 2rpx。靠留白、字重、发丝线建立秩序。
- **浅暖底**：降低白底刺眼感，长时间阅读更稳；桌面端不模拟“纸放在桌上”，内容栏与页面同底色。
- **一道栏线**：栏目头用 6rpx 竖线标记，像印刷品的栏目标记，替代彩色图标底。
- **衬线只在少数位置**：HPS 这类大数字可以保留衬线作为对比；品牌名、标题、正文都用无衬线，避免“印刷品”腔调压过内容。
- **不投影**：层级靠底色差与 1rpx 线，不靠阴影。

## 2. 色板

| Token | 值 | 用途 | 对比度 |
|---|---|---|---|
| `$c-paper` | `#F4EFE5` | 页面底色 | — |
| `$c-surface` | `#FFFCF6` | 卡片/浮层 | — |
| `$c-ink` | `#1E2421` | 主文字 | 13.8:1 on paper |
| `$c-ink-2` | `#44504A` | 次级文字 | 8.2:1 on paper |
| `$c-muted` | `#626B65` | 辅助文字 | 4.8:1 on paper |
| `$c-line` | `#DED5C5` | 发丝线 | — |
| `$c-primary` | `#1F5A50` | 主色/主按钮 | 6.9:1 on paper |
| `$c-primary-dark` | `#16443C` | 主色文字/印章 | 9.4:1 on paper |
| `$c-primary-light` | `#E4EDE7` | 选中态/浅底 | — |
| `$c-accent` | `#9C4833` | 极少数强调（柿红） | 5.4:1 on paper |
| `$c-green` | `#2C6A4E` | 平稳 | 5.5:1 on its bg |
| `$c-yellow` | `#7A5310` | 预警 | 5.7:1 on its bg |
| `$c-red` | `#963B33` | 偏高 | 5.7:1 on its bg |
| `$c-info` | `#3D5A6C` | 信息 | 5.6:1 on its bg |

压力分层只改变**顶部 6rpx 线、数字颜色、状态标签**，不再整卡铺满黄/红——避免把“提醒”做成“警报”。

## 3. 字体

```scss
$font-sans: -apple-system, 'PingFang SC', 'Hiragino Sans GB',
  'Noto Sans CJK SC', 'Source Han Sans SC', 'Microsoft YaHei', sans-serif;
$font-serif: 'Songti SC', 'STSong', 'Noto Serif CJK SC', 'Source Han Serif SC', serif;
$font-num: Georgia, 'Times New Roman', 'Songti SC', 'Noto Serif CJK SC', serif;
```

- 正文 32rpx / 行高 1.65；辅助 24–28rpx；标签 22rpx + 2rpx 字距。
- 标题 36–48rpx，字重 600；不追加大字号标题。
- HPS 数字 112rpx，衬线 + `tabular-nums`，避免数值跳动。
- 不下载网络中文字体：包体与首屏都不合适；Android 无衬线时回退系统黑体可接受。

## 4. 形状与间距

| 项 | 值 |
|---|---|
| 卡片圆角 | `$radius` 6rpx（大卡 `$radius-lg` 8rpx） |
| 按钮圆角 | `$radius-sm` 4rpx |
| 标签圆角 | `$radius-xs` 2rpx |
| 输入框圆角 | `$radius-sm` 4rpx |
| 间距 | 8 / 16 / 24 / 32 / 48 / 64 / 80rpx |
| 触控高度 | ≥88rpx |
| 边框 | 统一 1rpx 发丝线 |
| 阴影 | 无（浮层除外） |

## 5. 组件基座

`miniapp/src/components/ui/`：

| 组件 | 用途 |
|---|---|
| `PageHead` | 页头三槽：eyebrow / title / note；`variant="brand"` 只给登录与关于 |
| `TopBar` | 次级页置顶栏，88rpx 返回键，替代四份复制 |
| `SectionHeader` | 栏线 + 标题 + 可选 eyebrow/action |
| `Card` | `plain` / `quiet` / `tint`，`flush` 去内边距 |
| `StateBlock` | 统一三态：`loading` 骨架 / `empty` / `error`（带重试） |
| `Button` | `primary` / `secondary` / `ghost` / `danger`，`block`、`loading` |
| `Stat` | 标签 + 衬线数字 + 单位 |
| `Pill` | `green` / `yellow` / `red` / `primary` / `quiet` 状态标签 |
| `StarRating` | 1–5 星，radiogroup 语义，选中态不只靠颜色 |

页面优先用组件，不再复制 `.btn-primary` / `.card` 的样式。颜色在 TS 侧统一走 `src/lib/theme.ts`（Slider 等只接受字符串的组件）。

## 6. 页面规则

1. 一屏一个主行动：首页主按钮只保留“记录此刻/再记一次”。
2. 栏目头不超过两级：`eyebrow` 小标签 + 标题；不要连续三个同级标题。
3. 卡片内不再套卡片；列表用发丝线分隔，不用每行一个白卡。
4. 状态色只用于状态，不用于装饰；一屏最多一个状态色块。
5. 图标用 24–36rpx，默认继承当前文字色；不放大面积彩色图标底。
6. 空态、错误态用文字 + 一个动作，不画插画占位。

## 6.1 可访问性底线（2026-11）

- **触控**：所有可点区域 ≥88rpx（`@include tap`）；次级页返回键也是 88rpx，不用圆形。
- **语义**：可点 `View` 带 `ariaRole` + `ariaLabel`；评分/心情/回应用 `radio`/`radiogroup` + `ariaChecked`。
- **状态播报**：`StateBlock` 用 `role="status"` / `role="alert"`，错误可被读屏立即播报。
- **焦点**：全局 `:focus-visible` 2rpx 松烟绿描边（H5），不用浏览器默认蓝。
- **动效**：全局 `prefers-reduced-motion: reduce` 关闭过渡与骨架呼吸；骨架改用静态色块。
- **字号**：正文最低 `$fs-body`（32rpx），长文（协议/关于）同样不降；标签最低 `$fs-label`（22rpx）。
- **颜色**：状态永不只用颜色表达，配合文字/字重/图标。

## 6.2 文案与文档内容层

所有对外文字只有一处真源，页面只负责渲染：

| 文件 | 内容 |
|---|---|
| `miniapp/src/content/site.ts` | 站点名、版本、更新日期、描述、页脚版权、`PAGE_TITLES` |
| `miniapp/src/content/glossary.ts` | 分级文案、来源标签与说明、缺失占位、安全与免责措辞 |
| `miniapp/src/content/legal.ts` | 用户协议与隐私政策正文、文档版本与生效日期 |
| `miniapp/src/content/about.ts` | 关于页的功能清单与说明块 |
| `miniapp/src/content/credits.ts` | 开源组件与第三方服务清单（Markdown，含外链） |
| `pb_hooks/lib/copy.js` | 服务端随分数/量表下发的建议与安全提示 |

规则：

1. 页面里不写「压力平稳 / 设备采集 / 12356」这类字面量，从 `content/` 取。
2. 页面标题写在 `PAGE_TITLES`，各页 `index.config.ts` 直接引用；H5 标题由 `app.tsx` 运行时同步。
3. 协议类文档用 Markdown 或结构化数组维护，版本号与日期一起升；链路由 `components/Markdown.tsx` 渲染（H5 新窗口，小程序复制链接）。
4. 改动服务端下发的文案时，界面文案不必同步复制；但语义变化（例如分级标准）必须同步 `hps-method.md`。

## 6.3 页面转场

只在 H5 生效（`.taro_page` 容器）；小程序用原生转场，不受影响。统一的取舍是**短、幅度小、可关闭**：

| 场景 | 效果 | 时长 |
|---|---|---|
| 底部 Tab 切换 | 淡入 + 上移 8rpx | 160ms |
| 进入详情页（量表、反馈、关于、协议） | 淡入 + 右移 24rpx，表示"深入一层" | 220ms |
| 登录 | 纯淡入 | 140ms |
| 拼句面板 | 上滑 80rpx + 遮罩淡入 | 220ms / 180ms |
| 按钮按下 | 下压 1rpx / 轻微缩放 | 即时 |
| 骨架屏 | 呼吸式明暗 | 1.4s 循环 |

统一在 `prefers-reduced-motion: reduce` 下关闭；不做页面退出动画（Taro 会在切页时立即卸载旧页，补退出动画需要保留 DOM，代价大于收益）。

## 7. 落地位置

- 令牌：`miniapp/src/styles/tokens.scss`
- 全局类：`miniapp/src/styles/global.scss`
- 混入：`miniapp/src/styles/mixins.scss`
- TS 颜色：`miniapp/src/lib/theme.ts`
- 页面：全部 10 个页面已收口到组件基座（2026-11）；页面不再自建卡片/按钮/状态块/顶栏。
- 配色：`pages/*/index.config.ts` 的导航栏与下拉底色已对齐 `#1F5A50` / `#F4EFE5`，不再出现偏青的旧值。
