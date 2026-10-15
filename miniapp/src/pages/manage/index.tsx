import { Text, View } from '@tarojs/components'
import BottomNav from '@/components/BottomNav'

// 占位：由页面实现负责替换
export default function ManagePage() {
  return (
    <View className="page">
      <View className="page-pad">
        <Text>压力管理（待实现）</Text>
      </View>
      <BottomNav active="manage" />
    </View>
  )
}
