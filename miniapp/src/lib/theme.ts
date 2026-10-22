/**
 * 与 styles/tokens.scss 对应的 JS 颜色常量。
 *
 * Taro 的部分组件（Slider、Canvas、地图标记等）只接受字符串颜色，
 * 不能直接引用 SCSS 变量；颜色只在这里维护一份，页面不要再写十六进制。
 * 这里的值必须与 tokens.scss 保持一致。
 */
export const THEME = {
  paper: '#f4efe5',
  surface: '#fffcf6',
  ink: '#1e2421',
  ink2: '#44504a',
  muted: '#626b65',
  line: '#ded5c5',
  primary: '#1f5a50',
  primaryLight: '#e4ede7',
  primaryDark: '#16443c',
  accent: '#9c4833',
  green: '#2c6a4e',
  yellow: '#7a5310',
  red: '#963b33',
} as const

export type ThemeColor = (typeof THEME)[keyof typeof THEME]
