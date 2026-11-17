import { renderMarkdown } from './markdown.js'

export const BLOCK_TYPES = {
  PARAGRAPH: 'paragraph',
  HEADING_1: 'heading1',
  HEADING_2: 'heading2',
  HEADING_3: 'heading3',
  BULLET_LIST: 'bulletList',
  ORDERED_LIST: 'orderedList',
  TODO: 'todo',
  QUOTE: 'quote',
  CODE: 'code',
  MATH: 'math',
  DIVIDER: 'divider'
}

const HEADING_PATTERNS = [
  { type: BLOCK_TYPES.HEADING_1, prefix: '# ' },
  { type: BLOCK_TYPES.HEADING_2, prefix: '## ' },
  { type: BLOCK_TYPES.HEADING_3, prefix: '### ' }
]

let idCounter = 0

export function generateBlockId() {
  idCounter += 1
  return `block-${Date.now()}-${idCounter}`
}

export function createBlock(type = BLOCK_TYPES.PARAGRAPH, content = '', extra = {}) {
  return {
    id: generateBlockId(),
    type,
    content,
    checked: extra.checked || false,
    language: extra.language || '',
    indent: Number.isFinite(extra.indent) ? extra.indent : 0,
    order: Number.isFinite(extra.order) ? extra.order : 1,
    ...extra
  }
}

function getIndentLevel(whitespace = '') {
  const spaces = whitespace.replace(/\t/g, '  ').length
  return Math.floor(spaces / 2)
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

/**
 * Detect block type from markdown line prefix
 * Returns { type, content, extra }
 */
export function detectBlockType(line) {
  const trimmed = line.trimEnd()
  const indentMatch = trimmed.match(/^(\s*)/)
  const indentText = indentMatch?.[1] || ''
  const indent = getIndentLevel(indentText)
  const body = trimmed.slice(indentText.length)

  // Divider
  if (/^(---|\*\*\*|___)\s*$/.test(body)) {
    return { type: BLOCK_TYPES.DIVIDER, content: '', extra: {} }
  }

  // Display math
  const singleLineMath = body.match(/^\$\$(.*)\$\$$/)
  if (singleLineMath) {
    return { type: BLOCK_TYPES.MATH, content: singleLineMath[1].trim(), extra: {} }
  }

  // Todo
  const todoMatch = body.match(/^- \[([ xX])\] (.*)$/)
  if (todoMatch) {
    return {
      type: BLOCK_TYPES.TODO,
      content: todoMatch[2],
      extra: { checked: todoMatch[1].toLowerCase() === 'x', indent }
    }
  }

  // Headings
  for (const { type, prefix } of HEADING_PATTERNS) {
    if (body.startsWith(prefix)) {
      return { type, content: body.slice(prefix.length), extra: {} }
    }
  }

  // Bullet list
  if (/^[-*]\s/.test(body)) {
    return { type: BLOCK_TYPES.BULLET_LIST, content: body.replace(/^[-*]\s/, ''), extra: { indent } }
  }

  // Ordered list
  const orderedMatch = body.match(/^\d+\.\s(.*)$/)
  if (orderedMatch) {
    const order = Number.parseInt(body, 10)
    return { type: BLOCK_TYPES.ORDERED_LIST, content: orderedMatch[1], extra: { indent, order } }
  }

  // Quote
  if (body.startsWith('> ')) {
    return { type: BLOCK_TYPES.QUOTE, content: body.slice(2), extra: { indent } }
  }

  return { type: BLOCK_TYPES.PARAGRAPH, content: line, extra: {} }
}

/**
 * Parse markdown string into blocks
 */
export function markdownToBlocks(markdown) {
  if (!markdown || typeof markdown !== 'string') {
    return [createBlock()]
  }

  const lines = markdown.split('\n')
  const blocks = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // GFM table block. Keep the whole table together so cell editing can work.
    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const tableLines = [line, lines[i + 1]]
      i += 2
      while (i < lines.length && isTableRow(lines[i])) {
        tableLines.push(lines[i])
        i += 1
      }
      blocks.push(createBlock(BLOCK_TYPES.PARAGRAPH, tableLines.join('\n')))
      continue
    }

    // Code block
    if (trimmed.startsWith('```')) {
      const language = trimmed.slice(3).trim()
      const codeLines = []
      i += 1
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i])
        i += 1
      }
      blocks.push(createBlock(BLOCK_TYPES.CODE, codeLines.join('\n'), { language }))
      i += 1
      continue
    }

    // LaTeX display math block
    if (trimmed.startsWith('$$')) {
      const openingIndex = line.indexOf('$$')
      const afterOpening = line.slice(openingIndex + 2)
      const sameLineClosingIndex = afterOpening.indexOf('$$')

      if (sameLineClosingIndex !== -1) {
        blocks.push(createBlock(BLOCK_TYPES.MATH, afterOpening.slice(0, sameLineClosingIndex).trim()))
        i += 1
        continue
      }

      const mathLines = []
      if (afterOpening.trim()) {
        mathLines.push(afterOpening)
      }

      i += 1
      while (i < lines.length) {
        const closingIndex = lines[i].indexOf('$$')
        if (closingIndex !== -1) {
          const beforeClosing = lines[i].slice(0, closingIndex)
          if (beforeClosing.trim()) {
            mathLines.push(beforeClosing)
          }
          i += 1
          break
        }
        mathLines.push(lines[i])
        i += 1
      }

      blocks.push(createBlock(BLOCK_TYPES.MATH, mathLines.join('\n').trim()))
      continue
    }

    const { type, content, extra } = detectBlockType(line)
    blocks.push(createBlock(type, content, extra))
    i += 1
  }

  if (blocks.length === 0) {
    blocks.push(createBlock())
  }

  return blocks
}

/**
 * Serialize blocks back to markdown string
 */
export function blocksToMarkdown(blocks) {
  if (!blocks || blocks.length === 0) {
    return ''
  }

  const orderedCounters = []
  let previousWasOrderedList = false

  return blocks.map(block => {
    const content = block.content || ''
    const indentLevel = Math.max(0, block.indent || 0)
    const indent = '  '.repeat(indentLevel)

    switch (block.type) {
      case BLOCK_TYPES.HEADING_1:
        orderedCounters.length = 0
        previousWasOrderedList = false
        return `# ${content}`
      case BLOCK_TYPES.HEADING_2:
        orderedCounters.length = 0
        previousWasOrderedList = false
        return `## ${content}`
      case BLOCK_TYPES.HEADING_3:
        orderedCounters.length = 0
        previousWasOrderedList = false
        return `### ${content}`
      case BLOCK_TYPES.BULLET_LIST:
        orderedCounters.length = 0
        previousWasOrderedList = false
        return `${indent}- ${content}`
      case BLOCK_TYPES.ORDERED_LIST: {
        if (!previousWasOrderedList) {
          orderedCounters.length = 0
        }
        orderedCounters.length = indentLevel + 1
        orderedCounters[indentLevel] = (orderedCounters[indentLevel] || 0) + 1
        previousWasOrderedList = true
        return `${indent}${orderedCounters[indentLevel]}. ${content}`
      }
      case BLOCK_TYPES.TODO:
        orderedCounters.length = 0
        previousWasOrderedList = false
        return `${indent}- [${block.checked ? 'x' : ' '}] ${content}`
      case BLOCK_TYPES.QUOTE:
        orderedCounters.length = 0
        previousWasOrderedList = false
        return content.split('\n').map(l => `${indent}> ${l}`).join('\n')
      case BLOCK_TYPES.CODE:
        orderedCounters.length = 0
        previousWasOrderedList = false
        return `\`\`\`${block.language || ''}\n${content}\n\`\`\``
      case BLOCK_TYPES.MATH:
        orderedCounters.length = 0
        previousWasOrderedList = false
        return `$$\n${content}\n$$`
      case BLOCK_TYPES.DIVIDER:
        orderedCounters.length = 0
        previousWasOrderedList = false
        return '---'
      case BLOCK_TYPES.PARAGRAPH:
      default:
        orderedCounters.length = 0
        previousWasOrderedList = false
        return content
    }
  }).join('\n')
}

/**
 * Convert block content back to raw markdown prefix included
 * Useful when switching a block back to edit mode
 */
export function blockToRawMarkdown(block) {
  return blocksToMarkdown([block])
}

/**
 * Render a single block to HTML
 */
function unwrapParagraph(html) {
  const trimmed = String(html || '').trim()
  const match = trimmed.match(/^<p>([\s\S]*)<\/p>$/)
  return match ? match[1] : trimmed
}

/**
 * Render a single block to HTML
 */
export function renderBlock(block, baseDir = '', options = {}) {
  if (!block) return ''

  const content = block.content || ''

  switch (block.type) {
    case BLOCK_TYPES.DIVIDER:
      return '<hr class="block-divider">'

    case BLOCK_TYPES.CODE: {
      const escaped = content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
      const safeLang = String(block.language || '')
        .replace(/[^a-zA-Z0-9_-]/g, '')
      const langClass = safeLang ? ` class="language-${safeLang}"` : ''
      return `<pre class="block-code"><code${langClass}>${escaped}</code></pre>`
    }

    case BLOCK_TYPES.MATH:
      return renderMarkdown(`$$\n${content}\n$$`, baseDir)

    case BLOCK_TYPES.TODO: {
      const checkbox = `<input type="checkbox" class="block-todo-checkbox" ${block.checked ? 'checked' : ''} disabled>`
      const textHtml = renderMarkdown(content, baseDir)
      return `<div class="block-todo"><label class="block-todo-label">${checkbox}<span class="block-todo-text">${textHtml}</span></label></div>`
    }

    case BLOCK_TYPES.ORDERED_LIST: {
      const number = Math.max(1, options.orderedNumber || block.order || 1)
      const itemHtml = unwrapParagraph(renderMarkdown(content, baseDir))
      return `<ol class="block-ordered-list" start="${number}"><li>${itemHtml}</li></ol>`
    }

    default: {
      const md = blockToRawMarkdown(block)
      return renderMarkdown(md, baseDir)
    }
  }
}

/**
 * Get placeholder text for empty block
 */
export function getBlockPlaceholder(block) {
  switch (block.type) {
    case BLOCK_TYPES.HEADING_1:
    case BLOCK_TYPES.HEADING_2:
    case BLOCK_TYPES.HEADING_3:
      return '标题'
    case BLOCK_TYPES.BULLET_LIST:
      return '列表项'
    case BLOCK_TYPES.ORDERED_LIST:
      return '列表项'
    case BLOCK_TYPES.TODO:
      return '待办事项'
    case BLOCK_TYPES.QUOTE:
      return '引用文本'
    case BLOCK_TYPES.CODE:
      return '代码...'
    case BLOCK_TYPES.MATH:
      return 'LaTeX 公式...'
    default:
      return '输入内容，或输入 # / - / > 等标记'
  }
}
