import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import Icon from '@/components/Icon'
import Markdown from '@/components/Markdown'
import { Button, Card, PageHead, TopBar } from '@/components/ui'
import { ABOUT_BLOCKS, ABOUT_FEATURES } from '@/content/about'
import { CREDITS_MARKDOWN } from '@/content/credits'
import { SAFETY } from '@/content/glossary'
import { PAGE_TITLES, SITE } from '@/content/site'
import { THEME } from '@/lib/theme'
import { backOrSwitchTab } from '@/lib/nav'
import './index.scss'

export default function AboutPage() {
  const backProfile = () => {
    void backOrSwitchTab('/pages/profile/index')
  }

  return (
    <View className="page">
      <TopBar title={PAGE_TITLES.about} onBack={backProfile} backLabel="返回我的" />

      <View className="page-pad">
        <View className="ab-hero">
          <PageHead className="ab-head" variant="brand" title={SITE.name} note={SITE.tagline} />
          <Text className="ab-version">
            版本 {SITE.version} · 更新 {SITE.updatedAt}
          </Text>
        </View>

        {ABOUT_BLOCKS.map((block) => (
          <Card className="ab-block" key={block.title}>
            <Text className="ab-title">{block.title}</Text>
            {block.paras.map((para, i) => (
              <Text className="ab-text" key={i}>
                {para}
              </Text>
            ))}
          </Card>
        ))}

        <Card className="ab-block">
          <Text className="ab-title">主要功能</Text>
          {ABOUT_FEATURES.map((item) => (
            <View className="ab-feature" key={item.title}>
              <View className="ab-feature-icon">
                <Icon name={item.icon} size={34} color={THEME.primaryDark} />
              </View>
              <View className="ab-feature-main">
                <Text className="ab-feature-title">{item.title}</Text>
                <Text className="ab-feature-desc">{item.desc}</Text>
              </View>
            </View>
          ))}
        </Card>

        <Card className="ab-safety ab-block">
          <Text className="ab-title">{SAFETY.emergencyCard.title}</Text>
          <Text className="ab-text">{SAFETY.emergencyCard.text}</Text>
        </Card>

        <Card className="ab-block">
          <Text className="ab-title">开源组件与第三方服务</Text>
          <Markdown source={CREDITS_MARKDOWN} />
        </Card>

        <View className="ab-actions">
          <Button
            variant="primary"
            block
            ariaLabel="意见反馈"
            onClick={() => Taro.navigateTo({ url: '/pages/feedback/index' })}
          >
            意见反馈
          </Button>
          <Button
            variant="ghost"
            block
            ariaLabel="用户协议"
            onClick={() => Taro.navigateTo({ url: '/pages/agreement/index?type=terms' })}
          >
            用户协议
          </Button>
          <Button
            variant="ghost"
            block
            ariaLabel="隐私政策"
            onClick={() => Taro.navigateTo({ url: '/pages/agreement/index?type=privacy' })}
          >
            隐私政策
          </Button>
        </View>

        <Text className="ab-footer">{SITE.copyright}</Text>
      </View>
    </View>
  )
}
