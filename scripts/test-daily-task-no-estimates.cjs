const { app, BrowserWindow, ipcMain, ipcRenderer } = require('electron')

if (process.type === 'renderer') {
  window.electronAPI = new Proxy({}, {
    get: (_, method) => (...args) => ipcRenderer.invoke('estimate-test:api', method, args)
  })
} else {
  const assert = require('node:assert/strict')
  const fs = require('node:fs')
  const os = require('node:os')
  const path = require('node:path')
  const { DatabaseService } = require('../electron/services/database-service.js')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-estimate-ui-'))
  app.setPath('userData', tmp)
  let db
  let win
  const payloads = []
  const waitFor = async (expression) => {
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      if (await win.webContents.executeJavaScript(expression)) return
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error(`Timed out: ${expression}`)
  }
  app.whenReady().then(async () => {
    try {
      db = new DatabaseService(path.join(tmp, 'test.db'), path.join(tmp, 'uploads'))
      db.initialize()
      const today = db._todayStr()
      const legacy = db.createDailyTask({ title: '历史任务', date: today })
      db.db.prepare('UPDATE daily_tasks SET estimated_minutes = 60 WHERE id = ?').run(legacy.id)
      ipcMain.handle('estimate-test:api', (_, method, args) => {
        if (method === 'createDailyTask') payloads.push(args[0])
        if (method === 'getRecentlyCompletedDailyTasks') return []
        if (typeof db[method] === 'function') return db[method](...args)
        return []
      })
      win = new BrowserWindow({ show: false, webPreferences: {
        preload: __filename, contextIsolation: false, sandbox: false
      } })
      await win.loadFile(path.resolve(__dirname, '../dist/renderer/index.html'), { hash: '/daily-tasks' })
      await waitFor("!!document.querySelector('.bm-daily-task')")
      assert.equal(await win.webContents.executeJavaScript("document.querySelector('.bm-summary-bar').textContent.includes('预计')"), false)
      assert.equal(await win.webContents.executeJavaScript("document.querySelector('.bm-summary-bar').textContent.includes('剩余')"), false)
      assert.equal(await win.webContents.executeJavaScript("!!document.querySelector('.bm-daily-task [title=\"预计时长\"]')"), false)
      await win.webContents.executeJavaScript(`
        document.querySelector('.bm-daily-task button[title="编辑"]').click()
      `)
      await waitFor("!!document.querySelector('.bm-modal-overlay.show input[required]')")
      assert.equal(await win.webContents.executeJavaScript("document.querySelector('.bm-modal-overlay.show').textContent.includes('预计时长')"), false)
      await win.webContents.executeJavaScript("document.querySelector('.bm-modal-overlay.show .bm-modal-close').click()")
      await win.webContents.executeJavaScript(`
        const input = document.querySelector('.bm-quick-add input')
        input.value = '新任务 45m p1'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      `)
      await waitFor("[...document.querySelectorAll('.bm-task-text')].some(el => el.textContent === '新任务 45m')")
      assert.equal('estimated_minutes' in payloads[0], false)
      assert.equal(db.getDailyTasksByDate(today).find(task => task.title === '新任务 45m').priority, '高')
      await win.webContents.executeJavaScript("document.querySelector('button[title=\"重复规则\"]').click()")
      await waitFor("[...document.querySelectorAll('.bm-modal-overlay.show h3')].some(el => el.textContent === '重复规则')")
      assert.equal(await win.webContents.executeJavaScript("document.querySelector('.bm-modal-overlay.show').textContent.includes('预计时长')"), false)
      console.log('Packaged renderer + IPC + SQLite: estimate-removal UI tests passed')
    } catch (error) {
      console.error(error)
      process.exitCode = 1
    } finally {
      if (win) win.destroy()
      if (db) db.db.close()
      ipcMain.removeHandler('estimate-test:api')
      fs.rmSync(tmp, { recursive: true, force: true })
      app.exit(process.exitCode || 0)
    }
  })
}
