<template>
  <div class="trend-chart">
    <div class="chart-header">
      <h6 class="chart-title">近30天完成趋势</h6>
      <span class="chart-total">共 {{ total }} 个任务</span>
    </div>
    <div ref="chartBodyRef" class="chart-body">
      <svg
        v-if="containerWidth > 0"
        :width="containerWidth"
        :height="height"
        class="chart-svg"
        @mousemove="handleMouseMove"
        @mouseleave="handleMouseLeave"
      >
        <!-- Grid lines -->
        <g class="grid-lines">
          <line
            v-for="n in 5"
            :key="'grid-' + n"
            :x1="padding.left"
            :y1="padding.top + (chartHeight / 4) * (n - 1)"
            :x2="containerWidth - padding.right"
            :y2="padding.top + (chartHeight / 4) * (n - 1)"
            stroke="var(--color-border)"
            stroke-dasharray="2,2"
            opacity="0.5"
          />
        </g>

        <!-- Area path -->
        <path
          v-if="data.length > 0"
          :d="areaPath"
          fill="var(--color-primary)"
          fill-opacity="0.15"
        />

        <!-- Line path -->
        <path
          v-if="data.length > 0"
          :d="linePath"
          fill="none"
          stroke="var(--color-primary)"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />

        <!-- Data points -->
        <g v-if="data.length > 0">
          <circle
            v-for="(point, index) in points"
            :key="'point-' + index"
            :cx="point.x"
            :cy="point.y"
            r="4"
            fill="var(--color-primary)"
            stroke="white"
            stroke-width="2"
            class="data-point"
          />
        </g>

        <!-- Hover indicator -->
        <g v-if="hoverPoint">
          <line
            :x1="hoverPoint.x"
            :y1="padding.top"
            :x2="hoverPoint.x"
            :y2="padding.top + chartHeight"
            stroke="var(--color-text-muted)"
            stroke-dasharray="3,3"
            stroke-width="1"
          />
          <circle
            :cx="hoverPoint.x"
            :cy="hoverPoint.y"
            r="5"
            fill="var(--color-primary)"
            stroke="white"
            stroke-width="2"
          />
        </g>

        <!-- X-axis labels -->
        <g class="x-labels">
          <text
            v-for="(label, index) in xLabels"
            :key="'xlabel-' + index"
            :x="label.x"
            :y="height - padding.bottom + 15"
            text-anchor="middle"
            font-size="10"
            fill="var(--color-text-muted)"
          >{{ label.text }}</text>
        </g>
      </svg>
      <!-- Custom tooltip -->
      <div v-if="hoverPoint" class="chart-tooltip" :style="tooltipStyle">
        <div class="tooltip-date">{{ formatDate(hoverPoint.date) }}</div>
        <div class="tooltip-count">完成 {{ hoverPoint.count }} 个任务</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { format, parseISO } from 'date-fns'
import { zhCN } from 'date-fns/locale'

const props = defineProps({
  data: {
    type: Array,
    default: () => []
  }
})

const chartBodyRef = ref(null)
const containerWidth = ref(400)
const height = 150
const padding = { top: 10, right: 10, bottom: 25, left: 30 }

const chartWidth = computed(() => containerWidth.value - padding.left - padding.right)
const chartHeight = height - padding.top - padding.bottom

const updateWidth = () => {
  if (chartBodyRef.value) {
    containerWidth.value = Math.max(chartBodyRef.value.clientWidth, 300)
  }
}

onMounted(() => {
  updateWidth()
  window.addEventListener('resize', updateWidth)
})

onUnmounted(() => {
  window.removeEventListener('resize', updateWidth)
})

const total = computed(() => props.data.reduce((sum, d) => sum + d.count, 0))

const maxValue = computed(() => {
  const max = Math.max(...props.data.map(d => d.count))
  return max === 0 ? 1 : max
})

const points = computed(() => {
  if (props.data.length === 0) return []

  return props.data.map((d, i) => {
    const x = padding.left + (i / (props.data.length - 1)) * chartWidth.value
    const y = padding.top + chartHeight - (d.count / maxValue.value) * chartHeight
    return { x, y, date: d.date, count: d.count }
  })
})

const linePath = computed(() => {
  if (points.value.length === 0) return ''

  const p = points.value
  if (p.length === 1) {
    return `M ${p[0].x} ${p[0].y}`
  }

  let path = `M ${p[0].x} ${p[0].y}`

  for (let i = 0; i < p.length - 1; i++) {
    const curr = p[i]
    const next = p[i + 1]

    const cp1x = curr.x + (next.x - curr.x) / 3
    const cp1y = curr.y
    const cp2x = next.x - (next.x - curr.x) / 3
    const cp2y = next.y

    path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${next.x} ${next.y}`
  }

  return path
})

const areaPath = computed(() => {
  if (points.value.length === 0) return ''

  const p = points.value
  const bottomY = padding.top + chartHeight

  let path = `M ${p[0].x} ${bottomY}`
  path += ` L ${p[0].x} ${p[0].y}`

  for (let i = 0; i < p.length - 1; i++) {
    const curr = p[i]
    const next = p[i + 1]

    const cp1x = curr.x + (next.x - curr.x) / 3
    const cp1y = curr.y
    const cp2x = next.x - (next.x - curr.x) / 3
    const cp2y = next.y

    path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${next.x} ${next.y}`
  }

  path += ` L ${p[p.length - 1].x} ${bottomY}`
  path += ' Z'

  return path
})

const xLabels = computed(() => {
  if (props.data.length === 0) return []

  const labels = []
  const step = Math.ceil(props.data.length / 6)

  for (let i = 0; i < props.data.length; i += step) {
    const x = padding.left + (i / (props.data.length - 1)) * chartWidth.value
    const text = format(parseISO(props.data[i].date), 'MM/dd')
    labels.push({ x, text })
  }

  return labels
})

const formatDate = (dateStr) => {
  try {
    return format(parseISO(dateStr), 'yyyy年MM月dd日', { locale: zhCN })
  } catch {
    return dateStr
  }
}

// Hover tooltip
const hoverPoint = ref(null)
const tooltipStyle = ref({})

const handleMouseMove = (event) => {
  if (props.data.length === 0) return

  const svg = event.currentTarget
  const rect = svg.getBoundingClientRect()

  // Mouse position relative to SVG in pixel coordinates
  const mousePixelX = event.clientX - rect.left

  // Map pixel position to internal SVG coordinate space
  const scaleX = containerWidth.value / rect.width
  const svgInternalX = mousePixelX * scaleX

  // Find nearest point in internal coordinates
  let nearest = null
  let minDist = Infinity

  for (const p of points.value) {
    const dist = Math.abs(p.x - svgInternalX)
    if (dist < minDist) {
      minDist = dist
      nearest = p
    }
  }

  const segmentWidth = chartWidth.value / (props.data.length - 1 || 1)
  if (nearest && minDist <= segmentWidth / 2 + 10) {
    hoverPoint.value = nearest
    // Tooltip position: directly above the data point in screen pixels
    const pointPixelX = (nearest.x / containerWidth.value) * rect.width
    const pointPixelY = (nearest.y / height) * rect.height
    tooltipStyle.value = {
      left: `${pointPixelX}px`,
      top: `${pointPixelY}px`
    }
  } else {
    hoverPoint.value = null
  }
}

const handleMouseLeave = () => {
  hoverPoint.value = null
}
</script>

<style scoped>
.trend-chart {
  width: 100%;
}

.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.chart-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text);
  margin: 0;
}

.chart-total {
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.chart-body {
  width: 100%;
  position: relative;
  overflow-x: auto;
}

.chart-svg {
  display: block;
  min-width: 300px;
}

.data-point {
  cursor: pointer;
  transition: r 0.2s ease;
}

.data-point:hover {
  r: 6;
}

.chart-tooltip {
  position: absolute;
  transform: translate(-50%, -120%);
  background: rgba(0, 0, 0, 0.8);
  color: white;
  padding: 0.4rem 0.6rem;
  border-radius: 6px;
  font-size: 0.75rem;
  pointer-events: none;
  white-space: nowrap;
  z-index: 10;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.tooltip-date {
  opacity: 0.8;
  font-size: 0.7rem;
  margin-bottom: 0.1rem;
}

.tooltip-count {
  font-weight: 600;
  font-size: 0.8rem;
}
</style>
