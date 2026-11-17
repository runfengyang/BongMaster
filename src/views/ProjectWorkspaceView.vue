<template>
  <div class="fade-in bm-page project-workspace-page">
    <div class="pw-shell">
      <header class="pw-toolbar">
        <div class="pw-toolbar-title">
          <span class="bm-tab-title">项目</span>
          <span class="pw-toolbar-sub">{{ projectStore.projects.length }} 个项目 · {{ doingCount }} 个进行中</span>
        </div>
        <div class="pw-toolbar-actions">
          <label class="pw-search">
            <i class="fas fa-search" aria-hidden="true"></i>
            <input v-model="searchQuery" type="text" placeholder="搜索项目" @keydown.esc="searchQuery = ''">
            <button v-if="searchQuery" type="button" class="pw-search-clear" aria-label="清除搜索" @click="searchQuery = ''">
              <i class="fas fa-times" aria-hidden="true"></i>
            </button>
          </label>
          <button type="button" class="bm-btn bm-btn-primary pw-new-btn" @click="openCreateModal">
            新建项目
          </button>
        </div>
      </header>

      <div class="pw-body">
        <aside class="pw-rail" aria-label="项目列表">
          <section v-for="group in visibleGroups" :key="group.status" class="pw-group">
            <button type="button" class="pw-group-head" @click="toggleGroup(group.status)">
              <i class="fas" :class="isGroupCollapsed(group.status) ? 'fa-chevron-right' : 'fa-chevron-down'" aria-hidden="true"></i>
              <span class="pw-group-name">{{ group.status }}</span>
              <span class="pw-group-count">{{ group.total }}</span>
            </button>
            <div v-if="!isGroupCollapsed(group.status)" class="pw-rail-list">
              <button
                v-for="item in group.projects"
                :key="item.id"
                type="button"
                class="pw-rail-row"
                :class="{ active: item.id === selectedId }"
                :title="item.name"
                @click="selectProject(item.id)"
              >
                <span class="pw-rail-title-line">
                  <span class="pw-rail-name">{{ item.name }}</span>
                  <span v-if="item.priority === '高'" class="pw-rail-flag" aria-label="高优先级">⚑</span>
                  <span class="pw-rail-count">{{ item.completed_task_count || 0 }}/{{ item.task_count || 0 }}</span>
                </span>
                <span class="pw-rail-sub">
                  <span class="pw-rail-desc">{{ item.description || '暂无描述' }}</span>
                  <span v-if="item.overdue_task_count > 0" class="pw-rail-overdue">{{ item.overdue_task_count }} 逾期</span>
                  <span class="pw-rail-updated">{{ relativeDate(item.updated_at) }}</span>
                </span>
              </button>
              <div v-if="!group.projects.length" class="pw-rail-empty">没有项目</div>
            </div>
          </section>
        </aside>

        <section v-if="project" class="pw-detail">
          <header class="pw-detail-head">
            <div class="pw-title-row">
              <h1 class="pw-title">{{ project.name }}</h1>
              <span class="pw-badge" :class="statusClass(project.status)">{{ project.status }}</span>
              <span v-if="project.priority === '高'" class="pw-badge high"><i class="fas fa-flag" aria-hidden="true"></i> 高</span>
              <div class="pw-head-actions">
                <button type="button" class="bm-btn bm-btn-ghost" @click="openEditModal">
                  <i class="fas fa-pen" aria-hidden="true"></i> 编辑
                </button>
                <button type="button" class="bm-btn bm-btn-ghost pw-danger" @click="deleteProject">
                  <i class="fas fa-trash" aria-hidden="true"></i> 删除
                </button>
              </div>
            </div>
            <div class="pw-detail-meta">
              <span>{{ projectRange }}</span>
              <span class="pw-meta-sep">·</span>
              <span>{{ taskStats.total }} 项任务</span>
              <template v-if="project.updated_at">
                <span class="pw-meta-sep">·</span>
                <span>更新于 {{ relativeDate(project.updated_at) }}</span>
              </template>
            </div>
          </header>

          <nav class="pw-tabs" aria-label="项目详情">
            <button
              v-for="tab in TABS"
              :key="tab.id"
              type="button"
              class="pw-tab"
              :class="{ active: activeTab === tab.id }"
              @click="activeTab = tab.id"
            >
              {{ tab.label }}
              <span v-if="tab.id === 'tasks'" class="pw-tab-count">{{ taskStats.total }}</span>
              <span v-if="tab.id === 'notes' && relatedNotes.length" class="pw-tab-count">{{ relatedNotes.length }}</span>
              <span v-if="tab.id === 'files' && documents.length" class="pw-tab-count">{{ documents.length }}</span>
            </button>
          </nav>

          <div class="pw-content">
            <div class="pw-content-inner">
              <template v-if="activeTab === 'overview'">
                <div class="pw-summary">
                  <div class="pw-donut" :style="donutStyle">
                    <div class="pw-donut-hole">
                      <strong>{{ taskStats.total }}</strong>
                      <span>总任务</span>
                    </div>
                  </div>
                  <div class="pw-legend">
                    <div class="pw-legend-row">
                      <span class="pw-legend-dot done"></span><span>已完成</span><strong>{{ taskStats.done }}</strong>
                    </div>
                    <div class="pw-legend-row">
                      <span class="pw-legend-dot doing"></span><span>进行中</span><strong>{{ taskStats.doing }}</strong>
                    </div>
                    <div class="pw-legend-row">
                      <span class="pw-legend-dot todo"></span><span>待办</span><strong>{{ taskStats.todo }}</strong>
                    </div>
                  </div>
                  <div class="pw-summary-side">
                    <span v-if="taskStats.overdue" class="pw-overdue-pill">{{ taskStats.overdue }} 项逾期</span>
                    <div class="pw-rate">
                      <strong>{{ donePercent }}%</strong>
                      <span>完成率</span>
                    </div>
                  </div>
                </div>

                <section class="pw-section">
                  <header class="pw-section-head">
                    <h2>项目简介</h2>
                    <button
                      v-if="descriptionLong"
                      type="button"
                      class="pw-link"
                      @click="descExpanded = !descExpanded"
                    >
                      {{ descExpanded ? '收起' : '展开' }}
                    </button>
                  </header>
                  <div ref="descRef" class="pw-section-body pw-text" :class="{ clamp: !descExpanded }">
                    {{ project.description || '暂无描述' }}
                  </div>
                </section>

                <section class="pw-section">
                  <header class="pw-section-head">
                    <h2>项目概况</h2>
                    <div v-if="editingOverview" class="pw-section-actions">
                      <button type="button" class="bm-btn bm-btn-ghost" @click="cancelOverviewEdit">取消</button>
                      <button type="button" class="bm-btn bm-btn-primary" @click="saveOverview">保存</button>
                    </div>
                    <button v-else type="button" class="pw-link" @click="startOverviewEdit">编辑</button>
                  </header>
                  <div class="pw-section-body">
                    <ProjectMarkdownEditor v-if="editingOverview" v-model="overviewDraft" placeholder="用 Markdown 记录项目概况..." />
                    <div v-else-if="project.overview" class="pw-markdown" v-html="overviewHtml"></div>
                    <p v-else class="pw-empty-text">暂无内容</p>
                  </div>
                </section>

                <section class="pw-section">
                  <header class="pw-section-head">
                    <h2>项目进展</h2>
                    <div v-if="editingProgress" class="pw-section-actions">
                      <button type="button" class="bm-btn bm-btn-ghost" @click="cancelProgressEdit">取消</button>
                      <button type="button" class="bm-btn bm-btn-primary" @click="saveProgress">保存</button>
                    </div>
                    <button v-else type="button" class="pw-link" @click="startProgressEdit">编辑</button>
                  </header>
                  <div class="pw-section-body">
                    <ProjectMarkdownEditor v-if="editingProgress" v-model="progressDraft" placeholder="用 Markdown 记录项目进展..." />
                    <div v-else-if="project.progress" class="pw-markdown" v-html="progressHtml"></div>
                    <p v-else class="pw-empty-text">暂无内容</p>
                  </div>
                </section>
              </template>

              <template v-else-if="activeTab === 'tasks'">
                <section class="pw-section">
                  <header class="pw-section-head">
                    <h2>任务</h2>
                    <span class="pw-section-count">{{ taskStats.total }}</span>
                    <button type="button" class="pw-link" @click="openTaskModal()">
                      <i class="fas fa-plus" aria-hidden="true"></i> 添加
                    </button>
                  </header>
                  <div v-if="sortedTasks.length" class="pw-section-body flush">
                    <div
                      v-for="task in sortedTasks"
                      :key="task.id"
                      class="pw-task-row"
                      @click="openTaskModal(task)"
                    >
                      <button
                        type="button"
                        class="pw-task-check"
                        :class="{ done: task.status === '已完成' }"
                        :aria-label="task.status === '已完成' ? '标记为待办' : '标记为完成'"
                        @click.stop="toggleTask(task)"
                      >
                        <i v-if="task.status === '已完成'" class="fas fa-check" aria-hidden="true"></i>
                      </button>
                      <span class="pw-task-name" :class="{ done: task.status === '已完成' }">{{ task.name }}</span>
                      <span v-if="task.priority === '高'" class="pw-badge high"><i class="fas fa-flag" aria-hidden="true"></i> 高</span>
                      <span v-if="task.due_date" class="pw-task-due" :class="dueClass(task)">{{ formatShortDate(task.due_date) }}</span>
                      <span v-if="task.assignee" class="pw-avatar" :title="task.assignee">{{ task.assignee.slice(-1) }}</span>
                    </div>
                    <button type="button" class="pw-add-row" @click="openTaskModal()">
                      <i class="fas fa-plus" aria-hidden="true"></i> 添加任务
                    </button>
                  </div>
                  <div v-else class="pw-section-body">
                    <p class="pw-empty-text">暂无任务</p>
                  </div>
                </section>
              </template>

              <template v-else-if="activeTab === 'notes'">
                <section class="pw-section">
                  <header class="pw-section-head">
                    <h2>相关便签</h2>
                    <span class="pw-section-count">{{ relatedNotes.length }}</span>
                    <button type="button" class="pw-link" @click="createProjectNote">
                      <i class="fas fa-plus" aria-hidden="true"></i> 新建关联便签
                    </button>
                  </header>
                  <div v-if="relatedNotes.length" class="pw-section-body flush">
                    <button
                      v-for="note in relatedNotes"
                      :key="note.id"
                      type="button"
                      class="pw-note-row"
                      :class="{ 'is-archived': note.is_archived }"
                      @click="openNote(note)"
                    >
                      <span class="pw-note-title-wrap">
                        <span class="pw-note-title">{{ note.title || '无标题' }}</span>
                        <span v-if="note.is_archived" class="pw-note-archived">已归档</span>
                      </span>
                      <span class="pw-note-preview">{{ renderNotePreview(note.content) }}</span>
                      <span class="pw-note-date">{{ formatDate(note.updated_at) }}</span>
                    </button>
                  </div>
                  <div v-else class="pw-section-body">
                    <p class="pw-empty-text">暂无关联便签</p>
                  </div>
                </section>
              </template>

              <template v-else-if="activeTab === 'files'">
                <section class="pw-section">
                  <header class="pw-section-head">
                    <h2>项目附件</h2>
                    <span class="pw-section-count">{{ documents.length }}</span>
                    <button type="button" class="pw-link" @click="triggerFileUpload">
                      <i class="fas fa-upload" aria-hidden="true"></i> 上传
                    </button>
                  </header>
                  <div v-if="documents.length" class="pw-section-body flush">
                    <div v-for="doc in documents" :key="doc.id" class="pw-file-row">
                      <i class="fas fa-file" aria-hidden="true"></i>
                      <span class="pw-file-name">{{ doc.original_filename }}</span>
                      <span class="pw-file-size">{{ formatSize(doc.file_size) }}</span>
                      <button type="button" class="pw-icon-btn" title="下载" @click="downloadDocument(doc.id)">
                        <i class="fas fa-download" aria-hidden="true"></i>
                      </button>
                      <button type="button" class="pw-icon-btn danger" title="删除" @click="deleteDocument(doc.id)">
                        <i class="fas fa-trash" aria-hidden="true"></i>
                      </button>
                    </div>
                  </div>
                  <div v-else class="pw-section-body">
                    <p class="pw-empty-text">暂无附件</p>
                  </div>
                </section>
              </template>
            </div>
          </div>
        </section>

        <section v-else class="pw-detail pw-detail-empty">
          <div class="pw-empty-state">
            <i class="fas fa-folder-open" aria-hidden="true"></i>
            <p>{{ projectStore.projects.length ? '选择左侧项目查看详情' : '还没有项目' }}</p>
            <button v-if="!projectStore.projects.length" type="button" class="bm-btn bm-btn-primary" @click="openCreateModal">
              创建第一个项目
            </button>
          </div>
        </section>
      </div>
    </div>

    <div v-if="showProjectModal" class="bm-modal-overlay show" @click.self="showProjectModal = false">
      <div class="bm-modal pw-modal">
        <div class="bm-modal-header">
          <h3>{{ editingProject ? '编辑项目' : '新建项目' }}</h3>
          <button type="button" class="bm-modal-close" @click="showProjectModal = false">&times;</button>
        </div>
        <div class="bm-modal-body">
          <div class="bm-form-group">
            <label class="bm-form-label">项目名称 *</label>
            <input v-model="projectForm.name" type="text" class="bm-form-control" required>
          </div>
          <div class="bm-form-group">
            <label class="bm-form-label">项目描述</label>
            <textarea v-model="projectForm.description" class="bm-form-control" rows="3"></textarea>
          </div>
          <div class="pw-form-grid">
            <div class="bm-form-group">
              <label class="bm-form-label">状态</label>
              <select v-model="projectForm.status" class="bm-form-control">
                <option value="未开始">未开始</option>
                <option value="进行中">进行中</option>
                <option value="已完成">已完成</option>
                <option value="已暂停">已暂停</option>
                <option value="已中止">已中止</option>
              </select>
            </div>
            <div class="bm-form-group">
              <label class="bm-form-label">优先级</label>
              <select v-model="projectForm.priority" class="bm-form-control">
                <option value="高">高</option>
                <option value="中">中</option>
                <option value="低">低</option>
              </select>
            </div>
          </div>
          <div class="pw-form-grid">
            <div class="bm-form-group">
              <label class="bm-form-label">开始日期</label>
              <input v-model="projectForm.start_date" type="date" class="bm-form-control">
            </div>
            <div class="bm-form-group">
              <label class="bm-form-label">截止日期</label>
              <div class="pw-inline-field">
                <input v-model="projectForm.due_date" type="date" class="bm-form-control" :disabled="isOngoing">
                <label class="pw-check-label"><input v-model="isOngoing" type="checkbox"> 至今</label>
              </div>
            </div>
          </div>
        </div>
        <div class="bm-modal-footer">
          <button type="button" class="bm-btn bm-btn-ghost" @click="showProjectModal = false">取消</button>
          <button type="button" class="bm-btn bm-btn-primary" @click="saveProject">保存</button>
        </div>
      </div>
    </div>

    <div v-if="showTaskModal" class="bm-modal-overlay show" @click.self="showTaskModal = false">
      <div class="bm-modal pw-modal">
        <div class="bm-modal-header">
          <h3>{{ editingTask ? '编辑任务' : '新建任务' }}</h3>
          <button type="button" class="bm-modal-close" @click="showTaskModal = false">&times;</button>
        </div>
        <div class="bm-modal-body">
          <div class="bm-form-group">
            <label class="bm-form-label">任务名称 *</label>
            <input v-model="taskForm.name" type="text" class="bm-form-control" required>
          </div>
          <div class="pw-form-grid">
            <div class="bm-form-group">
              <label class="bm-form-label">状态</label>
              <select v-model="taskForm.status" class="bm-form-control">
                <option value="待办">待办</option>
                <option value="进行中">进行中</option>
                <option value="已完成">已完成</option>
              </select>
            </div>
            <div class="bm-form-group">
              <label class="bm-form-label">优先级</label>
              <select v-model="taskForm.priority" class="bm-form-control">
                <option value="高">高</option>
                <option value="中">中</option>
                <option value="低">低</option>
              </select>
            </div>
          </div>
          <div class="bm-form-group">
            <label class="bm-form-label">负责人</label>
            <input v-model="taskForm.assignee" type="text" class="bm-form-control">
          </div>
          <div class="bm-form-group">
            <label class="bm-form-label">截止日期</label>
            <input v-model="taskForm.due_date" type="date" class="bm-form-control">
          </div>
        </div>
        <div class="bm-modal-footer">
          <button v-if="editingTask" type="button" class="bm-btn bm-btn-danger pw-modal-delete" @click="deleteTask">删除</button>
          <button type="button" class="bm-btn bm-btn-ghost" @click="showTaskModal = false">取消</button>
          <button type="button" class="bm-btn bm-btn-primary" @click="saveTask">保存</button>
        </div>
      </div>
    </div>

    <input ref="fileInput" type="file" class="pw-hidden-input" @change="handleFileUpload">
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { format, parseISO } from 'date-fns'
import { useProjectStore } from '@stores/project-store'
import { useTaskStore } from '@stores/task-store'
import { useNotepadStore } from '@stores/notepad-store'
import { useUndoStore } from '@stores/undo-store'
import { extractPreview, renderMarkdown } from '@utils/markdown.js'
import ProjectMarkdownEditor from '@components/project/ProjectMarkdownEditor.vue'

const route = useRoute()
const router = useRouter()
const projectStore = useProjectStore()
const taskStore = useTaskStore()
const notepadStore = useNotepadStore()
const undoStore = useUndoStore()

const STATUS_ORDER = ['进行中', '未开始', '已完成', '已暂停', '已中止']
const TABS = [
  { id: 'overview', label: '概览' },
  { id: 'tasks', label: '任务' },
  { id: 'notes', label: '便签' },
  { id: 'files', label: '文件' }
]
const COLLAPSED_KEY = 'bongmaster:project-rail:collapsed'
const LAST_PROJECT_KEY = 'bongmaster:projects:last-id'
const ACTIVE_TAB_KEY = 'bongmaster:projects:active-tab'

const readCollapsed = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '{}')
    return saved && typeof saved === 'object' ? saved : {}
  } catch {
    return {}
  }
}

const readLastProjectId = () => {
  try {
    const id = Number(localStorage.getItem(LAST_PROJECT_KEY))
    return Number.isInteger(id) && id > 0 ? id : null
  } catch {
    return null
  }
}

const readProjectTabs = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(ACTIVE_TAB_KEY) || '{}')
    return saved && typeof saved === 'object' ? saved : {}
  } catch {
    return {}
  }
}

const projectTabs = readProjectTabs()

const searchQuery = ref('')
const activeTab = ref('overview')
const descExpanded = ref(true)
const descRef = ref(null)
const descriptionLines = ref(0)
const collapsed = reactive(readCollapsed())

const project = ref(null)
const editingOverview = ref(false)
const editingProgress = ref(false)
const overviewDraft = ref('')
const progressDraft = ref('')

const showProjectModal = ref(false)
const editingProject = ref(null)
const isOngoing = ref(false)
const projectForm = ref({
  name: '',
  description: '',
  status: '未开始',
  priority: '中',
  start_date: '',
  due_date: ''
})

const showTaskModal = ref(false)
const editingTask = ref(null)
const taskForm = ref({
  name: '',
  status: '待办',
  priority: '中',
  assignee: '',
  due_date: '',
  project_id: null
})

const fileInput = ref(null)

const selectedId = computed(() => {
  const id = Number(route.params.id)
  return Number.isInteger(id) && id > 0 ? id : null
})

const projects = computed(() => projectStore.projects)
const doingCount = computed(() => projects.value.filter(item => item.status === '进行中').length)

const filteredProjects = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return projects.value
  return projects.value.filter(item => (
    String(item.name || '').toLowerCase().includes(query)
    || String(item.description || '').toLowerCase().includes(query)
  ))
})

const visibleGroups = computed(() => {
  const query = searchQuery.value.trim()
  return STATUS_ORDER
    .map(status => {
      const all = projects.value.filter(item => item.status === status)
      const matches = filteredProjects.value.filter(item => item.status === status)
      return {
        status,
        total: query ? matches.length : all.length,
        projects: query ? matches : all
      }
    })
    .filter(group => group.total > 0 && (!query || group.projects.length))
})

const isGroupCollapsed = status => Boolean(collapsed[status]) && !searchQuery.value.trim()
const toggleGroup = status => {
  collapsed[status] = !collapsed[status]
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify({ ...collapsed }))
  } catch {}
}
const statusClass = status => ({
  进行中: 'doing',
  未开始: 'todo',
  已完成: 'done',
  已暂停: 'paused',
  已中止: 'stopped'
}[status] || 'todo')

const taskStats = computed(() => {
  const tasks = project.value?.tasks || []
  const today = format(new Date(), 'yyyy-MM-dd')
  const done = tasks.filter(task => task.status === '已完成').length
  const doing = tasks.filter(task => task.status === '进行中').length
  return {
    total: tasks.length,
    doing,
    done,
    todo: Math.max(0, tasks.length - done - doing),
    overdue: tasks.filter(task => (
      task.status !== '已完成' && task.due_date && task.due_date < today
    )).length
  }
})

const donePercent = computed(() => {
  const { total, done } = taskStats.value
  return total ? Math.round((done / total) * 100) : 0
})

const donutStyle = computed(() => {
  const { total, done, doing } = taskStats.value
  const donePct = total ? (done / total) * 100 : 0
  const doingPct = total ? (doing / total) * 100 : 0
  const doingEnd = donePct + doingPct
  return {
    background: `conic-gradient(var(--bm-accent-teal) 0 ${donePct}%, var(--bm-accent-blue) ${donePct}% ${doingEnd}%, var(--bm-border-default) ${doingEnd}% 100%)`
  }
})

const sortedTasks = computed(() => {
  const order = { 进行中: 0, 待办: 1, 已完成: 2 }
  return [...(project.value?.tasks || [])].sort((a, b) => {
    const statusDelta = (order[a.status] ?? 1) - (order[b.status] ?? 1)
    if (statusDelta) return statusDelta
    if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date)
    if (a.due_date) return -1
    if (b.due_date) return 1
    return 0
  })
})

const relatedNotes = computed(() => project.value?.notes || [])
const documents = computed(() => project.value?.documents || [])

const descriptionLong = computed(() => descriptionLines.value > 3)

const measureDescription = () => {
  const el = descRef.value
  if (!el) {
    descriptionLines.value = 0
    return
  }
  const style = getComputedStyle(el)
  const lineHeight = parseFloat(style.lineHeight) || 20
  const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0)
  const contentHeight = Math.max(0, el.scrollHeight - padding)
  descriptionLines.value = Math.max(1, Math.round(contentHeight / lineHeight))
}
const overviewHtml = computed(() => renderMarkdown(String(project.value?.overview || '')))
const progressHtml = computed(() => renderMarkdown(String(project.value?.progress || '')))

const projectRange = computed(() => {
  if (!project.value) return ''
  const start = project.value.start_date ? formatDate(project.value.start_date) : ''
  const ongoing = project.value.is_ongoing || !project.value.due_date
  const due = project.value.due_date ? formatDate(project.value.due_date) : ''
  if (!start && !due) return ongoing ? '至今' : '未设置时间线'
  if (!start) return ongoing ? '至今' : due
  if (ongoing) return `${start} → 至今`
  return due ? `${start} → ${due}` : start
})

const formatDate = value => {
  if (!value) return ''
  try {
    return format(parseISO(String(value).replace(' ', 'T')), 'yyyy-MM-dd')
  } catch {
    return String(value)
  }
}

const formatShortDate = value => {
  if (!value) return ''
  try {
    return format(parseISO(value), 'MM-dd')
  } catch {
    return value
  }
}

const relativeDate = value => {
  if (!value) return ''
  const date = new Date(String(value).replace(' ', 'T'))
  if (Number.isNaN(date.getTime())) return formatDate(value)
  const today = new Date()
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const days = Math.round((start - target) / 86400000)
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  if (days < 7) return `${days} 天前`
  return format(date, 'yyyy-MM-dd')
}

const dueClass = task => {
  if (!task.due_date || task.status === '已完成') return ''
  const today = format(new Date(), 'yyyy-MM-dd')
  if (task.due_date < today) return 'overdue'
  if (task.due_date === today) return 'today'
  return 'future'
}

const renderNotePreview = content => extractPreview(content || '', 80) || '无内容'
const formatSize = bytes => {
  const value = Number(bytes || 0)
  if (!value) return ''
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

const selectProject = id => {
  if (id === selectedId.value) return
  router.replace({ name: 'Projects', params: { id } })
}

const loadProject = async id => {
  if (!id) {
    project.value = null
    return
  }
  const loaded = await projectStore.fetchProjectById(id)
  project.value = loaded || null
}

const ensureSelection = async () => {
  if (!projects.value.length) {
    project.value = null
    return
  }
  if (selectedId.value && projects.value.some(item => item.id === selectedId.value)) return
  const lastId = readLastProjectId()
  const lastProject = lastId ? projects.value.find(item => item.id === lastId) : null
  const first = lastProject
    || projects.value.find(item => item.status === '进行中')
    || projects.value[0]
  if (first) await router.replace({ name: 'Projects', params: { id: first.id } })
}

const openCreateModal = () => {
  editingProject.value = null
  projectForm.value = {
    name: '',
    description: '',
    status: '未开始',
    priority: '中',
    start_date: '',
    due_date: ''
  }
  isOngoing.value = false
  showProjectModal.value = true
}

const openEditModal = () => {
  if (!project.value) return
  editingProject.value = project.value
  projectForm.value = {
    name: project.value.name || '',
    description: project.value.description || '',
    status: project.value.status || '未开始',
    priority: project.value.priority || '中',
    start_date: project.value.start_date || '',
    due_date: project.value.due_date || '',
    overview: project.value.overview || '',
    progress: project.value.progress || ''
  }
  isOngoing.value = Boolean(project.value.is_ongoing || !project.value.due_date)
  showProjectModal.value = true
}

const saveProject = async () => {
  if (!projectForm.value.name.trim()) {
    alert('请输入项目名称')
    return
  }
  const payload = { ...projectForm.value, is_ongoing: isOngoing.value }
  if (isOngoing.value) payload.due_date = ''
  if (editingProject.value) {
    const updated = await projectStore.updateProject(editingProject.value.id, payload)
    if (!updated) return
    showProjectModal.value = false
    await loadProject(updated.id)
    await projectStore.fetchProjects()
    return
  }
  const created = await projectStore.createProject(payload)
  if (!created) return
  showProjectModal.value = false
  await projectStore.fetchProjects()
  await router.replace({ name: 'Projects', params: { id: created.id } })
}

const deleteProject = async () => {
  if (!project.value) return
  if (!confirm('确定要删除这个项目吗？所有相关任务和附件也会被删除。')) return
  const projectId = project.value.id
  const snapshot = await window.electronAPI.getProjectById(projectId)
  if (!snapshot) return
  const undoSnapshot = {
    id: projectId,
    name: snapshot.name,
    taskIds: (snapshot.tasks || []).map(item => item.id),
    documentIds: (snapshot.documents || []).map(item => item.id),
    noteIds: (snapshot.notes || []).map(item => item.id)
  }
  const deleted = await projectStore.deleteProject(projectId)
  if (!deleted) return
  await projectStore.fetchProjects()
  const next = projects.value.find(item => item.status === '进行中') || projects.value[0]
  if (next) await router.replace({ name: 'Projects', params: { id: next.id } })
  else await router.replace({ name: 'Projects' })
  undoStore.showUndo({
    message: `已删除项目「${undoSnapshot.name || '未命名'}」`,
    undo: () => projectStore.restoreProject(undoSnapshot)
  })
}

const openTaskModal = (task = null) => {
  if (task && task.id) {
    editingTask.value = task
    taskForm.value = { ...task }
  } else {
    editingTask.value = null
    taskForm.value = {
      name: '',
      status: '待办',
      priority: '中',
      assignee: '',
      due_date: '',
      project_id: project.value?.id || null
    }
  }
  showTaskModal.value = true
}

const saveTask = async () => {
  if (!taskForm.value.name.trim()) {
    alert('请输入任务名称')
    return
  }
  const payload = {
    ...taskForm.value,
    project_id: project.value?.id ?? taskForm.value.project_id
  }
  if (!payload.project_id) return
  if (editingTask.value) await taskStore.updateTask(editingTask.value.id, payload)
  else await taskStore.createTask(payload)
  showTaskModal.value = false
  await loadProject(project.value.id)
  await projectStore.fetchProjects()
}

const deleteTask = async () => {
  if (!editingTask.value) return
  if (!confirm('确定要删除这个任务吗？')) return
  const task = { ...editingTask.value }
  const deleted = await taskStore.deleteTask(task.id)
  showTaskModal.value = false
  await loadProject(project.value.id)
  await projectStore.fetchProjects()
  if (!deleted) return
  undoStore.showUndo({
    message: `已删除任务「${task.name || '未命名'}」`,
    undo: async () => {
      await taskStore.restoreTask(task)
      if (route.name === 'Projects' && selectedId.value) await loadProject(selectedId.value)
      await projectStore.fetchProjects()
    }
  })
}

const toggleTask = async task => {
  const nextStatus = task.status === '已完成' ? '待办' : '已完成'
  await taskStore.updateTask(task.id, { ...task, status: nextStatus })
  await loadProject(project.value.id)
  await projectStore.fetchProjects()
}

const htmlToMarkdown = html => {
  const source = String(html || '')
  if (!source || !/<[a-z][\s\S]*>/i.test(source)) return source

  const doc = new DOMParser().parseFromString(source, 'text/html')
  const render = node => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.nodeValue.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ')
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    const tag = node.tagName.toLowerCase()
    const children = [...node.childNodes].map(render).join('')
    switch (tag) {
      case 'h1': return `# ${children.trim()}\n\n`
      case 'h2': return `## ${children.trim()}\n\n`
      case 'h3': return `### ${children.trim()}\n\n`
      case 'h4': return `#### ${children.trim()}\n\n`
      case 'h5': return `##### ${children.trim()}\n\n`
      case 'h6': return `###### ${children.trim()}\n\n`
      case 'p':
      case 'div': return `${children.trim()}\n\n`
      case 'br': return '\n'
      case 'strong':
      case 'b': return `**${children.trim()}**`
      case 'em':
      case 'i': return `*${children.trim()}*`
      case 's':
      case 'strike':
      case 'del': return `~~${children.trim()}~~`
      case 'u': return `<ins>${children.trim()}</ins>`
      case 'a': return `[${children.trim()}](${node.getAttribute('href') || ''})`
      case 'img': return `![${node.getAttribute('alt') || ''}](${node.getAttribute('src') || ''})`
      case 'code': return `\`${children}\``
      case 'pre': return `\`\`\`\n${node.textContent.trim()}\n\`\`\`\n\n`
      case 'blockquote': return `${children.trim().split('\n').filter(Boolean).map(line => `> ${line}`).join('\n')}\n\n`
      case 'ul': return `${[...node.children].map(li => `- ${[...li.childNodes].map(render).join('').trim()}`).join('\n')}\n\n`
      case 'ol': return `${[...node.children].map((li, index) => `${index + 1}. ${[...li.childNodes].map(render).join('').trim()}`).join('\n')}\n\n`
      case 'li': return children
      case 'mark': return `<mark>${children}</mark>`
      case 'script':
      case 'style': return ''
      default: return children
    }
  }

  return [...doc.body.childNodes].map(render).join('').replace(/\n{3,}/g, '\n\n').trim()
}

const toMarkdown = value => {
  const source = String(value || '')
  return /<[a-z][\s\S]*>/i.test(source) ? htmlToMarkdown(source) : source
}

const startOverviewEdit = () => {
  overviewDraft.value = toMarkdown(project.value?.overview || '')
  editingOverview.value = true
}

const cancelOverviewEdit = () => {
  editingOverview.value = false
  overviewDraft.value = ''
}

const saveOverview = async () => {
  const updated = await projectStore.updateProject(project.value.id, {
    overview: overviewDraft.value
  })
  if (updated) project.value = updated
  editingOverview.value = false
  overviewDraft.value = ''
}

const startProgressEdit = () => {
  progressDraft.value = toMarkdown(project.value?.progress || '')
  editingProgress.value = true
}

const cancelProgressEdit = () => {
  editingProgress.value = false
  progressDraft.value = ''
}

const saveProgress = async () => {
  const updated = await projectStore.updateProject(project.value.id, {
    progress: progressDraft.value
  })
  if (updated) project.value = updated
  editingProgress.value = false
  progressDraft.value = ''
}

const openNote = note => {
  router.push({ name: 'Notepad', query: { noteId: note.id } })
}

const createProjectNote = async () => {
  if (!project.value) return
  const note = await notepadStore.createNote({
    title: '',
    content: '',
    project_ids: [project.value.id]
  })
  if (note) {
    await loadProject(project.value.id)
    openNote(note)
  }
}

const triggerFileUpload = () => fileInput.value?.click()

const handleFileUpload = async event => {
  const file = event.target.files?.[0]
  if (!file || !project.value) return
  const arrayBuffer = await file.arrayBuffer()
  await window.electronAPI.uploadDocument(project.value.id, {
    name: file.name,
    size: file.size,
    type: file.type,
    data: Array.from(new Uint8Array(arrayBuffer))
  })
  await loadProject(project.value.id)
  event.target.value = ''
}

const downloadDocument = async documentId => {
  const doc = await window.electronAPI.downloadDocument(documentId)
  if (!doc) return
  const blob = new Blob([new Uint8Array(doc.data)], { type: doc.mime_type || 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = doc.original_filename
  a.click()
  URL.revokeObjectURL(url)
}

const deleteDocument = async documentId => {
  if (!confirm('确定要删除这个附件吗？')) return
  await window.electronAPI.deleteDocument(documentId)
  await loadProject(project.value.id)
}

watch(selectedId, async id => {
  descExpanded.value = true
  editingOverview.value = false
  editingProgress.value = false
  if (!id) {
    await ensureSelection()
    return
  }
  activeTab.value = TABS.some(tab => tab.id === projectTabs[id]) ? projectTabs[id] : 'overview'
  try {
    localStorage.setItem(LAST_PROJECT_KEY, String(id))
  } catch {}
  await loadProject(id)
}, { immediate: true })

watch(() => project.value?.id, async () => {
  await nextTick()
  measureDescription()
})

watch(activeTab, async tab => {
  const id = selectedId.value
  if (id) {
    projectTabs[id] = tab
    try {
      localStorage.setItem(ACTIVE_TAB_KEY, JSON.stringify(projectTabs))
    } catch {}
  }
  if (tab === 'overview') {
    await nextTick()
    measureDescription()
    return
  }
  if (editingOverview.value) cancelOverviewEdit()
  if (editingProgress.value) cancelProgressEdit()
})

onMounted(async () => {
  window.addEventListener('resize', measureDescription)
  await projectStore.fetchProjects()
  await ensureSelection()
  await nextTick()
  measureDescription()
})

onUnmounted(() => {
  window.removeEventListener('resize', measureDescription)
})
</script>

<style scoped>
.project-workspace-page {
  display: flex;
  flex-direction: column;
  max-width: 1440px;
  height: calc(100vh - var(--bm-navbar-height));
  padding: 12px 18px 16px;
}

.pw-shell {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--bm-border-default);
  border-radius: 12px;
  background: var(--bm-bg-card);
  box-shadow: var(--bm-shadow-sm);
}

.pw-toolbar {
  display: flex;
  align-items: center;
  flex: 0 0 46px;
  gap: 10px;
  padding: 0 12px;
  border-bottom: 1px solid var(--bm-border-subtle);
}

.pw-toolbar-title {
  display: flex;
  align-items: baseline;
  gap: 9px;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.02em;
  white-space: nowrap;
}

.pw-toolbar-sub {
  color: var(--bm-text-muted);
  font-size: 11.5px;
  font-weight: 400;
  letter-spacing: 0;
}

.pw-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

.pw-new-btn {
  height: 29px;
  padding: 0 12px;
  border-radius: 8px;
  font-size: 12.5px;
}

.pw-search {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 190px;
  height: 29px;
  padding: 0 9px;
  border: 1px solid var(--bm-border-default);
  border-radius: 8px;
  background: var(--bm-bg-card);
  color: var(--bm-text-muted);
}

.pw-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--bm-text-primary);
  font: inherit;
  font-size: 12px;
}

.pw-search-clear {
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

.pw-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.pw-rail {
  display: flex;
  flex-direction: column;
  flex: 0 0 300px;
  width: 300px;
  padding: 8px 10px 12px;
  overflow: auto;
  border-right: 1px solid var(--bm-border-subtle);
  background: var(--bm-bg-sidebar);
}

.pw-group + .pw-group { margin-top: 2px; }

.pw-group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 30px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--bm-text-secondary);
  font: inherit;
  font-size: 11.5px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.pw-group-head:hover { background: var(--bm-bg-hover); }
.pw-group-head .fas { width: 9px; color: var(--bm-text-tertiary); font-size: 9px; }
.pw-group-count { margin-left: auto; color: var(--bm-text-muted); font-size: 11px; font-weight: 400; }

.pw-rail-list { display: flex; flex-direction: column; gap: 1px; }

.pw-rail-row {
  display: block;
  width: 100%;
  padding: 6px 9px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--bm-text-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.pw-rail-row:hover { background: var(--bm-bg-hover); }
.pw-rail-row.active { background: var(--bm-bg-active); }

.pw-rail-title-line { display: flex; align-items: center; gap: 6px; min-width: 0; }
.pw-rail-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 12.5px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pw-rail-flag { flex: 0 0 auto; color: var(--bm-accent-danger); font-size: 9px; }
.pw-rail-count { color: var(--bm-text-muted); font-size: 10.5px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.pw-rail-sub { display: flex; align-items: center; gap: 6px; min-width: 0; margin-top: 1px; }
.pw-rail-desc {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--bm-text-muted);
  font-size: 10.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pw-rail-overdue { color: var(--bm-accent-danger); font-size: 9.5px; white-space: nowrap; }
.pw-rail-updated { color: var(--bm-text-tertiary); font-size: 9.5px; white-space: nowrap; }
.pw-rail-empty { padding: 4px 8px 8px; color: var(--bm-text-tertiary); font-size: 11px; }

.pw-detail { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }

.pw-detail-head { flex: 0 0 auto; padding: 14px 18px 10px; border-bottom: 1px solid var(--bm-border-subtle); }
.pw-title-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.pw-title {
  min-width: 0;
  overflow: hidden;
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.02em;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pw-head-actions { display: flex; align-items: center; gap: 4px; margin-left: auto; }
.pw-head-actions .bm-btn { height: 28px; padding: 0 9px; gap: 5px; font-size: 12.5px; }
.pw-head-actions .bm-btn .fas { font-size: 11px; }
.pw-danger { color: var(--bm-accent-danger); }
.pw-detail-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 5px;
  color: var(--bm-text-muted);
  font-size: 11px;
}
.pw-meta-sep { color: var(--bm-text-tertiary); }

.pw-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 19px;
  padding: 0 7px;
  border-radius: 5px;
  font-size: 10.5px;
  font-weight: 500;
  white-space: nowrap;
}
.pw-badge.doing { background: rgba(46, 170, 220, 0.1); color: #1d7fa6; }
.pw-badge.todo { background: rgba(55, 53, 47, 0.06); color: var(--bm-text-secondary); }
.pw-badge.done { background: rgba(18, 128, 92, 0.1); color: #0f7b6c; }
.pw-badge.paused { background: rgba(224, 155, 61, 0.14); color: #a06a1f; }
.pw-badge.stopped { background: rgba(55, 53, 47, 0.07); color: var(--bm-text-muted); }
.pw-badge.high { background: rgba(217, 95, 82, 0.1); color: var(--bm-accent-danger); }
.pw-badge .fas { font-size: 9px; }

.pw-tabs {
  display: flex;
  gap: 2px;
  flex: 0 0 auto;
  padding: 0 16px;
  border-bottom: 1px solid var(--bm-border-subtle);
}
.pw-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 35px;
  padding: 0 10px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--bm-text-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.pw-tab:hover { color: var(--bm-text-primary); }
.pw-tab.active { color: var(--bm-text-primary); border-bottom-color: var(--bm-accent); font-weight: 600; }
.pw-tab-count {
  padding: 1px 5px;
  border-radius: 999px;
  background: var(--bm-bg-hover);
  color: var(--bm-text-muted);
  font-size: 9.5px;
  font-weight: 500;
}

.pw-content { flex: 1; min-height: 0; overflow: auto; }
.pw-content-inner { max-width: 1000px; padding: 14px 18px 24px; }

.pw-summary {
  display: flex;
  align-items: center;
  gap: 20px;
  width: 100%;
  margin-bottom: 12px;
  padding: 10px 18px;
  border: 1px solid var(--bm-border-default);
  border-radius: 10px;
  background: var(--bm-bg-card);
}
.pw-donut { position: relative; flex: 0 0 auto; width: 88px; height: 88px; border-radius: 50%; }
.pw-donut-hole {
  position: absolute;
  inset: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--bm-bg-card);
}
.pw-donut-hole strong { font-size: 20px; font-weight: 700; line-height: 1; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.pw-donut-hole span { margin-top: 2px; color: var(--bm-text-muted); font-size: 9px; }
.pw-legend { display: flex; align-items: center; flex-wrap: wrap; flex: 1; gap: 24px; min-width: 0; }
.pw-legend-row { display: flex; align-items: center; gap: 6px; color: var(--bm-text-secondary); font-size: 11.5px; }
.pw-legend-row strong { margin-left: 2px; color: var(--bm-text-primary); font-size: 13px; font-variant-numeric: tabular-nums; }
.pw-legend-dot { flex: 0 0 auto; width: 7px; height: 7px; border-radius: 50%; }
.pw-legend-dot.done { background: var(--bm-accent-teal); }
.pw-legend-dot.doing { background: var(--bm-accent-blue); }
.pw-legend-dot.todo { background: var(--bm-border-default); }

.pw-summary-side { display: flex; align-items: center; gap: 14px; flex: 0 0 auto; margin-left: auto; }
.pw-overdue-pill {
  padding: 3px 8px;
  border-radius: 5px;
  background: rgba(217, 95, 82, 0.1);
  color: var(--bm-accent-danger);
  font-size: 10.5px;
  white-space: nowrap;
}
.pw-rate { display: flex; flex-direction: column; align-items: flex-end; line-height: 1.1; }
.pw-rate strong { font-size: 18px; font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.pw-rate span { margin-top: 2px; color: var(--bm-text-muted); font-size: 9.5px; }

.pw-section {
  margin-bottom: 12px;
  overflow: hidden;
  border: 1px solid var(--bm-border-default);
  border-radius: 10px;
  background: var(--bm-bg-card);
}
.pw-section-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 0 12px;
  border-bottom: 1px solid var(--bm-border-subtle);
}
.pw-section-head h2 { margin: 0; font-size: 12.5px; font-weight: 600; }
.pw-section-count { color: var(--bm-text-muted); font-size: 10.5px; }
.pw-section-actions { display: flex; align-items: center; gap: 4px; margin-left: auto; }
.pw-section-body { padding: 9px 12px 11px; }
.pw-section-body.flush { padding: 0; }
.pw-section-head .pw-link { margin-left: auto; }

.pw-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--bm-accent-blue);
  font: inherit;
  font-size: 11.5px;
  cursor: pointer;
}
.pw-link:hover { text-decoration: underline; }

.pw-text { color: var(--bm-text-secondary); font-size: 12.5px; line-height: 1.65; white-space: pre-wrap; }
.pw-text.clamp {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}
.pw-empty-text { margin: 0; color: var(--bm-text-muted); font-size: 12px; }

.pw-markdown { color: var(--bm-text-secondary); font-size: 12.5px; line-height: 1.7; }
.pw-markdown :deep(h1),
.pw-markdown :deep(h2),
.pw-markdown :deep(h3),
.pw-markdown :deep(h4) {
  margin: 14px 0 6px;
  color: var(--bm-text-primary);
  font-weight: 600;
  line-height: 1.35;
}
.pw-markdown :deep(h1) { font-size: 19px; }
.pw-markdown :deep(h2) { font-size: 16px; }
.pw-markdown :deep(h3) { font-size: 14px; }
.pw-markdown :deep(h4) { font-size: 13px; }
.pw-markdown :deep(p) { margin: 0 0 8px; }
.pw-markdown :deep(ul),
.pw-markdown :deep(ol) { margin: 4px 0 10px; padding-left: 20px; }
.pw-markdown :deep(li) { margin: 2px 0; }
.pw-markdown :deep(blockquote) {
  margin: 8px 0;
  padding: 4px 10px;
  border-left: 3px solid var(--bm-border-strong);
  color: var(--bm-text-muted);
}
.pw-markdown :deep(a) { color: var(--bm-accent-blue); }
.pw-markdown :deep(code) {
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--bm-bg-hover);
  font-family: var(--bm-font-mono);
  font-size: 11.5px;
}
.pw-markdown :deep(pre) {
  margin: 8px 0;
  padding: 9px 11px;
  overflow: auto;
  border-radius: 7px;
  background: var(--bm-bg-sidebar);
}
.pw-markdown :deep(pre code) { padding: 0; background: transparent; }
.pw-markdown :deep(table) { width: 100%; margin: 8px 0; border-collapse: collapse; }
.pw-markdown :deep(th),
.pw-markdown :deep(td) { padding: 4px 8px; border: 1px solid var(--bm-border-default); text-align: left; }
.pw-markdown :deep(img) { max-width: 100%; border-radius: 6px; }
.pw-markdown :deep(hr) { margin: 12px 0; border: 0; border-top: 1px solid var(--bm-border-subtle); }

.pw-task-row {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 39px;
  padding: 0 12px;
  border-bottom: 1px solid var(--bm-border-subtle);
  cursor: pointer;
}
.pw-task-row:last-of-type { border-bottom: 0; }
.pw-task-row:hover { background: var(--bm-bg-hover); }
.pw-task-check {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 1.4px solid var(--bm-border-strong);
  border-radius: 50%;
  background: transparent;
  color: #fff;
  font-size: 8px;
  cursor: pointer;
}
.pw-task-check.done { border-color: var(--bm-accent-teal); background: var(--bm-accent-teal); }
.pw-task-name { flex: 1; min-width: 0; overflow: hidden; font-size: 12.5px; text-overflow: ellipsis; white-space: nowrap; }
.pw-task-name.done { color: var(--bm-text-muted); text-decoration: line-through; }
.pw-task-due { color: var(--bm-text-muted); font-size: 10.5px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.pw-task-due.overdue { color: var(--bm-accent-danger); }
.pw-task-due.today { color: var(--bm-accent-orange); }
.pw-add-row {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  height: 34px;
  padding: 0 12px;
  border: 0;
  background: transparent;
  color: var(--bm-text-muted);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.pw-add-row:hover { color: var(--bm-text-primary); background: var(--bm-bg-hover); }
.pw-avatar {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--bm-bg-hover);
  color: var(--bm-text-secondary);
  font-size: 9px;
  font-weight: 600;
}

.pw-note-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 2px 10px;
  width: 100%;
  padding: 8px 12px;
  border: 0;
  border-bottom: 1px solid var(--bm-border-subtle);
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.pw-note-row:last-child { border-bottom: 0; }
.pw-note-row:hover { background: var(--bm-bg-hover); }
.pw-note-row.is-archived { opacity: 0.68; }
.pw-note-title-wrap { min-width: 0; display: flex; align-items: center; gap: 6px; overflow: hidden; }
.pw-note-title { min-width: 0; overflow: hidden; font-size: 12.5px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.pw-note-archived { flex: 0 0 auto; padding: 1px 5px; border-radius: 999px; background: var(--bm-bg-hover); color: var(--bm-text-muted); font-size: 9.5px; font-weight: 500; }
.pw-note-preview { grid-column: 1 / -1; overflow: hidden; color: var(--bm-text-muted); font-size: 10.5px; text-overflow: ellipsis; white-space: nowrap; }
.pw-note-date { color: var(--bm-text-tertiary); font-size: 10px; white-space: nowrap; }

.pw-file-row { display: flex; align-items: center; gap: 8px; height: 38px; padding: 0 12px; border-bottom: 1px solid var(--bm-border-subtle); font-size: 12px; }
.pw-file-row:last-child { border-bottom: 0; }
.pw-file-row .fa-file { color: var(--bm-text-muted); }
.pw-file-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pw-file-size { color: var(--bm-text-tertiary); font-size: 10px; }
.pw-icon-btn {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--bm-text-muted);
  cursor: pointer;
}
.pw-icon-btn:hover { background: var(--bm-bg-hover); color: var(--bm-text-primary); }
.pw-icon-btn.danger:hover { color: var(--bm-accent-danger); }

.pw-detail-empty { align-items: center; justify-content: center; }
.pw-empty-state { display: flex; flex-direction: column; align-items: center; gap: 10px; color: var(--bm-text-muted); font-size: 13px; }
.pw-empty-state .fas { font-size: 28px; color: var(--bm-text-tertiary); }

.pw-modal { width: min(520px, calc(100vw - 48px)); }
.pw-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.pw-inline-field { display: flex; align-items: center; gap: 8px; }
.pw-check-label { display: inline-flex; align-items: center; gap: 4px; color: var(--bm-text-secondary); font-size: 12px; white-space: nowrap; }
.pw-modal-delete { margin-right: auto; }
.pw-hidden-input { display: none; }

@media (max-width: 1100px) {
  .pw-rail { flex-basis: 260px; width: 260px; }
  .pw-content-inner { max-width: none; }
}
</style>
