import {
  addDays,
  addMonths,
  addYears,
  differenceInCalendarDays,
  format,
  getISODay,
  isWeekend,
  isValid,
  parseISO
} from 'date-fns'

export const REMINDER_COLORS = [
  { key: 'red', label: '红色', hex: '#ff3b30' },
  { key: 'orange', label: '橙色', hex: '#ff9500' },
  { key: 'yellow', label: '黄色', hex: '#ffcc00' },
  { key: 'green', label: '绿色', hex: '#34c759' },
  { key: 'mint', label: '淡蓝色', hex: '#5ac8fa' },
  { key: 'blue', label: '蓝色', hex: '#007aff' },
  { key: 'indigo', label: '靛蓝色', hex: '#5856d6' },
  { key: 'pink', label: '粉红色', hex: '#ff2d55' },
  { key: 'purple', label: '紫色', hex: '#af52de' },
  { key: 'brown', label: '褐色', hex: '#a2845e' },
  { key: 'gray', label: '灰色', hex: '#8e8e93' },
  { key: 'rose', label: '玫红色', hex: '#e0397a' }
]

export const SMART_LISTS = [
  { id: 'today', name: '今天', icon: 'today', color: 'linear-gradient(160deg, #b9def4, #a1d0ed)', titleColor: '#007aff' },
  { id: 'scheduled', name: '计划', icon: 'calendar', color: 'linear-gradient(160deg, #f2c6c9, #eab4b8)', titleColor: '#ff3b30' },
  { id: 'all', name: '全部', icon: 'tray', color: 'linear-gradient(160deg, #ababab, #939393)', titleColor: '#1d1d1f' },
  { id: 'flagged', name: '旗标', icon: 'flag', color: 'linear-gradient(160deg, #f6dcc0, #eec8a6)', titleColor: '#ff9500' },
  { id: 'urgent', name: '紧急', icon: 'alarm', color: 'linear-gradient(160deg, #f4c2d1, #eba4b9)', titleColor: '#ff2d55' },
  { id: 'completed', name: '完成', icon: 'check', color: 'linear-gradient(160deg, #c9cdd0, #b5babd)', titleColor: '#8e8e93' }
]

export const PRIORITY_OPTIONS = [
  { value: '无', label: '无' },
  { value: '低', label: '低' },
  { value: '中', label: '中' },
  { value: '高', label: '高' }
]

export const PRIORITY_MARKS = {
  高: '!!!',
  中: '!!',
  低: '!',
  无: ''
}

export const RECURRENCE_OPTIONS = [
  { value: 'none', label: '永不' },
  { value: 'daily', label: '每天' },
  { value: 'weekdays', label: '工作日' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
  { value: 'yearly', label: '每年' },
  { value: 'custom', label: '自定义' }
]

export function dateKey(value = new Date()) {
  return format(value, 'yyyy-MM-dd')
}

export function colorHex(key) {
  if (typeof key === 'string' && key.startsWith('#')) return key
  return REMINDER_COLORS.find(color => color.key === key)?.hex || '#007aff'
}

export function smartListById(id) {
  return SMART_LISTS.find(list => list.id === id) || SMART_LISTS[0]
}

export function hasDueDate(reminder) {
  return Boolean(reminder?.date)
}

export function normalizeTags(tags) {
  if (!tags) return []
  return String(tags)
    .replace(/#/g, '')
    .split(/[,，]/)
    .map(tag => tag.trim())
    .filter(Boolean)
}

export function tagsToText(tags) {
  return Array.isArray(tags) ? tags.filter(Boolean).join(',') : String(tags || '')
}

export function formatFileSize(bytes) {
  const value = Number(bytes) || 0
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

export function weekdayLabel(date) {
  return `周${'日一二三四五六'[date.getDay()]}`
}

export function humanizeDate(value, today = dateKey()) {
  if (!value) return ''
  const date = parseISO(value)
  const base = parseISO(today)
  if (!isValid(date) || !isValid(base)) return value
  const diff = differenceInCalendarDays(date, base)
  if (diff === 0) return '今天'
  if (diff === 1) return '明天'
  if (diff === 2) return '后天'
  if (diff === -1) return '昨天'
  if (Math.abs(diff) <= 6) return `${date.getMonth() + 1}月${date.getDate()}日 ${weekdayLabel(date)}`
  if (date.getFullYear() === base.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日`
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
}

export function formatDueDate(reminder, today = dateKey()) {
  if (!reminder?.date) return ''
  const date = humanizeDate(reminder.date, today)
  return reminder.due_time ? `${date} ${reminder.due_time}` : date
}

export function formatDueDateCompact(reminder) {
  if (!reminder?.date) return ''
  const date = parseISO(reminder.date)
  if (!isValid(date)) return reminder.date
  const text = `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
  return reminder.due_time ? `${text} ${reminder.due_time}` : text
}

export function formatCompletedAt(value, today = dateKey()) {
  if (!value) return ''
  const date = typeof value === 'string' ? parseISO(value) : value
  if (!isValid(date)) return ''
  const key = format(date, 'yyyy-MM-dd')
  const base = parseISO(today)
  const diff = differenceInCalendarDays(date, base)
  if (diff === 0) return `今天 ${format(date, 'HH:mm')}`
  if (diff === -1) return `昨天 ${format(date, 'HH:mm')}`
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${format(date, 'HH:mm')}`
}

export function completionKey(reminder) {
  const raw = reminder?.completed_at || (reminder?.date ? `${reminder.date} 12:00:00` : '')
  if (!raw) return ''
  const date = parseISO(String(raw).replace(' ', 'T'))
  if (!isValid(date)) {
    const fallback = String(raw).slice(0, 10)
    return /^\d{4}-\d{2}-\d{2}$/.test(fallback) ? fallback : ''
  }
  return format(date, 'yyyy-MM-dd')
}

export function isOverdue(reminder, today = dateKey()) {
  return !reminder?.is_completed && hasDueDate(reminder) && reminder.date < today
}

export function isUrgent(reminder, today = dateKey()) {
  if (!reminder || reminder.is_completed) return false
  return isOverdue(reminder, today) || reminder.priority === '高'
}

export function getSmartListCounts(reminders, today = dateKey()) {
  const open = reminders.filter(reminder => !reminder.is_completed)
  return {
    today: open.filter(reminder => hasDueDate(reminder) && reminder.date <= today).length,
    scheduled: open.filter(hasDueDate).length,
    all: open.length,
    flagged: open.filter(reminder => reminder.is_flagged).length,
    urgent: open.filter(reminder => isUrgent(reminder, today)).length,
    completed: reminders.filter(reminder => reminder.is_completed).length
  }
}

export function sortReminders(reminders, mode = 'manual') {
  const list = [...reminders]
  const byOrder = (a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)
  const byCreated = (a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))
  const priorityRank = { 高: 0, 中: 1, 低: 2, 无: 3 }

  switch (mode) {
    case 'due':
      return list.sort((a, b) => {
        const aDate = a.date || '9999-12-31'
        const bDate = b.date || '9999-12-31'
        if (aDate !== bDate) return aDate < bDate ? -1 : 1
        const aTime = a.due_time || '00:00'
        const bTime = b.due_time || '00:00'
        if (aTime !== bTime) return aTime < bTime ? -1 : 1
        return byOrder(a, b)
      })
    case 'created':
      return list.sort((a, b) => byCreated(a, b) || byOrder(a, b))
    case 'priority':
      return list.sort((a, b) => {
        const rank = (priorityRank[a.priority] ?? 3) - (priorityRank[b.priority] ?? 3)
        if (rank !== 0) return rank
        return byOrder(a, b)
      })
    case 'title':
      return list.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'zh-Hans-CN'))
    default:
      return list.sort((a, b) => byOrder(a, b) || byCreated(a, b))
  }
}

function addRow(listId, sectionId = null, date = '') {
  return { listId, sectionId, date }
}

function todayGroups(reminders, today, sortMode, showCompleted) {
  const open = sortReminders(reminders.filter(reminder => !reminder.is_completed), sortMode)
  const overdue = open.filter(reminder => isOverdue(reminder, today))
  const todayItems = open.filter(reminder => reminder.date === today)
  const allDay = todayItems.filter(reminder => !reminder.due_time)
  const morning = todayItems.filter(reminder => reminder.due_time && reminder.due_time < '12:00')
  const afternoon = todayItems.filter(reminder => reminder.due_time >= '12:00' && reminder.due_time < '18:00')
  const evening = todayItems.filter(reminder => reminder.due_time && reminder.due_time >= '18:00')
  const currentHour = new Date().getHours()
  const currentGroup = currentHour < 12 ? 'morning' : currentHour < 18 ? 'afternoon' : 'evening'

  const groups = []
  if (overdue.length) {
    groups.push({
      key: 'overdue',
      kind: 'plain',
      title: '逾期',
      color: '#ff3b30',
      metaMode: 'list-date',
      items: overdue
    })
  }
  if (allDay.length) {
    groups.push({
      key: 'allday',
      kind: 'plain',
      title: '今天',
      metaMode: 'list-time',
      date: today,
      items: allDay
    })
  }
  groups.push({
    key: 'morning',
    kind: 'time',
    title: '上午',
    metaMode: 'list-time',
    date: today,
    items: morning,
    add: currentGroup === 'morning' ? addRow(null, null, today) : null
  })
  groups.push({
    key: 'afternoon',
    kind: 'time',
    title: '下午',
    metaMode: 'list-time',
    date: today,
    items: afternoon,
    add: currentGroup === 'afternoon' ? addRow(null, null, today) : null
  })
  groups.push({
    key: 'evening',
    kind: 'time',
    title: '今晚',
    metaMode: 'list-time',
    date: today,
    items: evening,
    add: currentGroup === 'evening' ? addRow(null, null, today) : null
  })

  if (showCompleted) {
    const completed = reminders.filter(reminder => reminder.is_completed && reminder.date === today)
    if (completed.length) {
      groups.push({
        key: 'completed-today',
        kind: 'completed',
        title: `${completed.length}项完成`,
        metaMode: 'completed',
        items: completed
      })
    }
  }
  return groups
}

function scheduledGroups(reminders, today, sortMode, showCompleted) {
  const groups = []
  const base = parseISO(today)
  const items = reminders.filter(reminder => hasDueDate(reminder) && (showCompleted || !reminder.is_completed))
  const sorted = sortReminders(items, sortMode === 'manual' ? 'due' : sortMode)

  const bucket = key => sorted.filter(reminder => reminder.date === key)
  const overdue = sorted.filter(reminder => (
    !reminder.is_completed && hasDueDate(reminder) && reminder.date < today
  ))
  if (overdue.length) {
    groups.push({
      key: 'overdue',
      kind: 'plain',
      title: '逾期',
      color: '#ff3b30',
      metaMode: 'list-date',
      items: overdue
    })
  }

  for (let offset = 0; offset < 7; offset += 1) {
    const key = format(addDays(base, offset), 'yyyy-MM-dd')
    const date = parseISO(key)
    const title = offset === 0 ? '今天' : offset === 1 ? '明天' : offset === 2 ? '后天' : `${date.getMonth() + 1}月${date.getDate()}日 ${weekdayLabel(date)}`
    groups.push({
      key: `day:${key}`,
      kind: 'date',
      title,
      date: key,
      metaMode: 'list-time',
      items: bucket(key),
      add: offset === 0 ? addRow(null, null, today) : null
    })
  }

  const monthStart = `${today.slice(0, 7)}-01`
  const afterWeek = format(addDays(base, 7), 'yyyy-MM-dd')
  const currentMonthEnd = format(new Date(base.getFullYear(), base.getMonth() + 1, 0), 'yyyy-MM-dd')
  const rest = sorted.filter(reminder => reminder.date >= afterWeek && reminder.date <= currentMonthEnd)
  groups.push({
    key: 'month:rest',
    kind: 'date',
    title: `${base.getMonth() + 1}月其他时间`,
    metaMode: 'list-time',
    items: rest
  })

  for (let offset = 1; offset <= 6; offset += 1) {
    const monthDate = addMonths(parseISO(monthStart), offset)
    const key = format(monthDate, 'yyyy-MM')
    const title = monthDate.getFullYear() === base.getFullYear()
      ? `${monthDate.getMonth() + 1}月`
      : `${monthDate.getFullYear()}年${monthDate.getMonth() + 1}月`
    groups.push({
      key: `month:${key}`,
      kind: 'date',
      title,
      metaMode: 'list-time',
      items: sorted.filter(reminder => reminder.date.startsWith(key))
    })
  }

  return groups
}

function allGroups(reminders, lists, today, sortMode, showCompleted) {
  const groups = []
  const known = new Set(lists.map(list => list.id))
  for (const list of lists) {
    const items = sortReminders(
      reminders.filter(reminder => reminder.list_id === list.id && (showCompleted || !reminder.is_completed)),
      sortMode
    )
    groups.push({
      key: `list:${list.id}`,
      kind: 'list',
      title: list.name,
      color: list.color,
      list,
      metaMode: 'date',
      items,
      add: addRow(list.id, null, today)
    })
  }
  const orphaned = reminders.filter(reminder => !known.has(reminder.list_id) && (showCompleted || !reminder.is_completed))
  if (orphaned.length) {
    groups.push({
      key: 'list:orphaned',
      kind: 'list',
      title: '未分类',
      color: 'gray',
      metaMode: 'date',
      items: sortReminders(orphaned, sortMode)
    })
  }
  return groups
}

function flaggedGroups(reminders, today, sortMode, showCompleted) {
  const items = sortReminders(
    reminders.filter(reminder => reminder.is_flagged && (showCompleted || !reminder.is_completed)),
    sortMode === 'manual' ? 'due' : sortMode
  )
  return [{
    key: 'flagged',
    kind: 'plain',
    title: '',
    metaMode: 'list-date',
    items
  }]
}

function urgentGroups(reminders, today, sortMode, showCompleted) {
  const open = sortReminders(reminders.filter(reminder => !reminder.is_completed), sortMode === 'manual' ? 'due' : sortMode)
  const overdue = open.filter(reminder => isOverdue(reminder, today))
  const overdueIds = new Set(overdue.map(reminder => reminder.id))
  const high = open.filter(reminder => reminder.priority === '高' && !overdueIds.has(reminder.id))
  if (!overdue.length && !high.length) return []
  const groups = []
  groups.push({
    key: 'urgent:overdue',
    kind: 'plain',
    title: '逾期',
    color: '#ff3b30',
    metaMode: 'list-date',
    items: overdue
  })
  groups.push({
    key: 'urgent:high',
    kind: 'plain',
    title: '高优先级',
    color: '#ff9500',
    metaMode: 'list-date',
    items: high
  })
  return groups
}

function completedGroups(reminders, today) {
  const items = reminders.filter(reminder => reminder.is_completed)
  const sorted = [...items].sort((a, b) => completionKey(b).localeCompare(completionKey(a)))
  const groups = []
  const yesterday = format(addDays(parseISO(today), -1), 'yyyy-MM-dd')
  const yesterdayItems = sorted.filter(reminder => completionKey(reminder) === yesterday)
  if (yesterdayItems.length) {
    groups.push({
      key: 'completed:yesterday',
      kind: 'completed',
      title: '昨天',
      metaMode: 'completed',
      items: yesterdayItems
    })
  }

  const byMonth = new Map()
  for (const reminder of sorted) {
    const key = completionKey(reminder)
    if (!key || key === yesterday) continue
    const month = key.slice(0, 7)
    if (!byMonth.has(month)) byMonth.set(month, new Map())
    const days = byMonth.get(month)
    if (!days.has(key)) days.set(key, [])
    days.get(key).push(reminder)
  }

  for (const [month, days] of byMonth) {
    const date = parseISO(`${month}-01`)
    const title = date.getFullYear() === parseISO(today).getFullYear()
      ? `${date.getMonth() + 1}月`
      : `${date.getFullYear()}年${date.getMonth() + 1}月`
    const subgroups = [...days.entries()].map(([key, dayItems]) => {
      const dayDate = parseISO(key)
      return {
        key,
        title: `${dayDate.getMonth() + 1}月${dayDate.getDate()}日 ${weekdayLabel(dayDate)}`,
        items: dayItems
      }
    })
    groups.push({
      key: `completed:${month}`,
      kind: 'month',
      title,
      metaMode: 'completed',
      items: sorted.filter(reminder => completionKey(reminder)?.startsWith(month)),
      subgroups
    })
  }

  const unknown = sorted.filter(reminder => !completionKey(reminder))
  if (unknown.length) {
    groups.push({
      key: 'completed:unknown',
      kind: 'completed',
      title: '更早',
      metaMode: 'completed',
      items: unknown
    })
  }

  return groups
}

function listGroups(list, sections, reminders, today, sortMode, showCompleted) {
  const listId = list.id
  const listSections = sections.filter(section => section.list_id === listId)
  const items = sortReminders(
    reminders.filter(reminder => reminder.list_id === listId && !reminder.is_completed),
    sortMode
  )
  const groups = []
  const ungrouped = items.filter(reminder => !reminder.section_id)
  if (!listSections.length) {
    groups.push({
      key: 'ungrouped',
      kind: 'plain',
      title: '',
      metaMode: 'date',
      items: ungrouped,
      add: addRow(listId, null, '')
    })
  } else {
    if (ungrouped.length) {
      groups.push({
        key: 'ungrouped',
        kind: 'plain',
        title: '',
        metaMode: 'date',
        items: ungrouped
      })
    }
    for (const section of listSections) {
      groups.push({
        key: `section:${section.id}`,
        kind: 'section',
        title: section.name,
        sectionId: section.id,
        collapsed: Boolean(section.is_collapsed),
        metaMode: 'date',
        items: items.filter(reminder => reminder.section_id === section.id),
        add: addRow(listId, section.id, '')
      })
    }
  }

  if (showCompleted) {
    const completed = sortReminders(
      reminders.filter(reminder => reminder.list_id === listId && reminder.is_completed),
      'due'
    )
    if (completed.length) {
      groups.push({
        key: 'completed',
        kind: 'completed',
        title: list.kind === 'shopping' ? `已购买 ${completed.length} 项` : `${completed.length}项完成`,
        metaMode: 'completed',
        items: completed
      })
    }
  }
  return groups
}

function deletedGroups(reminders) {
  return [{
    key: 'deleted',
    kind: 'deleted',
    title: '',
    metaMode: 'deleted',
    items: [...reminders].sort((a, b) => String(b.deleted_at || '').localeCompare(String(a.deleted_at || '')))
  }]
}

export function buildReminderGroups({
  view,
  reminders,
  lists = [],
  sections = [],
  today = dateKey(),
  showCompleted = false,
  sortMode = 'manual'
} = {}) {
  if (!view) return []
  if (view.type === 'recentlyDeleted') return deletedGroups(reminders)
  if (view.type === 'list') {
    const list = lists.find(item => item.id === view.id)
    if (!list) return []
    return listGroups(list, sections, reminders, today, sortMode, showCompleted)
  }
  switch (view.id) {
    case 'today':
      return todayGroups(reminders, today, sortMode, showCompleted)
    case 'scheduled':
      return scheduledGroups(reminders, today, sortMode, showCompleted)
    case 'all':
      return allGroups(reminders, lists, today, sortMode, showCompleted)
    case 'flagged':
      return flaggedGroups(reminders, today, sortMode, showCompleted)
    case 'urgent':
      return urgentGroups(reminders, today, sortMode, showCompleted)
    case 'completed':
      return completedGroups(reminders, today)
    default:
      return []
  }
}

export function searchReminders(reminders, query) {
  const text = String(query || '').trim().toLowerCase()
  if (!text) return []
  return reminders.filter(reminder => {
    const haystack = [
      reminder.title,
      reminder.notes,
      reminder.url,
      reminder.tags,
      reminder.list_name,
      reminder.project_name
    ].join(' ').toLowerCase()
    return haystack.includes(text)
  })
}

export function nextDueDate(reminder, completionDate = null, today = dateKey()) {
  const type = reminder?.recurrence_type || 'none'
  if (type === 'none') return null
  const baseKey = (reminder.repeat_from_completion && completionDate)
    ? completionDate
    : (reminder.date || completionDate || today)
  const base = parseISO(baseKey)
  if (!isValid(base)) return null

  let next = null
  switch (type) {
    case 'daily':
      next = addDays(base, 1)
      break
    case 'weekdays': {
      let candidate = addDays(base, 1)
      while (isWeekend(candidate)) candidate = addDays(candidate, 1)
      next = candidate
      break
    }
    case 'weekly': {
      const wanted = String(reminder.recurrence_value || '')
        .split(/[,，]/)
        .map(value => parseInt(value.trim(), 10))
        .filter(value => Number.isInteger(value) && value >= 1 && value <= 7)
      const targets = wanted.length ? wanted : [getISODay(base)]
      let candidate = addDays(base, 1)
      for (let index = 0; index < 14; index += 1) {
        if (targets.includes(getISODay(candidate))) {
          next = candidate
          break
        }
        candidate = addDays(candidate, 1)
      }
      break
    }
    case 'monthly':
      next = addMonths(base, 1)
      break
    case 'yearly':
      next = addYears(base, 1)
      break
    case 'custom': {
      const [rawCount, unit] = String(reminder.recurrence_value || '').split(':')
      const count = Math.max(1, parseInt(rawCount, 10) || 1)
      if (unit === 'weeks') next = addDays(base, 7 * count)
      else if (unit === 'months') next = addMonths(base, count)
      else if (unit === 'years') next = addYears(base, count)
      else next = addDays(base, count)
      break
    }
    default:
      return null
  }

  if (!next || !isValid(next)) return null
  const nextKey = format(next, 'yyyy-MM-dd')
  if (nextKey <= baseKey) return null
  if (reminder.recurrence_end_date && nextKey > reminder.recurrence_end_date) return null
  return nextKey
}

export function describeRecurrence(reminder) {
  if (!reminder || !reminder.recurrence_type || reminder.recurrence_type === 'none') return ''
  const value = String(reminder.recurrence_value || '')
  switch (reminder.recurrence_type) {
    case 'daily':
      return '每天'
    case 'weekdays':
      return '每个工作日'
    case 'weekly': {
      const days = value.split(/[,，]/).map(Number).filter(Boolean)
      if (!days.length) return '每周'
      const names = ['一', '二', '三', '四', '五', '六', '日']
      return `每周${days.map(day => names[day - 1]).filter(Boolean).join('、')}`
    }
    case 'monthly':
      return '每月'
    case 'yearly':
      return '每年'
    case 'custom': {
      const [rawCount, unit] = value.split(':')
      const count = parseInt(rawCount, 10) || 1
      const unitLabel = unit === 'weeks' ? '周' : unit === 'months' ? '个月' : unit === 'years' ? '年' : '天'
      return `每 ${count} ${unitLabel}`
    }
    default:
      return ''
  }
}
