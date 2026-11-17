<template>
  <section ref="cardRef" class="heatmap">
    <header class="heatmap-head">
      <div class="heatmap-summary">
        <strong class="heatmap-title">活动热力图</strong>
        <span class="heatmap-total"><strong>{{ total }}</strong> 次贡献</span>
      </div>
      <div class="heatmap-legend" aria-hidden="true">
        <span>少</span>
        <i v-for="level in [0, 1, 2, 3, 4]" :key="level" class="legend-cell" :style="{ background: COLOR_STEPS[level] }" />
        <span>多</span>
      </div>
    </header>

    <div class="heatmap-grid" :style="{ gridTemplateColumns: `20px repeat(${weeks.length}, minmax(0, 1fr))` }">
      <span
        v-for="label in monthLabels"
        :key="`m-${label.week}`"
        class="month-label"
        :style="{ gridColumn: 2 + label.week, gridRow: 1 }"
      >{{ label.label }}</span>
      <span
        v-for="(label, index) in WEEKDAY_LABELS"
        :key="`d-${index}`"
        class="weekday-label"
        :style="{ gridColumn: 1, gridRow: 2 + index }"
      >{{ label }}</span>
      <button
        v-for="cell in cells"
        :key="cell.date"
        type="button"
        class="heatmap-day"
        :class="{ 'is-today': cell.isToday }"
        :style="{ gridColumn: 2 + cell.week, gridRow: 2 + cell.day, background: colorOf(cell.count) }"
        :disabled="cell.future"
        :aria-label="`${cell.date} ${cell.count ? `完成 ${cell.count} 个任务` : '无贡献'}`"
        @mouseenter="handleEnter(cell, $event)"
        @mouseleave="handleLeave"
        @focus="handleEnter(cell, $event)"
        @blur="handleLeave"
      />
    </div>

    <Transition name="hm-tip">
      <div v-if="hovered" class="heatmap-tooltip" :class="{ 'is-below': hovered.below }" :style="tooltipStyle">
        <div class="tooltip-date">{{ hovered.label }}</div>
        <div class="tooltip-count" :class="{ 'is-empty': !hovered.count }">
          {{ hovered.count ? `完成 ${hovered.count} 个任务` : '无贡献' }}
        </div>
      </div>
    </Transition>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue'
import { addDays, format, startOfWeek, subDays } from 'date-fns'
import { zhCN } from 'date-fns/locale'

const props = defineProps({
  data: { type: Array, default: () => [] },
  days: { type: Number, default: 365 }
})

const COLOR_STEPS = ['#efede7', '#dbe4d7', '#c0d2bb', '#9db69a', '#7d9a7b']
const WEEKDAY_LABELS = ['一', '', '三', '', '五', '', '']

const cardRef = ref(null)
const hovered = ref(null)

const countMap = computed(() => {
  const map = new Map()
  props.data.forEach(item => {
    if (item.date) map.set(item.date, item.count || 0)
  })
  return map
})

const maxCount = computed(() => Math.max(1, ...cells.value.map(cell => cell.count || 0)))
const todayKey = format(new Date(), 'yyyy-MM-dd')

const weeks = computed(() => {
  const today = new Date()
  const start = subDays(today, Math.max(1, props.days) - 1)
  let cursor = startOfWeek(start, { weekStartsOn: 1 })
  const result = []

  while (cursor <= today) {
    const week = []
    for (let i = 0; i < 7; i++) {
      const day = addDays(cursor, i)
      const date = format(day, 'yyyy-MM-dd')
      const future = day > today
      week.push({
        date,
        label: format(day, 'M月d日 EEEE', { locale: zhCN }),
        count: future ? 0 : (countMap.value.get(date) || 0),
        future,
        isToday: date === todayKey,
        week: result.length,
        day: i
      })
    }
    result.push(week)
    cursor = addDays(cursor, 7)
  }

  return result
})

const cells = computed(() => weeks.value.flat())

const total = computed(() => props.data.reduce((sum, item) => sum + (item.count || 0), 0))

const levelOf = count => {
  if (!count) return 0
  if (maxCount.value <= 1) return 4
  const ratio = count / maxCount.value
  if (ratio <= 0.25) return 1
  if (ratio <= 0.5) return 2
  if (ratio <= 0.75) return 3
  return 4
}

const colorOf = count => COLOR_STEPS[levelOf(count)]

const monthLabels = computed(() => {
  const labels = []
  let lastMonth = -1
  weeks.value.forEach((week, index) => {
    const month = Number(week[0].date.slice(5, 7)) - 1
    if (month === lastMonth) return
    lastMonth = month
    if (labels.length && index - labels[labels.length - 1].week < 3) return
    labels.push({ week: index, label: `${month + 1}月` })
  })
  return labels
})

const tooltipStyle = computed(() => {
  if (!hovered.value) return {}
  return { left: `${hovered.value.x}px`, top: `${hovered.value.y}px` }
})

const handleEnter = (cell, event) => {
  if (!cell || cell.future) { hovered.value = null; return }
  const card = cardRef.value?.getBoundingClientRect()
  const rect = event.currentTarget.getBoundingClientRect()
  if (!card) return
  const rawX = rect.left + rect.width / 2 - card.left
  const below = rect.top - card.top < 56
  hovered.value = {
    ...cell,
    below,
    x: Math.min(Math.max(rawX, 88), card.width - 88),
    y: below ? rect.bottom - card.top : rect.top - card.top - 8
  }
}

const handleLeave = () => { hovered.value = null }
</script>

<style scoped>
.heatmap {
  position: relative;
  width: 100%;
  font-family: var(--bm-font-ui);
}

.heatmap-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}

.heatmap-summary { display: flex; align-items: baseline; gap: 12px; min-width: 0; }
.heatmap-title { font-size: 13px; font-weight: 600; color: #2d2822; }
.heatmap-total { color: #9a9389; font-size: 11.5px; }
.heatmap-total strong { color: #2d2822; font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; }

.heatmap-legend { display: flex; align-items: center; gap: 4px; color: #9a9389; font-size: 10.5px; white-space: nowrap; }
.legend-cell { width: 10px; height: 10px; border-radius: 2px; box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.04); }

.heatmap-grid {
  display: grid;
  grid-template-columns: 20px repeat(53, minmax(0, 1fr));
  grid-template-rows: 14px repeat(7, auto);
  gap: 3px;
}

.month-label {
  align-self: end;
  color: #9a9389;
  font-size: 10px;
  line-height: 1;
  white-space: nowrap;
  overflow: visible;
  justify-self: start;
}

.weekday-label {
  display: flex;
  align-items: center;
  color: #9a9389;
  font-size: 10px;
  line-height: 1;
}

.heatmap-day {
  width: 100%;
  aspect-ratio: 1;
  padding: 0;
  border: 0;
  border-radius: 2px;
  box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.04);
  cursor: pointer;
  transition: transform 110ms ease, box-shadow 110ms ease, filter 110ms ease;
}

.heatmap-day:hover:not(:disabled),
.heatmap-day:focus-visible {
  transform: scale(1.14);
  box-shadow:
    0 0 0 1px #fff,
    0 0 0 2px rgb(0 0 0 / 0.24);
  filter: brightness(1.03);
  z-index: 3;
  outline: none;
}

.heatmap-day.is-today {
  box-shadow:
    inset 0 0 0 1px rgb(0 0 0 / 0.28),
    0 0 0 1px rgb(255 255 255 / 0.9);
}

.heatmap-tooltip {
  position: absolute;
  z-index: 6;
  min-width: 96px;
  padding: 7px 9px;
  border: 1px solid rgb(60 50 35 / 0.08);
  border-radius: 8px;
  background: rgb(255 253 249 / 0.97);
  box-shadow: 0 6px 20px rgb(60 50 35 / 0.12);
  transform: translate(-50%, -100%);
  pointer-events: none;
  white-space: nowrap;
  backdrop-filter: blur(8px);
}

.heatmap-tooltip.is-below { transform: translate(-50%, 8px); }

.tooltip-date { color: #2d2822; font-size: 11.5px; font-weight: 600; }
.tooltip-count { margin-top: 2px; color: #5c7d5f; font-size: 11px; }
.tooltip-count.is-empty { color: #9a9389; }

.hm-tip-enter-active,
.hm-tip-leave-active { transition: opacity 120ms ease, transform 120ms cubic-bezier(0.22, 1, 0.36, 1); }
.hm-tip-enter-from,
.hm-tip-leave-to { opacity: 0; transform: translate(-50%, calc(-100% + 4px)) scale(0.96); }
</style>
