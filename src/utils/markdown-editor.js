/**
 * DOM -> Markdown serialization for the editable preview pane.
 *
 * The pure part (`serializeDescriptorTree`) works on plain descriptor trees
 * (`{ tag, attrs, children }` for elements, `{ text, offset }` for text nodes)
 * so it can be unit-tested without a DOM. `serializeMarkdown` /
 * `serializeMarkdownWithMap` add the DOM adapter used by the editor.
 */

const BLOCK_TAGS = new Set([
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'blockquote', 'pre', 'hr', 'table'
])

const ESCAPE_CHARS = new Set(['\\', '`', '*', '_', '[', ']', '~', '<', '>', '$', '|'])

const ATTR_NAMES = [
  'class', 'href', 'src', 'alt', 'title', 'type', 'checked', 'disabled', 'data-bm-tex'
]

function isTextNode(node) {
  return Object.prototype.hasOwnProperty.call(node, 'text')
}

function isWhitespaceOnly(node) {
  return isTextNode(node) && node.text.trim() === ''
}

function attrsOf(node) {
  return node.attrs || {}
}

function isMathNode(node) {
  return !!node.tag && 'data-bm-tex' in attrsOf(node)
}

function isDisplayMathNode(node) {
  return isMathNode(node) && String(attrsOf(node).class || '').includes('note-math-display')
}

function createPiece(endOffset = 0) {
  return { text: '', map: [], syntax: [], endOffset }
}

function appendText(piece, text, offset, syntax = false) {
  piece.text += text
  for (let i = 0; i < text.length; i += 1) {
    piece.map.push(offset)
    piece.syntax.push(syntax)
  }
}

function appendPiece(target, source) {
  target.text += source.text
  for (let i = 0; i < source.map.length; i += 1) {
    target.map.push(source.map[i])
    target.syntax.push(source.syntax[i])
  }
  if (Number.isFinite(source.endOffset)) target.endOffset = source.endOffset
}

function escapeLineMarker(value, index) {
  const rest = value.slice(index)
  if (/^#{1,6}\s/.test(rest)) return `\\${value[index]}`
  if (/^[-+]\s/.test(rest)) return `\\${value[index]}`
  return null
}

function createWriter(piece = createPiece()) {
  let atLineStart = true

  return {
    piece,
    get atLineStart() {
      return atLineStart
    },
    // Structural markup: markers, bullets, fences... flagged so a DOM range
    // never swallows the syntax that wraps the text it selects.
    raw(text, offset = piece.endOffset) {
      if (!text) return
      appendText(piece, text, offset, true)
      piece.endOffset = offset
      atLineStart = text.endsWith('\n')
    },
    literal(value, offset = piece.endOffset) {
      if (!value) return
      for (let i = 0; i < value.length; i += 1) appendText(piece, value[i], offset + i)
      piece.endOffset = offset + value.length
      atLineStart = value.endsWith('\n')
    },
    text(value, offset = piece.endOffset, lineStart = atLineStart) {
      if (!value) return
      let isLineStart = lineStart
      for (let i = 0; i < value.length; i += 1) {
        const char = value[i]
        let output = ESCAPE_CHARS.has(char) ? `\\${char}` : char
        if (isLineStart) {
          output = escapeLineMarker(value, i) || output
        }
        appendText(piece, output, offset + i)
        isLineStart = false
      }
      piece.endOffset = offset + value.length
      atLineStart = isLineStart
    },
    append(source) {
      appendPiece(piece, source)
      if (source.text) atLineStart = source.text.endsWith('\n')
    }
  }
}

function collectText(nodes) {
  let output = ''
  for (const node of nodes || []) {
    if (isTextNode(node)) {
      output += node.text
      continue
    }
    if (node.tag === 'br') {
      output += '\n'
      continue
    }
    output += collectText(node.children)
  }
  return output
}

function prefixLines(piece, prefixFactory) {
  const result = createPiece()
  if (!piece.text) return result

  let lineIndex = 0
  let atStart = true
  for (let i = 0; i < piece.text.length; i += 1) {
    const char = piece.text[i]
    if (atStart) {
      appendText(result, prefixFactory(lineIndex), piece.map[i] ?? 0, true)
      atStart = false
    }
    appendText(result, char, piece.map[i] ?? 0, piece.syntax[i])
    if (char === '\n') {
      atStart = true
      lineIndex += 1
    }
  }

  result.endOffset = piece.endOffset
  return result
}

function indentContinuation(piece, indent) {
  if (!indent || !piece.text.includes('\n')) return piece

  const result = createPiece()
  for (let i = 0; i < piece.text.length; i += 1) {
    const char = piece.text[i]
    const next = piece.text[i + 1]
    if (char === '\n' && next !== undefined && next !== '\n') {
      appendText(result, `\n${indent}`, piece.map[i] ?? 0, true)
      continue
    }
    appendText(result, char, piece.map[i] ?? 0, piece.syntax[i])
  }
  result.endOffset = piece.endOffset
  return result
}

function replaceChar(piece, target, replacement) {
  if (!piece.text.includes(target)) return piece

  const result = createPiece()
  for (let i = 0; i < piece.text.length; i += 1) {
    const char = piece.text[i]
    appendText(result, char === target ? replacement : char, piece.map[i] ?? 0, piece.syntax[i])
  }
  result.endOffset = piece.endOffset
  return result
}

function inlinePiece(nodes, context, endOffset = 0) {
  const piece = createPiece(endOffset)
  writeInline(nodes, createWriter(piece), context)
  return piece
}

function writeWrapped(prefix, suffix, node, writer, context) {
  writer.raw(prefix)
  writer.append(inlinePiece(node.children, context, writer.piece.endOffset))
  writer.raw(suffix)
}

function writeInline(nodes, writer, context) {
  for (const node of nodes || []) {
    if (isTextNode(node)) {
      writer.text(node.text, node.offset)
      continue
    }

    const attrs = attrsOf(node)

    if (isMathNode(node)) {
      const tex = attrs['data-bm-tex']
      writer.raw(isDisplayMathNode(node) ? `$$\n${tex}\n$$` : `$${tex}$`)
      continue
    }

    switch (node.tag) {
      case 'br':
        writer.raw('\n')
        break
      case 'strong':
      case 'b':
        writeWrapped('**', '**', node, writer, context)
        break
      case 'em':
      case 'i':
        writeWrapped('*', '*', node, writer, context)
        break
      case 'del':
      case 's':
      case 'strike':
        writeWrapped('~~', '~~', node, writer, context)
        break
      case 'ins':
      case 'u':
        writeWrapped('<ins>', '</ins>', node, writer, context)
        break
      case 'mark': {
        const className = String(attrs.class || '').trim()
        const markClass = /^bm-highlight-[a-z]+$/.test(className) ? ` class="${className}"` : ''
        writeWrapped(`<mark${markClass}>`, '</mark>', node, writer, context)
        break
      }
      case 'code': {
        const code = collectText([node])
        writer.raw(code.includes('`') ? `\`\`${code}\`\`` : `\`${code}\``)
        break
      }
      case 'img': {
        const src = resolveImageSrc(attrs.src, context)
        writer.raw(`![${attrs.alt || ''}](${src})`)
        break
      }
      case 'a': {
        const label = inlinePiece(node.children, context, writer.piece.endOffset)
        writer.raw('[')
        writer.append(label)
        writer.raw(`](${attrs.href || ''})`)
        break
      }
      default:
        if (BLOCK_TAGS.has(node.tag)) {
          // Defensive: browsers can nest a block inside an inline context while
          // editing; keep the block from being glued onto the previous line.
          writer.raw('\n')
          writeInline(node.children, writer, context)
          writer.raw('\n')
          break
        }
        writeInline(node.children, writer, context)
    }
  }
}

function resolveImageSrc(src, context) {
  if (!src) return ''
  const baseDir = context.imageBaseDir || ''
  if (!src.startsWith('file://')) return src

  const path = src.slice('file://'.length)
  if (baseDir) {
    const prefix = baseDir.endsWith('/') ? baseDir : `${baseDir}/`
    const decodedPath = decodeURI(path)
    if (decodedPath.startsWith(prefix)) return decodedPath.slice(prefix.length)
    if (decodedPath === baseDir) return ''
    const encodedPrefix = encodeURI(prefix)
    if (path.startsWith(encodedPrefix)) return decodeURI(path.slice(encodedPrefix.length))
  }
  return path
}

function writeCodeBlock(node, writer, context) {
  const codeNode = (node.children || []).find(child => child.tag === 'code')
  const className = codeNode ? String(attrsOf(codeNode).class || '') : ''
  const language = (className.match(/language-([\w+-]+)/) || [])[1] || ''
  const code = collectText(codeNode ? codeNode.children : node.children).replace(/\n$/, '')
  writer.raw(`\`\`\`${language}\n`)
  writer.literal(code, writer.piece.endOffset)
  writer.raw('\n```')
}

function writeBlockquote(node, writer, context) {
  const inner = createPiece(writer.piece.endOffset)
  writeBlocks(node.children, createWriter(inner), context)
  writer.append(prefixLines(inner, () => '> '))
}

function writeTable(node, writer, context) {
  const rows = []
  const walkRows = (container) => {
    for (const child of container || []) {
      if (!child.tag) continue
      if (child.tag === 'tr') rows.push(child)
      else if (child.tag === 'thead' || child.tag === 'tbody' || child.tag === 'tfoot') walkRows(child.children)
    }
  }
  walkRows(node.children)

  const toCells = (row) => (row.children || [])
    .filter(cell => cell.tag === 'th' || cell.tag === 'td')
    .map(cell => replaceChar(inlinePiece(cell.children, context), '\n', '<br>').text.trim())

  const bodyRows = rows.map(toCells).filter(cells => cells.length)
  if (!bodyRows.length) return

  const columnCount = Math.max(...bodyRows.map(cells => cells.length))
  const pad = (cells) => {
    const next = cells.slice()
    while (next.length < columnCount) next.push('')
    return next
  }

  const [header, ...body] = bodyRows
  const lines = [
    `| ${pad(header).join(' | ')} |`,
    `| ${Array.from({ length: columnCount }, () => '---').join(' | ')} |`,
    ...body.map(cells => `| ${pad(cells).join(' | ')} |`)
  ]
  writer.raw(lines.join('\n'))
}

function writeListItem(item, writer, context, depth, marker) {
  let task = ''
  let checkboxSeen = false
  const children = []

  for (const child of item.children || []) {
    const attrs = attrsOf(child)
    if (!checkboxSeen && child.tag === 'input' && attrs.type === 'checkbox') {
      task = attrs.checked ? '[x] ' : '[ ] '
      checkboxSeen = true
      continue
    }
    children.push(child)
  }

  const indent = '  '.repeat(depth)
  const nestedLists = children.filter(child => child.tag === 'ul' || child.tag === 'ol')
  const inlineNodes = children.filter(child => child.tag !== 'ul' && child.tag !== 'ol')

  writer.raw(indent + marker + task)

  const content = createPiece(writer.piece.endOffset)
  writeBlocks(inlineNodes, createWriter(content), context)
  writer.append(indentContinuation(content, indent + ' '.repeat(marker.length + task.length)))

  for (const nested of nestedLists) {
    writer.raw('\n')
    writeList(nested, writer, context, depth + 1)
  }
}

function writeList(node, writer, context, depth) {
  const ordered = node.tag === 'ol'
  const indent = '  '.repeat(depth)
  const items = (node.children || []).filter(child => child.tag === 'li')

  items.forEach((item, index) => {
    if (index > 0) writer.raw('\n')
    const marker = ordered ? `${index + 1}. ` : '- '
    writeListItem(item, writer, context, depth, marker)
  })
}

function writeBlockElement(node, writer, context) {
  const heading = /^h([1-6])$/.exec(node.tag)
  if (heading) {
    writer.raw(`${'#'.repeat(Number(heading[1]))} `)
    writeInline(node.children, writer, context)
    return
  }

  switch (node.tag) {
    case 'p':
    case 'div':
      writeInline(node.children, writer, context)
      break
    case 'hr':
      writer.raw('---')
      break
    case 'pre':
      writeCodeBlock(node, writer, context)
      break
    case 'blockquote':
      writeBlockquote(node, writer, context)
      break
    case 'ul':
    case 'ol':
      writeList(node, writer, context, 0)
      break
    case 'table':
      writeTable(node, writer, context)
      break
    default:
      writeInline(node.children, writer, context)
  }
}

function writeBlocks(nodes, writer, context) {
  const blocks = []
  let inlineRun = []

  const flushInline = () => {
    if (inlineRun.some(node => !isWhitespaceOnly(node))) {
      const run = inlineRun.filter(node => !isWhitespaceOnly(node))
      blocks.push((target) => writeInline(run, target, context))
    }
    inlineRun = []
  }

  for (const node of nodes || []) {
    if (isTextNode(node)) {
      inlineRun.push(node)
      continue
    }
    if (isDisplayMathNode(node)) {
      flushInline()
      const tex = attrsOf(node)['data-bm-tex']
      blocks.push((target) => target.raw(`$$\n${tex}\n$$`))
      continue
    }
    if (BLOCK_TAGS.has(node.tag)) {
      flushInline()
      blocks.push((target) => writeBlockElement(node, target, context))
      continue
    }
    inlineRun.push(node)
  }
  flushInline()

  blocks.forEach((write, index) => {
    if (index > 0) writer.raw('\n\n')
    const piece = createPiece(writer.piece.endOffset)
    write(createWriter(piece))
    writer.append(piece)
  })
}

/**
 * Serialize a descriptor tree into markdown.
 * @param {Array} nodes - descriptors of the container's children
 * @param {{ imageBaseDir?: string }} [options]
 * @returns {{ markdown: string, map: number[], syntax: boolean[] }} markdown plus,
 *   for every markdown character index, the DOM text offset it originated from
 *   and whether it is markup generated by this serializer.
 */
export function serializeDescriptorTree(nodes, options = {}) {
  const writer = createWriter()
  writeBlocks(nodes, writer, { imageBaseDir: options.imageBaseDir || '' })
  return { markdown: writer.piece.text, map: writer.piece.map, syntax: writer.piece.syntax }
}

export function serializeMarkdown(root, options = {}) {
  return serializeMarkdownWithMap(root, options).markdown
}

export function serializeMarkdownWithMap(root, options = {}) {
  if (!root || !root.childNodes) return { markdown: '', map: [], syntax: [] }
  return serializeDescriptorTree(descriptorsFromDom(root), options)
}

/**
 * First markdown index that belongs to the given DOM text offset.
 */
export function markdownOffsetForDomOffset(map, domOffset) {
  let low = 0
  let high = map.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (map[mid] < domOffset) low = mid + 1
    else high = mid
  }
  return low
}

/**
 * Inverse of the serializer map: the rendered-text offset a markdown index
 * sits at. Used to put the caret back after re-rendering a history snapshot.
 */
export function domOffsetForMarkdownOffset(map, markdownOffset) {
  if (!Array.isArray(map) || map.length === 0) return 0
  if (markdownOffset <= 0) return map[0]
  if (markdownOffset >= map.length) return map[map.length - 1] + 1
  return map[markdownOffset]
}

/**
 * Map a DOM text range (rendered text offsets) onto a markdown range.
 * Generated markup at either boundary is excluded, so the range covers exactly
 * the user text the browser reported as selected.
 */
export function markdownRangeForDomRange({ map, syntax }, domStart, domEnd) {
  let start = markdownOffsetForDomOffset(map, domStart)
  let end = markdownOffsetForDomOffset(map, domEnd)

  while (start < end && syntax[start]) start += 1
  while (end > start && syntax[end - 1]) end -= 1

  if (start === end) {
    while (start < map.length && syntax[start]) start += 1
    end = start
  }

  return { start, end }
}

function descriptorsFromDom(root) {
  const state = { offset: 0 }
  return describeChildren(root, state)
}

function describeChildren(parent, state) {
  const output = []

  for (const child of parent.childNodes) {
    if (child.nodeType === 3) {
      output.push({ text: child.nodeValue || '', offset: state.offset })
      state.offset += (child.nodeValue || '').length
      continue
    }
    if (child.nodeType !== 1) continue

    const attrs = {}
    for (const name of ATTR_NAMES) {
      if (child.hasAttribute(name)) attrs[name] = child.getAttribute(name)
    }

    if (child.tagName === 'INPUT') {
      attrs.type = (child.getAttribute('type') || '').toLowerCase()
      if (child.checked) attrs.checked = 'checked'
      else delete attrs.checked
      output.push({ tag: 'input', attrs, children: [] })
      continue
    }

    output.push({
      tag: child.tagName.toLowerCase(),
      attrs,
      children: describeChildren(child, state)
    })
  }

  return output
}
