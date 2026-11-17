import { addMonths, endOfMonth, format, startOfMonth, subMonths } from 'date-fns'
import { useCalendarStore } from '@stores/calendar-store'
import { expandOccurrences } from '@utils/calendar-pro.js'
import { syncCalendarWithMac } from '../services/mac-calendar-sync.js'

const INTERVAL_MS = 5 * 60 * 1000
const FIRST_RUN_MS = 15 * 1000

let intervalId = null
let firstRunId = null
let running = false

const calendarRange = () => {
  const now = new Date()
  return {
    startDate: format(startOfMonth(subMonths(now, 1)), 'yyyy-MM-dd'),
    endDate: format(endOfMonth(addMonths(now, 1)), 'yyyy-MM-dd')
  }
}

const loadCalendarBundle = async (startDate, endDate) => {
  const data = await window.electronAPI.getCalendarData(startDate, endDate)
  const calendars = data.calendars || []
  const visibleIds = new Set(calendars.filter(item => item.is_visible).map(item => item.id))
  const localItems = expandOccurrences(data.events || [], data.overrides || [], startDate, endDate)
    .filter(item => visibleIds.has(item.calendar_id))
  return { calendars, localItems }
}

const runReminders = async () => {
  try {
    await window.electronAPI.syncRemindersWithMac()
  } catch (err) {
    console.warn('[MacAutoSync] reminders failed:', err?.message || err)
  }
}

const runCalendar = async () => {
  const { startDate, endDate } = calendarRange()
  const { calendars } = await loadCalendarBundle(startDate, endDate)
  if (!calendars.length) return
  try {
    await syncCalendarWithMac({
      startDate,
      endDate,
      calendars,
      loadLocalItems: async () => (await loadCalendarBundle(startDate, endDate)).localItems
    })
    await useCalendarStore().refresh()
  } catch (err) {
    console.warn('[MacAutoSync] calendar failed:', err?.message || err)
  }
}

const tick = async () => {
  if (running) return
  running = true
  try {
    await runReminders()
    await runCalendar()
  } finally {
    running = false
  }
}

export function startMacAutoSync() {
  if (intervalId) return
  firstRunId = window.setTimeout(tick, FIRST_RUN_MS)
  intervalId = window.setInterval(tick, INTERVAL_MS)
}

export function stopMacAutoSync() {
  if (firstRunId) {
    window.clearTimeout(firstRunId)
    firstRunId = null
  }
  if (intervalId) {
    window.clearInterval(intervalId)
    intervalId = null
  }
}
