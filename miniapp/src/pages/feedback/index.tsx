import { useState } from 'react'
import { Input, Text, Textarea, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import Icon from '@/components/Icon'
import { api, isLoggedIn, type FeedbackCategory } from '@/lib/api'
import './index.scss'

const CATEGORIES: FeedbackCategory[] = [
  '功能建议',
  '使用困难',
  '内容问题',
  '违规举报',
  '其他',
]

const MIN_LEN = 5
const MAX_LEN = 1000

export default function FeedbackPage() {
  const [category, setCategory] = useState<FeedbackCategory>('功能建议')
  const [content, setContent] = useState('')
  const [contact, setContact] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)

  const backProfile = () => {
    Taro.redirectTo({ url: '/pages/profile/index' })
  }

  async function submit() {
    if (sending) return
    if (!isLoggedIn()) {
      Taro.reLaunch({ url: '/pages/login/index' })
      return
    }
    const text = content.trim()
    if (text.length < MIN_LEN) {
      setError(`请至少写 ${MIN_LEN} 个字，方便我们理解问题`)
      return
    }
    setSending(true)
    setError('')
    try {
      await api.submitFeedback({
        category,
        content: text,
        contact: contact.trim(),
        page: 'feedback',
      })
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : '提交失败，请稍后再试')
    } finally {
      setSending(false)
    }
  }

  if (done) {
    return (
      <View className="page fb-page">
        <View className="fb-top">
          <View className="fb-back" onClick={backProfile} ariaRole="button" ariaLabel="返回我的">
            <Icon name="arrow-left" size={36} />
          </View>
          <Text className="fb-top-title">意见反馈</Text>
          <View className="fb-top-spacer" />
        </View>
        <View className="page-pad">
          <View className="fb-done card-lg">
            <View className="fb-done-icon">
              <Icon name="circle-check" size={56} color="#23795a" />
            </View>
            <Text className="fb-done-title">已收到您的反馈</Text>
            <Text className="fb-done-text">
              我们会在后台逐条查看。涉及安全或隐私的问题会优先处理；如需回复，我们会通过您留下的联系方式联系您。
            </Text>
            <View className="btn-primary fb-done-btn" onClick={backProfile}>
              返回我的
            </View>
          </View>
        </View>
      </View>
    )
  }

  return (
    <View className="page fb-page">
      <View className="fb-top">
        <View className="fb-back" onClick={backProfile} ariaRole="button" ariaLabel="返回我的">
          <Icon name="arrow-left" size={36} />
        </View>
        <Text className="fb-top-title">意见反馈</Text>
        <View className="fb-top-spacer" />
      </View>

      <View className="page-pad">
        <Text className="fb-intro">
          遇到问题、想提建议，或发现不当内容，都可以在这里告诉我们。
        </Text>

        <Text className="fb-label">反馈类型</Text>
        <View className="fb-chips">
          {CATEGORIES.map((item) => (
            <View
              key={item}
              className={`fb-chip ${category === item ? 'on' : ''}`}
              onClick={() => {
                setCategory(item)
                setError('')
              }}
              ariaRole="button"
              ariaLabel={`选择反馈类型：${item}`}
            >
              <Text>{item}</Text>
            </View>
          ))}
        </View>

        <Text className="fb-label">具体内容</Text>
        <Textarea
          className="fb-textarea"
          value={content}
          maxlength={MAX_LEN}
          placeholder="请描述发生了什么、在哪里遇到，以及您希望怎么改进。"
          onInput={(e) => {
            setContent(e.detail.value)
            setError('')
          }}
        />
        <Text className="fb-counter">
          已写 {content.length} / {MAX_LEN} 字
        </Text>

        <Text className="fb-label">联系方式（选填）</Text>
        <Input
          className="fb-input"
          value={contact}
          maxlength={100}
          placeholder="邮箱或手机号，方便我们回复"
          onInput={(e) => setContact(e.detail.value)}
        />

        <View className="fb-legal">
          <Text>提交即表示同意</Text>
          <Text
            className="fb-link"
            onClick={() => Taro.navigateTo({ url: '/pages/agreement/index?type=terms' })}
          >
            《用户协议》
          </Text>
          <Text>与</Text>
          <Text
            className="fb-link"
            onClick={() => Taro.navigateTo({ url: '/pages/agreement/index?type=privacy' })}
          >
            《隐私政策》
          </Text>
        </View>

        {error ? <Text className="fb-error">{error}</Text> : null}

        <View
          className={`btn-primary fb-submit ${sending ? 'busy' : ''}`}
          onClick={submit}
          ariaRole="button"
          ariaLabel="提交反馈"
        >
          {sending ? '提交中…' : '提交反馈'}
        </View>
      </View>
    </View>
  )
}
