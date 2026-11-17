import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const electronBin = require('electron')
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const checks = []
const check = (name, ok, detail) => {
  checks.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail === undefined ? '' : ` -> ${JSON.stringify(detail)}`}`)
}

function httpJson(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: urlPath }, res => {
      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => { try { resolve(JSON.parse(body)) } catch (error) { reject(error) } })
    }).on('error', reject)
  })
}

async function startApp() {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-calendar-pro-'))
  const port = 9500 + Math.floor(Math.random() * 300)
  const child = spawn(electronBin, ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout.on('data', () => {})
  child.stderr.on('data', () => {})
  let targets = null
  for (let i = 0; i < 60; i++) {
    try {
      targets = await httpJson(port, '/json/list')
      if (targets.some(target => target.type === 'page' && target.url.includes('index.html'))) break
    } catch {}
    await sleep(500)
  }
  const page = targets?.find(target => target.type === 'page' && target.url.includes('index.html'))
  if (!page) throw new Error('找不到应用窗口')
  return { child, profileDir, page }
}

async function connectCdp(page) {
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  const pending = new Map()
  const runtimeErrors = []
  let nextId = 0
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result)
      return
    }
    if (message.method === 'Runtime.exceptionThrown') {
      runtimeErrors.push(message.params?.exceptionDetails?.exception?.description || 'exception')
    }
  })
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve)
    ws.addEventListener('error', reject)
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) } }, 30000)
  })
  return {
    runtimeErrors,
    send,
    evaluate: async expression => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (result?.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'eval failed')
      return result?.result?.value
    },
    close: () => ws.close()
  }
}

async function waitFor(cdp, expression, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try { if (await cdp.evaluate(expression)) return true } catch {}
    await sleep(250)
  }
  return false
}

const { child, profileDir, page } = await startApp()
const cdp = await connectCdp(page)
try {
  check('应用加载', await waitFor(cdp, `!!document.querySelector('.bm-page')`))
  const seeded = await cdp.evaluate(`(async () => {
    const pad = value => String(value).padStart(2, '0')
    const now = new Date()
    const today = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())
    const data = await window.electronAPI.getCalendarData('2026-01-01', '2026-12-31')
    const classCalendar = data.calendars.find(item => item.name === '课程')
    await window.electronAPI.createCalendarEvent({
      calendar_id: classCalendar.id, title: 'E2E固定课', kind: 'class',
      start_date: today, end_date: today, start_time: '10:00', end_time: '11:30',
      location: 'https://meet.google.com/abc-defg-hij', recurrence_type: 'none'
    })
    const project = await window.electronAPI.createProject({ name: 'E2E日历项目', status: '进行中' })
    await window.electronAPI.createTask({ project_id: project.id, name: 'E2E截止任务', due_date: today, priority: '高' })
    return { today }
  })()`)
  check('隔离数据创建成功', Boolean(seeded?.today), seeded)

  const navOrder = await cdp.evaluate(`[...document.querySelectorAll('.bm-nav-link span')].map(item => item.textContent.trim())`)
  check('导航顺序正确', JSON.stringify((navOrder || []).slice(0, 4)) === JSON.stringify(['首页', '项目', '日历', '任务']), navOrder)
  await cdp.evaluate(`location.hash = '#/calendar'; true`)
  check('Calendar Pro 页面加载', await waitFor(cdp, `!!document.querySelector('.calendar-pro-page')`))
  await sleep(800)
  const initialStore = await cdp.evaluate(`localStorage.getItem('bongmaster-calendar-pro-state')`)
  await cdp.evaluate(`(() => {
    const cell = [...document.querySelectorAll('.cp-day')].find(item => (item.getAttribute('aria-label') || '').startsWith('2026-11-09'))
    cell?.click()
  })()`)
  await sleep(350)
  const selectedAtStart = await cdp.evaluate(`document.querySelector('.cp-summary-date strong')?.textContent || ''`)
  check('日历已加载选中日期', Boolean(selectedAtStart), { initialStore, selectedAtStart })

  const structure = await cdp.evaluate(`({
    cells: document.querySelectorAll('.cp-month-grid .cp-day').length,
    header: document.querySelector('.cp-month-header')?.innerText || '',
    summary: document.querySelector('.cp-selected-summary')?.innerText || '',
    agenda: document.querySelector('.cp-agenda')?.innerText || '',
    chips: document.querySelectorAll('.cp-event-chip').length,
    chipsText: [...document.querySelectorAll('.cp-event-chip')].map(item => item.textContent.trim()).join(' '),
    oldSwitcher: !!document.querySelector('.calendar-page, .calendar-sidebar, [data-view="week"]'),
    almanac: document.querySelector('.cp-almanac-strip')?.innerText || '',
    weather: !!document.querySelector('.cp-weather-strip'),
    meeting: !!document.querySelector('.cp-meeting-link'),
    lunarChips: [...document.querySelectorAll('.cp-holiday-chip.is-term')].map(item => item.textContent.trim()),
    typeIcons: document.querySelectorAll('.cp-type-icon, .cp-holiday-icon').length
  })`)
  check('月历固定 42 格', structure?.cells === 42, structure)
  check('月份标题和农历摘要显示', /年/.test(structure?.header || '') && /农历/.test(structure?.summary || ''), structure)
  check('月格显示课程和任务', (structure?.chipsText || '').includes('E2E固定课') && (structure?.chipsText || '').includes('E2E截止任务'), structure?.chipsText)
  check('月格显示事件条', structure?.chips > 0, structure?.chips)
  check('旧四视图与侧栏已移除', structure?.oldSwitcher === false, structure)
  check('信息条包含天气和老黄历', structure?.weather && /宜/.test(structure.almanac) && /忌/.test(structure.almanac), structure)
  check('节气以标签显示', (structure?.lunarChips || []).includes('立冬'), structure?.lunarChips)
  check('不同类型事件显示小图标', structure?.typeIcons > 0, structure?.typeIcons)

  const laterTask = await cdp.evaluate(`(async () => {
    const projects = await window.electronAPI.getAllProjects()
    const task = await window.electronAPI.createTask({ project_id: projects[0].id, name: 'E2E后加日期' })
    await window.electronAPI.updateTask(task.id, { due_date: '2026-11-27' })
    return task.id
  })()`)
  await cdp.evaluate(`location.hash = '#/tasks'; true`)
  await sleep(300)
  await cdp.evaluate(`location.hash = '#/calendar'; true`)
  await waitFor(cdp, `!!document.querySelector('.calendar-pro-page')`)
  await sleep(500)
  await cdp.evaluate(`(() => {
    const cell = [...document.querySelectorAll('.cp-day')].find(item => (item.getAttribute('aria-label') || '').startsWith('2026-11-27'))
    cell?.click()
  })()`)
  await sleep(500)
  check('后加截止日期的任务进入日历', Boolean(laterTask) && await cdp.evaluate(`[...document.querySelectorAll('.cp-event-chip')].some(item => item.textContent.includes('E2E后加日期'))`))
  await cdp.evaluate(`(() => {
    const cell = [...document.querySelectorAll('.cp-day')].find(item => (item.getAttribute('aria-label') || '').startsWith('2026-11-09'))
    cell?.click()
  })()`)
  await sleep(300)

  const menuOpened = await cdp.evaluate(`(() => {
    const cell = [...document.querySelectorAll('.cp-day')].find(item => (item.getAttribute('aria-label') || '').startsWith('2026-11-20'))
    cell?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 420, clientY: 420 }))
    return Boolean(cell)
  })()`)
  await sleep(150)
  const menuText = await cdp.evaluate(`document.querySelector('.cp-context-menu')?.innerText || ''`)
  check('格子右键菜单包含新建/粘贴', menuOpened && menuText.includes('新建日程') && menuText.includes('新建提醒事项') && menuText.includes('粘贴日程'), menuText)
  if (process.env.BM_CALENDAR_SHOTS) {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(projectRoot, 'work', 'calendar-pro-e2e-menu.png'), Buffer.from(shot.data, 'base64'))
  }

  await sleep(200)
  await cdp.evaluate(`[...document.querySelectorAll('.cp-context-menu button')].find(item => item.textContent.trim() === '新建提醒事项')?.click()`)
  check('新建提醒事项对话框打开', await waitFor(cdp, `!!document.querySelector('dialog.cp-composer[open]')`))
  const reminderForm = await cdp.evaluate(`({
    title: document.querySelector('#cp-composer-title')?.textContent || '',
    placeholders: [...document.querySelectorAll('.cp-composer input')].map(item => item.placeholder).filter(Boolean),
    titlePlaceholder: document.querySelector('.cp-composer .cp-title-input')?.placeholder || '',
    timeFields: document.querySelectorAll('.cp-composer input[type=time]').length
  })`)
  check('提醒事项表单隐藏时间', reminderForm.title.includes('提醒事项') && reminderForm.timeFields === 0 && reminderForm.titlePlaceholder.includes('提醒事项'), reminderForm)
  await cdp.evaluate(`(() => {
    const input = document.querySelector('.cp-composer .cp-title-input')
    input.value = 'E2E提醒'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector('.cp-composer .cp-primary').click()
  })()`)
  await sleep(700)
  const reminderSaved = await cdp.evaluate(`window.electronAPI.getCalendarData('2026-11-01', '2026-11-30').then(data => data.events.find(item => item.title === 'E2E提醒'))`)
  check('提醒事项保存为全天', reminderSaved?.kind === 'reminder' && reminderSaved?.all_day === 1 && reminderSaved?.start_time === null, reminderSaved)
  await cdp.evaluate(`(() => {
    const cell = [...document.querySelectorAll('.cp-day')].find(item => (item.getAttribute('aria-label') || '').startsWith('2026-11-20'))
    cell?.click()
  })()`)
  await sleep(300)
  const reminderMenu = await cdp.evaluate(`(() => {
    const chip = [...document.querySelectorAll('.cp-event-chip')].find(item => item.textContent.includes('E2E提醒'))
    chip?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 300 }))
    return Boolean(chip)
  })()`)
  await sleep(150)
  await cdp.evaluate(`[...document.querySelectorAll('.cp-context-menu button')].find(item => item.textContent.trim() === '标记为已完成')?.click()`)
  await sleep(500)
  const reminderDone = await cdp.evaluate(`window.electronAPI.getCalendarData('2026-11-01', '2026-11-30').then(data => data.events.find(item => item.title === 'E2E提醒')?.reminder_done)`)
  check('提醒事项可标记完成', reminderMenu && reminderDone === 1, reminderDone)

  await cdp.evaluate(`(() => {
    const cell = [...document.querySelectorAll('.cp-day')].find(item => (item.getAttribute('aria-label') || '').startsWith('2026-11-20'))
    cell?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 420, clientY: 420 }))
  })()`)
  await sleep(150)
  await cdp.evaluate(`[...document.querySelectorAll('.cp-context-menu button')].find(item => item.textContent.trim() === '新建提醒事项')?.click()`)
  await waitFor(cdp, `!!document.querySelector('dialog.cp-composer[open]')`)
  await cdp.evaluate(`(() => {
    const input = document.querySelector('.cp-composer .cp-title-input')
    input.value = '农历生日'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const select = [...document.querySelectorAll('.cp-composer select')].find(item => [...item.options].some(option => option.value === 'lunarYearly'))
    select.value = 'lunarYearly'
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await sleep(120)
  const lunarRow = await cdp.evaluate(`document.querySelectorAll('.cp-lunar-value select').length`)
  await cdp.evaluate(`(() => {
    const selects = [...document.querySelectorAll('.cp-lunar-value select')]
    selects[0].value = '8'
    selects[0].dispatchEvent(new Event('change', { bubbles: true }))
    selects[1].value = '13'
    selects[1].dispatchEvent(new Event('change', { bubbles: true }))
    document.querySelector('.cp-composer .cp-primary').click()
  })()`)
  await sleep(700)
  const lunarSaved = await cdp.evaluate(`window.electronAPI.getCalendarData('2026-11-01', '2027-12-31').then(data => data.events.find(item => item.title === '农历生日'))`)
  check('农历每年提醒保存正确', lunarRow === 2 && lunarSaved?.recurrence_type === 'lunarYearly' && lunarSaved?.recurrence_value === '8,13', lunarSaved)
  await cdp.evaluate(`(() => {
    const app = document.querySelector('#app').__vue_app__
    const store = app.config.globalProperties.$pinia._s.get('calendar')
    store.setMonthDate('2027-09-01')
    store.selectDate('2027-09-13')
  })()`)
  await sleep(1000)
  check('农历提醒在次年农历日期出现', await cdp.evaluate(`[...document.querySelectorAll('.cp-event-chip')].some(item => item.textContent.includes('农历生日'))`))
  await cdp.evaluate(`(() => {
    const app = document.querySelector('#app').__vue_app__
    const store = app.config.globalProperties.$pinia._s.get('calendar')
    store.setMonthDate('2026-11-01')
    store.selectDate('2026-11-09')
  })()`)
  await sleep(600)

  const rangeCreated = await cdp.evaluate(`(() => {
    const start = [...document.querySelectorAll('.cp-day')].find(item => (item.getAttribute('aria-label') || '').startsWith('2026-11-16'))
    const end = [...document.querySelectorAll('.cp-day')].find(item => (item.getAttribute('aria-label') || '').startsWith('2026-11-18'))
    start?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 100, clientY: 100 }))
    end?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    return Boolean(start && end)
  })()`)
  check('跨日拖动打开新建对话框', rangeCreated && await waitFor(cdp, `!!document.querySelector('dialog.cp-composer[open]')`))
  const rangeForm = await cdp.evaluate(`({
    start: [...document.querySelectorAll('.cp-composer input[type=date]')][0]?.value,
    end: [...document.querySelectorAll('.cp-composer input[type=date]')][1]?.value,
    allDay: [...document.querySelectorAll('.cp-composer input[type=checkbox]')][0]?.checked
  })`)
  check('跨日拖动预填日期和全天', rangeForm.start === '2026-11-16' && rangeForm.end === '2026-11-18' && rangeForm.allDay === true, rangeForm)
  await cdp.evaluate(`(() => {
    const input = document.querySelector('.cp-composer .cp-title-input')
    input.value = 'E2E跨日'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector('.cp-composer .cp-primary').click()
  })()`)
  await sleep(700)
  const rangeSaved = await cdp.evaluate(`window.electronAPI.getCalendarData('2026-11-01', '2026-11-30').then(data => data.events.find(item => item.title === 'E2E跨日'))`)
  check('跨日日程保存正确', rangeSaved?.start_date === '2026-11-16' && rangeSaved?.end_date === '2026-11-18' && rangeSaved?.all_day === 1, rangeSaved)

  const copied = await cdp.evaluate(`(() => {
    const chip = [...document.querySelectorAll('.cp-event-chip, .cp-event-bar')].find(item => item.textContent.includes('E2E跨日'))
    chip?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 300 }))
    return Boolean(chip)
  })()`)
  await sleep(120)
  const eventMenuText = await cdp.evaluate(`document.querySelector('.cp-context-menu')?.innerText || ''`)
  check('日程右键菜单包含管理操作', copied && eventMenuText.includes('显示简介') && eventMenuText.includes('日历') && eventMenuText.includes('拷贝') && eventMenuText.includes('复制'), eventMenuText)
  await cdp.evaluate(`[...document.querySelectorAll('.cp-context-menu button')].find(item => item.textContent.trim() === '拷贝')?.click()`)
  await sleep(180)
  await cdp.evaluate(`(() => {
    const cell = [...document.querySelectorAll('.cp-day')].find(item => (item.getAttribute('aria-label') || '').startsWith('2026-11-20'))
    cell?.click()
  })()`)
  await sleep(200)
  await cdp.evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', metaKey: true, bubbles: true }))`)
  await sleep(700)
  const pasted = await cdp.evaluate(`window.electronAPI.getCalendarData('2026-11-01', '2026-11-30').then(data => data.events.filter(item => item.title === 'E2E跨日').map(item => ({ start: item.start_date, end: item.end_date })))`)
  check('粘贴日程保留时长', pasted.some(item => item.start === '2026-11-20' && item.end === '2026-11-22'), pasted)
  const bars = await cdp.evaluate(`[...document.querySelectorAll('.cp-event-bar:not(.is-holiday)')].map(item => ({ text: item.textContent.trim(), width: item.style.width }))`)
  check('跨日事件渲染为连续条状', bars.length === 2 && bars.every(item => item.width.includes('%')), bars)

  const selectedBeforeSettings = await cdp.evaluate(`document.querySelector('.cp-summary-date strong')?.textContent || ''`)
  await cdp.evaluate(`document.querySelector('.cp-nav-button[aria-label="日历设置"]')?.click()`)
  check('日历设置对话框打开', await waitFor(cdp, `!!document.querySelector('dialog.cp-settings-dialog[open]')`))
  await sleep(300)
  const categoryRows = await cdp.evaluate(`document.querySelectorAll('.settings-calendar-row').length`)
  check('标签行存在', categoryRows >= 3, categoryRows)
  const categoryRowHtml = await cdp.evaluate(`[...document.querySelectorAll('.settings-calendar-row')].find(item => item.querySelector('.settings-calendar-name')?.value === '日程')?.outerHTML || ''`)
  check('标签行结构', categoryRowHtml.includes('settings-calendar-color'), categoryRowHtml.slice(0, 300))
  const categoryMenuOpened = await cdp.evaluate(`(() => {
    const row = [...document.querySelectorAll('.settings-calendar-row')].find(item => item.querySelector('.settings-calendar-name')?.value === '日程')
    row?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 300 }))
    return Boolean(row)
  })()`)
  await sleep(120)
  const categoryMenuText = await cdp.evaluate(`document.querySelector('.settings-category-menu')?.innerText || ''`)
  if (!categoryMenuText) {
    await cdp.evaluate(`(() => {
      const row = [...document.querySelectorAll('.settings-calendar-row')].find(item => item.querySelector('.settings-calendar-name')?.value === '日程')
      row?.querySelector('.settings-calendar-color')?.click()
    })()`)
    await sleep(150)
  }
  const categoryMenuText2 = await cdp.evaluate(`document.querySelector('.settings-category-menu')?.innerText || ''`)
  check('标签右键菜单包含颜色和显隐', categoryMenuOpened && /隐藏标签|显示标签/.test(categoryMenuText2), { categoryMenuText, categoryMenuText2 })
  await cdp.evaluate(`document.querySelector('.settings-category-menu button[aria-label="#ff3b30"]')?.click()`)
  await sleep(500)
  const recolored = await cdp.evaluate(`window.electronAPI.getCalendarData('2026-11-01', '2026-11-30').then(data => data.calendars.find(item => item.name === '日程')?.color)`)
  check('标签右键菜单可改颜色', recolored === '#ff3b30', recolored)

  await cdp.evaluate(`(() => {
    const input = document.querySelector('.settings-add-calendar input[placeholder="新标签名称"]')
    input.value = 'E2E标签'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector('.settings-add-calendar button[type=submit]').click()
  })()`)
  await sleep(500)
  const addedCategory = await cdp.evaluate(`window.electronAPI.getCalendarData('2026-11-01', '2026-11-30').then(data => data.calendars.find(item => item.name === 'E2E标签'))`)
  check('标签可新增', addedCategory?.name === 'E2E标签', addedCategory)
  await cdp.evaluate(`(() => {
    window.confirm = () => true
    const row = [...document.querySelectorAll('.settings-calendar-row')].find(item => item.querySelector('.settings-calendar-name')?.value === 'E2E标签')
    row?.querySelector('.settings-calendar-delete')?.click()
  })()`)
  await sleep(500)
  const removedCategory = await cdp.evaluate(`window.electronAPI.getCalendarData('2026-11-01', '2026-11-30').then(data => data.calendars.some(item => item.name === 'E2E标签'))`)
  check('标签可删除', removedCategory === false, removedCategory)
  await cdp.evaluate(`(() => {
    const select = [...document.querySelectorAll('.cp-settings-dialog select')].find(item => [...item.options].some(option => option.value === 'sunday'))
    select.value = 'sunday'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    document.querySelector('.cp-settings-dialog .settings-close').click()
  })()`)
  await sleep(360)
  check('周起始日切换为周日', await cdp.evaluate(`document.querySelector('.cp-weekdays span')?.textContent === '周日'`))
  await cdp.evaluate(`document.querySelector('.cp-nav-button[aria-label="日历设置"]')?.click()`)
  await waitFor(cdp, `!!document.querySelector('dialog.cp-settings-dialog[open]')`)
  await cdp.evaluate(`(() => {
    const select = [...document.querySelectorAll('.cp-settings-dialog select')].find(item => [...item.options].some(option => option.value === 'monday'))
    select.value = 'monday'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    document.querySelector('.cp-settings-dialog .settings-close').click()
  })()`)
  await sleep(360)
  await cdp.evaluate(`document.querySelector('.cp-nav-button[aria-label="日历设置"]')?.click()`)
  await waitFor(cdp, `!!document.querySelector('dialog.cp-settings-dialog[open]')`)
  await cdp.evaluate(`(() => {
    const row = [...document.querySelectorAll('.cp-settings-dialog .settings-calendar-row')].find(item => item.querySelector('.settings-calendar-name')?.value === '课程')
    row.querySelector('input').click()
    document.querySelector('.cp-settings-dialog .settings-close').click()
  })()`)
  await sleep(600)
  check('隐藏课程分类后日程同步消失', await cdp.evaluate(`!document.querySelector('.cp-agenda')?.innerText.includes('E2E固定课')`))
  await cdp.evaluate(`document.querySelector('.cp-nav-button[aria-label="日历设置"]')?.click()`)
  await waitFor(cdp, `!!document.querySelector('dialog.cp-settings-dialog[open]')`)
  await cdp.evaluate(`(() => {
    const row = [...document.querySelectorAll('.cp-settings-dialog .settings-calendar-row')].find(item => item.querySelector('.settings-calendar-name')?.value === '课程')
    row.querySelector('input').click()
    document.querySelector('.cp-settings-dialog .settings-close').click()
  })()`)
  await sleep(600)
  await cdp.evaluate(`document.querySelector('.cp-weather-city')?.click()`)
  check('天气详情对话框打开', await waitFor(cdp, `!!document.querySelector('dialog.cp-weather-dialog[open]')`))
  await cdp.evaluate(`document.querySelector('.cp-weather-dialog .dialog-close')?.click()`)
  if (process.env.BM_CALENDAR_SHOTS) {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(projectRoot, 'work', 'calendar-pro-e2e-day.png'), Buffer.from(shot.data, 'base64'))
  }

  const selectedAfterSettings = await cdp.evaluate(`document.querySelector('.cp-summary-date strong')?.textContent || ''`)
  check('设置操作后选中日期仍有效', /^\d+月\d+日$/.test(selectedAfterSettings), { selectedBeforeSettings, selectedAfterSettings })
  await cdp.evaluate(`(() => {
    const cell = [...document.querySelectorAll('.cp-day')].find(item => (item.getAttribute('aria-label') || '').startsWith('${seeded.today}'))
    cell?.click()
  })()`)
  await sleep(250)
  const taskClicked = await cdp.evaluate(`(async () => {
    const card = [...document.querySelectorAll('.cp-agenda-card')].find(item => item.textContent.includes('E2E截止任务'))
    card?.click()
    await new Promise(resolve => setTimeout(resolve, 600))
    return {
      found: Boolean(card),
      cardClass: card?.className || '',
      layer: Boolean(document.querySelector('.task-detail-layer')),
      drawer: Boolean(document.querySelector('.task-detail-drawer')),
      overlay: Boolean(document.querySelector('.drawer-overlay')),
      layerHtml: document.querySelector('.task-detail-layer')?.outerHTML.slice(0, 240) || ''
    }
  })()`)
  check('点击任务打开任务抽屉', taskClicked?.drawer === true, taskClicked)
  await cdp.evaluate(`document.querySelector('.task-detail-drawer .drawer-close')?.click()`)
  const completedInline = await cdp.evaluate(`(() => {
    const card = [...document.querySelectorAll('.cp-agenda-card')].find(item => item.textContent.includes('E2E截止任务'))
    const button = card?.querySelector('.cp-task-mark')
    button?.click()
    return Boolean(button)
  })()`)
  await sleep(600)
  const taskStatus = await cdp.evaluate(`window.electronAPI.getAllTasks().then(tasks => tasks.find(task => task.name === 'E2E截止任务')?.status)`)
  check('日程卡可直接完成任务', completedInline && taskStatus === '已完成', taskStatus)
  await cdp.evaluate(`[...document.querySelectorAll('.cp-agenda-card')].find(item => item.textContent.includes('E2E截止任务'))?.querySelector('.cp-task-mark')?.click()`)
  await sleep(500)

  await cdp.evaluate(`[...document.querySelectorAll('.cp-agenda-switch button')].find(item => item.textContent === '总览').click()`)
  await sleep(250)
  check('总览视图显示未来日程', await cdp.evaluate(`!!document.querySelector('.cp-overview-group')`))
  await cdp.evaluate(`[...document.querySelectorAll('.cp-agenda-switch button')].find(item => item.textContent === '日').click()`)
  await sleep(200)

  await cdp.evaluate(`(() => {
    const cell = [...document.querySelectorAll('.cp-day')].find(item => (item.getAttribute('aria-label') || '').startsWith('2026-11-09'))
    cell?.click()
  })()`)
  await sleep(250)
  await cdp.evaluate(`(() => {
    const cell = [...document.querySelectorAll('.cp-day')].find(item => (item.getAttribute('aria-label') || '').startsWith('2026-11-09'))
    const rect = cell.getBoundingClientRect()
    cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + 20 }))
  })()`)
  check('新建日程对话框打开', await waitFor(cdp, `!!document.querySelector('dialog.cp-composer[open]')`))
  if (process.env.BM_CALENDAR_SHOTS) {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(projectRoot, 'work', 'calendar-pro-e2e-popover.png'), Buffer.from(shot.data, 'base64'))
  }
  await cdp.evaluate(`(() => {
    const input = document.querySelector('.cp-composer .cp-title-input')
    input.value = 'E2E新建日程'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector('.cp-composer .cp-primary').click()
  })()`)
  await sleep(700)
  const created = await cdp.evaluate(`window.electronAPI.searchCalendarEvents('E2E新建日程').then(items => items[0])`)
  check('对话框创建日程成功', created?.title === 'E2E新建日程', created)
  check('新建日程保存后关闭', await waitFor(cdp, `!document.querySelector('dialog.cp-composer[open]')`))

  const openedCreated = await cdp.evaluate(`(() => {
    const card = [...document.querySelectorAll('.cp-agenda-card, .cp-timeline-event')].find(item => item.textContent.includes('E2E新建日程'))
    card?.click()
    return Boolean(card)
  })()`)
  check('点击时间轴日程打开编辑器', openedCreated && await waitFor(cdp, `!!document.querySelector('dialog.cp-composer[open]')`))
  await cdp.evaluate(`(() => {
    const input = document.querySelector('.cp-composer .cp-title-input')
    input.value = 'E2E编辑日程'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector('.cp-composer .cp-primary').click()
  })()`)
  await sleep(700)
  const edited = await cdp.evaluate(`window.electronAPI.searchCalendarEvents('E2E编辑日程').then(items => items[0])`)
  check('编辑复用原日程 ID', edited?.id === created?.id && edited?.title === 'E2E编辑日程', { created, edited })

  const openedEdited = await cdp.evaluate(`(() => {
    const card = [...document.querySelectorAll('.cp-agenda-card, .cp-timeline-event')].find(item => item.textContent.includes('E2E编辑日程'))
    card?.click()
    return Boolean(card)
  })()`)
  check('点击编辑后日程可再次打开', openedEdited && await waitFor(cdp, `!!document.querySelector('dialog.cp-composer[open]')`))
  await cdp.evaluate(`document.querySelector('.cp-composer .cp-delete')?.click()`)
  const undone = await waitFor(cdp, `!!document.querySelector('.undo-toast-action')`)
  check('删除后出现撤回入口', undone === true)
  await cdp.evaluate(`document.querySelector('.undo-toast-action')?.click()`)
  await sleep(600)
  const restored = await cdp.evaluate(`window.electronAPI.searchCalendarEvents('E2E编辑日程').then(items => items.length)`)
  check('撤回恢复日程', restored === 1, restored)

  await cdp.evaluate(`(() => {
    const cell = [...document.querySelectorAll('.cp-day')].find(item => (item.getAttribute('aria-label') || '').startsWith('2026-11-09'))
    cell?.click()
  })()`)
  await sleep(250)
  await cdp.evaluate(`(() => {
    const cell = [...document.querySelectorAll('.cp-day')].find(item => (item.getAttribute('aria-label') || '').startsWith('2026-11-09'))
    const rect = cell.getBoundingClientRect()
    cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + 20 }))
  })()`)
  check('每周新建日程对话框打开', await waitFor(cdp, `!!document.querySelector('dialog.cp-composer[open]')`))
  await cdp.evaluate(`(() => {
    const input = document.querySelector('.cp-composer .cp-title-input')
    input.value = 'E2E每周UI'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const select = [...document.querySelectorAll('.cp-composer select')].find(item => [...item.options].some(option => option.value === 'weekly'))
    select.value = 'weekly'
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await sleep(100)
  const weeklyDefaults = await cdp.evaluate(`({
    days: [...document.querySelectorAll('.cp-weekdays input:checked')].map(item => Number(item.value)),
    hint: document.querySelector('.cp-recurrence-hint')?.textContent || ''
  })`)
  check('每周重复默认选中开始日', weeklyDefaults.days.includes(1) && weeklyDefaults.hint.includes('周一'), weeklyDefaults)
  await cdp.evaluate(`(() => {
    const dates = [...document.querySelectorAll('.cp-composer input[type=date]')]
    dates[0].value = '2026-11-11'
    dates[0].dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(100)
  const weeklyChanged = await cdp.evaluate(`({
    days: [...document.querySelectorAll('.cp-weekdays input:checked')].map(item => Number(item.value)),
    hint: document.querySelector('.cp-recurrence-hint')?.textContent || ''
  })`)
  check('修改开始日期后每周重复同步星期', weeklyChanged.days.join(',') === '3' && weeklyChanged.hint.includes('周三'), weeklyChanged)
  await cdp.evaluate(`document.querySelector('.cp-composer .cp-primary').click()`)
  await sleep(700)
  const weeklySaved = await cdp.evaluate(`window.electronAPI.getCalendarData('2026-11-01', '2026-12-31').then(data => data.events.find(item => item.title === 'E2E每周UI'))`)
  check('每周固定时间重复保存正确', weeklySaved?.recurrence_type === 'weekly' && weeklySaved?.recurrence_value === '3' && weeklySaved?.start_time === '09:00' && weeklySaved?.end_time === '10:00' && weeklySaved?.end_date === weeklySaved?.start_date, weeklySaved)

  await cdp.evaluate(`(async () => {
    const data = await window.electronAPI.getCalendarData('2026-11-01', '2026-12-31')
    const classCalendar = data.calendars.find(item => item.name === '课程')
    return window.electronAPI.createCalendarEvent({
      calendar_id: classCalendar.id, title: 'E2E重复系列', kind: 'class',
      start_date: '2026-11-09', end_date: '2026-11-09', start_time: '08:00', end_time: '09:00',
      recurrence_type: 'weekly', recurrence_value: '1', recurrence_end_date: '2026-12-07'
    })
  })()`)
  await cdp.evaluate(`(() => {
    const day = [...document.querySelectorAll('.cp-day')].find(item => (item.getAttribute('aria-label') || '').startsWith('2026-11-16'))
    day?.click()
    return Boolean(day)
  })()`)
  await sleep(600)
  const openedSeries = await cdp.evaluate(`(() => {
    const card = [...document.querySelectorAll('.cp-agenda-card, .cp-timeline-event')].find(item => item.textContent.includes('E2E重复系列'))
    card?.click()
    return Boolean(card)
  })()`)
  check('重复日程可打开', openedSeries && await waitFor(cdp, `!!document.querySelector('dialog.cp-composer[open]')`))
  await cdp.evaluate(`(() => {
    const input = document.querySelector('.cp-composer .cp-title-input')
    input.value = 'E2E重复系列改'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const select = [...document.querySelectorAll('.cp-composer select')].find(item => [...item.options].some(option => option.value === 'all'))
    select.value = 'all'
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await sleep(100)
  const seriesForm = await cdp.evaluate(`({ startDate: document.querySelector('.cp-composer input[type=date]')?.value })`)
  check('整个系列编辑保留系列起始日期', seriesForm?.startDate === '2026-11-09', seriesForm)
  await cdp.evaluate(`document.querySelector('.cp-composer .cp-primary').click()`)
  await sleep(700)
  const seriesAfter = await cdp.evaluate(`window.electronAPI.getCalendarData('2026-11-01', '2026-12-31').then(data => data.events.find(item => item.title === 'E2E重复系列改'))`)
  check('整个系列保存后系列起点未漂移', seriesAfter?.start_date === '2026-11-09' && seriesAfter?.recurrence_end_date === '2026-12-07', seriesAfter)
  await cdp.evaluate(`(() => {
    const day = [...document.querySelectorAll('.cp-day')].find(item => (item.getAttribute('aria-label') || '').startsWith('2026-11-09'))
    day?.click()
    return Boolean(day)
  })()`)
  await sleep(600)
  check('整个系列编辑后历史日程仍显示', await cdp.evaluate(`document.querySelector('.cp-agenda')?.innerText.includes('E2E重复系列改')`) === true)

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 760, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(250)
  const narrow = await cdp.evaluate(`({
    page: !!document.querySelector('.calendar-pro-page'),
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    agenda: !!document.querySelector('.cp-agenda')
  })`)
  check('窄窗口保持月历与日程可用', narrow?.page && narrow.agenda && !narrow.overflow, narrow)
  await cdp.send('Emulation.clearDeviceMetricsOverride', {})

  await cdp.evaluate(`location.hash = '#/'; true`)
  check('首页加载', await waitFor(cdp, `!!document.querySelector('.dashboard-page')`))
  const home = await cdp.evaluate(`({
    stats: document.querySelectorAll('.bm-stat-card').length,
    heatmap: !!document.querySelector('.heatmap'),
    trend: !!document.querySelector('.completion-trend-chart'),
    status: !!document.querySelector('.task-status-chart'),
    priority: !!document.querySelector('.priority-distribution'),
    timeline: !!document.querySelector('.bm-timeline'),
    quick: document.querySelector('.dashboard-page')?.innerText.includes('快速操作'),
    hints: document.querySelector('.dashboard-page')?.innerText.includes('周一至今'),
    completionRate: document.querySelector('.status-total')?.textContent.includes('%'),
    workCard: !!document.querySelector('.work-clock-card'),
    workTrend: !!document.querySelector('.work-trend')
  })`)
  check('首页保留统计卡与热力图', home?.stats === 6 && home.heatmap === true && home.trend === false && home.status === false && home.priority === false, home)
  check('首页指标口径显示正确', home?.hints === true, home)
  check('首页旧低频区块未回归', home?.timeline === false && home.quick === false, home)
  check('首页显示打卡卡片和近14天趋势', home?.workCard === true && home?.workTrend === true, home)
  const workCheckInClicked = await cdp.evaluate(`(() => {
    const button = [...document.querySelectorAll('.work-clock-actions button')].find(item => item.textContent.trim() === '上班打卡')
    button?.click()
    return Boolean(button)
  })()`)
  await sleep(800)
  const workRow = await cdp.evaluate(`window.electronAPI.getWorkAttendanceRange(${JSON.stringify(seeded.today)}, ${JSON.stringify(seeded.today)})`)
  check('首页上班打卡写入数据库', workCheckInClicked && workRow.length === 1 && Boolean(workRow[0].check_in_at), workRow)
  await cdp.evaluate(`[...document.querySelectorAll('.work-link')].find(item => item.textContent.includes('查看本月'))?.click()`)
  check('打卡记录抽屉打开', await waitFor(cdp, `!!document.querySelector('dialog.work-drawer[open]')`))
  await sleep(600)
  const heatCells = await cdp.evaluate(`document.querySelectorAll('.work-heatmap-day').length`)
  check('月度热力图渲染 42 格', heatCells === 42, heatCells)
  const workEditorClicked = await cdp.evaluate(`(() => { const cell = document.querySelector('.work-heatmap-day.is-today'); cell?.click(); return Boolean(cell) })()`)
  await sleep(250)
  check('点击日期打开补卡编辑', workEditorClicked && await cdp.evaluate(`!!document.querySelector('.work-editor')`))
  await cdp.evaluate(`document.querySelector('.work-drawer-close')?.click()`)
  await sleep(300)
  check('无渲染进程异常', cdp.runtimeErrors.length === 0, cdp.runtimeErrors.slice(0, 3))
} catch (error) {
  check('E2E 执行', false, error.message)
} finally {
  cdp.close()
  child.kill('SIGTERM')
  await sleep(800)
  try { fs.rmSync(profileDir, { recursive: true, force: true }) } catch {}
}

const failed = checks.filter(item => !item.ok)
console.log(failed.length ? `\n${failed.length} check(s) failed` : '\nAll checks passed')
process.exit(failed.length ? 1 : 0)
