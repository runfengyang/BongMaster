<template>
  <div class="cp-month-grid-wrap">
    <div class="cp-weekdays" aria-hidden="true">
      <span v-for="day in weekdays" :key="day">{{ day }}</span>
    </div>
    <div class="cp-month-grid">
      <section
        v-for="week in weeksWithBars"
        :key="week.week[0]?.date"
        class="cp-week"
        :class="{ 'has-bars': week.laneCount > 0 }"
      >
        <div class="cp-week-cells">
          <div
            v-for="day in week.week"
            :key="day.date"
            class="cp-day"
            role="button"
            tabindex="0"
            :data-date="day.date"
            :aria-label="dayLabel(day)"
            :class="{
              'is-outside': !day.isInDisplayedMonth,
              'is-weekend': highlightWeekends && day.isWeekend,
              'is-today': day.isToday,
              'is-selected': day.isSelected,
              'is-rest': showHolidays && day.badge === '休',
              'is-workday': showHolidays && day.badge === '班',
              'is-range': inRange(day),
              'is-drag-over': dragOverDate === day.date
            }"
            @click="onDayClick(day)"
            @dblclick="onDayDoubleClick(day, $event)"
            @contextmenu.prevent="openDayMenu(day, $event)"
            @mousedown="startRange(day, $event)"
            @mouseenter="extendRange(day)"
            @keydown.enter.prevent="onDayClick(day)"
            @keydown.space.prevent="onDayClick(day)"
            @dragover.prevent="dragOverDate = day.date"
            @dragleave="dragOverDate === day.date && (dragOverDate = null)"
            @drop.prevent="onDrop(day, $event)"
          >
            <div class="cp-day-head">
              <span class="cp-day-lunar">{{ lunarLabel(day) }}</span>
              <span class="cp-day-number" :class="{ 'is-today': day.isToday }">{{ day.dayNumber }}</span>
            </div>
            <div v-if="week.dayLaneCounts[day.date]" class="cp-lane-spacer" :style="{ height: `${week.dayLaneCounts[day.date] * 21}px` }"></div>
            <div class="cp-day-events">
              <span v-if="lunarEventFor(day)" class="cp-holiday-chip is-term" :title="lunarEventFor(day)"><span class="cp-holiday-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 2.6l2.86 6.1 6.68.78-4.94 4.6 1.3 6.6L12 17.5l-5.9 3.18 1.3-6.6-4.94-4.6 6.68-.78z" fill="currentColor"/></svg></span><span class="cp-holiday-text">{{ lunarEventFor(day) }}</span></span>
              <button
                v-for="item in visibleItems(day)"
                :key="item.occurrenceKey"
                type="button"
                class="cp-event-chip"
                :class="{
                  'is-task': item.sourceType === 'task',
                  'is-reminder': item.kind === 'reminder',
                  'is-all-day': item.allDay,
                  'is-active': isItemSelected(item),
                  'is-completed': item.task?.status === '已完成',
                  'is-reminder-done': item.kind === 'reminder' && item.reminder_done
                }"
                :style="{ '--event-color': item.color }"
                :title="chipTitle(item)"
                draggable="true"
                @click.stop="$emit('select-item', { item, rect: $event.currentTarget.getBoundingClientRect().toJSON(), x: $event.clientX, y: $event.clientY, additive: $event.metaKey || $event.ctrlKey })"
                @dblclick.stop="$emit('edit-item', { item, rect: $event.currentTarget.getBoundingClientRect().toJSON(), x: $event.clientX, y: $event.clientY })"
                @contextmenu.stop.prevent="openItemMenu(item, $event)"
                @dragstart="startDrag(item, $event)"
                @dragend="endDrag"
              >
                <span
                  v-if="item.kind === 'reminder'"
                  class="cp-reminder-dot"
                  :class="{ done: item.reminder_done }"
                  :style="{ borderColor: isItemSelected(item) ? '#fff' : item.color, background: item.reminder_done ? (isItemSelected(item) ? '#fff' : item.color) : 'transparent' }"
                  role="button"
                  tabindex="0"
                  @click.stop="$emit('toggle-reminder-item', item)"
                  @keydown.enter.stop="$emit('toggle-reminder-item', item)"
                  @keydown.space.prevent.stop="$emit('toggle-reminder-item', item)"
                ></span>
                <span v-else class="cp-color-line" :style="{ background: item.color }"></span>
                <span class="cp-chip-title">{{ item.title }}</span>
              </button>
              <button v-if="hiddenCount(day)" type="button" class="cp-more" @click.stop="$emit('select', day.date)">+{{ hiddenCount(day) }} 项</button>
            </div>
          </div>
        </div>
        <div v-if="week.laneCount" class="cp-week-bars" :style="{ height: `${week.laneCount * 21}px` }">
          <template v-for="bar in week.bars" :key="bar.key">
            <div
              v-if="bar.isDraft"
              class="cp-event-bar is-draft"
              data-draft="true"
              :class="{ 'is-start': bar.isStart, 'is-end': bar.isEnd }"
              :style="{ left: bar.left, width: bar.width, top: bar.top, '--event-color': bar.item.color }"
            >
              <span class="cp-type-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 2.5v2H5.6A2.6 2.6 0 0 0 3 7.1v11.8A2.6 2.6 0 0 0 5.6 21.5h12.8a2.6 2.6 0 0 0 2.6-2.6V7.1a2.6 2.6 0 0 0-2.6-2.6H17v-2h-2v2H9v-2H7zm12.5 6.5v9.9a.6.6 0 0 1-.6.6H5.6a.6.6 0 0 1-.6-.6V9h14.5z" fill="currentColor"/></svg></span>
              <span class="cp-chip-title">{{ bar.item.title }}</span>
            </div>
            <div
              v-else-if="bar.isHoliday"
              class="cp-event-bar is-holiday"
              :class="{ 'is-start': bar.isStart, 'is-end': bar.isEnd }"
              :style="{ left: bar.left, width: bar.width, top: bar.top }"
              :title="bar.item.title"
            >
              <span v-if="bar.showStar" class="cp-holiday-star" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 2.6l2.86 6.1 6.68.78-4.94 4.6 1.3 6.6L12 17.5l-5.9 3.18 1.3-6.6-4.94-4.6 6.68-.78z" fill="currentColor"/></svg></span>
              <span class="cp-chip-title">{{ bar.item.title }}</span>
            </div>
            <button
              v-else
              type="button"
              class="cp-event-bar"
              :class="{ 'is-start': bar.isStart, 'is-end': bar.isEnd, 'is-active': isItemSelected(bar.item) }"
              :style="{ left: bar.left, width: bar.width, top: bar.top, '--event-color': bar.item.color }"
              :title="chipTitle(bar.item)"
              draggable="true"
              @click.stop="$emit('select-item', { item: bar.item, rect: $event.currentTarget.getBoundingClientRect().toJSON(), x: $event.clientX, y: $event.clientY, additive: $event.metaKey || $event.ctrlKey })"
              @dblclick.stop="$emit('edit-item', { item: bar.item, rect: $event.currentTarget.getBoundingClientRect().toJSON(), x: $event.clientX, y: $event.clientY })"
              @contextmenu.stop.prevent="openItemMenu(bar.item, $event)"
              @dragstart="startDrag(bar.item, $event)"
              @dragend="endDrag"
            >
              <span class="cp-type-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 2.5v2H5.6A2.6 2.6 0 0 0 3 7.1v11.8A2.6 2.6 0 0 0 5.6 21.5h12.8a2.6 2.6 0 0 0 2.6-2.6V7.1a2.6 2.6 0 0 0-2.6-2.6H17v-2h-2v2H9v-2H7zm12.5 6.5v9.9a.6.6 0 0 1-.6.6H5.6a.6.6 0 0 1-.6-.6V9h14.5z" fill="currentColor"/></svg></span>
              <span class="cp-chip-title">{{ bar.item.title }}</span>
            </button>
          </template>
        </div>
        <div v-if="rangeSegmentFor(week)" class="cp-range-overlay">
          <div
            class="cp-range-bar"
            :class="{ 'is-start': rangeSegmentFor(week).isStart, 'is-end': rangeSegmentFor(week).isEnd }"
            :style="{ left: rangeSegmentFor(week).left, width: rangeSegmentFor(week).width }"
          ></div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { itemsForDate } from '@utils/calendar-pro.js'

const props = defineProps({
  days: { type: Array, default: () => [] },
  items: { type: Array, default: () => [] },
  weekStart: { type: String, default: 'monday' },
  showLunar: { type: Boolean, default: true },
  lunarStyle: { type: String, default: 'day' },
  showHolidays: { type: Boolean, default: true },
  highlightWeekends: { type: Boolean, default: true },
  selectedKey: { type: String, default: '' },
  selectedKeys: { type: Array, default: () => [] },
  draft: { type: Object, default: null }
})
const emit = defineEmits(['select', 'select-item', 'edit-item', 'toggle-reminder-item', 'create', 'context-day', 'context-item', 'move-item', 'create-range'])

const weekdays = computed(() => props.weekStart === 'sunday'
  ? ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  : ['周一', '周二', '周三', '周四', '周五', '周六', '周日'])
const weeks = computed(() => Array.from({ length: 6 }, (_, index) => props.days.slice(index * 7, index * 7 + 7)))
const selectedKeySet = computed(() => new Set(props.selectedKeys))
const isItemSelected = item => selectedKeySet.value.has(item?.occurrenceKey) || props.selectedKey === item?.occurrenceKey
const holidayBarFor = day => {
  if (!props.showHolidays || !day.holiday) return null
  return day.holiday
}
const holidayRangeTitle = holiday => {
  if (holiday.kind === 'workingAdjustmentDay') return `${holiday.name.replace(/调休上班$/, '')}（班）`
  if (holiday.kind === 'statutoryHoliday' || holiday.kind === 'publicHoliday') return `${holiday.name}（休）`
  return holiday.name
}
const holidayRanges = computed(() => {
  if (!props.showHolidays) return []
  const ranges = []
  let current = null
  for (const day of props.days) {
    const holiday = holidayBarFor(day)
    if (!holiday) {
      current = null
      continue
    }
    if (current && current.name === holiday.name && current.kind === holiday.kind) {
      current.end = day.date
    } else {
      current = { name: holiday.name, title: holidayRangeTitle(holiday), kind: holiday.kind, start: day.date, end: day.date }
      ranges.push(current)
    }
  }
  return ranges
})
const weeksWithBars = computed(() => weeks.value.map(week => {
  const bars = []
  const weekStart = week[0]?.date
  const weekEnd = week[6]?.date
  if (!weekStart || !weekEnd) return { week, bars, laneCount: 0, dayLaneCounts: {} }
  for (const item of props.items) {
    if (!item.startDate || !item.endDate || item.startDate >= item.endDate) continue
    if (item.endDate < weekStart || item.startDate > weekEnd) continue
    let startCol = 0
    while (startCol < 7 && week[startCol].date < item.startDate) startCol += 1
    let endCol = 6
    while (endCol >= 0 && week[endCol].date > item.endDate) endCol -= 1
    if (startCol > 6 || endCol < 0 || startCol > endCol) continue
    bars.push({
      key: `${item.occurrenceKey}-${weekStart}`,
      item,
      startCol,
      endCol,
      isStart: item.startDate >= weekStart,
      isEnd: item.endDate <= weekEnd,
      showTime: !item.allDay && item.startDate >= weekStart && Boolean(item.startTime)
    })
  }
  for (const range of holidayRanges.value) {
    if (range.end < weekStart || range.start > weekEnd) continue
    let startCol = 0
    while (startCol < 7 && week[startCol].date < range.start) startCol += 1
    let endCol = 6
    while (endCol >= 0 && week[endCol].date > range.end) endCol -= 1
    if (startCol > 6 || endCol < 0 || startCol > endCol) continue
    bars.push({
      key: `holiday-${range.start}-${weekStart}`,
      item: { title: range.title, color: '#af52de' },
      startCol,
      endCol,
      isStart: range.start >= weekStart,
      isEnd: range.end <= weekEnd,
      showStar: range.start >= weekStart,
      isHoliday: true
    })
  }
  const draft = props.draft
  if (draft?.startDate && draft.endDate && draft.startDate <= weekEnd && draft.endDate >= weekStart) {
    let startCol = 0
    while (startCol < 7 && week[startCol].date < draft.startDate) startCol += 1
    let endCol = 6
    while (endCol >= 0 && week[endCol].date > draft.endDate) endCol -= 1
    if (startCol <= 6 && endCol >= 0 && startCol <= endCol) {
      bars.push({
        key: `draft-${weekStart}`,
        item: draft,
        startCol,
        endCol,
        isStart: draft.startDate >= weekStart,
        isEnd: draft.endDate <= weekEnd,
        isDraft: true
      })
    }
  }
  bars.sort((a, b) => a.startCol - b.startCol || (b.endCol - b.startCol) - (a.endCol - a.startCol))
  const lanes = []
  for (const bar of bars) {
    let lane = 0
    while (lanes[lane]?.some(existing => !(bar.endCol < existing.startCol || bar.startCol > existing.endCol))) lane += 1
    if (!lanes[lane]) lanes[lane] = []
    lanes[lane].push(bar)
    bar.lane = lane
    bar.left = `calc(${(bar.startCol / 7) * 100}% + 3px)`
    bar.width = `calc(${((bar.endCol - bar.startCol + 1) / 7) * 100}% - 6px)`
    bar.top = `${bar.lane * 21 + 1}px`
  }
  const dayLaneCounts = {}
  for (const bar of bars) {
    for (let col = bar.startCol; col <= bar.endCol; col += 1) {
      const date = week[col]?.date
      if (date) dayLaneCounts[date] = Math.max(dayLaneCounts[date] || 0, bar.lane + 1)
    }
  }
  return { week, bars, laneCount: lanes.length, dayLaneCounts }
}))

const lunarLabel = day => {
  if (!props.showLunar || !day.lunar) return ''
  if (props.lunarStyle === 'monthDay') return `${day.lunar.monthText}${day.lunar.dayText}`
  if (props.lunarStyle === 'full') return day.lunarFullText
  return day.lunar.dayNumber === 1 ? day.lunar.monthText : day.lunar.dayText
}
const lunarEventFor = day => {
  if (!props.showLunar || !day.lunar || holidayBarFor(day)) return null
  return day.lunar.solarTermName || day.lunar.festivalName || null
}
const itemsFor = day => itemsForDate(props.items, day.date)
const singleDayItemsFor = day => itemsFor(day).filter(item => item.startDate === item.endDate)
const visibleItems = day => singleDayItemsFor(day).slice(0, 4)
const hiddenCount = day => Math.max(0, singleDayItemsFor(day).length - 4)
const chipTitle = item => `${item.title}${item.allDay ? '，全天' : `，${item.startTime || ''}–${item.endTime || ''}`}`
const dayLabel = day => `${day.date}，${day.weekdayLabel}，农历${day.lunarFullText}`

const dragging = ref(null)
const dragOverDate = ref(null)
const startDrag = (item, event) => {
  dragging.value = item
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', item.occurrenceKey || String(item.id))
}
const endDrag = () => {
  dragging.value = null
  dragOverDate.value = null
}
const onDrop = (day, event) => {
  const item = dragging.value
  if (!item) return
  event.preventDefault()
  emit('move-item', { item, date: day.date })
  dragging.value = null
  dragOverDate.value = null
}

const rangeActive = ref(false)
const rangeStart = ref(null)
const rangeEnd = ref(null)
const rangeMoved = ref(false)
let suppressClick = false
const startRange = (day, event) => {
  if (event.button !== 0 || event.target.closest('button')) return
  rangeActive.value = true
  rangeStart.value = day.date
  rangeEnd.value = day.date
  rangeMoved.value = false
}
const extendRange = day => {
  if (!rangeActive.value || !rangeStart.value) return
  if (rangeEnd.value !== day.date) rangeMoved.value = true
  rangeEnd.value = day.date
}
const finishRange = event => {
  if (!rangeActive.value) return
  const start = rangeStart.value
  const end = rangeEnd.value
  const moved = rangeMoved.value
  rangeActive.value = false
  rangeStart.value = null
  rangeEnd.value = null
  if (!moved || !start || !end) return
  const [from, to] = start <= end ? [start, end] : [end, start]
  suppressClick = true
  window.setTimeout(() => { suppressClick = false }, 250)
  const rectFor = date => document.querySelector(`.cp-day[data-date="${date}"]`)?.getBoundingClientRect()
  const startRect = rectFor(from)
  const endRect = rectFor(to)
  const rect = startRect && endRect
    ? {
        left: Math.min(startRect.left, endRect.left),
        top: Math.min(startRect.top, endRect.top),
        right: Math.max(startRect.right, endRect.right),
        bottom: Math.max(startRect.bottom, endRect.bottom),
        width: Math.max(startRect.right, endRect.right) - Math.min(startRect.left, endRect.left),
        height: Math.max(startRect.bottom, endRect.bottom) - Math.min(startRect.top, endRect.top)
      }
    : null
  emit('create-range', { startDate: from, endDate: to, rect, x: event?.clientX, y: event?.clientY })
}
const inRange = day => {
  if (!rangeActive.value || !rangeStart.value || !rangeEnd.value) return false
  const [from, to] = rangeStart.value <= rangeEnd.value
    ? [rangeStart.value, rangeEnd.value]
    : [rangeEnd.value, rangeStart.value]
  return day.date >= from && day.date <= to
}
const rangeSegments = computed(() => {
  if (!rangeActive.value || !rangeMoved.value || !rangeStart.value || !rangeEnd.value) return []
  const [from, to] = rangeStart.value <= rangeEnd.value
    ? [rangeStart.value, rangeEnd.value]
    : [rangeEnd.value, rangeStart.value]
  const segments = []
  for (const week of weeks.value) {
    const weekStart = week[0]?.date
    const weekEnd = week[6]?.date
    if (!weekStart || !weekEnd || to < weekStart || from > weekEnd) continue
    let startCol = 0
    while (startCol < 7 && week[startCol].date < from) startCol += 1
    let endCol = 6
    while (endCol >= 0 && week[endCol].date > to) endCol -= 1
    if (startCol > 6 || endCol < 0 || startCol > endCol) continue
    segments.push({
      weekStart,
      left: `calc(${(startCol / 7) * 100}% + 3px)`,
      width: `calc(${((endCol - startCol + 1) / 7) * 100}% - 6px)`,
      isStart: from >= weekStart,
      isEnd: to <= weekEnd
    })
  }
  return segments
})
const rangeSegmentFor = week => rangeSegments.value.find(segment => segment.weekStart === week.week[0]?.date)
const onDayClick = day => {
  if (suppressClick) return
  emit('select', day.date)
}
const onDayDoubleClick = (day, event) => {
  if (event.target.closest('button, .cp-holiday-chip')) return
  emit('create', { date: day.date, rect: event.currentTarget.getBoundingClientRect().toJSON(), x: event.clientX, y: event.clientY })
}
const openDayMenu = (day, event) => {
  emit('context-day', { date: day.date, x: event.clientX, y: event.clientY })
}
const openItemMenu = (item, event) => {
  emit('context-item', { item, x: event.clientX, y: event.clientY })
}

onMounted(() => window.addEventListener('mouseup', finishRange))
onUnmounted(() => window.removeEventListener('mouseup', finishRange))
</script>

<style scoped>
.cp-month-grid-wrap { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.cp-weekdays { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); padding: 2px 0 7px; color: var(--cp-mac-muted, #8e8e93); font-size: 13px; text-align: center; }
.cp-month-grid {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: repeat(6, minmax(84px, 1fr));
  border-top: 1px solid var(--cp-mac-border, var(--bm-border-subtle));
  border-left: 1px solid var(--cp-mac-border, var(--bm-border-subtle));
  background: #fff;
  user-select: none;
}
.cp-week { position: relative; min-height: 0; display: flex; flex-direction: column; border-bottom: 1px solid var(--cp-mac-border, var(--bm-border-subtle)); }
.cp-week:last-child { border-bottom: 0; }
.cp-week-bars { position: absolute; left: 0; right: 0; top: 28px; z-index: 3; pointer-events: none; }
.cp-range-overlay { position: absolute; left: 0; right: 0; top: 27px; height: 21px; z-index: 4; pointer-events: none; }
.cp-range-bar { position: absolute; top: 1px; height: 20px; border: 1px solid color-mix(in srgb, #007aff 36%, transparent); background: color-mix(in srgb, #007aff 11%, #fff); transition: left 110ms cubic-bezier(0.2, 0.8, 0.2, 1), width 110ms cubic-bezier(0.2, 0.8, 0.2, 1); }
.cp-range-bar.is-start { border-start-start-radius: 6px; border-end-start-radius: 6px; }
.cp-range-bar.is-end { border-start-end-radius: 6px; border-end-end-radius: 6px; }
.cp-week-cells { flex: 1; min-height: 0; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); }
.cp-day {
  min-width: 0;
  min-height: 74px;
  padding: 3px 5px 4px;
  border-right: 1px solid var(--cp-mac-border, var(--bm-border-subtle));
  background: #fff;
  color: var(--bm-text-primary);
  display: flex;
  flex-direction: column;
  gap: 3px;
  overflow: hidden;
  cursor: pointer;
  transition: background 120ms ease;
}
.cp-day.is-outside { background: #f7f7f8; }
.cp-day.is-outside .cp-day-lunar, .cp-day.is-outside .cp-day-number { color: #b0b0b5; }
.cp-day:hover { background: #f5f5f7; }
.cp-day.is-selected { background: color-mix(in srgb, #007aff 4%, #f5f5f7); }
.cp-day.is-range { background: #eaf3ff; }
.cp-day.is-drag-over { background: #eaf3ff; outline: 1px dashed color-mix(in srgb, #007aff 55%, transparent); outline-offset: -2px; }
.cp-day.is-today:not(.is-selected) { background: #fff; }
.cp-day.is-rest:not(.is-selected) { background: color-mix(in srgb, #ff3b30 2%, #fff); }
.cp-day.is-workday:not(.is-selected) { background: color-mix(in srgb, #007aff 2%, #fff); }
.cp-day-head { display: flex; align-items: center; gap: 4px; min-height: 24px; }
.cp-day-lunar { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #1d1d1f; font-size: 15px; line-height: 1.2; }
.cp-day-number {
  margin-left: auto;
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  font-size: 15px;
  font-weight: 500;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.cp-day-number.is-today { background: #d92d20; color: #fff; font-weight: 650; }
.cp-day.is-selected .cp-day-number { background: #d1d1d6; color: #1d1d1f; font-weight: 650; }
.cp-day.is-selected .cp-day-number.is-today { background: #d92d20; color: #fff; }
.cp-day-badge { padding: 0 4px; border-radius: 999px; background: #cc3037; color: #fff; font-size: 9px; line-height: 1.5; font-weight: 700; }
.cp-day-badge.work { background: #2770cc; }
.cp-lane-spacer { flex: 0 0 auto; }
.cp-day-events { min-height: 0; display: flex; flex-direction: column; gap: 0; overflow: hidden; }
.cp-holiday-chip { display: flex; align-items: center; gap: 4px; min-width: 0; overflow: hidden; padding: 0 5px; border-radius: 5px; background: #f3e3fb; color: #1d1d1f; font-size: 12.5px; line-height: 1.4; }
.cp-holiday-chip.is-term { background: #f3e3fb; }
.cp-holiday-icon { width: 13px; height: 13px; flex: 0 0 13px; display: grid; place-items: center; border-radius: 50%; background: #af52de; color: #fff; }
.cp-holiday-icon svg { width: 8px; height: 8px; display: block; }
.cp-holiday-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cp-type-icon { width: 13px; height: 13px; flex: 0 0 13px; display: grid; place-items: center; border-radius: 50%; background: color-mix(in srgb, var(--event-color) 88%, #1d1d1f); color: #fff; }
.cp-type-icon svg { width: 8px; height: 8px; display: block; }
.cp-event-bar {
  position: absolute;
  pointer-events: auto;
  height: 20px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 5px;
  border: 0;
  border-radius: 0;
  background: color-mix(in srgb, var(--event-color) 22%, #fff);
  color: var(--bm-text-primary);
  font-size: 13px;
  line-height: 1.35;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  transition: background 140ms ease, color 140ms ease, box-shadow 160ms ease, transform 160ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.cp-event-bar:hover { background: color-mix(in srgb, var(--event-color) 28%, transparent); }
.cp-event-bar.is-active { background: var(--event-color); color: #fff; }
.cp-event-bar.is-active .cp-type-icon { background: rgb(255 255 255 / 0.24); color: #fff; }
.cp-event-bar.is-active .cp-chip-time { color: rgb(255 255 255 / 0.82); }
.cp-event-bar.is-start { border-start-start-radius: 5px; border-end-start-radius: 5px; }
.cp-event-bar.is-end { border-start-end-radius: 5px; border-end-end-radius: 5px; }
.cp-event-bar.is-holiday { background: #f3e3fb; color: #1d1d1f; pointer-events: none; }
.cp-event-bar.is-draft { background: var(--event-color); color: #fff; pointer-events: none; opacity: 0.96; }
.cp-event-bar.is-draft .cp-type-icon { background: rgb(255 255 255 / 0.24); color: #fff; }
.cp-holiday-star { width: 13px; height: 13px; flex: 0 0 13px; display: grid; place-items: center; border-radius: 50%; background: #af52de; color: #fff; }
.cp-holiday-star svg { width: 8px; height: 8px; display: block; }
.cp-event-chip {
  width: 100%;
  min-height: 18px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 4px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--bm-text-primary);
  font-size: 13px;
  line-height: 1.35;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  transition: background 140ms ease, color 140ms ease, box-shadow 160ms ease, transform 160ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.cp-event-chip:hover { background: color-mix(in srgb, var(--event-color) 9%, transparent); }
.cp-event-chip.is-active, .cp-event-chip.is-active:hover { background: var(--event-color); color: #fff; padding-left: 10px; }
@media (prefers-reduced-motion: no-preference) {
  .cp-event-chip.is-active { transform: scale(1.02); box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--event-color) 55%, transparent); }
  .cp-event-bar.is-active { transform: scale(1.01); }
}
.cp-event-chip.is-active .cp-chip-title { font-weight: 600; }
.cp-event-chip.is-active .cp-color-line { display: none; }
.cp-event-chip.is-active .cp-reminder-dot { border-color: #fff; }
.cp-event-chip.is-reminder.is-active { color: #fff; }
.cp-color-dot { width: 7px; height: 7px; flex: 0 0 7px; border-radius: 50%; }
.cp-color-line { width: 3px; height: 12px; flex: 0 0 3px; border-radius: 2px; }
.cp-chip-time { flex: 0 0 auto; color: #6e6e73; font-size: 11px; font-variant-numeric: tabular-nums; }
.cp-chip-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cp-event-chip.is-reminder { background: transparent; color: var(--event-color); padding-left: 2px; }
.cp-event-chip.is-reminder:hover { background: color-mix(in srgb, var(--event-color) 10%, transparent); }
.cp-event-chip.is-reminder.is-active { background: var(--event-color); color: #fff; }
.cp-reminder-dot { width: 13px; height: 13px; flex: 0 0 13px; border: 1.5px solid; border-radius: 50%; }
.cp-event-chip.is-completed { opacity: 0.55; text-decoration: line-through; }
.cp-event-chip.is-reminder-done { opacity: 0.55; }
.cp-event-chip.is-reminder .cp-chip-title { position: relative; display: inline-block; }
.cp-event-chip.is-reminder .cp-chip-title::after { content: ""; position: absolute; top: 52%; right: 0; left: 0; height: 1px; background: currentColor; transform: scaleX(0); transform-origin: left center; transition: transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1); }
.cp-event-chip.is-reminder-done .cp-chip-title::after { transform: scaleX(1); }
.cp-event-chip.is-reminder-done .cp-reminder-dot { transform: scale(0.85); }
.cp-more { align-self: flex-start; padding: 0 4px; border: 0; background: transparent; color: var(--bm-text-muted); font-size: 10.5px; cursor: pointer; }
.cp-more:hover { color: var(--bm-accent-blue); }
button:focus-visible { outline: 2px solid var(--bm-accent-blue); outline-offset: -2px; }
.cp-day:focus-visible { outline: 1px solid color-mix(in srgb, #007aff 42%, transparent); outline-offset: -1px; }
@media (max-width: 720px) {
  .cp-month-grid { grid-template-rows: repeat(6, minmax(68px, 1fr)); }
  .cp-day { min-height: 62px; padding: 3px; }
  .cp-day-lunar { display: none; }
  .cp-chip-time { display: none; }
  .cp-event-bar { height: 17px; font-size: 9px; }
}
</style>
