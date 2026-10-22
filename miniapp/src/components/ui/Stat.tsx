import { Text, View } from '@tarojs/components'
import './Stat.scss'

interface StatProps {
  label: string
  value: string | number
  unit?: string
  className?: string
}

/** 数值单元：标签小字 + 衬线数字 + 单位，页面只负责排版。 */
export default function Stat({ label, value, unit, className = '' }: StatProps) {
  return (
    <View className={`ui-stat ${className}`.trim()}>
      <Text className="ui-stat__label">{label}</Text>
      <View className="ui-stat__value-row">
        <Text className="ui-stat__value">{value}</Text>
        {unit ? <Text className="ui-stat__unit">{unit}</Text> : null}
      </View>
    </View>
  )
}
