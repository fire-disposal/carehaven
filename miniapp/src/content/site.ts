// 站点级信息：名称、版本、域名、版权、许可
//
// 改这里一处，导航标题 / 关于页 / H5 元信息都会跟着变。
// 注意：src/index.html 是构建期静态模板，标题在那里另有一份，发版时同步。

export const SITE = {
  name: '智护忆站',
  tagline: '照护者的压力记录与自我照护工具',
  version: '1.2.0',
  updatedAt: '2026-11-04',
  domain: 'care.205716.xyz',
  operator: '项目组',
  description:
    '智护忆站：失智症家庭照护者的压力记录、量表自评、放松练习、照护问答与互助工具。结果为筛查提示，不构成诊断。',
  ogTitle: '智护忆站',
  ogDescription: '记录情绪、睡眠与照护负担，按状态给出放松练习与量表自评。',
  headTitle: '智护忆站',
  copyright: '© 2026 智护忆站 · 由项目组维护 · 功能与说明以本页及协议的最新版本为准',
  license: '图标来自 Font Awesome Free 7（CC BY 4.0），字体采用 SIL OFL 1.1 许可。',
} as const

/** 页面标题：app.config / 各页 config / 页面内标题共用一份 */
export const PAGE_TITLES = {
  index: '首页',
  manage: '减压',
  qa: '问答',
  community: '互助',
  profile: '我的',
  assessment: '量表自评',
  feedback: '意见反馈',
  about: '关于',
  agreement: '协议与隐私',
  login: '登录',
  checkin: '记录此刻',
  guide: '引导练习',
} as const
