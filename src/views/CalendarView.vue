<template>
  <div class="fade-in bm-page calendar-pro-page">
    <div class="cp-shell">
      <section class="cp-month-panel" aria-label="月历">
        <header class="cp-month-header">
          <div class="cp-header-side left">
            <button type="button" class="cp-nav-button" aria-label="日历设置" @click="settingsVisible = true">
              <i class="fas fa-gear" aria-hidden="true"></i>
            </button>
            <button type="button" class="cp-nav-button" aria-label="上一月" @click="showPreviousMonth">
              <i class="fas fa-chevron-left" aria-hidden="true"></i>
            </button>
          </div>
          <div class="cp-header-center">
            <h2 class="cp-month-title">{{ displayedYear }}年{{ displayedMonth }}月</h2>
            <span v-if="syncing" class="cp-sync-inline" role="status">同步中…</span>
            <span v-else-if="syncStatus" class="cp-sync-inline cp-sync-inline-status" role="status" :title="syncStatus">{{ syncStatus }}</span>
          </div>
          <div class="cp-header-side right">
            <div class="cp-sync-wrap">
              <button type="button" class="bm-btn bm-btn-ghost bm-btn-icon cp-sync-button" title="macOS 日历同步" aria-label="macOS 日历同步" :disabled="syncing" @click.stop="toggleSyncMenu">
                <ReminderIcon name="sync" :size="16" :class="{ 'cp-spin': syncing }" />
              </button>
              <Transition name="cp-sync-menu">
                <div v-if="syncMenuOpen" class="cp-sync-menu" @click.stop>
                  <button type="button" class="cp-sync-action" :disabled="syncing" @click="syncMacCalendar">
                    {{ syncing ? '正在同步…' : '与 macOS 日历同步' }}
                  </button>
                  <small>同名日历双向同步，以最新修改为准；只读日历自动跳过</small>
                </div>
              </Transition>
            </div>
            <button type="button" class="cp-today-button" @click="resetToToday">今天</button>
            <button type="button" class="cp-nav-button" aria-label="下一月" @click="showNextMonth">
              <i class="fas fa-chevron-right" aria-hidden="true"></i>
            </button>
          </div>
        </header>

        <MonthGrid
          :days="monthDays"
          :items="allItems"
          :selected-key="selectedItemKey"
          :selected-keys="selectedItemKeys"
          :week-start="settings.weekStart"
          :show-lunar="settings.showLunar"
          :lunar-style="settings.lunarStyle"
          :show-holidays="settings.showHolidays"
          :highlight-weekends="settings.highlightWeekends"
          @select="selectDate"
          @select-item="selectItem"
          @edit-item="editItemFromMonth"
          @toggle-reminder-item="toggleReminderItem"
          @create="createFromCell"
          @context-day="openDayMenu"
          @context-item="openItemMenu"
          @move-item="moveItem"
          @create-range="createRange"
          :draft="composerDraft"
        />

        <div class="cp-selected-summary">
          <div class="cp-summary-date">
            <strong>{{ selectedSummary.dateText }}</strong>
            <span>{{ selectedSummary.weekdayText }}</span>
            <span v-if="settings.showLunar" class="cp-lunar-label">农历 {{ selectedSummary.lunarText }}</span>
          </div>
          <div v-if="settings.showHolidays && selectedSummary.chips.length" class="cp-summary-chips">
            <span v-for="chip in selectedSummary.chips" :key="chip" :class="{ off: chip === '休', work: chip === '班' }">{{ chip }}</span>
          </div>
        </div>

        <div v-if="settings.showWeather || settings.showAlmanac" class="cp-info-strips">
          <WeatherStrip v-if="settings.showWeather" :locations="settingsStore.visibleWeatherLocations" :date="calendarStore.selectedDate" @details="openWeatherDetails" />
          <AlmanacStrip v-if="settings.showAlmanac" :almanac="selectedSummary.day.almanac" />
        </div>
      </section>

      <AgendaPanel
        v-model:mode="calendarStore.agendaMode"
        :selected-date="calendarStore.selectedDate"
        :items="allItems"
        :loading="calendarStore.loading"
        :selected-keys="selectedItemKeys"
        @select="selectItem"
        @context-item="openItemMenu"
        @select-date="selectDate"
        @create="openComposer"
        @join="openMeeting"
        @toggle-task="toggleTask"
        @toggle-reminder="toggleReminderItem"
      />
    </div>

    <div v-if="calendarStore.error" class="cp-error" role="alert">{{ calendarStore.error }}</div>

    <EventComposer
      :show="composerVisible"
      :event="composerEvent"
      :defaults="composerDefaults"
      :calendars="calendarStore.calendars"
      @close="closeComposer"
      :anchor="composerAnchor"
      @save="saveEvent"
      @delete="deleteEvent"
      @preview="updateDraftPreview"
    />

    <MonthContextMenu
      :show="contextMenu.show"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :item="contextMenu.item"
      :calendars="calendarStore.calendars"
      :has-clipboard="hasClipboard"
      :selection-count="contextMenu.selectionCount"
      @close="closeContextMenu"
      @new-event="newEventFromMenu"
      @new-reminder="newReminderFromMenu"
      @paste="pasteFromMenu"
      @edit="editFromMenu"
      @copy="copyFromMenu"
      @cut="cutFromMenu"
      @duplicate="duplicateFromMenu"
      @change-calendar="changeCalendarFromMenu"
      @toggle-reminder="toggleReminderFromMenu"
      @delete-event="deleteEventFromMenu"
      @delete-occurrence="deleteOccurrenceFromMenu"
      @open-reminder="openReminderFromMenu"
      @toggle-reminder-done="toggleLinkedReminderFromMenu"
      @delete-reminder="deleteLinkedReminderFromMenu"
      @share="shareSelection"
    />

    <TaskDetailDrawer
      :show="taskDrawerVisible"
      mode="edit"
      :task="drawerTask"
      :projects="projectStore.projects"
      @close="taskDrawerVisible = false"
      @save="saveTask"
      @delete="deleteTask"
    />

    <CalendarProSettings :show="settingsVisible" @close="settingsVisible = false" />
    <WeatherDetailDialog
      :show="weatherDetailsVisible"
      :location="weatherDetailsLocation || settings.weatherLocation"
      @close="weatherDetailsVisible = false"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { addDays, addMonths, format, parseISO } from 'date-fns'
import { useRouter } from 'vue-router'
import { useCalendarStore } from '@stores/calendar-store'
import { useTaskStore } from '@stores/task-store'
import { useProjectStore } from '@stores/project-store'
import { useReminderStore } from '@stores/reminder-store'
import { useUndoStore } from '@stores/undo-store'
import { useCalendarProSettings } from '@stores/calendar-pro-settings'
import { colorHex } from '@utils/reminders'
import { buildIcsFromOccurrences } from '@utils/calendar-ics.js'
import { syncCalendarWithMac } from '../services/mac-calendar-sync.js'
import {
  expandOccurrences,
  makeMonthGrid,
  makeSelectedDateSummary,
  toDateKey
} from '@utils/calendar-pro.js'
import MonthGrid from '@components/calendar-pro/MonthGrid.vue'
import MonthContextMenu from '@components/calendar-pro/MonthContextMenu.vue'
import AgendaPanel from '@components/calendar-pro/AgendaPanel.vue'
import EventComposer from '@components/calendar-pro/EventComposer.vue'
import WeatherStrip from '@components/calendar-pro/WeatherStrip.vue'
import WeatherDetailDialog from '@components/calendar-pro/WeatherDetailDialog.vue'
import AlmanacStrip from '@components/calendar-pro/AlmanacStrip.vue'
import CalendarProSettings from '@components/calendar-pro/CalendarProSettings.vue'
import ReminderIcon from '@components/reminders/ReminderIcon.vue'
import TaskDetailDrawer from '@components/task-board/TaskDetailDrawer.vue'

const router = useRouter()
const calendarStore = useCalendarStore()
const taskStore = useTaskStore()
const projectStore = useProjectStore()
const reminderStore = useReminderStore()
const undoStore = useUndoStore()
const settingsStore = useCalendarProSettings()
const settings = settingsStore.settings
const selectedItemKey = ref('')
const selectedItemKeys = ref([])
const clearItemSelection = () => {
  selectedItemKey.value = ''
  selectedItemKeys.value = []
}
const today = toDateKey(new Date())
const settingsVisible = ref(false)
const weatherDetailsVisible = ref(false)
const weatherDetailsLocation = ref(null)
const openWeatherDetails = location => {
  weatherDetailsLocation.value = location || settings.weatherLocation
  weatherDetailsVisible.value = true
}

const syncMenuOpen = ref(false)
const syncStatus = ref('')
const syncing = ref(false)
let syncStatusTimer = null
const setSyncStatus = message => {
  syncStatus.value = message
  if (syncStatusTimer) window.clearTimeout(syncStatusTimer)
  syncStatusTimer = window.setTimeout(() => { syncStatus.value = '' }, 8000)
}
const closeSyncMenu = () => { syncMenuOpen.value = false }
const toggleSyncMenu = () => { syncMenuOpen.value = !syncMenuOpen.value }
const onSyncOutside = event => {
  if (!event.target.closest('.cp-sync-wrap')) closeSyncMenu()
}
watch(syncMenuOpen, open => {
  if (open) document.addEventListener('click', onSyncOutside, true)
  else document.removeEventListener('click', onSyncOutside, true)
})
const monthRange = () => {
  const year = displayedYear.value
  const month = displayedMonth.value
  const pad = value => String(value).padStart(2, '0')
  const lastDay = new Date(year, month, 0).getDate()
  return { startDate: `${year}-${pad(month)}-01`, endDate: `${year}-${pad(month)}-${pad(lastDay)}` }
}
const syncMacCalendar = async () => {
  closeSyncMenu()
  if (syncing.value) return
  const { startDate, endDate } = monthRange()
  syncing.value = true
  setSyncStatus('')
  try {
    const { summary, skippedCalendars } = await syncCalendarWithMac({
      startDate,
      endDate,
      calendars: calendarStore.calendars,
      loadLocalItems: async () => {
        await calendarStore.refresh()
        await nextTick()
        return allItems.value
      }
    })
    const skippedNote = skippedCalendars.length
      ? `；只读日历已跳过：${skippedCalendars.map(item => item.name).join('、')}`
      : ''
    setSyncStatus(`同步完成 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}：本地→macOS 新建 ${summary.macCreated}、更新 ${summary.macUpdated}、删除 ${summary.macDeleted}；macOS→本地 新建 ${summary.localCreated}、更新 ${summary.localUpdated}、删除 ${summary.localDeleted}${skippedNote}`)
  } catch (err) {
    setSyncStatus(err.message || '同步失败')
  } finally {
    syncing.value = false
  }
}

const displayedYear = computed(() => Number(calendarStore.monthDate.slice(0, 4)))
const displayedMonth = computed(() => Number(calendarStore.monthDate.slice(5, 7)))
const monthDays = computed(() => makeMonthGrid(
  calendarStore.monthDate,
  calendarStore.selectedDate,
  today,
  settings.region,
  settings.weekStart === 'sunday' ? 7 : 1
))
const selectedSummary = computed(() => makeSelectedDateSummary(calendarStore.selectedDate, monthDays.value, settings.region))
const queryRange = computed(() => {
  const start = monthDays.value[0]?.date || calendarStore.monthDate
  const overviewEnd = format(addDays(parseISO(calendarStore.selectedDate), 30), 'yyyy-MM-dd')
  const end = (monthDays.value[41]?.date || overviewEnd) > overviewEnd ? monthDays.value[41].date : overviewEnd
  return { startDate: start, endDate: end }
})
const calendarMap = computed(() => Object.fromEntries(calendarStore.calendars.map(calendar => [calendar.id, calendar])))
const visibleCalendarIds = computed(() => new Set(calendarStore.calendars.filter(calendar => calendar.is_visible).map(calendar => calendar.id)))
const eventItems = computed(() => expandOccurrences(
  calendarStore.events,
  calendarStore.overrides,
  queryRange.value.startDate,
  queryRange.value.endDate
)
  .filter(item => visibleCalendarIds.value.has(item.calendar_id))
  .map(item => ({ ...item, color: calendarMap.value[item.calendar_id]?.color || '#3b82f6' })))
const taskItems = computed(() => settings.showTasks
  ? taskStore.tasks
    .filter(task => task.due_date && task.due_date >= queryRange.value.startDate && task.due_date <= queryRange.value.endDate)
    .map(task => ({
      id: `task-${task.id}`,
      sourceType: 'task',
      task,
      title: task.name,
      startDate: task.due_date,
      endDate: task.due_date,
      occurrenceDate: task.due_date,
      occurrenceKey: `task-${task.id}:${task.due_date}`,
      allDay: true,
      startTime: null,
      endTime: null,
      color: '#e28614'
    }))
  : [])
const reminderItems = computed(() => settings.showReminders
  ? reminderStore.reminders
    .filter(reminder => (
      !reminder.is_completed
      && reminder.date
      && reminder.date >= queryRange.value.startDate
      && reminder.date <= queryRange.value.endDate
    ))
    .map(reminder => ({
      id: `reminder-${reminder.id}`,
      sourceType: 'reminder',
      reminderId: reminder.id,
      reminder,
      title: reminder.title,
      startDate: reminder.date,
      endDate: reminder.date,
      occurrenceDate: reminder.date,
      occurrenceKey: `reminder-${reminder.id}:${reminder.date}`,
      allDay: !reminder.due_time,
      startTime: reminder.due_time || null,
      endTime: null,
      color: colorHex(reminder.list_color),
      notes: reminder.notes || '',
      location: ''
    }))
  : [])
const allItems = computed(() => [...eventItems.value, ...taskItems.value, ...reminderItems.value])
watch(queryRange, range => calendarStore.fetchRange(range.startDate, range.endDate), { immediate: true })

const refreshLinkedData = () => {
  taskStore.fetchAllTasks()
  projectStore.fetchProjects()
  reminderStore.fetchAll({ silent: true })
}
onMounted(() => {
  refreshLinkedData()
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('focus', refreshLinkedData)
})
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('focus', refreshLinkedData)
  document.removeEventListener('click', onSyncOutside, true)
  if (syncStatusTimer) window.clearTimeout(syncStatusTimer)
})

const changeMonth = async delta => {
  clearItemSelection()
  const target = format(addMonths(parseISO(calendarStore.monthDate), delta), 'yyyy-MM-01')
  const update = async () => {
    calendarStore.setMonthDate(target)
    await nextTick()
  }
  if (!document.startViewTransition) {
    await update()
    return
  }
  try {
    const transition = document.startViewTransition({
      update,
      types: [delta > 0 ? 'next' : 'prev']
    })
    transition.finished.catch(() => {})
    transition.updateCallbackDone.catch(() => {})
  } catch {
    await update()
  }
}
const showPreviousMonth = () => changeMonth(-1)
const showNextMonth = () => changeMonth(1)
const resetToToday = () => {
  clearItemSelection()
  calendarStore.setMonthDate(`${today.slice(0, 7)}-01`)
  calendarStore.selectDate(today)
}
const selectDate = date => {
  clearItemSelection()
  calendarStore.selectDate(date)
  const month = `${date.slice(0, 7)}-01`
  if (calendarStore.monthDate !== month) calendarStore.setMonthDate(month)
}

const composerVisible = ref(false)
const composerEvent = ref(null)
const composerDefaults = ref({})
const composerAnchor = ref(null)
const composerDraft = ref(null)
const selectedCellAnchor = () => {
  const cell = document.querySelector(`.cp-day[data-date="${calendarStore.selectedDate}"]`)
  if (!cell) return null
  const rect = cell.getBoundingClientRect()
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}
const draftBarRect = () => {
  const bars = document.querySelectorAll('.cp-event-bar.is-draft')
  const bar = bars[bars.length - 1]
  return bar ? bar.getBoundingClientRect().toJSON() : null
}
const anchorToDraft = () => {
  const rect = draftBarRect()
  if (rect) composerAnchor.value = { ...rect, x: rect.right, y: rect.top + rect.height / 2 }
}
const draftColorFor = kind => {
  const name = kind === 'reminder' ? '提醒事项' : kind === 'class' ? '课程' : '日程'
  return calendarStore.calendars.find(calendar => calendar.name === name)?.color
    || calendarStore.calendars.find(calendar => calendar.name === '日程')?.color
    || '#3b82f6'
}
const openComposer = async (defaults = {}, anchor = null) => {
  composerEvent.value = null
  const date = defaults.date || calendarStore.selectedDate
  const kind = defaults.kind || 'event'
  composerDefaults.value = { date, allDay: kind === 'event' ? Boolean(defaults.allDay) : true, ...defaults }
  composerDraft.value = {
    startDate: date,
    endDate: defaults.endDate || date,
    title: kind === 'reminder' ? '新建提醒事项' : '新建日程',
    kind,
    color: draftColorFor(kind)
  }
  await nextTick()
  if (draftBarRect()) anchorToDraft()
  else composerAnchor.value = anchor || selectedCellAnchor()
  composerVisible.value = true
}
const updateDraftPreview = preview => {
  if (!composerVisible.value || composerEvent.value) return
  composerDraft.value = { ...composerDraft.value, ...preview }
  nextTick(anchorToDraft)
}
const closeComposer = () => {
  composerVisible.value = false
  composerDraft.value = null
}
const createFromCell = ({ date, rect, x, y }) => openComposer({ date }, rect ? { ...rect, x, y } : null)
const openEventEditor = (item, anchor = null) => {
  composerEvent.value = item
  composerDraft.value = null
  composerAnchor.value = anchor || selectedCellAnchor()
  composerVisible.value = true
}
const openReminderItem = item => {
  if (!item?.reminderId) return
  router.push({ path: '/reminders', query: { focus: String(item.reminderId) } })
}

const selectItem = payload => {
  const item = payload?.item || payload
  const rect = payload?.rect || null
  const additive = Boolean(payload?.additive)
  const key = item.occurrenceKey || ''
  if (additive && item.sourceType === 'event' && key) {
    selectedItemKeys.value = selectedItemKeys.value.includes(key)
      ? selectedItemKeys.value.filter(value => value !== key)
      : [...selectedItemKeys.value, key]
    selectedItemKey.value = selectedItemKeys.value.includes(key) ? key : (selectedItemKeys.value.at(-1) || '')
    return
  }
  selectedItemKey.value = key
  selectedItemKeys.value = item.sourceType === 'event' && key ? [key] : []
  if (item.sourceType === 'reminder') {
    openReminderItem(item)
  } else if (item.sourceType === 'task') {
    calendarStore.selectDate(item.startDate)
    calendarStore.setAgendaMode('day')
    drawerTask.value = item.task
    taskDrawerVisible.value = true
  } else if (rect && item.startDate === item.endDate) {
    calendarStore.selectDate(item.startDate)
    calendarStore.setAgendaMode('day')
    const month = `${item.startDate.slice(0, 7)}-01`
    if (calendarStore.monthDate !== month) calendarStore.setMonthDate(month)
  } else if (!rect) {
    openEventEditor(item)
  }
}
const editItemFromMonth = payload => {
  const item = payload?.item
  if (!item) return
  if (item.sourceType === 'reminder') {
    openReminderItem(item)
    return
  }
  selectedItemKey.value = item.occurrenceKey || ''
  selectedItemKeys.value = item.sourceType === 'event' && item.occurrenceKey ? [item.occurrenceKey] : []
  calendarStore.selectDate(item.startDate)
  const month = `${item.startDate.slice(0, 7)}-01`
  if (calendarStore.monthDate !== month) calendarStore.setMonthDate(month)
  openEventEditor(item, payload.rect ? { ...payload.rect, x: payload.x, y: payload.y } : null)
}
const toggleReminderItem = async item => {
  if (!item || item.kind !== 'reminder') return
  await calendarStore.saveEvent(eventPayload(item, { reminder_done: item.reminder_done ? 0 : 1 }), { scope: 'all' })
}

const contextMenu = reactive({ show: false, x: 0, y: 0, date: null, item: null, selectionCount: 0 })
const eventClipboard = ref(null)
const hasClipboard = computed(() => Boolean(eventClipboard.value))
const closeContextMenu = () => {
  contextMenu.show = false
  contextMenu.date = null
  contextMenu.item = null
}
const openDayMenu = ({ date, x, y }) => Object.assign(contextMenu, { show: true, x, y, date, item: null, selectionCount: 0 })
const openItemMenu = ({ item, x, y }) => {
  const key = item?.occurrenceKey || ''
  if (item?.sourceType === 'event' && key && !selectedItemKeys.value.includes(key)) {
    selectedItemKeys.value = [key]
    selectedItemKey.value = key
  }
  const selectionCount = item?.sourceType === 'event'
    ? (selectedItemKeys.value.length || 1)
    : 1
  Object.assign(contextMenu, { show: true, x, y, date: item?.startDate, item, selectionCount })
}
const shareSelection = async () => {
  const keys = selectedItemKeys.value.length
    ? selectedItemKeys.value
    : [selectedItemKey.value].filter(Boolean)
  const chosen = allItems.value.filter(item => item.sourceType === 'event' && keys.includes(item.occurrenceKey))
  closeContextMenu()
  if (!chosen.length) return
  const { content } = buildIcsFromOccurrences({ calendars: calendarStore.calendars, items: chosen })
  const safeTitle = String(chosen[0].title || '日程')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
    .slice(0, 60) || '日程'
  const defaultName = chosen.length === 1
    ? `${safeTitle}.ics`
    : `BongMaster_${chosen.length}个日程_${today}.ics`
  try {
    const result = await window.electronAPI.saveIcsFile({ content, defaultName })
    if (result?.success) setSyncStatus(`已分享 ${chosen.length} 个日程`)
    else if (!result?.cancelled) setSyncStatus(result?.error || '分享失败')
  } catch (err) {
    setSyncStatus(err.message || '分享失败')
  }
}
const openReminderFromMenu = () => {
  const item = contextMenu.item
  closeContextMenu()
  openReminderItem(item)
}
const toggleLinkedReminderFromMenu = () => {
  const item = contextMenu.item
  closeContextMenu()
  if (!item?.reminderId) return
  reminderStore.toggleComplete(item.reminderId, !item.reminder?.is_completed)
}
const deleteLinkedReminderFromMenu = async () => {
  const item = contextMenu.item
  closeContextMenu()
  if (!item?.reminderId) return
  if (!window.confirm(`删除提醒「${item.title}」？可在提醒事项的最近删除中恢复。`)) return
  const removed = await reminderStore.deleteReminder(item.reminderId)
  if (removed) {
    undoStore.showUndo({
      message: `已删除提醒「${removed.title || '未命名'}」`,
      undo: () => reminderStore.restoreReminders([removed.id])
    })
  }
}
const menuAnchor = () => ({
  left: contextMenu.x,
  right: contextMenu.x,
  top: contextMenu.y,
  bottom: contextMenu.y,
  width: 0,
  height: 0,
  x: contextMenu.x,
  y: contextMenu.y
})
const newEventFromMenu = () => {
  const date = contextMenu.date || calendarStore.selectedDate
  const anchor = menuAnchor()
  closeContextMenu()
  openComposer({ date }, anchor)
}
const newReminderFromMenu = () => {
  const date = contextMenu.date || calendarStore.selectedDate
  const anchor = menuAnchor()
  closeContextMenu()
  openComposer({ date, kind: 'reminder' }, anchor)
}
const editFromMenu = () => {
  const item = contextMenu.item
  const anchor = menuAnchor()
  closeContextMenu()
  if (item) openEventEditor(item, anchor)
}
const shiftDate = (date, days) => format(addDays(parseISO(date), days), 'yyyy-MM-dd')
const durationDays = (start, end) => Math.max(0, Math.round((parseISO(end) - parseISO(start)) / 86400000))
const eventPayload = (item, extra = {}) => ({
  id: item.eventId,
  title: item.title,
  kind: item.kind,
  calendar_id: item.calendar_id,
  start_date: item.startDate,
  end_date: item.endDate,
  start_time: item.startTime,
  end_time: item.endTime,
  all_day: item.allDay ? 1 : 0,
  location: item.location || '',
  notes: item.notes || '',
  recurrence_type: item.recurrence_type || 'none',
  recurrence_value: item.recurrence_value || '',
  recurrence_end_date: item.recurrence_end_date || null,
  reminder_done: item.reminder_done ? 1 : 0,
  ...extra
})
const eventOptions = item => item.recurrence_type && item.recurrence_type !== 'none'
  ? { scope: 'this', occurrenceDate: item.occurrenceDate }
  : { scope: 'all' }
const copyEvent = item => {
  eventClipboard.value = {
    title: item.title,
    kind: item.kind,
    calendar_id: item.calendar_id,
    start_date: item.startDate,
    end_date: item.endDate,
    start_time: item.startTime,
    end_time: item.endTime,
    all_day: item.allDay ? 1 : 0,
    location: item.location || '',
    notes: item.notes || '',
    recurrence_type: item.recurrence_type || 'none',
    recurrence_value: item.recurrence_value || '',
    recurrence_end_date: item.recurrence_end_date || null
  }
}
const copyFromMenu = () => {
  if (contextMenu.item && contextMenu.item.sourceType !== 'task') copyEvent(contextMenu.item)
  closeContextMenu()
}
const cutFromMenu = () => {
  const item = contextMenu.item
  closeContextMenu()
  if (!item || item.sourceType === 'task') return
  copyEvent(item)
  deleteEvent(item.eventId, eventOptions(item))
}
const duplicateFromMenu = async () => {
  const item = contextMenu.item
  closeContextMenu()
  if (!item || item.sourceType === 'task') return
  const payload = eventPayload(item)
  delete payload.id
  await calendarStore.saveEvent(payload)
}
const changeCalendarFromMenu = async calendarId => {
  const item = contextMenu.item
  closeContextMenu()
  if (!item || item.sourceType === 'task') return
  await calendarStore.saveEvent(eventPayload(item, { calendar_id: calendarId }), eventOptions(item))
}
const toggleReminderFromMenu = async () => {
  const item = contextMenu.item
  closeContextMenu()
  await toggleReminderItem(item)
}
const pasteEvent = async targetDate => {
  const source = eventClipboard.value
  if (!source || !targetDate) return
  const duration = durationDays(source.start_date, source.end_date)
  const payload = {
    ...source,
    start_date: targetDate,
    end_date: shiftDate(targetDate, duration),
    recurrence_type: 'none',
    recurrence_value: '',
    recurrence_end_date: null
  }
  delete payload.id
  await calendarStore.saveEvent(payload)
}
const pasteFromMenu = async () => {
  const date = contextMenu.date
  closeContextMenu()
  await pasteEvent(date)
}
const createRange = ({ startDate, endDate, rect, x, y }) => {
  closeContextMenu()
  const anchor = rect
    ? { ...rect, x: x ?? rect.left + rect.width / 2, y: y ?? rect.top + rect.height / 2 }
    : null
  openComposer({ date: startDate, endDate, allDay: true }, anchor)
}
const moveItem = async ({ item, date }) => {
  if (item.sourceType === 'reminder') {
    await reminderStore.updateReminder(item.reminderId, { date })
    return
  }
  if (item.sourceType === 'task') {
    if (item.task?.id) await taskStore.updateTask(item.task.id, { due_date: date })
    return
  }
  const recurring = item.recurrence_type && item.recurrence_type !== 'none'
  const duration = recurring ? 0 : durationDays(item.startDate, item.endDate)
  await calendarStore.saveEvent(
    eventPayload(item, { start_date: date, end_date: shiftDate(date, duration) }),
    eventOptions(item)
  )
}
const deleteEventFromMenu = () => {
  const item = contextMenu.item
  closeContextMenu()
  if (item && item.sourceType !== 'task') deleteEvent(item.eventId, { scope: 'all' })
}
const deleteOccurrenceFromMenu = () => {
  const item = contextMenu.item
  closeContextMenu()
  if (item && item.sourceType !== 'task') {
    deleteEvent(item.eventId, { scope: 'this', occurrenceDate: item.occurrenceDate })
  }
}
const toggleTask = task => taskStore.updateTask(task.id, {
  status: task.status === '已完成' ? '待办' : '已完成'
})
const openMeeting = async url => {
  try {
    await window.electronAPI.openExternal(url)
  } catch (err) {
    alert(`无法打开会议链接: ${err.message}`)
  }
}
const saveEvent = async (payload, options) => {
  const result = await calendarStore.saveEvent(payload, options)
  if (result) {
    composerVisible.value = false
    composerDraft.value = null
  }
}
const deleteEvent = async (id, options) => {
  const snapshot = await calendarStore.removeEvent(id, options)
  if (!snapshot) return
  composerVisible.value = false
  composerDraft.value = null
  if (snapshot.type !== 'empty') {
    undoStore.showUndo({
      message: '已删除日程',
      undo: () => calendarStore.restoreEvents(snapshot)
    })
  }
}

const taskDrawerVisible = ref(false)
const drawerTask = ref(null)
const saveTask = async (payload, done) => {
  try {
    const result = await taskStore.updateTask(drawerTask.value.id, payload)
    if (result) taskDrawerVisible.value = false
  } finally { done() }
}
const deleteTask = async taskId => {
  const task = taskStore.tasks.find(item => item.id === taskId)
  const deleted = await taskStore.deleteTask(taskId)
  taskDrawerVisible.value = false
  if (deleted) {
    undoStore.showUndo({
      message: `已删除任务「${task?.name || '未命名'}」`,
      undo: () => taskStore.restoreTask(task || { id: taskId })
    })
  }
}

const handleKeydown = event => {
  if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return
  const modifier = event.metaKey || event.ctrlKey
  if (!modifier) return
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault()
    if (event.key === 'ArrowLeft') showPreviousMonth()
    else showNextMonth()
  } else if (event.key.toLowerCase() === 't') {
    event.preventDefault()
    resetToToday()
  } else if (event.key.toLowerCase() === 'n') {
    event.preventDefault()
    openComposer()
  } else if (event.key.toLowerCase() === 'v') {
    event.preventDefault()
    pasteEvent(calendarStore.selectedDate)
  }
}
</script>

<style scoped>
@import '../styles/bongmaster.css';
.calendar-pro-page {
  --cp-mac-border: color-mix(in srgb, var(--bm-border-subtle) 55%, #d7d7dc);
  --cp-mac-muted: #8e8e93;
  --cp-mac-surface: #f5f5f7;
  --cp-mac-blue: #007aff;
  max-width: 1360px;
  padding: 16px 20px 24px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--bm-bg-card) 84%, #ffffff);
  font-family: var(--bm-font-ui);
}
.cp-shell { display: grid; grid-template-columns: minmax(560px, 1.85fr) minmax(260px, 0.55fr); min-height: calc(100vh - var(--bm-navbar-height) - 48px); border: 1px solid var(--cp-mac-border); border-radius: 12px; overflow: hidden; background: #fff; box-shadow: 0 8px 26px rgb(20 20 22 / 0.06); }
.cp-month-panel { position: relative; min-width: 0; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; background: #fff; }
.cp-month-header { display: grid; grid-template-columns: auto 1fr auto; align-items: center; min-height: 42px; gap: 8px; }
.cp-header-side { display: flex; align-items: center; gap: 6px; }
.cp-header-side.right { justify-content: flex-end; }
.cp-header-center { display: flex; align-items: baseline; justify-content: flex-start; gap: 10px; min-width: 0; padding-left: 4px; }
.cp-month-title { flex: 0 0 auto; margin: 0; padding-left: 4px; color: #1d1d1f; font-size: 28px; font-weight: 700; letter-spacing: -0.035em; line-height: 1.1; white-space: nowrap; }
.cp-sync-inline { min-width: 0; max-width: 380px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--bm-text-muted); font-size: 11.5px; }
.cp-sync-inline-status { max-width: min(380px, 42vw); }

.cp-sync-wrap { position: relative; display: flex; }
.cp-sync-button { width: 28px; height: 28px; padding: 0; }
.cp-sync-button:disabled { opacity: 0.55; cursor: default; }
.cp-spin { animation: cp-spin 900ms linear infinite; }
@keyframes cp-spin { to { transform: rotate(360deg); } }
.cp-sync-menu { position: absolute; right: 0; top: calc(100% + 6px); z-index: 20; width: 264px; padding: 7px; border: 1px solid var(--bm-border-default); border-radius: 10px; background: var(--bm-bg-card); box-shadow: 0 12px 32px rgb(0 0 0 / 0.16); }
.cp-sync-menu button { width: 100%; height: 30px; padding: 0 9px; border: 0; border-radius: 7px; background: transparent; color: var(--bm-text-primary); font: inherit; font-size: 12.5px; text-align: left; cursor: pointer; }
.cp-sync-menu button:hover:not(:disabled) { background: var(--bm-bg-hover); }
.cp-sync-menu button:disabled { color: var(--bm-text-muted); cursor: default; }
.cp-sync-menu small { display: block; padding: 5px 9px 2px; color: var(--bm-text-muted); font-size: 10.5px; line-height: 1.45; }
.cp-sync-menu-enter-active, .cp-sync-menu-leave-active { transition: opacity 120ms ease, transform 120ms ease; }
.cp-sync-menu-enter-from, .cp-sync-menu-leave-to { opacity: 0; transform: translateY(-4px) scale(0.98); }
.cp-nav-button { width: 30px; height: 30px; display: grid; place-items: center; padding: 0; border: 1px solid var(--cp-mac-border); border-radius: 50%; background: var(--cp-mac-surface); color: #515154; font-size: 12px; line-height: 1; cursor: pointer; }
.cp-today-button { min-height: 28px; padding: 0 11px; border: 1px solid var(--cp-mac-border); border-radius: 999px; background: var(--cp-mac-surface); color: #3a3a3c; font-size: 13px; font-weight: 600; cursor: pointer; }
.cp-info-strips { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1.25fr); gap: 6px; padding-top: 2px; }
.cp-selected-summary { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; min-height: 22px; padding-top: 2px; border-top: 1px solid var(--cp-mac-border, var(--bm-border-subtle)); }
.cp-summary-date { display: flex; align-items: baseline; flex-wrap: wrap; gap: 5px; }
.cp-summary-date strong { font-size: 13px; }
.cp-summary-date span { color: var(--bm-text-secondary); font-size: 12px; }
.cp-summary-date .cp-lunar-label { margin-left: 4px; color: var(--bm-text-muted); }
.cp-summary-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.cp-summary-chips span { padding: 2px 6px; border: 1px solid rgba(185, 80, 50, 0.13); border-radius: 999px; background: rgba(185, 80, 50, 0.055); color: #8b3e31; font-size: 10px; }
.cp-summary-chips span.off { border-color: rgba(204, 48, 55, 0.18); background: rgba(204, 48, 55, 0.08); color: #a4262c; }
.cp-summary-chips span.work { border-color: rgba(39, 112, 204, 0.16); background: rgba(39, 112, 204, 0.07); color: #245f9e; }
.cp-error { position: fixed; right: 24px; bottom: 24px; padding: 10px 14px; border-radius: 8px; background: var(--bm-accent-red); color: #fff; font-size: 12px; }
button:focus-visible { outline: 2px solid var(--bm-accent-blue); outline-offset: 2px; }
@media (max-width: 900px) {
  .calendar-pro-page { padding: 12px; }
  .cp-shell { grid-template-columns: 1fr; min-height: auto; }
  .cp-month-panel { padding: 12px; }
}
</style>
