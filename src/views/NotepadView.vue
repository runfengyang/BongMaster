<template>
  <div class="fade-in notepad-view">
    <!-- Two-column layout like Apple Notes -->
    <div class="notepad-container">
      <!-- Left Sidebar - Note List -->
      <div class="notepad-sidebar" :style="{ width: sidebarWidth + 'px' }">
        <div class="sidebar-header">
          <h2 class="bm-tab-title">便签</h2>
          <div class="sidebar-header-actions">
            <button
              class="btn-filter-toggle"
              type="button"
              :class="{ 'is-collapsed': filtersCollapsed }"
              :title="filtersCollapsed ? '展开筛选与搜索' : '收起筛选与搜索'"
              :aria-expanded="!filtersCollapsed"
              @click="toggleFilters"
            >
              <i class="fas fa-sliders" aria-hidden="true"></i>
            </button>
            <button class="btn-new" @click="createNewNote" title="新建便签" aria-label="新建便签">
              <i class="fas fa-plus"></i>
            </button>
          </div>
        </div>

        <div class="archive-switch" role="tablist" aria-label="便签归档视图">
          <button
            type="button"
            class="archive-switch-btn"
            :class="{ active: noteArchiveMode === 'active' }"
            @click="setNoteArchiveMode('active')"
            title="当前便签"
          >
            <i class="fas fa-note-sticky"></i>
            <span>当前</span>
            <strong>{{ activeNoteCount }}</strong>
          </button>
          <button
            type="button"
            class="archive-switch-btn"
            :class="{ active: noteArchiveMode === 'archived' }"
            @click="setNoteArchiveMode('archived')"
            title="归档箱"
          >
            <i class="fas fa-box-archive"></i>
            <span>归档</span>
            <strong>{{ archivedNoteCount }}</strong>
          </button>
        </div>

        <transition name="filters-fold">
          <div v-show="!filtersCollapsed" class="sidebar-filters">
            <!-- Category Filter -->
            <div class="sidebar-category">
              <select v-model="selectedCategory" class="category-select" title="按分类筛选">
                <option value="">全部分类</option>
                <option v-for="cat in categories" :key="cat.name" :value="cat.name">
                  {{ cat.name }}
                </option>
              </select>
              <select v-model="selectedProjectFilter" class="category-select project-filter-select" title="按项目筛选">
                <option value="">全部项目</option>
                <option value="__unlinked__">未关联项目</option>
                <option v-for="proj in projectOptions" :key="proj.id" :value="String(proj.id)">
                  {{ proj.name }}
                </option>
              </select>
            </div>

        <!-- Category Manager Modal -->
        <Teleport to="body">
        <transition name="category-modal-motion">
          <div v-if="showCategoryManager" class="category-modal" @click.self="closeCategoryManager">
            <div class="category-modal-content">
              <div class="category-modal-header">
                <h3>管理分类</h3>
                <button type="button" class="category-modal-close" @click="closeCategoryManager" aria-label="关闭">×</button>
              </div>
              <div class="category-modal-body">
                <div class="new-category-form">
                  <input
                    v-model="newCategoryName"
                    type="text"
                    placeholder="新分类名称"
                    class="category-input"
                    @keydown.enter="createCategory"
                  />
                  <button class="btn-add-category" @click="createCategory" :disabled="!newCategoryName.trim()">
                    <i class="fas fa-plus"></i> 添加
                  </button>
                </div>
                <div class="category-list">
                  <div v-for="cat in categories" :key="cat.name" class="category-item">
                    <span class="category-name">{{ cat.name }}</span>
                    <button class="btn-delete-category" @click="deleteCategory(cat.name)" title="删除分类">
                      <i class="fas fa-trash"></i>
                    </button>
                  </div>
                  <div v-if="categories.length === 0" class="category-empty">
                    暂无分类
                  </div>
                </div>
              </div>
            </div>
          </div>
        </transition>
        </Teleport>

            <div class="sidebar-search">
              <div class="search-box">
                <i class="fas fa-search"></i>
                <input
                  type="text"
                  v-model="searchQuery"
                  :placeholder="searchPlaceholder"
                />
                <button v-if="searchQuery" class="btn-clear" @click="searchQuery = ''">
                  <i class="fas fa-times"></i>
                </button>
              </div>
            </div>
          </div>
        </transition>

        <div v-if="filtersCollapsed && hasActiveFilters" class="sidebar-filter-hint">
          <button type="button" class="btn-filter-chip" title="展开筛选与搜索" @click="toggleFilters">
            <i class="fas fa-filter" aria-hidden="true"></i>
            <span>已筛选</span>
          </button>
        </div>

        <transition-group name="note-list-motion" tag="div" class="sidebar-list" ref="listRef">
          <div
            v-for="note in filteredNotes"
            :key="note.id"
            class="note-item"
            :class="{ active: selectedNote?.id === note.id, pinned: note.is_pinned, archived: note.is_archived, 'context-open': noteContextMenu.visible && noteContextMenu.note?.id === note.id }"
            @click="selectNote(note)"
            @contextmenu.prevent="openNoteContextMenu(note, $event)"
          >
            <!-- Pin indicator -->
            <div v-if="note.is_pinned" class="pin-indicator">
              <i class="fas fa-thumbtack"></i>
            </div>

            <div class="note-preview">
              <div class="note-title-row">
                <span class="note-title">{{ note.title || '无标题' }}</span>
                <span v-if="note.is_archived" class="note-archive-badge">已归档</span>
              </div>
              <div class="note-meta-row">
                <span class="note-date">{{ formatDate(note.updated_at) }}</span>
                <span class="note-content-preview">{{ renderMarkdownPreview(note.content) || '无附加文本' }}</span>
              </div>
              <div class="note-folder-row">
                <i class="fas fa-folder" aria-hidden="true"></i>
                <span class="note-folder-name">{{ note.category || '备忘录' }}</span>
                <span v-if="note.linked_projects?.length" class="note-folder-project">
                  · {{ note.linked_projects[0].name }}<template v-if="note.linked_projects.length > 1"> +{{ note.linked_projects.length - 1 }}</template>
                </span>
              </div>
            </div>
          </div>

          <!-- Empty state in sidebar -->
          <div v-if="filteredNotes.length === 0" class="sidebar-empty">
            <i class="fas fa-sticky-note"></i>
            <p>{{ sidebarEmptyText }}</p>
          </div>
        </transition-group>

        <div class="sidebar-footer">
          <button type="button" class="sidebar-footer-btn" @click="showCategoryManager = true">
            <i class="fas fa-folder" aria-hidden="true"></i>
            <span>管理分类</span>
            <em v-if="categories.length">{{ categories.length }}</em>
          </button>
        </div>

        <div
          v-if="noteContextMenu.visible"
          class="note-context-menu"
          :style="{ left: `${noteContextMenu.x}px`, top: `${noteContextMenu.y}px` }"
          role="menu"
          @click.stop
        >
          <button type="button" class="context-menu-item" @click="copyContextNoteContent">
            <i class="fas fa-copy" aria-hidden="true"></i>
            <span>复制内容</span>
          </button>
          <button type="button" class="context-menu-item" @click="duplicateContextNote">
            <i class="fas fa-clone" aria-hidden="true"></i>
            <span>创建副本</span>
          </button>
          <div class="context-menu-divider" role="separator"></div>
          <button type="button" class="context-menu-item" @click="toggleContextNotePin">
            <i class="fas fa-thumbtack" aria-hidden="true"></i>
            <span>{{ noteContextMenu.note?.is_pinned ? '取消置顶' : '置顶便签' }}</span>
          </button>
          <button type="button" class="context-menu-item" @click="toggleContextNoteArchive">
            <i :class="noteContextMenu.note?.is_archived ? 'fas fa-rotate-left' : 'fas fa-box-archive'" aria-hidden="true"></i>
            <span>{{ noteContextMenu.note?.is_archived ? '恢复便签' : '归档便签' }}</span>
          </button>
          <div class="context-menu-divider" role="separator"></div>
          <button type="button" class="context-menu-item danger" @click="deleteContextNote">
            <i class="fas fa-trash" aria-hidden="true"></i>
            <span>删除便签</span>
          </button>
        </div>
      </div>

      <!-- Sidebar Resizer -->
      <div
        class="sidebar-resizer"
        :class="{ resizing: isResizing }"
        @mousedown="startResize"
      ></div>

      <!-- Right Editor Area -->
      <div class="notepad-editor-area">
        <!-- Empty state when no note selected -->
        <div v-if="!selectedNote" class="editor-empty">
          <div class="empty-content">
            <i class="fas fa-sticky-note"></i>
            <p>选择一个便签开始编辑</p>
            <span>或</span>
            <button class="btn-create" @click="createNewNote">
              <i class="fas fa-plus"></i>
              创建新便签
            </button>
          </div>
        </div>

        <!-- Editor when note selected -->
        <template v-else>
          <div class="editor-header">
            <div class="editor-toolbar">
              <button
                class="toolbar-btn"
                :class="{ active: selectedNote.is_pinned }"
                @click="togglePin"
                :title="selectedNote.is_pinned ? '取消置顶' : '置顶'"
              >
                <i class="fas fa-thumbtack"></i>
              </button>

              <!-- Category selector for note -->
              <div class="note-category-selector">
                <select v-model="selectedNoteCategory" @change="updateNoteCategory" class="category-dropdown">
                  <option value="">无分类</option>
                  <option v-for="cat in categories" :key="cat.name" :value="cat.name">
                    {{ cat.name }}
                  </option>
                </select>
              </div>

              <div class="note-project-selector" ref="projectSelectorRef">
                <button
                  type="button"
                  class="project-selector-btn"
                  :class="{ active: selectedNoteProjectIds.length > 0 }"
                  @click="showProjectSelector = !showProjectSelector"
                  title="关联项目"
                >
                  <i class="fas fa-link"></i>
                  <span>{{ selectedProjectLabel }}</span>
                </button>
                <div v-if="showProjectSelector" class="project-selector-panel">
                  <label
                    v-for="proj in activeProjectOptions"
                    :key="proj.id"
                    class="project-option"
                  >
                    <input
                      type="checkbox"
                      :value="proj.id"
                      :checked="selectedNoteProjectIds.includes(proj.id)"
                      @change="toggleNoteProject(proj.id, $event.target.checked)"
                    />
                    <span>{{ proj.name }}</span>
                  </label>
                  <div v-if="activeProjectOptions.length === 0" class="project-selector-empty">
                    暂无项目
                  </div>
                </div>
              </div>

              <div v-show="!toolbarCollapsed" class="editor-toolbar-tools">
              <div class="markdown-toolbar" aria-label="Markdown 快速格式">
                <button type="button" class="toolbar-btn markdown-btn markdown-text-btn" @mousedown.prevent @click="applyMarkdownCommand('heading1')" title="一级标题">
                  H1
                </button>
                <button type="button" class="toolbar-btn markdown-btn markdown-text-btn" @mousedown.prevent @click="applyMarkdownCommand('heading2')" title="二级标题">
                  H2
                </button>
                <button type="button" class="toolbar-btn markdown-btn markdown-text-btn" @mousedown.prevent @click="applyMarkdownCommand('heading3')" title="三级标题">
                  H3
                </button>
                <span class="toolbar-divider"></span>
                <button type="button" class="toolbar-btn markdown-btn" @mousedown.prevent @click="applyMarkdownCommand('bold')" title="加粗">
                  <i class="fas fa-bold"></i>
                </button>
                <button type="button" class="toolbar-btn markdown-btn" @mousedown.prevent @click="applyMarkdownCommand('italic')" title="斜体">
                  <i class="fas fa-italic"></i>
                </button>
                <button type="button" class="toolbar-btn markdown-btn" @mousedown.prevent @click="applyMarkdownCommand('strikethrough')" title="删除线">
                  <i class="fas fa-strikethrough"></i>
                </button>
                <button type="button" class="toolbar-btn markdown-btn" @mousedown.prevent @click="applyMarkdownCommand('underline')" title="下划线">
                  <i class="fas fa-underline"></i>
                </button>
                <button type="button" class="toolbar-btn markdown-btn markdown-math-btn" @mousedown.prevent @click="applyMarkdownCommand('inlineMath')" title="行内公式">
                  fx
                </button>
                <button type="button" class="toolbar-btn markdown-btn markdown-math-btn" @mousedown.prevent @click="applyMarkdownCommand('displayMath')" title="块级公式">
                  $$
                </button>
                <button type="button" class="toolbar-btn markdown-btn" @mousedown.prevent @click="applyMarkdownCommand('table')" title="插入表格">
                  <i class="fas fa-table"></i>
                </button>
                <span class="toolbar-divider"></span>
                <button type="button" class="toolbar-btn markdown-btn markdown-color-btn" @mousedown.prevent @click="applyMarkdownCommand('highlightYellow')" title="黄色色块">
                  <span class="color-swatch color-swatch-yellow"></span>
                </button>
                <button type="button" class="toolbar-btn markdown-btn markdown-color-btn" @mousedown.prevent @click="applyMarkdownCommand('highlightOrange')" title="橙色色块">
                  <span class="color-swatch color-swatch-orange"></span>
                </button>
                <button type="button" class="toolbar-btn markdown-btn markdown-color-btn" @mousedown.prevent @click="applyMarkdownCommand('highlightPink')" title="粉色色块">
                  <span class="color-swatch color-swatch-pink"></span>
                </button>
                <button type="button" class="toolbar-btn markdown-btn markdown-color-btn" @mousedown.prevent @click="applyMarkdownCommand('highlightPurple')" title="紫色色块">
                  <span class="color-swatch color-swatch-purple"></span>
                </button>
                <button type="button" class="toolbar-btn markdown-btn markdown-color-btn" @mousedown.prevent @click="applyMarkdownCommand('highlightBlue')" title="蓝色色块">
                  <span class="color-swatch color-swatch-blue"></span>
                </button>
                <button type="button" class="toolbar-btn markdown-btn markdown-color-btn" @mousedown.prevent @click="applyMarkdownCommand('highlightGreen')" title="绿色色块">
                  <span class="color-swatch color-swatch-green"></span>
                </button>
                <span class="toolbar-divider"></span>
                <button type="button" class="toolbar-btn markdown-btn" @mousedown.prevent @click="applyMarkdownCommand('bulletList')" title="无序列表">
                  <i class="fas fa-list-ul"></i>
                </button>
                <button type="button" class="toolbar-btn markdown-btn" @mousedown.prevent @click="applyMarkdownCommand('orderedList')" title="有序列表">
                  <i class="fas fa-list-ol"></i>
                </button>
                <button type="button" class="toolbar-btn markdown-btn" @mousedown.prevent @click="applyMarkdownCommand('todo')" title="待办列表">
                  <i class="fas fa-tasks"></i>
                </button>
                <button type="button" class="toolbar-btn markdown-btn" @mousedown.prevent @click="applyMarkdownCommand('quote')" title="引用">
                  <i class="fas fa-quote-left"></i>
                </button>
                <span class="toolbar-divider"></span>
                <button type="button" class="toolbar-btn markdown-btn" @mousedown.prevent @click="applyMarkdownCommand('outdent')" title="减少缩进">
                  <i class="fas fa-outdent"></i>
                </button>
                <button type="button" class="toolbar-btn markdown-btn" @mousedown.prevent @click="applyMarkdownCommand('indent')" title="增加缩进">
                  <i class="fas fa-indent"></i>
                </button>
              </div>

              <div class="editor-mode-switch" role="tablist" aria-label="编辑模式">
                <button
                  type="button"
                  class="toolbar-btn mode-btn"
                  :class="{ active: editorMode === 'edit' }"
                  @click="setEditorMode('edit')"
                  title="编辑"
                >
                  <i class="fas fa-pen"></i>
                </button>
                <button
                  type="button"
                  class="toolbar-btn mode-btn"
                  :class="{ active: editorMode === 'split' }"
                  @click="setEditorMode('split')"
                  title="分屏"
                >
                  <i class="fas fa-columns"></i>
                </button>
                <button
                  type="button"
                  class="toolbar-btn mode-btn"
                  :class="{ active: editorMode === 'preview' }"
                  @click="setEditorMode('preview')"
                  title="预览"
                >
                  <i class="fas fa-eye"></i>
                </button>
              </div>

              <div class="toolbar-spacer"></div>

              <button
                class="toolbar-btn apple-notes-btn"
                :class="{ active: selectedNote.apple_note_id }"
                :disabled="isSyncingAppleNotes"
                @click="syncCurrentNoteToAppleNotes"
                :title="appleNotesButtonTitle"
              >
                <i :class="isSyncingAppleNotes ? 'fas fa-spinner fa-spin' : 'fas fa-upload'"></i>
              </button>

              <button
                class="toolbar-btn pdf-export-btn"
                :disabled="isExportingPdf"
                @click="exportCurrentNoteToPdf"
                :title="isExportingPdf ? '正在导出 PDF...' : '导出为 PDF'"
              >
                <i :class="isExportingPdf ? 'fas fa-spinner fa-spin' : 'fas fa-file-pdf'"></i>
              </button>

              <button
                class="toolbar-btn archive-btn"
                @click="toggleArchiveCurrentNote"
                :title="selectedNote.is_archived ? '恢复便签' : '归档便签'"
              >
                <i :class="selectedNote.is_archived ? 'fas fa-rotate-left' : 'fas fa-box-archive'"></i>
              </button>

              <button class="toolbar-btn delete-btn" @click="deleteCurrentNote" title="删除">
                <i class="fas fa-trash"></i>
              </button>
              </div>

              <button
                type="button"
                class="toolbar-collapse-btn"
                :class="{ 'is-collapsed': toolbarCollapsed }"
                :title="toolbarCollapsed ? '展开格式工具栏' : '收起格式工具栏'"
                :aria-expanded="!toolbarCollapsed"
                @click="toggleToolbar"
              >
                <i class="fas" :class="toolbarCollapsed ? 'fa-chevron-down' : 'fa-chevron-up'" aria-hidden="true"></i>
              </button>
            </div>
          </div>

          <div class="editor-body">
            <div ref="workspaceRef" class="editor-workspace" :class="`mode-${editorMode}`">
              <transition name="editor-mode-panel">
                <MarkdownTextareaEditor
                  v-if="editorMode !== 'preview'"
                  ref="contentRef"
                  v-model:title="editTitle"
                  v-model="editContent"
                  :note-id="selectedNote?.id"
                  placeholder="开始写作..."
                  :font-size="editorFontSize"
                  :style="editorMode === 'split' ? { flex: `${splitRatio} 1 0%`, minWidth: '0' } : { flex: '1 1 0%', minWidth: '0' }"
                  @input="onEditorInput"
                  @save="flushPendingSave"
                  @locate-request="handleEditorLocateRequest"
                  @pointerenter="activeZoomPane = 'editor'"
                  @focusin="activeZoomPane = 'editor'"
                  @wheel="handleZoomWheel('editor', $event)"
                />
              </transition>
              <div
                v-if="editorMode === 'split'"
                class="editor-split-resizer"
                @mousedown="startResizeSplit"
              >
                <div class="resizer-grip"></div>
              </div>
              <transition name="editor-mode-panel">
                <MarkdownPreviewPane
                  v-if="editorMode !== 'edit'"
                  ref="previewRef"
                  :content="editContent"
                  :editable="editorMode === 'preview'"
                  :image-base-dir="imageBaseDir"
                  :font-size="previewFontSize"
                  :style="editorMode === 'split' ? { flex: `${1 - splitRatio} 1 0%`, minWidth: '0' } : { flex: '1 1 0%', minWidth: '0' }"
                  @update:content="editContent = $event"
                  @input="onEditorInput"
                  @jump-to-line="handleJumpToLine"
                  @selection-change="handlePreviewSelectionChange"
                  @locate-request="handlePreviewLocateRequest"
                  @pointerenter="activeZoomPane = 'preview'"
                  @focusin="activeZoomPane = 'preview'"
                  @wheel="handleZoomWheel('preview', $event)"
                />
              </transition>
            </div>
          </div>

          <div class="editor-footer">
            <div class="footer-left">
              <transition name="save-status" mode="out-in">
                <span
                  v-if="saveStatusText"
                  :key="saveState"
                  class="save-status-text"
                  :class="`state-${saveState}`"
                  :role="saveState === 'error' ? 'button' : undefined"
                  :tabindex="saveState === 'error' ? 0 : undefined"
                  @click="saveState === 'error' && flushPendingSave()"
                  @keydown.enter="saveState === 'error' && flushPendingSave()"
                >
                  {{ saveStatusText }}
                </span>
              </transition>
              <span v-if="appleSyncMessage" class="apple-sync-status">
                <i class="fas fa-upload"></i>
                {{ appleSyncMessage }}
              </span>
              <span v-if="pdfExportMessage" class="apple-sync-status pdf-export-status">
                <i class="fas fa-file-pdf"></i>
                {{ pdfExportMessage }}
              </span>
            </div>
            <div class="footer-right">
              <span v-if="editorZoom !== 1 || previewZoom !== 1" class="zoom-status">
                编辑 {{ Math.round(editorZoom * 100) }}% · 预览 {{ Math.round(previewZoom * 100) }}%
              </span>
              <span>{{ charCount }} 字</span>
              <span>{{ formatFullDate(selectedNote.updated_at) }}</span>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, onUnmounted, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { useNotepadStore } from '@stores/notepad-store'
import { useProjectStore } from '@stores/project-store'
import { useUndoStore } from '@stores/undo-store'
import { extractPreview } from '@utils/markdown.js'
import { format, parseISO } from 'date-fns'
import MarkdownTextareaEditor from '@components/MarkdownTextareaEditor.vue'
import MarkdownPreviewPane from '@components/MarkdownPreviewPane.vue'
import { useAutosaveNote } from '@composables/useAutosaveNote.js'
import { applyMarkdownCommandToValue } from '@composables/useMarkdownCommands.js'

const route = useRoute()
const notepadStore = useNotepadStore()
const projectStore = useProjectStore()
const undoStore = useUndoStore()

// The view is unmounted on every route change, so the panel, filters and mode
// the user left behind are restored from localStorage. Only UI state lives
// here — note content stays in the database.
const UI_STATE_KEY = 'bongmaster-notepad-ui-state'
const EDITOR_MODES = ['edit', 'split', 'preview']

// Sidebar state
const sidebarWidth = ref(260)
const isResizing = ref(false)
const listRef = ref(null)
const searchQuery = ref('')
const noteArchiveMode = ref('active')
const FILTERS_COLLAPSED_KEY = 'bongmaster:notepad-filters-collapsed'
const filtersCollapsed = ref(localStorage.getItem(FILTERS_COLLAPSED_KEY) === '1')
const hasActiveFilters = computed(() => Boolean(selectedCategory.value || selectedProjectFilter.value || searchQuery.value.trim()))
const toggleFilters = () => {
  filtersCollapsed.value = !filtersCollapsed.value
  localStorage.setItem(FILTERS_COLLAPSED_KEY, filtersCollapsed.value ? '1' : '0')
}

// Category state
const categories = ref([])
const selectedCategory = ref('')
const selectedProjectFilter = ref('')
const showCategoryManager = ref(false)
const newCategoryName = ref('')
const TOOLBAR_COLLAPSED_KEY = 'bongmaster:notepad-toolbar-collapsed'
const toolbarCollapsed = ref(localStorage.getItem(TOOLBAR_COLLAPSED_KEY) === '1')
const toggleToolbar = () => {
  toolbarCollapsed.value = !toolbarCollapsed.value
  localStorage.setItem(TOOLBAR_COLLAPSED_KEY, toolbarCollapsed.value ? '1' : '0')
}

// Editor state
const selectedNote = ref(null)
const editTitle = ref('')
const editContent = ref('')
const contentRef = ref(null)
const selectedNoteCategory = ref('')
const selectedNoteProjectIds = ref([])
const showProjectSelector = ref(false)
const projectSelectorRef = ref(null)
const isSyncingAppleNotes = ref(false)
const appleSyncMessage = ref('')
const isExportingPdf = ref(false)
const pdfExportMessage = ref('')
const editorMode = ref('preview')
const imageBaseDir = ref('')
const saveState = ref('idle') // idle, dirty, saving, saved, error
const workspaceRef = ref(null)
const splitRatio = ref(0.5)

const NOTE_FONT_SIZE = 13
const ZOOM_MIN = 0.75
const ZOOM_MAX = 2.5
const ZOOM_KEY = 'bongmaster:notepad:zoom'
const readZoomMap = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(ZOOM_KEY) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}
const zoomByNote = readZoomMap()
const editorZoom = ref(1)
const previewZoom = ref(1)
const activeZoomPane = ref('editor')
const editorFontSize = computed(() => Math.round(NOTE_FONT_SIZE * editorZoom.value * 10) / 10)
const previewFontSize = computed(() => Math.round(NOTE_FONT_SIZE * previewZoom.value * 10) / 10)
const clampZoom = value => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(Number(value) * 100) / 100))

const loadZoomForNote = id => {
  const saved = id ? zoomByNote[String(id)] : null
  editorZoom.value = clampZoom(saved?.editor ?? 1)
  previewZoom.value = clampZoom(saved?.preview ?? 1)
}

const persistZoomForNote = () => {
  const id = selectedNote.value?.id
  if (!id) return
  zoomByNote[String(id)] = {
    editor: editorZoom.value,
    preview: previewZoom.value
  }
  try {
    localStorage.setItem(ZOOM_KEY, JSON.stringify(zoomByNote))
  } catch {}
}

const resolveZoomPane = () => {
  if (editorMode.value === 'edit') return 'editor'
  if (editorMode.value === 'preview') return 'preview'
  return activeZoomPane.value
}

const applyNoteZoom = (pane, delta) => {
  if (pane === 'editor') editorZoom.value = clampZoom(editorZoom.value + delta)
  else previewZoom.value = clampZoom(previewZoom.value + delta)
  persistZoomForNote()
}

const resetNoteZoom = pane => {
  if (pane === 'editor') editorZoom.value = 1
  else previewZoom.value = 1
  persistZoomForNote()
}

let lastWheelZoomAt = 0
const handleZoomWheel = (pane, event) => {
  if (!event.ctrlKey) return
  event.preventDefault()
  event.stopPropagation()
  if (!event.deltaY) return
  const now = Date.now()
  if (now - lastWheelZoomAt < 50) return
  lastWheelZoomAt = now
  activeZoomPane.value = pane
  applyNoteZoom(pane, event.deltaY < 0 ? 0.1 : -0.1)
}

const handleZoomKey = event => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return false
  const key = event.key
  const code = event.code
  const zoomIn = key === '+' || key === '=' || code === 'Equal' || code === 'NumpadAdd'
  const zoomOut = key === '-' || key === '_' || code === 'Minus' || code === 'NumpadSubtract'
  const zoomReset = key === '0' || code === 'Digit0' || code === 'Numpad0'
  if (!zoomIn && !zoomOut && !zoomReset) return false
  event.preventDefault()
  event.stopPropagation()
  const pane = resolveZoomPane()
  if (zoomIn) applyNoteZoom(pane, 0.1)
  else if (zoomOut) applyNoteZoom(pane, -0.1)
  else resetNoteZoom(pane)
  return true
}

watch(
  () => selectedNote.value?.id,
  id => loadZoomForNote(id),
  { immediate: true }
)

const previewRef = ref(null)
const previewSelection = ref(null)
const noteContextMenu = ref({ visible: false, x: 0, y: 0, note: null })
let noteRefreshTimer = null

const getSaveSnapshot = () => ({
  noteId: selectedNote.value?.id ?? null,
  title: editTitle.value,
  content: editContent.value,
  is_pinned: selectedNote.value?.is_pinned ?? false,
  category: selectedNoteCategory.value,
  project_ids: [...selectedNoteProjectIds.value]
})

const autosave = useAutosaveNote({
  getSnapshot: getSaveSnapshot,
  saveSnapshot: async (snapshot) => {
    if (!snapshot.noteId) return null
    return notepadStore.updateNote(snapshot.noteId, {
      title: snapshot.title,
      content: snapshot.content,
      is_pinned: snapshot.is_pinned,
      category: snapshot.category,
      project_ids: snapshot.project_ids
    })
  },
  delay: 900,
  onStateChange: (state) => {
    saveState.value = state
  },
  onSaved: (savedNote) => {
    if (savedNote && selectedNote.value?.id === savedNote.id) {
      selectedNote.value = { ...selectedNote.value, ...savedNote }
      selectedNoteCategory.value = savedNote.category || ''
    }
  },
  onError: (error) => {
    console.error('[NotepadView] autosave error:', error)
  }
})

// Computed
const activeNoteCount = computed(() => notepadStore.unarchivedNotes.length)
const archivedNoteCount = computed(() => notepadStore.archivedNotes.length)

const filteredNotes = computed(() => {
  let notes = noteArchiveMode.value === 'archived'
    ? notepadStore.archivedNotes
    : notepadStore.unarchivedNotes
  // Filter by category first
  if (selectedCategory.value) {
    notes = notes.filter(n => n.category === selectedCategory.value)
  }
  if (selectedProjectFilter.value === '__unlinked__') {
    notes = notes.filter(n => !Array.isArray(n.project_ids) || n.project_ids.length === 0)
  } else if (selectedProjectFilter.value) {
    const projectId = Number(selectedProjectFilter.value)
    notes = notes.filter(n => Array.isArray(n.project_ids) && n.project_ids.includes(projectId))
  }
  // Then filter by search query
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    notes = notes.filter(n =>
      (n.title && n.title.toLowerCase().includes(query)) ||
      (n.content && n.content.toLowerCase().includes(query))
    )
  }
  return notes
})

const sidebarEmptyText = computed(() => {
  if (searchQuery.value) return '没有找到匹配的便签'
  return noteArchiveMode.value === 'archived' ? '归档箱是空的' : '还没有便签'
})

const searchPlaceholder = computed(() =>
  noteArchiveMode.value === 'archived' ? '搜索归档便签...' : '搜索便签...'
)

const charCount = computed(() => {
  return editContent.value?.length || 0
})

const appleNotesButtonTitle = computed(() => {
  if (isSyncingAppleNotes.value) return '正在同步 Apple Notes...'
  return selectedNote.value?.apple_note_id ? '更新 Apple Notes' : '迁移到 Apple Notes'
})

const saveStatusText = computed(() => ({
  saving: '保存中...',
  saved: '已保存',
  dirty: '未保存',
  error: '保存失败'
}[saveState.value] || ''))

const projectOptions = computed(() => projectStore.projects || [])
const activeProjectOptions = computed(() =>
  projectOptions.value.filter(project => project.status === '进行中')
)

const selectedProjectLabel = computed(() => {
  if (selectedNoteProjectIds.value.length === 0) return '无项目'
  if (selectedNoteProjectIds.value.length === 1) {
    const project = projectOptions.value.find(p => p.id === selectedNoteProjectIds.value[0])
    return project?.name || '1 个项目'
  }
  return `${selectedNoteProjectIds.value.length} 个项目`
})

// Category methods
const fetchCategories = async () => {
  try {
    const result = await window.electronAPI.getCategories()
    categories.value = result || []
  } catch (err) {
    console.error('[NotepadView] fetchCategories error:', err)
    categories.value = []
  }
}

const createCategory = async () => {
  const name = newCategoryName.value.trim()
  if (!name) return
  try {
    const result = await window.electronAPI.createCategory(name)
    if (result.success) {
      await fetchCategories()
      newCategoryName.value = ''
    } else if (result.error) {
      alert(result.error)
    }
  } catch (err) {
    console.error('[NotepadView] createCategory error:', err)
    alert('创建分类失败: ' + err.message)
  }
}

const deleteCategory = async (name) => {
  if (!confirm(`确定要删除分类 "${name}" 吗？该分类下的便签将变为无分类。`)) {
    return
  }
  try {
    await window.electronAPI.deleteCategory(name)
    await fetchCategories()
    // If the deleted category was selected, reset to all
    if (selectedCategory.value === name) {
      selectedCategory.value = ''
    }
    // Refresh notes to update categories
    await notepadStore.fetchNotes()
  } catch (err) {
    console.error('[NotepadView] deleteCategory error:', err)
    alert('删除分类失败: ' + err.message)
  }
}

const closeCategoryManager = () => {
  showCategoryManager.value = false
  newCategoryName.value = ''
}

const selectedNoteBelongsToMode = () => {
  if (!selectedNote.value) return false
  return Boolean(selectedNote.value.is_archived) === (noteArchiveMode.value === 'archived')
}

const setNoteArchiveMode = async (mode) => {
  if (mode !== 'active' && mode !== 'archived') return
  if (noteArchiveMode.value === mode) return

  await autosave.flushSave()
  noteArchiveMode.value = mode
  if (!selectedNoteBelongsToMode()) {
    selectedNote.value = null
    editTitle.value = ''
    editContent.value = ''
    selectedNoteCategory.value = ''
    selectedNoteProjectIds.value = []
  }
}

const updateNoteCategory = async () => {
  if (!selectedNote.value) return
  try {
    await autosave.flushSave()
    await window.electronAPI.updateNoteCategory(selectedNote.value.id, selectedNoteCategory.value)
    // Update local note
    selectedNote.value.category = selectedNoteCategory.value
    // Refresh store
    await notepadStore.fetchNotes()
  } catch (err) {
    console.error('[NotepadView] updateNoteCategory error:', err)
  }
}

// Methods
const formatDate = (dateStr) => {
  if (!dateStr) return ''
  try {
    const date = parseISO(dateStr)
    const now = new Date()
    const isToday = date.toDateString() === now.toDateString()
    const isYesterday = new Date(now - 86400000).toDateString() === date.toDateString()

    if (isToday) return format(date, 'HH:mm')
    if (isYesterday) return '昨天'
    return format(date, 'M月d日')
  } catch {
    return ''
  }
}

const formatFullDate = (dateStr) => {
  if (!dateStr) return ''
  try {
    return format(parseISO(dateStr), 'yyyy年M月d日 HH:mm')
  } catch {
    return ''
  }
}

// Extract plain text preview for sidebar list
const renderMarkdownPreview = (content) => {
  if (!content) return '无内容'
  return extractPreview(content, 120)
}

const applyNoteSelection = (note) => {
  // Shallow copy so the editor works on a plain object it owns.
  selectedNote.value = { ...note }
  editTitle.value = note.title || ''
  editContent.value = note.content || ''
  selectedNoteCategory.value = note.category || ''
  selectedNoteProjectIds.value = Array.isArray(note.project_ids) ? [...note.project_ids] : []
  previewSelection.value = null
  showProjectSelector.value = false
  autosave.cancelSave()
}

const selectNote = async (note, options = {}) => {
  closeNoteContextMenu()
  // Capture the outgoing note before the editor switches, then let that save
  // finish in the background: callers (context menu right-click) need the new
  // note applied inside their own event, not after a save round-trip.
  const outgoingSnapshot = autosave.isDirty() ? getSaveSnapshot() : null
  const flushing = outgoingSnapshot ? autosave.flushSave(outgoingSnapshot) : null

  // 离开便签时记住它的阅读位置，回来时（同一会话内）恢复；同一便签重复点选不动。
  const noteChanged = selectedNote.value?.id !== note.id
  if (noteChanged && selectedNote.value) {
    const position = captureContentPosition()
    if (position) scrollPositions.set(selectedNote.value.id, position)
  }

  // Opening another note lands in the eye preview (reading first); callers can
  // ask for a specific mode (a brand-new note opens in edit) or keep the
  // current one (restoring the note the user left behind on a tab switch).
  if (noteChanged && !options.keepMode) {
    editorMode.value = options.mode || 'preview'
  }

  applyNoteSelection(note)

  if (flushing) await flushing

  // Focus content area after a short delay, unless the caller keeps the caret
  // where it is (the editor would scroll and dismiss an open menu).
  if (options.focus === false) return

  nextTick(() => {
    if (contentRef.value) {
      contentRef.value.focus()
    }
    // 放在 focus 之后：聚焦会把 textarea 滚到光标处（正文末尾），会盖掉恢复的位置。
    if (noteChanged) restoreNoteScroll(note.id)
  })
}

const createNewNote = async () => {
  if (noteArchiveMode.value === 'archived') {
    noteArchiveMode.value = 'active'
  }
  const projectIds = selectedProjectFilter.value && selectedProjectFilter.value !== '__unlinked__'
    ? [Number(selectedProjectFilter.value)]
    : []
  const note = await notepadStore.createNote({
    title: '',
    content: '',
    category: selectedCategory.value || '',
    project_ids: projectIds
  })

  if (note) {
    await selectNote(note, { mode: 'edit' })
    // Focus title for new note
    nextTick(() => {
      if (contentRef.value) {
        contentRef.value.focusTitle()
      }
    })
  }
}

const onEditorInput = () => {
  autosave.markDirty()
}

const saveCurrentNote = async () => {
  const result = await autosave.flushSave()
  return result?.saved ? selectedNote.value : null
}

const applyMarkdownCommand = (command) => {
  // Preview mode edits the rendered pane; edit/split edit the raw textarea.
  if (editorMode.value === 'preview') {
    previewRef.value?.applyCommand?.(command)
    return
  }

  if (contentRef.value) {
    contentRef.value.applyCommand?.(command)
    return
  }

  const selection = previewSelection.value
  if (!selection || selection.noteId !== selectedNote.value?.id) return

  const result = applyMarkdownCommandToValue(
    editContent.value,
    selection.start,
    selection.end,
    command
  )
  if (result.value === editContent.value) return

  editContent.value = result.value
  previewSelection.value = {
    noteId: selection.noteId,
    start: result.selectionStart,
    end: result.selectionEnd
  }
  autosave.markDirty()
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function appendMappedChar(target, char, sourceIndex) {
  target.text += char
  target.map.push(sourceIndex)
}

function findClosingParen(source, start) {
  let depth = 0
  for (let i = start; i < source.length; i++) {
    if (source[i] === '\\') {
      i += 1
      continue
    }
    if (source[i] === '(') depth += 1
    if (source[i] === ')') {
      if (depth === 0) return i
      depth -= 1
    }
  }
  return -1
}

function getMarkdownLinePrefixLength(line) {
  const heading = line.match(/^#{1,6}\s+/)
  if (heading) return heading[0].length

  const quote = line.match(/^>\s?/)
  if (quote) return quote[0].length

  const task = line.match(/^\s{0,3}[-*+]\s+\[[ xX]\]\s+/)
  if (task) return task[0].length

  const unordered = line.match(/^\s{0,3}[-*+]\s+/)
  if (unordered) return unordered[0].length

  const ordered = line.match(/^\s{0,3}\d+\.\s+/)
  if (ordered) return ordered[0].length

  return 0
}

function isTableSeparatorLine(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)
}

function buildMarkdownPlainTextMap(source) {
  const result = { text: '', map: [] }
  let i = 0
  let isLineStart = true
  let inFence = false
  let fenceMarker = ''

  while (i < source.length) {
    if (isLineStart) {
      const lineEnd = source.indexOf('\n', i)
      const end = lineEnd === -1 ? source.length : lineEnd
      const line = source.slice(i, end)
      const fence = line.match(/^\s*(`{3,}|~{3,})/)

      if (fence) {
        const marker = fence[1][0]
        if (!inFence) {
          inFence = true
          fenceMarker = marker
        } else if (marker === fenceMarker) {
          inFence = false
          fenceMarker = ''
        }
        i = lineEnd === -1 ? source.length : lineEnd + 1
        isLineStart = true
        continue
      }

      if (!inFence && isTableSeparatorLine(line)) {
        i = lineEnd === -1 ? source.length : lineEnd + 1
        isLineStart = true
        continue
      }

      if (!inFence) {
        i += getMarkdownLinePrefixLength(line)
      }
    }

    const char = source[i]

    if (char === '\n') {
      appendMappedChar(result, char, i)
      i += 1
      isLineStart = true
      continue
    }

    isLineStart = false

    if (!inFence && char === '\\' && /[\\`*_[\]()>#+\-.!|{}]/.test(source[i + 1] || '')) {
      appendMappedChar(result, source[i + 1], i + 1)
      i += 2
      continue
    }

    if (!inFence && source.startsWith('![', i)) {
      const altEnd = source.indexOf(']', i + 2)
      if (altEnd !== -1 && source[altEnd + 1] === '(') {
        const imageEnd = findClosingParen(source, altEnd + 2)
        if (imageEnd !== -1) {
          i = imageEnd + 1
          continue
        }
      }
    }

    if (!inFence && char === '[') {
      const labelEnd = source.indexOf(']', i + 1)
      if (labelEnd !== -1 && source[labelEnd + 1] === '(') {
        i += 1
        continue
      }
    }

    if (!inFence && char === ']' && source[i + 1] === '(') {
      const linkEnd = findClosingParen(source, i + 2)
      if (linkEnd !== -1) {
        i = linkEnd + 1
        continue
      }
    }

    if (!inFence && char === '<') {
      const tagEnd = source.indexOf('>', i + 1)
      const tag = tagEnd !== -1 ? source.slice(i, tagEnd + 1) : ''
      if (/^<\/?[A-Za-z][^>]*>$/.test(tag) || /^<!--[\s\S]*-->$/.test(tag)) {
        i = tagEnd + 1
        continue
      }
    }

    if (!inFence) {
      const twoCharMarker = source.slice(i, i + 2)
      if ((twoCharMarker === '**' || twoCharMarker === '__' || twoCharMarker === '~~') && source.indexOf(twoCharMarker, i + 2) !== -1) {
        i += 2
        continue
      }
      if ((char === '*' || char === '_' || char === '`' || char === '$') && source.indexOf(char, i + 1) !== -1) {
        i += 1
        continue
      }
      if (char === '|' && source.slice(source.lastIndexOf('\n', i) + 1, source.indexOf('\n', i) === -1 ? source.length : source.indexOf('\n', i)).includes('|')) {
        i += 1
        continue
      }
    }

    appendMappedChar(result, char, i)
    i += 1
  }

  return result
}

function normalizePreviewText(value) {
  return (value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
}

function findMappedPreviewRange(plainText, { selectedText, before, after, startOffset, endOffset }) {
  const hasOffsets = Number.isInteger(startOffset) && Number.isInteger(endOffset)
  if (hasOffsets && startOffset >= 0 && endOffset > startOffset && endOffset <= plainText.length) {
    const candidate = plainText.slice(startOffset, endOffset)
    if (normalizePreviewText(candidate) === normalizePreviewText(selectedText)) {
      return { start: startOffset, end: endOffset }
    }
  }

  const selected = selectedText || ''
  const needles = [selected, selected.trim()].filter(Boolean)
  const candidates = []

  for (const needle of [...new Set(needles)]) {
    let idx = plainText.indexOf(needle)
    while (idx !== -1) {
      candidates.push({ start: idx, end: idx + needle.length })
      idx = plainText.indexOf(needle, idx + Math.max(1, needle.length))
    }
  }

  if (!candidates.length && selected.trim()) {
    const pattern = new RegExp(escapeRegExp(selected.trim()).replace(/\s+/g, '\\s+'), 'g')
    let match
    while ((match = pattern.exec(plainText)) !== null) {
      candidates.push({ start: match.index, end: match.index + match[0].length })
    }
  }

  if (!candidates.length) return null

  let best = candidates[0]
  let bestScore = -1
  for (const candidate of candidates) {
    const ctxBefore = plainText.slice(Math.max(0, candidate.start - 40), candidate.start)
    const ctxAfter = plainText.slice(candidate.end, candidate.end + 40)
    let score = 0
    const beforeHint = before ? before.slice(-20) : ''
    const afterHint = after ? after.slice(0, 20) : ''
    if (beforeHint && ctxBefore.endsWith(beforeHint)) score += beforeHint.length
    if (afterHint && ctxAfter.startsWith(afterHint)) score += afterHint.length
    if (hasOffsets) score -= Math.abs(candidate.start - startOffset) / 100
    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  }

  return best
}

function mapPreviewSelectionToMarkdown(content, selection) {
  const plain = buildMarkdownPlainTextMap(content)
  const previewRange = findMappedPreviewRange(plain.text, selection)
  if (!previewRange) return null

  const start = plain.map[previewRange.start]
  const end = plain.map[Math.max(previewRange.start, previewRange.end - 1)] + 1
  if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) return null

  return { start, end }
}

function mapPreviewPointToMarkdown(content, selection) {
  const plain = buildMarkdownPlainTextMap(content)
  const previewRange = findMappedPreviewRange(plain.text, selection)
  if (!previewRange) return null

  const localOffset = Math.max(
    0,
    Math.min(selection.localOffset || 0, previewRange.end - previewRange.start)
  )
  const previewOffset = Math.min(
    plain.map.length - 1,
    previewRange.start + localOffset
  )
  const markdownOffset = plain.map[previewOffset]
  return Number.isInteger(markdownOffset) ? markdownOffset : null
}

function buildPreviewLocateContext(content, markdownOffset) {
  const plain = buildMarkdownPlainTextMap(content)
  if (!plain.text.length || !plain.map.length) return null

  let previewOffset = plain.map.findIndex(sourceOffset => sourceOffset >= markdownOffset)
  if (previewOffset === -1) {
    previewOffset = plain.map.length - 1
  }

  return {
    before: plain.text.slice(Math.max(0, previewOffset - 64), previewOffset),
    after: plain.text.slice(previewOffset, previewOffset + 64),
    offsetRatio: previewOffset / Math.max(1, plain.text.length - 1)
  }
}

const handleJumpToLine = ({ type, text }) => {
  if (type !== 'heading' || !text || editorMode.value === 'preview') return
  const lines = editContent.value.split('\n')
  const pattern = new RegExp(`^#{1,6}\\s+${escapeRegExp(text)}\\s*$`)
  const lineIndex = lines.findIndex(line => pattern.test(line.trim()))
  if (lineIndex !== -1) {
    nextTick(() => {
      contentRef.value?.scrollToLine(lineIndex)
    })
  }
}

const handlePreviewSelectionChange = ({ selectedText, before, after, startOffset, endOffset }) => {
  if (!selectedText || editorMode.value === 'edit') return

  const content = editContent.value
  if (!content || !selectedNote.value) return

  const mappedRange = mapPreviewSelectionToMarkdown(content, { selectedText, before, after, startOffset, endOffset })
  if (!mappedRange) return

  previewSelection.value = {
    noteId: selectedNote.value.id,
    start: mappedRange.start,
    end: mappedRange.end
  }

  if (editorMode.value === 'split') {
    nextTick(() => {
      contentRef.value?.setSelection(mappedRange.start, mappedRange.end)
    })
  }
}

const handleEditorLocateRequest = ({ offset }) => {
  if (!Number.isInteger(offset)) return
  const locateContext = buildPreviewLocateContext(editContent.value, offset)
  if (!locateContext) return

  if (editorMode.value === 'edit') {
    editorMode.value = 'split'
  }
  nextTick(() => {
    previewRef.value?.locateTextContext?.(locateContext)
  })
}

const handlePreviewLocateRequest = (selection) => {
  const markdownOffset = mapPreviewPointToMarkdown(editContent.value, selection)
  if (!Number.isInteger(markdownOffset)) return

  if (editorMode.value !== 'split') return
  nextTick(() => {
    contentRef.value?.locateOffset?.(markdownOffset)
  })
}

const closeNoteContextMenu = () => {
  noteContextMenu.value = { visible: false, x: 0, y: 0, note: null }
}

const openNoteContextMenu = (note, event) => {
  // Switch the note synchronously (the pending save runs in the background) so a
  // single contextmenu event both selects the note and opens the menu.
  selectNote(note, { focus: false })

  const menuWidth = 190
  const menuHeight = 230
  noteContextMenu.value = {
    visible: true,
    x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
    y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)),
    note: selectedNote.value
  }
}

const getContextNote = () => {
  const note = noteContextMenu.value.note
  return note && selectedNote.value?.id === note.id ? note : null
}

const copyContextNoteContent = async () => {
  const note = getContextNote()
  if (!note) return closeNoteContextMenu()
  await flushPendingSave()
  const content = selectedNote.value?.id === note.id ? editContent.value : note.content || ''
  try {
    await navigator.clipboard.writeText(content)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = content
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
  }
  closeNoteContextMenu()
}

const duplicateContextNote = async () => {
  const note = getContextNote()
  if (!note) return closeNoteContextMenu()
  await flushPendingSave()
  const duplicate = await notepadStore.createNote({
    title: `${note.title || '无标题'} 副本`,
    content: note.content || editContent.value || '',
    category: note.category || '',
    project_ids: Array.isArray(note.project_ids) ? [...note.project_ids] : []
  })
  closeNoteContextMenu()
  if (duplicate) {
    noteArchiveMode.value = 'active'
    await selectNote(duplicate)
  }
}

const toggleContextNotePin = async () => {
  const note = getContextNote()
  if (!note) return closeNoteContextMenu()
  await flushPendingSave()
  await notepadStore.togglePin(note.id)
  closeNoteContextMenu()
}

const toggleContextNoteArchive = async () => {
  const note = getContextNote()
  if (!note) return closeNoteContextMenu()
  const shouldArchive = !note.is_archived
  await flushPendingSave()
  await notepadStore.archiveNote(note.id, shouldArchive)
  closeNoteContextMenu()
  if (selectedNote.value?.id === note.id && shouldArchive !== (noteArchiveMode.value === 'archived')) {
    selectedNote.value = null
  }
}

// 单条删除不弹确认：删完在页面顶部给 5 秒撤回入口。
const deleteNoteWithUndo = async (note) => {
  if (!note) return false
  const snapshot = {
    ...note,
    project_ids: Array.isArray(note.project_ids) ? [...note.project_ids] : []
  }
  autosave.cancelSave()
  const deleted = await notepadStore.deleteNote(note.id)
  if (!deleted) return false

  undoStore.showUndo({
    message: `已删除便签「${snapshot.title || '未命名'}」`,
    undo: () => notepadStore.restoreDeletedNote(snapshot)
  })
  return true
}

const deleteContextNote = async () => {
  const note = getContextNote()
  if (!note) return closeNoteContextMenu()
  await deleteNoteWithUndo(note)
  closeNoteContextMenu()
  if (selectedNote.value?.id === note.id) selectedNote.value = null
}

const toggleNoteProject = async (projectId, checked) => {
  if (!selectedNote.value) return
  const nextIds = checked
    ? [...new Set([...selectedNoteProjectIds.value, projectId])]
    : selectedNoteProjectIds.value.filter(id => id !== projectId)

  selectedNoteProjectIds.value = nextIds
  await autosave.flushSave()
  const updated = await notepadStore.setNoteProjects(selectedNote.value.id, nextIds)
  if (updated) {
    selectedNote.value = { ...selectedNote.value, ...updated }
    selectedNoteProjectIds.value = Array.isArray(updated.project_ids) ? [...updated.project_ids] : []
  }
}

const setAppleSyncMessage = (message) => {
  appleSyncMessage.value = message
  setTimeout(() => {
    if (appleSyncMessage.value === message) {
      appleSyncMessage.value = ''
    }
  }, 3000)
}

const setPdfExportMessage = (message) => {
  pdfExportMessage.value = message
  setTimeout(() => {
    if (pdfExportMessage.value === message) {
      pdfExportMessage.value = ''
    }
  }, 3000)
}

const applySyncedNote = (note) => {
  if (!note) return
  selectedNote.value = { ...selectedNote.value, ...note }
  selectedNoteCategory.value = note.category || ''
}

const runAppleNotesSync = async (options = {}) => {
  const noteId = selectedNote.value.id
  const result = typeof notepadStore.syncToAppleNotes === 'function'
    ? await notepadStore.syncToAppleNotes(noteId, options)
    : await window.electronAPI.syncDesktopNoteToAppleNotes(noteId, options)

  if (result?.success) {
    if (result.note && typeof notepadStore.syncToAppleNotes !== 'function') {
      const index = notepadStore.notes.findIndex(n => n.id === noteId)
      if (index !== -1) {
        notepadStore.notes[index] = result.note
      }
    }
    applySyncedNote(result.note)
    const message = result.status === 'created' || result.status === 'recreated'
      ? '已迁移到 Apple Notes'
      : '已更新 Apple Notes'
    setAppleSyncMessage(message)
  }
  return result
}

const flushPendingSave = async () => {
  await autosave.flushSave()
}

const syncCurrentNoteToAppleNotes = async () => {
  if (!selectedNote.value || isSyncingAppleNotes.value) return

  try {
    isSyncingAppleNotes.value = true
    appleSyncMessage.value = ''

    await flushPendingSave()

    let result = await runAppleNotesSync()

    if (result?.status === 'conflict') {
      const shouldOverwrite = confirm('Apple Notes 中的对应便签自上次同步后被修改过。是否用 BongMaster 当前内容覆盖 Apple Notes？')
      if (shouldOverwrite) {
        result = await runAppleNotesSync({ force: true })
      }
    } else if (result?.status === 'not_found') {
      const shouldRecreate = confirm('Apple Notes 中的对应便签不存在。是否重新创建一条 Apple Notes 便签？')
      if (shouldRecreate) {
        result = await runAppleNotesSync({ recreate: true })
      }
    }

    if (result && !result.success && result.status !== 'conflict' && result.status !== 'not_found') {
      alert('同步 Apple Notes 失败: ' + (result.error || '未知错误'))
    }
  } catch (err) {
    console.error('[NotepadView] syncCurrentNoteToAppleNotes error:', err)
    alert('同步 Apple Notes 失败: ' + err.message)
  } finally {
    isSyncingAppleNotes.value = false
  }
}

const exportCurrentNoteToPdf = async () => {
  if (!selectedNote.value || isExportingPdf.value) return

  try {
    isExportingPdf.value = true
    pdfExportMessage.value = ''

    await flushPendingSave()

    const result = await window.electronAPI.exportDesktopNoteToPdf(selectedNote.value.id)
    if (result?.cancelled) return
    if (!result?.success) {
      alert('导出 PDF 失败: ' + (result?.error || '未知错误'))
      return
    }

    setPdfExportMessage('PDF 已导出')
  } catch (err) {
    console.error('[NotepadView] exportCurrentNoteToPdf error:', err)
    alert('导出 PDF 失败: ' + err.message)
  } finally {
    isExportingPdf.value = false
  }
}

const togglePin = async () => {
  if (!selectedNote.value) return
  await notepadStore.togglePin(selectedNote.value.id)
}

const deleteCurrentNote = async () => {
  if (!selectedNote.value) return
  const deleted = await deleteNoteWithUndo(selectedNote.value)
  if (deleted) selectedNote.value = null
}

const toggleArchiveCurrentNote = async () => {
  if (!selectedNote.value) return
  const shouldArchive = !selectedNote.value.is_archived

  await flushPendingSave()
  const noteId = selectedNote.value.id
  autosave.cancelSave()
  const updated = await notepadStore.archiveNote(noteId, shouldArchive)
  if (updated) {
    selectedNote.value = null
    editTitle.value = ''
    editContent.value = ''
    selectedNoteCategory.value = ''
    selectedNoteProjectIds.value = []
  }
}

const handleKeydown = (e) => {
  if (handleZoomKey(e)) return
  if (e.key === 'Escape') {
    closeNoteContextMenu()
    showProjectSelector.value = false
    return
  }
  // Ctrl/Cmd + S to save
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    flushPendingSave()
  }
}

const handleDocumentClick = (event) => {
  if (noteContextMenu.value.visible && !event.target.closest('.note-context-menu')) {
    closeNoteContextMenu()
  }
  if (showProjectSelector.value && projectSelectorRef.value && !projectSelectorRef.value.contains(event.target)) {
    showProjectSelector.value = false
  }
}

const handleContextMenuDismiss = (event) => {
  // Only the note list moves the menu's anchor. Scrolling elsewhere (the editor
  // scrolls programmatically when notes switch) must not dismiss the menu.
  if (event?.target?.closest?.('.sidebar-list')) {
    closeNoteContextMenu()
  }
}

// Sidebar resizing
const startResize = (e) => {
  isResizing.value = true
  const startX = e.clientX
  const startWidth = sidebarWidth.value

  const onMouseMove = (e) => {
    const newWidth = startWidth + e.clientX - startX
    sidebarWidth.value = Math.max(240, Math.min(480, newWidth))
  }

  const onMouseUp = () => {
    isResizing.value = false
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }

  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

// Split pane resizing
const startResizeSplit = (e) => {
  if (!workspaceRef.value) return
  const workspace = workspaceRef.value
  const rect = workspace.getBoundingClientRect()
  const resizerWidth = 14

  const onMouseMove = (e) => {
    const x = e.clientX - rect.left - resizerWidth / 2
    const ratio = x / (rect.width - resizerWidth)
    splitRatio.value = Math.max(0.25, Math.min(0.75, ratio))
  }

  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }

  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

// Lifecycle
const selectNoteById = async (noteId, options = {}) => {
  const note = notepadStore.notes.find(n => n.id === Number(noteId))
  if (!note) return false
  noteArchiveMode.value = note.is_archived ? 'archived' : 'active'
  await selectNote(note, options)
  return true
}

const selectNoteFromRoute = async () => {
  const noteId = Number(route.query.noteId)
  if (!noteId) return
  await selectNoteById(noteId)
}

// UI state persistence
const readUiState = () => {
  try {
    const raw = window.localStorage.getItem(UI_STATE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch (err) {
    console.error('[NotepadView] read UI state failed:', err)
    return null
  }
}

const listScrollEl = () => {
  const list = listRef.value
  return list?.$el || (list instanceof Element ? list : null)
}

const persistUiState = () => {
  try {
    const state = {
      noteId: selectedNote.value?.id ?? null,
      noteArchiveMode: noteArchiveMode.value,
      selectedCategory: selectedCategory.value,
      selectedProjectFilter: selectedProjectFilter.value,
      searchQuery: searchQuery.value,
      editorMode: editorMode.value,
      sidebarWidth: sidebarWidth.value,
      splitRatio: splitRatio.value
    }
    const listEl = listScrollEl()
    if (listEl) state.listScrollTop = listEl.scrollTop
    const pane = previewScrollEl()
    if (pane) state.previewScrollTop = pane.scrollTop
    window.localStorage.setItem(UI_STATE_KEY, JSON.stringify(state))
  } catch (err) {
    console.error('[NotepadView] persist UI state failed:', err)
  }
}

let persistTimer = null
const schedulePersistUiState = () => {
  if (persistTimer) return
  persistTimer = window.setTimeout(() => {
    persistTimer = null
    persistUiState()
  }, 300)
}

const restoreUiState = (state) => {
  if (!state) return
  if (Number.isFinite(state.sidebarWidth)) {
    sidebarWidth.value = Math.max(240, Math.min(480, state.sidebarWidth))
  }
  if (Number.isFinite(state.splitRatio)) {
    splitRatio.value = Math.max(0.25, Math.min(0.75, state.splitRatio))
  }
  if (EDITOR_MODES.includes(state.editorMode)) editorMode.value = state.editorMode
  if (state.noteArchiveMode === 'active' || state.noteArchiveMode === 'archived') {
    noteArchiveMode.value = state.noteArchiveMode
  }
  if (typeof state.selectedCategory === 'string') selectedCategory.value = state.selectedCategory
  if (typeof state.selectedProjectFilter === 'string') selectedProjectFilter.value = state.selectedProjectFilter
  if (typeof state.searchQuery === 'string') searchQuery.value = state.searchQuery
}

const applySavedScroll = (state) => {
  const listEl = listScrollEl()
  if (listEl && Number.isFinite(state.listScrollTop)) {
    listEl.scrollTop = state.listScrollTop
  }
  const pane = previewScrollEl()
  if (pane && Number.isFinite(state.previewScrollTop)) {
    pane.scrollTop = state.previewScrollTop
  }
}

const listScrollRange = () => {
  const listEl = listScrollEl()
  return listEl ? listEl.scrollHeight - listEl.clientHeight : null
}

const previewScrollEl = () => previewRef.value?.$el?.querySelector?.('.markdown-preview-scroll') || null

const previewScrollRange = () => {
  const pane = previewScrollEl()
  return pane ? pane.scrollHeight - pane.clientHeight : null
}

const scrollRestored = (state) => {
  const listEl = listScrollEl()
  if (listEl && Number.isFinite(state.listScrollTop) && listEl.scrollTop !== state.listScrollTop) return false
  const pane = previewScrollEl()
  if (pane && Number.isFinite(state.previewScrollTop) && pane.scrollTop !== state.previewScrollTop) return false
  return true
}

// The restore loop must never fight the user: the first interaction cancels it.
let cancelScrollRestore = null
const stopScrollRestore = () => {
  if (cancelScrollRestore) {
    cancelScrollRestore()
    cancelScrollRestore = null
  }
  cancelScheduledScrollSync()
}

const restoreScroll = (state) => {
  if (!state) return
  stopScrollRestore()
  nextTick(() => {
    applySavedScroll(state)
    // The list and the preview pane can still be settling right after mount: an
    // offset applied while either is shorter than its final size is clamped and
    // never comes back on its own, so keep applying until it sticks.
    let lastRange = null
    let stableFrames = 0
    let frames = 0
    let stopped = false
    cancelScrollRestore = () => { stopped = true }
    const step = () => {
      if (stopped) return
      const range = `${listScrollRange()}|${previewScrollRange()}`
      if (range !== lastRange || !scrollRestored(state)) {
        applySavedScroll(state)
        stableFrames = 0
      } else {
        stableFrames += 1
      }
      lastRange = range
      frames += 1
      if ((stableFrames >= 30 && scrollRestored(state)) || frames >= 180) return
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  })
}

// ---- 视图间滚动同步 ----
// 预览的 DOM 高度与源码 textarea 的行高不成比例（长表格、代码块、图片前后差得更多），
// 所以切换视图时以「可见内容锚点」为准：预览记顶部可见文本，源码记字符偏移，滚动比例只兜底。
// 每个便签记住离开时的位置：切走时存，切回时恢复，没打开过的便签从顶部开始。
const scrollPositions = new Map()

let scrollSyncRaf = null
let scrollSyncTimer = null

const clampRatio = (ratio) => (Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0)

const cancelScheduledScrollSync = () => {
  if (scrollSyncRaf !== null) {
    cancelAnimationFrame(scrollSyncRaf)
    scrollSyncRaf = null
  }
  if (scrollSyncTimer !== null) {
    window.clearTimeout(scrollSyncTimer)
    scrollSyncTimer = null
  }
}

const previewAnchorToSourceOffset = (anchor) => {
  if (!anchor?.selectedText) return null
  const content = editContent.value
  const hint = Math.round(clampRatio(anchor.offsetRatio) * content.length)
  const mapped = mapPreviewSelectionToMarkdown(content, {
    selectedText: anchor.selectedText,
    before: anchor.before,
    after: anchor.after,
    startOffset: hint,
    endOffset: hint + anchor.selectedText.length
  })
  return mapped ? mapped.start : null
}

const captureContentPosition = () => {
  const position = { editorRatio: null, previewRatio: null, offset: null, anchor: null }

  const editor = contentRef.value
  if (editor) {
    position.editorRatio = editor.getScrollRatio?.() ?? null
    const offset = editor.getTopOffset?.()
    if (Number.isInteger(offset)) position.offset = offset
  }

  const preview = previewRef.value
  if (preview) {
    const anchor = preview.captureTopAnchor?.() || null
    position.anchor = anchor
    position.previewRatio = anchor?.ratio ?? preview.getScrollRatio?.() ?? null
    if (position.offset === null) position.offset = previewAnchorToSourceOffset(anchor)
  }

  return position
}

const applyScrollPosition = (position) => {
  if (!position) return

  const editor = contentRef.value
  if (editor) {
    if (Number.isInteger(position.offset)) {
      editor.scrollToOffset?.(position.offset)
    } else {
      editor.scrollToRatio?.(clampRatio(position.editorRatio ?? position.previewRatio ?? 0))
    }
  }

  const preview = previewRef.value
  if (preview) {
    if (position.anchor && preview.restoreTopAnchor?.(position.anchor)) return
    if (Number.isInteger(position.offset)) {
      const locateContext = buildPreviewLocateContext(editContent.value, position.offset)
      if (locateContext) {
        preview.locateTextContext?.({ ...locateContext, align: 'start' })
        return
      }
    }
    preview.scrollToRatio?.(clampRatio(position.previewRatio ?? position.editorRatio ?? 0))
  }
}

const applyScrollPositionSoon = (position) => {
  if (!position) return
  cancelScheduledScrollSync()
  nextTick(() => {
    applyScrollPosition(position)
    // 面板过渡与图片加载还会继续改变滚动范围，补两次，避免只落在中间态。
    scrollSyncRaf = requestAnimationFrame(() => {
      scrollSyncRaf = null
      applyScrollPosition(position)
      scrollSyncTimer = window.setTimeout(() => {
        scrollSyncTimer = null
        applyScrollPosition(position)
      }, 180)
    })
  })
}

const setEditorMode = (mode) => {
  if (!EDITOR_MODES.includes(mode) || mode === editorMode.value) return

  stopScrollRestore()
  const position = captureContentPosition()
  if (selectedNote.value && position) {
    scrollPositions.set(selectedNote.value.id, position)
  }

  editorMode.value = mode
  applyScrollPositionSoon(position)
}

const EMPTY_SCROLL_POSITION = { editorRatio: 0, previewRatio: 0, offset: null, anchor: null }

const restoreNoteScroll = (noteId) => {
  applyScrollPositionSoon(scrollPositions.get(noteId) || EMPTY_SCROLL_POSITION)
}

const handleWindowResize = () => {
  if (window.innerWidth < 1200 && editorMode.value === 'split') {
    setEditorMode('edit')
  }
}

// Apply the saved filters/mode before the first render: rendering the unfiltered
// list first and filtering afterwards makes the list items leave (and resets the
// restored scroll position) a transition later.
const savedUiState = readUiState()
restoreUiState(savedUiState)

onMounted(async () => {
  await Promise.all([
    notepadStore.fetchNotes(),
    projectStore.fetchProjects(),
    fetchCategories()
  ])
  if (window.electronAPI?.getImageBaseDir) {
    try {
      imageBaseDir.value = await window.electronAPI.getImageBaseDir() || ''
    } catch {
      imageBaseDir.value = ''
    }
  }
  const savedNoteId = Number(savedUiState?.noteId)
  const routeNoteId = Number(route.query.noteId)
  const targetNoteId = routeNoteId || savedNoteId
  // Reopening the note the user left behind keeps the mode they left it in; a
  // deep link to another note opens in the default preview.
  if (targetNoteId) {
    await selectNoteById(targetNoteId, {
      focus: false,
      keepMode: targetNoteId === savedNoteId
    })
  }
  handleWindowResize()
  restoreScroll(savedUiState)

  document.addEventListener('keydown', handleKeydown)
  document.addEventListener('click', handleDocumentClick)
  document.addEventListener('scroll', handleContextMenuDismiss, true)
  window.addEventListener('resize', handleWindowResize)
  window.addEventListener('wheel', stopScrollRestore, { passive: true, capture: true })
  window.addEventListener('pointerdown', stopScrollRestore, { passive: true, capture: true })
  window.addEventListener('keydown', stopScrollRestore, true)
  nextTick(() => {
    listScrollEl()?.addEventListener('scroll', schedulePersistUiState, { passive: true })
  })
  noteRefreshTimer = window.setInterval(() => {
    if (!document.hidden) notepadStore.fetchNotes()
  }, 2000)
})

watch(
  [
    noteArchiveMode,
    selectedCategory,
    selectedProjectFilter,
    searchQuery,
    editorMode,
    sidebarWidth,
    splitRatio,
    () => selectedNote.value?.id
  ],
  schedulePersistUiState
)

onBeforeUnmount(() => {
  // The DOM is still attached here, so the live scroll offsets can be saved.
  if (persistTimer) {
    window.clearTimeout(persistTimer)
    persistTimer = null
  }
  persistUiState()
})

onUnmounted(() => {
  // Best-effort flush; do not block unmount.
  if (autosave.isDirty()) {
    autosave.flushSave().catch(err => {
      console.error('[NotepadView] flush on unmount failed:', err)
    })
  }
  document.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('click', handleDocumentClick)
  document.removeEventListener('scroll', handleContextMenuDismiss, true)
  window.removeEventListener('resize', handleWindowResize)
  window.removeEventListener('wheel', stopScrollRestore, { capture: true })
  window.removeEventListener('pointerdown', stopScrollRestore, { capture: true })
  window.removeEventListener('keydown', stopScrollRestore, true)
  stopScrollRestore()
  listScrollEl()?.removeEventListener('scroll', schedulePersistUiState)
  if (noteRefreshTimer) {
    window.clearInterval(noteRefreshTimer)
    noteRefreshTimer = null
  }
  closeNoteContextMenu()
})

// Watch for store updates
watch(() => notepadStore.notes, (newNotes) => {
  // Update selected note if it changed
  if (selectedNote.value) {
    const updated = newNotes.find(n => n.id === selectedNote.value.id)
    if (updated && Boolean(updated.is_archived) !== (noteArchiveMode.value === 'archived')) {
      selectedNote.value = null
      editTitle.value = ''
      editContent.value = ''
      selectedNoteCategory.value = ''
      selectedNoteProjectIds.value = []
    } else if (updated && autosave.canAcceptExternalUpdate()) {
      const changed = updated.title !== selectedNote.value.title ||
        updated.content !== selectedNote.value.content ||
        Boolean(updated.is_pinned) !== Boolean(selectedNote.value.is_pinned) ||
        updated.category !== selectedNote.value.category ||
        JSON.stringify(updated.project_ids || []) !== JSON.stringify(selectedNote.value.project_ids || [])
      if (!changed) return
      selectedNote.value = { ...updated }
      editTitle.value = updated.title || ''
      editContent.value = updated.content || ''
      selectedNoteCategory.value = updated.category || ''
      selectedNoteProjectIds.value = Array.isArray(updated.project_ids) ? [...updated.project_ids] : []
      previewSelection.value = null
    }
  }
}, { deep: true })

watch(() => route.query.noteId, () => {
  selectNoteFromRoute()
})
</script>

<style scoped>
@import '../styles/bongmaster.css';

.notepad-view {
  height: calc(100vh - var(--bm-navbar-height));
  overflow: hidden;
}

.notepad-container {
  display: flex;
  height: 100%;
}

/* Left Sidebar */
.notepad-sidebar {
  position: relative;
  flex-shrink: 0;
  background: #f5f5f7;
  border-right: 1px solid #e0e0e4;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.notepad-sidebar > * {
  position: relative;
  z-index: 1;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--bm-border-subtle);
}

.sidebar-header h2 {
  color: var(--bm-text-primary);
}

.sidebar-header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.btn-filter-toggle {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 50%;
  color: #8e8e93;
  font-size: 11px;
  cursor: pointer;
  transition: background 150ms ease, color 150ms ease;
}

.btn-filter-toggle:hover {
  background: var(--bm-bg-hover);
  color: var(--bm-text-primary);
}

.btn-filter-toggle.is-collapsed {
  color: #007aff;
  background: rgb(0 122 255 / 0.1);
}

.btn-new {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--bm-bg-card) 82%, transparent);
  color: var(--bm-text-secondary);
  border: 1px solid var(--bm-border-subtle);
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  transition: background 150ms ease, border-color 150ms ease, color 150ms ease, transform 150ms ease, box-shadow 150ms ease;
}

.btn-new i {
  font-size: 0.75rem;
}

.btn-new:hover {
  background: var(--bm-bg-hover);
  border-color: var(--bm-border-strong);
  color: var(--bm-accent-blue);
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.08);
  animation: notepadTinyHop 300ms steps(3, end);
  transform: translateY(-1px);
}

.btn-new:active {
  transform: translateY(0);
  box-shadow: none;
}

.archive-switch {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  padding: 8px 14px 0;
}

.archive-switch-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 0;
  height: 30px;
  padding: 0 8px;
  background: color-mix(in srgb, var(--bm-bg-card) 72%, transparent);
  border: 1px solid var(--bm-border-subtle);
  border-radius: 8px;
  color: var(--bm-text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition:
    background 150ms ease,
    border-color 150ms ease,
    color 150ms ease,
    box-shadow 150ms ease;
}

.archive-switch-btn i {
  font-size: 0.75rem;
}

.archive-switch-btn span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.archive-switch-btn strong {
  font-size: 0.6875rem;
  font-weight: 700;
  color: var(--bm-text-muted);
}

.archive-switch-btn:hover {
  background: var(--bm-bg-hover);
  border-color: var(--bm-border-default);
}

.archive-switch-btn.active {
  background: var(--bm-accent-blue);
  border-color: var(--bm-accent-blue);
  color: white;
  box-shadow: 0 2px 8px color-mix(in srgb, var(--bm-accent-blue) 24%, transparent);
}

.archive-switch-btn.active strong {
  color: rgba(255, 255, 255, 0.82);
}

/* Category Filter */
.sidebar-filters {
  overflow: hidden;
}

.filters-fold-enter-active,
.filters-fold-leave-active {
  overflow: hidden;
  transition: max-height 220ms ease, opacity 180ms ease;
}

.filters-fold-enter-from,
.filters-fold-leave-to {
  max-height: 0;
  opacity: 0;
}

.filters-fold-enter-to,
.filters-fold-leave-from {
  max-height: 220px;
  opacity: 1;
}

.sidebar-category {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px 0;
}

.sidebar-footer {
  flex-shrink: 0;
  padding: 6px 10px 8px;
  border-top: 1px solid #e6e6ea;
}

.sidebar-footer-btn {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: #6e6e73;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease;
}

.sidebar-footer-btn i {
  width: 14px;
  color: #8e8e93;
  font-size: 12px;
  text-align: center;
}

.sidebar-footer-btn:hover {
  background: #e8e8ed;
  color: #1d1d1f;
}

.sidebar-footer-btn em {
  margin-left: auto;
  color: #a1a1a6;
  font-size: 11px;
  font-style: normal;
}

.category-header {
  display: flex;
  align-items: center;
  gap: var(--bm-space-sm);
}

.project-filter-select {
  margin-top: 0;
}

.category-select {
  flex: 1 1 0;
  min-width: 0;
  height: 30px;
  padding: 0 8px;
  background: var(--bm-bg-hover);
  border: 1px solid var(--bm-border-default);
  border-radius: 8px;
  font-size: 12px;
  color: var(--bm-text-primary);
  outline: none;
  cursor: pointer;
}

.category-select:focus {
  border-color: var(--bm-accent-blue);
}

/* Category Modal */
.category-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1400;
}

.category-modal-motion-enter-active,
.category-modal-motion-leave-active {
  transition: opacity 180ms ease;
}

.category-modal-motion-enter-active .category-modal-content,
.category-modal-motion-leave-active .category-modal-content {
  transition:
    transform 220ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 180ms ease;
}

.category-modal-motion-enter-from,
.category-modal-motion-leave-to {
  opacity: 0;
}

.category-modal-motion-enter-from .category-modal-content,
.category-modal-motion-leave-to .category-modal-content {
  opacity: 0;
  transform: translateY(8px) scale(0.985);
}

.category-modal-content {
  background: var(--bm-bg-card);
  border-radius: var(--bm-radius-lg);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15);
  width: 400px;
  max-width: 90vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}

.category-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--bm-space-lg) var(--bm-space-xl);
  border-bottom: 1px solid var(--bm-border-subtle);
}

.category-modal-header h3 {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--bm-text-primary);
}

.category-modal-close {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: transparent;
  border: 0;
  border-radius: 50%;
  color: #6e6e73;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease;
}

.category-modal-close:hover {
  background: #ededf0;
  color: #1d1d1f;
}

.category-modal-body {
  padding: var(--bm-space-lg) var(--bm-space-xl);
  flex: 1;
  overflow-y: auto;
}

.new-category-form {
  display: flex;
  gap: var(--bm-space-sm);
  margin-bottom: var(--bm-space-lg);
}

.category-input {
  flex: 1;
  padding: var(--bm-space-sm) var(--bm-space-md);
  background: var(--bm-bg-hover);
  border: 1px solid var(--bm-border-default);
  border-radius: var(--bm-radius-md);
  font-size: 0.875rem;
  color: var(--bm-text-primary);
  outline: none;
}

.category-input:focus {
  border-color: var(--bm-accent-blue);
}

.btn-add-category {
  display: flex;
  align-items: center;
  gap: var(--bm-space-xs);
  padding: var(--bm-space-sm) var(--bm-space-md);
  background: var(--bm-accent-blue);
  color: white;
  border: none;
  border-radius: var(--bm-radius-md);
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 150ms ease;
}

.btn-add-category:hover:not(:disabled) {
  background: var(--bm-accent-blue-hover);
}

.btn-add-category:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.category-list {
  display: flex;
  flex-direction: column;
  gap: var(--bm-space-sm);
}

.category-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--bm-space-sm) var(--bm-space-md);
  background: var(--bm-bg-hover);
  border-radius: var(--bm-radius-md);
}

.category-name {
  font-size: 0.875rem;
  color: var(--bm-text-primary);
}

.btn-delete-category {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--bm-radius-sm);
  color: var(--bm-text-muted);
  cursor: pointer;
  transition: all 150ms ease;
}

.btn-delete-category:hover {
  background: var(--bm-accent-red);
  color: white;
}

.category-empty {
  text-align: center;
  padding: var(--bm-space-lg);
  color: var(--bm-text-muted);
  font-size: 0.875rem;
}

/* Note Category Badge */
.note-category-row {
  margin-bottom: var(--bm-space-xs);
}

.note-category-badge {
  display: inline-block;
  padding: 2px 8px;
  background: var(--bm-accent-blue);
  color: white;
  font-size: 0.6875rem;
  border-radius: var(--bm-radius-sm);
  font-weight: 500;
}

.note-item.active .note-category-badge {
  background: rgba(255, 255, 255, 0.9);
  color: var(--bm-accent-blue);
}

.note-project-row {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  margin-bottom: var(--bm-space-xs);
}

.note-project-badge,
.note-project-more {
  display: inline-flex;
  align-items: center;
  max-width: 120px;
  padding: 2px 7px;
  background: var(--bm-bg-hover);
  border: 1px solid var(--bm-border-subtle);
  color: var(--bm-text-secondary);
  font-size: 0.6875rem;
  line-height: 1.2;
  border-radius: var(--bm-radius-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.note-item.active .note-project-badge,
.note-item.active .note-project-more {
  background: rgba(255, 255, 255, 0.16);
  border-color: rgba(255, 255, 255, 0.3);
  color: rgba(255, 255, 255, 0.92);
}

.sidebar-search {
  padding: 8px 14px 8px;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 8px;
  background: var(--bm-bg-hover);
  border: 1px solid var(--bm-border-default);
  border-radius: 8px;
  transition:
    border-color 150ms ease,
    box-shadow 150ms ease,
    background 150ms ease;
}

.search-box:focus-within {
  border-color: var(--bm-accent-blue);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--bm-accent-blue) 14%, transparent);
}

.search-box i {
  color: var(--bm-text-muted);
  font-size: 0.875rem;
}

.search-box input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  font-size: 12.5px;
  color: var(--bm-text-primary);
}

.search-box input::placeholder {
  color: var(--bm-text-muted);
}

.btn-clear {
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bm-text-muted);
  color: var(--bm-bg-card);
  border: none;
  border-radius: 50%;
  font-size: 0.625rem;
  cursor: pointer;
  opacity: 0.7;
  transition: opacity 150ms;
}

.btn-clear:hover {
  opacity: 1;
}

.sidebar-filter-hint {
  display: flex;
  align-items: center;
  padding: 0 14px 6px;
}

.btn-filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border: 0;
  border-radius: 999px;
  background: rgb(0 122 255 / 0.1);
  color: #007aff;
  font-size: 10.5px;
  cursor: pointer;
}

.btn-filter-chip i { font-size: 9px; }

.sidebar-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px var(--bm-space-md) 0;
}

.note-context-menu {
  position: fixed;
  z-index: 1200;
  min-width: 184px;
  padding: 5px;
  border: 1px solid rgb(0 0 0 / 0.08);
  border-radius: 10px;
  background: rgb(250 250 252 / 0.97);
  box-shadow: 0 12px 32px rgb(0 0 0 / 0.18), 0 1px 3px rgb(0 0 0 / 0.08);
  backdrop-filter: blur(20px) saturate(1.2);
  animation: noteMenuIn 120ms cubic-bezier(0.22, 1, 0.36, 1);
}

.context-menu-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 9px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #1d1d1f;
  font-size: 13px;
  line-height: 1.35;
  text-align: left;
  cursor: pointer;
}

.context-menu-item i {
  width: 14px;
  flex: 0 0 14px;
  color: #8e8e93;
  font-size: 11px;
  text-align: center;
}

.context-menu-item:hover {
  background: #e8e8ed;
}

.context-menu-item.danger {
  color: #d70015;
}

.context-menu-item.danger i {
  color: #d70015;
}

.context-menu-item.danger:hover {
  background: #ffe9e9;
}

.context-menu-divider {
  height: 1px;
  margin: 4px 7px;
  background: rgb(0 0 0 / 0.08);
}

@keyframes noteMenuIn {
  from { opacity: 0; transform: scale(0.97) translateY(-3px); }
  to { opacity: 1; transform: none; }
}

.note-item {
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: flex-start;
  gap: 5px;
  height: 78px;
  padding: 8px 9px 9px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 140ms ease;
}

.note-item + .note-item::before {
  content: '';
  position: absolute;
  top: 0;
  right: 9px;
  left: 9px;
  height: 1px;
  background: #e6e6ea;
  pointer-events: none;
}

.note-item.active::before,
.note-item.context-open::before,
.note-item.active + .note-item::before,
.note-item.context-open + .note-item::before {
  display: none;
}

.note-item:hover {
  background: #f2f2f4;
}

.note-item.active {
  background: #e4e4e9;
}

.note-item.context-open {
  background: #fff;
  box-shadow: 0 0 0 1.5px #e8a33d;
}

.note-item.archived {
  opacity: 0.86;
}

.pin-indicator {
  padding-top: 2px;
  color: #ff9f0a;
  font-size: 9px;
}

.note-preview {
  position: relative;
  flex: 1;
  min-width: 0;
}

.note-list-motion-move,
.note-list-motion-enter-active,
.note-list-motion-leave-active {
  transition:
    opacity 220ms ease,
    transform 260ms cubic-bezier(0.22, 1, 0.36, 1);
}

.note-list-motion-enter-from,
.note-list-motion-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.99);
}

.note-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.note-title {
  font-weight: 600;
  font-size: 13px;
  color: #1d1d1f;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.note-meta-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-top: 2px;
  min-width: 0;
  overflow: hidden;
}

.note-folder-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 3px;
  min-width: 0;
  color: #8e8e93;
  font-size: 11px;
}

.note-folder-row i {
  color: #b0b0b6;
  font-size: 9px;
  flex-shrink: 0;
}

.note-folder-name,
.note-folder-project {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.note-folder-project {
  color: #a1a1a6;
  flex-shrink: 1;
}

.note-archive-badge {
  flex-shrink: 0;
  padding: 1px 5px;
  background: #fff;
  border: 1px solid #e5e5ea;
  border-radius: 4px;
  color: #8e8e93;
  font-size: 9.5px;
  line-height: 1.3;
}

.note-date {
  font-size: 11.5px;
  color: #6e6e73;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.note-content-preview {
  font-size: 11.5px;
  color: #8e8e93;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--bm-space-3xl);
  color: var(--bm-text-muted);
}

.sidebar-empty i {
  font-size: 2rem;
  margin-bottom: var(--bm-space-md);
  opacity: 0.5;
  animation: notepadEmptyFloat 1800ms steps(4, end) infinite;
}

.sidebar-empty p {
  font-size: 0.875rem;
}

/* Sidebar Resizer */
.sidebar-resizer {
  width: 4px;
  flex-shrink: 0;
  cursor: col-resize;
  background: transparent;
  transition: background 150ms;
  position: relative;
}

.sidebar-resizer:hover,
.sidebar-resizer.resizing {
  background: var(--bm-accent-blue);
}

/* Right Editor Area */
.notepad-editor-area {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--bm-bg-card);
  min-width: 0;
}

.notepad-editor-area::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(rgba(46, 170, 220, 0.024) 1px, transparent 1px),
    linear-gradient(90deg, rgba(46, 170, 220, 0.018) 1px, transparent 1px);
  background-size: 10px 10px;
  opacity: 0.36;
}

.notepad-editor-area > * {
  position: relative;
  z-index: 1;
}

/* Editor Empty State */
.editor-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--bm-space-lg);
  color: var(--bm-text-muted);
}

.empty-content i {
  font-size: 4rem;
  opacity: 0.3;
}

.empty-content p {
  font-size: 1.125rem;
}

.empty-content span {
  font-size: 0.875rem;
}

.btn-create {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 34px;
  padding: 0.45rem 0.8rem;
  background: var(--bm-bg-card);
  color: var(--bm-text-primary);
  border: 1px solid var(--bm-border-default);
  border-radius: var(--bm-radius-md);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  transition: background 150ms ease, border-color 150ms ease, color 150ms ease, transform 150ms ease, box-shadow 150ms ease;
}

.btn-create i {
  font-size: 0.75rem;
  color: var(--bm-accent-blue);
}

.btn-create:hover {
  background: var(--bm-bg-hover);
  border-color: var(--bm-border-strong);
  color: var(--bm-accent-blue);
  box-shadow: 0 4px 10px rgba(15, 23, 42, 0.08);
  animation: notepadTinyHop 300ms steps(3, end);
  transform: translateY(-1px);
}

.btn-create:active {
  transform: translateY(0);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}

/* Editor Header */
.editor-header {
  position: relative;
  z-index: 10;
  padding: 8px 14px;
  border-bottom: 1px solid var(--bm-border-subtle);
  flex-shrink: 0;
}

.editor-header::after {
  content: '';
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 1px;
  background: #ececf0;
}

.note-category-selector {
  display: flex;
  align-items: center;
}

.category-dropdown {
  height: 28px;
  padding: 0 6px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 7px;
  font-size: 12.5px;
  color: #3a3a3c;
  outline: none;
  cursor: pointer;
  min-width: 84px;
}

.category-dropdown:hover {
  background: #ededf0;
}

.category-dropdown:focus {
  border-color: var(--bm-accent-blue);
}

.note-project-selector {
  position: relative;
}

.project-selector-btn {
  height: 28px;
  max-width: 180px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 7px;
  color: #6e6e73;
  cursor: pointer;
  font-size: 12.5px;
  transition: background 140ms ease, color 140ms ease;
}

.project-selector-btn span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-selector-btn:hover {
  background: #ededf0;
}

.project-selector-btn.active {
  background: rgb(0 122 255 / 0.1);
  color: #007aff;
}

.project-selector-panel {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 20;
  width: 240px;
  max-height: 280px;
  overflow-y: auto;
  padding: var(--bm-space-sm);
  background: var(--bm-bg-card);
  border: 1px solid var(--bm-border-default);
  border-radius: var(--bm-radius-md);
  box-shadow: var(--bm-shadow-lg);
  animation: selectorPanelDrop 160ms steps(3, end);
}

.project-option {
  display: flex;
  align-items: center;
  gap: var(--bm-space-sm);
  padding: var(--bm-space-sm);
  border-radius: var(--bm-radius-sm);
  color: var(--bm-text-primary);
  font-size: 0.8125rem;
  cursor: pointer;
}

.project-option:hover {
  background: var(--bm-bg-hover);
}

.project-option input {
  flex: 0 0 auto;
}

.project-selector-empty {
  padding: var(--bm-space-md);
  color: var(--bm-text-muted);
  font-size: 0.8125rem;
  text-align: center;
}

.editor-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: nowrap;
  min-width: 0;
}

.editor-toolbar-tools {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.editor-toolbar-tools::-webkit-scrollbar {
  display: none;
}

.toolbar-collapse-btn {
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  margin-left: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 50%;
  background: transparent;
  color: #8e8e93;
  font-size: 10px;
  cursor: pointer;
  transition: background 150ms ease, color 150ms ease;
}

.toolbar-collapse-btn:hover {
  background: var(--bm-bg-hover);
  color: var(--bm-text-primary);
}

.toolbar-collapse-btn.is-collapsed {
  background: rgb(0 122 255 / 0.1);
  color: #007aff;
}

.toolbar-btn {
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 0;
  border-radius: 7px;
  color: #4a4a4f;
  font-size: 12px;
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease;
}

.markdown-toolbar {
  display: flex;
  align-items: center;
  gap: 1px;
  padding: 3px;
  flex: 0 0 auto;
  background: rgb(255 255 255 / 0.72);
  border: 1px solid #e3e3e8;
  border-radius: 10px;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.04);
  backdrop-filter: blur(10px);
}

.markdown-btn {
  width: 26px;
  height: 26px;
  border: 0;
  background: transparent;
  font-size: 11.5px;
  font-weight: 600;
  border-radius: 6px;
}

.markdown-text-btn {
  font-weight: 600;
  font-size: 11px;
  letter-spacing: 0;
  font-family: var(--bm-font-ui);
}

.markdown-color-btn {
  width: 21px;
  padding: 0;
}

.color-swatch {
  width: 13px;
  height: 13px;
  display: block;
  border-radius: 4px;
  border: 1px solid rgba(15, 23, 42, 0.16);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.45);
}

.color-swatch-yellow {
  background: #fff2a8;
}

.color-swatch-orange {
  background: #ffd6a5;
}

.color-swatch-pink {
  background: #ffd1dc;
}

.color-swatch-purple {
  background: #eadcff;
}

.color-swatch-blue {
  background: #cfe8ff;
}

.color-swatch-green {
  background: #d8f5d1;
}

.toolbar-divider {
  width: 1px;
  height: 16px;
  margin: 0 3px;
  background: #e0e0e5;
}

.toolbar-btn:hover {
  background: #ededf0;
  color: #1d1d1f;
}

.toolbar-btn:disabled {
  cursor: progress;
  opacity: 0.65;
}

.toolbar-btn.active {
  background: #e2e2e7;
  color: #1d1d1f;
}

.apple-notes-btn.active {
  background: rgb(48 209 88 / 0.14);
  color: #248a3d;
}

.apple-notes-btn:hover:not(:disabled) {
  background: #ededf0;
  color: #1d1d1f;
}

.pdf-export-btn:hover:not(:disabled) {
  background: rgb(255 59 48 / 0.1);
  color: #c1271f;
}

.pdf-export-status i {
  color: var(--bm-accent-red);
}

.delete-btn:hover {
  background: rgb(255 59 48 / 0.12);
  color: #c1271f;
}

.toolbar-spacer {
  flex: 1;
}

/* Editor Body */
.editor-body {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 0;
  overflow: visible;
}

.editor-workspace {
  position: relative;
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: row;
  overflow: hidden;
  background: var(--bm-border-subtle);
}

.editor-workspace > * {
  min-width: 0;
}

.editor-workspace.mode-edit,
.editor-workspace.mode-preview {
  display: flex;
}

.editor-split-resizer {
  width: 14px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bm-bg-hover);
  border-left: 1px solid var(--bm-border-subtle);
  border-right: 1px solid var(--bm-border-subtle);
  cursor: col-resize;
  user-select: none;
  transition: background 150ms ease;
}

.editor-split-resizer:hover {
  background: color-mix(in srgb, var(--bm-accent-blue) 8%, var(--bm-bg-hover));
}

.resizer-grip {
  width: 3px;
  height: 34px;
  border-radius: 2px;
  background: var(--bm-border-default);
  transition:
    height 180ms cubic-bezier(0.22, 1, 0.36, 1),
    background 150ms ease;
}

.editor-split-resizer:hover .resizer-grip {
  height: 44px;
  background: var(--bm-accent-blue);
}

.editor-mode-switch {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  background: var(--bm-bg-hover);
  border: 1px solid var(--bm-border-subtle);
  border-radius: var(--bm-radius-md);
}

.mode-btn {
  width: 30px;
  height: 30px;
  border-color: transparent;
  background: transparent;
  font-size: 0.8125rem;
}

.mode-btn.active {
  background: var(--bm-bg-card);
  border-color: var(--bm-border-default);
  color: var(--bm-accent-blue);
}

.editor-mode-panel-enter-active,
.editor-mode-panel-leave-active {
  transition:
    opacity 150ms ease,
    transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
}

/* A leaving panel must not squeeze the panel taking its place, or intercept
   input while it fades out. */
.editor-mode-panel-leave-active {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.editor-mode-panel-enter-from,
.editor-mode-panel-leave-to {
  opacity: 0;
  transform: translateY(4px);
}

.editor-body::before {
  content: '';
  position: sticky;
  top: 0;
  z-index: 2;
  display: block;
  height: 2px;
  margin-top: 0;
  background:
    repeating-linear-gradient(
      90deg,
      color-mix(in srgb, var(--bm-accent-blue) 24%, transparent) 0 9px,
      transparent 9px 15px
    );
  opacity: 0.28;
  pointer-events: none;
}

.editor-title {
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--bm-border-subtle);
  padding: var(--bm-space-md) var(--bm-space-xl);
  font-size: 1.75rem;
  font-weight: 600;
  color: var(--bm-text-primary);
  outline: none;
  margin-bottom: var(--bm-space-lg);
}

.editor-title::placeholder {
  color: var(--bm-text-muted);
}

.editor-title:focus {
  border-bottom-color: var(--bm-accent-blue);
  box-shadow: 0 1px 0 color-mix(in srgb, var(--bm-accent-blue) 24%, transparent);
}

.editor-content {
  flex: 1;
  background: transparent;
  border: none;
  resize: none;
  font-size: 1rem;
  line-height: 1.7;
  color: var(--bm-text-primary);
  outline: none;
  font-family: inherit;
}

.editor-content::placeholder {
  color: var(--bm-text-muted);
}

/* Editor Footer */
.editor-footer {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--bm-space-md) var(--bm-space-xl);
  border-top: 1px solid var(--bm-border-subtle);
  font-size: 0.75rem;
  color: var(--bm-text-muted);
  flex-shrink: 0;
}

.editor-footer::before {
  content: '';
  position: absolute;
  top: -1px;
  left: var(--bm-space-xl);
  width: 80px;
  height: 1px;
  background:
    linear-gradient(
      90deg,
      var(--bm-accent-blue),
      transparent
    );
  opacity: 0.32;
}

.footer-left {
  display: flex;
  align-items: center;
  gap: var(--bm-space-md);
  min-width: 0;
}

.save-status-text {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--bm-space-xs);
  min-width: 3.6em;
}

.save-status-text::before {
  content: '';
  width: 6px;
  height: 6px;
  background: var(--bm-text-tertiary);
}

.save-status-text.state-dirty::before {
  background: var(--bm-accent-orange);
  animation: savePixelBlink 650ms steps(2, end) infinite;
}

.save-status-text.state-saving::before {
  background: var(--bm-accent-blue);
  animation: savePixelMarch 900ms steps(3, end) infinite;
}

.save-status-text.state-saved::before {
  background: var(--bm-accent-teal);
}

.save-status-text.state-error {
  cursor: pointer;
  color: var(--bm-accent-red);
}

.save-status-text.state-error::before {
  background: var(--bm-accent-red);
}

.save-status-enter-active,
.save-status-leave-active {
  transition:
    opacity 160ms ease,
    transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
}

.save-status-enter-from,
.save-status-leave-to {
  opacity: 0;
  transform: translateY(4px);
}

.apple-sync-status {
  display: inline-flex;
  align-items: center;
  gap: var(--bm-space-xs);
  color: var(--bm-accent-teal);
}

.footer-right {
  display: flex;
  align-items: center;
  gap: var(--bm-space-md);
}

.zoom-status {
  color: var(--bm-text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

@keyframes notepadPixelDrift {
  0% { background-position: 0 0, 0 0; }
  100% { background-position: 40px 24px, 40px 24px; }
}

@keyframes notepadTinyHop {
  0% { transform: translateY(0); }
  45% { transform: translateY(-2px); }
  100% { transform: translateY(-1px); }
}

@keyframes noteItemHop {
  0% { transform: translate(0, 0); }
  45% { transform: translate(-1px, -3px); }
  100% { transform: translate(-1px, -1px); }
}

@keyframes activeNoteSweep {
  0%, 24% { opacity: 0; transform: translateX(-12px); }
  52% { opacity: 0.72; }
  100% { opacity: 0; transform: translateX(12px); }
}

@keyframes pinPixelBlink {
  0%, 100% { opacity: 0.46; }
  50% { opacity: 0.9; }
}

@keyframes notepadEmptyFloat {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}

@keyframes editorHeaderSweep {
  0%, 24% { opacity: 0; transform: translateX(-16px); }
  54% { opacity: 0.7; }
  100% { opacity: 0; transform: translateX(16px); }
}

@keyframes selectorPanelDrop {
  0% { opacity: 0; transform: translateY(-4px); }
  100% { opacity: 1; transform: translateY(0); }
}

@keyframes toolbarPixelPress {
  0% { transform: translateY(0); }
  50% { transform: translateY(-1px); }
  100% { transform: translateY(0); }
}

@keyframes savePixelBlink {
  0%, 100% { opacity: 0.42; }
  50% { opacity: 1; }
}

@keyframes savePixelMarch {
  0% {
    box-shadow:
      9px 0 0 color-mix(in srgb, var(--bm-accent-blue) 42%, transparent),
      18px 0 0 color-mix(in srgb, var(--bm-accent-blue) 18%, transparent);
  }
  50% {
    box-shadow:
      9px 0 0 color-mix(in srgb, var(--bm-accent-blue) 78%, transparent),
      18px 0 0 color-mix(in srgb, var(--bm-accent-blue) 36%, transparent);
  }
  100% {
    box-shadow:
      9px 0 0 color-mix(in srgb, var(--bm-accent-blue) 42%, transparent),
      18px 0 0 color-mix(in srgb, var(--bm-accent-blue) 18%, transparent);
  }
}
</style>
