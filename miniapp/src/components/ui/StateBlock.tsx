import { Text, View } from '@tarojs/components'
import Icon from '@/components/Icon'
import type { IconName } from '@/lib/icons'
import { THEME } from '@/lib/theme'
import './StateBlock.scss'

export type StateVariant = 'loading' | 'empty' | 'error'

interface StateBlockProps {
  variant: StateVariant
  title?: string
  desc?: string
  icon?: IconName
  actionLabel?: string
  onAction?: () => void
  /** 嵌在卡片里的小尺寸：去掉大留白，只留一行文字 */
  compact?: boolean
  className?: string
}

/**
 * 全站统一的三态：加载（骨架）/ 空 / 错误。
 * 读屏通过 aria-live 感知变化；加载态用骨架而不是转圈。
 */
export default function StateBlock({
  variant,
  title,
  desc,
  icon,
  actionLabel,
  onAction,
  compact = false,
  className = '',
}: StateBlockProps) {
  const resolvedIcon: IconName =
    icon || (variant === 'empty' ? 'seedling' : variant === 'error' ? 'circle-exclamation' : 'clock')
  const classes = ['ui-state', `ui-state--${variant}`, compact ? 'ui-state--compact' : '', className]
    .filter(Boolean)
    .join(' ')

  return (
    <View
      className={classes}
      ariaRole={variant === 'error' ? 'alert' : 'status'}
      ariaLabel={title || undefined}
    >
      {variant === 'loading' ? (
        <View className="ui-state__skeleton">
          <View className="ui-state__bar ui-state__bar--lg" />
          <View className="ui-state__bar" />
          <View className="ui-state__bar ui-state__bar--sm" />
        </View>
      ) : (
        <Icon
          name={resolvedIcon}
          size={compact ? 40 : 56}
          color={variant === 'error' ? THEME.red : THEME.primary}
        />
      )}

      {title ? <Text className="ui-state__title">{title}</Text> : null}
      {desc ? <Text className="ui-state__desc">{desc}</Text> : null}
      {actionLabel && onAction ? (
        <View
          className="ui-state__action"
          onClick={onAction}
          ariaRole="button"
          ariaLabel={actionLabel}
        >
          <Text className="ui-state__action-label">{actionLabel}</Text>
        </View>
      ) : null}
    </View>
  )
}
