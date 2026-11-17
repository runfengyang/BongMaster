<template>
  <div class="notepad-editor-modal" :class="{ show: isOpen }" @click.self="handleCancel">
    <div class="notepad-editor">
      <!-- Header -->
      <div class="editor-header">
        <h3>{{ isNew ? '新建便签' : '编辑便签' }}</h3>
        <button class="editor-close" @click="handleCancel">
          <i class="fas fa-times"></i>
        </button>
      </div>

      <!-- Body -->
      <div class="editor-body">
        <!-- Title input -->
        <input
          ref="titleInput"
          type="text"
          class="editor-title-input"
          v-model="form.title"
          placeholder="标题（可选）"
          @keydown="handleTitleKeydown"
        >

        <!-- Content textarea -->
        <textarea
          ref="contentInput"
          class="editor-content-input"
          :class="{ 'drag-over': isDragOver }"
          v-model="form.content"
          placeholder="写点什么... 支持粘贴或拖拽图片"
          @keydown="handleContentKeydown"
          @paste="handlePaste"
          @drop="handleDrop"
          @dragover="handleDragOver"
          @dragleave="handleDragLeave"
          :style="{ tabSize: 2 }"
        ></textarea>

      </div>

      <!-- Footer -->
      <div class="editor-footer">
        <div class="editor-footer-left">
          <!-- Category selector -->
          <div class="editor-category">
            <select
              v-model="form.category"
              class="category-select"
              title="选择分类"
            >
              <option value="">无分类</option>
              <option
                v-for="cat in categories"
                :key="cat.id"
                :value="cat.name"
              >
                {{ cat.name }}
              </option>
            </select>
          </div>
          <div class="editor-status">
            <span class="char-count">{{ charCount }} 字</span>
            <span class="save-status">{{ saveStatus }}</span>
          </div>
        </div>
        <div class="editor-actions">
          <button class="bm-btn bm-btn-ghost" @click="handleCancel">取消</button>
          <button class="bm-btn bm-btn-primary" @click="handleSave">
            <i class="fas fa-save"></i>
            保存
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useImagePaste } from '@composables/useImagePaste'

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false
  },
  note: {
    type: Object,
    default: null
  },
  isNew: {
    type: Boolean,
    default: false
  },
  categories: {
    type: Array,
    default: () => []
  },
  noteId: {
    type: [String, Number],
    default: null
  }
})

const emit = defineEmits(['close', 'save'])

const titleInput = ref(null)
const contentInput = ref(null)
const isDragOver = ref(false)

const form = ref({
  title: '',
  content: '',
  is_pinned: false,
  category: ''
})

const hasChanges = ref(false)
const saveStatus = ref('')

const isNew = computed(() => props.isNew || !props.note)

const charCount = computed(() => {
  return (form.value.content || '').length
})

// Image paste composable
const { handlePaste, handleDrop, handleDragOver: handleImageDragOver } = useImagePaste({
  noteId: computed(() => props.noteId || props.note?.id || 'new'),
  textareaRef: contentInput,
  onImageSaved: (imagePath) => {
    // Image saved callback - image markdown already inserted by composable
    hasChanges.value = true
    saveStatus.value = '未保存'
  }
})

// Custom drag over handler with visual feedback
const handleDragOver = (event) => {
  handleImageDragOver(event)
  isDragOver.value = true
}

const handleDragLeave = (event) => {
  // Only set drag over to false if leaving the textarea element
  const rect = contentInput.value?.getBoundingClientRect()
  if (rect) {
    const x = event.clientX
    const y = event.clientY
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      isDragOver.value = false
    }
  }
}

// Initialize form when modal opens
watch(() => props.isOpen, (isOpen) => {
  if (isOpen) {
    if (props.note) {
      form.value = {
        title: props.note.title || '',
        content: props.note.content || '',
        is_pinned: props.note.is_pinned || false,
        category: props.note.category || ''
      }
    } else {
      form.value = {
        title: '',
        content: '',
        is_pinned: false,
        category: ''
      }
    }
    hasChanges.value = false
    saveStatus.value = ''
    isDragOver.value = false

    // Focus content textarea on open
    nextTick(() => {
      contentInput.value?.focus()
    })
  }
}, { immediate: true })

// Track changes
watch(() => [form.value.title, form.value.content, form.value.category], () => {
  hasChanges.value = true
  saveStatus.value = '未保存'
}, { deep: true, flush: 'sync' })

// Keyboard shortcuts
const handleKeydown = (e) => {
  // Ctrl+S to save
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault()
    handleSave()
  }
  // Escape to close
  if (e.key === 'Escape') {
    handleCancel()
  }
}

const handleTitleKeydown = (e) => {
  if (e.key === 'Enter') {
    e.preventDefault()
    contentInput.value?.focus()
  }
}

const handleContentKeydown = (e) => {
  // Tab support for indentation
  if (e.key === 'Tab') {
    e.preventDefault()
    const target = e.target
    const start = target.selectionStart
    const end = target.selectionEnd
    const value = target.value
    target.value = value.substring(0, start) + '  ' + value.substring(end)
    target.selectionStart = target.selectionEnd = start + 2
    form.value.content = target.value
  }
}

const handleSave = () => {
  const data = {
    title: form.value.title.trim(),
    content: form.value.content,
    is_pinned: form.value.is_pinned,
    category: form.value.category
  }

  emit('save', data)
  saveStatus.value = '已保存'
  hasChanges.value = false
}

const handleCancel = () => {
  if (hasChanges.value) {
    if (confirm('有未保存的更改，确定要关闭吗？')) {
      emit('close')
    }
  } else {
    emit('close')
  }
}

// Add keyboard event listener
onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<style scoped>
@import '../styles/bongmaster.css';

.notepad-editor-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(55, 53, 47, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  opacity: 0;
  visibility: hidden;
  transition: all 150ms ease-in-out;
}

.notepad-editor-modal.show {
  opacity: 1;
  visibility: visible;
}

.notepad-editor {
  background: var(--bm-bg-card);
  border-radius: var(--bm-radius-md);
  box-shadow: var(--bm-shadow-md);
  width: 90%;
  max-width: 600px;
  max-height: 90vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  transform: translateY(-8px);
  transition: transform 150ms ease-in-out;
}

.notepad-editor-modal.show .notepad-editor {
  transform: translateY(0);
}

/* Header */
.editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--bm-space-lg);
  border-bottom: 1px solid var(--bm-border-subtle);
}

.editor-header h3 {
  font-size: 1rem;
  font-weight: 600;
}

.editor-close {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--bm-radius-sm);
  color: var(--bm-text-muted);
  font-size: 1rem;
  cursor: pointer;
  transition: all 150ms ease-in-out;
}

.editor-close:hover {
  background: var(--bm-bg-hover);
  color: var(--bm-text-primary);
}

/* Body */
.editor-body {
  padding: var(--bm-space-lg);
  display: flex;
  flex-direction: column;
  gap: var(--bm-space-md);
  flex: 1;
  overflow: auto;
}

.editor-title-input {
  width: 100%;
  padding: var(--bm-space-sm) 0;
  font-size: 1rem;
  font-weight: 500;
  font-family: var(--bm-font-display);
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--bm-border-subtle);
  color: var(--bm-text-primary);
  outline: none;
  transition: border-color 150ms ease-in-out;
}

.editor-title-input:focus {
  border-bottom-color: var(--bm-accent-blue);
}

.editor-title-input::placeholder {
  color: var(--bm-text-muted);
}

.editor-content-input {
  width: 100%;
  min-height: 200px;
  padding: var(--bm-space-md) 0;
  font-size: 0.9375rem;
  line-height: 1.6;
  font-family: var(--bm-font-reading);
  background: transparent;
  border: 2px dashed transparent;
  border-radius: var(--bm-radius-sm);
  color: var(--bm-text-primary);
  resize: vertical;
  outline: none;
  flex: 1;
  transition: all 150ms ease-in-out;
}

.editor-content-input::placeholder {
  color: var(--bm-text-muted);
}

.editor-content-input.drag-over {
  border-color: var(--bm-accent-blue);
  background: var(--bm-bg-hover);
}

/* Footer */
.editor-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--bm-space-md);
  padding: var(--bm-space-md) var(--bm-space-lg);
  border-top: 1px solid var(--bm-border-subtle);
  background: var(--bm-bg-page);
}

.editor-footer-left {
  display: flex;
  align-items: center;
  gap: var(--bm-space-md);
  flex: 1;
}

.editor-category {
  flex-shrink: 0;
}

.category-select {
  padding: var(--bm-space-sm) var(--bm-space-md);
  font-size: 0.875rem;
  font-family: var(--bm-font-family);
  background: var(--bm-bg-card);
  border: 1px solid var(--bm-border-subtle);
  border-radius: var(--bm-radius-md);
  color: var(--bm-text-primary);
  cursor: pointer;
  outline: none;
  transition: all 150ms ease-in-out;
}

.category-select:hover {
  border-color: var(--bm-border-default);
}

.category-select:focus {
  border-color: var(--bm-accent-blue);
}

.editor-status {
  display: flex;
  align-items: center;
  gap: var(--bm-space-md);
  font-size: 0.75rem;
  color: var(--bm-text-muted);
}

.char-count {
  font-family: var(--bm-font-mono);
}

.save-status {
  font-style: italic;
}

.editor-actions {
  display: flex;
  gap: var(--bm-space-sm);
}

/* Button styles from bongmaster.css */
.bm-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--bm-space-sm);
  padding: var(--bm-space-sm) var(--bm-space-md);
  font-size: 0.875rem;
  font-weight: 500;
  border-radius: var(--bm-radius-md);
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 150ms ease-in-out;
  background: transparent;
  color: var(--bm-text-primary);
  font-family: var(--bm-font-family);
}

.bm-btn:hover {
  background: var(--bm-bg-hover);
}

.bm-btn-primary {
  background: var(--bm-accent-blue);
  color: white;
}

.bm-btn-primary:hover {
  background: var(--bm-accent-blue-hover);
}

.bm-btn-ghost {
  color: var(--bm-text-secondary);
}

.bm-btn-ghost:hover {
  background: var(--bm-bg-hover);
  color: var(--bm-text-primary);
}
</style>
