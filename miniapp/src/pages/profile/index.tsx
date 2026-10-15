import { Text, View } from '@tarojs/components'
import BottomNav from '@/components/BottomNav'

// 占位：由页面实现负责替换
export default function ProfilePage() {
  return (
    <View className="page">
      <View className="page-pad">
        <Text>我的（待实现）</Text>
      </View>
      <BottomNav active="profile" />
    </View>
  )
}
