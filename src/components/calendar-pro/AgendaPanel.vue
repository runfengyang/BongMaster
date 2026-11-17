<template>
  <section class="cp-agenda" aria-label="日程列表">
    <header class="cp-agenda-header">
      <div class="cp-agenda-title">
        <strong>日程</strong>
        <span>{{ displayCount }} 项</span>
      </div>
      <div class="cp-agenda-switch" role="group" aria-label="日程视图">
        <button type="button" :aria-pressed="mode === 'day'" @click="$emit('update:mode', 'day')">日</button>
        <button type="button" :aria-pressed="mode === 'overview'" @click="$emit('update:mode', 'overview')">总览</button>
      </div>
    </header>

    <div v-if="loading" class="cp-agenda-empty">正在读取日程…</div>
    <div v-else-if="mode === 'day'" class="cp-day-agenda">
      <div v-if="allDayItems.length" class="cp-all-day-block">
        <span class="cp-agenda-section-label">全天</span>
        <div class="cp-all-day-list">
          <AgendaEventCard v-for="item in allDayItems" :key="item.occurrenceKey" :item="item" :selected="selectedKeySet.has(item.occurrenceKey)" @select="$emit('select', $event)" @context-item="$emit('context-item', $event)" @join="$emit('join', $event)" @toggle-task="$emit('toggle-task', $event)" @toggle-reminder="$emit('toggle-reminder', $event)" />
        </div>
      </div>
      <div v-if="untimedItems.length" class="cp-untimed-block">
        <span class="cp-agenda-section-label">无时间</span>
        <AgendaEventCard v-for="item in untimedItems" :key="item.occurrenceKey" :item="item" :selected="selectedKeySet.has(item.occurrenceKey)" @select="$emit('select', $event)" @context-item="$emit('context-item', $event)" @join="$emit('join', $event)" @toggle-task="$emit('toggle-task', $event)" @toggle-reminder="$emit('toggle-reminder', $event)" />
      </div>
      <div v-if="!dayItems.length" class="cp-agenda-empty">这一天还没有日程</div>
      <div ref="scrollArea" class="cp-timeline-scroll">
        <div class="cp-timeline" :style="{ height: `${24 * hourHeight}px` }" @dblclick="createFromTimeline">
          <div v-for="hour in 24" :key="hour" class="cp-hour-line" :style="{ top: `${(hour - 1) * hourHeight}px` }">
            <span>{{ String(hour - 1).padStart(2, '0') }}:00</span>
          </div>
          <div v-if="selectedDate === today" class="cp-now-line" :style="{ top: `${nowMinutes / 60 * hourHeight}px` }"></div>
          <div
            v-for="position in timedLayout"
            :key="position.item.occurrenceKey"
            class="cp-timeline-event"
            role="button"
            tabindex="0"
            :class="{ 'is-task': position.item.sourceType === 'task', 'is-compact': position.compact, 'is-active': selectedKeySet.has(position.item.occurrenceKey) }"
            :style="{
              '--cp-event-color': position.item.color,
              top: `${position.top}px`,
              height: `${position.height}px`,
              left: `${position.left}%`,
              width: `${position.width}%`
            }"
            @click="$emit('select', { item: position.item, additive: $event.metaKey || $event.ctrlKey })"
            @keydown.enter="$emit('select', { item: position.item, additive: $event.metaKey || $event.ctrlKey })"
            @keydown.space.prevent="$emit('select', { item: position.item, additive: $event.metaKey || $event.ctrlKey })"
            @contextmenu.prevent="$emit('context-item', { item: position.item, x: $event.clientX, y: $event.clientY })"
          >
            <span>{{ eventTimeLabel(position.item) }}</span>
            <strong>{{ position.item.title }}</strong>
            <small v-if="position.item.location">{{ position.item.location }}</small>
            <small v-if="position.item.notes" class="cp-timeline-notes">{{ position.item.notes }}</small>
            <button v-if="meetingLinkFor(position.item)" type="button" class="cp-meeting-link" aria-label="加入会议" @click.stop="$emit('join', meetingLinkFor(position.item))">
              <i class="fas fa-video" aria-hidden="true"></i>
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="cp-overview">
      <div v-if="!overviewGroups.length" class="cp-agenda-empty">近期没有日程</div>
      <section v-for="group in overviewGroups" :key="group.date" class="cp-overview-group">
        <button type="button" class="cp-overview-date" @click="$emit('select-date', group.date)">
          <strong>{{ group.label }}</strong><span>{{ group.weekday }}</span>
        </button>
        <AgendaEventCard v-for="item in group.items" :key="item.occurrenceKey" :item="item" :selected="selectedKeySet.has(item.occurrenceKey)" @select="$emit('select', $event)" @context-item="$emit('context-item', $event)" @join="$emit('join', $event)" @toggle-task="$emit('toggle-task', $event)" @toggle-reminder="$emit('toggle-reminder', $event)" />
      </section>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { format } from 'date-fns'
import { eventTimeLabel, groupOverviewItems, itemsForDate, meetingLinkFor } from '@utils/calendar-pro.js'
import AgendaEventCard from './AgendaEventCard.vue'

const props = defineProps({
  selectedDate: { type: String, required: true },
  items: { type: Array, default: () => [] },
  mode: { type: String, default: 'day' },
  loading: { type: Boolean, default: false },
  selectedKeys: { type: Array, default: () => [] }
})
const emit = defineEmits(['select', 'select-date', 'context-item', 'create', 'update:mode', 'join', 'toggle-task'])
const selectedKeySet = computed(() => new Set(props.selectedKeys))
const MIN_HOUR_HEIGHT = 44
const hourHeight = ref(MIN_HOUR_HEIGHT)
const scrollArea = ref(null)
const today = format(new Date(), 'yyyy-MM-dd')
const nowMinutes = ref(new Date().getHours() * 60 + new Date().getMinutes())
let clockTimer = null

const dayItems = computed(() => itemsForDate(props.items, props.selectedDate))
const allDayItems = computed(() => dayItems.value.filter(item => item.allDay))
const untimedItems = computed(() => dayItems.value.filter(item => !item.allDay && !item.startTime))
const timedItems = computed(() => dayItems.value.filter(item => !item.allDay && item.startTime))
const overviewGroups = computed(() => groupOverviewItems(props.items, props.selectedDate, 30))
const displayCount = computed(() => props.mode === 'day'
  ? dayItems.value.length
  : overviewGroups.value.reduce((sum, group) => sum + group.items.length, 0))

const minutes = value => {
  const [hour, minute] = String(value || '00:00').split(':').map(Number)
  return hour * 60 + minute
}
const timedLayout = computed(() => {
  const heightPerHour = hourHeight.value
  const entries = timedItems.value.map(item => {
    const start = minutes(item.startTime)
    const end = Math.max(start + 15, minutes(item.endTime))
    const height = Math.max(18, (end - start) / 60 * heightPerHour)
    return { item, start, end, top: start / 60 * heightPerHour, height, compact: height < 34 }
  }).sort((a, b) => a.start - b.start || a.end - b.end)
  const result = []
  let cluster = []
  let clusterEnd = -1
  const finish = () => {
    const columns = Math.max(1, ...cluster.map(item => item.column + 1))
    for (const entry of cluster) {
      result.push({ ...entry, left: entry.column / columns * 100, width: 100 / columns })
    }
    cluster = []
    clusterEnd = -1
  }
  for (const entry of entries) {
    if (cluster.length && entry.start >= clusterEnd) finish()
    const used = new Set(cluster.filter(other => other.end > entry.start).map(other => other.column))
    let column = 0
    while (used.has(column)) column++
    cluster.push({ ...entry, column })
    clusterEnd = Math.max(clusterEnd, entry.end)
  }
  if (cluster.length) finish()
  return result
})

const createFromTimeline = event => {
  if (event.target.closest('button')) return
  const rect = event.currentTarget.getBoundingClientRect()
  const start = Math.round((event.clientY - rect.top) / hourHeight.value * 60 / 30) * 30
  const end = Math.min(1440, start + 60)
  const label = value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
  emit('create', { date: props.selectedDate, time: label(start), endTime: label(end) })
}
const scrollToContext = () => nextTick(() => {
  if (!scrollArea.value) return
  const start = props.selectedDate === today ? Math.max(0, nowMinutes.value - 120) : 8 * 60
  scrollArea.value.scrollTop = start / 60 * hourHeight.value
})
const updateHourHeight = () => {
  if (!scrollArea.value) return
  hourHeight.value = Math.max(MIN_HOUR_HEIGHT, scrollArea.value.clientHeight / 24)
}
let resizeObserver = null
onMounted(() => {
  updateHourHeight()
  scrollToContext()
  if (typeof ResizeObserver !== 'undefined' && scrollArea.value) {
    resizeObserver = new ResizeObserver(() => updateHourHeight())
    resizeObserver.observe(scrollArea.value)
  }
  clockTimer = window.setInterval(() => {
    const now = new Date()
    nowMinutes.value = now.getHours() * 60 + now.getMinutes()
  }, 60000)
})
watch(() => [props.selectedDate, timedItems.value.length], () => { updateHourHeight(); scrollToContext() })
onUnmounted(() => {
  if (clockTimer) window.clearInterval(clockTimer)
  if (resizeObserver) resizeObserver.disconnect()
})
</script>

<style scoped>
.cp-agenda { min-width: 0; min-height: 0; display: flex; flex-direction: column; background: #fff; border-left: 1px solid var(--cp-mac-border, var(--bm-border-subtle)); }
.cp-agenda-header { display: flex; align-items: center; gap: 6px; padding: 10px 10px 8px; border-bottom: 1px solid var(--cp-mac-border, var(--bm-border-subtle)); }
.cp-agenda-title { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.cp-agenda-title strong { font-size: 15px; font-weight: 600; }
.cp-agenda-title span { color: #8e8e93; font-size: 12.5px; }
.cp-agenda-switch { margin-left: auto; display: flex; padding: 2px; border-radius: 8px; background: #f2f2f7; }
.cp-agenda-switch button { min-width: 42px; min-height: 24px; border: 0; border-radius: 6px; background: transparent; color: #6e6e73; font-size: 12px; cursor: pointer; }
.cp-agenda-switch button[aria-pressed="true"] { background: var(--cp-mac-blue, #007aff); color: #fff; }
.cp-day-agenda, .cp-overview { flex: 1; min-height: 0; overflow-y: auto; padding: 6px 8px 8px; }
.cp-day-agenda { display: flex; flex-direction: column; gap: 5px; }
.cp-all-day-block, .cp-untimed-block { display: grid; gap: 3px; }
.cp-agenda-section-label { color: var(--bm-text-muted); font-size: 10px; font-weight: 600; }
.cp-all-day-list { display: grid; gap: 3px; }
.cp-agenda-empty { padding: 14px 12px; color: var(--bm-text-muted); font-size: 12px; text-align: center; }
.cp-timeline-scroll { flex: 1 1 0; min-height: 160px; overflow-y: auto; border-top: 1px solid var(--bm-border-subtle); }
.cp-timeline { position: relative; height: calc(24 * 44px); margin: 8px 0 0 48px; }
.cp-hour-line { position: absolute; left: 0; right: 0; height: 1px; background: var(--bm-border-subtle); }
.cp-hour-line span { position: absolute; left: -45px; top: -7px; width: 38px; color: var(--bm-text-muted); font-size: 9px; text-align: right; font-variant-numeric: tabular-nums; }
.cp-now-line { position: absolute; left: 0; right: 0; z-index: 3; height: 1px; background: #d33c42; }
.cp-now-line::before { content: ''; position: absolute; left: -4px; top: -3px; width: 7px; height: 7px; border-radius: 50%; background: #d33c42; }
.cp-timeline-event { position: absolute; z-index: 2; min-width: 0; overflow: hidden; padding: 4px 7px; border: 1px solid color-mix(in srgb, var(--cp-event-color) 28%, transparent); border-left: 3px solid var(--cp-event-color); border-radius: 6px; background: color-mix(in srgb, var(--cp-event-color) 10%, var(--bm-bg-card)); color: var(--bm-text-primary); text-align: left; cursor: pointer; display: grid; align-content: start; gap: 1px; }
.cp-timeline-event span, .cp-timeline-event small { color: var(--bm-text-muted); font-size: 9px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cp-timeline-event .cp-timeline-notes { display: -webkit-box; color: var(--bm-text-secondary); white-space: normal; -webkit-line-clamp: 2; -webkit-box-orient: vertical; line-height: 1.35; }
.cp-timeline-event.is-active { border-color: var(--cp-event-color); box-shadow: inset 0 0 0 2px var(--cp-event-color); }
.cp-timeline-event.is-compact { display: flex; align-items: center; padding: 2px 7px; }
.cp-timeline-event.is-compact span, .cp-timeline-event.is-compact small { display: none; }
.cp-timeline-event.is-compact strong { width: 100%; font-size: 11px; }
.cp-timeline-event strong { font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cp-timeline-event:focus-visible { outline: 2px solid var(--bm-accent-blue); outline-offset: 1px; }
.cp-timeline-event .cp-meeting-link { position: absolute; right: 3px; top: 3px; width: 20px; height: 20px; border: 1px solid color-mix(in srgb, var(--cp-event-color) 24%, transparent); border-radius: 5px; background: color-mix(in srgb, var(--cp-event-color) 9%, var(--bm-bg-card)); color: var(--cp-event-color); font-size: 8px; cursor: pointer; }
.cp-overview { display: grid; align-content: start; gap: 10px; }
.cp-overview-group { display: grid; gap: 3px; }
.cp-overview-date { display: flex; align-items: baseline; gap: 6px; border: 0; background: transparent; color: var(--bm-text-primary); padding: 0; text-align: left; cursor: pointer; }
.cp-overview-date strong { font-size: 12px; }
.cp-overview-date span { color: var(--bm-text-muted); font-size: 10px; }
button:focus-visible { outline: 2px solid var(--bm-accent-blue); outline-offset: 2px; }
@media (max-width: 900px) {
  .cp-agenda { border-left: 0; border-top: 1px solid var(--bm-border-subtle); }
  .cp-timeline-scroll { max-height: 420px; }
}
</style>
