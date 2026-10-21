# 图标许可与生成

本项目界面图标使用 **Font Awesome Free 7 Solid** 的子集。

- 图标：CC BY 4.0 — https://fontawesome.com/license/free
- 字体文件：SIL Open Font License 1.1
- 版权：Fonticons, Inc.

子集生成脚本：`miniapp/scripts/gen-iconfont.py`。脚本从系统安装的
`Font Awesome 7 Free-Solid-900.otf` 中只取 `ICONS` 列出的码点，转成 TTF，
输出 `miniapp/src/styles/iconfont.scss` 里的 base64 `@font-face`。

当前子集 65 个字形，约 12.5KB TTF（base64 后约 17KB）。新增图标时：

1. 在脚本的 `ICONS` 里加码点；
2. 在 `miniapp/src/lib/icons.ts` 加同名映射；
3. 重新生成 `iconfont.scss`；
4. `bunx tsc --noEmit && bun run build:h5` 验证。

生成脚本不进入构建流程；仓库里已提交生成结果，构建机不需要安装 Font Awesome。

验证边界：H5 已在 Chromium 实测；`build:weapp` 通过，但微信真机的 WXSS base64 字体渲染尚未实测。若真机出现方框，优先检查基础库版本与 WXSS 字体大小限制。
