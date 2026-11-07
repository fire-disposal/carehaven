import { Text } from '@tarojs/components'
import './Pill.scss'

export type PillTone = 'green' | 'yellow' | 'red' | 'primary' | 'quiet'

interface PillProps {
  children: string
  tone?: PillTone
  className?: string
}

/** 状态标签：8rpx 小圆角，字距略宽；三色由 \$tones 生成。 */
export default function Pill({ children, tone = 'quiet', className = '' }: PillProps) {
  return <Text className={`ui-pill ui-pill--${tone} ${className}`.trim()}>{children}</Text>
}
