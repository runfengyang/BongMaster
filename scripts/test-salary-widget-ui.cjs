const { app, BrowserWindow, ipcMain, ipcRenderer } = require('electron')

if (process.type === 'renderer') {
  const NativeDate = Date
  window.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : ['2026-11-09T10:00:00'])) }
    static now() { return new NativeDate('2026-11-09T10:00:00').getTime() }
  }
  window.electronAPI = new Proxy({}, {
    get: (_, method) => (...args) => ipcRenderer.invoke('salary-test:api', method, args)
  })
} else {
  const assert = require('node:assert/strict')
  const fs = require('node:fs')
  const os = require('node:os')
  const path = require('node:path')
  const { DatabaseService } = require('../electron/services/database-service.js')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-salary-ui-'))
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
    console.error(await evaluate(`({ ready: document.readyState, salary: document.querySelector('#salary-panel')?.textContent.slice(0, 160) })`))
    throw new Error(`Timed out: ${expression}`)
  }
  const reload = async () => {
    if (win.webContents.getURL()) {
      await new Promise(resolve => {
        win.webContents.once('did-finish-load', resolve)
        win.webContents.reload()
      })
    } else {
      await win.loadFile(path.resolve(__dirname, '../dist/renderer/index.html'), { hash: '/daily-tasks' })
    }
    await waitFor("!!document.querySelector('.bm-navbar-actions')")
  }
  app.whenReady().then(async () => {
    try {
      const dbPath = path.join(tmp, 'test.db')
      fs.writeFileSync(dbPath, '')
      db = new DatabaseService(dbPath, path.join(tmp, 'uploads'))
      db.initialize()
      db.saveWorkAttendanceSettings({ work_start: '09:00', work_end: '18:00', workdays: '1,2,3,4,5', lunch_break_minutes: 60 })
      db.saveWorkAttendance({ work_date: '2026-11-09', check_in_at: '2026-11-09 09:00:00' })
      db.saveWorkAttendance({ work_date: '2026-11-08', check_in_at: '2026-11-08 09:00:00', check_out_at: '2026-11-08 18:00:00' })
      ipcMain.handle('salary-test:api', (_, method, args) => {
        if (method === 'getWorkAttendanceRange') return db.getWorkAttendance(...args)
        return typeof db[method] === 'function' ? db[method](...args) : []
      })
      win = new BrowserWindow({ show: false, width: 1400, height: 900, webPreferences: {
        preload: __filename, contextIsolation: false, sandbox: false
      } })
      await reload()
      await waitFor("!!document.querySelector('button[commandfor=\"salary-panel\"]')")
      assert.ok(await evaluate(`(() => {
        const nav = document.querySelector('.bm-navbar')
        const link = document.querySelector('.bm-nav-link')
        const glider = document.querySelector('.bm-nav-glider')
        const salary = document.querySelector('.salary-bar')
        return Math.round(nav.getBoundingClientRect().height) === 56 &&
          parseFloat(getComputedStyle(link).fontSize) <= 13 &&
          Math.round(glider.getBoundingClientRect().height) === 30 &&
          getComputedStyle(glider).transitionProperty.includes('transform') &&
          Math.round(salary.getBoundingClientRect().width) === 174 &&
          Math.round(salary.getBoundingClientRect().height) === 28
      })()`))
      await evaluate("document.querySelector('button[commandfor=\"salary-panel\"]').click()")
      await waitFor("document.querySelector('#salary-panel').matches(':popover-open')")
      assert.ok(await evaluate("document.querySelector('#salary-panel').textContent.includes('月薪')"))
      await evaluate("document.querySelector('button[title=\"隐藏收入条\"]').click()")
      await waitFor("!document.querySelector('#salary-panel')")
      assert.equal(await evaluate("JSON.parse(localStorage.getItem('bongmaster-salary')).visible"), false)
      await reload()
      assert.equal(await evaluate("!!document.querySelector('button[title=\"隐藏收入条\"]')"), false)
      await evaluate("document.querySelector('.bm-theme-toggle').click()")
      await waitFor("!!document.querySelector('.bm-theme-menu')")
      await evaluate("[...document.querySelectorAll('.bm-theme-menu button')].find(el => el.textContent.includes('显示收入条')).click()")
      await waitFor("!!document.querySelector('button[title=\"隐藏收入条\"]')")
      assert.equal(await evaluate("JSON.parse(localStorage.getItem('bongmaster-salary')).visible"), true)
      await evaluate("document.querySelector('button[commandfor=\"salary-panel\"]').click()")
      await waitFor("!!document.querySelector('#salary-form')")
      assert.equal(await evaluate("document.querySelectorAll('#salary-form input[type=number]').length"), 1)
      assert.equal(await evaluate("document.querySelectorAll('#salary-form input[type=time], #salary-form input[type=checkbox], #salary-form fieldset').length"), 0)
      await evaluate(`(() => {
        const input = document.querySelector('#salary-form input[type=number]')
        input.value = '21000'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        document.querySelector('#salary-form').requestSubmit()
      })()`)
      await waitFor("document.querySelector('.salary-bar-amount')?.textContent.includes('111.11')")
      assert.equal(await evaluate("JSON.parse(localStorage.getItem('bongmaster-salary')).settings.amount"), 21000)
      assert.equal(await evaluate("document.querySelector('#salary-panel').textContent.includes('本月工作日')"), false)
      assert.equal(await evaluate("document.querySelector('#salary-panel').textContent.includes('午休')"), false)
      assert.equal(await evaluate("document.querySelector('#salary-panel').textContent.includes('跟随打卡')"), false)
      assert.equal(await evaluate("document.querySelector('#salary-panel').textContent.includes('不是预测')"), false)
      await waitFor("document.querySelectorAll('.salary-charts svg').length >= 2")
      assert.ok(await evaluate("document.querySelector('.salary-charts').textContent.includes('活跃')"))
      assert.ok(await evaluate("document.querySelector('.salary-charts').textContent.includes('峰值') && document.querySelector('.salary-charts').textContent.includes('¥')"))
      assert.equal(await evaluate("!!document.querySelector('.salary-chart-disclosure')"), false)
      await evaluate("document.querySelectorAll('.heat-hit')[document.querySelectorAll('.heat-hit').length - 1].dispatchEvent(new MouseEvent('mouseenter'))")
      await waitFor("document.querySelector('.heat-tip')?.textContent.includes('11月9日')")
      assert.ok(await evaluate("document.querySelector('.heat-tip').textContent.includes('111.11')"))
      assert.equal(await evaluate("document.querySelectorAll('.heat-cell.is-hovered').length"), 1)
      await evaluate("document.querySelectorAll('.heat-hit')[document.querySelectorAll('.heat-hit').length - 1].dispatchEvent(new MouseEvent('mouseleave'))")
      await waitFor("!document.querySelector('.heat-tip')")
      await evaluate("document.querySelectorAll('.trend-hit')[document.querySelectorAll('.trend-hit').length - 1].dispatchEvent(new MouseEvent('mouseenter'))")
      await waitFor("document.querySelector('.trend-tip')?.textContent.includes('11月9日')")
      assert.ok(await evaluate("document.querySelector('.trend-tip').textContent.includes('111.11')"))
      assert.equal(await evaluate("!!document.querySelector('.trend-point')"), true)
      await evaluate("document.querySelectorAll('.trend-hit')[document.querySelectorAll('.trend-hit').length - 1].dispatchEvent(new MouseEvent('mouseleave'))")
      await waitFor("!document.querySelector('.trend-tip') && !document.querySelector('.trend-point')")
      await evaluate("document.querySelector('.salary-bar-toggle').click()")
      await waitFor("document.querySelector('.salary-bar-amount')?.textContent.includes('本周收入') && document.querySelector('.salary-bar-amount').textContent.includes('111.11')")
      assert.equal(await evaluate("JSON.parse(localStorage.getItem('bongmaster-salary')).period"), 'week')
      await evaluate("document.querySelector('.salary-bar-toggle').click()")
      await waitFor("document.querySelector('.salary-bar-amount')?.textContent.includes('本月收入') && document.querySelector('.salary-bar-amount').textContent.includes('2,111.11')")
      await evaluate("document.querySelector('.salary-bar-toggle').click()")
      await waitFor("document.querySelector('.salary-bar-amount')?.textContent.includes('本日收入')")
      await evaluate("document.querySelector('#salary-panel .salary-check input').click()")
      await waitFor("!!document.querySelector('.salary-bar-masked')")
      assert.equal(await evaluate("document.querySelector('.salary-charts').textContent.includes('¥')"), false)
      assert.equal(await evaluate("!!document.querySelector('#salary-form')"), false)
      assert.deepEqual(await evaluate("[...document.querySelectorAll('.salary-summary dd')].slice(0,2).map(el => el.textContent)"), ['••••', '••••'])
      await reload()
      await waitFor("!!document.querySelector('.salary-bar-masked')")
      await evaluate("document.querySelector('button[commandfor=\"salary-panel\"]').click()")
      await waitFor("document.querySelector('#salary-panel').matches(':popover-open')")
      await evaluate("document.querySelector('.salary-edit-toggle').click()")
      await waitFor("!!document.querySelector('#salary-form')")
      await evaluate(`(() => {
        const input = document.querySelector('#salary-form input[type=number]')
        input.value = '99999'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        document.querySelector('.salary-form-actions button[type=button]').click()
      })()`)
      assert.equal(await evaluate("JSON.parse(localStorage.getItem('bongmaster-salary')).settings.amount"), 21000)
      await evaluate("document.querySelector('.salary-edit-toggle').click()")
      await waitFor("!!document.querySelector('#salary-form')")
      await evaluate(`(() => {
        const input = document.querySelector('#salary-form input[type=number]')
        input.value = '-1'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        document.querySelector('#salary-form').requestSubmit()
      })()`)
      await waitFor("!!document.querySelector('.salary-alert-strong')")
      assert.equal(await evaluate("JSON.parse(localStorage.getItem('bongmaster-salary')).settings.amount"), 21000)
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
      await waitFor("!document.querySelector('#salary-panel').matches(':popover-open')")
      for (const width of [1400, 1000, 820, 700, 640]) {
        win.setSize(width, 900)
        await new Promise(resolve => setTimeout(resolve, 100))
        assert.ok(await evaluate(`(() => {
          const bar = document.querySelector('.salary-bar').getBoundingClientRect()
          const palette = document.querySelector('.bm-theme-toggle').getBoundingClientRect()
          return bar.width >= 170 && bar.height >= 27 && bar.right <= palette.left && palette.right <= innerWidth
        })()`), `single-row salary bar at ${width}px`)
      }
      await evaluate("document.querySelector('button[title=\"隐藏收入条\"]').click()")
      await waitFor("!document.querySelector('.salary-bar')")
      await reload()
      assert.equal(await evaluate("!!document.querySelector('.salary-bar')"), false)
      assert.equal(await evaluate("JSON.parse(localStorage.getItem('bongmaster-salary')).settings.amount"), 21000)
      assert.equal(await evaluate("JSON.parse(localStorage.getItem('bongmaster-salary')).private"), true)
      await evaluate(`localStorage.setItem('bongmaster-salary', JSON.stringify({visible:true,private:false,period:'day',settings:{amount:33333,currency:'USD',workdays:[1],workStart:'07:00',workEnd:'23:00',breakEnabled:true}}))`)
      await reload()
      await waitFor("document.querySelector('.salary-bar-amount')?.textContent.includes('US$')")
      await evaluate("document.querySelector('.salary-bar-toggle').click()")
      const migrated = await evaluate("JSON.parse(localStorage.getItem('bongmaster-salary')).settings")
      assert.deepEqual(migrated, { amount: 33333, currency: 'USD' })
      await evaluate("localStorage.setItem('bongmaster-salary', '{broken')")
      await reload()
      await waitFor("!!document.querySelector('.salary-bar-empty')")
      console.log('Packaged renderer: attendance-linked income, overtime, compact settings, charts, privacy, legacy migration, persistence, and responsive layout passed')
    } catch (error) {
      console.error(error)
      process.exitCode = 1
    } finally {
      if (win) win.destroy()
      if (db) db.db.close()
      ipcMain.removeHandler('salary-test:api')
      fs.rmSync(tmp, { recursive: true, force: true })
      app.exit(process.exitCode || 0)
    }
  })
}
