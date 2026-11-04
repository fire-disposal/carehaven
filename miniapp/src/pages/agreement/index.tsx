import { useState } from 'react'
import { Text, View } from '@tarojs/components'
import Taro, { useRouter } from '@tarojs/taro'
import { TopBar } from '@/components/ui'
import { DOC_UPDATED_AT, DOC_VERSION, PRIVACY, TERMS } from '@/content/legal'
import { PAGE_TITLES } from '@/content/site'
import './index.scss'

type Doc = 'terms' | 'privacy'


export default function AgreementPage() {
  const router = useRouter()
  const initial: Doc = router.params.type === 'privacy' ? 'privacy' : 'terms'
  const [doc, setDoc] = useState<Doc>(initial)

  const backProfile = () => {
    Taro.redirectTo({ url: '/pages/profile/index' })
  }

  const sections = doc === 'terms' ? TERMS : PRIVACY

  return (
    <View className="page">
      <TopBar title={PAGE_TITLES.agreement} onBack={backProfile} backLabel="返回我的" />

      <View className="ag-tabs" ariaRole="radiogroup" ariaLabel="协议类型">
        <View
          className={`ag-tab ${doc === 'terms' ? 'on' : ''}`}
          onClick={() => setDoc('terms')}
          ariaRole="radio"
          ariaLabel="用户协议"
          ariaChecked={doc === 'terms'}
        >
          <Text>用户协议</Text>
        </View>
        <View
          className={`ag-tab ${doc === 'privacy' ? 'on' : ''}`}
          onClick={() => setDoc('privacy')}
          ariaRole="radio"
          ariaLabel="隐私政策"
          ariaChecked={doc === 'privacy'}
        >
          <Text>隐私政策</Text>
        </View>
      </View>

      <View className="page-pad">
        <Text className="ag-updated">
          生效版本 {DOC_VERSION} · 更新日期 {DOC_UPDATED_AT}
        </Text>
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
