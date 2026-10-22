import { useState } from 'react'
import { Input, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { login, register, wechatLogin } from '@/lib/api'
import './index.scss'

// 微信一键登录只在小程序端可用（网页端拿不到微信登录凭证），
// 因此在 H5 构建下这个入口整体不渲染。
const IS_WEAPP = Taro.getEnv() === Taro.ENV_TYPE.WEAPP

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const isRegister = mode === 'register'

  async function submit() {
    if (busy) return
    setError('')
    if (!email || !password) {
      setError('请填写邮箱和密码')
      return
    }
    if (isRegister && password.length < 8) {
      setError('密码至少 8 位')
      return
    }
    setBusy(true)
    try {
      if (isRegister) {
        await register(email, password, name || '照护者')
      } else {
        await login(email, password)
      }
      Taro.reLaunch({ url: '/pages/index/index' })
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  async function wechatAuth() {
    if (busy) return
    setError('')
    setBusy(true)
    try {
      const res = await Taro.login()
      if (!res.code) {
        throw new Error('未能获取微信登录凭证')
      }
      await wechatLogin(res.code)
      Taro.reLaunch({ url: '/pages/index/index' })
    } catch (e) {
      setError(e instanceof Error ? e.message : '微信登录失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View className="login">
      <View className="brand">
        <View className="brand-logo">
          <Text className="brand-seal">忆</Text>
        </View>
        <Text className="brand-kicker">CAREHAVEN · 照护者支持</Text>
        <Text className="brand-name">智护忆站</Text>
        <Text className="brand-slogan">把压力说出来，把照护分一点给自己。</Text>
      </View>

      {IS_WEAPP && (
        <View className="wechat-block">
          <View className={`btn-wechat ${busy ? 'busy' : ''}`} onClick={wechatAuth}>
            微信一键登录
          </View>
          <View className="divider">
            <View className="divider-line" />
            <Text className="divider-text">或使用邮箱登录</Text>
            <View className="divider-line" />
          </View>
        </View>
      )}

      <View className="card-lg form">
        <View className="field">
          <Text className="field-label">邮箱</Text>
          <Input
            className="field-input"
            type="text"
            value={email}
            placeholder="用于登录的邮箱"
            onInput={(e) => setEmail(e.detail.value)}
          />
        </View>

        {isRegister && (
          <View className="field">
            <Text className="field-label">称呼</Text>
            <Input
              className="field-input"
              type="text"
              value={name}
              placeholder="例如：李阿姨"
              onInput={(e) => setName(e.detail.value)}
            />
          </View>
        )}

        <View className="field">
          <Text className="field-label">密码</Text>
          <Input
            className="field-input"
            password
            value={password}
            placeholder={isRegister ? '至少 8 位' : '请输入密码'}
            onInput={(e) => setPassword(e.detail.value)}
          />
        </View>

        {error ? <Text className="error">{error}</Text> : null}

        <View className={`btn-primary submit ${busy ? 'busy' : ''}`} onClick={submit}>
          {busy ? '请稍候…' : isRegister ? '注册并登录' : '登录'}
        </View>

        <View className="switch" onClick={() => { setMode(isRegister ? 'login' : 'register'); setError('') }}>
          <Text>{isRegister ? '已有账号？去登录' : '还没有账号？注册一个'}</Text>
        </View>
      </View>

      <Text className="tip">我们只收集与压力评估相关的信息，不会用于其他用途。</Text>
      <View className="legal">
        <Text>登录即表示同意</Text>
        <Text
          className="legal-link"
          onClick={() => Taro.navigateTo({ url: '/pages/agreement/index?type=terms' })}
        >
          《用户协议》
        </Text>
        <Text>与</Text>
        <Text
          className="legal-link"
          onClick={() => Taro.navigateTo({ url: '/pages/agreement/index?type=privacy' })}
        >
          《隐私政策》
        </Text>
      </View>
    </View>
  )
}
