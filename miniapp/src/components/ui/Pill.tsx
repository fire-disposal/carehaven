import { Text } from '@tarojs/components'
import './Pill.scss'

export type PillTone = 'green' | 'yellow' | 'red' | 'primary' | 'quiet'

interface PillProps {
  children: string
  tone?: PillTone
  className?: string
}

/** 状态标签：小圆角矩形，字距略宽；不用胶囊。 */
export default function Pill({ children, tone = 'quiet', className = '' }: PillProps) {
  return <Text className={`ui-pill ui-pill--${tone} ${className}`.trim()}>{children}</Text>
}
