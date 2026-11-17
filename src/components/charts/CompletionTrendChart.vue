<template>
  <figure class="completion-trend-chart">
    <svg v-if="data.length" viewBox="0 0 800 230" role="img" :aria-label="`近30天完成趋势，共完成${total}个任务`">
      <line v-for="tick in yTicks" :key="tick" :x1="42" :x2="788" :y1="y(tick)" :y2="y(tick)" class="chart-grid-line" />
      <text v-for="tick in yTicks" :key="`label-${tick}`" x="34" :y="y(tick) + 4" text-anchor="end" class="chart-axis-label">{{ tick }}</text>
      <path :d="areaPath" class="chart-area" />
      <path :d="linePath" class="chart-line" />
      <g v-for="point in points" :key="point.date" class="chart-point">
        <circle :cx="point.x" :cy="point.y" r="4" tabindex="0"><title>{{ point.date }}：完成 {{ point.count }} 个任务</title></circle>
      </g>
      <text v-for="label in xLabels" :key="label.date" :x="label.x" y="222" :text-anchor="label.anchor" class="chart-axis-label">{{ label.text }}</text>
    </svg>
    <div v-else class="chart-empty">暂无完成记录</div>
    <figcaption>近 30 天项目任务完成趋势 · 共 {{ total }} 个</figcaption>
    <details v-if="data.length" class="chart-data-details">
      <summary>查看每日数据</summary>
      <table><caption>近30天项目任务完成数</caption><thead><tr><th scope="col">日期</th><th scope="col">完成数</th></tr></thead><tbody><tr v-for="day in data" :key="day.date"><th scope="row">{{ day.date }}</th><td>{{ day.count }}</td></tr></tbody></table>
    </details>
  </figure>
</template>

<script setup>
import { computed } from 'vue'
import { format, parseISO } from 'date-fns'

const props = defineProps({ data: { type: Array, default: () => [] } })
const total = computed(() => props.data.reduce((sum, day) => sum + (Number(day.count) || 0), 0))
const maxValue = computed(() => Math.max(1, ...props.data.map(day => Number(day.count) || 0)))
const yTicks = computed(() => [...new Set([0, Math.ceil(maxValue.value / 2), maxValue.value])])
const y = value => 194 - value / maxValue.value * 178
const points = computed(() => props.data.map((day, index) => ({
  date: day.date,
  count: Number(day.count) || 0,
  x: 42 + index / Math.max(1, props.data.length - 1) * 746,
  y: y(Number(day.count) || 0)
})))
const linePath = computed(() => points.value.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' '))
const areaPath = computed(() => points.value.length ? `${linePath.value} L ${points.value.at(-1).x} 194 L ${points.value[0].x} 194 Z` : '')
const xLabels = computed(() => {
  if (!points.value.length) return []
  const indexes = [...new Set([0, Math.floor((points.value.length - 1) / 2), points.value.length - 1])]
  return indexes.map((index, position) => ({
    date: points.value[index].date,
    x: points.value[index].x,
    text: format(parseISO(points.value[index].date), 'M/d'),
    anchor: position === 0 ? 'start' : position === indexes.length - 1 ? 'end' : 'middle'
  }))
})
</script>

<style scoped>
.completion-trend-chart { margin: 0; }
svg { display: block; width: 100%; height: auto; min-height: 190px; }
.chart-grid-line { stroke: var(--bm-border-subtle); stroke-width: 1; }
.chart-axis-label { fill: var(--bm-text-muted); font-size: 11px; }
.chart-area { fill: color-mix(in srgb, var(--bm-accent-blue) 14%, transparent); }
.chart-line { fill: none; stroke: var(--bm-accent-blue); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.chart-point circle { fill: var(--bm-bg-card); stroke: var(--bm-accent-blue); stroke-width: 2; }
.chart-point circle:focus { outline: 2px solid var(--bm-accent-blue); outline-offset: 2px; }
figcaption { margin-top: 6px; color: var(--bm-text-secondary); font-size: 12px; }
.chart-empty { min-height: 190px; display: grid; place-items: center; color: var(--bm-text-muted); }
.chart-data-details { margin-top: 8px; font-size: 12px; color: var(--bm-text-secondary); }
.chart-data-details table { width: 100%; margin-top: 8px; border-collapse: collapse; }
.chart-data-details th, .chart-data-details td { padding: 5px; border-bottom: 1px solid var(--bm-border-subtle); text-align: left; }
</style>
