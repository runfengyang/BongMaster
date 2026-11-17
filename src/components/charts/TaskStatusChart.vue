<template>
  <div class="task-status-chart">
    <div class="status-chart-visual">
      <svg viewBox="0 0 140 140" role="img" :aria-label="`任务状态分布，共${total}个任务`">
        <circle cx="70" cy="70" r="50" class="status-track" />
        <circle
          v-for="segment in segments"
          :key="segment.label"
          cx="70"
          cy="70"
          r="50"
          class="status-segment"
          :class="segment.className"
          :stroke-dasharray="segment.dasharray"
          :stroke-dashoffset="segment.offset"
        ><title>{{ segment.label }}：{{ segment.value }} 个</title></circle>
        <text x="70" y="66" text-anchor="middle" class="status-total">{{ completionRate }}%</text>
        <text x="70" y="85" text-anchor="middle" class="status-total-label">完成率</text>
      </svg>
      <ul class="status-legend">
        <li v-for="item in data" :key="item.label"><span :class="classFor(item.label)"></span><span>{{ item.label }}</span><strong>{{ item.value }}</strong></li>
      </ul>
    </div>
    <details class="chart-data-details">
      <summary>查看状态数据</summary>
      <table><caption>任务状态分布</caption><thead><tr><th scope="col">状态</th><th scope="col">任务数</th></tr></thead><tbody><tr v-for="item in data" :key="item.label"><th scope="row">{{ item.label }}</th><td>{{ item.value }}</td></tr></tbody></table>
    </details>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({ data: { type: Array, default: () => [] } })
const total = computed(() => props.data.reduce((sum, item) => sum + item.value, 0))
const completionRate = computed(() => {
  const completed = props.data.find(item => item.label === '已完成')?.value || 0
  return total.value ? Math.round(completed / total.value * 100) : 0
})
const circumference = 2 * Math.PI * 50
const classFor = label => label === '已完成' ? 'is-done' : label === '进行中' ? 'is-active' : 'is-todo'
const segments = computed(() => {
  let offset = 0
  return props.data.map(item => {
    const length = total.value ? item.value / total.value * circumference : 0
    const segment = {
      ...item,
      className: classFor(item.label),
      dasharray: `${length} ${circumference - length}`,
      offset: -offset
    }
    offset += length
    return segment
  })
})
</script>

<style scoped>
.status-chart-visual { display: grid; grid-template-columns: 150px 1fr; align-items: center; gap: 16px; min-height: 190px; }
svg { width: 150px; height: 150px; transform: rotate(-90deg); }
.status-track, .status-segment { fill: none; stroke-width: 14; }
.status-track { stroke: var(--bm-bg-hover); }
.status-segment.is-todo { stroke: var(--bm-text-tertiary); }
.status-segment.is-active { stroke: var(--bm-accent-blue); }
.status-segment.is-done { stroke: var(--bm-accent-teal); }
.status-total { fill: var(--bm-text-primary); font-size: 24px; font-weight: 650; transform: rotate(90deg); transform-origin: 70px 70px; }
.status-total-label { fill: var(--bm-text-secondary); font-size: 10px; transform: rotate(90deg); transform-origin: 70px 70px; }
.status-legend { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
.status-legend li { display: grid; grid-template-columns: 10px 1fr auto; align-items: center; gap: 8px; font-size: 13px; }
.status-legend li > span:first-child { width: 8px; height: 8px; border-radius: 50%; }
.status-legend .is-todo { background: var(--bm-text-tertiary); }
.status-legend .is-active { background: var(--bm-accent-blue); }
.status-legend .is-done { background: var(--bm-accent-teal); }
.status-legend strong { font-variant-numeric: tabular-nums; }
.chart-data-details { margin-top: 8px; font-size: 12px; color: var(--bm-text-secondary); }
.chart-data-details table { width: 100%; margin-top: 8px; border-collapse: collapse; }
.chart-data-details th, .chart-data-details td { padding: 5px; border-bottom: 1px solid var(--bm-border-subtle); text-align: left; }
@media (max-width: 520px) { .status-chart-visual { grid-template-columns: 130px 1fr; } svg { width: 130px; height: 130px; } }
</style>
