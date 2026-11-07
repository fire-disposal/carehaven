import type { ReactNode } from 'react'
import { View } from '@tarojs/components'
import './Card.scss'

export type CardTone = 'plain' | 'quiet' | 'tint'

interface CardProps {
  children: ReactNode
  tone?: CardTone
  flush?: boolean
  className?: string
}

/** M3 outlined 卡片：24rpx 圆角 + 1rpx 线，不投影；tint 只用于极少数强调区。 */
export default function Card({ children, tone = 'plain', flush = false, className = '' }: CardProps) {
  const classes = [
    'ui-card',
    `ui-card--${tone}`,
    flush ? 'ui-card--flush' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return <View className={classes}>{children}</View>
}
