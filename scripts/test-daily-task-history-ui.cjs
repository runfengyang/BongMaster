const { app, BrowserWindow, ipcMain, ipcRenderer } = require('electron')

if (process.type === 'renderer') {
  window.electronAPI = new Proxy({}, {
    get: (_, method) => (...args) => ipcRenderer.invoke('history-test:api', method, args)
  })
} else {
  const assert = require('node:assert/strict')
  const fs = require('node:fs')
  const os = require('node:os')
  const path = require('node:path')
  const { DatabaseService } = require('../electron/services/database-service.js')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-history-ui-'))
  app.setPath('userData', tmp)
  let db
  let writer
  let win
  const waitFor = async expression => {
    const deadline = Date.now() + 12000
    while (Date.now() < deadline) {
      if (await win.webContents.executeJavaScript(expression)) return
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error(`Timed out: ${expression}`)
  }
  const values = () => win.webContents.executeJavaScript(
    "[...document.querySelectorAll('.bm-summary-pill .value')].map(el => el.textContent)"
  )
  app.whenReady().then(async () => {
    try {
      const dbPath = path.join(tmp, 'test.db')
      fs.writeFileSync(dbPath, '')
      db = new DatabaseService(dbPath, path.join(tmp, 'uploads'))
      db.initialize()
      const today = db._todayStr()
      const now = new Date()
      const ago = days => new Date(now.getTime() - days * 86400000).toISOString()
      const oldDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 3)
      const yesterday = [oldDate.getFullYear(), String(oldDate.getMonth() + 1).padStart(2, '0'), String(oldDate.getDate()).padStart(2, '0')].join('-')
      const active = db.createDailyTask({ title: '待完成测试任务', date: today })
      const completed = db.createDailyTask({ title: '跨日完成任务', date: yesterday, is_completed: true })
      const historical = db.createDailyTask({ title: '历史完成任务', date: yesterday, is_completed: true })
      const backlog = db.createDailyTask({ title: '积压任务', date: yesterday })
      const setTimes = db.db.prepare('UPDATE daily_tasks SET created_at = ?, completed_at = ? WHERE id = ?')
      setTimes.run(ago(2), now.toISOString(), completed.id)
      setTimes.run(ago(4), ago(3), historical.id)
      setTimes.run(ago(8), null, backlog.id)
      ipcMain.handle('history-test:api', (_, method, args) => {
        if (method === 'getRecentlyCompletedDailyTasks') return []
        if (typeof db[method] === 'function') return db[method](...args)
        return []
      })
      win = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: {
        preload: __filename, contextIsolation: false, sandbox: false
      } })
      await win.loadFile(path.resolve(__dirname, '../dist/renderer/index.html'), { hash: '/daily-tasks' })
      await waitFor("document.querySelector('.bm-summary-pill .value')?.textContent === '1'")
      assert.deepEqual(await values(), ['1', '0.3项', '1.5天', '1'])
      for (const width of [1440, 1000, 800, 640]) {
        win.setSize(width, 1000)
        await new Promise(resolve => setTimeout(resolve, 100))
        const layout = await win.webContents.executeJavaScript(`(() => {
          const bar = document.querySelector('.bm-summary-bar')
          const pills = [...bar.children]
          const rects = pills.map(el => el.getBoundingClientRect())
          return {
            sameRow: rects.every(rect => Math.abs(rect.top - rects[0].top) < 1),
            noOverlap: rects.every((rect, i) => !i || rect.left >= rects[i - 1].right - 1),
            textFits: pills.every(el => el.scrollWidth <= el.clientWidth),
            nowrap: pills.every(el => getComputedStyle(el).whiteSpace === 'nowrap'),
            scrollable: getComputedStyle(bar).overflowX === 'auto',
            fitsPage: bar.getBoundingClientRect().right <= innerWidth + 1
          }
        })()`)
        assert.deepEqual(layout, { sameRow: true, noOverlap: true, textFits: true, nowrap: true, scrollable: true, fitsPage: true }, `layout at ${width}px`)
      }
      win.setSize(1440, 1000)
      await win.webContents.executeJavaScript("document.querySelector('.bm-daily-task input[type=checkbox]').click()")
      await waitFor("document.querySelector('.bm-summary-pill .value')?.textContent === '2'")
      assert.equal(db.getDailyTaskById(active.id).is_completed, 1)
      await win.webContents.executeJavaScript("document.querySelector('.bm-daily-task input[type=checkbox]').click()")
      await waitFor("document.querySelector('.bm-summary-pill .value')?.textContent === '1'")
      assert.equal(db.getDailyTaskById(active.id).is_completed, 0)
      writer = new DatabaseService(dbPath, path.join(tmp, 'uploads'))
      writer.initialize()
      writer.toggleDailyTaskComplete(backlog.id, true)
      await waitFor("document.querySelector('.bm-summary-pill .value')?.textContent === '2'")
      assert.equal((await values())[3], '0')
      writer.deleteDailyTask(backlog.id)
      await waitFor("document.querySelector('.bm-summary-pill .value')?.textContent === '1'")
      db.db.prepare('UPDATE daily_tasks SET created_at = NULL WHERE is_completed = 1').run()
      await waitFor("document.querySelectorAll('.bm-summary-pill .value')[2]?.textContent === '—'")
      await win.webContents.executeJavaScript(`(() => {
        const date = document.querySelector('input[type=date]')
        date.value = ${JSON.stringify(yesterday)}
        date.dispatchEvent(new Event('input', { bubbles: true }))
        date.dispatchEvent(new Event('change', { bubbles: true }))
      })()`)
      await waitFor("document.querySelector('.bm-summary-pill .label')?.textContent === '当日完成'")
      await waitFor("document.querySelectorAll('.bm-summary-pill .value')[1]?.textContent === '0.1项'")
      assert.deepEqual(await values(), ['1', '0.1项', '—', '0'])
      console.log('Packaged renderer + IPC + SQLite: historical statistics, realtime refresh, and single-row layout passed')
    } catch (error) {
      console.error(error)
      process.exitCode = 1
    } finally {
      if (win) win.destroy()
      if (writer) writer.db.close()
      if (db) db.db.close()
      ipcMain.removeHandler('history-test:api')
      fs.rmSync(tmp, { recursive: true, force: true })
      app.exit(process.exitCode || 0)
    }
  })
}
