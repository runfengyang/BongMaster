<template>
  <div class="fade-in bm-page task-board-page">
    <div class="tb-shell">
      <TaskBoardToolbar
        :filters="filters.filters"
        :tasks="taskStore.tasks"
        :active-filter-count="filterBadgeCount"
        :view-mode="viewMode"
        @update:view-mode="setViewMode"
        @clear-filters="clearBoardFilters"
        @new-task="openCreateDrawer"
      />

      <div class="tb-body">
        <div class="tb-main">
          <div class="tb-scope-bar">
            <button
              type="button"
              class="tb-scope-chip"
              :class="{ active: scopeProjectId === null }"
              @click="selectScope(null)"
            >
              <span class="tb-scope-name">全部项目</span>
              <span class="tb-scope-count">{{ activeTaskTotal }}</span>
            </button>
            <button
              v-for="project in scopeProjects"
              :key="project.id"
              type="button"
              class="tb-scope-chip"
              :class="{ active: scopeProjectId === project.id }"
              :title="project.name"
              @click="selectScope(project.id)"
            >
              <span class="tb-scope-name">{{ project.name }}</span>
              <span class="tb-scope-count">{{ projectCounts[project.id] || 0 }}</span>
            </button>
          </div>

          <div class="tb-view" :class="{ 'is-scope-switching': scopeSwitching }">
          <TaskBoardKanban
            v-show="viewMode === 'board'"
            :todo-tasks="todoTasks"
            :doing-tasks="doingTasks"
            :done-tasks="doneTasks"
            :done-expanded="doneExpanded"
            :recently-moved-task-id="recentlyMovedTaskId"
            :recently-completed-task-id="recentlyCompletedTaskId"
            :can-add="Boolean(defaultProjectId)"
            :default-project-name="defaultProjectName"
            @task-click="openEditDrawer"
            @status-change="handleStatusChange"
            @quick-add="handleQuickAdd"
            @context-menu="openTaskContext"
            @done-toggle="doneExpanded = !doneExpanded"
          />

          <TaskListView
            v-show="viewMode === 'list'"
            :tasks="filteredTasks"
            @task-click="openEditDrawer"
            @context-menu="openTaskContext"
          />
          </div>
        </div>

        <TaskDetailDrawer
          v-if="drawerMode !== 'closed'"
          variant="panel"
          :show="true"
          :mode="drawerMode"
          :task="drawerTask"
          :projects="projectStore.projects"
          :defaults="drawerDefaults"
          @close="closeDrawer"
          @save="handleDrawerSave"
          @delete="handleDrawerDelete"
        />
      </div>
    </div>

    <TaskContextMenu
      v-if="taskContext.show"
      :x="taskContext.x"
      :y="taskContext.y"
      :task="taskContext.task"
      @close="closeTaskContext"
      @action="handleTaskAction"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { addDays, format } from 'date-fns'
import { playDoneSound, fireConfetti } from '@composables/useCompletionEffect.js'
import { useTaskStore } from '@stores/task-store'
import { useProjectStore } from '@stores/project-store'
import { useUndoStore } from '@stores/undo-store'
import { useTaskBoardFilters } from '@composables/useTaskBoardFilters.js'
import { sortBoardTasks, sortCompletedTasks } from '@utils/task-board.js'
import TaskBoardToolbar from '@components/task-board/TaskBoardToolbar.vue'
import TaskBoardKanban from '@components/task-board/TaskBoardKanban.vue'
import TaskListView from '@components/task-board/TaskListView.vue'
import TaskContextMenu from '@components/task-board/TaskContextMenu.vue'
import TaskDetailDrawer from '@components/task-board/TaskDetailDrawer.vue'

const taskStore = useTaskStore()
const projectStore = useProjectStore()
const undoStore = useUndoStore()
const filters = useTaskBoardFilters()

const STORAGE_KEY = 'bongmaster:taskboard:v2'

const viewMode = ref('board')
const scopeProjectId = ref(null)
const doneExpanded = ref(false)
const scopeSwitching = ref(false)
let scopeSwitchTimer = null

const drawerMode = ref('closed')
const drawerTask = ref(null)
const drawerDefaults = ref({})

const taskContext = reactive({ show: false, x: 0, y: 0, task: null })

const activeTaskTotal = computed(() => taskStore.tasks.filter(task => task.status !== '已完成').length)

const projectCounts = computed(() => {
  const counts = {}
  taskStore.tasks.forEach(task => {
    if (task.status === '已完成') return
    counts[task.project_id] = (counts[task.project_id] || 0) + 1
  })
  return counts
})

const scopeProjects = computed(() => (
  projectStore.projects.filter(project => (
    (project.status === '进行中' || project.status === '未开始')
    && ((projectCounts.value[project.id] || 0) > 0 || project.id === scopeProjectId.value)
  ))
))

const filteredTasks = computed(() => {
  let list = filters.filterTasks(taskStore.tasks, projectStore.projects)
  if (scopeProjectId.value) {
    list = list.filter(task => task.project_id === scopeProjectId.value)
  }
  return list
})

const todoTasks = computed(() => sortBoardTasks(filteredTasks.value.filter(task => task.status === '待办')))
const doingTasks = computed(() => sortBoardTasks(filteredTasks.value.filter(task => task.status === '进行中')))
const doneTasks = computed(() => sortCompletedTasks(filteredTasks.value.filter(task => task.status === '已完成')))

const filterBadgeCount = computed(() => {
  const f = filters.filters
  let count = 0
  if (f.priorities.length) count += 1
  if (f.assignees.length) count += 1
  if (f.statuses.length) count += 1
  if (f.dueMode !== 'all') count += 1
  return count
})

const defaultProjectId = computed(() => (
  scopeProjectId.value
  || projectStore.projects.find(project => project.status === '进行中')?.id
  || projectStore.projects.find(project => project.status === '未开始')?.id
  || projectStore.projects[0]?.id
  || null
))

const defaultProjectName = computed(() => (
  projectStore.projects.find(project => project.id === defaultProjectId.value)?.name || ''
))

const selectScope = projectId => {
  if (scopeProjectId.value === projectId) return
  scopeProjectId.value = projectId
  doneExpanded.value = false
  scopeSwitching.value = false
  nextTick(() => {
    scopeSwitching.value = true
    if (scopeSwitchTimer) window.clearTimeout(scopeSwitchTimer)
    scopeSwitchTimer = window.setTimeout(() => {
      scopeSwitching.value = false
      scopeSwitchTimer = null
    }, 240)
  })
}

const setViewMode = mode => {
  viewMode.value = mode
  doneExpanded.value = false
}

const clearBoardFilters = () => {
  filters.clearFilters()
  filters.filters.activeProjectsOnly = false
  filters.filters.includeCompleted = true
  filters.filters.projectIds = []
}

const recentlyMovedTaskId = ref(null)
const recentlyCompletedTaskId = ref(null)
let taskMotionTimer = null

const markTaskMotion = (taskId, status) => {
  recentlyMovedTaskId.value = taskId
  recentlyCompletedTaskId.value = status === '已完成' ? taskId : null
  if (taskMotionTimer) window.clearTimeout(taskMotionTimer)
  taskMotionTimer = window.setTimeout(() => {
    recentlyMovedTaskId.value = null
    recentlyCompletedTaskId.value = null
    taskMotionTimer = null
  }, 900)
}

const handleStatusChange = async ({ taskId, newStatus }) => {
  await taskStore.updateTask(taskId, { status: newStatus })
  markTaskMotion(taskId, newStatus)
  doneExpanded.value = false
  if (newStatus === '已完成') {
    playDoneSound()
    nextTick(() => {
      const el = document.querySelector(`.tb-card[data-task-id="${taskId}"]`) || document.querySelector('.task-board-page')
      fireConfetti(el)
    })
  }
}

const handleQuickAdd = async ({ name, status }) => {
  const title = String(name || '').trim()
  if (!title) return
  const projectId = defaultProjectId.value
  if (!projectId) {
    openCreateDrawer()
    return
  }
  const created = await taskStore.createTask({
    project_id: projectId,
    name: title,
    status,
    priority: '中',
    sort_order: 0
  })
  if (created) markTaskMotion(created.id, status)
}

const openTaskContext = async (task, event) => {
  if (!task) return
  taskContext.show = false
  await nextTick()
  taskContext.task = task
  taskContext.x = event.clientX
  taskContext.y = event.clientY
  taskContext.show = true
}

const closeTaskContext = () => {
  taskContext.show = false
}

const weekendKey = () => {
  const now = new Date()
  const delta = (6 - now.getDay() + 7) % 7
  return format(addDays(now, delta), 'yyyy-MM-dd')
}

const handleTaskAction = async ({ action, task, status, priority }) => {
  if (!task) return
  const id = task.id
  if (action === 'detail') {
    openEditDrawer(task)
    return
  }
  if (action === 'toggle-complete') {
    await handleStatusChange({ taskId: id, newStatus: task.status === '已完成' ? '待办' : '已完成' })
    return
  }
  if (action === 'move') {
    if (status && status !== task.status) await handleStatusChange({ taskId: id, newStatus: status })
    return
  }
  if (action === 'priority') {
    await taskStore.updateTask(id, { priority })
    return
  }
  if (action === 'due-today') {
    await taskStore.updateTask(id, { due_date: format(new Date(), 'yyyy-MM-dd') })
    return
  }
  if (action === 'due-tomorrow') {
    await taskStore.updateTask(id, { due_date: format(addDays(new Date(), 1), 'yyyy-MM-dd') })
    return
  }
  if (action === 'due-weekend') {
    await taskStore.updateTask(id, { due_date: weekendKey() })
    return
  }
  if (action === 'due-clear') {
    await taskStore.updateTask(id, { due_date: null })
    return
  }
  if (action === 'duplicate') {
    const created = await taskStore.createTask({
      project_id: task.project_id,
      name: `${task.name}（副本）`,
      status: '待办',
      priority: task.priority || '中',
      assignee: task.assignee || '',
      due_date: task.due_date || null,
      description: task.description || '',
      tags: task.tags || '',
      estimated_minutes: task.estimated_minutes || 0,
      time_spent_minutes: 0
    })
    if (created) markTaskMotion(created.id, '待办')
    return
  }
  if (action === 'delete') {
    const deleted = await taskStore.deleteTask(id)
    if (!deleted) return
    undoStore.showUndo({
      message: `已删除任务「${task.name || '未命名'}」`,
      undo: () => taskStore.restoreTask(task)
    })
  }
}

const closeDrawer = () => {
  drawerMode.value = 'closed'
  drawerTask.value = null
  drawerDefaults.value = {}
}

const openCreateDrawer = async () => {
  if (!projectStore.projects.length) await projectStore.fetchProjects()
  const projectId = defaultProjectId.value
  if (!projectId) {
    alert('请先创建一个项目')
    return
  }
  drawerTask.value = null
  drawerDefaults.value = { status: '待办', project_id: projectId }
  drawerMode.value = 'create'
}

const openEditDrawer = task => {
  if (!task) return
  drawerTask.value = task
  drawerDefaults.value = {}
  drawerMode.value = 'edit'
}

const handleDrawerSave = async (payload, done) => {
  try {
    const result = drawerMode.value === 'edit' && drawerTask.value
      ? await taskStore.updateTask(drawerTask.value.id, payload)
      : await taskStore.createTask(payload)
    if (result) closeDrawer()
  } finally {
    done()
  }
}

const handleDrawerDelete = async taskId => {
  const task = taskStore.tasks.find(item => item.id === taskId)
  const deleted = await taskStore.deleteTask(taskId)
  closeDrawer()
  if (!deleted) return
  undoStore.showUndo({
    message: `已删除任务「${task?.name || '未命名'}」`,
    undo: () => taskStore.restoreTask(task || { id: taskId })
  })
}

const loadState = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const state = JSON.parse(raw)
    if (state.viewMode === 'board' || state.viewMode === 'list') viewMode.value = state.viewMode
    if (state.scopeProjectId) scopeProjectId.value = state.scopeProjectId
    if (state.filters) Object.assign(filters.filters, state.filters)
  } catch (error) {
    console.error('Failed to load task board state:', error)
  }
}

const saveState = () => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      viewMode: viewMode.value,
      scopeProjectId: scopeProjectId.value,
      filters: { ...filters.filters }
    }))
  } catch (error) {
    console.error('Failed to save task board state:', error)
  }
}

let stateTimer = null
watch(
  () => [viewMode.value, scopeProjectId.value, filters.filters],
  () => {
    if (stateTimer) window.clearTimeout(stateTimer)
    stateTimer = window.setTimeout(saveState, 200)
  },
  { deep: true }
)

onMounted(async () => {
  loadState()
  filters.filters.activeProjectsOnly = false
  filters.filters.includeCompleted = true
  filters.filters.projectIds = []
  await Promise.all([taskStore.fetchAllTasks(), projectStore.fetchProjects()])
  if (scopeProjectId.value && !projectStore.projects.some(project => project.id === scopeProjectId.value)) {
    scopeProjectId.value = null
  }
})

onUnmounted(() => {
  if (taskMotionTimer) window.clearTimeout(taskMotionTimer)
  if (scopeSwitchTimer) window.clearTimeout(scopeSwitchTimer)
  if (stateTimer) window.clearTimeout(stateTimer)
})
</script>

<style scoped>
.task-board-page {
  display: flex;
  flex-direction: column;
  max-width: 1440px;
  height: calc(100vh - var(--bm-navbar-height));
  padding: 12px 18px 16px;
  font-family: var(--bm-font-family);
}

.tb-shell {
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

.tb-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.tb-main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.tb-scope-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  min-height: 38px;
  padding: 5px 12px;
  border-bottom: 1px solid var(--bm-border-subtle);
  overflow-x: auto;
  scrollbar-width: none;
}

.tb-scope-bar::-webkit-scrollbar { display: none; }

.tb-scope-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  height: 26px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: var(--bm-text-secondary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}

.tb-scope-chip:hover { background: var(--bm-bg-hover); color: var(--bm-text-primary); }

.tb-scope-chip.active {
  border-color: var(--bm-border-default);
  background: var(--bm-bg-hover);
  color: var(--bm-text-primary);
  font-weight: 600;
}

.tb-scope-name {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tb-scope-count {
  color: var(--bm-text-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.tb-scope-chip.active .tb-scope-count { color: var(--bm-text-secondary); }

@media (max-width: 900px) {
  .task-board-page { padding: 10px 12px 12px; }
}
.tb-view {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

@media (prefers-reduced-motion: no-preference) {
  .tb-view.is-scope-switching { animation: tbScopeSwitch 220ms ease-out; }
}

@keyframes tbScopeSwitch {
  from { opacity: 0.35; }
  to { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .tb-view.is-scope-switching { animation: none; }
}
</style>
