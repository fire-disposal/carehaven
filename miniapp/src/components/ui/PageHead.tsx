import type { ReactNode } from 'react'
import { Text, View } from '@tarojs/components'
import './PageHead.scss'

interface PageHeadProps {
  title: string
  eyebrow?: string
  note?: string
  /** brand：登录/关于这类品牌位，标题用衬线并放大；page：内页标题 */
  variant?: 'page' | 'brand'
  action?: ReactNode
  className?: string
}

/** 页面头部：小标签 + 标题 + 一句说明。全站只有这一种页头。 */
export default function PageHead({
  title,
  eyebrow,
  note,
  variant = 'page',
  action,
  className = '',
}: PageHeadProps) {
  return (
    <View className={`ui-head ui-head--${variant} ${className}`.trim()}>
      {eyebrow ? <Text className="ui-head__eyebrow">{eyebrow}</Text> : null}
      <View className="ui-head__row">
        <Text className="ui-head__title">{title}</Text>
        {action ? <View className="ui-head__action">{action}</View> : null}
      </View>
      {note ? <Text className="ui-head__note">{note}</Text> : null}
    </View>
  )
}
