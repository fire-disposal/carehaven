import type { CSSProperties } from 'react'
import { Text, View } from '@tarojs/components'
import type { PhaseKind } from '@/lib/guide'
import './BreathingOrb.scss'

interface BreathingOrbProps {
  kind: PhaseKind
  seconds: number
  /** 屏息阶段的保持缩放：吸气后保持大、呼气后保持小 */
  holdScale?: number
  paused?: boolean
  label: string
  remaining: number
}

/**
 * 呼吸动画的唯一实现。页面只传「阶段 + 时长」，换课程/换文案都不动动画。
 * 屏息与提示阶段用静态缩放，避免动画结束后跳变。
 */
export default function BreathingOrb({ kind, seconds, holdScale = 1, paused, label, remaining }: BreathingOrbProps) {
  const animating = kind === 'inhale' || kind === 'exhale'
  const motionClass = kind === 'inhale' ? 'inhale' : kind === 'exhale' ? 'exhale' : 'held'
  const style = {
    '--dur': `${seconds}s`,
    '--hold': String(holdScale),
  } as CSSProperties & Record<'--dur' | '--hold', string>

  return (
    <View className="orb-stage">
      <View className="orb-ring orb-ring--outer" />
      <View className={`orb ${motionClass}${paused ? ' paused' : ''}`} style={animating ? style : { transform: `scale(${holdScale})` }} />
      <View className="orb-core">
        <Text className="orb-phase">{label}</Text>
        <Text className="orb-count">{remaining}</Text>
      </View>
    </View>
  )
}
