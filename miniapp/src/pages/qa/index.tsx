import { Text, View } from '@tarojs/components'
import BottomNav from '@/components/BottomNav'

// 占位：由页面实现负责替换
export default function QaPage() {
  return (
    <View className="page">
      <View className="page-pad">
        <Text>智能问答（待实现）</Text>
      </View>
      <BottomNav active="qa" />
    </View>
  )
}
