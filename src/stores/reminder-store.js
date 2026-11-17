import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import {
  SMART_LISTS,
  buildReminderGroups,
  colorHex,
  dateKey,
  getSmartListCounts,
  searchReminders,
  smartListById
} from '@utils/reminders'

const SORT_KEY = 'bongmaster:reminders:sort'
const SHOW_COMPLETED_KEY = 'bongmaster:reminders:show-completed'
const GROUP_BY_TIME_KEY = 'bongmaster:reminders:group-by-time'
const LAST_LIST_KEY = 'bongmaster:reminders:last-list'

const readSetting = (key, fallback) => {
  try {
    const value = localStorage.getItem(key)
    return value === null ? fallback : value
  } catch {
    return fallback
  }
}

const writeSetting = (key, value) => {
  try {
    localStorage.setItem(key, String(value))
  } catch {}
}

function normalizeReminder(reminder) {
  if (!reminder) return reminder
  return {
    ...reminder,
    is_completed: !!reminder.is_completed,
    is_flagged: !!reminder.is_flagged,
    repeat_from_completion: !!reminder.repeat_from_completion,
    sort_order: Number(reminder.sort_order) || 0,
    priority: reminder.priority || '无',
    tags: reminder.tags || '',
    notes: reminder.notes || '',
    url: reminder.url || '',
    date: reminder.date || '',
    due_time: reminder.due_time || null,
    remind_time: reminder.remind_time || null,
    recurrence_type: reminder.recurrence_type || 'none',
    recurrence_value: reminder.recurrence_value || '',
    recurrence_end_date: reminder.recurrence_end_date || null
  }
}

function normalizeSubtask(subtask) {
  if (!subtask) return subtask
  return {
    ...subtask,
    is_completed: !!subtask.is_completed,
    is_pinned: !!subtask.is_pinned,
    sort_order: Number(subtask.sort_order) || 0
  }
}

export const useReminderStore = defineStore('reminders', () => {
  const lists = ref([])
  const sections = ref([])
  const reminders = ref([])
  const recentlyDeleted = ref([])
  const taskSubtasks = ref({})
  const attachments = ref({})
  const selectedView = ref({ type: 'smart', id: 'today' })
  const selectedReminderId = ref(null)
  const selectedIds = ref([])
  const searchQuery = ref('')
  const tagFilter = ref('')
  const loading = ref(false)
  const error = ref(null)
  const stats = ref(null)

  const sortMode = ref(readSetting(SORT_KEY, 'manual'))
  const showCompleted = ref(readSetting(SHOW_COMPLETED_KEY, '0') === '1')
  const groupByTime = ref(readSetting(GROUP_BY_TIME_KEY, '1') !== '0')
  const subtasksExpanded = ref(false)
  const lastListId = ref(Number(readSetting(LAST_LIST_KEY, 0)) || null)

  watch(sortMode, value => writeSetting(SORT_KEY, value))
  watch(showCompleted, value => writeSetting(SHOW_COMPLETED_KEY, value ? '1' : '0'))
  watch(groupByTime, value => writeSetting(GROUP_BY_TIME_KEY, value ? '1' : '0'))

  const todayKey = ref(dateKey())

  const refreshToday = () => {
    const next = dateKey()
    if (next !== todayKey.value) todayKey.value = next
  }

  const today = computed(() => todayKey.value)

  if (typeof window !== 'undefined') {
    window.setInterval(refreshToday, 30 * 1000)
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) refreshToday()
      })
    }
  }

  const selectedList = computed(() => (
    selectedView.value.type === 'list'
      ? lists.value.find(list => list.id === selectedView.value.id) || null
      : null
  ))

  const selectedSmartList = computed(() => (
    selectedView.value.type === 'smart' ? smartListById(selectedView.value.id) : null
  ))

  const viewTitle = computed(() => {
    if (searchQuery.value.trim()) return '搜索'
    if (selectedView.value.type === 'recentlyDeleted') return '最近删除'
    if (selectedView.value.type === 'list') return selectedList.value?.name || '提醒事项'
    return selectedSmartList.value?.name || '提醒事项'
  })

  const viewColor = computed(() => {
    if (selectedView.value.type === 'recentlyDeleted') return '#8e8e93'
    if (selectedView.value.type === 'list') return colorHex(selectedList.value?.color)
    return selectedSmartList.value?.titleColor || '#1d1d1f'
  })

  const counts = computed(() => getSmartListCounts(reminders.value, today.value))

  const listCounts = computed(() => {
    const map = {}
    for (const reminder of reminders.value) {
      if (reminder.is_completed || !reminder.list_id) continue
      map[reminder.list_id] = (map[reminder.list_id] || 0) + 1
    }
    return map
  })

  const reminderTags = reminder => (
    String(reminder?.tags || '')
      .split(/[,，]/)
      .map(tag => tag.trim())
      .filter(Boolean)
  )

  const matchesTag = reminder => (
    !tagFilter.value || reminderTags(reminder).includes(tagFilter.value)
  )

  const allTags = computed(() => {
    const counts = new Map()
    for (const reminder of reminders.value) {
      for (const tag of reminderTags(reminder)) {
        counts.set(tag, (counts.get(tag) || 0) + 1)
      }
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'))
  })

  const setTagFilter = tag => {
    const next = String(tag || '').trim()
    tagFilter.value = tagFilter.value === next ? '' : next
    selectedReminderId.value = null
    selectedIds.value = []
  }

  watch(allTags, tags => {
    if (tagFilter.value && !tags.some(tag => tag.name === tagFilter.value)) {
      tagFilter.value = ''
    }
  })

  const searchResults = computed(() => {
    const result = searchQuery.value.trim() ? searchReminders(reminders.value, searchQuery.value) : []
    return tagFilter.value ? result.filter(matchesTag) : result
  })

  const currentReminders = computed(() => {
    if (selectedView.value.type === 'recentlyDeleted') return recentlyDeleted.value
    return reminders.value.filter(matchesTag)
  })

  const groups = computed(() => {
    if (searchQuery.value.trim()) {
      return [{
        key: 'search',
        kind: 'plain',
        title: '',
        metaMode: 'list-date',
        items: searchResults.value
      }]
    }
    if (selectedView.value.type === 'recentlyDeleted') {
      return buildReminderGroups({
        view: selectedView.value,
        reminders: recentlyDeleted.value,
        lists: lists.value,
        sections: sections.value,
        today: today.value,
        showCompleted: showCompleted.value,
        sortMode: sortMode.value
      })
    }
    let visible = reminders.value
    if (selectedView.value.type === 'list') {
      visible = visible.filter(reminder => reminder.list_id === selectedView.value.id)
    }
    if (tagFilter.value) visible = visible.filter(matchesTag)
    return buildReminderGroups({
      view: selectedView.value,
      reminders: visible,
      lists: lists.value,
      sections: sections.value,
      today: today.value,
      showCompleted: showCompleted.value,
      sortMode: sortMode.value
    })
  })

  const completedCount = computed(() => {
    if (searchQuery.value.trim()) {
      return searchResults.value.filter(reminder => reminder.is_completed).length
    }
    if (selectedView.value.type === 'list') {
      return reminders.value.filter(reminder => (
        reminder.list_id === selectedView.value.id && reminder.is_completed && matchesTag(reminder)
      )).length
    }
    switch (selectedView.value.id) {
      case 'today':
        return reminders.value.filter(reminder => reminder.is_completed && reminder.date === today.value && matchesTag(reminder)).length
      case 'scheduled':
        return reminders.value.filter(reminder => reminder.is_completed && reminder.date && matchesTag(reminder)).length
      case 'flagged':
        return reminders.value.filter(reminder => reminder.is_completed && reminder.is_flagged && matchesTag(reminder)).length
      case 'urgent':
        return reminders.value.filter(reminder => reminder.is_completed && reminder.priority === '高' && matchesTag(reminder)).length
      case 'completed':
        return tagFilter.value
          ? reminders.value.filter(reminder => reminder.is_completed && matchesTag(reminder)).length
          : counts.value.completed
      default:
        return reminders.value.filter(reminder => reminder.is_completed && matchesTag(reminder)).length
    }
  })

  const headerCount = computed(() => {
    if (searchQuery.value.trim()) return searchResults.value.length
    if (selectedView.value.type === 'recentlyDeleted') return recentlyDeleted.value.length
    if (selectedView.value.type === 'list') {
      return reminders.value.filter(reminder => (
        reminder.list_id === selectedView.value.id && !reminder.is_completed && matchesTag(reminder)
      )).length
    }
    if (selectedView.value.id === 'completed') return completedCount.value
    return counts.value[selectedView.value.id] ?? 0
  })

  const currentListSections = computed(() => {
    const listId = selectedView.value.type === 'list'
      ? selectedView.value.id
      : (reminders.value.find(reminder => reminder.id === selectedReminderId.value)?.list_id || null)
    return listId ? sections.value.filter(section => section.list_id === listId) : []
  })

  const defaultListId = computed(() => {
    if (selectedView.value.type === 'list') return selectedView.value.id
    if (lastListId.value && lists.value.some(list => list.id === lastListId.value)) return lastListId.value
    return lists.value[0]?.id || null
  })

  const findReminder = id => reminders.value.find(reminder => reminder.id === id) || null

  const replaceReminder = row => {
    if (!row) return
    const index = reminders.value.findIndex(reminder => reminder.id === row.id)
    if (index >= 0) reminders.value[index] = normalizeReminder(row)
    else reminders.value.push(normalizeReminder(row))
  }

  const loadSubtasks = async () => {
    const ids = reminders.value.map(reminder => reminder.id).filter(Boolean)
    if (!ids.length) {
      taskSubtasks.value = {}
      return
    }
    try {
      const raw = await window.electronAPI.getDailySubtasksByTaskIds(JSON.parse(JSON.stringify(ids)))
      const map = {}
      ids.forEach(id => { map[id] = [] })
      for (const subtask of raw || []) {
        if (!map[subtask.daily_task_id]) map[subtask.daily_task_id] = []
        map[subtask.daily_task_id].push(normalizeSubtask(subtask))
      }
      taskSubtasks.value = map
    } catch (err) {
      console.error('[ReminderStore] loadSubtasks error:', err)
    }
  }

  const fetchAll = async ({ silent = false } = {}) => {
    refreshToday()
    if (!silent) loading.value = true
    error.value = null
    try {
      const [rawLists, rawReminders, rawSections] = await Promise.all([
        window.electronAPI.getReminderLists(),
        window.electronAPI.getReminders(),
        window.electronAPI.getReminderSections()
      ])
      lists.value = Array.isArray(rawLists) ? rawLists : []
      reminders.value = Array.isArray(rawReminders) ? rawReminders.map(normalizeReminder) : []
      sections.value = Array.isArray(rawSections) ? rawSections : []
      await loadSubtasks()
      if (selectedView.value.type === 'recentlyDeleted') await fetchRecentlyDeleted()
    } catch (err) {
      error.value = err.message
      console.error('[ReminderStore] fetchAll error:', err)
    } finally {
      loading.value = false
    }
  }

  const fetchRecentlyDeleted = async () => {
    try {
      const raw = await window.electronAPI.getRecentlyDeletedReminders(300)
      recentlyDeleted.value = Array.isArray(raw) ? raw.map(normalizeReminder) : []
    } catch (err) {
      console.error('[ReminderStore] fetchRecentlyDeleted error:', err)
      recentlyDeleted.value = []
    }
  }

  const selectView = view => {
    selectedView.value = view
    selectedReminderId.value = null
    selectedIds.value = []
    searchQuery.value = ''
    if (view.type === 'list') {
      lastListId.value = view.id
      writeSetting(LAST_LIST_KEY, view.id)
    }
    if (view.type === 'recentlyDeleted') fetchRecentlyDeleted()
  }

  const setSearch = value => {
    searchQuery.value = value
    selectedReminderId.value = null
    selectedIds.value = []
  }

  const selectReminder = id => {
    selectedReminderId.value = id
    selectedIds.value = id ? [id] : []
  }

  const toggleSelection = (id, additive = false) => {
    if (!additive) {
      selectedIds.value = [id]
      selectedReminderId.value = id
      return
    }
    const index = selectedIds.value.indexOf(id)
    if (index >= 0) selectedIds.value.splice(index, 1)
    else selectedIds.value.push(id)
    selectedReminderId.value = selectedIds.value.includes(id) ? id : selectedIds.value[0] || null
  }

  const setSelectedIds = ids => {
    selectedIds.value = [...ids]
    selectedReminderId.value = ids[0] || null
  }

  const createReminder = async data => {
    try {
      const created = await window.electronAPI.createReminder(JSON.parse(JSON.stringify(data)))
      if (created) {
        replaceReminder(created)
        if (created.list_id) {
          lastListId.value = created.list_id
          writeSetting(LAST_LIST_KEY, created.list_id)
        }
      }
      return created ? normalizeReminder(created) : null
    } catch (err) {
      error.value = err.message
      console.error('[ReminderStore] createReminder error:', err)
      return null
    }
  }

  const updateReminder = async (id, patch) => {
    const index = reminders.value.findIndex(reminder => reminder.id === id)
    const previous = index >= 0 ? { ...reminders.value[index] } : null
    if (index >= 0) reminders.value[index] = { ...reminders.value[index], ...patch }
    try {
      const updated = await window.electronAPI.updateReminder(id, JSON.parse(JSON.stringify(patch)))
      if (updated) replaceReminder(updated)
      return updated ? normalizeReminder(updated) : null
    } catch (err) {
      error.value = err.message
      if (previous && index >= 0) reminders.value[index] = previous
      console.error('[ReminderStore] updateReminder error:', err)
      return null
    }
  }

  const toggleComplete = async (id, isCompleted) => {
    try {
      const result = await window.electronAPI.toggleReminderComplete(id, !!isCompleted)
      if (result?.reminder) replaceReminder(result.reminder)
      if (result?.next) replaceReminder(result.next)
      if (isCompleted) {
        import('../balatro/integration.js')
          .then(module => module.notifyDailyTaskCompleted({ taskId: id }))
          .catch(() => {})
      }
      return result
    } catch (err) {
      error.value = err.message
      console.error('[ReminderStore] toggleComplete error:', err)
      return null
    }
  }

  const deleteReminder = async id => {
    const reminder = findReminder(id)
    try {
      await window.electronAPI.deleteReminder(id)
      reminders.value = reminders.value.filter(item => item.id !== id)
      if (selectedReminderId.value === id) selectedReminderId.value = null
      selectedIds.value = selectedIds.value.filter(item => item !== id)
      await fetchRecentlyDeleted()
      return reminder
    } catch (err) {
      error.value = err.message
      console.error('[ReminderStore] deleteReminder error:', err)
      return null
    }
  }

  const restoreReminders = async ids => {
    try {
      await window.electronAPI.restoreReminders(JSON.parse(JSON.stringify(ids)))
      await fetchAll()
      await fetchRecentlyDeleted()
      return true
    } catch (err) {
      error.value = err.message
      console.error('[ReminderStore] restoreReminders error:', err)
      return false
    }
  }

  const purgeReminder = async id => {
    try {
      await window.electronAPI.purgeReminder(id)
      recentlyDeleted.value = recentlyDeleted.value.filter(item => item.id !== id)
      return true
    } catch (err) {
      error.value = err.message
      console.error('[ReminderStore] purgeReminder error:', err)
      return false
    }
  }

  const duplicateReminder = async id => {
    try {
      const created = await window.electronAPI.duplicateReminder(id)
      if (created) replaceReminder(created)
      return created ? normalizeReminder(created) : null
    } catch (err) {
      error.value = err.message
      console.error('[ReminderStore] duplicateReminder error:', err)
      return null
    }
  }

  const reorderReminders = async (orderedIds, sectionId = undefined) => {
    try {
      await window.electronAPI.reorderReminders(
        JSON.parse(JSON.stringify(orderedIds)),
        sectionId === undefined ? undefined : sectionId
      )
      return true
    } catch (err) {
      error.value = err.message
      console.error('[ReminderStore] reorderReminders error:', err)
      await fetchAll({ silent: true })
      return false
    }
  }

  const moveToList = async (ids, listId, sectionId = null) => {
    try {
      await window.electronAPI.moveRemindersToList(JSON.parse(JSON.stringify(ids)), listId, sectionId)
      await fetchAll({ silent: true })
      return true
    } catch (err) {
      error.value = err.message
      console.error('[ReminderStore] moveToList error:', err)
      return false
    }
  }

  const clearCompleted = async (listId, completedBefore = null) => {
    try {
      const result = await window.electronAPI.clearCompletedReminders(listId || null, completedBefore || null)
      const ids = result?.ids || []
      if (ids.length) {
        const removed = new Set(ids)
        reminders.value = reminders.value.filter(reminder => !removed.has(reminder.id))
        await fetchRecentlyDeleted()
      }
      return ids
    } catch (err) {
      error.value = err.message
      console.error('[ReminderStore] clearCompleted error:', err)
      return []
    }
  }

  const createList = async data => {
    try {
      const created = await window.electronAPI.createReminderList(data)
      if (created) lists.value.push(created)
      return created
    } catch (err) {
      error.value = err.message
      console.error('[ReminderStore] createList error:', err)
      return null
    }
  }

  const updateList = async (id, data) => {
    try {
      const updated = await window.electronAPI.updateReminderList(id, data)
      if (updated) {
        const index = lists.value.findIndex(list => list.id === id)
        if (index >= 0) lists.value[index] = { ...lists.value[index], ...updated }
      }
      return updated
    } catch (err) {
      error.value = err.message
      console.error('[ReminderStore] updateList error:', err)
      return null
    }
  }

  const deleteList = async id => {
    try {
      await window.electronAPI.deleteReminderList(id)
      await fetchAll({ silent: true })
      if (selectedView.value.type === 'list' && selectedView.value.id === id) {
        selectView({ type: 'smart', id: 'today' })
      }
      return true
    } catch (err) {
      error.value = err.message
      console.error('[ReminderStore] deleteList error:', err)
      return false
    }
  }

  const reorderLists = async orderedIds => {
    const previous = [...lists.value]
    const map = new Map(lists.value.map(list => [list.id, list]))
    const reordered = orderedIds.map(id => map.get(id)).filter(Boolean)
    for (const list of lists.value) if (!orderedIds.includes(list.id)) reordered.push(list)
    lists.value = reordered
    try {
      await window.electronAPI.reorderReminderLists(JSON.parse(JSON.stringify(orderedIds)))
      return true
    } catch (err) {
      lists.value = previous
      error.value = err.message
      console.error('[ReminderStore] reorderLists error:', err)
      return false
    }
  }

  const createSection = async (listId, data) => {
    try {
      const created = await window.electronAPI.createReminderSection(listId, data)
      if (created) sections.value.push(created)
      return created
    } catch (err) {
      error.value = err.message
      console.error('[ReminderStore] createSection error:', err)
      return null
    }
  }

  const updateSection = async (id, data) => {
    try {
      const updated = await window.electronAPI.updateReminderSection(id, data)
      if (updated) {
        const index = sections.value.findIndex(section => section.id === id)
        if (index >= 0) sections.value[index] = { ...sections.value[index], ...updated }
      }
      return updated
    } catch (err) {
      error.value = err.message
      console.error('[ReminderStore] updateSection error:', err)
      return null
    }
  }

  const deleteSection = async id => {
    const section = sections.value.find(item => item.id === id) || null
    try {
      const result = await window.electronAPI.deleteReminderSection(id)
      sections.value = sections.value.filter(item => item.id !== id)
      reminders.value = reminders.value.map(reminder => (
        reminder.section_id === id ? { ...reminder, section_id: null } : reminder
      ))
      return { section, reminderIds: result?.reminderIds || [] }
    } catch (err) {
      error.value = err.message
      console.error('[ReminderStore] deleteSection error:', err)
      return null
    }
  }

  const restoreSection = async (section, reminderIds = []) => {
    if (!section?.id) return false
    try {
      await window.electronAPI.restoreReminderSection(
        section.id,
        JSON.parse(JSON.stringify(reminderIds))
      )
      await fetchAll()
      return true
    } catch (err) {
      error.value = err.message
      console.error('[ReminderStore] restoreSection error:', err)
      return false
    }
  }

  const fetchSubtasks = async taskId => {
    try {
      const raw = await window.electronAPI.getDailySubtasks(taskId)
      taskSubtasks.value = {
        ...taskSubtasks.value,
        [taskId]: (raw || []).map(normalizeSubtask)
      }
      return taskSubtasks.value[taskId]
    } catch (err) {
      console.error('[ReminderStore] fetchSubtasks error:', err)
      return []
    }
  }

  const createSubtask = async (taskId, data) => {
    try {
      const created = await window.electronAPI.createDailySubtask(taskId, data)
      if (created) await fetchSubtasks(taskId)
      return created
    } catch (err) {
      error.value = err.message
      console.error('[ReminderStore] createSubtask error:', err)
      return null
    }
  }

  const updateSubtask = async (id, taskId, data) => {
    try {
      const updated = await window.electronAPI.updateDailySubtask(id, data)
      await fetchSubtasks(taskId)
      return updated
    } catch (err) {
      error.value = err.message
      console.error('[ReminderStore] updateSubtask error:', err)
      return null
    }
  }

  const deleteSubtask = async (id, taskId) => {
    try {
      await window.electronAPI.deleteDailySubtask(id)
      await fetchSubtasks(taskId)
      return true
    } catch (err) {
      error.value = err.message
      console.error('[ReminderStore] deleteSubtask error:', err)
      return false
    }
  }

  const fetchAttachments = async reminderId => {
    try {
      const raw = await window.electronAPI.getReminderAttachments(reminderId)
      attachments.value = { ...attachments.value, [reminderId]: raw || [] }
      return attachments.value[reminderId]
    } catch (err) {
      console.error('[ReminderStore] fetchAttachments error:', err)
      return []
    }
  }

  const registerAttachment = (reminderId, created) => {
    attachments.value = {
      ...attachments.value,
      [reminderId]: [...(attachments.value[reminderId] || []), created]
    }
    const reminder = reminders.value.find(item => item.id === reminderId)
    if (reminder) reminder.attachment_count = (Number(reminder.attachment_count) || 0) + 1
    return created
  }

  const addAttachment = async reminderId => {
    try {
      const created = await window.electronAPI.addReminderAttachment(reminderId)
      if (created?.cancelled) return null
      return created ? registerAttachment(reminderId, created) : null
    } catch (err) {
      error.value = err.message
      console.error('[ReminderStore] addAttachment error:', err)
      return null
    }
  }

  const pickAttachment = async () => {
    try {
      return await window.electronAPI.pickReminderAttachment()
    } catch (err) {
      error.value = err.message
      console.error('[ReminderStore] pickAttachment error:', err)
      return null
    }
  }

  const addAttachmentFile = async (reminderId, file) => {
    try {
      const created = await window.electronAPI.addReminderAttachmentFile(reminderId, file)
      return created ? registerAttachment(reminderId, created) : null
    } catch (err) {
      error.value = err.message
      console.error('[ReminderStore] addAttachmentFile error:', err)
      return null
    }
  }

  const openAttachment = async id => {
    try {
      return await window.electronAPI.openReminderAttachment(id)
    } catch (err) {
      console.error('[ReminderStore] openAttachment error:', err)
      return { success: false, error: err.message }
    }
  }

  const deleteAttachment = async (id, reminderId) => {
    try {
      await window.electronAPI.deleteReminderAttachment(id)
      attachments.value = {
        ...attachments.value,
        [reminderId]: (attachments.value[reminderId] || []).filter(item => item.id !== id)
      }
      const reminder = reminders.value.find(item => item.id === reminderId)
      if (reminder) reminder.attachment_count = Math.max(0, (Number(reminder.attachment_count) || 0) - 1)
      return true
    } catch (err) {
      console.error('[ReminderStore] deleteAttachment error:', err)
      return false
    }
  }

  const fetchStats = async () => {
    refreshToday()
    try {
      stats.value = await window.electronAPI.getDailyTaskHistoryStats(today.value)
    } catch (err) {
      console.error('[ReminderStore] fetchStats error:', err)
      stats.value = null
    }
  }

  return {
    lists,
    sections,
    reminders,
    recentlyDeleted,
    taskSubtasks,
    attachments,
    selectedView,
    selectedReminderId,
    selectedIds,
    searchQuery,
    tagFilter,
    allTags,
    loading,
    error,
    stats,
    sortMode,
    showCompleted,
    groupByTime,
    subtasksExpanded,
    lastListId,
    today,
    selectedList,
    selectedSmartList,
    viewTitle,
    viewColor,
    counts,
    searchResults,
    currentReminders,
    groups,
    completedCount,
    headerCount,
    listCounts,
    currentListSections,
    defaultListId,
    SMART_LISTS,
    findReminder,
    fetchAll,
    fetchRecentlyDeleted,
    selectView,
    setSearch,
    setTagFilter,
    selectReminder,
    toggleSelection,
    setSelectedIds,
    createReminder,
    updateReminder,
    toggleComplete,
    deleteReminder,
    restoreReminders,
    purgeReminder,
    duplicateReminder,
    reorderReminders,
    moveToList,
    clearCompleted,
    createList,
    updateList,
    deleteList,
    reorderLists,
    createSection,
    updateSection,
    deleteSection,
    restoreSection,
    fetchSubtasks,
    createSubtask,
    updateSubtask,
    deleteSubtask,
    fetchAttachments,
    addAttachment,
    pickAttachment,
    addAttachmentFile,
    openAttachment,
    deleteAttachment,
    fetchStats
  }
})
