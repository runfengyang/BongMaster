import { computed, reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import { addDays, endOfMonth, format, startOfMonth } from 'date-fns'
import {
  attendanceForRow,
  buildWorkSummary,
  buildWorkTrend,
  defaultWorkSettings,
  toStamp
} from '@utils/work-attendance.js'

export const useWorkAttendanceStore = defineStore('workAttendance', () => {
  const records = ref([])
  const monthRecords = ref([])
  const settings = reactive({ ...defaultWorkSettings })
  const monthDate = ref(format(new Date(), 'yyyy-MM-01'))
  const today = ref(format(new Date(), 'yyyy-MM-dd'))
  const loading = ref(false)
  const error = ref('')

  const loadDashboard = async () => {
    loading.value = true
    error.value = ''
    try {
      today.value = format(new Date(), 'yyyy-MM-dd')
      const monthStart = startOfMonth(new Date())
      const monthEnd = endOfMonth(new Date())
      const trendStart = addDays(new Date(), -371)
      const start = format(monthStart < trendStart ? monthStart : trendStart, 'yyyy-MM-dd')
      const end = format(monthEnd, 'yyyy-MM-dd')
      const [rows, settingsRow] = await Promise.all([
        window.electronAPI.getWorkAttendanceRange(start, end),
        window.electronAPI.getWorkAttendanceSettings()
      ])
      records.value = rows || []
      if (settingsRow) Object.assign(settings, settingsRow)
    } catch (err) {
      error.value = err.message || '打卡数据读取失败'
    } finally {
      loading.value = false
    }
  }

  const loadMonth = async value => {
    const target = value || monthDate.value
    monthDate.value = target
    loading.value = true
    error.value = ''
    try {
      const start = format(startOfMonth(new Date(`${target.slice(0, 7)}-01T12:00:00`)), 'yyyy-MM-dd')
      const end = format(endOfMonth(new Date(`${target.slice(0, 7)}-01T12:00:00`)), 'yyyy-MM-dd')
      monthRecords.value = await window.electronAPI.getWorkAttendanceRange(start, end)
    } catch (err) {
      error.value = err.message || '打卡记录读取失败'
      monthRecords.value = []
    } finally {
      loading.value = false
    }
  }

  const todayRecord = computed(() => records.value.find(row => row.work_date === today.value) || null)
  const openRecord = computed(() => records.value
    .filter(row => row.check_in_at && !row.check_out_at)
    .sort((a, b) => b.work_date.localeCompare(a.work_date))[0] || null)
  const activeRecord = computed(() => todayRecord.value || openRecord.value)
  const todayAttendance = computed(() => attendanceForRow(todayRecord.value, settings))
  const activeAttendance = computed(() => attendanceForRow(activeRecord.value, settings))
  const trend = computed(() => buildWorkTrend(records.value, settings, today.value, 30))
  const summary = computed(() => buildWorkSummary(records.value, settings, today.value))
  const monthSummary = computed(() => buildWorkSummary(monthRecords.value, settings, monthDate.value))

  const refreshAll = async () => {
    await loadDashboard()
    if (monthDate.value) await loadMonth(monthDate.value)
  }

  const checkIn = async () => {
    error.value = ''
    try {
      const at = toStamp(new Date())
      const result = await window.electronAPI.checkInWork(at.slice(0, 10), at)
      await refreshAll()
      return result
    } catch (err) {
      error.value = err.message || '上班打卡失败'
      return null
    }
  }

  const checkOut = async () => {
    error.value = ''
    try {
      const at = toStamp(new Date())
      const target = openRecord.value || todayRecord.value
      if (!target) throw new Error('请先上班打卡')
      const result = await window.electronAPI.checkOutWork(target.work_date, at)
      await refreshAll()
      return result
    } catch (err) {
      error.value = err.message || '下班打卡失败'
      return null
    }
  }

  const pause = async () => {
    error.value = ''
    try {
      const target = activeRecord.value
      if (!target?.check_in_at) throw new Error('请先上班打卡')
      if (target.check_out_at) throw new Error('已下班，无法暂停')
      const result = await window.electronAPI.pauseWork(target.work_date, toStamp(new Date()))
      await refreshAll()
      return result
    } catch (err) {
      error.value = err.message || '暂停失败'
      return null
    }
  }

  const resume = async () => {
    error.value = ''
    try {
      const target = activeRecord.value
      if (!target?.check_in_at) throw new Error('请先上班打卡')
      const result = await window.electronAPI.resumeWork(target.work_date, toStamp(new Date()))
      await refreshAll()
      return result
    } catch (err) {
      error.value = err.message || '恢复失败'
      return null
    }
  }

  const saveRecord = async data => {
    error.value = ''
    try {
      const result = await window.electronAPI.saveWorkAttendance(data)
      await refreshAll()
      return result
    } catch (err) {
      error.value = err.message || '保存打卡记录失败'
      return null
    }
  }

  const deleteRecord = async id => {
    error.value = ''
    try {
      const result = await window.electronAPI.deleteWorkAttendance(id)
      await refreshAll()
      return result
    } catch (err) {
      error.value = err.message || '删除打卡记录失败'
      return false
    }
  }

  const saveSettings = async data => {
    error.value = ''
    try {
      const result = await window.electronAPI.saveWorkAttendanceSettings(data)
      if (result) Object.assign(settings, result)
      return result
    } catch (err) {
      error.value = err.message || '保存打卡设置失败'
      return null
    }
  }

  return {
    records,
    monthRecords,
    settings,
    monthDate,
    today,
    loading,
    error,
    todayRecord,
    openRecord,
    activeRecord,
    todayAttendance,
    activeAttendance,
    trend,
    summary,
    monthSummary,
    loadDashboard,
    loadMonth,
    refreshAll,
    checkIn,
    checkOut,
    pause,
    resume,
    saveRecord,
    deleteRecord,
    saveSettings
  }
})
