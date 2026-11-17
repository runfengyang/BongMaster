<template>
  <div class="fade-in bm-page project-list-page">
    <!-- Page Header -->
    <div class="bm-page-header">
      <h1>项目管理</h1>
      <button class="bm-btn bm-btn-primary" @click="openCreateModal">
        <i class="fas fa-plus"></i> 新建项目
      </button>
    </div>

    <!-- Filters -->
    <div class="bm-filters">
      <input
        type="text"
        class="bm-form-control"
        placeholder="搜索项目..."
        v-model="searchQuery"
      >
      <select class="bm-form-control" v-model="statusFilter">
        <option value="">所有状态</option>
        <option value="未开始">未开始</option>
        <option value="进行中">进行中</option>
        <option value="已完成">已完成</option>
        <option value="已暂停">已暂停</option>
      </select>
      <select class="bm-form-control" v-model="priorityFilter">
        <option value="">所有优先级</option>
        <option value="高">高</option>
        <option value="中">中</option>
        <option value="低">低</option>
      </select>
      <button class="bm-btn bm-btn-ghost" @click="clearFilters">
        <i class="fas fa-times"></i> 清除
      </button>
    </div>

    <!-- Projects Grid -->
    <div class="bm-grid bm-grid-3">
      <router-link
        v-for="project in filteredProjects"
        :key="project.id"
        :to="`/projects/${project.id}`"
        class="bm-project-card"
      >
        <div class="bm-project-header">
          <h3 class="bm-project-title">{{ project.name }}</h3>
          <p class="bm-project-desc">{{ project.description || '暂无描述' }}</p>
        </div>
        <div class="bm-project-footer">
          <div class="bm-project-badges">
            <span class="bm-badge" :class="getStatusBadge(project.status)">{{ project.status }}</span>
            <span class="bm-badge" :class="getPriorityBadge(project.priority)">{{ project.priority }}</span>
          </div>
          <div class="bm-project-meta">
            <i class="fas fa-tasks"></i>
            <span>{{ project.task_count }}</span>
          </div>
        </div>
        <div class="bm-project-date">{{ formatProjectDateRange(project) }}</div>
      </router-link>
    </div>

    <!-- Empty State -->
    <div v-if="filteredProjects.length === 0" class="bm-empty">
      <i class="fas fa-folder-open bm-empty-icon"></i>
      <p>暂无项目</p>
      <button class="bm-btn bm-btn-primary" @click="openCreateModal" style="margin-top: var(--bm-space-md);">
        创建第一个项目
      </button>
    </div>

    <!-- Create/Edit Modal -->
    <div class="bm-modal-overlay" :class="{ show: showModal }" @click.self="showModal = false">
      <div class="bm-modal">
        <div class="bm-modal-header">
          <h3>{{ editingProject ? '编辑项目' : '新建项目' }}</h3>
          <button type="button" class="bm-modal-close" @click="showModal = false">&times;</button>
        </div>
        <div class="bm-modal-body">
          <div class="bm-form-group">
            <label class="bm-form-label">项目名称 *</label>
            <input type="text" class="bm-form-control" v-model="projectForm.name" required>
          </div>
          <div class="bm-form-group">
            <label class="bm-form-label">项目描述</label>
            <textarea class="bm-form-control" v-model="projectForm.description" rows="3"></textarea>
          </div>
          <div class="bm-grid bm-grid-2">
            <div class="bm-form-group">
              <label class="bm-form-label">状态</label>
              <select class="bm-form-control" v-model="projectForm.status">
                <option value="未开始">未开始</option>
                <option value="进行中">进行中</option>
                <option value="已完成">已完成</option>
                <option value="已暂停">已暂停</option>
              </select>
            </div>
            <div class="bm-form-group">
              <label class="bm-form-label">优先级</label>
              <select class="bm-form-control" v-model="projectForm.priority">
                <option value="高">高</option>
                <option value="中">中</option>
                <option value="低">低</option>
              </select>
            </div>
          </div>
          <div class="bm-grid bm-grid-2">
            <div class="bm-form-group">
              <label class="bm-form-label">开始日期</label>
              <input type="date" class="bm-form-control" v-model="projectForm.start_date">
            </div>
            <div class="bm-form-group">
              <label class="bm-form-label">截止日期</label>
              <div style="display: flex; align-items: center; gap: var(--bm-space-sm);">
                <input
                  type="date"
                  class="bm-form-control"
                  v-model="projectForm.due_date"
                  :disabled="isOngoing"
                  style="flex: 1;"
                >
                <label style="display: flex; align-items: center; gap: var(--bm-space-xs); font-size: 0.8125rem; color: var(--bm-text-secondary); white-space: nowrap;">
                  <input type="checkbox" v-model="isOngoing"> 至今
                </label>
              </div>
            </div>
          </div>
        </div>
        <div class="bm-modal-footer">
          <button type="button" class="bm-btn bm-btn-ghost" @click="showModal = false">取消</button>
          <button type="button" class="bm-btn bm-btn-primary" @click="saveProject">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useProjectStore } from '@stores/project-store'
import { format, parseISO } from 'date-fns'

const projectStore = useProjectStore()

const FILTER_KEY = 'bongmaster-project-filters'

const loadFilters = () => {
  try {
    const saved = localStorage.getItem(FILTER_KEY)
    if (saved) return JSON.parse(saved)
  } catch (e) { /* ignore */ }
  return { search: '', status: '', priority: '' }
}

const savedFilters = loadFilters()

const searchQuery = ref(savedFilters.search)
const statusFilter = ref(savedFilters.status)
const priorityFilter = ref(savedFilters.priority)
const showModal = ref(false)
const editingProject = ref(null)
const isOngoing = ref(false)

watch([searchQuery, statusFilter, priorityFilter], () => {
  localStorage.setItem(FILTER_KEY, JSON.stringify({
    search: searchQuery.value,
    status: statusFilter.value,
    priority: priorityFilter.value
  }))
}, { deep: true })

const projectForm = ref({
  name: '',
  description: '',
  status: '未开始',
  priority: '中',
  start_date: '',
  due_date: ''
})

const filteredProjects = computed(() => {
  let result = projectStore.projects
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.description && p.description.toLowerCase().includes(q))
    )
  }
  if (statusFilter.value) {
    result = result.filter(p => p.status === statusFilter.value)
  }
  if (priorityFilter.value) {
    result = result.filter(p => p.priority === priorityFilter.value)
  }
  return result
})

const formatProjectDateRange = (project) => {
  const startDate = project.start_date ? formatDate(project.start_date) : null
  const dueDate = project.due_date ? formatDate(project.due_date) : null
  const isOngoing = project.is_ongoing

  if (!startDate && !dueDate && !isOngoing) return ''
  if (!startDate) return isOngoing ? '至今' : dueDate || ''
  if (isOngoing) return `${startDate} - 至今`
  if (!dueDate) return startDate
  return `${startDate} - ${dueDate}`
}

const formatDate = (dateStr) => {
  if (!dateStr) return ''
  try {
    return format(parseISO(dateStr), 'yyyy-MM-dd')
  } catch { return dateStr }
}

const getStatusBadge = (status) => ({
  '已完成': 'bm-badge-emerald',
  '进行中': 'bm-badge-blue',
  '未开始': 'bm-badge-slate',
  '已暂停': 'bm-badge-amber'
}[status] || 'bm-badge-slate')

const getPriorityBadge = (priority) => ({
  '高': 'bm-badge-red',
  '中': 'bm-badge-amber',
  '低': 'bm-badge-blue'
}[priority] || 'bm-badge-blue')

const clearFilters = () => {
  searchQuery.value = ''
  statusFilter.value = ''
  priorityFilter.value = ''
}

const openCreateModal = () => {
  editingProject.value = null
  projectForm.value = { name: '', description: '', status: '未开始', priority: '中', start_date: '', due_date: '' }
  isOngoing.value = false
  showModal.value = true
}

const saveProject = async () => {
  if (!projectForm.value.name) {
    alert('请输入项目名称')
    return
  }
  const data = { ...projectForm.value, is_ongoing: isOngoing.value }
  if (isOngoing.value) data.due_date = ''

  let result
  if (editingProject.value) {
    result = await projectStore.updateProject(editingProject.value.id, data)
  } else {
    result = await projectStore.createProject(data)
  }
  if (result) showModal.value = false
}

onMounted(() => {
  projectStore.fetchProjects()
})
</script>

<style scoped>
@import '../styles/bongmaster.css';

/* Project Card */
.bm-project-card {
  display: flex;
  flex-direction: column;
  min-height: 176px;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--bm-bg-card) 86%, white), var(--bm-bg-card)),
    var(--bm-bg-card);
  border: 1px solid var(--bm-border-default);
  border-radius: var(--bm-radius-md);
  padding: var(--bm-space-lg);
  text-decoration: none;
  color: inherit;
  transition: all var(--bm-transition-fast);
  position: relative;
  overflow: hidden;
  isolation: isolate;
}

.bm-project-card:hover {
  border-color: var(--bm-border-strong);
  background: var(--bm-bg-hover);
  box-shadow: 3px 3px 0 rgba(55, 53, 47, 0.08);
  animation: projectCardHop 360ms steps(4, end);
  transform: translate(-1px, -2px);
}

.bm-project-card:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--project-signal, var(--bm-accent-blue)) 54%, transparent);
  outline-offset: 3px;
}

.bm-project-card::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(rgba(55, 53, 47, 0.028) 1px, transparent 1px),
    linear-gradient(90deg, rgba(55, 53, 47, 0.022) 1px, transparent 1px);
  background-size: 7px 7px;
  opacity: 0.26;
}

.bm-project-card::after {
  content: '';
  position: absolute;
  right: var(--bm-space-lg);
  bottom: 0;
  left: var(--bm-space-lg);
  height: 2px;
  background:
    repeating-linear-gradient(
      90deg,
      color-mix(in srgb, var(--project-signal, var(--bm-accent-blue)) 76%, transparent) 0 10px,
      transparent 10px 14px
    );
  opacity: 0.45;
  transition: opacity var(--bm-transition-fast);
}

.bm-project-card > * {
  position: relative;
  z-index: 1;
}

.bm-project-card:hover::after {
  opacity: 0.86;
  animation: projectSignalMarch 760ms steps(6, end);
}

.bm-project-card:has(.bm-badge-blue) {
  --project-signal: var(--bm-accent-blue);
}

.bm-project-card:has(.bm-badge-emerald) {
  --project-signal: var(--bm-accent-teal);
}

.bm-project-card:has(.bm-badge-amber) {
  --project-signal: var(--bm-accent-orange);
}

.bm-project-card:has(.bm-badge-slate) {
  --project-signal: var(--bm-text-tertiary);
}

.bm-project-header {
  flex: 1;
  margin-bottom: var(--bm-space-md);
}

.bm-project-header::after {
  content: '';
  position: absolute;
  top: -4px;
  right: -2px;
  width: 42px;
  height: 42px;
  border-top: 1px solid color-mix(in srgb, var(--project-signal, var(--bm-accent-blue)) 44%, transparent);
  border-right: 1px solid color-mix(in srgb, var(--project-signal, var(--bm-accent-blue)) 44%, transparent);
  opacity: 0;
  transform: translate(8px, -8px);
  transition:
    opacity 220ms ease,
    transform 280ms cubic-bezier(0.22, 1, 0.36, 1);
}

.bm-project-card:hover .bm-project-header::after {
  opacity: 0.9;
  transform: translate(0, 0);
}

.bm-project-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--bm-text-primary);
  margin: 0 0 var(--bm-space-sm) 0;
  line-height: 1.4;
  transition: color var(--bm-transition-fast), transform var(--bm-transition-fast);
}

.bm-project-card:hover .bm-project-title {
  color: var(--project-signal, var(--bm-accent-blue));
  transform: translateX(2px);
}

.bm-project-desc {
  font-size: 0.875rem;
  color: var(--bm-text-secondary);
  margin: 0;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.bm-project-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--bm-space-sm);
}

.bm-project-badges {
  display: flex;
  gap: var(--bm-space-xs);
}

.bm-project-meta {
  display: flex;
  align-items: center;
  gap: var(--bm-space-xs);
  font-size: 0.8125rem;
  color: var(--bm-text-muted);
  padding: 3px 7px;
  border: 1px solid var(--bm-border-subtle);
  border-radius: var(--bm-radius-sm);
  background: color-mix(in srgb, var(--bm-bg-hover) 56%, transparent);
  transition:
    border-color var(--bm-transition-fast),
    color var(--bm-transition-fast),
    transform var(--bm-transition-fast);
}

.bm-project-card:hover .bm-project-meta {
  color: var(--bm-text-primary);
  border-color: color-mix(in srgb, var(--project-signal, var(--bm-accent-blue)) 38%, var(--bm-border-default));
  transform: translateY(-1px);
}

.bm-project-date {
  font-size: 0.75rem;
  color: var(--bm-text-muted);
  padding-top: var(--bm-space-sm);
  border-top: 1px solid var(--bm-border-subtle);
  min-height: 27px;
}

.bm-project-date:empty::before {
  content: '未设置时间线';
  color: var(--bm-text-tertiary);
  font-style: italic;
}

.bm-project-card:nth-child(3n + 2)::before {
  background-size: 8px 8px;
}

.bm-project-card:nth-child(3n)::before {
  background-size: 6px 10px;
}

@keyframes projectCardHop {
  0% { transform: translate(0, 0); }
  35% { transform: translate(-1px, -4px); }
  70% { transform: translate(-1px, -2px); }
  100% { transform: translate(-1px, -2px); }
}

@keyframes projectSignalMarch {
  0% { background-position: 0 0; }
  100% { background-position: 28px 0; }
}
</style>
