import { Text, View } from '@tarojs/components'
import type { GuideScript } from '@/lib/guide'
import './PhaseTrack.scss'

interface PhaseTrackProps {
  script: GuideScript
  index: number
}

const PHASE_LABEL: Record<string, string> = {
  inhale: '吸',
  exhale: '呼',
  hold: '停',
  rest: '停',
  prompt: '',
}

/**
 * 阶段进度：呼吸课显示四拍循环，其他课程显示编号步骤。
 * 只承担「当前在第几段」，不解释课程内容。
 */
export default function PhaseTrack({ script, index }: PhaseTrackProps) {
  const breathing = script.scene === 'breath'
  const items = breathing ? script.phases.slice(0, 4) : script.phases
  const active = breathing ? index % 4 : index

  return (
    <View className="phase-track" ariaHidden>
      {items.map((phase, i) => (
        <View key={i} className={`phase-seg${i === active ? ' on' : ''}${i < active ? ' done' : ''}`}>
          {breathing ? (
            <Text className="phase-seg-text">{PHASE_LABEL[phase.kind] || ''}</Text>
          ) : (
            <Text className="phase-seg-text">{i + 1}</Text>
          )}
        </View>
      ))}
    </View>
  )
}
