// 开源组件与第三方服务说明（Markdown）
//
// 由 components/Markdown.tsx 渲染：支持标题、段落、列表、粗体、行内代码与链接。
// 链接在 H5 直接新窗口打开；小程序内复制链接并提示到浏览器打开。
// 依赖变化时同步这里；具体版本见 miniapp/package.json 与 Dockerfile。

export const CREDITS_MARKDOWN = `## 应用本体

- [Taro](https://taro.zone)｜MIT｜跨端框架，同一份代码构建 H5 与微信小程序
- [React](https://react.dev)｜MIT｜界面渲染
- [PocketBase](https://pocketbase.io)｜MIT｜后端服务、SQLite 存储与管理后台
- [Sass](https://sass-lang.com)｜MIT｜样式预处理
- [TypeScript](https://www.typescriptlang.org)｜Apache-2.0｜类型检查
- [Bun](https://bun.sh)｜MIT｜构建、脚本与测试运行时

## 图标与字体

- [Font Awesome Free 7](https://fontawesome.com)｜图标 CC BY 4.0，字体 SIL OFL 1.1｜图标子集经 \`scripts/gen-iconfont.py\` 生成
- 正文使用系统字体（苹方 / 思源黑体 / 微软雅黑等），不下载网络字体

## 第三方服务

- [火山引擎豆包语音合成](https://www.volcengine.com/product/tts)｜商业服务｜仅用于「朗读」，不发送账号身份
- 微信小程序平台｜平台条款｜小程序端登录与运行环境

## 数据与方法来源

- 知识库条目以 WHO iSupport 公开材料为基础做本土化整理，并迁入项目整理的照护图谱；来源与许可见 \`docs/from-zhiyi/\`
- 量表：ZBI-12、PHQ-9、GAD-7 按公开发布版本的题目与计分规则使用，版权归各自发布方；本服务只做筛查提示，不构成诊断
- 分级阈值（40 / 70）为产品默认参考线，非临床界值

## 许可与声明

- 本清单随依赖变更更新；发现遗漏或错误，请通过「意见反馈」告知
- 第三方组件的许可证以其官方发布为准，本页只做索引
`
