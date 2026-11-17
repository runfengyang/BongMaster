<template>
  <section class="markdown-textarea-editor" :class="{ disabled, dragging: isDraggingImage, locating: isLocating }">
    <input
      ref="titleInputRef"
      class="markdown-title-input"
      :value="title"
      :disabled="disabled"
      :lang="spellcheckLanguage"
      placeholder="标题"
      spellcheck="true"
      @input="handleTitleInput"
      @keydown="handleTitleKeydown"
      @focus="emit('focus')"
      @blur="emit('blur')"
    />
    <textarea
      ref="textareaRef"
      class="markdown-body-textarea"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      :lang="spellcheckLanguage"
      :style="{ fontSize: `${fontSize}px` }"
      spellcheck="true"
      @input="handleContentInput"
      @click="handleContentClick"
      @keydown="handleContentKeydown"
      @compositionstart="isComposing = true"
      @compositionend="isComposing = false"
      @paste="handlePaste"
      @drop="handleDrop"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @focus="emit('focus')"
      @blur="emit('blur')"
    />
  </section>
</template>

<script setup>
import { ref, nextTick, onMounted, onUnmounted } from 'vue'
import { useMarkdownCommands } from '@composables/useMarkdownCommands.js'
import { useTextareaImagePaste } from '@composables/useTextareaImagePaste.js'

const props = defineProps({
  title: {
    type: String,
    default: ''
  },
  modelValue: {
    type: String,
    default: ''
  },
  placeholder: {
    type: String,
    default: '开始写作...'
  },
  noteId: {
    type: [String, Number],
    default: null
  },
  fontSize: {
    type: Number,
    default: 13
  },
  disabled: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits([
  'update:modelValue',
  'update:title',
  'input',
  'save',
  'focus',
  'blur',
  'locate-request'
])

const titleInputRef = ref(null)
const textareaRef = ref(null)
const isComposing = ref(false)
const isLocating = ref(false)
const spellcheckLanguage = ref('zh-CN')
let locateTimer = null
let removeSpellcheckLanguageListener = null

const markdown = useMarkdownCommands({
  textareaRef,
  modelValue: () => props.modelValue,
  updateModelValue: (value) => {
    emit('update:modelValue', value)
    emit('input')
  }
})

const imagePaste = useTextareaImagePaste({
  textareaRef,
  noteId: () => props.noteId,
  ensureNoteSaved: () => {
    emit('save')
    return props.noteId
  },
  setContent: (value) => {
    emit('update:modelValue', value)
  },
  markDirty: () => {
    emit('input')
  },
  onError: (message) => {
    console.warn('[MarkdownTextareaEditor] image paste error:', message)
  }
})

const { isDraggingImage, handlePaste, handleDrop, handleDragOver, handleDragLeave } = imagePaste

function handleTitleInput(event) {
  emit('update:title', event.target.value)
  emit('input')
}

function handleContentInput(event) {
  emit('update:modelValue', event.target.value)
  emit('input')
}

function flashLocateFeedback() {
  isLocating.value = false
  if (locateTimer) {
    window.clearTimeout(locateTimer)
  }
  requestAnimationFrame(() => {
    isLocating.value = true
    locateTimer = window.setTimeout(() => {
      isLocating.value = false
      locateTimer = null
    }, 620)
  })
}

function handleContentClick(event) {
  if (event.button !== 0 || (!event.metaKey && !event.ctrlKey)) return
  const textarea = textareaRef.value
  if (!textarea) return

  flashLocateFeedback()
  emit('locate-request', {
    offset: textarea.selectionStart
  })
}

function scrollToLine(lineNumber) {
  const textarea = textareaRef.value
  if (!textarea) return
  const lines = textarea.value.split('\n')
  const targetLine = Math.max(0, Math.min(lineNumber, lines.length - 1))
  let position = 0
  for (let i = 0; i < targetLine; i++) {
    position += lines[i].length + 1
  }
  textarea.focus()
  textarea.setSelectionRange(position, position)
  // Scroll the line roughly into view.
  const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 24
  textarea.scrollTop = Math.max(0, targetLine * lineHeight - textarea.clientHeight * 0.2)
}

function getScrollRatio() {
  const textarea = textareaRef.value
  if (!textarea) return 0
  const scrollHeight = textarea.scrollHeight - textarea.clientHeight
  return scrollHeight > 0 ? textarea.scrollTop / scrollHeight : 0
}

function scrollToRatio(ratio) {
  const textarea = textareaRef.value
  if (!textarea) return
  const scrollHeight = textarea.scrollHeight - textarea.clientHeight
  if (scrollHeight > 0) {
    textarea.scrollTop = ratio * scrollHeight
  }
}

// 视口顶部那一行在正文里的字符偏移。视图切换时用它当锚点：textarea 的行高与预览
// 渲染后的高度不成比例，滚动比例在长表格/代码块前后会明显错位。
// 源码行会折行，按行高除 scrollTop 会算错，所以在行首上二分 + measureCaretTop 实测。
function getTopOffset() {
  const textarea = textareaRef.value
  if (!textarea) return null

  const maxScrollTop = Math.max(0, textarea.scrollHeight - textarea.clientHeight)
  if (maxScrollTop <= 0) return 0

  const lines = textarea.value.split('\n')
  const lineStarts = []
  let cursor = 0
  for (const line of lines) {
    lineStarts.push(cursor)
    cursor += line.length + 1
  }

  const target = Math.max(0, Math.min(maxScrollTop, textarea.scrollTop))
  let low = 0
  let high = lineStarts.length - 1
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2)
    if (measureCaretTop(textarea, lineStarts[mid]) <= target) low = mid
    else high = mid - 1
  }
  return lineStarts[low]
}

// 把含该偏移的那一行滚到视口顶部（measureCaretTop 与 textarea 同宽同换行规则，
// 折行也能算准）。
function scrollToOffset(offset) {
  const textarea = textareaRef.value
  if (!textarea) return
  const safeOffset = Math.max(0, Math.min(Number(offset) || 0, textarea.value.length))
  const maxScrollTop = Math.max(0, textarea.scrollHeight - textarea.clientHeight)
  const targetTop = measureCaretTop(textarea, safeOffset)
  textarea.scrollTop = Math.max(0, Math.min(maxScrollTop, targetTop))
}

function handleTitleKeydown(event) {
  if (event.key === 'Enter' || event.key === 'ArrowDown') {
    event.preventDefault()
    focusTextarea(true)
  }
}

function handleContentKeydown(event) {
  // Do not intercept formatting shortcuts during IME composition.
  if (isComposing.value) return

  const isShortcut = event.ctrlKey || event.metaKey

  if (isShortcut && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    document.execCommand(event.shiftKey ? 'redo' : 'undo')
    return
  }

  if (isShortcut && event.key.toLowerCase() === 'y') {
    event.preventDefault()
    document.execCommand('redo')
    return
  }

  if (isShortcut && event.key.toLowerCase() === 's') {
    event.preventDefault()
    emit('save')
    return
  }

  if (isShortcut && event.key.toLowerCase() === 'b') {
    event.preventDefault()
    applyCommand('bold')
    return
  }

  if (isShortcut && event.key.toLowerCase() === 'i') {
    event.preventDefault()
    applyCommand('italic')
    return
  }

  if (event.key === 'Tab') {
    event.preventDefault()
    if (event.shiftKey) {
      applyCommand('outdent')
    } else {
      applyCommand('indent')
    }
    return
  }

  if (event.key === 'ArrowUp') {
    const textarea = textareaRef.value
    if (textarea) {
      const before = textarea.value.slice(0, textarea.selectionStart)
      if (!before.includes('\n')) {
        event.preventDefault()
        focusTitle()
      }
    }
  }
}

function focusTextarea(cursorAtEnd = false) {
  nextTick(() => {
    const textarea = textareaRef.value
    if (!textarea) return
    textarea.focus()
    if (cursorAtEnd) {
      const pos = textarea.value.length
      textarea.setSelectionRange(pos, pos)
    }
  })
}

function focusTitle() {
  nextTick(() => {
    const input = titleInputRef.value
    if (!input) return
    input.focus()
    const pos = input.value.length
    input.setSelectionRange(pos, pos)
  })
}

function focus() {
  focusTextarea(true)
}

function getSelection() {
  const textarea = textareaRef.value
  if (!textarea) return { start: 0, end: 0 }
  return { start: textarea.selectionStart, end: textarea.selectionEnd }
}

function setSelection(start, end = start) {
  const textarea = textareaRef.value
  if (!textarea) return
  const safeStart = Math.max(0, Math.min(start, textarea.value.length))
  const safeEnd = Math.max(safeStart, Math.min(end, textarea.value.length))
  textarea.focus({ preventScroll: true })
  textarea.setSelectionRange(safeStart, safeEnd)
}

function measureCaretTop(textarea, offset) {
  const style = window.getComputedStyle(textarea)
  const mirror = document.createElement('div')
  const marker = document.createElement('span')
  const mirroredProperties = [
    'direction',
    'fontFamily',
    'fontSize',
    'fontStyle',
    'fontVariant',
    'fontWeight',
    'letterSpacing',
    'lineHeight',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'tabSize',
    'textAlign',
    'textIndent',
    'textTransform',
    'wordBreak',
    'wordSpacing'
  ]

  for (const property of mirroredProperties) {
    mirror.style[property] = style[property]
  }

  Object.assign(mirror.style, {
    position: 'fixed',
    top: '0',
    left: '-99999px',
    boxSizing: 'border-box',
    width: `${textarea.clientWidth}px`,
    height: 'auto',
    minHeight: '0',
    overflow: 'hidden',
    overflowWrap: style.overflowWrap || 'break-word',
    pointerEvents: 'none',
    visibility: 'hidden',
    whiteSpace: 'pre-wrap'
  })

  mirror.textContent = textarea.value.slice(0, offset)
  marker.textContent = textarea.value.slice(offset) || '\u200b'
  mirror.appendChild(marker)
  document.body.appendChild(mirror)

  const caretTop = marker.offsetTop
  mirror.remove()
  return caretTop
}

function locateOffset(offset) {
  const textarea = textareaRef.value
  if (!textarea) return

  const safeOffset = Math.max(0, Math.min(offset, textarea.value.length))
  const targetTop = measureCaretTop(textarea, safeOffset)
  const maxScrollTop = Math.max(0, textarea.scrollHeight - textarea.clientHeight)
  const centeredScrollTop = Math.max(
    0,
    Math.min(maxScrollTop, targetTop - textarea.clientHeight * 0.42)
  )

  textarea.focus({ preventScroll: true })
  textarea.setSelectionRange(safeOffset, safeOffset)
  textarea.scrollTo({
    top: centeredScrollTop,
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
  })
  flashLocateFeedback()
}

function insertText(text, options = {}) {
  const textarea = textareaRef.value
  if (!textarea) return
  const start = options.start ?? textarea.selectionStart
  const end = options.end ?? textarea.selectionEnd
  const value = props.modelValue
  const newValue = value.slice(0, start) + text + value.slice(end)
  emit('update:modelValue', newValue)
  emit('input')
  const newCursor = start + text.length
  nextTick(() => {
    textarea.focus()
    textarea.setSelectionRange(newCursor, newCursor)
  })
}

function applyCommand(command) {
  markdown.applyCommand(command)
}

const applyMarkdownCommand = applyCommand

onMounted(async () => {
  const electronAPI = window.electronAPI
  if (!electronAPI) return

  try {
    const language = await electronAPI.getSpellcheckLanguage?.()
    if (language) {
      spellcheckLanguage.value = language
    }
  } catch (error) {
    console.warn('[MarkdownTextareaEditor] failed to load spellcheck language:', error)
  }

  removeSpellcheckLanguageListener = electronAPI.onSpellcheckLanguageChanged?.((language) => {
    if (language) {
      spellcheckLanguage.value = language
    }
  })
})

onUnmounted(() => {
  removeSpellcheckLanguageListener?.()
  if (locateTimer) {
    window.clearTimeout(locateTimer)
    locateTimer = null
  }
})

defineExpose({
  focus,
  focusTitle,
  getSelection,
  setSelection,
  insertText,
  applyCommand,
  applyMarkdownCommand,
  scrollToLine,
  locateOffset,
  getScrollRatio,
  scrollToRatio,
  getTopOffset,
  scrollToOffset
})
</script>

<style scoped>
.markdown-textarea-editor {
  min-height: 0;
  height: 100%;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}

.markdown-textarea-editor.dragging {
  outline: 2px dashed var(--bm-accent-blue);
  outline-offset: -2px;
}

.markdown-textarea-editor.locating .markdown-body-textarea {
  animation: markdownLocatePulse 620ms cubic-bezier(0.22, 1, 0.36, 1);
}

.markdown-title-input {
  width: 100%;
  flex: none;
  font-family: var(--bm-font-display);
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--bm-border-subtle);
  padding: 10px var(--bm-space-xl) 6px;
  font-size: 22px;
  font-weight: 600;
  color: var(--bm-text-primary);
  outline: none;
}

.markdown-title-input::placeholder {
  color: var(--bm-text-muted);
}

.markdown-title-input:focus {
  border-bottom-color: var(--bm-accent-blue);
  box-shadow: 0 1px 0 color-mix(in srgb, var(--bm-accent-blue) 24%, transparent);
}

.markdown-body-textarea {
  min-height: 0;
  width: 100%;
  height: 100%;
  resize: none;
  overflow: auto;
  line-height: 1.65;
  white-space: pre-wrap;
  background: transparent;
  border: none;
  outline: none;
  padding: var(--bm-space-lg) var(--bm-space-xl);
  color: var(--bm-text-primary);
  font-family: var(--bm-font-reading);
}

.markdown-body-textarea::placeholder {
  color: var(--bm-text-muted);
}

@keyframes markdownLocatePulse {
  0% {
    box-shadow: inset 3px 0 0 transparent;
    background: transparent;
  }
  35% {
    box-shadow: inset 3px 0 0 var(--bm-accent-blue);
    background: color-mix(in srgb, var(--bm-accent-blue) 7%, transparent);
  }
  100% {
    box-shadow: inset 3px 0 0 transparent;
    background: transparent;
  }
}
</style>
