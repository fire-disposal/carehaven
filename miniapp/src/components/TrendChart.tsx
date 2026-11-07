import { Canvas, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import { THEME } from '@/lib/theme'
import './TrendChart.scss'

export interface TrendPoint {
  /** 短横轴标签，如 '11/7' */
  label: string
  /** 完整日期描述，如 '11月7日'，用于无障碍与选中态 */
  dateLabel: string
  /** 0–100；null = 当天无数据（断线，不补 0） */
  value: number | null
}

interface TrendChartProps {
  points: TrendPoint[]
  /** 当前选中下标；-1 表示无选中 */
  active: number
  onSelect: (index: number) => void
  /** 可选均值；提供时画一条虚线 */
  average?: number | null
  className?: string
}

/** canvas 节点的最小必要类型（@tarojs/components 没有导出 Canvas 节点类型） */
type CanvasNode = {
  width: number
  height: number
  /** H5 的 DOM canvas 有 style；小程序节点没有 */
  style?: { width: string; height: string }
  getContext: (type: '2d') => CanvasRenderingContext2D | null
}

const CANVAS_ID = 'trend-chart-canvas'
/** 750 设计稿单位 */
const HEIGHT = 420
const Y_MAX = 100
/** 折线宽 4rpx：按 rpx 系数换算，窄屏上不会被画成 4 CSS px */
const LINE_RPX = 4
const PAD_TOP = 18
const PAD_LEFT = 34 // 左侧留给 y 轴刻度
const PAD_RIGHT = 12
const PAD_BOTTOM = 34 // 底部留给横轴日期，不能再让文字贴着画布下沿
const MAX_LABELS = 5
/** canvas fillText 不支持 rpx，标签按 24rpx（≈12px @375）换算后取整 */
const LABEL_FONT = 12
const LABEL_COLOR = THEME.muted
const GRID_COLOR = THEME.line
const LINE_COLOR = THEME.primary
const AVERAGE_COLOR = THEME.muted
const DOT_FILL = THEME.white
const DOT_STROKE = THEME.primary
const ACTIVE_RING = THEME.primaryLight
/** primary 的 12% 透明态；canvas 没有颜色混合 API，这里只能写成 rgba */
const FILL_TOP = 'rgba(62, 95, 75, 0.12)'
const FILL_BOTTOM = 'rgba(62, 95, 75, 0)'

interface Geometry {
  /** 画布 CSS 尺寸（px） */
  width: number
  height: number
  /** 数据区的 CSS 边界 */
  left: number
  right: number
  top: number
  bottom: number
  /** 1rpx 对应的 CSS px，线条与圆点尺寸按它换算 */
  unit: number
}

/** canvas onTap 的最小事件形状：detail 给坐标，touches 兜底 */
type TrendTapEvent = {
  detail?: { x?: number; y?: number }
  touches?: Array<{ x: number; y: number }>
}

interface Plotted {
  index: number
  x: number
  y: number
}

/** 只保留有数据的点：null 不参与折线，相邻有效点直接相连 */
function plottedPoints(points: TrendPoint[], geo: Geometry): Plotted[] {
  const n = points.length
  const list: Plotted[] = []
  for (let i = 0; i < n; i += 1) {
    const v = points[i].value
    if (v === null || Number.isNaN(v)) continue
    // 单点时落在中线，避免除零
    const t = n > 1 ? i / (n - 1) : 0.5
    const ratio = Math.min(Y_MAX, Math.max(0, v)) / Y_MAX
    list.push({
      index: i,
      x: geo.left + t * (geo.right - geo.left),
      y: geo.bottom - ratio * (geo.bottom - geo.top),
    })
  }
  return list
}

/**
 * Catmull-Rom 转三次贝塞尔：控制点由前后相邻点推出，
 * 张力取 1/6（标准 Catmull-Rom 的切线换算到贝塞尔手柄长度）。
 */
function traceSmoothLine(ctx: CanvasRenderingContext2D, pts: Plotted[]) {
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] || pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] || p2
    ctx.bezierCurveTo(
      p1.x + (p2.x - p0.x) / 6,
      p1.y + (p2.y - p0.y) / 6,
      p2.x - (p3.x - p1.x) / 6,
      p2.y - (p3.y - p1.y) / 6,
      p2.x,
      p2.y,
    )
  }
}

/** 横轴标签下标：首末必显示，中间均匀抽样，最多 5 个 */
function labelTicks(total: number): number[] {
  if (total <= 0) return []
  if (total <= MAX_LABELS) {
    // 点少于上限时全部显示，天然不重叠（间距 ≥ 一个点位）
    return Array.from({ length: total }, (_, i) => i)
  }
  const ticks: number[] = [0]
  // 中间均匀取样：总宽 / (count-1) 分段，取整后可能撞点，用循环跳过已占位
  for (let k = 1; k < MAX_LABELS - 1; k += 1) {
    const raw = Math.round((k * (total - 1)) / (MAX_LABELS - 1))
    if (raw > ticks[ticks.length - 1] && raw < total - 1) ticks.push(raw)
  }
  ticks.push(total - 1)
  return ticks
}

/** 虚线：小程序与浏览器对 setLineDash 的支持都已具备，但仍兜底成手绘线段 */
function dashedLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  dash = 8,
  gap = 6,
) {
  if (typeof ctx.setLineDash === 'function') {
    ctx.setLineDash([dash, gap])
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
    ctx.setLineDash([])
    return
  }
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len === 0) return
  const ux = dx / len
  const uy = dy / len
  ctx.beginPath()
  for (let d = 0; d < len; d += dash + gap) {
    const end = Math.min(d + dash, len)
    ctx.moveTo(x1 + ux * d, y1 + uy * d)
    ctx.lineTo(x1 + ux * end, y1 + uy * end)
  }
  ctx.stroke()
}

function draw(
  ctx: CanvasRenderingContext2D,
  points: TrendPoint[],
  active: number,
  average: number | null,
  geo: Geometry,
) {
  const { width, height, left, right, top, bottom } = geo
  ctx.clearRect(0, 0, width, height)

  // ---- 网格：0/25/50/75/100 四条内线 + 底轴，左侧标上刻度值 ----
  ctx.save()
  ctx.strokeStyle = GRID_COLOR
  ctx.lineWidth = 1
  for (let i = 1; i <= 4; i += 1) {
    const y = bottom - ((bottom - top) * i) / 4
    dashedLine(ctx, left, y, right, y, 6, 5)
  }
  ctx.globalAlpha = 0.6
  dashedLine(ctx, left, bottom, right, bottom, 6, 5)
  ctx.restore()

  ctx.save()
  ctx.fillStyle = LABEL_COLOR
  ctx.font = `11px sans-serif`
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let i = 0; i <= 4; i += 1) {
    const value = (Y_MAX * i) / 4
    const y = bottom - ((bottom - top) * i) / 4
    ctx.fillText(String(value), left - 8, y)
  }
  ctx.restore()

  // ---- 均值虚线 ----
  if (average !== null && !Number.isNaN(average)) {
    const ratio = Math.min(Y_MAX, Math.max(0, average)) / Y_MAX
    const y = bottom - ratio * (bottom - top)
    ctx.save()
    ctx.strokeStyle = AVERAGE_COLOR
    ctx.globalAlpha = 0.7
    ctx.lineWidth = 1.5
    dashedLine(ctx, left, y, right, y, 9, 7)
    ctx.fillStyle = AVERAGE_COLOR
    ctx.font = '11px sans-serif'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'bottom'
    ctx.fillText(`均值 ${Math.round(average)}`, right, y - 6)
    ctx.restore()
  }

  const pts = plottedPoints(points, geo)
  // 单点没有线段可走，退化成一条以该点为中心的短横线，面积也只填这一小段
  const halfSpan = 16 * Math.max(1, geo.unit)
  const singleBand =
    pts.length === 1
      ? {
          x0: Math.max(left, pts[0].x - halfSpan),
          x1: Math.min(right, pts[0].x + halfSpan),
        }
      : null

  // ---- 面积 + 折线 ----
  if (pts.length > 0) {
    ctx.save()
    const gradient = ctx.createLinearGradient(0, top, 0, bottom)
    gradient.addColorStop(0, FILL_TOP)
    gradient.addColorStop(1, FILL_BOTTOM)
    ctx.fillStyle = gradient
    ctx.beginPath()
    if (singleBand) {
      ctx.moveTo(singleBand.x0, pts[0].y)
      ctx.lineTo(singleBand.x1, pts[0].y)
      ctx.lineTo(singleBand.x1, bottom)
      ctx.lineTo(singleBand.x0, bottom)
    } else {
      traceSmoothLine(ctx, pts)
      ctx.lineTo(pts[pts.length - 1].x, bottom)
      ctx.lineTo(pts[0].x, bottom)
    }
    ctx.closePath()
    ctx.fill()

    ctx.strokeStyle = LINE_COLOR
    ctx.lineWidth = LINE_RPX * geo.unit
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.beginPath()
    if (singleBand) {
      ctx.moveTo(singleBand.x0, pts[0].y)
      ctx.lineTo(singleBand.x1, pts[0].y)
    } else {
      traceSmoothLine(ctx, pts)
    }
    ctx.stroke()
    ctx.restore()

    // ---- 数据点 ----
    pts.forEach((p) => {
      const isActive = p.index === active
      ctx.save()
      if (isActive) {
        ctx.beginPath()
        ctx.fillStyle = ACTIVE_RING
        ctx.arc(p.x, p.y, 9, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.beginPath()
      ctx.fillStyle = DOT_FILL
      ctx.strokeStyle = DOT_STROKE
      ctx.lineWidth = isActive ? 3 : 2
      ctx.arc(p.x, p.y, isActive ? 7 : 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.restore()
    })
  }

  // ---- 横轴标签：12px 等效，首末贴边内缩，中间居中 ----
  ctx.save()
  ctx.fillStyle = LABEL_COLOR
  ctx.font = `${LABEL_FONT}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const ticks = labelTicks(points.length)
  const labelY = bottom + (height - bottom) / 2
  const half = ctx.measureText('0/0').width / 2
  ticks.forEach((index, k) => {
    const text = points[index]?.label ?? ''
    if (!text) return
    const t = points.length > 1 ? index / (points.length - 1) : 0.5
    let x = left + t * (right - left)
    if (k === 0) x = Math.max(left + half, x)
    if (k === ticks.length - 1 && ticks.length > 1) x = Math.min(right - half, x)
    ctx.fillText(text, x, labelY)
  })
  ctx.restore()
}

export default function TrendChart(props: TrendChartProps) {
  const { points, active, onSelect, average = null, className = '' } = props
  const canvasRef = useRef<CanvasNode | null>(null)
  const geometryRef = useRef<Geometry | null>(null)
  const [unsupported, setUnsupported] = useState(false)
  const hasData = points.length > 0 && points.some((p) => p.value !== null)

  /** 用选择器量到的真实 CSS 尺寸建绘制几何；量不到才按 750 设计稿估算 */
  function resolveGeometry(
    canvas: CanvasNode,
    size?: { width?: number; height?: number },
  ): Geometry {
    const system = Taro.getSystemInfoSync()
    const dpr = system.pixelRatio && system.pixelRatio > 0 ? system.pixelRatio : 1
    const cssWidth =
      size?.width && size.width > 0
        ? size.width
        : canvas.width && canvas.width > 0
          ? canvas.width / dpr
          : system.windowWidth
    // 高度同样以量到的为准：宽屏下 Taro 会钳制 rpx 字号，windowWidth/750 的估算会翻倍
    const cssHeight =
      size?.height && size.height > 0 ? size.height : HEIGHT * (cssWidth / 750)
    // rpx 系数只用于线条粗细等相对量，跟随实际画布宽度
    const unit = cssWidth / 750

    canvas.width = Math.round(cssWidth * dpr)
    canvas.height = Math.round(cssHeight * dpr)
    // 缓冲区像素 ≠ 显示尺寸：显式钉住 style，避免 H5 按缓冲区大小放大并溢出卡片
    if (canvas.style) {
      canvas.style.width = `${cssWidth}px`
      canvas.style.height = `${cssHeight}px`
    }
    const ctx = canvas.getContext('2d')
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    return {
      width: cssWidth,
      height: cssHeight,
      left: PAD_LEFT,
      right: cssWidth - PAD_RIGHT,
      top: PAD_TOP,
      bottom: cssHeight - PAD_BOTTOM,
      unit,
    }
  }

  function render() {
    if (!hasData) return
    const canvas = canvasRef.current
    const geo = geometryRef.current
    if (!canvas || !geo) return
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      setUnsupported(true)
      return
    }
    draw(ctx, points, active, average, geo)
  }

  useEffect(() => {
    if (!hasData) {
      canvasRef.current = null
      return
    }
    const timer = setTimeout(() => {
      Taro.createSelectorQuery()
        .select(`#${CANVAS_ID}`)
        .fields({ node: true })
        .exec((res: unknown[]) => {
          const hit = Array.isArray(res) ? (res[0] as { node?: CanvasNode } | undefined) : undefined
          const node = hit?.node
          if (!node || typeof node.getContext !== 'function') {
            // 老基础库 / 非 2d 环境：静默降级
            setUnsupported(true)
            return
          }
          // 尺寸量外层容器：内层 canvas 的默认 150px 高度会把可用空间量小
          Taro.createSelectorQuery()
            .select('.trend-chart')
            .boundingClientRect()
            .exec((rectRes: unknown[]) => {
              const rect = Array.isArray(rectRes)
                ? (rectRes[0] as { width?: number; height?: number } | undefined)
                : undefined
              canvasRef.current = node
              geometryRef.current = resolveGeometry(node, rect)
              setUnsupported(false)
              render()
            })
        })
    }, 0)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, active, average])

  // 小程序页面切走再回来时 canvas 内容会丢，重新初始化一次
  useDidShow(() => {
    if (!canvasRef.current) return
    render()
  })

  /**
   * 点击取点：weapp 的 canvas onTap 在 detail 里给出相对画布的 CSS 坐标（x/y），
   * H5 端 Taro 同样映射 detail.x/detail.y；个别基础库只给 touches，做兜底。
   */
  function handleTap(e: TrendTapEvent) {
    const geo = geometryRef.current
    if (!geo) return
    const x = e.detail?.x ?? e.touches?.[0]?.x
    if (typeof x !== 'number') return
    const n = points.length
    if (n === 0) return
    const step = n > 1 ? (geo.right - geo.left) / (n - 1) : 0
    let best = -1
    let bestDist = Infinity
    points.forEach((p, i) => {
      if (p.value === null) return
      // 用同一套横向布点公式，保证点选与绘制位置一致
      const px = geo.left + (n > 1 ? i / (n - 1) : 0.5) * (geo.right - geo.left)
      const dist = Math.abs(px - x)
      if (dist < bestDist) {
        bestDist = dist
        best = i
      }
    })
    // 落点离最近有效点超过一格就视为误触
    if (best < 0) return
    if (step > 0 && bestDist > step) return
    onSelect(best)
  }

  const values = points.map((p) => p.value).filter((v): v is number => v !== null)
  const highest = values.length ? Math.max(...values) : 0
  const lowest = values.length ? Math.min(...values) : 0
  const ariaLabel =
    values.length > 0
      ? `近 ${points.length} 天压力趋势，最高 ${Math.round(highest)}，最低 ${Math.round(lowest)}`
      : `近 ${points.length} 天压力趋势`

  return (
    <View
      className={`trend-chart ${className}`.trim()}
      ariaRole="img"
      ariaLabel={ariaLabel}
    >
      {hasData ? (
        <>
          <Canvas
            type="2d"
            id={CANVAS_ID}
            canvasId={CANVAS_ID}
            className="trend-chart__canvas"
            onTap={handleTap}
          />
          {unsupported ? (
            <View className="trend-chart__fallback">
              <Text>当前环境不支持图表</Text>
            </View>
          ) : null}
        </>
      ) : (
        <View className="trend-chart__empty">
          <Text>还没有足够的数据画出趋势</Text>
        </View>
      )}
    </View>
  )
}
