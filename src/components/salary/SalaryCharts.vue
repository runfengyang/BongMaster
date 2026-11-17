<template>
  <div ref="rootRef" class="salary-charts">
    <section class="salary-chart">
      <header class="salary-chart-head">
        <h3 class="salary-chart-title">活动</h3>
        <span class="salary-chart-meta">
          活跃 {{ activity.activeDays }} 天
          <svg class="salary-meta-icon" viewBox="0 0 14 12" aria-hidden="true">
            <path d="M1 9.5 L5 5.5 L8 7.5 L13 2.5" />
            <path d="M9.5 2.5 H13 V6" />
          </svg>
        </span>
      </header>
      <div class="salary-heat-wrap">
        <svg
          class="salary-heat"
          :viewBox="`0 0 ${activity.width} ${activity.height + 16}`"
          width="100%"
          :height="activity.height + 16"
          role="img"
          :aria-label="activityAria"
        >
          <rect
            v-for="cell in activity.cells"
            :key="`cell-${cell.date}`"
            class="heat-cell"
            :class="[`lvl-${cell.level}`, { 'is-hovered': hoveredHeat === cell.date }]"
            :x="cell.x"
            :y="cell.y"
            :width="cell.size"
            :height="cell.size"
            rx="3"
          />
          <rect
            v-for="cell in activity.cells"
            :key="`hit-${cell.date}`"
            class="heat-hit"
            :x="cell.hitX"
            :y="cell.hitY"
            :width="cell.hitWidth"
            :height="cell.hitHeight"
            tabindex="0"
            :aria-label="cell.title"
            @mouseenter="hoveredHeat = cell.date"
            @mouseleave="clearHeat(cell.date)"
            @focus="hoveredHeat = cell.date"
            @blur="clearHeat(cell.date)"
            @click="hoveredHeat = cell.date"
          >
            <title>{{ cell.title }}</title>
          </rect>
          <text
            v-for="month in activity.months"
            :key="month.key"
            class="heat-month"
            :x="month.x"
            :y="activity.height + 12"
          >{{ month.label }}</text>
        </svg>
        <Transition name="chart-tip">
          <div v-if="hoveredHeatCell" class="salary-chart-tip heat-tip" :style="heatTipStyle" aria-hidden="true">
            <span class="tip-date">{{ hoveredHeatCell.dateLabel }} {{ weekdayLabel(hoveredHeatCell.weekday) }}</span>
            <strong v-if="hoveredHeatCell.value > 0" class="tip-value">{{ money(hoveredHeatCell.value) }}</strong>
            <strong v-else class="tip-value is-empty">无收入</strong>
            <span v-if="hoveredHeatCell.overtime > 0 && !props.privateMode" class="tip-detail">
              常规 {{ money(hoveredHeatCell.regular) }} · 加班 {{ money(hoveredHeatCell.overtime) }}
            </span>
          </div>
        </Transition>
      </div>
    </section>

    <section class="salary-chart">
      <header class="salary-chart-head">
        <h3 class="salary-chart-title">趋势</h3>
        <span class="salary-chart-meta is-strong">{{ peakLabel }}</span>
      </header>
      <div class="salary-trend-wrap">
        <svg
          class="salary-trend"
          :viewBox="`0 0 ${trend.width} ${trend.height}`"
          width="100%"
          :height="trend.height"
          preserveAspectRatio="none"
          role="img"
          :aria-label="trendAria"
        >
          <defs>
            <linearGradient id="salary-trend-area-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop class="salary-area-top" offset="0" />
              <stop class="salary-area-bottom" offset="1" />
            </linearGradient>
          </defs>
          <path
            v-if="trend.areaPath"
            class="salary-area-fill"
            :d="trend.areaPath"
            fill="url(#salary-trend-area-gradient)"
          />
          <path v-if="trend.linePath" class="salary-area-line" :d="trend.linePath" />
          <line
            v-if="hoveredTrendPoint"
            class="trend-guide"
            :x1="hoveredTrendPoint.x"
            :x2="hoveredTrendPoint.x"
            :y1="trend.plot.y"
            :y2="trend.plot.y + trend.plot.h"
          />
          <circle
            v-if="hoveredTrendPoint"
            class="trend-point"
            :cx="hoveredTrendPoint.x"
            :cy="hoveredTrendPoint.y"
            r="3.4"
          />
          <text
            v-if="!trend.total"
            class="salary-empty"
            :x="trend.width / 2"
            :y="trend.plot.y + trend.plot.h / 2"
            text-anchor="middle"
          >暂无收入记录</text>
          <rect
            v-for="point in trend.points"
            :key="`hit-${point.date}`"
            class="trend-hit"
            :x="point.hitX"
            :y="trend.plot.y"
            :width="point.hitWidth"
            :height="trend.plot.h"
            tabindex="0"
            :aria-label="point.title"
            @mouseenter="hoveredTrend = point.date"
            @mouseleave="clearTrend(point.date)"
            @focus="hoveredTrend = point.date"
            @blur="clearTrend(point.date)"
            @click="hoveredTrend = point.date"
          >
            <title>{{ point.title }}</title>
          </rect>
          <text
            v-for="label in trend.labels"
            :key="label.key"
            class="trend-date"
            :x="label.x"
            :y="label.y"
            :text-anchor="label.anchor"
          >{{ label.text }}</text>
        </svg>
        <Transition name="chart-tip">
          <div v-if="hoveredTrendPoint" class="salary-chart-tip trend-tip" :style="trendTipStyle" aria-hidden="true">
            <span class="tip-date">{{ hoveredTrendPoint.fullLabel }} {{ weekdayLabel(hoveredTrendPoint.weekday) }}</span>
            <strong v-if="hoveredTrendPoint.total > 0" class="tip-value">{{ money(hoveredTrendPoint.total) }}</strong>
            <strong v-else class="tip-value is-empty">无收入</strong>
            <span v-if="hoveredTrendPoint.total > 0 && !props.privateMode" class="tip-detail">
              常规 {{ money(hoveredTrendPoint.regular) }} · 加班 {{ money(hoveredTrendPoint.overtime) }}
            </span>
          </div>
        </Transition>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  buildActivityHeatmap,
  buildTrendArea,
  formatSalaryMoney
} from '@utils/salary-chart-data.js'

const props = defineProps({
  daily: { type: Array, default: () => [] },
  currency: { type: String, default: 'CNY' },
  privateMode: { type: Boolean, default: false }
})

const rootRef = ref(null)
const chartWidth = ref(420)
const hoveredHeat = ref('')
const hoveredTrend = ref('')
let resizeObserver = null

const weekdayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const weekdayLabel = weekday => weekdayNames[weekday] || ''
const money = value => formatSalaryMoney(value, props.currency, props.privateMode)

const activity = computed(() => {
  const model = buildActivityHeatmap(props.daily, new Date(), chartWidth.value)
  return {
    ...model,
    cells: model.cells.map(cell => ({
      ...cell,
      title: cell.value > 0 && !props.privateMode
        ? `${cell.dateLabel} 常规 ${money(cell.regular)} · 加班 ${money(cell.overtime)}`
        : `${cell.dateLabel} ${cell.value > 0 ? '收入 ••••' : '无收入'}`
    }))
  }
})

const trend = computed(() => {
  const model = buildTrendArea(props.daily, new Date(), chartWidth.value)
  return {
    ...model,
    points: model.points.map(point => ({ ...point, title: pointTitle(point) }))
  }
})

const hoveredHeatCell = computed(() => activity.value.cells.find(cell => cell.date === hoveredHeat.value) || null)
const hoveredTrendPoint = computed(() => trend.value.points.find(point => point.date === hoveredTrend.value) || null)

const heatTipStyle = computed(() => {
  const cell = hoveredHeatCell.value
  if (!cell) return {}
  const left = Math.min(84, Math.max(16, ((cell.x + cell.size / 2) / activity.value.width) * 100))
  const top = ((cell.y + cell.size / 2) / (activity.value.height + 16)) * 100
  return {
    left: `${left}%`,
    top: `${top}%`,
    transform: cell.row >= 4 ? 'translate(-50%, calc(-100% - 9px))' : 'translate(-50%, 9px)'
  }
})

const trendTipStyle = computed(() => {
  const point = hoveredTrendPoint.value
  if (!point) return {}
  const left = Math.min(84, Math.max(16, (point.x / trend.value.width) * 100))
  return {
    left: `${left}%`,
    top: `${(point.y / trend.value.height) * 100}%`,
    transform: point.y < trend.value.height * 0.45
      ? 'translate(-50%, 10px)'
      : 'translate(-50%, calc(-100% - 10px))'
  }
})

const clearHeat = date => {
  if (hoveredHeat.value === date) hoveredHeat.value = ''
}

const clearTrend = date => {
  if (hoveredTrend.value === date) hoveredTrend.value = ''
}

const peakLabel = computed(() => {
  if (props.privateMode) return '峰值 ••••'
  return `峰值 ${formatSalaryMoney(trend.value.peak, props.currency)}`
})

const activityAria = computed(() => `近 6 个月收入热力图，活跃 ${activity.value.activeDays} 天`)

const trendAria = computed(() => {
  if (!trend.value.total) return '近 30 天收入趋势，暂无收入记录'
  if (props.privateMode) return '近 30 天收入趋势，金额已隐藏'
  return `近 30 天收入趋势，合计 ${formatSalaryMoney(trend.value.total, props.currency)}`
})

function pointTitle(point) {
  if (!point.total) return `${point.fullLabel} 无收入`
  if (props.privateMode) return `${point.fullLabel} 收入 ••••`
  return `${point.fullLabel} 常规 ${money(point.regular)} · 加班 ${money(point.overtime)} · 合计 ${money(point.total)}`
}

function measure(element) {
  const width = Math.round(element?.clientWidth || 0)
  if (width > 0) chartWidth.value = width
}

onMounted(() => {
  if (!rootRef.value) return
  measure(rootRef.value)
  if (typeof ResizeObserver === 'undefined') return
  resizeObserver = new ResizeObserver(entries => {
    const width = Math.round(entries[0]?.contentRect.width || rootRef.value?.clientWidth || 0)
    if (width > 0) chartWidth.value = width
  })
  resizeObserver.observe(rootRef.value)
})

onBeforeUnmount(() => {
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
})
</script>

<style scoped>
.salary-charts {
  --salary-area-line: #6ab4f0;
  display: grid;
  gap: 18px;
  min-width: 0;
}

.salary-chart {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.salary-chart-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.salary-chart-title {
  margin: 0;
  color: var(--bm-text-primary);
  font-size: 13px;
  font-weight: 600;
}

.salary-chart-meta {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--bm-text-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.salary-chart-meta.is-strong {
  color: var(--bm-text-primary);
  font-weight: 500;
}

.salary-meta-icon {
  width: 14px;
  height: 12px;
  color: currentColor;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.3;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.salary-heat-wrap,
.salary-trend-wrap {
  position: relative;
  min-width: 0;
}

.salary-heat {
  display: block;
  width: 100%;
  height: auto;
}

.heat-cell {
  pointer-events: none;
  transform-box: fill-box;
  transform-origin: center;
  transition: fill 140ms ease, stroke 140ms ease, filter 140ms ease, transform 140ms ease;
}

.heat-cell.lvl-0 { fill: var(--bm-bg-hover); }
.heat-cell.lvl-1 { fill: rgb(90 170 255 / 0.18); }
.heat-cell.lvl-2 { fill: rgb(120 190 255 / 0.45); }
.heat-cell.lvl-3 { fill: rgb(150 210 255 / 0.8); }
.heat-cell.lvl-4 { fill: rgb(180 230 255); }

.heat-cell.is-hovered {
  stroke: color-mix(in srgb, var(--salary-area-line) 84%, var(--bm-text-primary));
  stroke-width: 1;
  filter: drop-shadow(0 0 3px rgb(106 180 240 / 0.7));
  transform: scale(1.2);
}

.heat-hit {
  fill: transparent;
  outline: none;
}

.heat-hit:focus-visible {
  stroke: var(--salary-area-line);
  stroke-width: 1;
}

.heat-month {
  fill: var(--bm-text-muted);
  font-size: 10px;
}

.salary-trend {
  display: block;
  width: 100%;
}

.trend-guide {
  stroke: var(--salary-area-line);
  stroke-width: 1;
  stroke-dasharray: 2 3;
  opacity: 0.55;
  vector-effect: non-scaling-stroke;
  pointer-events: none;
}

.trend-point {
  fill: var(--salary-area-line);
  stroke: var(--bm-bg-card);
  stroke-width: 2;
  transform-box: fill-box;
  transform-origin: center;
  animation: trend-point-pop 150ms ease-out;
  pointer-events: none;
}

@keyframes trend-point-pop {
  from { opacity: 0.4; transform: scale(0.35); }
  to { opacity: 1; transform: scale(1); }
}

.salary-chart-tip {
  position: absolute;
  z-index: 4;
  display: grid;
  gap: 2px;
  min-width: 116px;
  max-width: 210px;
  padding: 6px 8px;
  background: color-mix(in srgb, var(--bm-bg-card) 97%, transparent);
  border: 1px solid var(--bm-border-default);
  border-radius: var(--bm-radius-sm);
  box-shadow: var(--bm-shadow-md);
  color: var(--bm-text-primary);
  font-size: 10px;
  line-height: 1.35;
  text-align: center;
  white-space: nowrap;
  pointer-events: none;
  backdrop-filter: blur(6px);
}

.tip-date {
  color: var(--bm-text-muted);
  font-size: 9.5px;
}

.tip-value {
  font-family: var(--bm-font-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.tip-value.is-empty {
  color: var(--bm-text-muted);
  font-family: var(--bm-font-family);
  font-weight: 500;
}

.tip-detail {
  color: var(--bm-text-secondary);
  font-size: 9px;
}

.chart-tip-enter-active,
.chart-tip-leave-active {
  transition: opacity 120ms ease, scale 120ms ease;
}

.chart-tip-enter-from,
.chart-tip-leave-to {
  opacity: 0;
  scale: 0.96;
}

@media (prefers-reduced-motion: reduce) {
  .heat-cell,
  .chart-tip-enter-active,
  .chart-tip-leave-active {
    transition: none;
  }

  .trend-point {
    animation: none;
  }
}

.salary-area-top {
  stop-color: var(--salary-area-line);
  stop-opacity: 0.22;
}

.salary-area-bottom {
  stop-color: var(--salary-area-line);
  stop-opacity: 0;
}

.salary-area-fill {
  pointer-events: none;
}

.salary-area-line {
  fill: none;
  stroke: var(--salary-area-line);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
  pointer-events: none;
}

.salary-empty {
  fill: var(--bm-text-muted);
  font-size: 11px;
}

.trend-hit {
  fill: transparent;
  outline: none;
}

.trend-hit:hover {
  fill: color-mix(in srgb, var(--salary-area-line) 8%, transparent);
}

.trend-hit:focus-visible {
  stroke: var(--salary-area-line);
  stroke-width: 1;
}

.trend-date {
  fill: var(--bm-text-muted);
  font-size: 10px;
}
</style>
