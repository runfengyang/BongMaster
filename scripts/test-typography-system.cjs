const { app, BrowserWindow, ipcMain, ipcRenderer } = require('electron')

if (process.type === 'renderer') {
  window.electronAPI = new Proxy({}, {
    get: (_, method) => (...args) => ipcRenderer.invoke('typography-test:api', method, args)
  })
} else {
  const assert = require('node:assert/strict')
  const fs = require('node:fs')
  const os = require('node:os')
  const path = require('node:path')
  const { DatabaseService } = require('../electron/services/database-service.js')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-typography-ui-'))
  app.setPath('userData', tmp)
  let db
  let win
  const evaluate = expression => win.webContents.executeJavaScript(expression)
  const waitFor = async expression => {
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    console.error(await evaluate("({ hash: location.hash, note: document.querySelector('.note-item')?.textContent, body: document.body.innerText.slice(0, 300), classes: [...document.querySelectorAll('[class*=markdown]')].map(el => el.className).slice(0, 20) })"))
    throw new Error(`Timed out: ${expression}`)
  }
  app.whenReady().then(async () => {
    try {
      const dbPath = path.join(tmp, 'test.db')
      fs.writeFileSync(dbPath, '')
      db = new DatabaseService(dbPath, path.join(tmp, 'uploads'))
      db.initialize()
      const note = db.createDesktopNote({
        title: '字体测试便签',
        content: '# 章节标题\n\n这是一段用于验证阅读字体的正文。The quick brown fox jumps over the lazy dog.',
        category: ''
      })
      ipcMain.handle('typography-test:api', (_, method, args) => [
        'getDesktopNotes', 'getDesktopNotesByProject', 'getDesktopNoteProjects',
        'getProjects', 'getCategories'
      ].includes(method) || typeof db[method] === 'function'
        ? (typeof db[method] === 'function' ? db[method](...args) : [])
        : [])
      win = new BrowserWindow({ show: false, width: 1400, height: 900, webPreferences: {
        preload: __filename, contextIsolation: false, sandbox: false
      } })
      await win.loadFile(path.resolve(__dirname, '../dist/renderer/index.html'), {
        hash: '/notepad'
      })
      await waitFor("document.querySelector('.note-item')")
      await evaluate("document.querySelector('.note-item').click()")
      await waitFor("document.querySelector('.markdown-preview-content h1')")

      const initial = await evaluate(`(() => {
        const read = selector => getComputedStyle(document.querySelector(selector)).fontFamily
        return {
          ui: read('.bm-nav-link'),
          display: read('.markdown-preview-content h1'),
          reading: read('.markdown-preview-content'),
          data: read('.salary-bar-open')
        }
      })()`)
      assert.match(initial.ui, /SF Pro Text|PingFang SC/)
      assert.match(initial.display, /Iowan|Songti/)
      assert.match(initial.reading, /Iowan|Songti/)
      assert.match(initial.data, /SFMono|Menlo/)

      await evaluate("document.documentElement.dataset.theme = 'times'")
      await new Promise(resolve => setTimeout(resolve, 50))
      const times = await evaluate(`(() => {
        const read = selector => getComputedStyle(document.querySelector(selector)).fontFamily
        return { ui: read('.bm-nav-link'), display: read('.markdown-preview-content h1'), reading: read('.markdown-preview-content'), data: read('.salary-bar-open') }
      })()`)
      assert.equal(times.ui, initial.ui)
      assert.equal(times.data, initial.data)
      assert.match(times.display, /Georgia|Songti/)
      assert.match(times.reading, /Georgia|Songti/)

      await evaluate("document.documentElement.dataset.theme = 'focus'")
      await new Promise(resolve => setTimeout(resolve, 50))
      const focus = await evaluate(`(() => {
        const read = selector => getComputedStyle(document.querySelector(selector)).fontFamily
        return { ui: read('.bm-nav-link'), display: read('.markdown-preview-content h1'), reading: read('.markdown-preview-content'), data: read('.salary-bar-open') }
      })()`)
      assert.equal(focus.ui, initial.ui)
      assert.equal(focus.data, initial.data)
      assert.match(focus.display, /Trebuchet/)
      assert.match(focus.reading, /Charter|Songti/)

      await evaluate("document.documentElement.dataset.theme = 'paper'")
      await new Promise(resolve => setTimeout(resolve, 50))
      const paper = await evaluate(`(() => {
        const read = selector => getComputedStyle(document.querySelector(selector)).fontFamily
        return { ui: read('.bm-nav-link'), display: read('.markdown-preview-content h1'), reading: read('.markdown-preview-content'), data: read('.salary-bar-open') }
      })()`)
      assert.equal(paper.ui, initial.ui)
      assert.equal(paper.data, initial.data)
      assert.match(paper.display, /Iowan|Songti/)
      assert.match(paper.reading, /Iowan|Songti/)

      await evaluate("document.querySelector('button[title=\"编辑\"]').click()")
      await waitFor("document.querySelector('.markdown-title-input') && document.querySelector('.markdown-body-textarea')")
      const editor = await evaluate(`(() => {
        const read = selector => getComputedStyle(document.querySelector(selector)).fontFamily
        return { title: read('.markdown-title-input'), body: read('.markdown-body-textarea') }
      })()`)
      assert.match(editor.title, /Iowan|Songti/)
      assert.match(editor.body, /Iowan|Songti/)

      console.log('Typography: fixed UI/data rails, theme-driven display/reading rails passed for sketch, times, focus, paper, preview, and editor')
    } catch (error) {
      console.error(error)
      process.exitCode = 1
    } finally {
      if (win) win.destroy()
      if (db) db.db.close()
      ipcMain.removeHandler('typography-test:api')
      fs.rmSync(tmp, { recursive: true, force: true })
      app.exit(process.exitCode || 0)
    }
  })
}
