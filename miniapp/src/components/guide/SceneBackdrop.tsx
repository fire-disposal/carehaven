import { View } from '@tarojs/components'
import type { SceneKind } from '@/lib/guide'
import './SceneBackdrop.scss'

/**
 * 场景背景：只负责氛围，不含文案与计时。
 * 新增场景时加一个 variant 类即可，页面结构不变。
 */
export default function SceneBackdrop({ scene }: { scene: SceneKind }) {
  if (scene === 'breath') {
    return (
      <View className="scene scene--breath" ariaHidden>
        <View className="scene-ring r1" />
        <View className="scene-ring r2" />
        <View className="scene-ring r3" />
      </View>
    )
  }
  if (scene === 'scan') {
    return (
      <View className="scene scene--scan" ariaHidden>
        <View className="scan-wash" />
        <View className="scan-dot d1" />
        <View className="scan-dot d2" />
        <View className="scan-dot d3" />
        <View className="scan-dot d4" />
      </View>
    )
  }
  return (
    <View className="scene scene--ground" ariaHidden>
      <View className="ground-line l1" />
      <View className="ground-line l2" />
      <View className="ground-line l3" />
      <View className="ground-glow" />
    </View>
  )
}
