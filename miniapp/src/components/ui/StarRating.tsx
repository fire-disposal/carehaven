import { Text, View } from '@tarojs/components'
import Icon from '@/components/Icon'
import { THEME } from '@/lib/theme'
import './StarRating.scss'

interface StarRatingProps {
  value: number
  onChange: (value: number) => void
  labels?: string[]
  /** 读屏用：这组星星在评价什么 */
  ariaLabel?: string
  disabled?: boolean
  className?: string
}

const DEFAULT_LABELS = ['很糟', '较差', '一般', '较好', '很好']

/**
 * 星级选择：既是可点区域（≥88rpx），也有 radiogroup 语义。
 * 选中不仅靠颜色，还加粗并显示实心星。
 */
export default function StarRating({
  value,
  onChange,
  labels = DEFAULT_LABELS,
  ariaLabel = '评分',
  disabled = false,
  className = '',
}: StarRatingProps) {
  return (
    <View className={`ui-stars ${className}`.trim()} ariaRole="radiogroup" ariaLabel={ariaLabel}>
      {labels.map((label, index) => {
        const score = index + 1
        const active = value >= score
        return (
          <View
            key={score}
            className={`ui-stars__item ${active ? 'is-on' : ''}`}
            onClick={disabled ? undefined : () => onChange(score)}
            ariaRole="radio"
            ariaLabel={`${score} 星 ${label}`}
            ariaChecked={value === score}
          >
            <Icon name="star" size={40} color={active ? THEME.yellow : THEME.starOff} />
            <Text className="ui-stars__label">{label}</Text>
          </View>
        )
      })}
    </View>
  )
}
