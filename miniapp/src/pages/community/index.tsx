import { Text, View } from '@tarojs/components'
import BottomNav from '@/components/BottomNav'

// 占位：由页面实现负责替换
export default function CommunityPage() {
  return (
    <View className="page">
      <View className="page-pad">
        <Text>社群互助（待实现）</Text>
      </View>
      <BottomNav active="community" />
    </View>
  )
}
