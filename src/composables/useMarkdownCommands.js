/**
 * Pure Markdown command helpers for the textarea editor.
 * No Vue imports, no DOM access in the exported string helpers.
 */

function normalizeSelection(value, start, end) {
  const safeStart = Math.max(0, Math.min(start ?? 0, value.length))
  const safeEnd = Math.max(safeStart, Math.min(end ?? safeStart, value.length))
  return { start: safeStart, end: safeEnd }
}

function updateValue(value, start, end, replacement, nextSelectionStart, nextSelectionEnd) {
  return {
    value: value.slice(0, start) + replacement + value.slice(end),
    selectionStart: nextSelectionStart,
    selectionEnd: nextSelectionEnd
  }
}

/**
 * Find the start index of the line containing `position`.
 */
function findLineStart(value, position) {
  let index = position
  while (index > 0 && value[index - 1] !== '\n') {
    index -= 1
  }
  return index
}

/**
 * Find the end index of the line containing `position` (exclusive of the trailing newline).
 */
function findLineEnd(value, position) {
  let index = position
  while (index < value.length && value[index] !== '\n') {
    index += 1
  }
  return index
}

export function wrapSelection(value, start, end, before, after = before, placeholder = '') {
  const { start: s, end: e } = normalizeSelection(value, start, end)
  const selected = value.slice(s, e)
  const text = selected || placeholder
  const replacement = `${before}${text}${after}`

  if (selected) {
    // Wrap existing selection; cursor placed after the wrapper.
    return updateValue(value, s, e, replacement, s + replacement.length, s + replacement.length)
  }

  // Empty selection: insert placeholder and select it.
  const placeholderStart = s + before.length
  return updateValue(value, s, e, replacement, placeholderStart, placeholderStart + text.length)
}

export function prefixSelectedLines(value, start, end, prefixFactory) {
  const { start: s, end: e } = normalizeSelection(value, start, end)
  const rangeStart = findLineStart(value, s)
  const rangeEnd = findLineEnd(value, e)

  const before = value.slice(0, rangeStart)
  const range = value.slice(rangeStart, rangeEnd)
  const after = value.slice(rangeEnd)

  const lines = range.split('\n')
  const transformedLines = lines.map((line, index) => {
    const prefix = typeof prefixFactory === 'function' ? prefixFactory(line, index) : prefixFactory
    if (line === '' && index !== lines.length - 1) {
      // Empty line in the middle of the selection gets prefix-only.
      return prefix
    }
    if (line === '' && index === lines.length - 1) {
      // Empty last line (selection ends at line start) remains empty.
      return ''
    }
    return prefix + line
  })

  const transformedRange = transformedLines.join('\n')
  const newValue = before + transformedRange + after
  const newEnd = rangeStart + transformedRange.length

  return {
    value: newValue,
    selectionStart: rangeStart,
    selectionEnd: newEnd
  }
}

export function insertBlock(value, start, end, blockText) {
  const { start: s, end: e } = normalizeSelection(value, start, end)
  const before = value.slice(0, s)
  const after = value.slice(e)

  let insertion = blockText
  if (before.length > 0 && !before.endsWith('\n')) {
    insertion = '\n' + insertion
  }
  if (after.length > 0 && !after.startsWith('\n')) {
    insertion = insertion + '\n'
  }

  const replacement = before + insertion + after
  const newCursor = before.length + insertion.length
  return {
    value: replacement,
    selectionStart: newCursor,
    selectionEnd: newCursor
  }
}

export function indentSelectedLines(value, start, end, indent = '  ') {
  const { start: s, end: e } = normalizeSelection(value, start, end)
  const rangeStart = findLineStart(value, s)
  const rangeEnd = findLineEnd(value, e)

  const before = value.slice(0, rangeStart)
  const range = value.slice(rangeStart, rangeEnd)
  const after = value.slice(rangeEnd)

  const lines = range.split('\n')
  const transformedLines = lines.map((line) => {
    if (line === '') return ''
    return indent + line
  })

  const transformedRange = transformedLines.join('\n')
  const newValue = before + transformedRange + after
  const shift = indent.length
  return {
    value: newValue,
    selectionStart: rangeStart === s ? s : s + shift,
    selectionEnd: e + transformedLines.length * shift
  }
}

export function outdentSelectedLines(value, start, end, indentSize = 2) {
  const { start: s, end: e } = normalizeSelection(value, start, end)
  const rangeStart = findLineStart(value, s)
  const rangeEnd = findLineEnd(value, e)

  const before = value.slice(0, rangeStart)
  const range = value.slice(rangeStart, rangeEnd)
  const after = value.slice(rangeEnd)

  const indentPattern = new RegExp(`^[ \\t]{1,${indentSize}}`)
  const lines = range.split('\n')
  let removedTotal = 0
  const transformedLines = lines.map((line) => {
    if (line === '') return ''
    const match = line.match(indentPattern)
    const removed = match ? match[0].length : 0
    removedTotal += removed
    return line.slice(removed)
  })

  const transformedRange = transformedLines.join('\n')
  const newValue = before + transformedRange + after
  const shiftPerLine = removedTotal / Math.max(1, lines.filter(l => l !== '').length)
  return {
    value: newValue,
    selectionStart: s - Math.min(s - rangeStart, removedTotal),
    selectionEnd: Math.max(rangeStart, e - removedTotal)
  }
}

export function createTableTemplate(columns = 3, rows = 2) {
  const colCount = Math.max(1, Math.min(columns, 10))
  const rowCount = Math.max(1, Math.min(rows, 20))

  const headerCells = Array.from({ length: colCount }, (_, i) => `列 ${i + 1}`)
  const separatorCells = Array.from({ length: colCount }, () => '---')
  const bodyCells = Array.from({ length: colCount }, () => '内容')

  const header = `| ${headerCells.join(' | ')} |`
  const separator = `| ${separatorCells.join(' | ')} |`
  const bodyRows = Array.from({ length: rowCount }, () => `| ${bodyCells.join(' | ')} |`)

  return [header, separator, ...bodyRows].join('\n')
}

export function applyMarkdownCommandToValue(value, start, end, command) {
  const { start: s, end: e } = normalizeSelection(value, start, end)

  switch (command) {
    case 'bold':
      return wrapSelection(value, s, e, '**', '**', '加粗文本')
    case 'italic':
      return wrapSelection(value, s, e, '*', '*', '斜体文本')
    case 'strikethrough':
      return wrapSelection(value, s, e, '~~', '~~', '删除线文本')
    case 'underline':
      return wrapSelection(value, s, e, '<ins>', '</ins>', '下划线文本')
    case 'inlineMath':
      return wrapSelection(value, s, e, '$', '$', 'x')
    case 'displayMath': {
      const selected = value.slice(s, e).trim()
      if (selected) {
        const replacement = `$$\n${selected}\n$$`
        return updateValue(value, s, e, replacement, s + replacement.length, s + replacement.length)
      }
      const replacement = `$$\nx\n$$`
      const placeholderStart = s + 4
      return updateValue(value, s, e, replacement, placeholderStart, placeholderStart + 1)
    }
    case 'heading1':
      return prefixSelectedLines(value, s, e, '# ')
    case 'heading2':
      return prefixSelectedLines(value, s, e, '## ')
    case 'heading3':
      return prefixSelectedLines(value, s, e, '### ')
    case 'bulletList':
      return prefixSelectedLines(value, s, e, '- ')
    case 'orderedList':
      return prefixSelectedLines(value, s, e, (_, index) => `${index + 1}. `)
    case 'todo':
      return prefixSelectedLines(value, s, e, '- [ ] ')
    case 'quote':
      return prefixSelectedLines(value, s, e, '> ')
    case 'indent':
      return indentSelectedLines(value, s, e, '  ')
    case 'outdent':
      return outdentSelectedLines(value, s, e, 2)
    case 'table': {
      const table = createTableTemplate(3, 2)
      return insertBlock(value, s, e, table)
    }
    case 'codeBlock': {
      const selected = value.slice(s, e)
      if (selected) {
        const replacement = `\`\`\`\n${selected}\n\`\`\``
        return updateValue(value, s, e, replacement, s + replacement.length, s + replacement.length)
      }
      const replacement = '\`\`\`\n代码块\n\`\`\`'
      const placeholderStart = s + 4
      return updateValue(value, s, e, replacement, placeholderStart, placeholderStart + 3)
    }
    case 'link': {
      const selected = value.slice(s, e)
      if (selected) {
        const replacement = `[${selected}](url)`
        return updateValue(value, s, e, replacement, s + replacement.length, s + replacement.length)
      }
      const replacement = '[链接文本](url)'
      const placeholderStart = s + 1
      return updateValue(value, s, e, replacement, placeholderStart, placeholderStart + 4)
    }
    case 'highlightYellow':
      return wrapSelection(value, s, e, '<mark class="bm-highlight-yellow">', '</mark>', '高亮文本')
    case 'highlightOrange':
      return wrapSelection(value, s, e, '<mark class="bm-highlight-orange">', '</mark>', '高亮文本')
    case 'highlightPink':
      return wrapSelection(value, s, e, '<mark class="bm-highlight-pink">', '</mark>', '高亮文本')
    case 'highlightPurple':
      return wrapSelection(value, s, e, '<mark class="bm-highlight-purple">', '</mark>', '高亮文本')
    case 'highlightBlue':
      return wrapSelection(value, s, e, '<mark class="bm-highlight-blue">', '</mark>', '高亮文本')
    case 'highlightGreen':
      return wrapSelection(value, s, e, '<mark class="bm-highlight-green">', '</mark>', '高亮文本')
    default:
      return { value, selectionStart: s, selectionEnd: e }
  }
}

function findChangedRange(before, after) {
  let prefix = 0
  const maxPrefix = Math.min(before.length, after.length)
  while (prefix < maxPrefix && before[prefix] === after[prefix]) {
    prefix += 1
  }

  let suffix = 0
  const maxSuffix = Math.min(before.length - prefix, after.length - prefix)
  while (
    suffix < maxSuffix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1
  }

  return {
    start: prefix,
    oldEnd: before.length - suffix,
    replacement: after.slice(prefix, after.length - suffix)
  }
}

function replaceTextareaValueWithUndo(textarea, currentValue, nextValue) {
  if (currentValue === nextValue) return true

  const change = findChangedRange(currentValue, nextValue)
  textarea.focus()
  textarea.setSelectionRange(change.start, change.oldEnd)

  let applied = false
  if (typeof document !== 'undefined' && typeof document.execCommand === 'function') {
    applied = document.execCommand('insertText', false, change.replacement)
  }

  if (!applied || textarea.value !== nextValue) {
    textarea.setRangeText(change.replacement, change.start, change.oldEnd, 'end')
    textarea.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: change.replacement
    }))
  }

  return textarea.value === nextValue
}

/**
 * Composable wrapper that applies commands to a textarea ref.
 * The helpers above remain pure and testable.
 */
export function useMarkdownCommands({ textareaRef, modelValue, updateModelValue }) {
  function applyCommand(command) {
    const textarea = textareaRef?.value
    if (!textarea) return

    const value = textarea.value ?? modelValue?.() ?? ''
    const start = textarea.selectionStart
    const end = textarea.selectionEnd

    const result = applyMarkdownCommandToValue(value, start, end, command)

    const usedNativeEdit = replaceTextareaValueWithUndo(textarea, value, result.value)
    if (!usedNativeEdit) {
      updateModelValue?.(result.value)
    }

    // Restore selection after Vue updates the controlled value.
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(result.selectionStart, result.selectionEnd)
    })
  }

  return {
    applyCommand,
    applyMarkdownCommand: applyCommand,
    // Expose pure helpers for testing / direct use.
    wrapSelection,
    prefixSelectedLines,
    insertBlock,
    indentSelectedLines,
    outdentSelectedLines,
    createTableTemplate,
    applyMarkdownCommandToValue
  }
}
