import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { format, subDays, parseISO } from 'date-fns'

export const useAnalyticsStore = defineStore('analytics', () => {
  // State
  const completionTrend = ref([])
  const heatmapData = ref([])
  const averageCompletionTime = ref(0)
  const busiestDays = ref([])
  const loading = ref(false)
  const error = ref(null)

  // Getters
  const formattedAvgCompletionTime = computed(() => {
    const minutes = averageCompletionTime.value
    if (!minutes) return '暂无数据'
    const days = Math.round(minutes / (60 * 24) * 10) / 10
    return `${days} 天`
  })

  const totalCompletedTasks = computed(() => {
    return completionTrend.value.reduce((sum, day) => sum + day.count, 0)
  })

  // Actions
  const fetchCompletionTrend = async (days = 30) => {
    loading.value = true
    error.value = null
    try {
      const stats = await window.electronAPI.getTaskCompletionStats(days)

      // 填充没有数据的日期为0
      const result = []
      const today = new Date()
      for (let i = days - 1; i >= 0; i--) {
        const date = format(subDays(today, i), 'yyyy-MM-dd')
        const stat = stats.find(s => s.completed_date === date)
        result.push({
          date,
          count: stat ? stat.count : 0
        })
      }
      completionTrend.value = result
    } catch (err) {
      error.value = err.message
      console.error('[AnalyticsStore] fetchCompletionTrend error:', err)
    } finally {
      loading.value = false
    }
  }

  const fetchHeatmapData = async (days = 365) => {
    loading.value = true
    error.value = null
    try {
      // 热力图口径：项目任务 + 每日任务（完成趋势保持仅项目任务，两者的可选参数互不影响）
      const stats = await window.electronAPI.getTaskCompletionStats(days, { includeDailyTasks: true })
      heatmapData.value = stats.map(s => ({
        date: s.completed_date,
        count: s.count
      }))
    } catch (err) {
      error.value = err.message
      console.error('[AnalyticsStore] fetchHeatmapData error:', err)
    } finally {
      loading.value = false
    }
  }

  const fetchAverageCompletionTime = async (projectId = null) => {
    loading.value = true
    error.value = null
    try {
      const avg = await window.electronAPI.getAverageCompletionTime(projectId)
      averageCompletionTime.value = avg || 0
    } catch (err) {
      error.value = err.message
      console.error('[AnalyticsStore] fetchAverageCompletionTime error:', err)
    } finally {
      loading.value = false
    }
  }

  const fetchBusiestDays = async (days = 30) => {
    loading.value = true
    error.value = null
    try {
      const days_data = await window.electronAPI.getBusiestDays(days)
      busiestDays.value = days_data.map(d => ({
        date: d.completed_date,
        count: d.count,
        weekday: format(parseISO(d.completed_date), 'EEEE')
      }))
    } catch (err) {
      error.value = err.message
      console.error('[AnalyticsStore] fetchBusiestDays error:', err)
    } finally {
      loading.value = false
    }
  }

  const fetchAllStats = async () => {
    await Promise.all([
      fetchCompletionTrend(30),
      fetchHeatmapData(365),
      fetchAverageCompletionTime(),
      fetchBusiestDays(30)
    ])
  }

  return {
    completionTrend,
    heatmapData,
    averageCompletionTime,
    busiestDays,
    loading,
    error,
    formattedAvgCompletionTime,
    totalCompletedTasks,
    fetchCompletionTrend,
    fetchHeatmapData,
    fetchAverageCompletionTime,
    fetchBusiestDays,
    fetchAllStats
  }
})
