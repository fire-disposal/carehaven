import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import Icon from '@/components/Icon'
import { Button, Card, PageHead, TopBar } from '@/components/ui'
import { THEME } from '@/lib/theme'
import type { IconName } from '@/lib/icons'
import { APP_NAME, APP_VERSION } from '@/lib/appInfo'
import './index.scss'

const FEATURES: { icon: IconName; title: string; desc: string }[] = [
  { icon: 'heart-pulse', title: '压力评估', desc: '打卡与生理数据合成压力指数，分三档给出建议' },
  { icon: 'clipboard-list', title: '量表自评', desc: '照护负担、情绪、焦虑三份标准化量表' },
  { icon: 'spa', title: '减压练习', desc: '按当前状态推荐呼吸、冥想、音乐与视频练习' },
  { icon: 'comment-dots', title: '知识问答', desc: '失智症照护问题检索与科普知识库' },
  { icon: 'users', title: '结构化互助', desc: '从词库拼一句，给一个固定回应' },
]

export default function AboutPage() {
  const backProfile = () => {
    Taro.redirectTo({ url: '/pages/profile/index' })
  }

  return (
    <View className="page">
      <TopBar title="关于" onBack={backProfile} backLabel="返回我的" />

      <View className="page-pad">
        <View className="ab-hero">
          <View className="ab-logo">
            <Text className="ab-seal">忆</Text>
          </View>
          <PageHead
            className="ab-head"
            variant="brand"
            title={APP_NAME}
            note="陪照护者一起，把压力说出来、接住、放下。"
          />
          <Text className="ab-version">版本 {APP_VERSION}</Text>
        </View>

        <Card className="ab-block">
          <Text className="ab-title">我们做什么</Text>
          <Text className="ab-text">
            失智症照护往往持续多年，压力常常被“应该的”三个字盖住。智护忆站把即时情绪记录、
            生理指标与照护情境放在一起，帮助照护者看见自己的状态，并在需要时给出可执行的放松与支持方案。
          </Text>
        </Card>

        <Card className="ab-block">
          <Text className="ab-title">主要功能</Text>
          {FEATURES.map((item) => (
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

        <Card className="ab-block">
          <Text className="ab-title">压力指数怎么来</Text>
          <Text className="ab-text">
            综合压力指数（HPS）由三部分组成：生理指标（HRV、皮肤电、睡眠）、心理自评（心情、焦虑、疲惫）
            与生活情境（照护时长、睡眠时长、完成的放松练习）。三部分按权重合成 0–100 的分数，
            40 与 70 是分层参考线，不是诊断界线。
          </Text>
          <Text className="ab-text">
            指数用于提示“最近是否需要多照顾一下自己”，不能替代医生、心理咨询师或精神科评估。
          </Text>
        </Card>

        <Card className="ab-block">
          <Text className="ab-title">数据说明</Text>
          <Text className="ab-text">
            生理数据会标注来源：设备采集、手动录入或模拟数据。模拟数据用于展示系统效果，
            页面会明确标注，不会冒充真实测量。
          </Text>
        </Card>

        <Card className="ab-safety ab-block">
          <Text className="ab-title">需要立即帮助时</Text>
          <Text className="ab-text">
            如果您或家人有伤害自己或他人的风险，请立即拨打 120，或前往最近的急诊。
            需要有人听您说说话，可以拨打全国心理援助热线 12356。
          </Text>
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
            ariaLabel="隐私政策"
            onClick={() => Taro.navigateTo({ url: '/pages/agreement/index?type=privacy' })}
          >
            隐私政策
          </Button>
        </View>

        <Text className="ab-footer">
          图标来自 Font Awesome Free 7，图标采用 CC BY 4.0 许可，字体采用 SIL OFL 1.1 许可。
        </Text>
      </View>
    </View>
  )
}
