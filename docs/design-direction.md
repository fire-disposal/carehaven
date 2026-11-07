# 视觉方向：木质 · 淡叶（M3 控件语言）

> 状态：2026-11 重构。适用 `miniapp`（H5 与微信小程序共用）。CSS 地基在 2026-11 推倒重写，HTML/JSX 语义不变。

## 1. 方向：植物感 + M3 的柔和，不是“纸质印刷品”

- **浅木底 + 淡叶绿**：暖中性木色做底，苔藓绿做主色，状态色全部低饱和；不用鲜艳色制造警报感。
- **控件用 M3 几何**：胶囊按钮、24rpx 卡片、16rpx chip、填充式（tonal）选中态、底部导航的胶囊指示器。
- **层级靠底色与发丝线**：卡片不投影；`$shadow-lg` 只给拼句面板、FAB 这类浮层。
- **衬线只用于编辑性强调**：品牌字、首页问候语、互助页引文（「别人说的话」）、完成页大标题。正文、控件与数字都是无衬线；数字用 `tabular-nums` 等宽，不用高对比衬线。
- **面向中老年照护者**：正文 ≥32rpx，触控 ≥88rpx，浅底文字对比度 ≥ WCAG AA（实测见下表）。

## 2. 色板

| Token | 值 | 用途 | 实测对比度 |
|---|---|---|---|
| `$c-paper` | `#F1ECE3` | 页面底色（浅木） | — |
| `$c-surface` | `#FBF8F2` | 卡片/浮层 | — |
| `$c-surface-dim` | `#E9E2D6` | 未选中控件、滑杆轨道、骨架 | muted 4.5:1 |
| `$c-ink` | `#242824` | 主文字 | 12.7:1 on paper |
| `$c-ink-2` | `#49514A` | 次级文字 | 7.0:1 on paper |
| `$c-muted` | `#61675F` | 辅助文字 | 4.9:1 on paper |
| `$c-line` / `$c-line-strong` | `#DCD4C4` / `#C6BBA6` | 分隔线 / 描边 | — |
| `$c-primary` | `#3E5F4B` | 苔藓绿主色、主按钮 | 6.1:1 on paper |
| `$c-primary-dark` | `#2E4738` | 主色文字、按下态 | — |
| `$c-primary-container` | `#DCE5D4` | 选中填充（M3 container） | on-container 10.2:1 |
| `$c-on-primary-container` | `#1F3527` | container 上的文字 | — |
| `$c-primary-light` | `#E6EBDF` | hover、聚焦光环 | — |
| `$c-green` / `-bg` | `#47684F` / `#E3EADA` | 平稳 | 5.1:1 |
| `$c-yellow` / `-bg` | `#77602F` / `#EFE6CF` | 预警 | 4.8:1 |
| `$c-red` / `-bg` | `#8A5048` / `#F0E0D8` | 偏高 | 4.9:1 |
| `$c-accent` | `#8C5B3F` | 木色强调，极少数位置 | — |

规则：状态色只用于状态，不用于装饰；一屏最多一个状态色块；状态永不只靠颜色表达（配文字/字重/图标）。

## 3. 字体

```scss
$font-sans: -apple-system, 'PingFang SC', 'Hiragino Sans GB',
  'Noto Sans CJK SC', 'Source Han Sans SC', 'Microsoft YaHei', sans-serif;
$font-serif: 'Songti SC', 'STSong', 'Noto Serif CJK SC', 'Source Han Serif SC', serif;
$font-num: Georgia, 'Times New Roman', 'Songti SC', 'Noto Serif CJK SC', serif;
```

- 正文 32rpx / 行高 1.65；辅助 24–28rpx；标签 22rpx + 2rpx 字距。
- 标题 36–48rpx，字重 600；HPS 数字 112rpx 黑体 600 + `tabular-nums`，不用高对比衬线。
- 不下载网络中文字体：包体与首屏都不合适；Android 回退系统黑体可接受。

## 4. 形状、间距与布局

| 项 | 值 |
|---|---|
| 卡片圆角 | `$radius-lg` 24rpx（M3 12dp） |
| 输入框圆角 | `$radius` 20rpx |
| chip / 小控件 | `$radius-sm` 16rpx |
| 状态标签 | `$radius-xs` 8rpx |
| 按钮 / 导航指示器 / 滑杆 | `$radius-pill` 999rpx（胶囊） |
| 间距 | 8 / 16 / 24 / 32 / 48 / 64 / 80rpx |
| 页面左右留白 | `$page-gutter` 32rpx |
| 触控高度 | ≥88rpx（`@include tap`） |
| 底部导航 | `$nav-height` 132rpx + 安全区 |
| 页面底部留白 | `$page-bottom` 200rpx |
| 边框 | 统一 1rpx |
| 阴影 | 卡片无；浮层 `$shadow-lg` |

H5 宽屏：阅读栏 720px 居中；fixed 元素（底部导航、打卡 CTA、问答整页、FAB、拼句面板）必须跟随阅读栏，规则集中在 `app.scss`，页面不再各自写宽屏补丁。

## 5. 样式分层（SCSS 组织）

```
miniapp/src/
  app.scss                  # 应用级：底色/字体、宽屏阅读栏、桌面 hover/滚动条
  styles/
    tokens.scss             # 变量 + $tones map + space()；只放值，不放选择器
    mixins.scss             # 所有可复用控件/排版规则（见下）
    global.scss             # 页面骨架、共享类、焦点、reduced-motion、页面转场
    iconfont.scss
  components/ui/*.scss      # 组件基座，全部建立在 tokens + mixins 上
  pages/*/index.scss        # 只写本页布局与特有装饰
```

**纪律**：凡是「第二个页面也会用到」的样式，先收进 `mixins.scss` 再 `@include`；页面里不允许出现十六进制颜色（唯一例外 `rgba(62,95,75,…)` 主色透明态）、不允许自造圆角/阴影、不允许重写按钮外观。

### mixins 清单

| 混入 | 用途 |
|---|---|
| `tap` | 触控目标 ≥88rpx |
| `pressable($scale)` | 按压缩放 + reduced-motion 回退 |
| `card` | M3 outlined card（24rpx + 1rpx 线） |
| `field` | M3 outlined 输入框，`:focus-within` 主色描边 + 浅叶光环 |
| `textarea-field` | 多行文本域；已处理 Taro H5 内层 textarea 溢出/拖拽手柄 |
| `chip` | 选项/分类 chip，含 `.on` / `.picked` 选中态 |
| `icon-tile` | 统一圆角图标底托 |
| `label` / `num` / `clamp` / `hairline` | 小标签 / 等宽数字 / 截断 / 发丝线 |

## 6. 组件基座

`miniapp/src/components/ui/`：

| 组件 | 说明 |
|---|---|
| `Button` | 胶囊按钮：filled / tonal / outlined / danger；disabled 用 tonal 灰底而非透明度 |
| `Card` | `plain` / `quiet` / `tint`，`flush` 去内边距 |
| `Pill` | 状态标签，三色与主色由 `$tones` `@each` 生成 |
| `PageHead` | 页头三槽：eyebrow / title / note；`variant="brand"` 只给登录与关于 |
| `TopBar` | 次级页置顶栏，88rpx 胶囊返回键 |
| `SectionHeader` | 标题 + 可选 eyebrow + 右侧轻量操作；不再用印刷栏线 |
| `StateBlock` | 三态：loading 骨架 / empty / error（带重试），`role="status"` / `alert` |
| `Stat` | 标签 + 等宽数字 + 单位 |
| `StarRating` | 1–5 星，radiogroup 语义，选中 container 底 + 加粗 |

`BottomNav`：M3 navigation bar，当前页图标落在 `$c-primary-container` 胶囊内，不再用短横线。

TS 侧颜色统一走 `src/lib/theme.ts`（Slider 等只接受字符串的组件），与 tokens.scss 一一对应。

## 7. 可访问性与动效底线

- **触控**：所有可点区域 ≥88rpx（`@include tap`）。
- **语义**：可点 `View` 带 `ariaRole` + `ariaLabel`；评分/心情/回应用 `radio`/`radiogroup` + `ariaChecked`。
- **状态播报**：`StateBlock` 用 `role="status"` / `role="alert"`。
- **焦点**：全局 `:focus-visible` 2rpx 主色描边（H5）；输入框 `:focus-within` 光环。
- **动效**：全局 `prefers-reduced-motion: reduce` 关闭过渡与骨架呼吸；`pressable` 自带回退。
- **页面转场**（仅 H5）：Tab 淡入 160ms；详情页淡入 + 右移 24rpx 220ms；登录纯淡入 140ms；不做退出动画（Taro 切页即卸载旧页）。

## 8. 文案与文档内容层

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
3. 协议类文档用 Markdown 或结构化数组维护，版本号与日期一起升；链路由 `components/Markdown.tsx` 渲染。
4. 改动服务端下发的文案时，界面文案不必同步复制；但语义变化（例如分级标准）必须同步 `hps-method.md`。
