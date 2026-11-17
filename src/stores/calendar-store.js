import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { format } from 'date-fns'

const STORAGE_KEY = 'bongmaster-calendar-pro-state'
const today = () => format(new Date(), 'yyyy-MM-dd')
const serialize = data => JSON.parse(JSON.stringify(data))

export const useCalendarStore = defineStore('calendar', () => {
  const calendars = ref([])
  const events = ref([])
  const overrides = ref([])
  const monthDate = ref(`${today().slice(0, 7)}-01`)
  const selectedDate = ref(today())
  const agendaMode = ref('day')
  const loading = ref(false)
  const error = ref(null)
  let currentRange = null
  let requestId = 0

  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (saved) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(saved.monthDate || '')) monthDate.value = saved.monthDate
      if (/^\d{4}-\d{2}-\d{2}$/.test(saved.selectedDate || '')) selectedDate.value = saved.selectedDate
      if (['day', 'overview'].includes(saved.agendaMode)) agendaMode.value = saved.agendaMode
    }
  } catch {}

  watch([monthDate, selectedDate, agendaMode], () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        monthDate: monthDate.value,
        selectedDate: selectedDate.value,
        agendaMode: agendaMode.value
      }))
    } catch {}
  })

  const fetchRange = async (startDate, endDate) => {
    const request = ++requestId
    currentRange = { startDate, endDate }
    loading.value = true
    error.value = null
    try {
      const data = await window.electronAPI.getCalendarData(startDate, endDate)
      if (request !== requestId) return data
      calendars.value = data.calendars || []
      events.value = data.events || []
      overrides.value = data.overrides || []
      return data
    } catch (err) {
      if (request === requestId) error.value = err.message
      console.error('[CalendarStore] fetchRange error:', err)
      return null
    } finally {
      if (request === requestId) loading.value = false
    }
  }

  const refresh = () => currentRange
    ? fetchRange(currentRange.startDate, currentRange.endDate)
    : Promise.resolve(null)

  const saveEvent = async (payload, options = {}) => {
    try {
      error.value = null
      const result = payload.id
        ? await window.electronAPI.updateCalendarEvent(payload.id, serialize(payload), serialize(options))
        : await window.electronAPI.createCalendarEvent(serialize(payload))
      await refresh()
      return result
    } catch (err) {
      error.value = err.message
      alert(`保存日程失败: ${err.message}`)
      return null
    }
  }

  const removeEvent = async (id, options = {}) => {
    try {
      const snapshot = await window.electronAPI.deleteCalendarEvent(id, serialize(options))
      await refresh()
      return snapshot
    } catch (err) {
      error.value = err.message
      alert(`删除日程失败: ${err.message}`)
      return null
    }
  }

  const restoreEvents = async snapshot => {
    try {
      const restored = await window.electronAPI.restoreCalendarEvents(serialize(snapshot))
      await refresh()
      return restored
    } catch (err) {
      error.value = err.message
      alert(`恢复日程失败: ${err.message}`)
      return false
    }
  }

  const saveCalendar = async payload => {
    try {
      const result = payload.id
        ? await window.electronAPI.updateCalendar(payload.id, serialize(payload))
        : await window.electronAPI.createCalendar(serialize(payload))
      await refresh()
      return result
    } catch (err) {
      error.value = err.message
      alert(`保存日历分类失败: ${err.message}`)
      return null
    }
  }

  const removeCalendar = async id => {
    try {
      error.value = null
      const result = await window.electronAPI.deleteCalendar(id)
      await refresh()
      return result
    } catch (err) {
      error.value = err.message
      alert(`删除日历分类失败: ${err.message}`)
      return false
    }
  }

  const setMonthDate = value => { monthDate.value = value }
  const selectDate = value => { selectedDate.value = value }
  const setAgendaMode = value => { if (['day', 'overview'].includes(value)) agendaMode.value = value }

  return {
    calendars,
    events,
    overrides,
    monthDate,
    selectedDate,
    agendaMode,
    loading,
    error,
    fetchRange,
    refresh,
    saveEvent,
    removeEvent,
    restoreEvents,
    saveCalendar,
    removeCalendar,
    setMonthDate,
    selectDate,
    setAgendaMode
  }
})
