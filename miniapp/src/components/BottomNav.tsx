import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import './BottomNav.scss'

const TABS = [
  { key: 'index', label: '首页', icon: '🏠', path: '/pages/index/index' },
  { key: 'manage', label: '减压', icon: '🧘', path: '/pages/manage/index' },
  { key: 'qa', label: '问答', icon: '💬', path: '/pages/qa/index' },
  { key: 'community', label: '互助', icon: '👥', path: '/pages/community/index' },
  { key: 'profile', label: '我的', icon: '📈', path: '/pages/profile/index' },
]

export default function BottomNav({ active }: { active: string }) {
  function go(tab: (typeof TABS)[number]) {
    if (tab.key === active) return
    Taro.redirectTo({ url: tab.path })
  }

  return (
    <View className="bottom-nav">
      {TABS.map((tab) => (
        <View
          key={tab.key}
          className={`nav-item ${tab.key === active ? 'active' : ''}`}
          onClick={() => go(tab)}
        >
          <Text className="nav-icon">{tab.icon}</Text>
          <Text className="nav-label">{tab.label}</Text>
        </View>
      ))}
    </View>
  )
}
