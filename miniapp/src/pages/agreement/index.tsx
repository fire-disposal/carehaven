import { useState } from 'react'
import { Text, View } from '@tarojs/components'
import Taro, { useRouter } from '@tarojs/taro'
import Icon from '@/components/Icon'
import './index.scss'

type Doc = 'terms' | 'privacy'

interface Section {
  title: string
  paras: string[]
}

const TERMS: Section[] = [
  {
    title: '一、服务内容',
    paras: [
      '智护忆站为失智症家庭照护者提供压力记录、量表自评、放松练习、照护知识问答与互助社区。服务用于日常自我管理与相互支持，不提供诊断、处方或急救服务。',
    ],
  },
  {
    title: '二、账号与安全',
    paras: [
      '您应妥善保管账号与密码，并对账号下发生的操作负责。发现账号异常时，请及时修改密码并通过意见反馈联系我们。',
      '请勿在公开区域发布真实姓名、住址、联系方式、病历等可识别个人身份的信息。',
    ],
  },
  {
    title: '三、使用规范',
    paras: [
      '不得利用本服务发布违法、侵权、骚扰、歧视、广告或虚假信息；不得冒用他人身份；不得干扰服务正常运行。',
      '互助社区的内容由用户发布。我们会在收到举报后核查并处理违规内容，必要时限制相关账号的使用。',
    ],
  },
  {
    title: '四、健康与安全提示',
    paras: [
      '本服务中的压力指数与量表结果仅用于自我了解，不能替代医生、心理咨询师或精神科的专业评估。',
      '如您或家人存在伤害自己或他人的风险，请立即拨打 120 或前往最近的急诊；需要心理支持可拨打全国心理援助热线 12356。',
    ],
  },
  {
    title: '五、内容与知识产权',
    paras: [
      '本服务的界面、文字、图标与程序受法律保护。未经许可，不得复制、改编或用于商业用途。您发布的内容仍归您所有；为提供服务，我们会在必要范围内展示与存储这些内容。',
    ],
  },
  {
    title: '六、协议变更',
    paras: [
      '我们可能根据功能或法律要求更新本协议。更新后会在本页面公布，继续使用即表示接受更新后的内容。',
    ],
  },
]

const PRIVACY: Section[] = [
  {
    title: '一、我们收集哪些信息',
    paras: [
      '账号信息：邮箱、昵称、登录凭证，以及您主动绑定的微信标识。',
      '健康与照护记录：情绪打卡、睡眠与照护时长、生理指标（HRV、皮肤电、睡眠质量、步数）、量表答案与结果、放松练习记录。',
      '社区与反馈：您发布的帖子、评论，以及通过意见反馈提交的分类、内容和联系方式。',
      '设备与日志：为保障服务安全与排查故障所产生的必要访问日志。',
    ],
  },
  {
    title: '二、信息如何使用',
    paras: [
      '用于计算压力指数、生成趋势与结果说明、推荐放松练习、维护社区内容与回复您的反馈。',
      '使用「朗读」功能时，被朗读的回答文字会发送给火山引擎豆包语音合成服务生成音频；不发送账号身份信息。',
      '我们不会出售您的个人信息，也不会将健康数据用于广告推送。除法律要求或取得您的单独同意外，不向第三方提供。',
    ],
  },
  {
    title: '三、敏感个人信息',
    paras: [
      '健康与情绪数据属于敏感个人信息。我们仅在提供上述功能所必需的范围内处理，并采取访问控制、传输加密与备份等措施。',
      '您可以选择不填写某项数据；这不会影响其他功能的使用，但可能使压力指数不完整。',
    ],
  },
  {
    title: '四、保存期限与删除',
    paras: [
      '数据在您的账号存续期间保存。您可以通过意见反馈申请查询、导出或删除个人数据；我们会在核实身份后处理。',
      '删除账号或数据后，相关记录将从生产环境移除；备份中的副本会按备份保留周期自然过期。',
    ],
  },
  {
    title: '五、社区内容的可见范围',
    paras: [
      '您在互助社区发布的内容对其他登录用户可见。选择匿名发布时，其他用户只会看到“匿名”，但为维护社区秩序，系统仍会在后台保留发布者与内容的关联。',
    ],
  },
  {
    title: '六、未成年人',
    paras: [
      '本服务面向成年照护者。未成年人应在监护人同意与陪同下使用。',
    ],
  },
  {
    title: '七、政策更新与联系',
    paras: [
      '本政策更新后会在本页面公布。对隐私处理有疑问，或希望行使查询、导出、删除等权利，请通过“我的 - 意见反馈”联系我们，并选择“内容问题”或“其他”。',
    ],
  },
]

const UPDATED_AT = '2026年10月17日'

export default function AgreementPage() {
  const router = useRouter()
  const initial: Doc = router.params.type === 'privacy' ? 'privacy' : 'terms'
  const [doc, setDoc] = useState<Doc>(initial)

  const backProfile = () => {
    Taro.redirectTo({ url: '/pages/profile/index' })
  }

  const sections = doc === 'terms' ? TERMS : PRIVACY

  return (
    <View className="page ag-page">
      <View className="ag-top">
        <View className="ag-back" onClick={backProfile} ariaRole="button" ariaLabel="返回我的">
          <Icon name="arrow-left" size={36} />
        </View>
        <Text className="ag-top-title">协议与隐私</Text>
        <View className="ag-top-spacer" />
      </View>

      <View className="ag-tabs">
        <View
          className={`ag-tab ${doc === 'terms' ? 'on' : ''}`}
          onClick={() => setDoc('terms')}
          ariaRole="button"
          ariaLabel="查看用户协议"
        >
          <Text>用户协议</Text>
        </View>
        <View
          className={`ag-tab ${doc === 'privacy' ? 'on' : ''}`}
          onClick={() => setDoc('privacy')}
          ariaRole="button"
          ariaLabel="查看隐私政策"
        >
          <Text>隐私政策</Text>
        </View>
      </View>

      <View className="page-pad">
        <Text className="ag-updated">更新日期：{UPDATED_AT}</Text>
        {sections.map((section) => (
          <View className="ag-section" key={section.title}>
            <Text className="ag-title">{section.title}</Text>
            {section.paras.map((para, i) => (
              <Text className="ag-text" key={`${section.title}-${i}`}>
                {para}
              </Text>
            ))}
          </View>
        ))}
        <Text className="ag-foot">
          如对本协议或隐私政策有疑问，请通过“我的 - 意见反馈”联系我们。
        </Text>
      </View>
    </View>
  )
}
