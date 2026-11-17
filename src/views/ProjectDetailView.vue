<template>
  <div class="fade-in bm-page" v-if="project">
    <!-- Page Header -->
    <div class="bm-page-header">
      <div>
        <h1>{{ project.name }}</h1>
        <div style="display: flex; gap: var(--bm-space-sm); margin-top: var(--bm-space-sm);">
          <span class="bm-badge" :class="getStatusBadge(project.status)">{{ project.status }}</span>
          <span class="bm-badge" :class="getPriorityBadge(project.priority)">{{ project.priority }}</span>
        </div>
      </div>
      <div style="display: flex; gap: var(--bm-space-sm);">
        <button class="bm-btn bm-btn-secondary" @click="openEditModal">
          <i class="fas fa-edit"></i> 编辑
        </button>
        <button class="bm-btn bm-btn-danger" @click="deleteProject">
          <i class="fas fa-trash"></i> 删除
        </button>
      </div>
    </div>

    <div class="bm-grid bm-grid-2">
      <!-- Left Column -->
      <div style="display: flex; flex-direction: column; gap: var(--bm-space-lg);">
        <!-- Description -->
        <div class="bm-card">
          <div class="bm-card-header">
            <h3>项目描述</h3>
          </div>
          <div class="bm-card-body">
            <p style="margin: 0; color: var(--bm-text-secondary);">{{ project.description || '暂无描述' }}</p>
          </div>
        </div>

        <!-- Overview -->
        <div class="bm-card">
          <div class="bm-card-header">
            <h3>项目概况</h3>
            <div style="display: flex; gap: var(--bm-space-sm);">
              <button class="bm-btn bm-btn-ghost bm-btn-icon" v-if="editingOverview" @click="insertTimestamp(overviewQuill)" title="插入时间戳">
                <i class="fas fa-clock"></i>
              </button>
              <button class="bm-btn bm-btn-ghost bm-btn-icon" v-if="editingOverview" @click="cancelOverviewEdit" title="取消">
                <i class="fas fa-times"></i>
              </button>
              <button class="bm-btn bm-btn-primary" v-if="editingOverview" @click="saveOverview">
                <i class="fas fa-save"></i> 保存
              </button>
              <button class="bm-btn bm-btn-ghost bm-btn-icon" v-else @click="startOverviewEdit" title="编辑">
                <i class="fas fa-edit"></i>
              </button>
            </div>
          </div>
          <div class="bm-card-body">
            <div v-if="editingOverview">
              <div ref="overviewEditor" style="min-height: 200px;"></div>
            </div>
            <div v-else>
              <div v-if="project.overview" v-html="sanitizedOverview"></div>
              <p v-else style="margin: 0; color: var(--bm-text-muted);">暂无内容</p>
            </div>
          </div>
        </div>

        <!-- Progress -->
        <div class="bm-card">
          <div class="bm-card-header">
            <h3>项目进展</h3>
            <div style="display: flex; gap: var(--bm-space-sm);">
              <button class="bm-btn bm-btn-ghost bm-btn-icon" v-if="editingProgress" @click="insertTimestamp(progressQuill)" title="插入时间戳">
                <i class="fas fa-clock"></i>
              </button>
              <button class="bm-btn bm-btn-ghost bm-btn-icon" v-if="editingProgress" @click="cancelProgressEdit" title="取消">
                <i class="fas fa-times"></i>
              </button>
              <button class="bm-btn bm-btn-primary" v-if="editingProgress" @click="saveProgress">
                <i class="fas fa-save"></i> 保存
              </button>
              <button class="bm-btn bm-btn-ghost bm-btn-icon" v-else @click="startProgressEdit" title="编辑">
                <i class="fas fa-edit"></i>
              </button>
            </div>
          </div>
          <div class="bm-card-body">
            <div v-if="editingProgress">
              <div ref="progressEditor" style="min-height: 200px;"></div>
            </div>
            <div v-else>
              <div v-if="project.progress" v-html="sanitizedProgress"></div>
              <p v-else style="margin: 0; color: var(--bm-text-muted);">暂无内容</p>
            </div>
          </div>
        </div>

        <!-- Tasks -->
        <div class="bm-card">
          <div class="bm-card-header">
            <h3>任务列表</h3>
            <button class="bm-btn bm-btn-primary" @click="openTaskModal()">
              <i class="fas fa-plus"></i> 添加任务
            </button>
          </div>
          <div class="bm-card-body">
            <transition-group v-if="displayedTasks.length" name="project-list-motion" tag="div" class="bm-task-list">
              <div v-for="task in displayedTasks" :key="task.id" class="bm-task-row" @click="openTaskModal(task)">
                <div class="bm-drag-handle">
                  <i class="fas fa-grip-vertical"></i>
                </div>
                <div style="flex: 1; min-width: 0;">
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--bm-space-xs);">
                    <span style="font-weight: 500; color: var(--bm-text-primary);">{{ task.name }}</span>
                    <div style="display: flex; gap: var(--bm-space-xs);">
                      <span class="bm-badge" :class="getStatusBadge(task.status)">{{ task.status }}</span>
                      <span class="bm-badge" :class="getPriorityBadge(task.priority)">{{ task.priority }}</span>
                    </div>
                  </div>
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 0.75rem; color: var(--bm-text-muted);">{{ task.assignee || '未分配' }}</span>
                    <span style="font-size: 0.75rem; color: var(--bm-text-muted);">{{ task.due_date ? formatDate(task.due_date) : '无期限' }}</span>
                  </div>
                </div>
              </div>
              <div v-if="project.tasks.length > 5" key="task-toggle" style="text-align: center; margin-top: var(--bm-space-md);">
                <button class="bm-btn bm-btn-ghost" @click.stop="showAllTasks = !showAllTasks">
                  <i class="fas fa-chevron-down project-toggle-icon" :class="{ expanded: showAllTasks }"></i>
                  {{ showAllTasks ? '收起' : `展开剩余 ${project.tasks.length - 5} 条任务` }}
                </button>
              </div>
            </transition-group>
            <div v-else class="bm-empty">
              <p style="color: var(--bm-text-muted); margin: 0;">暂无任务</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Right Column -->
      <div style="display: flex; flex-direction: column; gap: var(--bm-space-lg); min-width: 280px;">
        <!-- Project Info -->
        <div class="bm-card">
          <div class="bm-card-header">
            <h3>项目信息</h3>
          </div>
          <div class="bm-card-body">
            <div style="margin-bottom: var(--bm-space-md);">
              <label class="bm-form-label">开始日期</label>
              <p style="margin: 0; color: var(--bm-text-primary);">{{ project.start_date ? formatDate(project.start_date) : '未设置' }}</p>
            </div>
            <div style="margin-bottom: var(--bm-space-md);">
              <label class="bm-form-label">截止日期</label>
              <p style="margin: 0; color: var(--bm-text-primary);">{{ project.due_date ? formatDate(project.due_date) : '至今' }}</p>
            </div>
            <div>
              <label class="bm-form-label">创建时间</label>
              <p style="margin: 0; color: var(--bm-text-primary);">{{ formatDate(project.created_at) }}</p>
            </div>
          </div>
        </div>

        <!-- Related Notes -->
        <div class="bm-card">
          <div class="bm-card-header">
            <h3>相关便签</h3>
            <button class="bm-btn bm-btn-ghost bm-btn-icon" @click="createProjectNote" title="新建关联便签">
              <i class="fas fa-plus"></i>
            </button>
          </div>
          <div class="bm-card-body">
            <transition-group v-if="relatedNotes.length" name="project-list-motion" tag="div" class="project-note-list">
              <button
                v-for="note in displayedNotes"
                :key="note.id"
                type="button"
                class="project-note-item"
                @click="openNote(note)"
              >
                <span class="project-note-title">{{ note.title || '无标题' }}</span>
                <span class="project-note-preview">{{ renderNotePreview(note.content) }}</span>
                <span class="project-note-date">{{ formatDate(note.updated_at) }}</span>
              </button>
              <button
                v-if="relatedNotes.length > 5"
                key="note-toggle"
                type="button"
                class="bm-btn bm-btn-ghost project-note-toggle"
                @click="showAllNotes = !showAllNotes"
              >
                <i class="fas fa-chevron-down project-toggle-icon" :class="{ expanded: showAllNotes }"></i>
                {{ showAllNotes ? '收起' : `展开剩余 ${relatedNotes.length - 5} 条便签` }}
              </button>
            </transition-group>
            <div v-else class="bm-empty" style="padding: var(--bm-space-xl);">
              <p style="color: var(--bm-text-muted); margin: 0;">暂无关联便签</p>
            </div>
          </div>
        </div>

        <!-- Attachments -->
        <div class="bm-card">
          <div class="bm-card-header">
            <h3>项目附件</h3>
            <button class="bm-btn bm-btn-ghost bm-btn-icon" @click="$refs.fileInput.click()" title="上传附件">
              <i class="fas fa-upload"></i>
            </button>
          </div>
          <div class="bm-card-body">
            <input type="file" ref="fileInput" style="display: none" @change="handleFileUpload">
            <div v-if="project.documents && project.documents.length">
              <div v-for="doc in project.documents" :key="doc.id" style="display: flex; justify-content: space-between; align-items: center; padding: var(--bm-space-sm); margin-bottom: var(--bm-space-sm); border: 1px solid var(--bm-border-default); border-radius: var(--bm-radius-md);">
                <div style="display: flex; align-items: center; gap: var(--bm-space-sm); overflow: hidden;">
                  <i class="fas fa-file" style="color: var(--bm-text-muted);"></i>
                  <span style="font-size: 0.8125rem; color: var(--bm-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{{ doc.original_filename }}</span>
                </div>
                <div style="display: flex; gap: var(--bm-space-xs);">
                  <button class="bm-btn bm-btn-ghost bm-btn-icon" @click.stop="downloadDocument(doc.id)" title="下载">
                    <i class="fas fa-download"></i>
                  </button>
                  <button class="bm-btn bm-btn-ghost bm-btn-icon" @click.stop="deleteDocument(doc.id)" style="color: var(--bm-accent-red);" title="删除">
                    <i class="fas fa-trash"></i>
                  </button>
                </div>
              </div>
            </div>
            <div v-else class="bm-empty" style="padding: var(--bm-space-xl);">
              <p style="color: var(--bm-text-muted); margin: 0;">暂无附件</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Edit Project Modal -->
    <div class="bm-modal-overlay" :class="{ show: showEditModal }" @click.self="showEditModal = false">
      <div class="bm-modal">
        <div class="bm-modal-header">
          <h3>编辑项目</h3>
          <button type="button" class="bm-modal-close" @click="showEditModal = false">&times;</button>
        </div>
        <div class="bm-modal-body">
          <div class="bm-form-group">
            <label class="bm-form-label">项目名称 *</label>
            <input type="text" class="bm-form-control" v-model="editForm.name" required>
          </div>
          <div class="bm-form-group">
            <label class="bm-form-label">项目描述</label>
            <textarea class="bm-form-control" v-model="editForm.description" rows="3"></textarea>
          </div>
          <div class="bm-grid bm-grid-2">
            <div class="bm-form-group">
              <label class="bm-form-label">状态</label>
              <select class="bm-form-control" v-model="editForm.status">
                <option value="未开始">未开始</option>
                <option value="进行中">进行中</option>
                <option value="已完成">已完成</option>
                <option value="已暂停">已暂停</option>
              </select>
            </div>
            <div class="bm-form-group">
              <label class="bm-form-label">优先级</label>
              <select class="bm-form-control" v-model="editForm.priority">
                <option value="高">高</option>
                <option value="中">中</option>
                <option value="低">低</option>
              </select>
            </div>
          </div>
          <div class="bm-grid bm-grid-2">
            <div class="bm-form-group">
              <label class="bm-form-label">开始日期</label>
              <input type="date" class="bm-form-control" v-model="editForm.start_date">
            </div>
            <div class="bm-form-group">
              <label class="bm-form-label">截止日期</label>
              <div style="display: flex; align-items: center; gap: var(--bm-space-sm);">
                <input type="date" class="bm-form-control" v-model="editForm.due_date" :disabled="editOngoing">
                <label style="font-size: 0.875rem; color: var(--bm-text-secondary); white-space: nowrap;">
                  <input type="checkbox" v-model="editOngoing" style="margin-right: 4px;"> 至今
                </label>
              </div>
            </div>
          </div>
        </div>
        <div class="bm-modal-footer">
          <button type="button" class="bm-btn bm-btn-ghost" @click="showEditModal = false">取消</button>
          <button type="button" class="bm-btn bm-btn-primary" @click="saveProject">保存</button>
        </div>
      </div>
    </div>

    <!-- Task Modal -->
    <div class="bm-modal-overlay" :class="{ show: showTaskModal }" @click.self="showTaskModal = false">
      <div class="bm-modal">
        <div class="bm-modal-header">
          <h3>{{ editingTask ? '编辑任务' : '新建任务' }}</h3>
          <button type="button" class="bm-modal-close" @click="showTaskModal = false">&times;</button>
        </div>
        <div class="bm-modal-body">
          <div class="bm-form-group">
            <label class="bm-form-label">任务名称 *</label>
            <input type="text" class="bm-form-control" v-model="taskForm.name" required>
          </div>
          <div class="bm-grid bm-grid-2">
            <div class="bm-form-group">
              <label class="bm-form-label">状态</label>
              <select class="bm-form-control" v-model="taskForm.status">
                <option value="待办">待办</option>
                <option value="进行中">进行中</option>
                <option value="已完成">已完成</option>
              </select>
            </div>
            <div class="bm-form-group">
              <label class="bm-form-label">优先级</label>
              <select class="bm-form-control" v-model="taskForm.priority">
                <option value="高">高</option>
                <option value="中">中</option>
                <option value="低">低</option>
              </select>
            </div>
          </div>
          <div class="bm-form-group">
            <label class="bm-form-label">负责人</label>
            <input type="text" class="bm-form-control" v-model="taskForm.assignee">
          </div>
          <div class="bm-form-group">
            <label class="bm-form-label">截止日期</label>
            <input type="date" class="bm-form-control" v-model="taskForm.due_date">
          </div>
        </div>
        <div class="bm-modal-footer">
          <button type="button" class="bm-btn bm-btn-danger" v-if="editingTask" @click="deleteTask" style="margin-right: auto;">
            <i class="fas fa-trash"></i> 删除
          </button>
          <button type="button" class="bm-btn bm-btn-ghost" @click="showTaskModal = false">取消</button>
          <button type="button" class="bm-btn bm-btn-primary" @click="saveTask">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useProjectStore } from '@stores/project-store'
import { useTaskStore } from '@stores/task-store'
import { useNotepadStore } from '@stores/notepad-store'
import { useUndoStore } from '@stores/undo-store'
import { extractPreview } from '@utils/markdown.js'
import { format, parseISO } from 'date-fns'
import Quill from 'quill'
import DOMPurify from 'dompurify'

const route = useRoute()
const router = useRouter()
const projectStore = useProjectStore()
const taskStore = useTaskStore()
const notepadStore = useNotepadStore()
const undoStore = useUndoStore()

const project = ref(null)
const showEditModal = ref(false)
const showTaskModal = ref(false)
const editingTask = ref(null)
const editingOverview = ref(false)
const editingProgress = ref(false)

const overviewEditor = ref(null)
const progressEditor = ref(null)
let overviewQuill = null
let progressQuill = null

const editForm = ref({})
const editOngoing = ref(false)
const showAllTasks = ref(false)
const showAllNotes = ref(false)

const displayedTasks = computed(() => {
  if (!project.value?.tasks) return []
  return showAllTasks.value ? project.value.tasks : project.value.tasks.slice(0, 5)
})

const relatedNotes = computed(() => project.value?.notes || [])
const sanitizeProjectHtml = (html) => DOMPurify.sanitize(String(html || ''), {
  USE_PROFILES: { html: true },
  ADD_ATTR: ['target']
})
const sanitizedOverview = computed(() => sanitizeProjectHtml(project.value?.overview))
const sanitizedProgress = computed(() => sanitizeProjectHtml(project.value?.progress))

const displayedNotes = computed(() => {
  return showAllNotes.value ? relatedNotes.value : relatedNotes.value.slice(0, 5)
})
const taskForm = ref({
  name: '',
  status: '待办',
  priority: '中',
  assignee: '',
  due_date: '',
  project_id: null
})

const formatDate = (dateStr) => {
  if (!dateStr) return ''
  try {
    return format(parseISO(dateStr), 'yyyy-MM-dd')
  } catch { return dateStr }
}

const renderNotePreview = (content) => {
  return extractPreview(content || '', 80) || '无内容'
}

const insertTimestamp = (quill) => {
  if (!quill) return
  const now = new Date()
  const dateStr = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`
  const range = quill.getSelection(true)
  const index = range ? range.index : quill.getLength()
  quill.insertText(index, `\n${dateStr}\n`)
  quill.formatLine(index + 1, dateStr.length, 'header', 1)
  quill.setSelection(index + dateStr.length + 2)
}

const getStatusBadge = (status) => ({
  '已完成': 'bm-badge-teal',
  '进行中': 'bm-badge-blue',
  '未开始': 'bm-badge',
  '已暂停': 'bm-badge-amber'
}[status] || 'bm-badge')

const getPriorityBadge = (priority) => ({
  '高': 'bm-badge-red',
  '中': 'bm-badge-amber',
  '低': 'bm-badge-blue'
}[priority] || 'bm-badge-blue')

const loadProject = async () => {
  try {
    const id = parseInt(route.params.id)
    project.value = await projectStore.fetchProjectById(id)
    if (project.value) {
      editForm.value = { ...project.value }
    }
  } catch (err) {
    console.error('[ProjectDetail] loadProject error:', err)
  }
}

const clearQuillDom = (editorRef) => {
  if (editorRef.value) {
    editorRef.value.innerHTML = ''
  }
}

const initQuillEditor = async (editorRef, content) => {
  await nextTick()
  if (!editorRef.value) return null
  editorRef.value.innerHTML = ''
  const quill = new Quill(editorRef.value, {
    theme: 'snow',
    placeholder: '输入内容...'
  })
  if (content) {
    quill.root.innerHTML = content
  }
  return quill
}

const startOverviewEdit = async () => {
  editingOverview.value = true
  overviewQuill = await initQuillEditor(overviewEditor, project.value.overview)
}

const cancelOverviewEdit = () => {
  clearQuillDom(overviewEditor)
  editingOverview.value = false
  overviewQuill = null
}

const saveOverview = async () => {
  if (!overviewQuill) return
  try {
    const updated = await projectStore.updateProject(project.value.id, {
      overview: overviewQuill.root.innerHTML
    })
    if (updated) {
      project.value = updated
      editForm.value = { ...updated }
    }
    clearQuillDom(overviewEditor)
    editingOverview.value = false
    overviewQuill = null
  } catch (err) {
    console.error('[ProjectDetail] saveOverview error:', err)
    alert('保存项目概况失败: ' + (err.message || err))
  }
}

const startProgressEdit = async () => {
  editingProgress.value = true
  progressQuill = await initQuillEditor(progressEditor, project.value.progress)
}

const cancelProgressEdit = () => {
  clearQuillDom(progressEditor)
  editingProgress.value = false
  progressQuill = null
}

const saveProgress = async () => {
  if (!progressQuill) return
  try {
    const updated = await projectStore.updateProject(project.value.id, {
      progress: progressQuill.root.innerHTML
    })
    if (updated) {
      project.value = updated
      editForm.value = { ...updated }
    }
    clearQuillDom(progressEditor)
    editingProgress.value = false
    progressQuill = null
  } catch (err) {
    console.error('[ProjectDetail] saveProgress error:', err)
    alert('保存项目进展失败: ' + (err.message || err))
  }
}

const openEditModal = () => {
  editForm.value = { ...project.value }
  editOngoing.value = !project.value.due_date
  showEditModal.value = true
}

const saveProject = async () => {
  if (!editForm.value.name) {
    alert('请输入项目名称')
    return
  }
  if (editOngoing.value) {
    editForm.value.due_date = ''
  }
  editForm.value.is_ongoing = editOngoing.value
  try {
    await projectStore.updateProject(project.value.id, editForm.value)
    showEditModal.value = false
    await loadProject()
  } catch (err) {
    console.error('[ProjectDetail] saveProject error:', err)
    alert('保存项目失败: ' + (err.message || err))
  }
}

const deleteProject = async () => {
  if (!project.value) return
  if (!confirm('确定要删除这个项目吗？所有相关任务和附件也会被删除。')) return

  const projectId = project.value.id
  try {
    // deleteProject 会级联 tombstone 任务/附件/便签关联，撤回需要提前拿到这些
    // 子行的 id（删除后既查不到，重建也会换 id 并丢关联）。
    const snapshot = await window.electronAPI.getProjectById(projectId)
    if (!snapshot) return
    const undoSnapshot = {
      id: projectId,
      name: snapshot.name,
      taskIds: (snapshot.tasks || []).map(t => t.id),
      documentIds: (snapshot.documents || []).map(d => d.id),
      noteIds: (snapshot.notes || []).map(n => n.id)
    }

    await projectStore.deleteProject(projectId)
    router.push('/projects')
    undoStore.showUndo({
      message: `已删除项目「${undoSnapshot.name || '未命名'}」`,
      undo: () => projectStore.restoreProject(undoSnapshot)
    })
  } catch (err) {
    console.error('[ProjectDetail] deleteProject error:', err)
    alert('删除项目失败: ' + (err.message || err))
  }
}

const openNote = (note) => {
  router.push({
    name: 'Notepad',
    query: { noteId: note.id }
  })
}

const createProjectNote = async () => {
  if (!project.value) return
  const note = await notepadStore.createNote({
    title: '',
    content: '',
    project_ids: [project.value.id]
  })
  if (note) {
    await loadProject()
    openNote(note)
  }
}

const openTaskModal = (task = null) => {
  const isTask = task && typeof task === 'object' && 'id' in task && 'name' in task
  if (isTask) {
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
      project_id: project.value ? project.value.id : null
    }
  }
  showTaskModal.value = true
}

const saveTask = async () => {
  if (!taskForm.value.name) {
    alert('请输入任务名称')
    return
  }
  try {
    const payload = {
      ...taskForm.value,
      project_id: project.value?.id ?? taskForm.value.project_id
    }
    if (!payload.project_id) {
      alert('无法获取项目 ID，请刷新页面重试')
      return
    }
    if (editingTask.value) {
      await taskStore.updateTask(editingTask.value.id, payload)
    } else {
      await taskStore.createTask(payload)
    }
    showTaskModal.value = false
    await loadProject()
  } catch (err) {
    console.error('[ProjectDetail] saveTask error:', err)
    alert('保存任务失败: ' + (err.message || err))
  }
}

const deleteTask = async () => {
  if (!editingTask.value) return
  if (!confirm('确定要删除这个任务吗？')) return

  const task = { ...editingTask.value }
  try {
    const deleted = await taskStore.deleteTask(task.id)
    showTaskModal.value = false
    await loadProject()
    if (!deleted) return
    undoStore.showUndo({
      message: `已删除任务「${task.name || '未命名'}」`,
      undo: async () => {
        await taskStore.restoreTask(task)
        // 撤回可能在切走页面之后才点；只有还停在本项目时才需要刷新详情。
        if (route.name === 'ProjectDetail') await loadProject()
      }
    })
  } catch (err) {
    console.error('[ProjectDetail] deleteTask error:', err)
    alert('删除任务失败: ' + (err.message || err))
  }
}

const handleFileUpload = async (event) => {
  const file = event.target.files[0]
  if (!file) return

  try {
    const arrayBuffer = await file.arrayBuffer()
    const fileData = {
      name: file.name,
      size: file.size,
      type: file.type,
      data: Array.from(new Uint8Array(arrayBuffer))
    }

    await window.electronAPI.uploadDocument(project.value.id, fileData)
    await loadProject()
    event.target.value = ''
  } catch (err) {
    console.error('[ProjectDetail] handleFileUpload error:', err)
    alert('上传附件失败: ' + (err.message || err))
  }
}

const downloadDocument = async (documentId) => {
  try {
    const doc = await window.electronAPI.downloadDocument(documentId)
    if (!doc) return

    const blob = new Blob([new Uint8Array(doc.data)], { type: doc.mime_type || 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = doc.original_filename
    a.click()
    URL.revokeObjectURL(url)
  } catch (err) {
    console.error('[ProjectDetail] downloadDocument error:', err)
    alert('下载附件失败: ' + (err.message || err))
  }
}

const deleteDocument = async (documentId) => {
  if (confirm('确定要删除这个附件吗？')) {
    try {
      await window.electronAPI.deleteDocument(documentId)
      await loadProject()
    } catch (err) {
      console.error('[ProjectDetail] deleteDocument error:', err)
      alert('删除附件失败: ' + (err.message || err))
    }
  }
}

watch(() => route.params.id, () => {
  loadProject()
})

onMounted(() => {
  loadProject()
})

onUnmounted(() => {
  editingOverview.value = false
  editingProgress.value = false
  overviewQuill = null
  progressQuill = null
})
</script>

<style scoped>
@import '../styles/bongmaster.css';

.bm-task-list {
  display: flex;
  flex-direction: column;
  gap: var(--bm-space-sm);
}

.bm-task-row {
  display: flex;
  align-items: center;
  gap: var(--bm-space-sm);
  padding: var(--bm-space-md);
  background: var(--bm-bg-card);
  border: 1px solid var(--bm-border-default);
  border-radius: var(--bm-radius-md);
  cursor: pointer;
  transition: all var(--bm-transition-fast);
}

.bm-task-row:hover {
  background: var(--bm-bg-hover);
  border-color: var(--bm-border-strong);
}

.project-note-list {
  display: flex;
  flex-direction: column;
  gap: var(--bm-space-sm);
}

.project-note-item {
  width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 2px var(--bm-space-sm);
  padding: var(--bm-space-sm);
  background: transparent;
  border: 1px solid var(--bm-border-default);
  border-radius: var(--bm-radius-md);
  color: inherit;
  cursor: pointer;
  text-align: left;
  transition: all var(--bm-transition-fast);
}

.project-note-item:hover {
  background: var(--bm-bg-hover);
  border-color: var(--bm-border-strong);
}

.project-note-title {
  min-width: 0;
  color: var(--bm-text-primary);
  font-size: 0.875rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-note-preview {
  grid-column: 1 / -1;
  color: var(--bm-text-secondary);
  font-size: 0.75rem;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-note-date {
  color: var(--bm-text-muted);
  font-size: 0.75rem;
  white-space: nowrap;
}

.project-note-toggle {
  align-self: center;
  margin-top: var(--bm-space-xs);
}

.project-toggle-icon {
  transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

.project-toggle-icon.expanded {
  transform: rotate(180deg);
}

.project-list-motion-move,
.project-list-motion-enter-active,
.project-list-motion-leave-active {
  transition:
    opacity 220ms ease,
    transform 260ms cubic-bezier(0.22, 1, 0.36, 1);
}

.project-list-motion-enter-from,
.project-list-motion-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.99);
}

@media (max-width: 768px) {
  .bm-grid-2 {
    grid-template-columns: 1fr;
  }
}
</style>
