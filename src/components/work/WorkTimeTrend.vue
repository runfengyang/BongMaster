<template>
  <div class="work-time-trend">
    <div class="work-time-plot">
      <div ref="canvasRef" class="work-time-canvas">
        <svg :viewBox="`0 0 ${size.width} ${size.height}`" preserveAspectRatio="none" role="img" aria-label="近 30 天上班和下班时间趋势">
          <line
            v-for="tick in ticks"
            :key="`grid-${tick.minutes}`"
            :x1="plot.left"
            :x2="plot.right"
            :y1="tick.y"
            :y2="tick.y"
            class="work-time-grid"
            vector-effect="non-scaling-stroke"
          />
          <line
            v-if="standardStartY !== null"
            :x1="plot.left"
            :x2="plot.right"
            :y1="standardStartY"
            :y2="standardStartY"
            class="work-time-standard"
            vector-effect="non-scaling-stroke"
          />
          <line
            v-if="standardEndY !== null"
            :x1="plot.left"
            :x2="plot.right"
            :y1="standardEndY"
            :y2="standardEndY"
            class="work-time-standard"
            vector-effect="non-scaling-stroke"
          />

          <defs>
            <linearGradient id="workTimeBandGradient" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stop-color="#4364c9" stop-opacity="0.10" />
              <stop offset="100%" stop-color="#c97b5a" stop-opacity="0.06" />
            </linearGradient>
          </defs>

          <path
            v-for="(d, index) in bandPaths"
            :key="`band-${index}`"
            :d="d"
            fill="url(#workTimeBandGradient)"
            class="work-time-band"
          />
          <line
            v-for="line in averageLines"
            :key="`avg-${line.key}`"
            :x1="plot.left"
            :x2="plot.right"
            :y1="line.y"
            :y2="line.y"
            :class="['work-time-average', line.key]"
            vector-effect="non-scaling-stroke"
          />
          <path
            v-for="path in maSeries"
            :key="`ma-${path.key}`"
            :d="path.d"
            :class="['work-time-ma', path.key]"
            vector-effect="non-scaling-stroke"
          />

          <g v-if="histogram.length" class="work-time-hist">
            <line :x1="histSepX" :x2="histSepX" :y1="plot.top - 2" :y2="plot.bottom" class="work-time-hist-sep" vector-effect="non-scaling-stroke" />
            <line :x1="histCenterX" :x2="histCenterX" :y1="plot.top" :y2="plot.bottom" class="work-time-hist-sep" vector-effect="non-scaling-stroke" />
            <text :x="histCenterX" :y="plot.top - 3" text-anchor="middle" class="work-time-hist-label">分布</text>
            <rect
              v-for="bar in histogram"
              :key="`hist-${bar.key}-${bar.bin}`"
              :x="bar.x"
              :y="bar.y"
              :width="bar.width"
              :height="bar.height"
              :rx="bar.height / 2"
              :fill="bar.key === 'in' ? '#4364c9' : '#c97b5a'"
              opacity=".52"
            />
          </g>

          <path
            v-for="path in series"
            :key="path.key"
            :d="path.d"
            :class="['work-time-line', path.key]"
            fill="none"
            vector-effect="non-scaling-stroke"
          />

          <circle
            v-for="point in points"
            :key="`${point.key}-${point.date}`"
            :cx="point.x"
            :cy="point.y"
            :r="point.isToday ? 2.8 : 1.8"
            :class="['work-time-dot', point.key, { 'is-today': point.isToday }]"
            vector-effect="non-scaling-stroke"
          />

          <line
            v-if="hoveredBar"
            :x1="hoveredBar.x"
            :x2="hoveredBar.x"
            :y1="plot.top"
            :y2="plot.bottom"
            class="work-time-crosshair"
            vector-effect="non-scaling-stroke"
          />
          <circle
            v-if="hoveredIn"
            :cx="hoveredBar.x"
            :cy="hoveredIn.y"
            r="3.2"
            class="work-time-dot in is-hovered"
            vector-effect="non-scaling-stroke"
          />
          <circle
            v-if="hoveredOut"
            :cx="hoveredBar.x"
            :cy="hoveredOut.y"
            r="3.2"
            class="work-time-dot out is-hovered"
            vector-effect="non-scaling-stroke"
          />
        </svg>

        <div class="work-time-hit" :style="hitStyle">
          <button
            v-for="bar in bars"
            :key="`hit-${bar.date}`"
            type="button"
            tabindex="-1"
            :aria-label="`${bar.monthDay} ${weekdayLabel(bar.weekday)}`"
            @mouseenter="hoveredDate = bar.date"
            @mouseleave="clearHover(bar.date)"
            @focus="hoveredDate = bar.date"
            @blur="clearHover(bar.date)"
          />
        </div>

        <div class="work-time-ticks" aria-hidden="true">
          <span v-for="tick in ticks" :key="`tick-${tick.minutes}`" :style="{ top: tick.topPercent }">{{ tick.label }}</span>
        </div>

        <Transition name="tip">
          <div v-if="hoveredBar" class="work-time-tip" :style="tipStyle">
            <div class="work-time-tip-inner">
              <div class="tip-line">
                <strong>{{ hoveredBar.monthDay }}</strong>
                <span class="tip-week">{{ weekdayLabel(hoveredBar.weekday) }}</span>
                <span class="tip-times" v-if="hoveredBar.inTime">{{ hoveredBar.inTime }}–{{ hoveredBar.outTime || '未下班' }}</span>
                <span class="tip-main" v-if="hoveredBar.minutes > 0">{{ durationLabel(hoveredBar.minutes) }}</span>
              </div>
              <div v-if="hoveredBar.minutes > 0 && (hoveredBar.overtimeMinutes || hoveredBar.lateMinutes || hoveredBar.earlyMinutes)" class="tip-tags">
                <span v-if="hoveredBar.overtimeMinutes" class="is-ot">加班 {{ durationLabel(hoveredBar.overtimeMinutes) }}</span>
                <span v-if="hoveredBar.lateMinutes" class="is-late">迟到 {{ hoveredBar.lateMinutes }}分</span>
                <span v-if="hoveredBar.earlyMinutes" class="is-early">早退 {{ hoveredBar.earlyMinutes }}分</span>
              </div>
              <div v-if="!hoveredBar.inTime" class="tip-empty">无打卡记录</div>
            </div>
          </div>
        </Transition>

        <p v-if="!hasData" class="work-time-hint">近 30 天还没有打卡时间</p>
      </div>
      <div class="work-time-axis" aria-hidden="true">
        <span v-for="bar in labeledBars" :key="bar.date" :style="{ left: bar.labelPercent }">{{ bar.label }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { formatWorkDuration, visibleTrendItems } from '@utils/work-attendance.js'

const props = defineProps({
  trend: { type: Object, required: true },
  settings: { type: Object, default: () => ({}) }
})

const canvasRef = ref(null)
const size = reactive({ width: 360, height: 88 })
let observer = null

const MARGIN = { left: 30, right: 170, top: 8, bottom: 8 }

const plot = computed(() => ({
  left: MARGIN.left,
  right: Math.max(MARGIN.left + 80, size.width - MARGIN.right),
  top: MARGIN.top,
  bottom: Math.max(MARGIN.top + 48, size.height - MARGIN.bottom)
}))

const parseMinutes = value => {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/)
  if (!match) return null
  const minutes = Number(match[1]) * 60 + Number(match[2])
  return Number.isFinite(minutes) ? minutes : null
}

const items = computed(() => visibleTrendItems(props.trend))

const domain = computed(() => {
  const values = items.value.flatMap(item => [
    parseMinutes(item.checkInTime),
    parseMinutes(item.checkOutTime)
  ]).filter(value => value !== null)
  const baseMin = values.length ? Math.min(...values) : 8 * 60
  const baseMax = values.length ? Math.max(...values) : 19 * 60
  let min = Math.floor(baseMin / 60) * 60 - 60
  let max = Math.ceil(baseMax / 60) * 60 + 60
  min = Math.max(5 * 60, min)
  max = Math.min(24 * 60, max)
  if (max - min < 4 * 60) {
    const mid = (min + max) / 2
    min = Math.max(5 * 60, Math.floor(mid / 60) * 60 - 120)
    max = Math.min(24 * 60, Math.ceil(mid / 60) * 60 + 120)
  }
  return { min, max }
})

const toY = minutes => {
  const clamped = Math.max(domain.value.min, Math.min(domain.value.max, minutes))
  const ratio = (clamped - domain.value.min) / (domain.value.max - domain.value.min)
  return plot.value.top + ratio * (plot.value.bottom - plot.value.top)
}

const hoveredDate = ref(null)
const clearHover = date => {
  if (hoveredDate.value === date) hoveredDate.value = null
}

const ticks = computed(() => {
  const span = (domain.value.max - domain.value.min) / 60
  const step = span > 12 ? 3 : span > 8 ? 2 : 1
  const start = Math.ceil(domain.value.min / 60 / step) * step * 60
  const result = []
  for (let minutes = start; minutes <= domain.value.max; minutes += step * 60) {
    const y = toY(minutes)
    const hour = Math.floor(minutes / 60)
    result.push({
      minutes,
      label: `${String(hour).padStart(2, '0')}:00`,
      y,
      topPercent: `${(y / size.height) * 100}%`
    })
  }
  return result
})

const standardY = raw => {
  const minutes = parseMinutes(raw)
  if (minutes === null || minutes < domain.value.min || minutes > domain.value.max) return null
  return toY(minutes)
}
const standardStartY = computed(() => standardY(props.settings?.work_start || '09:00'))
const standardEndY = computed(() => standardY(props.settings?.work_end || '18:00'))

const bars = computed(() => {
  const rows = items.value
  const width = plot.value.right - plot.value.left
  const step = width / Math.max(1, rows.length)
  return rows.map((item, index) => {
    const inMinutes = parseMinutes(item.checkInTime)
    const outMinutes = parseMinutes(item.checkOutTime)
    const x = plot.value.left + index * step + step / 2
    return {
      ...item,
      index,
      x,
      inTime: item.checkInTime || '',
      outTime: item.checkOutTime || '',
      inY: inMinutes === null ? null : toY(inMinutes),
      outY: outMinutes === null ? null : toY(outMinutes),
      labelPercent: `${(x / size.width) * 100}%`,
      showLabel: index % 5 === 0 || index === rows.length - 1
    }
  })
})

const labeledBars = computed(() => bars.value.filter(bar => bar.showLabel))
const hasData = computed(() => bars.value.some(bar => bar.inTime || bar.outTime))

const hoveredBar = computed(() => bars.value.find(bar => bar.date === hoveredDate.value) || null)
const hoveredIn = computed(() => hoveredBar.value && hoveredBar.value.inY !== null ? { y: hoveredBar.value.inY } : null)
const hoveredOut = computed(() => hoveredBar.value && hoveredBar.value.outY !== null ? { y: hoveredBar.value.outY } : null)

const smoothSegment = points => {
  if (!points.length) return ''
  if (points.length === 1) return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`
  let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] || points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] || p2
    const c1x = p1.x + (p2.x - p0.x) / 6 * 0.8
    const c1y = p1.y + (p2.y - p0.y) / 6 * 0.8
    const c2x = p2.x - (p3.x - p1.x) / 6 * 0.8
    const c2y = p2.y - (p3.y - p1.y) / 6 * 0.8
    path += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
  }
  return path
}

const series = computed(() => {
  const build = key => {
    const segments = []
    let current = []
    for (const bar of bars.value) {
      const value = key === 'in' ? bar.inY : bar.outY
      if (value === null) {
        if (current.length) segments.push(current)
        current = []
        continue
      }
      current.push({ x: bar.x, y: value, index: bar.index })
    }
    if (current.length) segments.push(current)
    return segments.map(smoothSegment).filter(Boolean).join(' ')
  }
  return [
    { key: 'in', d: build('in') },
    { key: 'out', d: build('out') }
  ]
})

const bandPaths = computed(() => {
  const paths = []
  let segment = []
  const flush = () => {
    if (segment.length > 1) {
      const inPoints = segment.map(bar => ({ x: bar.x, y: bar.inY }))
      const outPoints = segment.map(bar => ({ x: bar.x, y: bar.outY })).reverse()
      const d = `${smoothSegment(inPoints)} L ${outPoints[0].x.toFixed(2)} ${outPoints[0].y.toFixed(2)} ${smoothSegment(outPoints).replace(/^M/, 'L')} Z`
      paths.push(d)
    }
    segment = []
  }
  for (const bar of bars.value) {
    if (bar.inY === null || bar.outY === null) flush()
    else segment.push(bar)
  }
  flush()
  return paths
})

const averageLines = computed(() => {
  const result = []
  for (const key of ['in', 'out']) {
    const values = bars.value
      .map(bar => key === 'in' ? bar.inY : bar.outY)
      .filter(value => value !== null)
    if (!values.length) continue
    result.push({ key, y: values.reduce((sum, value) => sum + value, 0) / values.length })
  }
  return result
})

const maSeries = computed(() => {
  const build = key => {
    const segments = []
    let current = []
    bars.value.forEach((bar, index) => {
      const windowValues = bars.value
        .slice(Math.max(0, index - 4), index + 1)
        .map(item => key === 'in' ? item.inY : item.outY)
        .filter(value => value !== null)
      const value = windowValues.length
        ? windowValues.reduce((sum, item) => sum + item, 0) / windowValues.length
        : null
      if (value === null) {
        if (current.length) segments.push(current)
        current = []
        return
      }
      current.push({ x: bar.x, y: value })
    })
    if (current.length) segments.push(current)
    return segments.map(smoothSegment).filter(Boolean).join(' ')
  }
  return [
    { key: 'in', d: build('in') },
    { key: 'out', d: build('out') }
  ]
})

const histSepX = computed(() => plot.value.right + 12)
const histCenterX = computed(() => plot.value.right + 70)

const histogram = computed(() => {
  const bins = Array.from({ length: 7 }, () => ({ in: 0, out: 0 }))
  const span = (domain.value.max - domain.value.min) / 7
  const bucket = value => Math.min(6, Math.max(0, Math.floor((value - domain.value.min) / span)))
  bars.value.forEach(bar => {
    const inMinutes = parseMinutes(bar.inTime)
    const outMinutes = parseMinutes(bar.outTime)
    if (inMinutes !== null) bins[bucket(inMinutes)].in += 1
    if (outMinutes !== null) bins[bucket(outMinutes)].out += 1
  })
  const maxCount = Math.max(...bins.flatMap(bin => [bin.in, bin.out]), 1)
  const result = []
  bins.forEach((bin, index) => {
    const cy = toY(domain.value.min + span * (index + 0.5))
    const inWidth = Math.max(1, (bin.in / maxCount) * 42)
    const outWidth = Math.max(1, (bin.out / maxCount) * 42)
    result.push({ bin: index, key: 'in', x: histCenterX.value - inWidth, y: cy - 4.5, width: inWidth, height: 9 })
    result.push({ bin: index, key: 'out', x: histCenterX.value + 2, y: cy - 4.5, width: outWidth, height: 9 })
  })
  return result
})

const points = computed(() => bars.value.flatMap(bar => {
  const result = []
  if (bar.inY !== null) result.push({ key: 'in', date: bar.date, x: bar.x, y: bar.inY, isToday: bar.isToday })
  if (bar.outY !== null) result.push({ key: 'out', date: bar.date, x: bar.x, y: bar.outY, isToday: bar.isToday })
  return result
}))

const tipStyle = computed(() => {
  const bar = hoveredBar.value
  if (!bar) return {}
  const anchor = bar.outY !== null ? Math.max(bar.inY ?? 0, bar.outY) : (bar.inY ?? plot.value.top)
  return {
    left: `${Math.min(84, Math.max(16, (bar.x / size.width) * 100))}%`,
    top: `${(anchor / size.height) * 100}%`,
    transform: anchor < size.height * 0.45 ? 'translate(-50%, 10px)' : 'translate(-50%, calc(-100% - 8px))'
  }
})

const hitStyle = computed(() => ({
  left: `${(plot.value.left / size.width) * 100}%`,
  right: `${((size.width - plot.value.right) / size.width) * 100}%`
}))

const durationLabel = minutes => formatWorkDuration(minutes)
const weekdayNames = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日']
const weekdayLabel = weekday => weekdayNames[weekday] || ''

onMounted(() => {
  if (typeof ResizeObserver === 'undefined' || !canvasRef.value) return
  observer = new ResizeObserver(entries => {
    const rect = entries[0]?.contentRect
    if (!rect || rect.width <= 0 || rect.height <= 0) return
    size.width = Math.round(rect.width)
    size.height = Math.round(rect.height)
  })
  observer.observe(canvasRef.value)
})

onUnmounted(() => {
  if (observer) observer.disconnect()
})
</script>

<style scoped>
.work-time-trend { flex: 1 1 auto; display: flex; min-height: 110px; }
.work-time-plot { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.work-time-canvas { position: relative; flex: 1 1 auto; min-height: 0; }
.work-time-trend svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  overflow: visible;
  animation: workTimeReveal 340ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes workTimeReveal {
  from { clip-path: inset(0 100% 0 0); }
  to { clip-path: inset(0 0 0 0); }
}

.work-time-grid { stroke: #f3f1ec; stroke-width: 1; }
.work-time-standard { stroke: #d9d4ca; stroke-width: 1; stroke-dasharray: 2 4; }

.work-time-line { stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.work-time-line.in { stroke: #4364c9; }
.work-time-line.out { stroke: #c97b5a; }

.work-time-dot { stroke: #fffdf9; stroke-width: 0.9; }
.work-time-dot.in { fill: #4364c9; }
.work-time-dot.out { fill: #c97b5a; }
.work-time-dot.is-today { stroke-width: 1.5; }
.work-time-dot.is-hovered { stroke-width: 1.6; }

.work-time-band { opacity: .9; }
.work-time-average { stroke-width: 1; stroke-dasharray: 2 4; opacity: .55; }
.work-time-average.in { stroke: #8fa4dc; }
.work-time-average.out { stroke: #dfb39d; }
.work-time-ma { fill: none; stroke-width: 1.2; stroke-dasharray: 3 3; opacity: .75; }
.work-time-ma.in { stroke: #6b7da6; }
.work-time-ma.out { stroke: #b98a72; }
.work-time-hist-sep { stroke: #ece7df; stroke-width: 1; }
.work-time-hist-label { fill: #a8a198; font-size: 8px; }

.work-time-crosshair { stroke: #c9c1b4; stroke-width: 0.7; stroke-dasharray: 2 3; }

.work-time-hit { position: absolute; top: 0; bottom: 0; display: flex; }
.work-time-hit button { flex: 1 1 0; min-width: 0; padding: 0; border: 0; background: transparent; cursor: default; }

.work-time-ticks { position: absolute; top: 0; bottom: 0; right: 0; width: 38px; pointer-events: none; }
.work-time-ticks span { position: absolute; right: 0; transform: translateY(-50%); color: #a8a198; font-size: 9px; font-variant-numeric: tabular-nums; line-height: 1; white-space: nowrap; }

.work-time-axis { position: relative; height: 13px; margin-top: 3px; }
.work-time-axis span { position: absolute; top: 0; transform: translateX(-50%); color: #a8a198; font-size: 10px; line-height: 1; white-space: nowrap; }

.work-time-hint { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; color: #a8a198; font-size: 11px; }

.work-time-tip { position: absolute; z-index: 4; pointer-events: none; }
.work-time-tip-inner { min-width: 128px; padding: 7px 9px; border: 1px solid rgb(60 50 35 / 0.08); border-radius: 8px; background: rgb(255 253 249 / 0.97); box-shadow: 0 6px 20px rgb(60 50 35 / 0.12); backdrop-filter: blur(8px); }
.tip-enter-from .work-time-tip-inner,
.tip-leave-to .work-time-tip-inner { opacity: 0; transform: translateY(3px) scale(0.96); }
.tip-line { display: flex; align-items: baseline; gap: 5px; white-space: nowrap; }
.tip-line strong { font-size: 11px; font-weight: 600; color: #2d2822; }
.tip-week { color: #9b948a; font-size: 9px; }
.tip-times { color: #4364c9; font-size: 10px; font-variant-numeric: tabular-nums; }
.tip-main { color: #2d2822; font-size: 10px; font-weight: 600; }
.tip-tags { display: flex; gap: 5px; margin-top: 4px; }
.tip-tags span { padding: 1px 4px; border-radius: 3px; font-size: 9px; line-height: 1.4; }
.tip-tags .is-ot { background: #f7efe6; color: #9a6a3f; }
.tip-tags .is-late { background: #f8ebe8; color: #a25743; }
.tip-tags .is-early { background: #edf0f8; color: #4f629e; }
.tip-empty { margin-top: 2px; color: #9b948a; font-size: 10px; }

@media (prefers-reduced-motion: reduce) {
  .work-time-trend svg { animation: none; }
}
</style>
