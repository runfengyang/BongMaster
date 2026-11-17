<template>
  <div class="fade-in bm-page reminders-page">
    <div class="rm-shell" :class="{ 'sidebar-hidden': !sidebarVisible }">
      <div class="rm-toolbar">
        <div class="rm-page-title">
          <h1 class="bm-tab-title">提醒事项</h1>
          <span class="rm-page-subtitle">{{ store.counts.all }} 项未完成 · {{ store.lists.length }} 个列表</span>
        </div>
        <div class="rm-page-actions">
          <button
            type="button"
            class="bm-btn bm-btn-ghost bm-btn-icon"
            :title="sidebarVisible ? '隐藏边栏' : '显示边栏'"
            @click="toggleSidebar"
          >
            <ReminderIcon name="sidebar" :size="16" />
          </button>
          <button type="button" class="bm-btn bm-btn-ghost" title="添加列表" @click="openListEditor(null)">
            <ReminderIcon name="list-plus" :size="15" />
            列表
          </button>
          <button
            v-if="store.selectedView.type === 'list'"
            type="button"
            class="bm-btn bm-btn-ghost"
            title="添加分区"
            @click="paneRef?.addSection()"
          >
            <ReminderIcon name="list" :size="15" />
            分区
          </button>
          <button
            v-if="canAddReminder"
            type="button"
            class="bm-btn bm-btn-primary"
            title="添加提醒事项"
            @click="paneRef?.openAddForCurrent()"
          >
            新建提醒
          </button>
          <span v-if="syncing || store.loading" class="rm-page-status">同步中…</span>
          <span v-else-if="syncStatus" class="rm-page-status rm-sync-status" :title="syncStatus">{{ syncStatus }}</span>
          <label class="rm-search" :class="{ focused: searchFocused }">
            <ReminderIcon name="search" :size="14" />
            <input
              ref="searchInput"
              v-model="searchModel"
              type="text"
              placeholder="搜索提醒事项"
              @focus="searchFocused = true"
              @blur="searchFocused = false"
              @keydown.esc.stop.prevent="clearSearch"
            >
            <button
              v-if="store.searchQuery"
              type="button"
              class="rm-search-clear"
              aria-label="清除搜索"
              @click="clearSearch"
            >
              <ReminderIcon name="close" :size="11" />
            </button>
          </label>
          <button type="button" class="bm-btn bm-btn-ghost bm-btn-icon" title="显示选项" @click="toggleOptions">
            <ReminderIcon name="sort" :size="16" />
          </button>
          <button type="button" class="bm-btn bm-btn-ghost bm-btn-icon" title="每日统计" @click="toggleStats">
            <ReminderIcon name="chart" :size="16" />
          </button>
          <div v-if="isMac" class="rm-sync-wrap">
            <button
              type="button"
              class="bm-btn bm-btn-ghost bm-btn-icon"
              title="macOS 提醒事项同步"
              :disabled="syncing"
              @click.stop="toggleSyncMenu"
            >
              <ReminderIcon name="sync" :size="16" :class="{ 'rm-spin': syncing }" />
            </button>
            <Transition name="rm-sync-pop">
              <div v-if="syncMenuOpen" class="rm-sync-menu" @click.stop>
                <button type="button" class="rm-sync-action" :disabled="syncing" @click="syncWithMac">
                  {{ syncing ? '正在同步…' : '与 macOS 提醒事项同步' }}
                </button>
                <small>列表与 macOS 提醒事项同名双向同步，以最新修改为准</small>
              </div>
            </Transition>
          </div>
        </div>
      </div>
      <div class="rm-body">
        <div v-if="sidebarVisible" class="rm-sidebar-wrap">
          <RemindersSidebar
            :lists="store.lists"
            :counts="store.counts"
            :list-counts="store.listCounts"
            :selected-view="store.selectedView"
            :recently-deleted-count="store.recentlyDeleted.length"
            :tags="store.allTags"
            :selected-tag="store.tagFilter"
            @select="onSelectView"
            @select-tag="store.setTagFilter"
            @add-list="openListEditor(null)"
            @list-menu="openListContext"
            @reorder-lists="ids => store.reorderLists(ids)"
            @move-reminder="({ reminderId, listId }) => store.updateReminder(reminderId, { list_id: listId })"
          />
        </div>

        <ReminderListPane
          ref="paneRef"
          @open-detail="openDetail"
          @context-menu="openRowContext"
          @section-menu="openSectionContext"
          @date-menu="openDateContext"
          @list-menu="openListContext"
        />
      </div>
    </div>

    <ReminderDetailPopover
      :show="detailVisible"
      :reminder="detailReminder"
      :anchor="detailAnchor"
      :focus-field="detailFocus"
      :lists="store.lists"
      :sections="store.sections"
      :projects="projectStore.projects"
      @close="closeDetail"
      @delete="deleteFromDetail"
    />

    <ReminderListEditor
      :show="listEditor.show"
      :list="listEditor.list"
      @close="closeListEditor"
      @save="saveList"
      @delete="deleteListFromEditor"
    />

    <ReminderContextMenu
      :show="context.show"
      :x="context.x"
      :y="context.y"
      :type="context.type"
      :item="context.item"
      :lists="store.lists"
      :sections="store.sections"
      :can-reorder="canReorder"
      @close="context.show = false"
      @action="handleContextAction"
    />

    <ReminderOptionsMenu
      :show="optionsVisible"
      :anchor="optionsAnchor"
      :sort-mode="store.sortMode"
      :group-by-time="store.groupByTime"
      :show-completed="store.showCompleted"
      :subtasks-expanded="store.subtasksExpanded"
      @update:sortMode="value => { store.sortMode = value; optionsVisible = false }"
      @update:groupByTime="value => { store.groupByTime = value }"
      @update:showCompleted="value => { store.showCompleted = value }"
      @toggle-subtasks="store.subtasksExpanded = !store.subtasksExpanded"
      @toggle-sidebar="toggleSidebar"
    />

    <ReminderStatsPopover
      :show="statsVisible"
      :anchor="statsAnchor"
      :stats="store.stats"
      @close="statsVisible = false"
    />

    <div v-if="store.error" class="rm-error" role="alert">{{ store.error }}</div>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { addDays, format, getDay } from 'date-fns'
import RemindersSidebar from '@components/reminders/RemindersSidebar.vue'
import ReminderListPane from '@components/reminders/ReminderListPane.vue'
import ReminderDetailPopover from '@components/reminders/ReminderDetailPopover.vue'
import ReminderListEditor from '@components/reminders/ReminderListEditor.vue'
import ReminderContextMenu from '@components/reminders/ReminderContextMenu.vue'
import ReminderOptionsMenu from '@components/reminders/ReminderOptionsMenu.vue'
import ReminderStatsPopover from '@components/reminders/ReminderStatsPopover.vue'
import ReminderIcon from '@components/reminders/ReminderIcon.vue'
import { useReminderStore } from '@stores/reminder-store'
import { useProjectStore } from '@stores/project-store'
import { useUndoStore } from '@stores/undo-store'
import { dateKey } from '@utils/reminders'
import { isMac } from '@utils/platform'

const route = useRoute()
const router = useRouter()
const store = useReminderStore()
const projectStore = useProjectStore()
const undoStore = useUndoStore()

const paneRef = ref(null)
const searchInput = ref(null)
const searchFocused = ref(false)
const sidebarVisible = ref(localStorage.getItem('bongmaster:reminders:sidebar') !== '0')

const detailVisible = ref(false)
const detailId = ref(null)
const detailFallback = ref(null)
const detailAnchor = ref(null)
const detailFocus = ref('')
const detailReminder = computed(() => (
  (detailId.value ? store.findReminder(detailId.value) : null) || detailFallback.value
))

const listEditor = reactive({ show: false, list: null })
const context = reactive({ show: false, x: 0, y: 0, type: 'reminder', item: null })
const optionsVisible = ref(false)
const optionsAnchor = ref(null)
const statsVisible = ref(false)
const statsAnchor = ref(null)

const syncing = ref(false)
const syncMenuOpen = ref(false)
const syncStatus = ref('')
let syncStatusTimer = null

let pollTimer = null
let offReminderFocus = null
let pollPausedUntil = 0

const pausePolling = () => { pollPausedUntil = Date.now() + 3000 }

const searchModel = computed({
  get: () => store.searchQuery,
  set: value => store.setSearch(value)
})

const canAddReminder = computed(() => !['completed', 'recentlyDeleted'].includes(
  store.selectedView.type === 'smart' ? store.selectedView.id : store.selectedView.type
))

const canReorder = computed(() => (
  store.selectedView.type === 'list' && store.sortMode === 'manual'
))

let errorTimer = null
watch(() => store.error, value => {
  if (!value) return
  if (errorTimer) window.clearTimeout(errorTimer)
  errorTimer = window.setTimeout(() => {
    store.error = null
    errorTimer = null
  }, 5000)
})

const toggleSidebar = () => {
  sidebarVisible.value = !sidebarVisible.value
  localStorage.setItem('bongmaster:reminders:sidebar', sidebarVisible.value ? '1' : '0')
}

const onSelectView = view => {
  store.selectView(view)
  if (view.type === 'recentlyDeleted') store.fetchRecentlyDeleted()
}

const clearSearch = () => {
  store.setSearch('')
  searchInput.value?.blur()
}

const rectOf = target => (target?.currentTarget || target)?.getBoundingClientRect?.() || null

const openDetail = (reminder, event) => {
  if (!reminder) return
  detailFocus.value = ''
  detailId.value = reminder.id
  detailFallback.value = reminder
  detailAnchor.value = rectOf(event)
  detailVisible.value = true
}

const openDetailById = (id, anchor = null, focusField = '') => {
  const reminder = store.findReminder(id)
  if (!reminder) return
  detailFocus.value = focusField
  detailId.value = id
  detailFallback.value = reminder
  detailAnchor.value = anchor || document.querySelector(`[data-reminder-id="${id}"]`)?.getBoundingClientRect() || null
  detailVisible.value = true
}

const closeDetail = () => {
  detailVisible.value = false
  detailId.value = null
  detailFallback.value = null
  detailFocus.value = ''
}

const deleteWithUndo = async reminder => {
  if (!reminder) return
  const deleted = await store.deleteReminder(reminder.id)
  if (!deleted) return
  undoStore.showUndo({
    message: `已删除提醒「${deleted.title || '未命名'}」`,
    undo: () => store.restoreReminders([deleted.id])
  })
}

const deleteFromDetail = async reminder => {
  closeDetail()
  await deleteWithUndo(reminder)
}

const deleteSelected = async () => {
  const ids = [...store.selectedIds]
  if (!ids.length) return
  const deleted = []
  for (const id of ids) {
    const reminder = store.findReminder(id)
    if (!reminder) continue
    const removed = await store.deleteReminder(id)
    if (removed) deleted.push(removed)
  }
  if (!deleted.length) return
  undoStore.showUndo({
    message: `已删除 ${deleted.length} 条提醒`,
    undo: () => store.restoreReminders(deleted.map(item => item.id))
  })
}

const toggleSelectedComplete = async () => {
  const ids = [...store.selectedIds]
  if (!ids.length) return
  const targets = ids.map(id => store.findReminder(id)).filter(Boolean)
  if (!targets.length) return
  const makeCompleted = targets.some(reminder => !reminder.is_completed)
  for (const reminder of targets) {
    await store.toggleComplete(reminder.id, makeCompleted)
  }
}

const openListEditor = list => {
  listEditor.list = list || null
  listEditor.show = true
}

const closeListEditor = () => {
  listEditor.show = false
  listEditor.list = null
}

const saveList = async payload => {
  if (payload.id) {
    await store.updateList(payload.id, payload)
  } else {
    const created = await store.createList(payload)
    if (created) store.selectView({ type: 'list', id: created.id })
  }
  closeListEditor()
}

const deleteListFromEditor = async list => {
  if (!list) return
  const count = store.reminders.filter(reminder => reminder.list_id === list.id && !reminder.is_completed).length
  if (!window.confirm(`删除列表「${list.name}」？${count ? `其中 ${count} 条未完成提醒会移到最近删除。` : ''}`)) return
  await store.deleteList(list.id)
  closeListEditor()
}

const openListContext = (event, list) => {
  context.show = false
  context.x = event.clientX
  context.y = event.clientY
  context.type = 'list'
  context.item = list
  requestAnimationFrame(() => { context.show = true })
}

const openRowContext = (event, reminder) => {
  context.show = false
  context.x = event.clientX
  context.y = event.clientY
  context.type = reminder?.deleted_at ? 'deleted' : 'reminder'
  context.item = reminder
  requestAnimationFrame(() => { context.show = true })
}

const openDateContext = (event, group) => {
  context.show = false
  context.x = event.clientX
  context.y = event.clientY
  context.type = 'date'
  context.item = { date: group.date, group }
  requestAnimationFrame(() => { context.show = true })
}

const openSectionContext = (event, group) => {
  context.show = false
  context.x = event.clientX
  context.y = event.clientY
  context.type = 'section'
  context.item = group
  requestAnimationFrame(() => { context.show = true })
}

const weekendKey = () => {
  const now = new Date()
  const delta = (6 - getDay(now) + 7) % 7
  return format(addDays(now, delta), 'yyyy-MM-dd')
}

const moveReminderWithinScope = async (reminder, direction) => {
  if (!reminder) return
  const scope = store.reminders
    .filter(item => (
      item.list_id === reminder.list_id
      && (item.section_id || null) === (reminder.section_id || null)
      && !item.is_completed
    ))
    .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0))
  const index = scope.findIndex(item => item.id === reminder.id)
  if (index < 0) return
  const ids = scope.map(item => item.id)
  let target = index
  if (direction === 'up') target = Math.max(0, index - 1)
  else if (direction === 'down') target = Math.min(ids.length - 1, index + 1)
  else if (direction === 'top') target = 0
  else if (direction === 'bottom') target = ids.length - 1
  if (target === index) return
  ids.splice(index, 1)
  ids.splice(target, 0, reminder.id)
  await store.reorderReminders(ids, reminder.section_id || null)
}

const handleContextAction = async ({ type, action, item, listId, sectionId, priority }) => {
  if (type === 'reminder') {
    if (!item) return
    if (action === 'detail') {
      openDetailById(item.id, null)
    } else if (action === 'toggle-complete') {
      await store.toggleComplete(item.id, !item.is_completed)
    } else if (action === 'toggle-flag') {
      await store.updateReminder(item.id, { is_flagged: !item.is_flagged })
    } else if (action === 'priority') {
      await store.updateReminder(item.id, { priority })
    } else if (action === 'date-today') {
      await store.updateReminder(item.id, { date: dateKey() })
    } else if (action === 'date-tomorrow') {
      await store.updateReminder(item.id, { date: format(addDays(new Date(), 1), 'yyyy-MM-dd') })
    } else if (action === 'date-weekend') {
      await store.updateReminder(item.id, { date: weekendKey() })
    } else if (action === 'date-clear') {
      await store.updateReminder(item.id, {
        date: '',
        due_time: null,
        remind_time: null,
        recurrence_type: 'none',
        recurrence_value: '',
        recurrence_end_date: null
      })
    } else if (action === 'remind-later') {
      const target = new Date(Date.now() + 60 * 60 * 1000)
      await store.updateReminder(item.id, {
        date: format(target, 'yyyy-MM-dd'),
        remind_time: format(target, 'HH:mm')
      })
    } else if (action === 'remind-tomorrow') {
      await store.updateReminder(item.id, {
        date: format(addDays(new Date(), 1), 'yyyy-MM-dd'),
        remind_time: '09:00'
      })
    } else if (action === 'remind-clear') {
      await store.updateReminder(item.id, { remind_time: null })
    } else if (action === 'move') {
      await store.moveToList([item.id], listId)
    } else if (action === 'move-section') {
      await store.updateReminder(item.id, { section_id: sectionId || null })
    } else if (action === 'add-subtask') {
      openDetailById(item.id, null, 'subtask')
    } else if (action === 'add-attachment') {
      const created = await store.addAttachment(item.id)
      if (created) await store.fetchAll({ silent: true })
    } else if (action === 'move-up') {
      await moveReminderWithinScope(item, 'up')
    } else if (action === 'move-down') {
      await moveReminderWithinScope(item, 'down')
    } else if (action === 'move-top') {
      await moveReminderWithinScope(item, 'top')
    } else if (action === 'move-bottom') {
      await moveReminderWithinScope(item, 'bottom')
    } else if (action === 'duplicate') {
      await store.duplicateReminder(item.id)
    } else if (action === 'delete') {
      await deleteWithUndo(item)
    }
    return
  }

  if (type === 'deleted') {
    if (!item) return
    if (action === 'restore-deleted') {
      await store.restoreReminders([item.id])
    } else if (action === 'purge-deleted') {
      if (!window.confirm(`永久删除「${item.title}」？此操作无法撤销。`)) return
      await store.purgeReminder(item.id)
    }
    return
  }

  if (type === 'list') {
    if (!item) return
    if (action === 'edit-list') {
      openListEditor(item)
    } else if (action === 'add-section') {
      store.selectView({ type: 'list', id: item.id })
      await nextTick()
      paneRef.value?.addSection()
    } else if (action === 'toggle-pin') {
      await store.updateList(item.id, { is_pinned: !item.is_pinned })
    } else if (action === 'delete-list') {
      await deleteListFromEditor(item)
    }
    return
  }

  if (type === 'section') {
    if (!item) return
    if (action === 'rename-section') {
      paneRef.value?.startRenameSection(item)
    } else if (action === 'delete-section') {
      const deleted = await store.deleteSection(item.sectionId)
      if (deleted?.section) {
        undoStore.showUndo({
          message: `已删除分区「${deleted.section.name}」`,
          undo: () => store.restoreSection(deleted.section, deleted.reminderIds)
        })
      }
    }
    return
  }

  if (type === 'date' && action === 'add-date') {
    paneRef.value?.openAddForDate(item?.date || dateKey())
  }
}

const toggleOptions = event => {
  optionsAnchor.value = rectOf(event)
  optionsVisible.value = !optionsVisible.value
}

const toggleStats = event => {
  statsAnchor.value = rectOf(event)
  statsVisible.value = !statsVisible.value
  if (statsVisible.value) store.fetchStats()
}

const setSyncStatus = (message, duration = 8000) => {
  if (syncStatusTimer) {
    window.clearTimeout(syncStatusTimer)
    syncStatusTimer = null
  }
  syncStatus.value = message
  if (message && duration > 0) {
    syncStatusTimer = window.setTimeout(() => {
      syncStatus.value = ''
      syncStatusTimer = null
    }, duration)
  }
}

const toggleSyncMenu = () => {
  if (syncing.value) return
  syncMenuOpen.value = !syncMenuOpen.value
}

const syncWithMac = async () => {
  if (syncing.value) return
  syncMenuOpen.value = false
  syncing.value = true
  setSyncStatus('')
  try {
    const result = await window.electronAPI.syncRemindersWithMac()
    await store.fetchAll({ silent: true })
    await store.fetchRecentlyDeleted()
    setSyncStatus(`同步完成：本地→macOS 新建 ${result.macCreated}、更新 ${result.macUpdated}、删除 ${result.macDeleted}；macOS→本地 新建 ${result.localCreated}、更新 ${result.localUpdated}、删除 ${result.localDeleted}、完成 ${result.localCompleted}`)
  } catch (err) {
    store.error = err.message || '与 macOS 提醒事项同步失败'
  } finally {
    syncing.value = false
  }
}

const onDocumentClick = event => {
  if (!syncMenuOpen.value) return
  if (event.target?.closest?.('.rm-sync-wrap')) return
  syncMenuOpen.value = false
}

const onReminderFocus = async id => {
  await store.fetchAll({ silent: true })
  const reminder = store.findReminder(id)
  if (!reminder) return
  if (reminder.list_id && store.selectedView.type === 'list' && store.selectedView.id !== reminder.list_id) {
    store.selectView({ type: 'list', id: reminder.list_id })
  }
  store.selectReminder(id)
  openDetailById(id)
}

const isTypingTarget = target => (
  target?.closest?.('input, textarea, select, [contenteditable="true"]')
)

const onKeydown = event => {
  const typing = isTypingTarget(event.target)
  const modifier = event.metaKey || event.ctrlKey

  if (event.ctrlKey && event.altKey && event.code === 'Space') {
    event.preventDefault()
    toggleSelectedComplete()
    return
  }

  if (event.key === 'Escape') {
    if (syncMenuOpen.value) {
      syncMenuOpen.value = false
      event.preventDefault()
      return
    }
    if (listEditor.show) {
      closeListEditor()
      event.preventDefault()
      return
    }
    if (context.show) {
      context.show = false
      event.preventDefault()
      return
    }
    if (optionsVisible.value) {
      optionsVisible.value = false
      event.preventDefault()
      return
    }
    if (statsVisible.value) {
      statsVisible.value = false
      event.preventDefault()
      return
    }
    if (detailVisible.value) {
      closeDetail()
      event.preventDefault()
      return
    }
    if (store.searchQuery) {
      clearSearch()
      event.preventDefault()
      return
    }
    if (store.selectedIds.length) {
      store.selectedReminderId = null
      store.selectedIds = []
      event.preventDefault()
    }
    return
  }

  if (!modifier) return

  if (event.key.toLowerCase() === 'n') {
    event.preventDefault()
    if (event.shiftKey) openListEditor(null)
    else paneRef.value?.openAddForCurrent()
    return
  }

  if (typing) return

  if (event.key.toLowerCase() === 'i') {
    event.preventDefault()
    if (store.selectedReminderId) openDetailById(store.selectedReminderId)
    return
  }

  if (event.key.toLowerCase() === 'f') {
    event.preventDefault()
    searchInput.value?.focus()
    searchInput.value?.select()
    return
  }

  if (event.key === 'Backspace' || event.key === 'Delete') {
    event.preventDefault()
    deleteSelected()
    return
  }

  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    const flat = store.groups.flatMap(group => group.kind === 'month'
      ? group.subgroups.flatMap(subgroup => subgroup.items)
      : group.items)
    if (!flat.length) return
    event.preventDefault()
    const current = flat.findIndex(reminder => reminder.id === store.selectedReminderId)
    const delta = event.key === 'ArrowDown' ? 1 : -1
    const next = current < 0 ? 0 : Math.max(0, Math.min(flat.length - 1, current + delta))
    store.selectReminder(flat[next].id)
  }
}

const applyRouteFocus = async () => {
  const id = Number(route.query.focus)
  if (!Number.isInteger(id) || id <= 0) return
  if (!store.reminders.length) await store.fetchAll({ silent: true })
  const reminder = store.findReminder(id)
  if (!reminder) return
  if (reminder.list_id) store.selectView({ type: 'list', id: reminder.list_id })
  store.selectReminder(id)
  await nextTick()
  openDetailById(id)
  router.replace({ path: route.path, query: {} })
}

watch(() => route.query.focus, () => { applyRouteFocus() })

const refreshSilently = async () => {
  if (document.hidden) return
  if (syncing.value) return
  if (Date.now() < pollPausedUntil) return
  if (document.body.classList.contains('rm-dragging')) return
  if (detailVisible.value || listEditor.show || context.show) return
  await store.fetchAll({ silent: true })
}

onMounted(async () => {
  await store.fetchAll()
  store.fetchRecentlyDeleted()
  if (!projectStore.projects.length) projectStore.fetchProjects()
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('pointerdown', pausePolling, true)
  document.addEventListener('click', onDocumentClick)
  offReminderFocus = window.electronAPI?.onReminderFocus?.(onReminderFocus) || null
  pollTimer = window.setInterval(refreshSilently, 2500)
  await applyRouteFocus()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('pointerdown', pausePolling, true)
  document.removeEventListener('click', onDocumentClick)
  if (offReminderFocus) offReminderFocus()
  if (pollTimer) {
    window.clearInterval(pollTimer)
    pollTimer = null
  }
  if (errorTimer) {
    window.clearTimeout(errorTimer)
    errorTimer = null
  }
  if (syncStatusTimer) {
    window.clearTimeout(syncStatusTimer)
    syncStatusTimer = null
  }
})
</script>

<style scoped>
.reminders-page {
  display: flex;
  flex-direction: column;
  max-width: 1360px;
  height: calc(100vh - var(--bm-navbar-height));
  padding: 12px 18px 16px;
  font-family: var(--bm-font-family);
}

.rm-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex: 0 0 auto;
  min-height: 44px;
  padding: 6px 10px 6px 14px;
  border-bottom: 1px solid var(--bm-border-subtle);
  background: var(--bm-bg-card);
}

.rm-page-title {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
  overflow: hidden;
}

.rm-page-title h1 {
  margin: 0;
  white-space: nowrap;
}

.rm-page-subtitle {
  min-width: 0;
  overflow: hidden;
  color: var(--bm-text-muted);
  font-size: 11.5px;
  white-space: nowrap;
}

.rm-page-actions {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  min-width: 0;
}

.rm-page-actions .bm-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 9px;
  font-size: 12.5px;
}

.rm-page-actions .bm-btn-icon {
  width: 28px;
  padding: 0;
}

.rm-page-status {
  color: var(--bm-text-muted);
  font-size: 11px;
}

.rm-sync-status {
  max-width: 380px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rm-sync-wrap {
  position: relative;
  display: flex;
}

.rm-sync-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 1300;
  width: 264px;
  padding: 7px;
  border: 1px solid var(--bm-border-default);
  border-radius: 10px;
  background: var(--bm-bg-card);
  box-shadow: 0 12px 32px rgb(0 0 0 / 0.16);
}

.rm-sync-action {
  width: 100%;
  height: 30px;
  padding: 0 9px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--bm-text-primary);
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
}

.rm-sync-action:hover:not(:disabled) {
  background: var(--bm-bg-hover);
}

.rm-sync-action:disabled {
  color: var(--bm-text-muted);
  cursor: default;
}

.rm-sync-menu small {
  display: block;
  padding: 5px 9px 2px;
  color: var(--bm-text-muted);
  font-size: 10.5px;
  line-height: 1.45;
}

.rm-spin {
  animation: rm-spin 900ms linear infinite;
}

@keyframes rm-spin {
  to { transform: rotate(360deg); }
}

.rm-sync-pop-enter-active,
.rm-sync-pop-leave-active {
  transition: opacity 120ms ease, transform 120ms ease;
}

.rm-sync-pop-enter-from,
.rm-sync-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.rm-search {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 200px;
  height: 28px;
  margin: 0 2px;
  padding: 0 8px;
  border: 1px solid var(--bm-border-default);
  border-radius: var(--bm-radius-md);
  background: var(--bm-bg-card);
  color: var(--bm-text-muted);
  transition: border-color 120ms ease, box-shadow 120ms ease;
}

.rm-search.focused {
  border-color: var(--bm-accent-blue);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--bm-accent-blue) 14%, transparent);
}

.rm-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--bm-text-primary);
  font: inherit;
  font-size: 12.5px;
}

.rm-search input::placeholder {
  color: var(--bm-text-muted);
}

.rm-search-clear {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--bm-border-default);
  color: var(--bm-bg-card);
  cursor: pointer;
}

.rm-shell {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--bm-border-default);
  border-radius: var(--bm-radius-lg);
  background: var(--bm-bg-card);
  box-shadow: var(--bm-shadow-sm);
}

.rm-body {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
}

.rm-sidebar-wrap {
  width: 276px;
  flex: 0 0 276px;
  min-height: 0;
  border-right: 1px solid var(--bm-border-subtle);
}

.rm-shell.sidebar-hidden .rm-sidebar-wrap {
  display: none;
}

.rm-error {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 1400;
  max-width: 420px;
  padding: 9px 13px;
  border-radius: 9px;
  background: var(--bm-accent-danger);
  color: #fff;
  font-size: 12px;
  box-shadow: 0 10px 30px rgb(0 0 0 / 0.2);
}

@media (max-width: 900px) {
  .reminders-page { padding: 10px; }
  .rm-search { width: 160px; }
  .rm-sidebar-wrap {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    z-index: 20;
    background: var(--bm-bg-sidebar);
    box-shadow: 12px 0 30px rgb(0 0 0 / 0.16);
  }
}
</style>
