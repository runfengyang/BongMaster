<template>
  <div class="work-trend">
    <div class="work-trend-plot">
      <div class="work-trend-canvas">
        <div class="work-trend-cell" :class="{ 'is-visible': hoveredBar }" :style="cellStyle" aria-hidden="true" />
        <svg viewBox="0 0 360 88" preserveAspectRatio="none" role="img" aria-label="近 30 天实际工时趋势">
          <line
            v-for="tick in gridTicks"
            :key="`grid-${tick.ratio}`"
            :x1="28"
            :x2="322"
            :y1="10 + (1 - tick.ratio) * 72"
            :y2="10 + (1 - tick.ratio) * 72"
            class="work-trend-grid"
            vector-effect="non-scaling-stroke"
          />
          <g v-for="bar in bars" :key="bar.date">
            <rect
              v-if="bar.minutes > 0"
              :x="bar.x"
              :y="bar.y"
              :width="bar.width"
              :height="bar.height"
              :rx="Math.min(2, bar.width / 2)"
              :class="['work-trend-bar', { 'is-weekend': !bar.isWorkday, 'is-today': bar.isToday, 'is-open': bar.open, 'is-hover': hoveredDate === bar.date }]"
              :style="barDelay(bar.index)"
            />
            <rect
              v-else
              :x="bar.x"
              y="80"
              :width="bar.width"
              height="2"
              :rx="Math.min(1, bar.width / 2)"
              :class="['work-trend-empty', { 'is-hover': hoveredDate === bar.date }]"
              :style="barDelay(bar.index)"
            />
          </g>
        </svg>

        <div class="work-trend-hit">
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

        <div class="work-trend-ticks" aria-hidden="true">
          <span v-for="tick in gridTicks" :key="`tick-${tick.ratio}`" :style="{ top: tick.topPercent }">{{ tick.label }}</span>
        </div>

        <Transition name="tip">
          <div v-if="hoveredBar" class="work-trend-tip" :style="tipStyle">
            <div class="work-trend-tip-inner">
              <div v-if="hoveredBar.minutes > 0" class="tip-line">
                <strong>{{ hoveredBar.monthDay }}</strong>
                <span class="tip-week">{{ weekdayLabel(hoveredBar.weekday) }}</span>
                <span class="tip-time">{{ hoveredBar.checkInTime }}–{{ hoveredBar.checkOutTime }}</span>
                <span class="tip-main">{{ formatWorkDuration(hoveredBar.minutes) }}</span>
              </div>
              <div v-else class="tip-line">
                <strong>{{ hoveredBar.monthDay }}</strong>
                <span class="tip-week">{{ weekdayLabel(hoveredBar.weekday) }}</span>
                <span class="tip-main is-muted">{{ hoveredBar.open ? `已上班 ${hoveredBar.checkInTime} · 未下班` : '无打卡记录' }}</span>
              </div>
              <div v-if="hoveredBar.minutes > 0 && (hoveredBar.overtimeMinutes || hoveredBar.lateMinutes || hoveredBar.earlyMinutes)" class="tip-tags">
                <span v-if="hoveredBar.overtimeMinutes" class="is-ot">加班 {{ formatWorkDuration(hoveredBar.overtimeMinutes) }}</span>
                <span v-if="hoveredBar.lateMinutes" class="is-late">迟到 {{ hoveredBar.lateMinutes }}分</span>
                <span v-if="hoveredBar.earlyMinutes" class="is-early">早退 {{ hoveredBar.earlyMinutes }}分</span>
              </div>
            </div>
          </div>
        </Transition>

        <p v-if="!hasData" class="work-trend-hint">近 30 天还没有完整工时记录</p>
      </div>
      <div class="work-trend-axis" aria-hidden="true">
        <span v-for="bar in labeledBars" :key="bar.date" :style="{ left: bar.labelPercent }">{{ bar.label }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { formatWorkDuration, visibleTrendItems } from '@utils/work-attendance.js'

const props = defineProps({ trend: { type: Object, required: true } })

const PLOT_LEFT = 28
const PLOT_RIGHT = 322
const PLOT_TOP = 10
const PLOT_BOTTOM = 82
const VIEW_WIDTH = 360
const VIEW_HEIGHT = 88

const hoveredDate = ref(null)
const clearHover = date => {
  if (hoveredDate.value === date) hoveredDate.value = null
}

const scaleMax = computed(() => Math.max(60, Math.ceil((props.trend.maxMinutes || 60) / 60) * 60))
const items = computed(() => visibleTrendItems(props.trend))
const bars = computed(() => {
  const rows = items.value
  const step = (PLOT_RIGHT - PLOT_LEFT) / Math.max(1, rows.length)
  const width = Math.max(3, step * 0.5)
  const plotHeight = PLOT_BOTTOM - PLOT_TOP
  return rows.map((item, index) => {
    const height = item.minutes > 0 ? Math.max(2, (item.minutes / scaleMax.value) * plotHeight) : 0
    const labelX = PLOT_LEFT + index * step + step / 2
    return {
      ...item,
      x: PLOT_LEFT + index * step + (step - width) / 2,
      width,
      y: PLOT_BOTTOM - height,
      height,
      index,
      cellLeftPercent: `${((PLOT_LEFT + index * step) / VIEW_WIDTH) * 100}%`,
      cellWidthPercent: `${(step / VIEW_WIDTH) * 100}%`,
      showLabel: index % 5 === 0 || index === rows.length - 1,
      labelX,
      labelPercent: `${(labelX / VIEW_WIDTH) * 100}%`,
      flipped: PLOT_BOTTOM - height < 40
    }
  })
})

const labeledBars = computed(() => bars.value.filter(bar => bar.showLabel))
const hasData = computed(() => items.value.some(item => item.minutes > 0 || item.open))
const barDelay = index => ({ animationDelay: `${Math.min(index * 8, 150)}ms` })

const hoveredBar = computed(() => bars.value.find(bar => bar.date === hoveredDate.value) || null)

const gridTicks = computed(() => [0, 0.5, 1].map(ratio => {
  const minutes = Math.round(scaleMax.value * ratio)
  const hours = minutes / 60
  const label = !hours ? '0' : Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`
  return {
    ratio,
    label,
    topPercent: `${((PLOT_TOP + (1 - ratio) * (PLOT_BOTTOM - PLOT_TOP)) / VIEW_HEIGHT) * 100}%`
  }
}))

const cellStyle = computed(() => {
  const bar = hoveredBar.value
  if (!bar) return {}
  return { left: bar.cellLeftPercent, width: bar.cellWidthPercent }
})

const tipStyle = computed(() => {  const bar = hoveredBar.value
  if (!bar) return {}
  const left = Math.min(80, Math.max(20, (bar.labelX / VIEW_WIDTH) * 100))
  return {
    left: `${left}%`,
    top: `${(bar.y / VIEW_HEIGHT) * 100}%`,
    transform: bar.flipped ? 'translate(-50%, 10px)' : 'translate(-50%, calc(-100% - 10px))'
  }
})

const weekdayNames = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日']
const weekdayLabel = weekday => weekdayNames[weekday] || ''
</script>

<style scoped>
.work-trend { flex: 1 1 auto; display: flex; min-height: 110px; }
.work-trend-plot { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.work-trend-canvas { position: relative; flex: 1 1 auto; min-height: 0; }
.work-trend svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; overflow: visible; }
.work-trend-cell {
  position: absolute;
  top: 0;
  bottom: 6.8%;
  border-radius: 5px;
  background: rgba(79, 102, 168, 0.08);
  box-shadow: inset 0 0 0 1px rgba(79, 102, 168, 0.14);
  opacity: 0;
  transform: scaleY(0.9);
  transform-origin: bottom;
  pointer-events: none;
  transition:
    left 110ms steps(2, end),
    width 110ms steps(2, end),
    opacity 120ms ease,
    transform 120ms steps(2, end);
}

.work-trend-cell.is-visible {
  opacity: 1;
  transform: none;
}

.work-trend-grid { stroke: #f1eee8; stroke-width: 1; }
.work-trend-bar {
  fill: #4f66a8;
  transform-box: fill-box;
  transform-origin: bottom;
  animation: workBarGrow 260ms cubic-bezier(0.22, 1, 0.36, 1) both;
  transition: fill 120ms ease, opacity 120ms ease;
}
.work-trend-bar.is-weekend { fill: #e4e7ef; }
.work-trend-bar.is-today { fill: #7a9a7d; }
.work-trend-bar.is-open { opacity: 0.55; }
.work-trend-bar.is-hover { fill: #49609a; }
.work-trend-bar.is-weekend.is-hover { fill: #bdd3ea; }
.work-trend-empty { fill: #ece8e1; animation: workEmptyIn 180ms ease both; transition: fill 120ms ease; }
.work-trend-empty.is-hover { fill: #cfd8e3; }
.work-trend-hit { position: absolute; top: 0; bottom: 0; left: 7.8%; right: 10.6%; display: flex; }
.work-trend-hit button { flex: 1 1 0; min-width: 0; padding: 0; border: 0; background: transparent; cursor: default; }
.work-trend-ticks { position: absolute; top: 0; bottom: 0; right: 0; width: 10%; pointer-events: none; }
.work-trend-ticks span { position: absolute; right: 0; transform: translateY(-50%); color: #a9a29a; font-size: 10px; font-variant-numeric: tabular-nums; line-height: 1; white-space: nowrap; }
.work-trend-axis { position: relative; height: 13px; margin-top: 3px; }
.work-trend-axis span { position: absolute; top: 0; transform: translateX(-50%); color: #9a9389; font-size: 10px; line-height: 1; white-space: nowrap; }
.work-trend-hint { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; color: #a9a29a; font-size: 11px; }

.work-trend-tip { position: absolute; z-index: 4; pointer-events: none; }
.work-trend-tip-inner { min-width: 116px; padding: 8px 10px; border: 1px solid rgb(60 50 35 / 0.08); border-radius: 8px; background: rgb(255 253 249 / 0.97); box-shadow: 0 6px 20px rgb(60 50 35 / 0.12); backdrop-filter: blur(8px); transition: opacity 130ms ease, transform 130ms cubic-bezier(0.22, 1, 0.36, 1); }
.tip-enter-from .work-trend-tip-inner,
.tip-leave-to .work-trend-tip-inner { opacity: 0; transform: translateY(3px) scale(0.95); }
.tip-line { display: flex; align-items: baseline; gap: 6px; white-space: nowrap; }
.tip-line strong { font-size: 12px; font-weight: 600; color: #2d2822; }
.tip-week { color: #9a9389; font-size: 10px; }
.tip-time { color: #6f6a62; font-size: 10.5px; font-variant-numeric: tabular-nums; }
.tip-main { color: #4f66a8; font-size: 12.5px; font-weight: 600; font-variant-numeric: tabular-nums; }
.tip-main.is-muted { color: #9a9389; font-size: 11px; font-weight: 500; }
.tip-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.tip-tags span { padding: 1px 5px; border-radius: 4px; font-size: 9.5px; font-weight: 600; }
.tip-tags .is-ot { background: #eff4ef; color: #5c7d5f; }
.tip-tags .is-late { background: #f7efe6; color: #9a6f3f; }
.tip-tags .is-early { background: #f6ebe8; color: #a25743; }

@keyframes workBarGrow {
  from { transform: scaleY(0); }
  to { transform: scaleY(1); }
}
@keyframes workEmptyIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .work-trend-bar,
  .work-trend-empty { animation: none; }
}
</style>
