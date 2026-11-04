import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import Icon from '@/components/Icon'
import './TopBar.scss'

interface TopBarProps {
  title: string
  /** 默认返回上一页；需要跳转时传入自定义函数 */
  onBack?: () => void
  backLabel?: string
  className?: string
}

/** 次级页的置顶栏：88rpx 返回键，标题居中。全站共用一份，避免每页复制。 */
export default function TopBar({ title, onBack, backLabel = '返回', className = '' }: TopBarProps) {
  function goBack() {
    if (onBack) {
      onBack()
      return
    }
    Taro.navigateBack({ delta: 1 })
  }

  return (
    <View className={`ui-topbar ${className}`.trim()}>
      <View className="ui-topbar__back" onClick={goBack} ariaRole="button" ariaLabel={backLabel}>
        <Icon name="arrow-left" size={36} />
      </View>
      <Text className="ui-topbar__title">{title}</Text>
      <View className="ui-topbar__spacer" />
    </View>
  )
}
