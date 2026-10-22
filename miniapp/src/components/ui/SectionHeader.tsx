import type { ReactNode } from 'react'
import { Text, View } from '@tarojs/components'
import './SectionHeader.scss'

interface SectionHeaderProps {
  title: string
  eyebrow?: string
  action?: ReactNode
  className?: string
}

/** 栏目头：短竖线 + 标题，右侧可放一个轻量操作/计数。 */
export default function SectionHeader({ title, eyebrow, action, className = '' }: SectionHeaderProps) {
  return (
    <View className={`ui-section ${className}`.trim()}>
      <View className="ui-section__main">
        <View className="ui-section__rule" />
        <View className="ui-section__text">
          {eyebrow ? <Text className="ui-section__eyebrow">{eyebrow}</Text> : null}
          <Text className="ui-section__title">{title}</Text>
        </View>
      </View>
      {action ? <View className="ui-section__action">{action}</View> : null}
    </View>
  )
}
