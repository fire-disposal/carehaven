import { Text, View } from '@tarojs/components'
import './Button.scss'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

interface ButtonProps {
  children: string
  variant?: ButtonVariant
  block?: boolean
  disabled?: boolean
  loading?: boolean
  className?: string
  ariaLabel?: string
  onClick?: () => void
}

/**
 * 纸本按钮：近直角、发丝线、靠字重与底色区分层级。
 * 所有可点区域至少 88rpx，符合中老年用户的触控尺寸。
 */
export default function Button({
  children,
  variant = 'primary',
  block = false,
  disabled = false,
  loading = false,
  className = '',
  ariaLabel,
  onClick,
}: ButtonProps) {
  const inactive = disabled || loading
  const classes = [
    'ui-btn',
    `ui-btn--${variant}`,
    block ? 'ui-btn--block' : '',
    inactive ? 'is-disabled' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <View
      className={classes}
      onClick={inactive ? undefined : onClick}
      ariaRole="button"
      ariaLabel={ariaLabel || children}
    >
      <Text className="ui-btn__label">{loading ? '请稍候…' : children}</Text>
    </View>
  )
}
