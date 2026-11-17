<template>
  <section ref="cardRef" class="heatmap-card">
    <header class="heatmap-head">
      <div class="heatmap-summary">
        <span class="summary-main"><strong>{{ activeDays }}</strong> 天有打卡</span>
        <span v-if="streak > 0" class="summary-sub">最长连续 <strong>{{ streak }}</strong> 天</span>
      </div>
      <div class="heatmap-legend" aria-hidden="true">
        <span>少</span>
        <i v-for="level in [0, 1, 2, 3, 4]" :key="level" class="legend-cell" :style="{ background: colorOf(level) }" />
        <span>多</span>
      </div>
    </header>

    <div class="heatmap-grid">
      <span
        v-for="label in monthLabels"
        :key="`m-${label.month}`"
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
        :key="cell.key"
        type="button"
        class="heatmap-cell"
        :class="{ 'is-today': cell.date === todayDate, 'is-future': cell.future }"
        :style="{ gridColumn: 2 + cell.week, gridRow: 2 + cell.day, background: colorOf(cell.level) }"
        :disabled="cell.future"
        :aria-label="`${cell.date} ${levelLabel(cell.level)}`"
        @mouseenter="handleEnter(cell, $event)"
        @mouseleave="handleLeave"
        @focus="handleEnter(cell, $event)"
        @blur="handleLeave"
        @click="emit('click', cell)"
      />
    </div>

    <Transition name="hm-tip">
      <div v-if="hovered" class="heatmap-tooltip" :class="{ 'is-below': hovered.below }" :style="tooltipStyle">
        <div class="tooltip-date">{{ hovered.displayDate }}</div>
        <div class="tooltip-level" :class="{ 'is-empty': !hovered.level }">
          {{ hovered.level ? levelLabel(hovered.level) : '无打卡' }}
        </div>
        <div v-if="hovered.note" class="tooltip-note">{{ hovered.note }}</div>
      </div>
    </Transition>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue'
import { differenceInCalendarDays, eachDayOfInterval, endOfYear, format, getISODay, startOfYear } from 'date-fns'
import { zhCN } from 'date-fns/locale'

const props = defineProps({
  data: { type: Array, default: () => [] },
  year: { type: Number, default: () => new Date().getFullYear() },
  color: { type: String, default: '#10b981' },
  streak: { type: Number, default: 0 }
})

const emit = defineEmits(['click'])

const WEEK_COUNT = 53
const WEEKDAY_LABELS = ['一', '', '三', '', '五', '', '']
const LEVEL_MIX = [0, 24, 44, 68, 100]
const LEVEL_NAMES = ['', '轻量', '正常', '认真', '超额']

const cardRef = ref(null)
const hovered = ref(null)
const todayDate = format(new Date(), 'yyyy-MM-dd')

const dataMap = computed(() => {
  const map = new Map()
  props.data.forEach(item => {
    if (item.date) map.set(item.date, item)
  })
  return map
})

const weeks = computed(() => {
  const start = startOfYear(new Date(props.year, 0, 1))
  const end = endOfYear(start)
  const offset = getISODay(start) - 1
  const grid = Array.from({ length: WEEK_COUNT }, () => Array(7).fill(null))

  eachDayOfInterval({ start, end }).forEach(day => {
    const date = format(day, 'yyyy-MM-dd')
    const index = offset + differenceInCalendarDays(day, start)
    const week = Math.floor(index / 7)
    if (week >= WEEK_COUNT) return
    const record = dataMap.value.get(date)
    grid[week][index % 7] = {
      key: date,
      date,
      displayDate: format(day, 'M月d日 EEEE', { locale: zhCN }),
      level: record?.level || 0,
      note: record?.note || '',
      future: date > todayDate,
      week,
      day: index % 7
    }
  })

  return grid
})

const cells = computed(() => weeks.value.flat().filter(Boolean))

const activeDays = computed(() => cells.value.filter(cell => cell.level > 0).length)

const monthLabels = computed(() => {
  const labels = []
  let lastWeek = -9
  for (let month = 0; month < 12; month++) {
    const prefix = `${props.year}-${String(month + 1).padStart(2, '0')}`
    let week = -1
    for (let w = 0; w < weeks.value.length && week < 0; w++) {
      for (let d = 0; d < 7; d++) {
        const cell = weeks.value[w][d]
        if (cell && cell.date === `${prefix}-01`) { week = w; break }
      }
    }
    if (week < 0 || week - lastWeek < 2) continue
    labels.push({ month, week, label: `${month + 1}月` })
    lastWeek = week
  }
  return labels
})

const colorOf = level => {
  if (!level) return '#ebedf0'
  return `color-mix(in srgb, ${props.color} ${LEVEL_MIX[level] || 100}%, #ffffff)`
}

const levelLabel = level => (level ? LEVEL_NAMES[level] || `等级 ${level}` : '未打卡')

const tooltipStyle = computed(() => {
  if (!hovered.value) return {}
  return {
    left: `${hovered.value.x}px`,
    top: `${hovered.value.y - 8}px`
  }
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
.heatmap-card {
  position: relative;
  padding: 16px 18px 18px;
  border: 1px solid #e5e5ea;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.03);
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
.summary-main { color: #6e6e73; font-size: 12px; }
.summary-main strong { color: #1d1d1f; font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; }
.summary-sub { color: #8e8e93; font-size: 11.5px; }
.summary-sub strong { color: #1d1d1f; font-weight: 600; font-variant-numeric: tabular-nums; }

.heatmap-legend { display: flex; align-items: center; gap: 4px; color: #8e8e93; font-size: 10.5px; white-space: nowrap; }
.legend-cell { width: 10px; height: 10px; border-radius: 2px; box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.04); }

.heatmap-grid {
  display: grid;
  grid-template-columns: 20px repeat(53, minmax(0, 1fr));
  grid-template-rows: 14px repeat(7, auto);
  gap: 3px;
}

.month-label {
  align-self: end;
  color: #8e8e93;
  font-size: 10px;
  line-height: 1;
  white-space: nowrap;
  overflow: visible;
  justify-self: start;
}

.weekday-label {
  display: flex;
  align-items: center;
  color: #8e8e93;
  font-size: 10px;
  line-height: 1;
}

.heatmap-cell {
  width: 100%;
  aspect-ratio: 1;
  padding: 0;
  border: 0;
  border-radius: 2px;
  box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.04);
  cursor: pointer;
  transition:
    transform 110ms ease,
    box-shadow 110ms ease,
    filter 110ms ease;
}

.heatmap-cell:hover:not(:disabled),
.heatmap-cell:focus-visible {
  transform: scale(1.14);
  box-shadow:
    0 0 0 1px #fff,
    0 0 0 2px rgb(0 0 0 / 0.24);
  filter: brightness(1.03);
  z-index: 3;
  outline: none;
}

.heatmap-cell.is-today {
  box-shadow:
    inset 0 0 0 1px rgb(0 0 0 / 0.28),
    0 0 0 1px rgb(255 255 255 / 0.9);
}

.heatmap-cell.is-future { cursor: default; }

.heatmap-tooltip {
  position: absolute;
  z-index: 6;
  min-width: 96px;
  max-width: 220px;
  padding: 7px 9px;
  border: 1px solid rgb(0 0 0 / 0.06);
  border-radius: 8px;
  background: rgb(255 255 255 / 0.97);
  box-shadow: 0 6px 20px rgb(0 0 0 / 0.12);
  transform: translate(-50%, -100%);
  pointer-events: none;
  backdrop-filter: blur(8px);
}

.heatmap-tooltip.is-below { transform: translate(-50%, 8px); }

.tooltip-date { color: #1d1d1f; font-size: 11.5px; font-weight: 600; }
.tooltip-level { margin-top: 2px; color: #007aff; font-size: 11px; }
.tooltip-level.is-empty { color: #8e8e93; }
.tooltip-note { margin-top: 3px; color: #6e6e73; font-size: 10.5px; line-height: 1.35; }

.hm-tip-enter-active,
.hm-tip-leave-active { transition: opacity 120ms ease, transform 120ms cubic-bezier(0.22, 1, 0.36, 1); }
.hm-tip-enter-from,
.hm-tip-leave-to { opacity: 0; transform: translate(-50%, calc(-100% + 4px)) scale(0.96); }
</style>
