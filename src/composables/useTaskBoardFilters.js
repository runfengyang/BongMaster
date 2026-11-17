import { reactive, computed } from 'vue'
import { isOverdue, isDueToday, isThisWeek, getActiveProjectIds, getTodayString } from '@utils/task-board.js'

export function useTaskBoardFilters() {
  const filters = reactive({
    search: '',
    projectIds: [],
    statuses: [],
    priorities: [],
    assignees: [],
    dueMode: 'all',
    dueBefore: '',
    includeCompleted: true,
    activeProjectsOnly: true
  })

  const setPreset = (patch) => {
    Object.assign(filters, patch)
  }

  const clearFilters = () => {
    filters.search = ''
    filters.projectIds = []
    filters.statuses = []
    filters.priorities = []
    filters.assignees = []
    filters.dueMode = 'all'
    filters.dueBefore = ''
    filters.includeCompleted = true
    filters.activeProjectsOnly = true
  }

  const activeFilterCount = computed(() => {
    let count = 0
    if (filters.search.trim()) count++
    if (filters.projectIds.length) count++
    if (filters.statuses.length) count++
    if (filters.priorities.length) count++
    if (filters.assignees.length) count++
    if (filters.dueMode !== 'all') count++
    if (filters.dueBefore) count++
    if (!filters.includeCompleted) count++
    if (!filters.activeProjectsOnly) count++
    return count
  })

  const isPresetActive = (patch) => {
    return Object.entries(patch).every(([key, value]) => {
      const current = filters[key]
      if (Array.isArray(value) && Array.isArray(current)) {
        return value.length === current.length && value.every(v => current.includes(v))
      }
      return current === value
    })
  }

  function filterTasks(tasks, projects = []) {
    let result = tasks

    if (filters.activeProjectsOnly) {
      const activeIds = getActiveProjectIds(projects)
      result = result.filter(t => activeIds.has(t.project_id))
    }

    if (!filters.includeCompleted) {
      result = result.filter(t => t.status !== '已完成')
    }

    if (filters.search.trim()) {
      const q = filters.search.trim().toLowerCase()
      result = result.filter(t =>
        (t.name && t.name.toLowerCase().includes(q)) ||
        (t.project_name && t.project_name.toLowerCase().includes(q))
      )
    }

    if (filters.projectIds.length) {
      result = result.filter(t => filters.projectIds.includes(t.project_id))
    }

    if (filters.statuses.length) {
      result = result.filter(t => filters.statuses.includes(t.status))
    }

    if (filters.priorities.length) {
      result = result.filter(t => filters.priorities.includes(t.priority))
    }

    if (filters.assignees.length) {
      result = result.filter(t => filters.assignees.includes(t.assignee))
    }

    const today = getTodayString()

    switch (filters.dueMode) {
      case 'overdue':
        result = result.filter(t => t.due_date && t.due_date < today)
        break
      case 'today':
        result = result.filter(t => t.due_date && t.due_date === today)
        break
      case 'today_or_overdue':
        result = result.filter(t => t.due_date && t.due_date <= today)
        break
      case 'this_week':
        result = result.filter(t => t.due_date && isThisWeek(t.due_date))
        break
      case 'no_date':
        result = result.filter(t => !t.due_date)
        break
      case 'before':
        if (filters.dueBefore) {
          result = result.filter(t => !t.due_date || t.due_date <= filters.dueBefore)
        }
        break
      case 'custom':
        break
    }

    return result
  }

  return {
    filters,
    setPreset,
    clearFilters,
    activeFilterCount,
    isPresetActive,
    filterTasks
  }
}
