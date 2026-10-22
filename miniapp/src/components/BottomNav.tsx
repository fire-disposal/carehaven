import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import Icon from '@/components/Icon'
import type { IconName } from '@/lib/icons'
import './BottomNav.scss'

const TABS: { key: string; label: string; icon: IconName; path: string }[] = [
  { key: 'index', label: '首页', icon: 'house', path: '/pages/index/index' },
  { key: 'manage', label: '减压', icon: 'spa', path: '/pages/manage/index' },
  { key: 'qa', label: '问答', icon: 'comment-dots', path: '/pages/qa/index' },
  { key: 'community', label: '互助', icon: 'users', path: '/pages/community/index' },
  { key: 'profile', label: '我的', icon: 'chart-line', path: '/pages/profile/index' },
]

export default function BottomNav({ active }: { active: string }) {
  function go(tab: (typeof TABS)[number]) {
    if (tab.key === active) return
    Taro.redirectTo({ url: tab.path })
  }

  return (
    <View className="bottom-nav">
      {TABS.map((tab) => {
        const current = tab.key === active
        return (
          <View
            key={tab.key}
            className={`nav-item ${current ? 'active' : ''}`}
            onClick={() => go(tab)}
            ariaRole="button"
            ariaLabel={`${tab.label}${current ? '，当前页面' : ''}`}
          >
            <View className="nav-icon-wrap">
              <Icon name={tab.icon} size={38} />
            </View>
            <Text className="nav-label">{tab.label}</Text>
            <View className="nav-dot" />
          </View>
        )
      })}
    </View>
  )
}
