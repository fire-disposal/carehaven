/**
 * 与 styles/tokens.scss 对应的 JS 颜色常量。
 *
 * Taro 的部分组件（Slider、Canvas、地图标记等）只接受字符串颜色，
 * 不能直接引用 SCSS 变量；颜色只在这里维护一份，页面不要再写十六进制。
 * 这里的值必须与 tokens.scss 保持一致。
 */
export const THEME = {
  paper: '#f1ece3',
  surface: '#fbf8f2',
  surfaceDim: '#e9e2d6',
  ink: '#242824',
  ink2: '#49514a',
  muted: '#61675f',
  line: '#dcd4c4',
  starOff: '#cfc7b8',
  white: '#ffffff',
  primary: '#3e5f4b',
  primaryLight: '#e6ebdf',
  primaryDark: '#2e4738',
  primaryContainer: '#dce5d4',
  onPrimaryContainer: '#1f3527',
  accent: '#8c5b3f',
  green: '#47684f',
  yellow: '#77602f',
  red: '#8a5048',
} as const

export type ThemeColor = (typeof THEME)[keyof typeof THEME]
