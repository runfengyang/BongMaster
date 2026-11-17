<template>
  <aside class="markdown-preview-pane">
    <div ref="previewRef" class="markdown-preview-scroll">
      <div v-if="!editable && !content.trim()" class="markdown-preview-empty">{{ emptyText }}</div>
      <div
        v-else
        ref="previewContentRef"
        class="markdown-preview-content"
        :class="{ 'is-editable': editable }"
        :style="{ fontSize: `${fontSize}px` }"
        :contenteditable="editable ? 'true' : undefined"
        :data-placeholder="editable ? emptyText : undefined"
        :spellcheck="editable ? 'true' : undefined"
        @click="handlePreviewClick"
        @pointerdown="handlePreviewPointerDown"
        @beforeinput="handleContentBeforeInput"
        @input="handleContentInput"
        @keydown="handleContentKeydown"
        @paste="handleContentPaste"
      ></div>
    </div>
    <div
      v-if="showOutline"
      class="markdown-preview-outline-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="调整目录宽度"
      title="拖动调整目录宽度"
      @mousedown="startOutlineResize"
    ></div>
    <nav v-if="showOutline" class="markdown-preview-outline" :style="{ width: `min(${outlineWidth}px, 46%)` }" aria-label="章节导航">
      <div class="markdown-preview-outline-header">
        <span class="markdown-preview-outline-title">目录</span>
        <button
          type="button"
          class="markdown-preview-outline-toggle"
          title="隐藏目录"
          aria-label="隐藏目录"
          @mousedown.prevent
          @click="setOutlineHidden(true)"
        >
          <i class="fas fa-angles-right"></i>
        </button>
      </div>
      <button
        v-for="item in outlineItems"
        :key="item.index"
        type="button"
        class="markdown-preview-outline-item"
        :class="{ active: item.index === activeHeadingIndex }"
        :style="{ paddingLeft: `${10 + (item.level - 1) * 10}px` }"
        :title="item.text"
        @mousedown.prevent
        @click="scrollToHeading(item.index)"
      >
        {{ item.text }}
      </button>
    </nav>
    <button
      v-if="showOutlineRestore"
      type="button"
      class="markdown-preview-outline-restore"
      title="显示目录"
      aria-label="显示目录"
      @mousedown.prevent
      @click="setOutlineHidden(false)"
    >
      <i class="fas fa-list-ul"></i>
    </button>
  </aside>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { renderMarkdown } from '@utils/markdown.js'
import {
  serializeMarkdown,
  serializeMarkdownWithMap,
  markdownRangeForDomRange,
  domOffsetForMarkdownOffset
} from '@utils/markdown-editor.js'
import { applyMarkdownCommandToValue } from '@composables/useMarkdownCommands.js'
import { createUndoHistory } from '@utils/undo-history.js'

const props = defineProps({
  content: {
    type: String,
    default: ''
  },
  imageBaseDir: {
    type: String,
    default: ''
  },
  fontSize: {
    type: Number,
    default: 13
  },
  emptyText: {
    type: String,
    default: '预览区会显示当前便签内容'
  },
  editable: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits([
  'jump-to-line',
  'selection-change',
  'locate-request',
  'update:content',
  'input'
])

const previewRef = ref(null)
const previewContentRef = ref(null)
const resolvedBaseDir = ref(props.imageBaseDir)
const previewSelectionHighlightName = 'bm-preview-sync-selection'
const previewSelectionStyleId = 'bm-preview-sync-selection-style'
let isPointerSelecting = false
let pendingSelectionPayload = null
let locateTarget = null
let locateTimer = null
// Markdown we just emitted from this pane; the matching content update is
// already reflected in the DOM and must not trigger a re-render.
let lastEmittedContent = null
let pendingCaretOffset = null
// Caret to restore in markdown-offset space (undo/redo re-renders the DOM, so a
// DOM offset captured before the change no longer points at the same text).
let pendingMarkdownCaret = null

// Undo/redo for the editable preview. Contenteditable's native history is
// unusable here because every change serializes the DOM straight back into
// `props.content`; the parent re-render would drop the browser's own stack.
const undoHistory = createUndoHistory(60)
const TYPING_GROUP_MS = 600
let typingGroupTimer = null

function endTypingGroup() {
  if (typingGroupTimer) {
    window.clearTimeout(typingGroupTimer)
    typingGroupTimer = null
  }
}

function resetUndoHistory() {
  endTypingGroup()
  undoHistory.reset()
}

function buildSnapshot() {
  const root = previewContentRef.value
  if (!root) return null

  const serialized = serializeMarkdownWithMap(root, { imageBaseDir: resolvedBaseDir.value })
  const selection = readDomSelection(root)
  let caret = { start: serialized.markdown.length, end: serialized.markdown.length }

  if (selection) {
    const range = markdownRangeForDomRange(serialized, selection.start, selection.end)
    caret = { start: range.start, end: range.end }
  }

  return { markdown: serialized.markdown, caret }
}

// Called *before* a change lands, so the snapshot is the state to come back to.
function captureUndoSnapshot() {
  const snapshot = buildSnapshot()
  if (!snapshot) return
  const top = undoHistory.peek()
  if (top && top.markdown === snapshot.markdown &&
    top.caret.start === snapshot.caret.start && top.caret.end === snapshot.caret.end) {
    return
  }
  undoHistory.push(snapshot)
}

function applyHistorySnapshot(snapshot) {
  if (!snapshot) return
  endTypingGroup()
  lastEmittedContent = snapshot.markdown
  pendingCaretOffset = null
  pendingMarkdownCaret = snapshot.caret
  emit('update:content', snapshot.markdown)
  emit('input')
  // Render straight from the snapshot: if the parent already holds this exact
  // markdown the watcher never fires and the caret would stay unrestored.
  renderContent(snapshot.markdown)
}

function undoEdit() {
  const current = buildSnapshot()
  if (!current) return
  applyHistorySnapshot(undoHistory.undo(current))
}

function redoEdit() {
  const current = buildSnapshot()
  if (!current) return
  applyHistorySnapshot(undoHistory.redo(current))
}

// Section outline (preview mode only). Headings come from the rendered DOM and
// are addressed by index, so duplicated titles need no generated ids.
const OUTLINE_STATE_KEY = 'bongmaster-markdown-outline'
const OUTLINE_MIN_WIDTH = 140
const OUTLINE_MAX_WIDTH = 420
const OUTLINE_DEFAULT_WIDTH = 168

const outlineItems = ref([])
const activeHeadingIndex = ref(-1)
const outlineWidth = ref(OUTLINE_DEFAULT_WIDTH)
const outlineHidden = ref(false)
const hasOutlineHeadings = computed(() => outlineItems.value.length > 0)
const showOutline = computed(() => props.editable && !outlineHidden.value && hasOutlineHeadings.value)
const showOutlineRestore = computed(() => props.editable && outlineHidden.value && hasOutlineHeadings.value)
let headingElements = []
let outlineRefreshRaf = null
let activeHeadingRaf = null
let outlineResizeListeners = null

function readOutlineState() {
  try {
    const raw = window.localStorage.getItem(OUTLINE_STATE_KEY)
    if (!raw) return
    const state = JSON.parse(raw)
    if (Number.isFinite(state.width)) {
      outlineWidth.value = Math.max(OUTLINE_MIN_WIDTH, Math.min(OUTLINE_MAX_WIDTH, state.width))
    }
    outlineHidden.value = state.hidden === true
  } catch (err) {
    console.error('[MarkdownPreviewPane] read outline state failed:', err)
  }
}

function persistOutlineState() {
  try {
    window.localStorage.setItem(OUTLINE_STATE_KEY, JSON.stringify({
      width: outlineWidth.value,
      hidden: outlineHidden.value
    }))
  } catch (err) {
    console.error('[MarkdownPreviewPane] persist outline state failed:', err)
  }
}

function setOutlineHidden(hidden) {
  outlineHidden.value = hidden
  persistOutlineState()
}

function stopOutlineResize() {
  if (!outlineResizeListeners) return
  document.removeEventListener('mousemove', outlineResizeListeners.onMove)
  document.removeEventListener('mouseup', outlineResizeListeners.onUp)
  outlineResizeListeners = null
}

function startOutlineResize(event) {
  event.preventDefault()
  const startX = event.clientX
  const startWidth = outlineWidth.value

  const onMove = (moveEvent) => {
    // The outline is anchored to the right edge, so dragging left widens it.
    outlineWidth.value = Math.max(
      OUTLINE_MIN_WIDTH,
      Math.min(OUTLINE_MAX_WIDTH, startWidth + startX - moveEvent.clientX)
    )
  }
  const onUp = () => {
    stopOutlineResize()
    persistOutlineState()
  }

  stopOutlineResize()
  outlineResizeListeners = { onMove, onUp }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

readOutlineState()

function updateActiveHeading() {
  const pane = previewRef.value
  if (!pane || headingElements.length === 0) {
    activeHeadingIndex.value = -1
    return
  }

  const top = pane.getBoundingClientRect().top + 8
  let active = 0
  for (let i = 0; i < headingElements.length; i++) {
    if (headingElements[i].getBoundingClientRect().top > top) break
    active = i
  }
  activeHeadingIndex.value = active
}

function collectHeadings() {
  const root = previewContentRef.value
  headingElements = root ? Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6')) : []
  outlineItems.value = headingElements.map((el, index) => ({
    index,
    level: Number(el.tagName[1]) || 1,
    text: (el.textContent || '').replace(/\s+/g, ' ').trim() || `标题 ${index + 1}`
  }))
  updateActiveHeading()
}

function scheduleOutlineRefresh() {
  if (outlineRefreshRaf !== null) return
  outlineRefreshRaf = requestAnimationFrame(() => {
    outlineRefreshRaf = null
    collectHeadings()
  })
}

function handlePaneScroll() {
  if (activeHeadingRaf !== null) return
  activeHeadingRaf = requestAnimationFrame(() => {
    activeHeadingRaf = null
    updateActiveHeading()
  })
}

function scrollToHeading(index) {
  const target = headingElements[index]
  if (!target) return
  activeHeadingIndex.value = index
  target.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function serializeCurrentContent() {
  const root = previewContentRef.value
  if (!root) return null
  return serializeMarkdown(root, { imageBaseDir: resolvedBaseDir.value })
}

function textOffsetOfDomPosition(root, node, offset) {
  let total = 0
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let current = walker.nextNode()
  while (current) {
    if (current === node) return total + offset
    total += current.nodeValue.length
    current = walker.nextNode()
  }

  if (node.nodeType === 1) {
    const child = node.childNodes[offset]
    const range = document.createRange()
    range.selectNodeContents(root)
    if (child) {
      range.setEndBefore(child)
    } else if (node.lastChild) {
      range.setEndAfter(node.lastChild)
    } else {
      return total
    }
    return range.toString().length
  }

  return total
}

function readDomSelection(root) {
  const selection = window.getSelection()
  if (!selection || !selection.rangeCount) return null

  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null

  return {
    start: textOffsetOfDomPosition(root, range.startContainer, range.startOffset),
    end: textOffsetOfDomPosition(root, range.endContainer, range.endOffset)
  }
}

function setCaretTextOffset(root, offset) {
  const selection = window.getSelection()
  if (!selection) return

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let remaining = Math.max(0, offset)
  let node = walker.nextNode()
  let lastNode = null

  while (node) {
    lastNode = node
    if (remaining <= node.nodeValue.length) break
    remaining -= node.nodeValue.length
    node = walker.nextNode()
  }

  const range = document.createRange()
  if (node) {
    range.setStart(node, Math.min(remaining, node.nodeValue.length))
  } else if (lastNode) {
    range.setStart(lastNode, lastNode.nodeValue.length)
  } else {
    range.selectNodeContents(root)
  }
  range.collapse(true)

  selection.removeAllRanges()
  selection.addRange(range)
}

function prepareEditableDom(root) {
  if (!props.editable) return
  root.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.removeAttribute('disabled')
  })
}

function setDomRangeOffsets(root, start, end) {
  const selection = window.getSelection()
  if (!selection) return

  const range = document.createRange()
  const startPosition = getTextPositionAtOffset(root, start)
  if (!startPosition) {
    range.selectNodeContents(root)
    range.collapse(true)
  } else {
    const endPosition = getTextPositionAtOffset(root, end)
    range.setStart(startPosition.node, startPosition.offset)
    if (endPosition) {
      range.setEnd(endPosition.node, endPosition.offset)
    } else {
      range.collapse(true)
    }
  }

  selection.removeAllRanges()
  selection.addRange(range)
}

function setCaretFromMarkdownOffsets(root, caret) {
  const { map } = serializeMarkdownWithMap(root, { imageBaseDir: resolvedBaseDir.value })
  const start = domOffsetForMarkdownOffset(map, caret.start)
  const end = caret.end > caret.start ? domOffsetForMarkdownOffset(map, caret.end) : start
  root.focus({ preventScroll: true })
  setDomRangeOffsets(root, start, end)
}

function renderContent(markdownOverride) {
  const root = previewContentRef.value
  if (!root) return

  const content = markdownOverride === undefined ? props.content : markdownOverride
  const caretOffset = pendingCaretOffset
  const markdownCaret = pendingMarkdownCaret
  pendingCaretOffset = null
  pendingMarkdownCaret = null

  root.innerHTML = content ? renderMarkdown(content, resolvedBaseDir.value) : ''
  prepareEditableDom(root)
  clearPreviewSelectionHighlight()
  collectHeadings()

  if (markdownCaret) {
    setCaretFromMarkdownOffsets(root, markdownCaret)
    return
  }
  if (caretOffset === null) return
  root.focus({ preventScroll: true })
  setCaretTextOffset(root, caretOffset)
}

// `beforeinput` still sees the pre-change DOM, which is exactly what an undo
// needs. Grouped so one continuous burst of typing is a single history entry.
function handleContentBeforeInput(event) {
  if (!props.editable) return
  if (event && event.isComposing) return
  if (!typingGroupTimer) {
    captureUndoSnapshot()
    typingGroupTimer = window.setTimeout(() => {
      typingGroupTimer = null
    }, TYPING_GROUP_MS)
  }
}

function handleContentInput() {
  const root = previewContentRef.value
  if (!root || !props.editable) return

  const markdown = serializeCurrentContent()
  if (markdown === null || markdown === props.content) return

  lastEmittedContent = markdown
  emit('update:content', markdown)
  emit('input')
  scheduleOutlineRefresh()
}

function handleContentKeydown(event) {
  if (!props.editable || event.isComposing) return
  if (!event.metaKey && !event.ctrlKey) return

  const key = event.key.toLowerCase()
  if (key === 'b') {
    event.preventDefault()
    applyCommand('bold')
  } else if (key === 'i') {
    event.preventDefault()
    applyCommand('italic')
  } else if (key === 'u') {
    event.preventDefault()
    applyCommand('underline')
  } else if (key === 'z') {
    event.preventDefault()
    if (event.shiftKey) redoEdit()
    else undoEdit()
  } else if (key === 'y') {
    event.preventDefault()
    redoEdit()
  }
}

function handleContentPaste(event) {
  if (!props.editable) return

  const text = event.clipboardData?.getData('text/plain')
  if (!text) return
  event.preventDefault()
  captureUndoSnapshot()
  endTypingGroup()

  const inserted = typeof document.execCommand === 'function' &&
    document.execCommand('insertText', false, text)
  if (inserted) return

  const selection = window.getSelection()
  const root = previewContentRef.value
  if (!selection || !selection.rangeCount || !root) return

  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer)) return
  range.deleteContents()
  const textNode = document.createTextNode(text)
  range.insertNode(textNode)
  range.setStart(textNode, textNode.length)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
  handleContentInput()
}

function applyCommand(command) {
  const root = previewContentRef.value
  if (!root || !props.editable) return

  const selection = readDomSelection(root)
  const serialized = serializeMarkdownWithMap(root, { imageBaseDir: resolvedBaseDir.value })
  const { markdown } = serialized

  let start = markdown.length
  let end = markdown.length

  if (selection) {
    const range = markdownRangeForDomRange(serialized, selection.start, selection.end)
    start = range.start
    end = range.end
  }

  const result = applyMarkdownCommandToValue(markdown, start, end, command)
  if (result.value === markdown) return

  // The DOM is still untouched here, so this is the state Ctrl/Cmd+Z returns to.
  captureUndoSnapshot()
  endTypingGroup()

  const base = selection ? selection.start : (root.textContent || '').length
  pendingCaretOffset = Math.max(0, base + (end - start))

  lastEmittedContent = result.value
  emit('update:content', result.value)
  emit('input')
}

function clearPreviewSelectionHighlight() {
  if (window.CSS?.highlights) {
    window.CSS.highlights.delete(previewSelectionHighlightName)
  }
}

function applyPreviewSelectionHighlight(range) {
  clearPreviewSelectionHighlight()
  if (!window.CSS?.highlights || typeof window.Highlight !== 'function') return
  ensurePreviewSelectionStyle()
  window.CSS.highlights.set(previewSelectionHighlightName, new window.Highlight(range.cloneRange()))
}

function ensurePreviewSelectionStyle() {
  if (document.getElementById(previewSelectionStyleId)) return
  const style = document.createElement('style')
  style.id = previewSelectionStyleId
  style.textContent = `
    ::highlight(${previewSelectionHighlightName}) {
      background: color-mix(in srgb, var(--bm-accent-blue) 30%, transparent);
      color: inherit;
    }
  `
  document.head.appendChild(style)
}

function handlePreviewClick(event) {
  if (props.editable) {
    // Editing: let the browser place the caret, but never navigate away.
    if (event.target.closest?.('a')) event.preventDefault()
    return
  }

  if (event.button === 0 && (event.metaKey || event.ctrlKey)) {
    event.preventDefault()
    const payload = buildLocatePayload(event)
    if (payload) {
      flashLocateTarget(event.target)
      emit('locate-request', payload)
    }
    return
  }

  const heading = event.target.closest?.('h1, h2, h3')
  if (!heading) return
  const text = heading.textContent?.trim()
  if (!text) return
  emit('jump-to-line', { type: 'heading', text })
}

function getCaretRangeFromPoint(clientX, clientY) {
  if (typeof document.caretPositionFromPoint === 'function') {
    const position = document.caretPositionFromPoint(clientX, clientY)
    if (!position) return null
    const range = document.createRange()
    range.setStart(position.offsetNode, position.offset)
    range.collapse(true)
    return range
  }

  if (typeof document.caretRangeFromPoint === 'function') {
    return document.caretRangeFromPoint(clientX, clientY)
  }

  return null
}

function buildLocatePayload(event) {
  const root = previewContentRef.value
  if (!root) return null

  const caretRange = getCaretRangeFromPoint(event.clientX, event.clientY)
  if (!caretRange || !root.contains(caretRange.startContainer)) return null

  const block = event.target.closest?.(
    'h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, td, th'
  ) || root
  const rootRange = document.createRange()
  rootRange.selectNodeContents(root)
  const fullText = rootRange.toString()

  const beforeCaretRange = document.createRange()
  beforeCaretRange.selectNodeContents(root)
  beforeCaretRange.setEnd(caretRange.startContainer, caretRange.startOffset)
  const previewOffset = beforeCaretRange.toString().length

  const blockRange = document.createRange()
  blockRange.selectNodeContents(block)
  const selectedText = blockRange.toString()

  const beforeBlockRange = document.createRange()
  beforeBlockRange.selectNodeContents(root)
  beforeBlockRange.setEnd(blockRange.startContainer, blockRange.startOffset)
  const startOffset = beforeBlockRange.toString().length
  const endOffset = startOffset + selectedText.length

  return {
    selectedText,
    before: fullText.slice(Math.max(0, startOffset - 48), startOffset),
    after: fullText.slice(endOffset, endOffset + 48),
    startOffset,
    endOffset,
    localOffset: Math.max(0, Math.min(selectedText.length, previewOffset - startOffset))
  }
}

function clearLocateTarget() {
  if (locateTarget) {
    locateTarget.classList.remove('preview-locate-target')
    locateTarget = null
  }
  if (locateTimer) {
    window.clearTimeout(locateTimer)
    locateTimer = null
  }
}

function flashLocateTarget(target) {
  clearLocateTarget()
  locateTarget = target.closest?.(
    'h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, td, th'
  ) || previewContentRef.value
  if (!locateTarget) return

  locateTarget.classList.add('preview-locate-target')
  locateTimer = window.setTimeout(clearLocateTarget, 720)
}

function buildSelectionPayload() {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null

  const root = previewContentRef.value
  if (!root) return null

  const range = sel.getRangeAt(0)
  if (!range.intersectsNode(root)) return null

  const selectedRange = range.cloneRange()
  const rootRange = document.createRange()
  rootRange.selectNodeContents(root)

  if (selectedRange.compareBoundaryPoints(Range.START_TO_START, rootRange) < 0) {
    selectedRange.setStart(root, 0)
  }
  if (selectedRange.compareBoundaryPoints(Range.END_TO_END, rootRange) > 0) {
    selectedRange.setEnd(root, root.childNodes.length)
  }

  const selectedText = selectedRange.toString()
  if (!selectedText) return null
  if (!selectedText.trim()) return null

  const beforeRange = selectedRange.cloneRange()
  beforeRange.selectNodeContents(root)
  beforeRange.setEnd(selectedRange.startContainer, selectedRange.startOffset)

  const fullText = rootRange.toString()
  const startOffset = beforeRange.toString().length
  const endOffset = startOffset + selectedText.length
  const before = fullText.slice(Math.max(0, startOffset - 40), startOffset)
  const after = fullText.slice(endOffset, endOffset + 40)

  applyPreviewSelectionHighlight(selectedRange)

  return {
    selectedText,
    before,
    after,
    startOffset,
    endOffset
  }
}

function emitSelectionPayload(payload) {
  if (!payload) return
  emit('selection-change', payload)
}

function handleSelectionChange() {
  if (props.editable) return

  const payload = buildSelectionPayload()
  if (!payload) return

  pendingSelectionPayload = payload
  if (!isPointerSelecting) {
    emitSelectionPayload(payload)
  }
}

function handlePreviewPointerDown() {
  if (props.editable) return
  isPointerSelecting = true
  pendingSelectionPayload = null
  clearPreviewSelectionHighlight()
}

function handleDocumentPointerUp() {
  if (props.editable) {
    isPointerSelecting = false
    return
  }
  if (!isPointerSelecting) return
  requestAnimationFrame(() => {
    isPointerSelecting = false
    const payload = buildSelectionPayload() || pendingSelectionPayload
    pendingSelectionPayload = null
    emitSelectionPayload(payload)
  })
}

let _selectionWatcher = null
let _pointerUpWatcher = null

watch(
  () => props.content,
  () => {
    // A pending caret means this pane asked for the re-render (command/undo) and
    // needs it to place the cursor.
    if (pendingCaretOffset !== null || pendingMarkdownCaret !== null) {
      lastEmittedContent = null
      renderContent()
      return
    }
    // Content produced by this pane is already in the DOM: re-rendering would
    // reset the caret while typing.
    if (props.content === lastEmittedContent) {
      lastEmittedContent = null
      return
    }
    lastEmittedContent = null
    // The serializer is a fixed point for our own output, so equality here means
    // a plain echo (autosave/store write-back) and not an external edit.
    if (serializeCurrentContent() === props.content) return
    // Genuinely external content (another note, MCP write): history belongs to
    // the note that is gone.
    resetUndoHistory()
    renderContent()
  },
  // After the DOM flush so the content node exists when it was hidden by the
  // empty state.
  { flush: 'post' }
)

watch(
  () => resolvedBaseDir.value,
  () => {
    renderContent()
  },
  { flush: 'post' }
)

watch(
  () => props.editable,
  () => {
    const root = previewContentRef.value
    if (root) prepareEditableDom(root)
  }
)

onMounted(async () => {
  renderContent()

  // Resolve image base dir.
  if (!resolvedBaseDir.value && window.electronAPI?.getImageBaseDir) {
    try {
      const dir = await window.electronAPI.getImageBaseDir()
      resolvedBaseDir.value = dir || ''
    } catch {
      resolvedBaseDir.value = ''
    }
  }

  // Watch for text selection in the preview pane.
  _selectionWatcher = () => handleSelectionChange()
  _pointerUpWatcher = () => handleDocumentPointerUp()
  document.addEventListener('selectionchange', _selectionWatcher)
  document.addEventListener('pointerup', _pointerUpWatcher)
  previewRef.value?.addEventListener('scroll', handlePaneScroll, { passive: true })
})

onUnmounted(() => {
  endTypingGroup()
  clearPreviewSelectionHighlight()
  clearLocateTarget()
  stopOutlineResize()
  previewRef.value?.removeEventListener('scroll', handlePaneScroll)
  if (outlineRefreshRaf !== null) {
    cancelAnimationFrame(outlineRefreshRaf)
    outlineRefreshRaf = null
  }
  if (activeHeadingRaf !== null) {
    cancelAnimationFrame(activeHeadingRaf)
    activeHeadingRaf = null
  }
  if (_selectionWatcher) {
    document.removeEventListener('selectionchange', _selectionWatcher)
    _selectionWatcher = null
  }
  if (_pointerUpWatcher) {
    document.removeEventListener('pointerup', _pointerUpWatcher)
    _pointerUpWatcher = null
  }
})

function getScrollRatio() {
  const pane = previewRef.value
  if (!pane) return 0
  const scrollHeight = pane.scrollHeight - pane.clientHeight
  return scrollHeight > 0 ? pane.scrollTop / scrollHeight : 0
}

function scrollToRatio(ratio) {
  const pane = previewRef.value
  if (!pane) return
  const scrollHeight = pane.scrollHeight - pane.clientHeight
  if (scrollHeight > 0) {
    pane.scrollTop = ratio * scrollHeight
  }
}

function normalizeTextWithMap(value) {
  const result = { text: '', map: [] }
  let inWhitespace = false

  for (let i = 0; i < value.length; i++) {
    if (/\s/.test(value[i])) {
      if (!inWhitespace && result.text.length > 0) {
        result.text += ' '
        result.map.push(i)
      }
      inWhitespace = true
      continue
    }

    result.text += value[i]
    result.map.push(i)
    inWhitespace = false
  }

  return result
}

function findContextOffset(fullText, before, after, offsetRatio = 0) {
  const normalizedFull = normalizeTextWithMap(fullText)
  const normalizedBefore = normalizeTextWithMap(before || '').text
  const normalizedAfter = normalizeTextWithMap(after || '').text
  const beforeNeedle = normalizedBefore.slice(-32)
  const afterNeedle = normalizedAfter.slice(0, 32)
  const expected = Math.round(normalizedFull.text.length * Math.max(0, Math.min(1, offsetRatio)))

  if (!beforeNeedle) {
    const start = afterNeedle ? normalizedFull.text.indexOf(afterNeedle) : 0
    return normalizedFull.map[Math.max(0, start)] ?? 0
  }

  let bestOffset = -1
  let bestScore = -Infinity
  let index = normalizedFull.text.indexOf(beforeNeedle)
  while (index !== -1) {
    const candidate = index + beforeNeedle.length
    const following = normalizedFull.text.slice(candidate, candidate + afterNeedle.length)
    let matching = 0
    while (matching < following.length && following[matching] === afterNeedle[matching]) {
      matching += 1
    }
    const score = matching * 10 - Math.abs(candidate - expected) / 100
    if (score > bestScore) {
      bestScore = score
      bestOffset = candidate
    }
    index = normalizedFull.text.indexOf(beforeNeedle, index + 1)
  }

  if (bestOffset === -1 && afterNeedle) {
    bestOffset = normalizedFull.text.indexOf(afterNeedle)
  }
  if (bestOffset < 0) {
    bestOffset = expected
  }

  return normalizedFull.map[Math.min(bestOffset, normalizedFull.map.length - 1)] ?? 0
}

function getTextPositionAtOffset(root, rawOffset) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let remaining = Math.max(0, rawOffset)
  let node = walker.nextNode()
  let lastNode = null

  while (node) {
    lastNode = node
    if (remaining <= node.textContent.length) {
      return { node, offset: remaining }
    }
    remaining -= node.textContent.length
    node = walker.nextNode()
  }

  return lastNode
    ? { node: lastNode, offset: lastNode.textContent.length }
    : null
}

// 视口顶部第一个可见字符所在的位置（文本节点 + 节点内偏移）。
function topVisibleTextPosition(pane, root) {
  const rect = pane.getBoundingClientRect()
  // 采样点落在正文栏内（避开左右内边距），否则拿不到插入点。
  const paddingLeft = parseFloat(window.getComputedStyle(pane).paddingLeft) || 0
  const caret = document.caretRangeFromPoint?.(rect.left + paddingLeft + 2, rect.top + 4)
  const container = caret?.startContainer
  if (container && root.contains(container) && container.nodeType === Node.TEXT_NODE) {
    return { node: container, offset: caret.startOffset }
  }

  // 顶部正好落在内边距里（滚动位置为 0）或浏览器不给插入点：退回第一个还没滚出
  // 视口的块级子元素的起始文本。
  const topEdge = rect.top + 4
  for (const child of Array.from(root.children)) {
    if (child.getBoundingClientRect().bottom > topEdge) {
      const node = document.createTreeWalker(child, NodeFilter.SHOW_TEXT).nextNode()
      if (node) return { node, offset: 0 }
    }
  }
  return null
}

// 顶部可见文本的滚动锚点：预览 DOM 与源码 textarea 的高度不成比例，切视图时靠它对齐。
function captureTopAnchor() {
  const pane = previewRef.value
  const root = previewContentRef.value
  const ratio = getScrollRatio()
  const empty = { ratio, rawOffset: null, offsetRatio: 0, selectedText: '', before: '', after: '' }
  if (!pane || !root) return empty

  const position = topVisibleTextPosition(pane, root)
  if (!position) return empty

  const { node, offset } = position
  const rawOffset = textOffsetOfDomPosition(root, node, offset)
  const total = root.textContent?.length || 0
  return {
    ratio,
    rawOffset,
    offsetRatio: rawOffset / Math.max(1, total - 1),
    selectedText: node.nodeValue.slice(offset, offset + 96),
    before: node.nodeValue.slice(Math.max(0, offset - 48), offset),
    after: node.nodeValue.slice(offset + 96, offset + 144)
  }
}

// 某个文本偏移处的插入点范围。落在节点边界（或空节点）上的插入点量不出高度，
// 往后挪到下一个有内容的文本节点。
function caretRangeAtTextOffset(root, rawOffset) {
  const position = getTextPositionAtOffset(root, rawOffset)
  if (!position) return null

  let { node, offset } = position
  if (!node.nodeValue.length) return null

  if (offset >= node.nodeValue.length) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    walker.currentNode = node
    let next = walker.nextNode()
    while (next && next.nodeValue.length === 0) next = walker.nextNode()
    if (next) {
      node = next
      offset = 0
    } else {
      offset = Math.max(0, node.nodeValue.length - 1)
    }
  }

  const range = document.createRange()
  range.setStart(node, Math.min(offset, node.nodeValue.length))
  range.setEnd(node, Math.min(node.nodeValue.length, offset + 1))
  return range
}

// 把某个文本偏移滚到窗格顶部，返回是否命中。
function scrollTextOffsetToTop(rawOffset) {
  const pane = previewRef.value
  const root = previewContentRef.value
  if (!pane || !root) return false

  const range = caretRangeAtTextOffset(root, rawOffset)
  if (!range) return false

  const caretRect = range.getBoundingClientRect()
  const paneRect = pane.getBoundingClientRect()
  const target = range.startContainer.parentElement || root
  const anchorTop = caretRect.height > 0 ? caretRect.top : target.getBoundingClientRect().top
  const maxScrollTop = Math.max(0, pane.scrollHeight - pane.clientHeight)
  pane.scrollTop = Math.max(0, Math.min(maxScrollTop, pane.scrollTop + anchorTop - paneRect.top))
  return true
}

function restoreTopAnchor(anchor) {
  const pane = previewRef.value
  if (!pane || !anchor) return false

  const root = previewContentRef.value
  const fullText = root?.textContent || ''
  let offset = -1

  if (anchor.selectedText) {
    const expected = Number.isInteger(anchor.rawOffset) ? anchor.rawOffset : -1
    let best = -1
    let bestDistance = Infinity
    let index = fullText.indexOf(anchor.selectedText)
    while (index !== -1) {
      const distance = expected >= 0 ? Math.abs(index - expected) : 0
      if (distance < bestDistance) {
        bestDistance = distance
        best = index
        if (distance === 0) break
      }
      index = fullText.indexOf(anchor.selectedText, index + 1)
    }
    offset = best
  }

  if (offset < 0 && Number.isInteger(anchor.rawOffset)) offset = anchor.rawOffset
  if (offset < 0 || !scrollTextOffsetToTop(offset)) {
    scrollToRatio(Number.isFinite(anchor.ratio) ? anchor.ratio : 0)
    return false
  }
  return true
}

function locateTextContext({ before = '', after = '', offsetRatio = 0, align = 'center' } = {}) {
  const root = previewContentRef.value
  if (!root) return

  const rootRange = document.createRange()
  rootRange.selectNodeContents(root)
  const rawOffset = findContextOffset(rootRange.toString(), before, after, offsetRatio)

  if (align === 'start') {
    // 视图切换恢复位置：不选中、不高亮，直接落到顶部。
    scrollTextOffsetToTop(rawOffset)
    return
  }

  const position = getTextPositionAtOffset(root, rawOffset)
  if (!position) return

  const range = document.createRange()
  range.setStart(position.node, position.offset)
  range.setEnd(position.node, Math.min(position.node.textContent.length, position.offset + 1))
  applyPreviewSelectionHighlight(range)

  const target = position.node.parentElement || root
  target.scrollIntoView({ block: 'center', behavior: 'smooth' })
  flashLocateTarget(target)
}

defineExpose({
  getScrollRatio,
  scrollToRatio,
  locateTextContext,
  captureTopAnchor,
  restoreTopAnchor,
  applyCommand,
  focus: () => previewContentRef.value?.focus({ preventScroll: true })
})
</script>

<style scoped>
.markdown-preview-pane {
  position: relative;
  display: flex;
  flex-direction: row;
  min-height: 0;
  height: 100%;
  background: var(--bm-bg-card);
  color: var(--bm-text-primary);
  font-family: var(--bm-font-ui);
  font-size: 13px;
  line-height: 1.65;
}

.markdown-preview-content {
  font-family: var(--bm-font-reading);
}

.markdown-preview-scroll {
  flex: 1 1 0%;
  min-width: 0;
  overflow: auto;
  padding: var(--bm-space-lg) var(--bm-space-xl);
}

.markdown-preview-outline-resizer {
  flex: 0 0 auto;
  width: 8px;
  cursor: col-resize;
  position: relative;
  z-index: 2;
}

.markdown-preview-outline-resizer::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 3px;
  width: 2px;
  border-radius: 1px;
  background: var(--bm-border-subtle);
  transition: background-color 120ms ease;
}

.markdown-preview-outline-resizer:hover::after,
.markdown-preview-outline-resizer:active::after {
  background: color-mix(in srgb, var(--bm-accent-blue) 55%, transparent);
}

.markdown-preview-outline {
  position: relative;
  flex: 0 0 auto;
  overflow-y: auto;
  padding: var(--bm-space-md) var(--bm-space-sm);
}

.markdown-preview-outline-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--bm-space-xs);
  margin: 0 0 var(--bm-space-xs);
  padding: 0 4px 0 10px;
}

.markdown-preview-outline-title {
  font-size: 0.6875rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--bm-text-muted);
}

.markdown-preview-outline-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: var(--bm-radius-sm);
  background: transparent;
  color: var(--bm-text-muted);
  font-size: 0.6875rem;
  cursor: pointer;
}

.markdown-preview-outline-toggle:hover {
  background: var(--bm-bg-hover);
  color: var(--bm-text-primary);
}

.markdown-preview-outline-restore {
  position: absolute;
  top: 10px;
  right: 8px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid var(--bm-border-subtle);
  border-radius: var(--bm-radius-sm);
  background: color-mix(in srgb, var(--bm-bg-card) 88%, transparent);
  color: var(--bm-text-muted);
  cursor: pointer;
}

.markdown-preview-outline-restore:hover {
  border-color: color-mix(in srgb, var(--bm-accent-blue) 45%, transparent);
  color: var(--bm-accent-blue);
}

.markdown-preview-outline-item {
  display: block;
  width: 100%;
  padding: 4px 10px;
  border: none;
  border-radius: var(--bm-radius-sm);
  background: transparent;
  color: var(--bm-text-secondary);
  font-size: 0.8125rem;
  line-height: 1.35;
  text-align: left;
  /* Long headings wrap instead of widening the pane; unbreakable tokens
     (long URLs, hashes) break anywhere so the outline keeps its width. */
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
  cursor: pointer;
}

.markdown-preview-outline-item:hover {
  background: var(--bm-bg-hover);
  color: var(--bm-text-primary);
}

.markdown-preview-outline-item.active {
  background: color-mix(in srgb, var(--bm-accent-blue) 12%, transparent);
  color: var(--bm-accent-blue);
  font-weight: 600;
}

.markdown-preview-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--bm-text-muted);
  font-size: 0.9375rem;
  text-align: center;
}

.markdown-preview-content :deep(h1),
.markdown-preview-content :deep(h2),
.markdown-preview-content :deep(h3) {
  margin: 0.35em 0;
  font-family: var(--bm-font-display);
  font-weight: 600;
  line-height: 1.3;
  color: var(--bm-text-primary);
}

.markdown-preview-content.is-editable {
  outline: none;
  min-height: 100%;
}

.markdown-preview-content.is-editable:empty::before {
  content: attr(data-placeholder);
  color: var(--bm-text-muted);
  pointer-events: none;
}

.markdown-preview-content.is-editable :deep(h1),
.markdown-preview-content.is-editable :deep(h2),
.markdown-preview-content.is-editable :deep(h3) {
  cursor: text;
}

.markdown-preview-content.is-editable :deep(h1):hover,
.markdown-preview-content.is-editable :deep(h2):hover,
.markdown-preview-content.is-editable :deep(h3):hover {
  color: var(--bm-text-primary);
}

.markdown-preview-content :deep(input[type="checkbox"]) {
  margin-right: 0.4em;
  vertical-align: middle;
}

.markdown-preview-content :deep(li:has(> input[type="checkbox"])) {
  list-style: none;
  margin-left: -1.25em;
}

.markdown-preview-content :deep(h1),
.markdown-preview-content :deep(h2),
.markdown-preview-content :deep(h3) {
  cursor: pointer;
}

.markdown-preview-content :deep(h1):hover,
.markdown-preview-content :deep(h2):hover,
.markdown-preview-content :deep(h3):hover {
  color: var(--bm-accent-blue);
}

.markdown-preview-content :deep(.preview-locate-target) {
  animation: previewLocatePulse 720ms cubic-bezier(0.22, 1, 0.36, 1);
}

.markdown-preview-content :deep(h1) { font-size: 1.5em; }
.markdown-preview-content :deep(h2) { font-size: 1.25em; }
.markdown-preview-content :deep(h3) { font-size: 1.125em; }

.markdown-preview-content :deep(p) {
  margin: 0.35em 0;
}

.markdown-preview-content :deep(ins) {
  text-decoration-thickness: 1.5px;
  text-underline-offset: 0.16em;
}

.markdown-preview-content :deep(del),
.markdown-preview-content :deep(s) {
  text-decoration: line-through;
  text-decoration-thickness: 1.5px;
  opacity: 0.75;
}

.markdown-preview-content :deep(mark) {
  padding: 0.08em 0.22em;
  border-radius: 4px;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
  color: inherit;
}

.markdown-preview-content :deep(.bm-highlight-yellow) { background: #fff2a8; }
.markdown-preview-content :deep(.bm-highlight-orange) { background: #ffd6a5; }
.markdown-preview-content :deep(.bm-highlight-pink) { background: #ffd1dc; }
.markdown-preview-content :deep(.bm-highlight-purple) { background: #eadcff; }
.markdown-preview-content :deep(.bm-highlight-blue) { background: #cfe8ff; }
.markdown-preview-content :deep(.bm-highlight-green) { background: #d8f5d1; }

.markdown-preview-content :deep(.note-math-inline) {
  display: inline-flex;
  max-width: 100%;
  vertical-align: -0.08em;
}

.markdown-preview-content :deep(.note-math-display) {
  max-width: 100%;
  margin: 0.5em 0;
  overflow-x: auto;
  overflow-y: hidden;
}

.markdown-preview-content :deep(ul),
.markdown-preview-content :deep(ol) {
  margin: 0.35em 0;
  padding-left: 1.5em;
}

.markdown-preview-content :deep(li) {
  margin: 0.15em 0;
}

.markdown-preview-content :deep(blockquote) {
  margin: 0.5em 0;
  padding: 0.35em 0.85em;
  border-left: 3px solid var(--bm-border-strong);
  color: var(--bm-text-secondary);
  background: var(--bm-bg-hover);
  border-radius: 0 var(--bm-radius-sm) var(--bm-radius-sm) 0;
}

@keyframes previewLocatePulse {
  0% {
    box-shadow: inset 3px 0 0 transparent;
    background-color: transparent;
  }
  35% {
    box-shadow: inset 3px 0 0 var(--bm-accent-blue);
    background-color: color-mix(in srgb, var(--bm-accent-blue) 9%, transparent);
  }
  100% {
    box-shadow: inset 3px 0 0 transparent;
    background-color: transparent;
  }
}

.markdown-preview-content :deep(pre) {
  background-color: rgba(0, 0, 0, 0.04);
  padding: var(--bm-space-md);
  border-radius: var(--bm-radius-md);
  overflow-x: auto;
  margin: 0.5em 0;
}

.markdown-preview-content :deep(code) {
  font-family: var(--bm-font-mono);
  font-size: 0.875em;
}

.markdown-preview-content :deep(pre code) {
  background: transparent;
  padding: 0;
}

.markdown-preview-content :deep(table) {
  width: 100%;
  margin: 0.65em 0;
  border-collapse: collapse;
  table-layout: auto;
  font-size: 0.9375rem;
  display: block;
  overflow-x: auto;
  max-width: 100%;
}

.markdown-preview-content :deep(thead),
.markdown-preview-content :deep(tbody),
.markdown-preview-content :deep(tr) {
  display: table;
  width: 100%;
  table-layout: fixed;
}

.markdown-preview-content :deep(th),
.markdown-preview-content :deep(td) {
  padding: 0.42rem 0.55rem;
  border: 1px solid var(--bm-border-default);
  text-align: left;
  vertical-align: top;
  word-break: break-word;
}

.markdown-preview-content :deep(th) {
  background: var(--bm-bg-hover);
  color: var(--bm-text-primary);
  font-weight: 600;
}

.markdown-preview-content :deep(hr) {
  border: none;
  border-top: 1px solid var(--bm-border-default);
  margin: 0.75em 0;
}

.markdown-preview-content :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: var(--bm-radius-md);
}

.markdown-preview-content :deep(a) {
  color: var(--bm-accent-blue);
  text-decoration: none;
}

.markdown-preview-content :deep(a:hover) {
  text-decoration: underline;
}
</style>
