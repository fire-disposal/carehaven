import { Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { ICONS, type IconName } from '@/lib/icons'

interface IconProps {
  name: IconName
  /** 设计稿单位（750 宽）；默认 40rpx。 */
  size?: number
  color?: string
  className?: string
  /** 图标有独立含义时传入读屏文本；纯装饰不传，默认对读屏隐藏。 */
  label?: string
}

/**
 * 统一的图标出口：字形、间距、基线只在这里定义。
 * 用字体而非 emoji：同一码点在各系统渲染一致，也能跟随文字颜色。
 */
export default function Icon({ name, size = 40, color, className = '', label }: IconProps) {
  return (
    <Text
      className={`icon ${className}`.trim()}
      style={{ fontSize: Taro.pxTransform(size), color }}
      ariaHidden={!label}
      ariaLabel={label}
      ariaRole={label ? 'img' : undefined}
    >
      {ICONS[name]}
    </Text>
  )
}
