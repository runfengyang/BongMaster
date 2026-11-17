const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile } = require('child_process')
const { marked } = require('marked')
const katex = require('katex')

marked.use({
  gfm: true,
  breaks: true
})

class AppleNotesService {
  constructor(userDataPath = '') {
    this.userDataPath = userDataPath
    this.tempDir = path.join(os.tmpdir(), 'bongmaster-apple-notes')
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true })
    }
  }

  async buildPayload(note, options = {}) {
    const title = (note.title || '').trim() || '无标题便签'
    const content = this.stripLeadingTitle(note.content || '', title)
    const contentHtml = await this.renderMarkdown(content, note.id, options)
    const metadataHtml = this.buildMetadataHtml(note)

    return {
      title,
      body: this.wrapHtmlBody(contentHtml, metadataHtml)
    }
  }

  stripLeadingTitle(content, title) {
    const normalizedTitle = this.plainTitleLine(title)
    if (!normalizedTitle) return content
    const lines = String(content || '').split(/\r?\n/)
    const index = lines.findIndex(line => line.trim())
    if (index === -1) return content
    if (this.plainTitleLine(lines[index]) !== normalizedTitle) return content
    lines.splice(index, 1)
    if (lines[index] !== undefined && !lines[index].trim()) lines.splice(index, 1)
    return lines.join('\n')
  }

  plainTitleLine(line) {
    const text = String(line || '').trim()
    const heading = /^#{1,6}\s+(.*)$/.exec(text)
    const html = /^<h[1-6][^>]*>(.*?)<\/h[1-6]>$/i.exec(text)
    return String(heading?.[1] ?? html?.[1] ?? text)
      .replace(/<[^>]+>/g, '')
      .replace(/[*_`~]/g, '')
      .replace(/\s+#+\s*$/, '')
      .trim()
  }

  escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  async renderMarkdown(content, noteId, options = {}) {
    if (!content || typeof content !== 'string') {
      return '<p><br></p>'
    }

    const withMath = options.mathMode === 'latex'
      ? this.replaceMathWithLatexCode(content)
      : this.replaceMathTokens(content)

    const processedContent = withMath.replace(
      /!\[([^\]]*)\]\(([^)]+)\)/g,
      (match, alt, src) => {
        if (/^(https?:|data:|file:)/i.test(src)) return match
        const filePath = this.resolveLocalImagePath(src, noteId)
        return `![${alt}](${filePath})`
      }
    )

    try {
      return this.sanitizeHtml(marked.parse(processedContent))
    } catch (error) {
      return `<p>${this.escapeHtml(content).replace(/\n/g, '<br>')}</p>`
    }
  }

  replaceMathWithLatexCode(content) {
    if (!content || typeof content !== 'string') return ''

    let processed = content.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => {
      const cleanTex = String(tex || '').trim()
      return `\n\n\`\`\`latex\n${cleanTex}\n\`\`\`\n\n`
    })

    processed = processed.replace(/\\\[([\s\S]+?)\\\]/g, (_, tex) => {
      const cleanTex = String(tex || '').trim()
      return `\n\n\`\`\`latex\n${cleanTex}\n\`\`\`\n\n`
    })

    processed = processed.replace(/\\\(([^\n]+?)\\\)/g, (match, tex) => {
      return `\`${String(tex || '').trim()}\``
    })

    processed = processed.replace(/(^|[^\\$])\$([^\n$]+?)\$/g, (match, prefix, tex) => {
      return `${prefix}\`${String(tex || '').trim()}\``
    })

    return processed
  }

  replaceMathTokens(content, mode = 'apple-notes') {
    if (!content || typeof content !== 'string') return ''

    const renderToken = (tex, displayMode) => this.renderMath(tex, displayMode, mode)
    let processed = content.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => {
      return `\n\n${renderToken(tex, true)}\n\n`
    })

    processed = processed.replace(/\\\[([\s\S]+?)\\\]/g, (_, tex) => {
      return `\n\n${renderToken(tex, true)}\n\n`
    })

    processed = processed.replace(/\\\(([^\n]+?)\\\)/g, (match, tex) => {
      return renderToken(tex, false)
    })

    processed = processed.replace(/(^|[^\\$])\$([^\n$]+?)\$/g, (match, prefix, tex) => {
      return `${prefix}${renderToken(tex, false)}`
    })

    return processed
  }

  renderMath(tex, displayMode = false, mode = 'apple-notes') {
    const cleanTex = String(tex || '').trim()
    if (!cleanTex) return ''

    try {
      if (mode === 'pdf') {
        return katex.renderToString(cleanTex, {
          displayMode,
          throwOnError: false,
          output: 'html'
        })
      }

      const mathml = katex.renderToString(cleanTex, {
        displayMode,
        throwOnError: false,
        output: 'mathml'
      })
      const style = displayMode
        ? 'display:block;margin:10px 0;overflow-x:auto;'
        : 'display:inline-block;vertical-align:middle;'
      return `<span style="${style}">${mathml}</span>`
    } catch (error) {
      const escaped = this.escapeHtml(cleanTex)
      return displayMode
        ? `<pre>${escaped}</pre>`
        : `<code>${escaped}</code>`
    }
  }

  resolveLocalImagePath(src, noteId) {
    const cleanSrc = String(src || '').replace(/^\.?\//, '')
    if (this.userDataPath && cleanSrc.startsWith('images/')) {
      // 兼容旧路径 /images/notepad/...
      return `file://${path.join(this.userDataPath, cleanSrc)}`
    }
    if (this.userDataPath && cleanSrc.startsWith('notepad/')) {
      // 新路径 /notepad/<noteId>/<filename>
      return `file://${path.join(this.userDataPath, 'images', cleanSrc)}`
    }
    if (this.userDataPath && noteId && !path.isAbsolute(cleanSrc)) {
      return `file://${path.join(this.userDataPath, 'images', 'notepad', String(noteId), cleanSrc)}`
    }
    return `file://${cleanSrc}`
  }

  buildMetadataHtml(note) {
    const rows = [
      '<strong>BongMaster</strong>',
      `分类: ${this.escapeHtml(note.category || '无')}`,
      note.updated_at ? `BongMaster 更新时间: ${this.escapeHtml(note.updated_at)}` : null
    ].filter(Boolean)

    return `<hr><p>${rows.join('<br>')}</p>`
  }

  wrapHtmlBody(contentHtml, metadataHtml) {
    return `${contentHtml || '<p><br></p>'}${metadataHtml || ''}`
  }

  buildPrintHtml(note) {
    const title = (note.title || '').trim() || '无标题便签'
    const content = this.stripLeadingTitle(note.content || '', title)
    const contentHtml = this.sanitizeHtml(marked.parse(
      this.replaceMathTokens(content, 'pdf').replace(
        /!\[([^\]]*)\]\(([^)]+)\)/g,
        (match, alt, src) => {
          if (/^(https?:|data:|file:)/i.test(src)) return match
          const filePath = this.resolveLocalImagePath(src, note.id)
          return `![${alt}](${filePath})`
        }
      )
    ))

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${this.escapeHtml(title)}</title>
  <style>
    ${this.getKatexCss()}
    body {
      margin: 0;
      padding: 36px;
      color: #17202a;
      background: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14px;
      line-height: 1.65;
    }
    h1 { margin: 0 0 18px; font-size: 28px; line-height: 1.25; }
    h2, h3 { margin: 18px 0 8px; line-height: 1.35; }
    p { margin: 8px 0; }
    blockquote { margin: 12px 0; padding: 4px 14px; border-left: 3px solid #d0d7de; color: #57606a; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.92em; }
    pre { padding: 12px; overflow-x: auto; border-radius: 6px; background: #f6f8fa; }
    table { width: 100%; margin: 14px 0; border-collapse: collapse; table-layout: auto; }
    th, td { padding: 7px 9px; border: 1px solid #d0d7de; text-align: left; vertical-align: top; }
    th { background: #f6f8fa; font-weight: 600; }
    img { max-width: 100%; height: auto; border-radius: 6px; }
    mark.note-mark { padding: 0.08em 0.22em; border-radius: 4px; color: inherit; }
    .note-mark-yellow { background: #fff2a8; }
    .note-mark-orange { background: #ffd6a5; }
    .note-mark-pink { background: #ffd1dc; }
    .note-mark-purple { background: #eadcff; }
    .note-mark-blue { background: #cfe8ff; }
    .note-mark-green { background: #d8f5d1; }
    .katex-display { overflow-x: auto; overflow-y: hidden; }
  </style>
</head>
<body>
  <h1>${this.escapeHtml(title)}</h1>
  ${contentHtml || '<p><br></p>'}
</body>
</html>`
  }

  getKatexCss() {
    try {
      return fs.readFileSync(require.resolve('katex/dist/katex.min.css'), 'utf8')
    } catch (error) {
      return ''
    }
  }

  sanitizeHtml(html) {
    return String(html || '')
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
      .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, '')
      .replace(/\son\w+="[^"]*"/gi, '')
      .replace(/\son\w+='[^']*'/gi, '')
      .replace(/\s(href|src)="javascript:[^"]*"/gi, ' $1="#"')
      .replace(/\s(href|src)='javascript:[^']*'/gi, " $1='#'")
  }

  hashSnapshot(title, body) {
    return crypto
      .createHash('sha256')
      .update(`${title || ''}\0${body || ''}`)
      .digest('hex')
  }

  async createNote(payload) {
    return this.runNotesScript('create', payload)
  }

  async getNote(appleNoteId) {
    return this.runNotesScript('get', { appleNoteId })
  }

  async updateNote(appleNoteId, payload) {
    return this.runNotesScript('update', { ...payload, appleNoteId })
  }

  async runNotesScript(action, data) {
    if (process.platform !== 'darwin') {
      return { success: false, status: 'unsupported', error: 'Apple Notes sync only works on macOS.' }
    }

    const nonce = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`
    const titlePath = path.join(this.tempDir, `${nonce}-title.txt`)
    const bodyPath = path.join(this.tempDir, `${nonce}-body.txt`)
    const outputTitlePath = path.join(this.tempDir, `${nonce}-out-title.txt`)
    const outputBodyPath = path.join(this.tempDir, `${nonce}-out-body.txt`)

    if (data.title !== undefined) fs.writeFileSync(titlePath, data.title || '', 'utf8')
    if (data.body !== undefined) fs.writeFileSync(bodyPath, data.body || '', 'utf8')

    const script = `
on readTextFile(posixPath)
  set fileRef to open for access (POSIX file posixPath) without write permission
  try
    set fileContents to read fileRef as «class utf8»
    close access fileRef
    return fileContents
  on error errMsg
    try
      close access fileRef
    end try
    error errMsg
  end try
end readTextFile

on writeTextFile(posixPath, fileContents)
  set fileRef to open for access (POSIX file posixPath) with write permission
  try
    set eof fileRef to 0
    write fileContents to fileRef as «class utf8»
    close access fileRef
  on error errMsg
    try
      close access fileRef
    end try
    error errMsg
  end try
end writeTextFile

on findNoteById(noteId)
  tell application "Notes"
    repeat with oneAccount in accounts
      repeat with oneFolder in folders of oneAccount
        try
          return first note of oneFolder whose id is noteId
        end try
      end repeat
    end repeat
  end tell
  return missing value
end findNoteById

on writeSnapshot(theNote, titleOutputPath, bodyOutputPath)
  tell application "Notes"
    set noteTitle to name of theNote
    set noteBody to body of theNote
    set noteId to id of theNote
  end tell
  my writeTextFile(titleOutputPath, noteTitle)
  my writeTextFile(bodyOutputPath, noteBody)
  return "OK" & tab & noteId
end writeSnapshot

on run argv
  set actionName to item 1 of argv
  set noteIdArg to item 2 of argv
  set titleInputPath to item 3 of argv
  set bodyInputPath to item 4 of argv
  set titleOutputPath to item 5 of argv
  set bodyOutputPath to item 6 of argv

  tell application "Notes"
    if actionName is "create" then
      set noteTitle to my readTextFile(titleInputPath)
      set noteBody to my readTextFile(bodyInputPath)
      try
        set targetFolder to folder "Notes"
        set newNote to make new note at targetFolder with properties {name:noteTitle, body:noteBody}
      on error
        set newNote to make new note with properties {name:noteTitle, body:noteBody}
      end try
      return my writeSnapshot(newNote, titleOutputPath, bodyOutputPath)
    end if
  end tell

  set targetNote to my findNoteById(noteIdArg)
  if targetNote is missing value then
    return "NOT_FOUND"
  end if

  if actionName is "get" then
    return my writeSnapshot(targetNote, titleOutputPath, bodyOutputPath)
  end if

  if actionName is "update" then
    set noteBody to my readTextFile(bodyInputPath)
    tell application "Notes"
      set body of targetNote to noteBody
    end tell
    return my writeSnapshot(targetNote, titleOutputPath, bodyOutputPath)
  end if

  return "ERROR" & tab & "Unknown action"
end run
`

    const args = [
      '-e',
      script,
      action,
      data.appleNoteId || '',
      titlePath,
      bodyPath,
      outputTitlePath,
      outputBodyPath
    ]

    try {
      const stdout = await new Promise((resolve, reject) => {
        execFile('osascript', args, { maxBuffer: 1024 * 1024 * 10 }, (error, out, err) => {
          if (error) {
            const details = err || error.message
            reject(new Error(details))
            return
          }
          resolve(out.trim())
        })
      })

      if (stdout === 'NOT_FOUND') {
        return { success: false, status: 'not_found' }
      }

      if (stdout.startsWith('ERROR')) {
        return { success: false, status: 'error', error: stdout }
      }

      const [, appleNoteId] = stdout.split('\t')
      const title = fs.existsSync(outputTitlePath) ? fs.readFileSync(outputTitlePath, 'utf8') : ''
      const body = fs.existsSync(outputBodyPath) ? fs.readFileSync(outputBodyPath, 'utf8') : ''

      return {
        success: true,
        appleNoteId,
        title,
        body,
        appleHash: this.hashSnapshot(title, body)
      }
    } catch (error) {
      return {
        success: false,
        status: 'error',
        error: this.formatAutomationError(error.message)
      }
    } finally {
      for (const filePath of [titlePath, bodyPath, outputTitlePath, outputBodyPath]) {
        try {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
        } catch (err) {
          // Ignore temp cleanup failures.
        }
      }
    }
  }

  formatAutomationError(message) {
    if (/not authorized|not allowed|AppleEvent|automation/i.test(message)) {
      return 'macOS 拒绝了 BongMaster 控制 Apple Notes。请在“系统设置 -> 隐私与安全性 -> 自动化”里允许 BongMaster 控制 Notes。'
    }
    return message || 'Apple Notes 同步失败'
  }
}

module.exports = { AppleNotesService }
