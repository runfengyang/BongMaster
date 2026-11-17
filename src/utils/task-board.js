import { format, parseISO, startOfWeek, endOfWeek, isWithinInterval } from 'date-fns'

export const PRIORITY_ORDER = { '高': 0, '中': 1, '低': 2 }

export const PRIORITY_BADGE_MAP = {
  '高': 'bm-badge-red',
  '中': 'bm-badge-amber',
  '低': 'bm-badge-blue'
}

export function getPriorityBadge(priority) {
  return PRIORITY_BADGE_MAP[priority] || 'bm-badge-blue'
}

export function getTodayString() {
  return format(new Date(), 'yyyy-MM-dd')
}

export function parseDate(dateStr) {
  if (!dateStr) return null
  try {
    return parseISO(dateStr)
  } catch {
    return null
  }
}

export function isOverdue(dueDate) {
  if (!dueDate) return false
  return dueDate < getTodayString()
}

export function isDueToday(dueDate) {
  if (!dueDate) return false
  return dueDate === getTodayString()
}

export function getDueStatus(dueDate) {
  if (!dueDate) return 'none'
  const today = getTodayString()
  if (dueDate < today) return 'overdue'
  if (dueDate === today) return 'today'
  const tomorrow = format(new Date(Date.now() + 86400000), 'yyyy-MM-dd')
  if (dueDate === tomorrow) return 'tomorrow'
  return 'future'
}

export function formatDueDate(dueDate) {
  if (!dueDate) return '无期限'
  const status = getDueStatus(dueDate)
  if (status === 'today') return '今天'
  if (status === 'tomorrow') return '明天'
  if (status === 'overdue') return `已过期 ${format(parseISO(dueDate), 'MM-dd')}`
  return format(parseISO(dueDate), 'MM-dd')
}

export function formatDateShort(dateStr) {
  if (!dateStr) return ''
  try {
    return format(parseISO(dateStr), 'MM-dd')
  } catch {
    return dateStr
  }
}

export function sortByDueDateAndPriority(a, b) {
  if (a.due_date !== b.due_date) {
    if (!a.due_date) return 1
    if (!b.due_date) return -1
    return new Date(a.due_date) - new Date(b.due_date)
  }
  return (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99)
}

export function filterActiveProjectTasks(tasks, activeProjectIds) {
  return tasks.filter(t => activeProjectIds.has(t.project_id))
}

export function getActiveProjectIds(projects) {
  return new Set(projects.filter(p => p.status === '进行中' || p.status === '未开始').map(p => p.id))
}

export function getDueSoonTasks(tasks, activeProjectIds, daysAhead = 3) {
  const today = new Date()
  const horizon = format(new Date(today.setDate(today.getDate() + daysAhead)), 'yyyy-MM-dd')

  return tasks
    .filter(t => {
      if (t.status === '已完成') return false
      if (!t.due_date) return false
      if (!activeProjectIds.has(t.project_id)) return false
      return t.due_date <= horizon
    })
    .sort(sortByDueDateAndPriority)
}

export function isThisWeek(dueDate) {
  if (!dueDate) return false
  const date = parseDate(dueDate)
  if (!date) return false
  const now = new Date()
  return isWithinInterval(date, {
    start: startOfWeek(now, { weekStartsOn: 1 }),
    end: endOfWeek(now, { weekStartsOn: 1 })
  })
}

const PROJECT_COLORS = [
  '#4f8ef7', '#8b5cf6', '#0f9d8a', '#e07b39',
  '#d9578a', '#6b8f3c', '#b07d2b', '#5a7d9a'
]

export function projectColor(project) {
  const key = String(project?.id ?? project?.project_id ?? project?.name ?? '')
  let hash = 0
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) % 9973
  return PROJECT_COLORS[hash % PROJECT_COLORS.length]
}

export function sortBoardTasks(tasks) {
  return [...tasks].sort(sortByDueDateAndPriority)
}

export function sortCompletedTasks(tasks) {
  return [...tasks].sort((a, b) => {
    const left = Date.parse(a.completed_at || a.updated_at || '')
    const right = Date.parse(b.completed_at || b.updated_at || '')
    return (Number.isNaN(right) ? 0 : right) - (Number.isNaN(left) ? 0 : left)
  })
}

export function splitTags(tags) {
  if (!tags) return []
  return String(tags).split(/[,，]/).map(tag => tag.trim()).filter(Boolean)
}

export function formatDueLabel(dueDate) {
  if (!dueDate) return ''
  const status = getDueStatus(dueDate)
  if (status === 'today') return '今天'
  if (status === 'tomorrow') return '明天'
  return format(parseISO(dueDate), 'MM-dd')
}
