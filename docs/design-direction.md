# 视觉方向：纸本 · 松烟

> 状态：2026-10 选定并落地第一批页面。适用 `miniapp`（H5 与微信小程序共用）。

## 1. 为什么不是圆角卡片

照护者产品的“舒适”不应靠大圆角、彩色阴影和柔和渐变堆出来；那会把界面推向通用健康 App 的模板感。这里选**纸本印刷**的方向：

- **近直角**：卡片 0–8rpx，按钮 4rpx，标签 2rpx。靠留白、字重、发丝线建立秩序。
- **暖纸底**：降低白底刺眼感，长时间阅读更稳。
- **一道栏线**：栏目头用 6rpx 竖线标记，像印刷品的栏目标记，替代彩色图标底。
- **衬线只给品牌与数字**：品牌印章、HPS 大数字用衬线；正文仍用系统黑体，保证小字号可读性。
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
| `Button` | `primary` / `secondary` / `ghost` / `danger`，`block`、`loading` |
| `Card` | `plain` / `quiet` / `tint`，`flush` 去内边距 |
| `SectionHeader` | 栏线 + 标题 + 可选 eyebrow/action |
| `Stat` | 标签 + 衬线数字 + 单位 |
| `Pill` | `green` / `yellow` / `red` / `primary` / `quiet` 状态标签 |

页面优先用组件，不再复制 `.btn-primary` / `.card` 的样式。颜色在 TS 侧统一走 `src/lib/theme.ts`（Slider 等只接受字符串的组件）。

## 6. 页面规则

1. 一屏一个主行动：首页主按钮只保留“记录此刻/再记一次”。
2. 栏目头不超过两级：`eyebrow` 小标签 + 标题；不要连续三个同级标题。
3. 卡片内不再套卡片；列表用发丝线分隔，不用每行一个白卡。
4. 状态色只用于状态，不用于装饰；一屏最多一个状态色块。
5. 图标用 24–36rpx，默认继承当前文字色；不放大面积彩色图标底。
6. 空态、错误态用文字 + 一个动作，不画插画占位。

## 7. 落地位置

- 令牌：`miniapp/src/styles/tokens.scss`
- 全局类：`miniapp/src/styles/global.scss`
- 混入：`miniapp/src/styles/mixins.scss`
- TS 颜色：`miniapp/src/lib/theme.ts`
- 页面：`index`（首页）、`login`、`manage`、`profile`、`about` 已按此方向重排；其余页面通过令牌迁移继承。
