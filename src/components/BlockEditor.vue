<!--
  Deprecated experimental editor.
  Kept for reference only; the default notepad path now uses MarkdownTextareaEditor.
  This component will be removed in a future release once the textarea editor is stable.
-->
<template>
  <div class="block-editor" @click="handleContainerClick">
    <div
      v-for="(block, index) in blocks"
      :key="block.id"
      class="block-row"
      :class="[`block-type-${block.type}`, { 'is-active': activeBlockId === block.id }]"
    >
      <!-- Edit mode -->
      <template v-if="activeBlockId === block.id">
        <div
          v-if="isMarkdownTable(block)"
          class="block-table-editor"
          @keydown="onTableKeyDown(block, index, $event)"
          @paste="onPaste($event)"
          @focusout="onTableFocusOut(block, $event)"
        >
          <div class="table-editor-scroll">
            <table>
              <thead>
                <tr>
                  <th
                    v-for="(cell, cellIndex) in getTableRows(block)[0]"
                    :key="`head-${block.id}-${cellIndex}`"
                    contenteditable="true"
                    :data-table-cell="`${block.id}:0:${cellIndex}`"
                    @input="onTableCellInput(block, 0, cellIndex, $event)"
                    @focus="activeBlockId = block.id"
                  >{{ cell }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(row, rowIndex) in getTableRows(block).slice(1)"
                  :key="`row-${block.id}-${rowIndex}`"
                >
                  <td
                    v-for="(cell, cellIndex) in row"
                    :key="`cell-${block.id}-${rowIndex}-${cellIndex}`"
                    contenteditable="true"
                    :data-table-cell="`${block.id}:${rowIndex + 1}:${cellIndex}`"
                    @input="onTableCellInput(block, rowIndex + 1, cellIndex, $event)"
                    @focus="activeBlockId = block.id"
                  >{{ cell }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="table-editor-actions" aria-label="表格操作">
            <button type="button" @mousedown.prevent @click="addTableRow(block)">
              <i class="fas fa-plus"></i>
              行
            </button>
            <button type="button" @mousedown.prevent @click="addTableColumn(block)">
              <i class="fas fa-plus"></i>
              列
            </button>
          </div>
        </div>
        <div
          v-else-if="![BLOCK_TYPES.CODE, BLOCK_TYPES.MATH].includes(block.type)"
          :ref="el => setEditorRef(block.id, el)"
          class="block-editor-input"
          contenteditable="true"
          :placeholder="getBlockPlaceholder(block)"
          @input="onInput(block, $event)"
          @keydown="onKeyDown(block, index, $event)"
          @paste="onPaste($event)"
          @blur="onBlur(block)"
        ></div>
        <textarea
          v-else
          :ref="el => setEditorRef(block.id, el)"
          class="block-editor-textarea"
          :placeholder="getBlockPlaceholder(block)"
          @input="onInput(block, $event)"
          @keydown="onKeyDown(block, index, $event)"
          @paste="onPaste($event)"
          @blur="onBlur(block)"
        ></textarea>
      </template>

      <!-- Render mode -->
      <div
        v-else
        class="block-render"
        :class="{ 'is-empty': !block.content && block.type !== BLOCK_TYPES.DIVIDER }"
        @click="activateBlock(block)"
        @dblclick.stop="activateAndSelectBlock(block)"
        v-html="renderBlock(block, imageBaseDir, getRenderOptions(index))"
      ></div>
    </div>

    <!-- Empty hint -->
    <div v-if="blocks.length === 1 && !blocks[0].content" class="block-editor-hint">
      输入 <code>#</code> <code>##</code> <code>-</code> <code>&gt;</code> <code>```</code> 等快速创建块
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick, onBeforeUpdate, onUnmounted } from 'vue'
import {
  BLOCK_TYPES,
  createBlock,
  markdownToBlocks,
  blocksToMarkdown,
  renderBlock,
  getBlockPlaceholder,
  detectBlockType,
  blockToRawMarkdown
} from '@utils/block-editor.js'

const props = defineProps({
  modelValue: {
    type: String,
    default: ''
  },
  placeholder: {
    type: String,
    default: ''
  },
  noteId: {
    type: [String, Number],
    default: null
  }
})

const emit = defineEmits(['update:modelValue', 'focus', 'blur', 'input'])

const blocks = ref(markdownToBlocks(props.modelValue))
const activeBlockId = ref(null)
const editorRefs = ref({})
const isComposing = ref(false)
const isApplyingExternalValue = ref(false)
const blurTimeoutId = ref(null)
const undoStack = []
const redoStack = []
const MAX_HISTORY_SIZE = 120
const CONTENT_ONLY_BLOCK_TYPES = [
  BLOCK_TYPES.HEADING_1,
  BLOCK_TYPES.HEADING_2,
  BLOCK_TYPES.HEADING_3,
  BLOCK_TYPES.BULLET_LIST,
  BLOCK_TYPES.ORDERED_LIST,
  BLOCK_TYPES.TODO,
  BLOCK_TYPES.QUOTE
]

// Image base directory for rendering local images
const imageBaseDir = ref('')

// Load image base dir once
if (window.electronAPI?.getImageBaseDir) {
  window.electronAPI.getImageBaseDir().then(dir => {
    imageBaseDir.value = dir || ''
  }).catch(() => {
    imageBaseDir.value = ''
  })
}

// Sync modelValue -> blocks
watch(() => props.modelValue, (newValue) => {
  const newMarkdown = blocksToMarkdown(blocks.value)
  // Only re-parse if external value changed to avoid losing active state
  if (newValue !== newMarkdown) {
    const wasActiveId = activeBlockId.value
    isApplyingExternalValue.value = true
    blocks.value = markdownToBlocks(newValue)
    clearHistory()
    // Try to restore active block by index
    if (wasActiveId) {
      const index = blocks.value.findIndex(b => b.id === wasActiveId)
      if (index === -1) {
        activeBlockId.value = null
      }
    }
    nextTick(() => {
      isApplyingExternalValue.value = false
    })
  }
})

// Sync blocks -> modelValue
watch(blocks, (newBlocks) => {
  const newMarkdown = blocksToMarkdown(newBlocks)
  emit('update:modelValue', newMarkdown)
  // Vue deep-watch oldValue can point at the same mutated object, so use an
  // explicit external-sync guard instead of comparing old/new blocks.
  if (!isApplyingExternalValue.value) {
    emit('input')
  }
}, { deep: true })

onBeforeUpdate(() => {
  editorRefs.value = {}
})

function setEditorRef(blockId, el) {
  if (el) {
    editorRefs.value[blockId] = el
    const block = blocks.value.find(b => b.id === blockId)
    if (block) {
      const current = el.tagName === 'TEXTAREA' ? el.value : el.textContent
      const displayValue = getEditorDisplayValue(block)
      if (current !== displayValue) {
        if (el.tagName === 'TEXTAREA') {
          el.value = displayValue
        } else {
          el.textContent = displayValue
        }
      }
    }
  }
}

function activateBlock(block) {
  if (block.type === BLOCK_TYPES.DIVIDER) {
    // Clicking divider activates previous block or creates new one below
    const index = blocks.value.findIndex(b => b.id === block.id)
    if (index > 0) {
      focusBlock(blocks.value[index - 1].id, true)
    } else {
      insertBlockAfter(index)
    }
    return
  }
  focusBlock(block.id, true)
}

function activateAndSelectBlock(block) {
  if (block.type === BLOCK_TYPES.DIVIDER) return
  activeBlockId.value = block.id
  nextTick(() => {
    const el = editorRefs.value[block.id]
    if (!el) return
    const value = getEditorDisplayValue(block)
    el.focus()
    setSelectionRange(el, 0, value.length)
  })
}

function focusBlock(blockId, cursorAtEnd = true) {
  activeBlockId.value = blockId
  nextTick(() => {
    const el = editorRefs.value[blockId]
    if (!el) return
    el.focus()
    if (cursorAtEnd) {
      placeCaretAtEnd(el)
    }
  })
}

function placeCaretAtEnd(el) {
  if (el.tagName === 'TEXTAREA') {
    el.selectionStart = el.selectionEnd = el.value.length
    return
  }
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  const selection = window.getSelection()
  selection.removeAllRanges()
  selection.addRange(range)
}

function placeCaretAtStart(el) {
  if (el.tagName === 'TEXTAREA') {
    el.selectionStart = el.selectionEnd = 0
    return
  }
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(true)
  const selection = window.getSelection()
  selection.removeAllRanges()
  selection.addRange(range)
}

function onInput(block, event) {
  const el = event.target
  const value = el.tagName === 'TEXTAREA' ? el.value : el.textContent
  pushUndoSnapshot()
  applyRawMarkdownToBlock(block, value)
}

function onBlur(block) {
  // Delay deactivation to allow click on another block to take over
  if (blurTimeoutId.value) {
    clearTimeout(blurTimeoutId.value)
  }
  blurTimeoutId.value = setTimeout(() => {
    blurTimeoutId.value = null
    if (activeBlockId.value === block.id) {
      activeBlockId.value = null
      transformBlock(block)
    }
  }, 100)
}

function transformBlock(block) {
  const raw = getEditorDisplayValue(block)
  if (!raw || isMarkdownTable(block)) return

  const detected = detectBlockType(raw)
  if (detected.type !== BLOCK_TYPES.PARAGRAPH) {
    pushUndoSnapshot()
    block.type = detected.type
    block.content = detected.content
    if (detected.extra) {
      Object.assign(block, detected.extra)
    }
  }
}

function getEditorDisplayValue(block) {
  if (!block) return ''
  if ([BLOCK_TYPES.CODE, BLOCK_TYPES.MATH].includes(block.type)) return block.content || ''
  if (CONTENT_ONLY_BLOCK_TYPES.includes(block.type)) return block.content || ''
  return blockToRawMarkdown(block)
}

function getRenderOptions(index) {
  const block = blocks.value[index]
  if (block?.type !== BLOCK_TYPES.ORDERED_LIST) return {}

  const indent = block.indent || 0
  let orderedNumber = 1
  for (let i = index - 1; i >= 0; i -= 1) {
    const previous = blocks.value[i]
    if (previous.type !== BLOCK_TYPES.ORDERED_LIST) break
    if ((previous.indent || 0) === indent) {
      orderedNumber += 1
    }
  }

  return { orderedNumber }
}

function isMarkdownTable(block) {
  if (!block || block.type !== BLOCK_TYPES.PARAGRAPH || !block.content) return false
  const lines = block.content.split('\n').map(line => line.trim()).filter(Boolean)
  return lines.length >= 2 && isTableRow(lines[0]) && isTableSeparator(lines[1])
}

function isTableRow(line = '') {
  const trimmed = line.trim()
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.split('|').length >= 4
}

function isTableSeparator(line = '') {
  if (!isTableRow(line)) return false
  return line
    .trim()
    .slice(1, -1)
    .split('|')
    .every(cell => /^:?-{3,}:?$/.test(cell.trim()))
}

function parseTableMarkdown(markdown = '') {
  const lines = markdown.split('\n').filter(line => isTableRow(line))
  if (lines.length < 2) return { rows: [['']], alignments: [] }

  const rows = lines
    .filter((_, index) => index !== 1)
    .map(line => line.trim().slice(1, -1).split('|').map(cell => cell.trim().replace(/<br\s*\/?>/gi, '\n')))

  const alignments = lines[1]
    .trim()
    .slice(1, -1)
    .split('|')
    .map(cell => {
      const trimmed = cell.trim()
      if (trimmed.startsWith(':') && trimmed.endsWith(':')) return 'center'
      if (trimmed.endsWith(':')) return 'right'
      return 'left'
    })

  const columnCount = Math.max(1, ...rows.map(row => row.length), alignments.length)
  rows.forEach(row => {
    while (row.length < columnCount) row.push('')
  })
  while (alignments.length < columnCount) alignments.push('left')

  return { rows, alignments }
}

function escapeTableCell(cell = '') {
  return String(cell)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, '<br>')
    .trim()
}

function tableToMarkdown(rows, alignments = []) {
  const normalizedRows = rows.length ? rows : [['']]
  const columnCount = Math.max(1, ...normalizedRows.map(row => row.length), alignments.length)
  const cells = normalizedRows.map(row => {
    const normalized = [...row]
    while (normalized.length < columnCount) normalized.push('')
    return normalized
  })
  const separator = Array.from({ length: columnCount }, (_, index) => {
    switch (alignments[index]) {
      case 'center':
        return ':---:'
      case 'right':
        return '---:'
      default:
        return '---'
    }
  })
  const lines = [
    cells[0],
    separator,
    ...cells.slice(1)
  ]

  return lines
    .map(row => `| ${row.map(escapeTableCell).join(' | ')} |`)
    .join('\n')
}

function getTableRows(block) {
  return parseTableMarkdown(block?.content || '').rows
}

function updateTableCell(block, rowIndex, cellIndex, value) {
  const { rows, alignments } = parseTableMarkdown(block.content)
  while (rows.length <= rowIndex) {
    rows.push(Array.from({ length: rows[0]?.length || 1 }, () => ''))
  }
  while (rows[rowIndex].length <= cellIndex) {
    rows.forEach(row => row.push(''))
    alignments.push('left')
  }
  rows[rowIndex][cellIndex] = value
  block.content = tableToMarkdown(rows, alignments)
}

function getTableCellText(el) {
  return Array.from(el.childNodes)
    .map(node => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent
      if (node.nodeName === 'BR') return '\n'
      return node.textContent
    })
    .join('')
}

function onTableCellInput(block, rowIndex, cellIndex, event) {
  const selection = getSelectionOffsets(event.target)
  pushUndoSnapshot()
  updateTableCell(block, rowIndex, cellIndex, getTableCellText(event.target))
  restoreTableCellSelection(block, rowIndex, cellIndex, selection.start, selection.end)
}

function focusTableCell(block, rowIndex, cellIndex, cursorAtEnd = true) {
  activeBlockId.value = block.id
  nextTick(() => {
    const selector = `[data-table-cell="${block.id}:${rowIndex}:${cellIndex}"]`
    const el = document.querySelector(selector)
    if (!el) return
    el.focus()
    if (cursorAtEnd) placeCaretAtEnd(el)
  })
}

function restoreTableCellSelection(block, rowIndex, cellIndex, start, end = start) {
  nextTick(() => {
    const selector = `[data-table-cell="${block.id}:${rowIndex}:${cellIndex}"]`
    const el = document.querySelector(selector)
    if (!el) return

    el.focus()
    setContentEditableSelection(el, start, end)
  })
}

function setContentEditableSelection(el, start, end = start) {
  const selection = window.getSelection()
  if (!selection) return

  const range = document.createRange()
  let charCount = 0
  let startSet = false
  let endSet = false

  function setBoundary(node, offset, isStart) {
    if (isStart) {
      range.setStart(node, offset)
      startSet = true
    } else {
      range.setEnd(node, offset)
      endSet = true
    }
  }

  function traverse(node) {
    if (startSet && endSet) return

    if (node.nodeType === Node.TEXT_NODE) {
      const nextCharCount = charCount + node.textContent.length
      if (!startSet && start <= nextCharCount) {
        setBoundary(node, Math.max(0, start - charCount), true)
      }
      if (!endSet && end <= nextCharCount) {
        setBoundary(node, Math.max(0, end - charCount), false)
      }
      charCount = nextCharCount
      return
    }

    if (node.nodeName === 'BR') {
      const parent = node.parentNode
      const offset = Array.prototype.indexOf.call(parent.childNodes, node) + 1
      charCount += 1
      if (!startSet && start <= charCount) {
        setBoundary(parent, offset, true)
      }
      if (!endSet && end <= charCount) {
        setBoundary(parent, offset, false)
      }
      return
    }

    for (const child of node.childNodes) {
      traverse(child)
    }
  }

  traverse(el)

  if (!startSet) {
    range.setStart(el, el.childNodes.length)
  }
  if (!endSet) {
    range.setEnd(el, el.childNodes.length)
  }

  selection.removeAllRanges()
  selection.addRange(range)
}

function insertLineBreakInContentEditable() {
  const selection = window.getSelection()
  if (!selection.rangeCount) return null
  const range = selection.getRangeAt(0)
  range.deleteContents()
  const br = document.createElement('br')
  range.insertNode(br)
  range.setStartAfter(br)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
  return getSelectionOffsets(br.parentNode)
}

function onTableKeyDown(block, index, event) {
  const cell = event.target.closest?.('[data-table-cell]')
  if (!cell) return

  const [, rowPart, cellPart] = cell.dataset.tableCell.split(':')
  const rowIndex = Number(rowPart)
  const cellIndex = Number(cellPart)

  if (handleEditorShortcut(event)) return

  if (event.key === 'Enter') {
    event.preventDefault()
    const selection = insertLineBreakInContentEditable()
    updateTableCell(block, rowIndex, cellIndex, getTableCellText(cell))
    if (selection) {
      restoreTableCellSelection(block, rowIndex, cellIndex, selection.start, selection.end)
    }
    return
  }

  if (event.key === 'Tab') {
    event.preventDefault()
    updateTableCell(block, rowIndex, cellIndex, getTableCellText(cell))
    const { rows } = parseTableMarkdown(block.content)
    const columnCount = rows[0]?.length || 1
    let nextRow = rowIndex
    let nextCell = cellIndex + (event.shiftKey ? -1 : 1)

    if (nextCell >= columnCount) {
      nextCell = 0
      nextRow += 1
      if (nextRow >= rows.length) {
        addTableRow(block, false)
      }
    } else if (nextCell < 0) {
      nextRow = Math.max(0, rowIndex - 1)
      nextCell = columnCount - 1
    }

    focusTableCell(block, nextRow, nextCell, false)
    return
  }

  if (event.key === 'ArrowDown' && rowIndex === getTableRows(block).length - 1 && isCaretAtLastLine(cell)) {
    event.preventDefault()
    insertBlockAfter(index, BLOCK_TYPES.PARAGRAPH)
  }
}

function onTableFocusOut(block, event) {
  const tableEditor = event.currentTarget
  window.setTimeout(() => {
    if (activeBlockId.value === block.id && !tableEditor.contains(document.activeElement)) {
      activeBlockId.value = null
    }
  }, 100)
}

function addTableRow(block, shouldFocus = true) {
  const { rows, alignments } = parseTableMarkdown(block.content)
  const columnCount = rows[0]?.length || 1
  pushUndoSnapshot()
  rows.push(Array.from({ length: columnCount }, () => ''))
  block.content = tableToMarkdown(rows, alignments)
  if (shouldFocus) focusTableCell(block, rows.length - 1, 0)
}

function addTableColumn(block) {
  const { rows, alignments } = parseTableMarkdown(block.content)
  pushUndoSnapshot()
  rows.forEach(row => row.push(''))
  alignments.push('left')
  block.content = tableToMarkdown(rows, alignments)
  focusTableCell(block, 0, rows[0].length - 1)
}

function applyRawMarkdownToBlock(block, raw) {
  if (!block) return
  if ([BLOCK_TYPES.CODE, BLOCK_TYPES.MATH].includes(block.type)) {
    block.content = raw
    return
  }

  if (block.type === BLOCK_TYPES.PARAGRAPH && isMarkdownTable({ ...block, content: raw })) {
    block.content = raw
    block.checked = false
    block.indent = 0
    block.language = ''
    return
  }

  const detected = detectBlockType(raw)
  if (CONTENT_ONLY_BLOCK_TYPES.includes(block.type) && detected.type === BLOCK_TYPES.PARAGRAPH) {
    block.content = raw
    if (block.type !== BLOCK_TYPES.TODO) {
      block.checked = false
    }
    block.language = ''
    return
  }

  block.type = detected.type
  block.content = detected.content
  block.checked = detected.extra?.checked || false
  block.indent = Number.isFinite(detected.extra?.indent) ? detected.extra.indent : 0
  block.language = detected.extra?.language || ''
  block.order = Number.isFinite(detected.extra?.order) ? detected.extra.order : 1
}

function clearHistory() {
  undoStack.length = 0
  redoStack.length = 0
}

function getActiveSelectionSnapshot() {
  const activeIndex = blocks.value.findIndex(b => b.id === activeBlockId.value)
  if (activeIndex === -1) {
    return { activeIndex: Math.max(0, blocks.value.length - 1), selectionStart: 0, selectionEnd: 0 }
  }

  const activeBlock = blocks.value[activeIndex]
  const el = editorRefs.value[activeBlock.id]
  if (!el) {
    const end = getEditorDisplayValue(activeBlock).length
    return { activeIndex, selectionStart: end, selectionEnd: end }
  }

  const { start, end } = getSelectionOffsets(el)
  return { activeIndex, selectionStart: start, selectionEnd: end }
}

function createHistorySnapshot() {
  return {
    markdown: blocksToMarkdown(blocks.value),
    ...getActiveSelectionSnapshot()
  }
}

function isSameHistorySnapshot(a, b) {
  return Boolean(a && b && a.markdown === b.markdown)
}

function pushUndoSnapshot() {
  if (isApplyingExternalValue.value) return

  const snapshot = createHistorySnapshot()
  const lastSnapshot = undoStack[undoStack.length - 1]
  if (isSameHistorySnapshot(snapshot, lastSnapshot)) return

  undoStack.push(snapshot)
  if (undoStack.length > MAX_HISTORY_SIZE) {
    undoStack.shift()
  }
  redoStack.length = 0
}

function restoreHistorySnapshot(snapshot) {
  if (!snapshot) return
  blocks.value = markdownToBlocks(snapshot.markdown)

  nextTick(() => {
    const blockIndex = Math.min(Math.max(snapshot.activeIndex ?? 0, 0), blocks.value.length - 1)
    const block = blocks.value[blockIndex]
    if (!block) return

    activeBlockId.value = block.id
    nextTick(() => {
      const el = editorRefs.value[block.id]
      if (!el) return
      const displayValue = getEditorDisplayValue(block)
      const start = Math.min(snapshot.selectionStart ?? displayValue.length, displayValue.length)
      const end = Math.min(snapshot.selectionEnd ?? start, displayValue.length)
      el.focus()
      setSelectionRange(el, start, end)
    })
  })
}

function undoHistory() {
  if (undoStack.length === 0) return false
  const current = createHistorySnapshot()
  let previous = undoStack.pop()

  while (previous && isSameHistorySnapshot(previous, current) && undoStack.length > 0) {
    previous = undoStack.pop()
  }

  if (!previous || isSameHistorySnapshot(previous, current)) return false
  redoStack.push(current)
  restoreHistorySnapshot(previous)
  return true
}

function redoHistory() {
  if (redoStack.length === 0) return false
  const current = createHistorySnapshot()
  const next = redoStack.pop()
  undoStack.push(current)
  restoreHistorySnapshot(next)
  return true
}

function onKeyDown(block, index, event) {
  const el = event.target
  const value = el.tagName === 'TEXTAREA' ? el.value : el.textContent
  const hasSelection = hasTextSelection(el)

  if (handleEditorShortcut(event)) {
    return
  }

  const isAtStart = el.tagName === 'TEXTAREA'
    ? el.selectionStart === 0 && el.selectionEnd === 0
    : isCaretAtStart(el)
  const isAtEnd = el.tagName === 'TEXTAREA'
    ? el.selectionStart === value.length && el.selectionEnd === value.length
    : isCaretAtEnd(el)

  // Enter
  if (event.key === 'Enter' && !event.shiftKey) {
    // Code and formula blocks allow multiline editing.
    if ([BLOCK_TYPES.CODE, BLOCK_TYPES.MATH].includes(block.type)) {
      return
    }

    event.preventDefault()
    pushUndoSnapshot()

    // If current block has markdown prefix, transform first
    if (value && !event.isComposing) {
      const detected = detectBlockType(value)
      if (detected.type !== BLOCK_TYPES.PARAGRAPH && block.type === BLOCK_TYPES.PARAGRAPH) {
        block.type = detected.type
        block.content = detected.content
        if (detected.extra) Object.assign(block, detected.extra)
        // If transformed to list/quote, create new same-type block below
        const newType = [BLOCK_TYPES.BULLET_LIST, BLOCK_TYPES.ORDERED_LIST, BLOCK_TYPES.TODO, BLOCK_TYPES.QUOTE].includes(block.type)
          ? block.type
          : BLOCK_TYPES.PARAGRAPH
        insertBlockAfter(index, newType, false)
        return
      }
    }

    // Split content if cursor in middle
    if (!isAtEnd) {
      const before = value.slice(0, getCaretPosition(el))
      const after = value.slice(getCaretPosition(el))
      block.content = before
      const newBlock = insertBlockAfter(index, block.type === BLOCK_TYPES.PARAGRAPH ? BLOCK_TYPES.PARAGRAPH : block.type, false)
      newBlock.content = after
      nextTick(() => focusBlock(newBlock.id, true))
      return
    }

    // Empty list/quote/todo: convert to paragraph and stop
    if (!value && [BLOCK_TYPES.BULLET_LIST, BLOCK_TYPES.ORDERED_LIST, BLOCK_TYPES.TODO, BLOCK_TYPES.QUOTE].includes(block.type)) {
      block.type = BLOCK_TYPES.PARAGRAPH
      return
    }

    // Default: create new paragraph below
    const newType = [BLOCK_TYPES.BULLET_LIST, BLOCK_TYPES.ORDERED_LIST, BLOCK_TYPES.TODO, BLOCK_TYPES.QUOTE].includes(block.type)
      ? block.type
      : BLOCK_TYPES.PARAGRAPH
    insertBlockAfter(index, newType, false)
    return
  }

  // Backspace
  if (event.key === 'Backspace') {
    if (!hasSelection && isAtStart && blocks.value.length > 1) {
      event.preventDefault()
      const prevBlock = blocks.value[index - 1]
      if (!prevBlock || prevBlock.type === BLOCK_TYPES.DIVIDER) {
        // Remove current empty block instead of merging with divider
        if (!block.content) {
          pushUndoSnapshot()
          blocks.value.splice(index, 1)
          if (prevBlock) {
            nextTick(() => focusBlock(prevBlock.id, true))
          } else if (blocks.value.length > 0) {
            nextTick(() => focusBlock(blocks.value[0].id, true))
          }
        }
        return
      }
      pushUndoSnapshot()
      const prevContent = prevBlock.content
      const currentContent = block.content
      prevBlock.content = prevContent + currentContent
      blocks.value.splice(index, 1)
      nextTick(() => focusBlock(prevBlock.id, false))
      nextTick(() => {
        const prevEl = editorRefs.value[prevBlock.id]
        if (prevEl) {
          setCaretPosition(prevEl, prevContent.length)
        }
      })
      return
    }
  }

  // Delete
  if (event.key === 'Delete') {
    if (!hasSelection && isAtEnd && index < blocks.value.length - 1) {
      const nextBlock = blocks.value[index + 1]
      if (!nextBlock.content) {
        event.preventDefault()
        pushUndoSnapshot()
        blocks.value.splice(index + 1, 1)
      }
    }
  }

  // Arrow navigation
  if (event.key === 'ArrowUp' && isCaretAtFirstLine(el)) {
    if (index > 0) {
      event.preventDefault()
      focusBlock(blocks.value[index - 1].id, false)
    }
  }
  if (event.key === 'ArrowDown' && isCaretAtLastLine(el)) {
    if (index < blocks.value.length - 1) {
      event.preventDefault()
      focusBlock(blocks.value[index + 1].id, true)
    }
  }
}

function insertBlockAfter(index, type = BLOCK_TYPES.PARAGRAPH, recordHistory = true) {
  if (recordHistory) {
    pushUndoSnapshot()
  }
  const newBlock = createBlock(type)
  blocks.value.splice(index + 1, 0, newBlock)
  nextTick(() => focusBlock(newBlock.id, true))
  return newBlock
}

function handleContainerClick(event) {
  if (event.target === event.currentTarget) {
    // Click on empty area below blocks: focus last block or create new one
    const lastBlock = blocks.value[blocks.value.length - 1]
    if (lastBlock) {
      if (lastBlock.content) {
        pushUndoSnapshot()
        const newBlock = createBlock(BLOCK_TYPES.PARAGRAPH)
        blocks.value.push(newBlock)
        nextTick(() => focusBlock(newBlock.id, true))
      } else {
        focusBlock(lastBlock.id, true)
      }
    }
  }
}

// Caret helpers
function isCaretAtStart(el) {
  const selection = window.getSelection()
  if (!selection.rangeCount) return false
  const range = selection.getRangeAt(0)
  const preCaretRange = range.cloneRange()
  preCaretRange.selectNodeContents(el)
  preCaretRange.setEnd(range.startContainer, range.startOffset)
  return preCaretRange.toString().length === 0
}

function isCaretAtEnd(el) {
  const selection = window.getSelection()
  if (!selection.rangeCount) return false
  const range = selection.getRangeAt(0)
  const preCaretRange = range.cloneRange()
  preCaretRange.selectNodeContents(el)
  preCaretRange.setEnd(range.endContainer, range.endOffset)
  return preCaretRange.toString().length === el.textContent.length
}

function getCaretPosition(el) {
  if (el.tagName === 'TEXTAREA') {
    return el.selectionStart
  }
  const selection = window.getSelection()
  if (!selection.rangeCount) return 0
  const range = selection.getRangeAt(0)
  const preCaretRange = range.cloneRange()
  preCaretRange.selectNodeContents(el)
  preCaretRange.setEnd(range.endContainer, range.endOffset)
  return preCaretRange.toString().length
}

function setCaretPosition(el, position) {
  if (el.tagName === 'TEXTAREA') {
    el.selectionStart = el.selectionEnd = position
    return
  }
  const selection = window.getSelection()
  const range = document.createRange()
  let charCount = 0
  let found = false

  function traverse(node) {
    if (found) return
    if (node.nodeType === Node.TEXT_NODE) {
      const nextCharCount = charCount + node.length
      if (position <= nextCharCount) {
        range.setStart(node, position - charCount)
        range.setEnd(node, position - charCount)
        found = true
      }
      charCount = nextCharCount
    } else {
      for (const child of node.childNodes) {
        traverse(child)
      }
    }
  }

  traverse(el)
  if (found) {
    selection.removeAllRanges()
    selection.addRange(range)
  }
}

function setSelectionRange(el, start, end = start) {
  if (el.tagName === 'TEXTAREA') {
    el.selectionStart = start
    el.selectionEnd = end
    return
  }

  const selection = window.getSelection()
  const range = document.createRange()
  let charCount = 0
  let foundStart = false
  let foundEnd = false

  function traverse(node) {
    if (foundStart && foundEnd) return
    if (node.nodeType === Node.TEXT_NODE) {
      const nextCharCount = charCount + node.length
      if (!foundStart && start <= nextCharCount) {
        range.setStart(node, start - charCount)
        foundStart = true
      }
      if (!foundEnd && end <= nextCharCount) {
        range.setEnd(node, end - charCount)
        foundEnd = true
      }
      charCount = nextCharCount
    } else {
      for (const child of node.childNodes) {
        traverse(child)
      }
    }
  }

  traverse(el)
  if (!foundStart) range.setStart(el, el.childNodes.length)
  if (!foundEnd) range.setEnd(el, el.childNodes.length)
  selection.removeAllRanges()
  selection.addRange(range)
}

function hasTextSelection(el) {
  if (el.tagName === 'TEXTAREA') {
    return el.selectionStart !== el.selectionEnd
  }

  const selection = window.getSelection()
  if (!selection.rangeCount || selection.isCollapsed) return false
  const range = selection.getRangeAt(0)
  return el.contains(range.commonAncestorContainer)
}

function getSelectionOffsets(el) {
  if (el.tagName === 'TEXTAREA') {
    return {
      start: el.selectionStart,
      end: el.selectionEnd
    }
  }

  const selection = window.getSelection()
  if (!selection.rangeCount) {
    const pos = el.textContent.length
    return { start: pos, end: pos }
  }

  const range = selection.getRangeAt(0)
  if (!el.contains(range.commonAncestorContainer)) {
    const pos = el.textContent.length
    return { start: pos, end: pos }
  }

  if (el.matches?.('[data-table-cell]')) {
    return getContentEditableSelectionOffsets(el, range)
  }

  const startRange = range.cloneRange()
  startRange.selectNodeContents(el)
  startRange.setEnd(range.startContainer, range.startOffset)

  const endRange = range.cloneRange()
  endRange.selectNodeContents(el)
  endRange.setEnd(range.endContainer, range.endOffset)

  return {
    start: startRange.toString().length,
    end: endRange.toString().length
  }
}

function getContentEditableSelectionOffsets(el, range) {
  let charCount = 0
  let start = 0
  let end = 0
  let foundStart = false
  let foundEnd = false

  function boundaryOffset(container, offset) {
    if (container.nodeType === Node.TEXT_NODE) {
      return charCount + offset
    }

    let extra = 0
    for (let i = 0; i < offset; i += 1) {
      const child = container.childNodes[i]
      extra += child?.nodeName === 'BR' ? 1 : (child?.textContent?.length || 0)
    }
    return charCount + extra
  }

  function visit(node) {
    if (node === range.startContainer && !foundStart) {
      start = boundaryOffset(node, range.startOffset)
      foundStart = true
    }
    if (node === range.endContainer && !foundEnd) {
      end = boundaryOffset(node, range.endOffset)
      foundEnd = true
    }

    if (node.nodeType === Node.TEXT_NODE) {
      charCount += node.textContent.length
      return
    }

    if (node.nodeName === 'BR') {
      charCount += 1
      return
    }

    for (const child of node.childNodes) {
      visit(child)
    }
  }

  visit(el)
  return { start, end }
}

function isCaretAtFirstLine(el) {
  if (el.tagName === 'TEXTAREA') {
    const before = el.value.slice(0, el.selectionStart)
    return !before.includes('\n')
  }
  const selection = window.getSelection()
  if (!selection.rangeCount) return false
  const range = selection.getRangeAt(0)
  const rect = range.getBoundingClientRect()
  const elRect = el.getBoundingClientRect()
  return rect.top <= elRect.top + parseFloat(getComputedStyle(el).lineHeight)
}

function isCaretAtLastLine(el) {
  if (el.tagName === 'TEXTAREA') {
    const after = el.value.slice(el.selectionEnd)
    return !after.includes('\n')
  }
  const selection = window.getSelection()
  if (!selection.rangeCount) return false
  const range = selection.getRangeAt(0)
  const rect = range.getBoundingClientRect()
  const elRect = el.getBoundingClientRect()
  return rect.bottom >= elRect.bottom - parseFloat(getComputedStyle(el).lineHeight)
}

function handleEditorShortcut(event) {
  const isShortcut = event.ctrlKey || event.metaKey
  if (!isShortcut || event.altKey) return false

  const key = event.key.toLowerCase()

  if (key === 'z') {
    event.preventDefault()
    if (event.shiftKey) {
      redoHistory()
    } else {
      undoHistory()
    }
    return true
  }

  if (key === 'y') {
    event.preventDefault()
    redoHistory()
    return true
  }

  if (['c', 'v'].includes(key)) {
    return false
  }

  if (key === 'b') {
    event.preventDefault()
    applyInlineMarkdown('**', '加粗文本')
    return true
  }

  if (key === 'i') {
    event.preventDefault()
    applyInlineMarkdown('*', '斜体文本')
    return true
  }

  if (key === 'u') {
    event.preventDefault()
    applyInlineHtml('ins', '', '下划线文本')
    return true
  }

  if (key === 'x' && event.shiftKey) {
    event.preventDefault()
    applyInlineMarkdown('~~', '删除线文本')
    return true
  }

  return false
}

function getActiveBlockContext() {
  let blockId = activeBlockId.value
  if (!blockId) {
    const lastBlock = blocks.value[blocks.value.length - 1]
    if (!lastBlock) return null
    blockId = lastBlock.id
    activeBlockId.value = blockId
  }

  const index = blocks.value.findIndex(b => b.id === blockId)
  if (index === -1) return null

  return {
    block: blocks.value[index],
    index
  }
}

function syncEditorElement(block, el, selectionStart = null, selectionEnd = selectionStart) {
  if (!el) return
  const displayValue = getEditorDisplayValue(block)
  if (el.tagName === 'TEXTAREA') {
    el.value = displayValue
  } else {
    el.textContent = displayValue
  }

  nextTick(() => {
    el.focus()
    if (selectionStart !== null) {
      setSelectionRange(el, selectionStart, selectionEnd)
    } else {
      placeCaretAtEnd(el)
    }
  })
}

function applyInlineMarkdown(marker, placeholder) {
  const context = getActiveBlockContext()
  if (!context) return
  const { block } = context
  if (block.type === BLOCK_TYPES.DIVIDER) return

  activeBlockId.value = block.id
  nextTick(() => {
    const el = editorRefs.value[block.id]
    if (!el) return

    const value = el.tagName === 'TEXTAREA' ? el.value : el.textContent
    const { start, end } = getSelectionOffsets(el)
    const selected = value.slice(start, end)
    const text = selected || placeholder
    const wrapped = `${marker}${text}${marker}`
    const newValue = `${value.slice(0, start)}${wrapped}${value.slice(end)}`

    pushUndoSnapshot()
    applyRawMarkdownToBlock(block, newValue)
    syncEditorElement(
      block,
      el,
      selected ? start + wrapped.length : start + marker.length,
      selected ? start + wrapped.length : start + marker.length + text.length
    )
  })
}

function applyInlineHtml(tagName, className, placeholder) {
  const context = getActiveBlockContext()
  if (!context) return
  const { block } = context
  if (block.type === BLOCK_TYPES.DIVIDER) return

  activeBlockId.value = block.id
  nextTick(() => {
    const el = editorRefs.value[block.id]
    if (!el) return

    const value = el.tagName === 'TEXTAREA' ? el.value : el.textContent
    const { start, end } = getSelectionOffsets(el)
    const selected = value.slice(start, end)
    const text = selected || placeholder
    const classAttr = className ? ` class="${className}"` : ''
    const openTag = `<${tagName}${classAttr}>`
    const closeTag = `</${tagName}>`
    const wrapped = `${openTag}${text}${closeTag}`
    const newValue = `${value.slice(0, start)}${wrapped}${value.slice(end)}`

    pushUndoSnapshot()
    applyRawMarkdownToBlock(block, newValue)
    syncEditorElement(
      block,
      el,
      selected ? start + wrapped.length : start + openTag.length,
      selected ? start + wrapped.length : start + openTag.length + text.length
    )
  })
}

function applyMath(displayMode = false) {
  if (displayMode) {
    insertDisplayMathBlock()
    return
  }

  const context = getActiveBlockContext()
  if (!context) return
  const { block } = context
  if (block.type === BLOCK_TYPES.DIVIDER) return

  activeBlockId.value = block.id
  nextTick(() => {
    const el = editorRefs.value[block.id]
    if (!el) return

    const value = el.tagName === 'TEXTAREA' ? el.value : el.textContent
    const { start, end } = getSelectionOffsets(el)
    const selected = value.slice(start, end)
    const text = selected || (displayMode ? 'E = mc^2' : 'x')
    const openMarker = displayMode ? '$$' : '$'
    const closeMarker = displayMode ? '$$' : '$'
    const wrapped = `${openMarker}${text}${closeMarker}`
    const newValue = `${value.slice(0, start)}${wrapped}${value.slice(end)}`

    pushUndoSnapshot()
    applyRawMarkdownToBlock(block, newValue)
    syncEditorElement(
      block,
      el,
      selected ? start + wrapped.length : start + openMarker.length,
      selected ? start + wrapped.length : start + openMarker.length + text.length
    )
  })
}

function insertDisplayMathBlock() {
  const context = getActiveBlockContext()
  if (!context) return
  const { block, index } = context
  if (block.type === BLOCK_TYPES.DIVIDER) return

  activeBlockId.value = block.id
  nextTick(() => {
    const el = editorRefs.value[block.id]
    const value = el
      ? (el.tagName === 'TEXTAREA' ? el.value : el.textContent)
      : getEditorDisplayValue(block)
    const { start, end } = el ? getSelectionOffsets(el) : { start: 0, end: 0 }
    const selected = value.slice(start, end).trim()
    const content = selected || 'E = mc^2'

    pushUndoSnapshot()

    let targetBlock = block
    if (block.type !== BLOCK_TYPES.MATH && value.trim()) {
      targetBlock = createBlock(BLOCK_TYPES.MATH, content)
      blocks.value.splice(index + 1, 0, targetBlock)
    } else {
      block.type = BLOCK_TYPES.MATH
      block.content = content
      block.checked = false
      block.indent = 0
      block.language = ''
    }

    activeBlockId.value = targetBlock.id
    nextTick(() => {
      const nextEl = editorRefs.value[targetBlock.id]
      syncEditorElement(targetBlock, nextEl, 0, targetBlock.content.length)
    })
  })
}

function setCurrentBlockType(type) {
  const context = getActiveBlockContext()
  if (!context) return
  const { block } = context

  pushUndoSnapshot()
  block.type = block.type === type ? BLOCK_TYPES.PARAGRAPH : type
  if (![BLOCK_TYPES.BULLET_LIST, BLOCK_TYPES.ORDERED_LIST, BLOCK_TYPES.TODO, BLOCK_TYPES.QUOTE].includes(block.type)) {
    block.indent = 0
  }
  if (block.type === BLOCK_TYPES.TODO && typeof block.checked !== 'boolean') {
    block.checked = false
  }

  nextTick(() => focusBlock(block.id, true))
}

function adjustCurrentBlockIndent(delta) {
  const context = getActiveBlockContext()
  if (!context) return
  const { block } = context
  const indentableTypes = [BLOCK_TYPES.BULLET_LIST, BLOCK_TYPES.ORDERED_LIST, BLOCK_TYPES.TODO, BLOCK_TYPES.QUOTE]

  if (!indentableTypes.includes(block.type)) {
    pushUndoSnapshot()
    block.type = BLOCK_TYPES.BULLET_LIST
  } else {
    pushUndoSnapshot()
  }

  block.indent = Math.max(0, Math.min(6, (block.indent || 0) + delta))
  nextTick(() => focusBlock(block.id, true))
}

function insertTable() {
  const context = getActiveBlockContext()
  if (!context) return
  const { block, index } = context
  if (block.type === BLOCK_TYPES.DIVIDER) return

  const tableMarkdown = [
    '| 列 1 | 列 2 | 列 3 |',
    '| --- | --- | --- |',
    '| 内容 | 内容 | 内容 |',
    '| 内容 | 内容 | 内容 |'
  ].join('\n')

  pushUndoSnapshot()

  let targetBlock = block
  const currentValue = getEditorDisplayValue(block).trim()
  if (currentValue) {
    targetBlock = createBlock(BLOCK_TYPES.PARAGRAPH, tableMarkdown)
    blocks.value.splice(index + 1, 0, targetBlock)
  } else {
    block.type = BLOCK_TYPES.PARAGRAPH
    block.content = tableMarkdown
    block.checked = false
    block.indent = 0
    block.language = ''
  }

  activeBlockId.value = targetBlock.id
  nextTick(() => {
    focusTableCell(targetBlock, 0, 0)
  })
}

function applyMarkdownCommand(command) {
  switch (command) {
    case 'bold':
      applyInlineMarkdown('**', '加粗文本')
      break
    case 'italic':
      applyInlineMarkdown('*', '斜体文本')
      break
    case 'strikethrough':
      applyInlineMarkdown('~~', '删除线文本')
      break
    case 'underline':
      applyInlineHtml('ins', '', '下划线文本')
      break
    case 'highlightYellow':
      applyInlineHtml('mark', 'note-mark note-mark-yellow', '黄色标记')
      break
    case 'highlightOrange':
      applyInlineHtml('mark', 'note-mark note-mark-orange', '橙色标记')
      break
    case 'highlightPink':
      applyInlineHtml('mark', 'note-mark note-mark-pink', '粉色标记')
      break
    case 'highlightPurple':
      applyInlineHtml('mark', 'note-mark note-mark-purple', '紫色标记')
      break
    case 'highlightBlue':
      applyInlineHtml('mark', 'note-mark note-mark-blue', '蓝色标记')
      break
    case 'highlightGreen':
      applyInlineHtml('mark', 'note-mark note-mark-green', '绿色标记')
      break
    case 'inlineMath':
      applyMath(false)
      break
    case 'displayMath':
      applyMath(true)
      break
    case 'table':
      insertTable()
      break
    case 'paragraph':
      setCurrentBlockType(BLOCK_TYPES.PARAGRAPH)
      break
    case 'heading1':
      setCurrentBlockType(BLOCK_TYPES.HEADING_1)
      break
    case 'heading2':
      setCurrentBlockType(BLOCK_TYPES.HEADING_2)
      break
    case 'heading3':
      setCurrentBlockType(BLOCK_TYPES.HEADING_3)
      break
    case 'bulletList':
      setCurrentBlockType(BLOCK_TYPES.BULLET_LIST)
      break
    case 'orderedList':
      setCurrentBlockType(BLOCK_TYPES.ORDERED_LIST)
      break
    case 'todo':
      setCurrentBlockType(BLOCK_TYPES.TODO)
      break
    case 'quote':
      setCurrentBlockType(BLOCK_TYPES.QUOTE)
      break
    case 'indent':
      adjustCurrentBlockIndent(1)
      break
    case 'outdent':
      adjustCurrentBlockIndent(-1)
      break
    default:
      focus()
  }
}

// Image paste handling
const SUPPORTED_IMAGE_TYPES = [
  'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml'
]
const MAX_FILE_SIZE = 20 * 1024 * 1024

function isSupportedImage(file) {
  return SUPPORTED_IMAGE_TYPES.includes(file.type)
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

async function processImageFile(file) {
  if (!isSupportedImage(file)) return false
  if (file.size > MAX_FILE_SIZE) {
    alert('图片文件过大，最大支持 20MB')
    return false
  }
  if (!window.electronAPI?.saveImage) return false

  try {
    const imageData = await fileToBase64(file)
    const ext = file.type.split('/')[1] || 'png'
    const result = await window.electronAPI.saveImage(props.noteId || 'new', imageData, ext)
    const savedPath = result?.relativePath || result
    if (savedPath) {
      insertImageMarkdown(savedPath)
      return true
    }
  } catch (error) {
    console.error('保存图片失败:', error)
  }
  return false
}

function insertImageMarkdown(imagePath) {
  const activeId = activeBlockId.value
  if (!activeId) return
  const block = blocks.value.find(b => b.id === activeId)
  const el = editorRefs.value[activeId]
  if (!block || !el) return

  const markdownImage = `![](${imagePath})`
  const value = el.tagName === 'TEXTAREA' ? el.value : el.textContent
  const pos = el.tagName === 'TEXTAREA' ? el.selectionStart : getCaretPosition(el)
  const before = value.slice(0, pos)
  const after = value.slice(pos)
  const newValue = before + markdownImage + after

  pushUndoSnapshot()
  applyRawMarkdownToBlock(block, newValue)
  const displayValue = getEditorDisplayValue(block)
  if (el.tagName === 'TEXTAREA') {
    el.value = displayValue
  } else {
    el.textContent = displayValue
  }

  nextTick(() => {
    const newPos = pos + markdownImage.length
    if (el.tagName === 'TEXTAREA') {
      el.selectionStart = el.selectionEnd = newPos
    } else {
      setCaretPosition(el, newPos)
    }
    el.focus()
  })
}

async function onPaste(event) {
  const clipboardData = event.clipboardData || window.clipboardData
  if (!clipboardData) return

  // Check for image files
  if (clipboardData.items && clipboardData.items.length > 0) {
    for (let i = 0; i < clipboardData.items.length; i++) {
      const item = clipboardData.items[i]
      if (item.kind === 'file') {
        const file = item.getAsFile()
        if (file && isSupportedImage(file)) {
          event.preventDefault()
          await processImageFile(file)
          return
        }
      }
    }
  }

  if (clipboardData.files && clipboardData.files.length > 0) {
    for (const file of clipboardData.files) {
      if (isSupportedImage(file)) {
        event.preventDefault()
        await processImageFile(file)
        return
      }
    }
  }

  // Plain text paste for contenteditable
  const text = clipboardData.getData('text/plain')
  if (text && event.target.isContentEditable) {
    event.preventDefault()
    document.execCommand('insertText', false, text)
  }
}

// Expose editor commands for parent toolbar.
function focus() {
  if (activeBlockId.value) {
    focusBlock(activeBlockId.value, true)
  } else if (blocks.value.length > 0) {
    focusBlock(blocks.value[blocks.value.length - 1].id, true)
  }
}

defineExpose({
  focus,
  applyMarkdownCommand
})

onUnmounted(() => {
  if (blurTimeoutId.value) {
    clearTimeout(blurTimeoutId.value)
  }
})
</script>

<style scoped>
.block-editor {
  width: 100%;
  min-height: 100%;
  padding: var(--bm-space-md) 0;
  outline: none;
}

.block-row {
  position: relative;
  padding: 2px var(--bm-space-xl);
  border-radius: var(--bm-radius-sm);
  transition: background-color 150ms ease;
}

.block-row:hover {
  background-color: var(--bm-bg-hover);
}

.block-row.is-active,
.block-row.is-active:hover {
  background-color: transparent;
}

.block-editor-input,
.block-editor-textarea {
  width: 100%;
  min-height: 1.6em;
  padding: 0;
  margin: 0;
  font-family: var(--bm-font-reading);
  font-size: 1rem;
  line-height: 1.6;
  color: var(--bm-text-primary);
  background: transparent;
  border: none;
  outline: none;
  resize: none;
  white-space: pre-wrap;
  word-break: break-word;
}

.block-editor-input:empty::before {
  content: attr(placeholder);
  color: var(--bm-text-muted);
  pointer-events: none;
}

.block-editor-textarea {
  min-height: 120px;
  font-family: var(--bm-font-mono);
  font-size: 0.875rem;
  background-color: rgba(0, 0, 0, 0.03);
  border-radius: var(--bm-radius-md);
  padding: var(--bm-space-md);
}

.block-type-math .block-editor-textarea {
  min-height: 96px;
  background-color: rgba(13, 148, 136, 0.06);
  border: 1px solid rgba(13, 148, 136, 0.16);
}

.block-table-editor {
  display: flex;
  flex-direction: column;
  gap: var(--bm-space-sm);
  margin: 0.4rem 0;
}

.table-editor-scroll {
  width: 100%;
  overflow-x: auto;
  border: 1px solid var(--bm-border-default);
  border-radius: var(--bm-radius-sm);
  background: var(--bm-bg-card);
}

.block-table-editor table {
  width: 100%;
  min-width: 420px;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 0.9375rem;
}

.block-table-editor th,
.block-table-editor td {
  min-width: 120px;
  padding: 0.45rem 0.55rem;
  border: 1px solid var(--bm-border-default);
  color: var(--bm-text-primary);
  line-height: 1.45;
  text-align: left;
  vertical-align: top;
  white-space: pre-wrap;
  word-break: break-word;
  outline: none;
}

.block-table-editor th {
  background: var(--bm-bg-hover);
  font-weight: 600;
}

.block-table-editor th:focus,
.block-table-editor td:focus {
  background: rgba(13, 148, 136, 0.08);
  box-shadow: inset 0 0 0 2px rgba(13, 148, 136, 0.28);
}

.table-editor-actions {
  display: flex;
  gap: var(--bm-space-xs);
}

.table-editor-actions button {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  height: 28px;
  padding: 0 0.55rem;
  border: 1px solid var(--bm-border-default);
  border-radius: var(--bm-radius-sm);
  background: var(--bm-bg-card);
  color: var(--bm-text-secondary);
  font-size: 0.8125rem;
  cursor: pointer;
}

.table-editor-actions button:hover {
  background: var(--bm-bg-hover);
  color: var(--bm-text-primary);
}

.block-render {
  min-height: 1.6em;
  cursor: text;
  font-family: var(--bm-font-reading);
  line-height: 1.6;
}

.block-render.is-empty::before {
  content: attr(data-placeholder);
  color: var(--bm-text-muted);
}

.block-editor-hint {
  padding: var(--bm-space-sm) var(--bm-space-xl);
  font-size: 0.75rem;
  color: var(--bm-text-muted);
}

.block-editor-hint code {
  background: var(--bm-bg-hover);
  padding: 1px 4px;
  border-radius: var(--bm-radius-sm);
  font-family: var(--bm-font-mono);
}

/* Markdown rendered content styles */
.block-render :deep(h1),
.block-render :deep(h2),
.block-render :deep(h3) {
  margin: 0.25em 0;
  font-family: var(--bm-font-display);
  font-weight: 600;
  line-height: 1.3;
  color: var(--bm-text-primary);
}

.block-render :deep(h1) { font-size: 1.5em; }
.block-render :deep(h2) { font-size: 1.25em; }
.block-render :deep(h3) { font-size: 1.125em; }

.block-render :deep(p) {
  margin: 0.25em 0;
}

.block-render :deep(ins) {
  text-decoration-thickness: 1.5px;
  text-underline-offset: 0.16em;
}

.block-render :deep(.note-mark) {
  padding: 0.08em 0.22em;
  border-radius: 4px;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
  color: inherit;
}

.block-render :deep(.note-mark-yellow) {
  background: #fff2a8;
}

.block-render :deep(.note-mark-orange) {
  background: #ffd6a5;
}

.block-render :deep(.note-mark-pink) {
  background: #ffd1dc;
}

.block-render :deep(.note-mark-purple) {
  background: #eadcff;
}

.block-render :deep(.note-mark-blue) {
  background: #cfe8ff;
}

.block-render :deep(.note-mark-green) {
  background: #d8f5d1;
}

.block-render :deep(.note-math-inline) {
  display: inline-flex;
  max-width: 100%;
  vertical-align: -0.08em;
}

.block-render :deep(.note-math-display) {
  max-width: 100%;
  margin: 0.5em 0;
  overflow-x: auto;
  overflow-y: hidden;
}

.block-render :deep(ul),
.block-render :deep(ol) {
  margin: 0.25em 0;
  padding-left: 1.5em;
}

.block-render :deep(li) {
  margin: 0.15em 0;
}

.block-render :deep(blockquote) {
  margin: 0.5em 0;
  padding: 0.25em 0.75em;
  border-left: 3px solid var(--bm-border-strong);
  color: var(--bm-text-secondary);
}

.block-render :deep(pre) {
  background-color: rgba(0, 0, 0, 0.04);
  padding: var(--bm-space-md);
  border-radius: var(--bm-radius-md);
  overflow-x: auto;
  margin: 0.5em 0;
}

.block-render :deep(code) {
  font-family: var(--bm-font-mono);
  font-size: 0.875em;
}

.block-render :deep(pre code) {
  background: transparent;
  padding: 0;
}

.block-render :deep(table) {
  width: 100%;
  margin: 0.65em 0;
  border-collapse: collapse;
  table-layout: auto;
  font-size: 0.9375rem;
}

.block-render :deep(th),
.block-render :deep(td) {
  padding: 0.42rem 0.55rem;
  border: 1px solid var(--bm-border-default);
  text-align: left;
  vertical-align: top;
}

.block-render :deep(th) {
  background: var(--bm-bg-hover);
  color: var(--bm-text-primary);
  font-weight: 600;
}

.block-render :deep(hr) {
  border: none;
  border-top: 1px solid var(--bm-border-default);
  margin: 0.75em 0;
}

.block-render :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: var(--bm-radius-md);
}

.block-todo {
  display: flex;
  align-items: flex-start;
  gap: var(--bm-space-sm);
}

.block-todo-label {
  display: flex;
  align-items: flex-start;
  gap: var(--bm-space-sm);
  cursor: text;
}

.block-todo-checkbox {
  margin-top: 0.35em;
  flex-shrink: 0;
}

.block-todo-text :deep(p) {
  margin: 0;
}
</style>
