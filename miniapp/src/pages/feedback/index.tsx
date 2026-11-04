import { useState } from 'react'
import { Input, Text, Textarea, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import Icon from '@/components/Icon'
import { Button, Card, StateBlock, TopBar } from '@/components/ui'
import { THEME } from '@/lib/theme'
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
      <View className="page">
        <TopBar title="意见反馈" onBack={backProfile} backLabel="返回我的" />
        <View className="page-pad">
          <Card className="fb-done">
            <View className="fb-done-icon">
              <Icon name="circle-check" size={56} color={THEME.green} />
            </View>
            <Text className="fb-done-title">已收到您的反馈</Text>
            <Text className="fb-done-text">
              我们会在后台逐条查看。涉及安全或隐私的问题会优先处理；如需回复，我们会通过您留下的联系方式联系您。
            </Text>
            <Button variant="primary" block className="fb-done-btn" onClick={backProfile}>
              返回我的
            </Button>
          </Card>
        </View>
      </View>
    )
  }

  return (
    <View className="page">
      <TopBar title="意见反馈" onBack={backProfile} backLabel="返回我的" />

      <View className="page-pad">
        <Text className="fb-intro">
          遇到问题、想提建议，或发现不当内容，都可以在这里告诉我们。
        </Text>

        <Text className="fb-label">反馈类型</Text>
        <View className="fb-chips" ariaRole="radiogroup" ariaLabel="反馈类型">
          {CATEGORIES.map((item) => (
            <View
              key={item}
              className={`fb-chip ${category === item ? 'on' : ''}`}
              onClick={() => {
                setCategory(item)
                setError('')
              }}
              ariaRole="radio"
              ariaLabel={item}
              ariaChecked={category === item}
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
          ariaLabel="反馈的具体内容"
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
          ariaLabel="联系方式，选填"
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

        {error ? <StateBlock variant="error" compact title={error} /> : null}

        <Button
          variant="primary"
          block
          disabled={sending}
          className="fb-submit"
          ariaLabel="提交反馈"
          onClick={submit}
        >
          {sending ? '提交中…' : '提交反馈'}
        </Button>
      </View>
    </View>
  )
}
