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
const shotDir = path.join(projectRoot, 'work', 'cdp-shots')
fs.mkdirSync(shotDir, { recursive: true })

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
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-reminders-'))
  const port = 9800 + Math.floor(Math.random() * 180)
  const child = spawn(electronBin, ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout.on('data', () => {})
  child.stderr.on('data', () => {})
  let targets = null
  for (let i = 0; i < 80; i += 1) {
    try {
      targets = await httpJson(port, '/json/list')
      if (targets.some(target => target.type === 'page' && target.url.includes('index.html'))) break
    } catch {}
    await sleep(400)
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
    if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
      runtimeErrors.push((message.params.args || []).map(arg => arg.value ?? arg.description).join(' '))
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
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        reject(new Error(`CDP timeout: ${method}`))
      }
    }, 30000)
  })
  return {
    runtimeErrors,
    send,
    evaluate: async expression => {
      const result = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true
      })
      if (result?.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || 'eval failed')
      }
      return result?.result?.value
    },
    screenshot: async name => {
      const result = await send('Page.captureScreenshot', { format: 'png' })
      const file = path.join(shotDir, `${name}.png`)
      fs.writeFileSync(file, Buffer.from(result.data, 'base64'))
      return file
    },
    close: () => ws.close()
  }
}

async function waitFor(cdp, expression, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      if (await cdp.evaluate(expression)) return true
    } catch {}
    await sleep(250)
  }
  return false
}

const { child, profileDir, page } = await startApp()
const cdp = await connectCdp(page)
const shots = []

try {
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  check('应用加载', await waitFor(cdp, `!!document.querySelector('.bm-page')`, 120))

  const seeded = await cdp.evaluate(`(async () => {
    const pad = value => String(value).padStart(2, '0')
    const key = date => date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
    const add = (date, days) => { const next = new Date(date); next.setDate(next.getDate() + days); return next }
    const today = new Date()
    const todayKey = key(today)
    const lists = await window.electronAPI.getReminderLists()
    const inbox = lists[0]
    const work = await window.electronAPI.createReminderList({ name: '工作', color: 'purple', icon: '📚', icon_type: 'emoji', kind: 'standard' })
    const section = await window.electronAPI.createReminderSection(inbox.id, { name: '分区 A' })
    const create = payload => window.electronAPI.createReminder(payload)
    await create({ title: '今日全天', list_id: inbox.id, date: todayKey })
    await create({ title: '逾期事项', list_id: inbox.id, date: key(add(today, -2)), due_time: '10:00' })
    await create({ title: '上午事项', list_id: inbox.id, date: todayKey, due_time: '09:00' })
    await create({ title: '下午事项', list_id: inbox.id, date: todayKey, due_time: '15:00', priority: '高', is_flagged: 1, notes: '备注', url: 'https://example.test', tags: '工作,重要' })
    await create({ title: '晚上事项', list_id: inbox.id, date: todayKey, due_time: '20:00' })
    await create({ title: '明天事项', list_id: work.id, date: key(add(today, 1)) })
    await create({ title: '周五事项', list_id: work.id, date: key(add(today, 3)) })
    await create({ title: '本月其他', list_id: work.id, date: key(add(today, 10)) })
    await create({ title: '无日期事项', list_id: work.id })
    await create({ title: '分区内事项', list_id: inbox.id, section_id: section.id, date: todayKey, due_time: '11:00' })
    await create({ title: '已完成事项', list_id: inbox.id, date: todayKey, is_completed: 1 })
    await create({ title: '昨天完成', list_id: work.id, date: key(add(today, -1)), is_completed: 1, completed_at: add(today, -1).toISOString() })
    return { todayKey, inbox: inbox.id, work: work.id, section: section.id }
  })()`)
  check('隔离数据创建成功', Boolean(seeded?.todayKey), seeded)

  await cdp.evaluate(`location.hash = '#/reminders'; true`)
  check('提醒页面加载', await waitFor(cdp, `!!document.querySelector('.rm-shell')`))
  await sleep(900)

  const smartTiles = await cdp.evaluate(`[...document.querySelectorAll('.rm-smart-tile')].map(item => ({
    name: item.querySelector('.rm-tile-name')?.textContent.trim(),
    count: item.querySelector('.rm-tile-count')?.textContent.trim() || ''
  }))`)
  check('6 个智能列表磁贴', smartTiles?.length === 6, smartTiles)
  check('今天磁贴计数', smartTiles?.find(item => item.name === '今天')?.count === '6', smartTiles)

  const sidebar = await cdp.evaluate(`({
    title: document.querySelector('.rm-list-title')?.textContent.trim(),
    lists: [...document.querySelectorAll('.rm-list-row .rm-list-name')].map(item => item.textContent.trim()),
    groups: [...document.querySelectorAll('.rm-group-header .rm-group-title')].map(item => item.textContent.trim()),
    rows: [...document.querySelectorAll('.rm-row .rm-row-title')].map(item => item.textContent.trim()),
    completed: document.querySelector('.rm-completed-line')?.textContent.replace(/\\s+/g, ' ').trim()
  })`)
  check('默认进入今天视图', sidebar?.title === '今天', sidebar)
  check('侧边栏显示两个列表', sidebar?.lists.includes('提醒事项') && sidebar?.lists.includes('工作'), sidebar?.lists)
  const sidebarCounts = await cdp.evaluate(`[...document.querySelectorAll('.rm-list-row')].map(item => ({
    name: item.querySelector('.rm-list-name')?.textContent.trim(),
    count: item.querySelector('.rm-list-count')?.textContent.trim()
  }))`)
  check('列表未完成计数', sidebarCounts?.find(item => item.name === '提醒事项')?.count === '6' && sidebarCounts?.find(item => item.name === '工作')?.count === '4', sidebarCounts)
  check('今天分组含逾期/上午/下午/今晚', ['逾期', '上午', '下午', '今晚'].every(label => sidebar?.groups.includes(label)), sidebar?.groups)
  check('今天行包含下午事项', sidebar?.rows.includes('下午事项'), sidebar?.rows)
  const tagChips = await cdp.evaluate(`[...document.querySelectorAll('.rm-tag-chip')].map(item => item.textContent.trim())`)
  check(
    '侧边栏标签筛选',
    tagChips.includes('所有标签') && tagChips.includes('#工作') && tagChips.includes('#重要'),
    tagChips
  )
  await cdp.evaluate(`[...document.querySelectorAll('.rm-tag-chip')].find(item => item.textContent.trim() === '#工作')?.click(); true`)
  await sleep(500)
  const taggedRows = await cdp.evaluate(`[...document.querySelectorAll('.rm-row-title')].map(item => item.textContent.trim())`)
  check('标签筛选生效', taggedRows.length === 1 && taggedRows[0] === '下午事项', taggedRows)
  await cdp.evaluate(`[...document.querySelectorAll('.rm-tag-chip')].find(item => item.textContent.trim() === '所有标签')?.click(); true`)
  await sleep(500)
  shots.push(await cdp.screenshot('reminders-today'))

  await cdp.evaluate(`[...document.querySelectorAll('.rm-smart-tile')].find(item => item.textContent.includes('计划'))?.click(); true`)
  await waitFor(cdp, `document.querySelector('.rm-list-title')?.textContent.trim() === '计划'`)
  await sleep(350)
  const scheduled = await cdp.evaluate(`[...document.querySelectorAll('.rm-group-header .rm-group-title')].map(item => item.textContent.trim())`)
  check('计划视图日期分组', scheduled.includes('逾期') && scheduled.includes('今天') && scheduled.includes('明天') && scheduled.includes('后天') && scheduled.some(item => item.includes('其他时间')), scheduled)
  shots.push(await cdp.screenshot('reminders-scheduled'))

  await cdp.evaluate(`[...document.querySelectorAll('.rm-smart-tile')].find(item => item.textContent.includes('全部'))?.click(); true`)
  await waitFor(cdp, `document.querySelector('.rm-list-title')?.textContent.trim() === '全部'`)
  await sleep(350)
  const allGroups = await cdp.evaluate(`[...document.querySelectorAll('.rm-group-header .rm-group-title')].map(item => item.textContent.trim())`)
  check('全部视图按列表分组', allGroups.includes('提醒事项') && allGroups.includes('工作'), allGroups)

  await cdp.evaluate(`[...document.querySelectorAll('.rm-smart-tile')].find(item => item.textContent.includes('旗标'))?.click(); true`)
  await waitFor(cdp, `document.querySelector('.rm-list-title')?.textContent.trim() === '旗标'`)
  await sleep(300)
  const flaggedRows = await cdp.evaluate(`[...document.querySelectorAll('.rm-row .rm-row-title')].map(item => item.textContent.trim())`)
  check('旗标视图', flaggedRows.includes('下午事项'), flaggedRows)

  await cdp.evaluate(`[...document.querySelectorAll('.rm-smart-tile')].find(item => item.textContent.includes('紧急'))?.click(); true`)
  await waitFor(cdp, `document.querySelector('.rm-list-title')?.textContent.trim() === '紧急'`)
  await sleep(300)
  const urgent = await cdp.evaluate(`({
    groups: [...document.querySelectorAll('.rm-group-header .rm-group-title')].map(item => item.textContent.trim()),
    rows: [...document.querySelectorAll('.rm-row .rm-row-title')].map(item => item.textContent.trim())
  })`)
  check('紧急视图分组', urgent.groups.includes('逾期') && urgent.groups.includes('高优先级'), urgent)

  await cdp.evaluate(`[...document.querySelectorAll('.rm-smart-tile')].find(item => item.textContent.includes('完成'))?.click(); true`)
  await waitFor(cdp, `document.querySelector('.rm-list-title')?.textContent.trim() === '完成'`)
  await sleep(350)
  const completed = await cdp.evaluate(`({
    title: document.querySelector('.rm-list-title')?.textContent.trim(),
    count: document.querySelector('.rm-header-count')?.textContent.trim(),
    groups: [...document.querySelectorAll('.rm-group-header .rm-group-title')].map(item => item.textContent.trim()),
    rows: [...document.querySelectorAll('.rm-row .rm-row-title')].map(item => item.textContent.trim())
  })`)
  check('完成视图', completed?.title === '完成' && completed?.rows.includes('已完成事项'), completed)
  shots.push(await cdp.screenshot('reminders-completed'))

  await cdp.evaluate(`[...document.querySelectorAll('.rm-smart-tile')].find(item => item.textContent.includes('今天'))?.click(); true`)
  await waitFor(cdp, `document.querySelector('.rm-list-title')?.textContent.trim() === '今天'`)
  await sleep(300)
  await cdp.evaluate(`(() => {
    const input = document.querySelector('.rm-search input')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, '下午')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(450)
  const searchRows = await cdp.evaluate(`[...document.querySelectorAll('.rm-row .rm-row-title')].map(item => item.textContent.trim())`)
  check('搜索命中一条', searchRows.length === 1 && searchRows[0] === '下午事项', searchRows)
  await cdp.evaluate(`(() => {
    const input = document.querySelector('.rm-search input')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, '')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(250)

  const opened = await cdp.evaluate(`(() => {
    const row = [...document.querySelectorAll('.rm-row')].find(item => item.textContent.includes('下午事项'))
    row?.querySelector('.rm-info')?.click()
    return !!row
  })()`)
  check('详情浮层打开', opened && await waitFor(cdp, `!!document.querySelector('.rm-detail[open]')`))
  const detail = await cdp.evaluate(`({
    title: document.querySelector('.rm-detail-title')?.value,
    hasDate: !!document.querySelector('.rm-detail .rm-date-inputs input[type="date"]'),
    hasRecurrence: !!document.querySelector('.rm-detail select'),
    tagText: document.querySelector('.rm-detail .rm-tags-editor')?.textContent.trim(),
    attachmentButton: !!document.querySelector('.rm-detail .rm-add-attachment')
  })`)
  check('详情字段渲染', detail?.title === '下午事项' && detail?.hasDate && detail?.hasRecurrence, detail)
  const detailMetrics = await cdp.evaluate(`(() => {
    const node = document.querySelector('.rm-detail')
    const rect = node.getBoundingClientRect()
    const style = getComputedStyle(node)
    return {
      top: Math.round(rect.top), bottom: Math.round(rect.bottom), height: Math.round(rect.height),
      scrollHeight: node.scrollHeight, clientHeight: node.clientHeight,
      maxHeight: style.maxHeight, overflowY: style.overflowY, innerHeight: window.innerHeight
    }
  })()`)
  console.log('detail metrics', JSON.stringify(detailMetrics))
  shots.push(await cdp.screenshot('reminders-detail'))

  await cdp.evaluate(`(() => {
    const input = document.querySelector('.rm-detail-title')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, '下午事项改名')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(700)
  const renamed = await cdp.evaluate(`(async () => {
    const rows = await window.electronAPI.getReminders()
    return rows.find(item => item.title === '下午事项改名')?.title || ''
  })()`)
  check('详情标题自动保存', renamed === '下午事项改名', renamed)

  const subtask = await cdp.evaluate(`(async () => {
    const input = document.querySelector('.rm-detail-sub-add input')
    if (!input) return { ok: false }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, '子任务 A')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 650))
    const reminders = await window.electronAPI.getReminders()
    const target = reminders.find(item => item.title === '下午事项改名')
    const subtasks = target ? await window.electronAPI.getDailySubtasks(target.id) : []
    return { ok: true, count: subtasks.length, title: subtasks[0]?.title }
  })()`)
  check('详情添加子任务', subtask?.ok && subtask?.count === 1 && subtask?.title === '子任务 A', subtask)
  await cdp.evaluate(`document.querySelector('.rm-detail-close')?.click(); true`)
  await sleep(250)

  const toggled = await cdp.evaluate(`(async () => {
    const row = [...document.querySelectorAll('.rm-row')].find(item => item.textContent.includes('上午事项'))
    row?.querySelector('.rm-check')?.click()
    await new Promise(resolve => setTimeout(resolve, 500))
    const rows = await window.electronAPI.getReminders()
    return rows.find(item => item.title === '上午事项')?.is_completed
  })()`)
  check('勾选完成写库', toggled === 1, toggled)

  await cdp.evaluate(`[...document.querySelectorAll('.rm-list-row')].find(item => item.textContent.includes('工作'))?.click(); true`)
  await sleep(450)
  const listTitle = await cdp.evaluate(`document.querySelector('.rm-list-title')?.textContent.trim()`)
  check('切换到工作列表', listTitle === '工作', listTitle)
  const listCursors = await cdp.evaluate(`[...document.querySelectorAll('.rm-row')].map(row => getComputedStyle(row).cursor)`)
  check('列表视图任务可拖动', listCursors.length > 0 && listCursors.every(cursor => cursor === 'grab'), listCursors)
  await cdp.evaluate(`document.querySelector('.rm-add-placeholder')?.click(); true`)
  await sleep(200)
  const addOpened = await waitFor(cdp, `!!document.querySelector('.rm-add-input')`)
  check('行内新建输入框', addOpened)
  const composer = await cdp.evaluate(`({
    note: !!document.querySelector('.rm-compose-note'),
    tags: !!document.querySelector('.rm-compose-tags'),
    date: !!document.querySelector('.rm-compose-pill'),
    icons: document.querySelectorAll('.rm-compose-icon').length,
    info: !!document.querySelector('.rm-compose-info')
  })`)
  check(
    '内联新建可编辑备注/标签/日期/旗标/附件',
    composer.note && composer.tags && composer.date && composer.icons >= 2 && composer.info,
    composer
  )
  await cdp.evaluate(`[...document.querySelectorAll('.rm-compose-icon')].find(button => button.title === '添加标签')?.click(); true`)
  await sleep(300)
  const tagPicker = await cdp.evaluate(`({
    open: !!document.querySelector('.rm-tag-picker'),
    tags: [...document.querySelectorAll('.rm-tag-picker-list button')].map(button => button.textContent.trim())
  })`)
  check('新建标签选择器', tagPicker.open && tagPicker.tags.includes('#工作'), tagPicker)
  await cdp.evaluate(`[...document.querySelectorAll('.rm-tag-picker-list button')].find(button => button.textContent.includes('#工作'))?.click(); true`)
  await sleep(200)
  const tagDraft = await cdp.evaluate(`document.querySelector('.rm-compose-tags')?.value`)
  check('选择标签写入草稿', tagDraft === '工作', tagDraft)
  await cdp.evaluate(`[...document.querySelectorAll('.rm-tag-picker-list button')].find(button => button.textContent.includes('#工作'))?.click(); true`)
  await cdp.evaluate(`document.querySelector('.rm-tag-picker-backdrop')?.click(); true`)
  await sleep(150)
  await cdp.evaluate(`(() => {
    const input = document.querySelector('.rm-add-input')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, '明天下午3点 新提醒 #测试')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
  })()`)
  await sleep(700)
  const added = await cdp.evaluate(`(async () => {
    const rows = await window.electronAPI.getReminders()
    const found = rows.find(item => item.title === '新提醒')
    return found ? { date: found.date, time: found.due_time, tags: found.tags, list: found.list_name } : null
  })()`)
  check('行内自然语言新建', added?.time === '15:00' && added?.tags === '测试' && added?.list === '工作', added)
  shots.push(await cdp.screenshot('reminders-list'))

  const deletedByMenu = await cdp.evaluate(`(async () => {
    const row = [...document.querySelectorAll('.rm-row')].find(item => item.textContent.includes('无日期事项'))
    if (!row) return { ok: false }
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 520, clientY: 420 }))
    await new Promise(resolve => setTimeout(resolve, 250))
    const menu = document.querySelector('.rm-context-menu')
    const menuItems = [...document.querySelectorAll('.rm-context-menu .rm-menu-item')].map(item => item.textContent.trim())
    const deleteItem = [...document.querySelectorAll('.rm-context-menu .rm-menu-item')].find(item => item.textContent.trim() === '删除')
    if (!menu || !deleteItem) return { ok: false, menu: !!menu, deleteItem: !!deleteItem, menuItems }
    const rect = menu.getBoundingClientRect()
    const menuRect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    const sectionItem = [...document.querySelectorAll('.rm-context-menu .has-submenu')].find(item => item.textContent.includes('移动到列表'))
    sectionItem?.dispatchEvent(new MouseEvent('mouseenter'))
    await new Promise(resolve => setTimeout(resolve, 200))
    const submenu = document.querySelector('.rm-submenu')
    const sub = submenu?.getBoundingClientRect()
    const submenuRect = sub ? { left: sub.left, top: sub.top, width: sub.width, height: sub.height } : null
    const submenuOutside = Boolean(sub) && (sub.left >= rect.right - 12 || sub.right <= rect.left + 12)
    deleteItem.click()
    await new Promise(resolve => setTimeout(resolve, 700))
    const rows = await window.electronAPI.getRecentlyDeletedReminders(20)
    return { ok: true, deleted: rows.some(item => item.title === '无日期事项'), count: rows.length, menuItems, menuRect, submenuRect, submenuOutside }
  })()`)
  check('右键删除进入最近删除', deletedByMenu?.ok && deletedByMenu?.deleted, deletedByMenu)
  check(
    '右键菜单贴近鼠标',
    Boolean(deletedByMenu?.menuRect)
      && Math.abs(deletedByMenu.menuRect.left - 520) <= 2
      && deletedByMenu.menuRect.top <= 421
      && deletedByMenu.menuRect.top >= 340,
    deletedByMenu?.menuRect
  )
  check('子菜单向右展开且不被裁剪', deletedByMenu?.submenuOutside === true, deletedByMenu?.submenuRect)
  const requiredContextItems = ['提醒我', '添加子任务', '添加附件', '上移', '下移']
  check('右键菜单完整', requiredContextItems.every(item => deletedByMenu?.menuItems?.includes(item)), deletedByMenu?.menuItems)
  const recentCount = await cdp.evaluate(`document.querySelector('.rm-recent-row .rm-list-count')?.textContent.trim()`)
  check('边栏最近删除计数', recentCount === '1', recentCount)

  await cdp.evaluate(`document.querySelector('.rm-recent-row')?.click(); true`)
  await sleep(450)
  const recentView = await cdp.evaluate(`({
    title: document.querySelector('.rm-list-title')?.textContent.trim(),
    rows: [...document.querySelectorAll('.rm-row .rm-row-title')].map(item => item.textContent.trim()),
    actions: [...document.querySelectorAll('.rm-row .rm-text-action')].map(item => item.textContent.trim())
  })`)
  check('最近删除视图', recentView?.title === '最近删除' && recentView?.rows.includes('无日期事项') && recentView?.actions.includes('恢复'), recentView)
  await cdp.evaluate(`[...document.querySelectorAll('.rm-row')].find(item => item.textContent.includes('无日期事项'))?.querySelector('.rm-text-action')?.click(); true`)
  await sleep(600)
  const restored = await cdp.evaluate(`(async () => {
    const rows = await window.electronAPI.getReminders()
    return rows.some(item => item.title === '无日期事项' && !item.is_completed)
  })()`)
  check('最近删除恢复', restored === true, restored)
  await cdp.evaluate(`[...document.querySelectorAll('.rm-list-row')].find(item => item.textContent.includes('工作'))?.click(); true`)
  await sleep(350)
  const restoredRow = await cdp.evaluate(`[...document.querySelectorAll('.rm-row .rm-row-title')].map(item => item.textContent.trim()).includes('无日期事项')`)
  check('恢复后回到工作列表', restoredRow === true, restoredRow)

  const repeatPrepared = await cdp.evaluate(`(async () => {
    const row = [...document.querySelectorAll('.rm-row')].find(item => item.textContent.includes('新提醒'))
    row?.querySelector('.rm-info')?.click()
    await new Promise(resolve => setTimeout(resolve, 450))
    const field = [...document.querySelectorAll('.rm-detail .rm-inline-field')].find(item => item.textContent.includes('重复'))
    const select = field?.querySelector('select')
    if (!select) return { ok: false }
    select.value = 'daily'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 550))
    document.querySelector('.rm-detail-close')?.click()
    await new Promise(resolve => setTimeout(resolve, 300))
    const rows = await window.electronAPI.getReminders()
    return { ok: true, recurrence: rows.find(item => item.title === '新提醒')?.recurrence_type }
  })()`)
  check('详情设置重复', repeatPrepared?.ok && repeatPrepared?.recurrence === 'daily', repeatPrepared)

  const repeated = await cdp.evaluate(`(async () => {
    const row = [...document.querySelectorAll('.rm-row')].find(item => item.textContent.includes('新提醒'))
    row?.querySelector('.rm-check')?.click()
    await new Promise(resolve => setTimeout(resolve, 900))
    const rows = await window.electronAPI.getReminders()
    const instances = rows.filter(item => item.title === '新提醒').sort((a, b) => String(a.date).localeCompare(String(b.date)))
    return instances.map(item => ({ date: item.date, completed: item.is_completed, source: item.recurrence_source_id }))
  })()`)
  const expectedNextDate = (() => {
    const base = repeated?.[0]?.date
    if (!base) return null
    const next = new Date(`${base}T00:00:00`)
    next.setDate(next.getDate() + 1)
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`
  })()
  check(
    '完成后生成下一次',
    repeated?.length === 2 && repeated[1].date === expectedNextDate && repeated[1].completed === 0,
    repeated
  )

  await cdp.evaluate(`[...document.querySelectorAll('.rm-list-row')].find(item => item.textContent.includes('提醒事项'))?.click(); true`)
  await sleep(400)
  const sectionOpened = await cdp.evaluate(`(() => {
    const header = document.querySelector('.rm-group-header-section')
    const more = header?.querySelector('.rm-section-more')
    if (!more) return false
    more.click()
    return true
  })()`)
  await sleep(250)
  const sectionMenu = await cdp.evaluate(`[...document.querySelectorAll('.rm-context-menu .rm-menu-item')].map(item => item.textContent.trim())`)
  check('分区菜单', sectionOpened && sectionMenu.includes('重命名分区') && sectionMenu.includes('删除分区'), sectionMenu)
  await cdp.evaluate(`[...document.querySelectorAll('.rm-context-menu .rm-menu-item')].find(item => item.textContent.trim() === '重命名分区')?.click(); true`)
  await sleep(300)
  const sectionDebug = await cdp.evaluate(`({
    hasInput: !!document.querySelector('.rm-section-input'),
    headers: [...document.querySelectorAll('.rm-group-header')].map(node => ({ text: node.textContent.trim(), cls: node.className })),
    menuOpen: !!document.querySelector('.rm-context-menu'),
    editing: !!document.querySelector('.rm-section-header.editing')
  })`)
  console.log('section debug', JSON.stringify(sectionDebug))
  const renamedSection = await cdp.evaluate(`(async () => {
    const input = document.querySelector('.rm-section-input')
    if (!input) return { ok: false }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, '分区 B')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 650))
    const sections = await window.electronAPI.getReminderSections()
    return { ok: true, names: sections.map(item => item.name) }
  })()`)
  check('分区重命名', renamedSection?.ok && renamedSection?.names.includes('分区 B'), renamedSection)

  await cdp.evaluate(`document.querySelector('[title="添加列表"]')?.click(); true`)
  await sleep(300)
  const editorOpen = await waitFor(cdp, `!!document.querySelector('.rm-list-editor[open]')`)
  check('列表编辑器打开', editorOpen)
  check('列表编辑器不再有类型选择', (await cdp.evaluate(`!!document.querySelector('.rm-list-kind')`)) === false)
  const editorMetrics = await cdp.evaluate(`(() => {
    const node = document.querySelector('.rm-list-editor')
    const rect = node.getBoundingClientRect()
    const style = getComputedStyle(node)
    return {
      top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height),
      position: style.position, margin: style.margin, inset: style.inset, display: style.display,
      open: node.open, modal: node.matches(':modal'), innerWidth: window.innerWidth, innerHeight: window.innerHeight
    }
  })()`)
  console.log('editor metrics', JSON.stringify(editorMetrics))
  shots.push(await cdp.screenshot('reminders-list-editor-open'))
  await cdp.evaluate(`document.querySelectorAll('.rm-icon-choice')[1]?.click(); true`)
  await sleep(300)
  const iconPicker = await cdp.evaluate(`({
    open: !!document.querySelector('.rm-icon-picker'),
    symbols: document.querySelectorAll('.rm-symbol').length,
    rect: (() => { const node = document.querySelector('.rm-icon-picker'); if (!node) return null; const r = node.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) } })()
  })`)
  check('图标选择面板', iconPicker.open && iconPicker.symbols > 50, iconPicker)
  shots.push(await cdp.screenshot('reminders-list-editor-picker'))
  await cdp.evaluate(`document.querySelectorAll('.rm-symbol')[12]?.click(); true`)
  await sleep(300)
  check('选择图标后关闭面板', (await cdp.evaluate(`!!document.querySelector('.rm-icon-picker')`)) === false)
  await cdp.evaluate(`(() => {
    const input = document.querySelector('.rm-list-name-input')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, '生活')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await cdp.evaluate(`[...document.querySelectorAll('.rm-list-editor-footer button')].find(item => item.textContent.trim() === '好')?.click(); true`)
  await sleep(500)
  const listCreated = await cdp.evaluate(`[...document.querySelectorAll('.rm-list-row .rm-list-name')].map(item => item.textContent.trim())`)
  check('新建列表', listCreated.includes('生活'), listCreated)
  const faIcons = await cdp.evaluate(`[...document.querySelectorAll('.rm-list-row .rm-list-fa')].map(node => node.className)`)
  check('列表符号图标保存', faIcons.length > 0, faIcons)

  await cdp.evaluate(`[...document.querySelectorAll('.rm-smart-tile')].find(item => item.textContent.includes('完成'))?.click(); true`)
  await waitFor(cdp, `document.querySelector('.rm-list-title')?.textContent.trim() === '完成'`)
  await sleep(300)
  const beforeClear = await cdp.evaluate(`(async () => (await window.electronAPI.getReminders()).filter(item => item.is_completed).length)()`)
  await cdp.evaluate(`document.querySelector('.rm-clear-button')?.click(); true`)
  await sleep(250)
  const clearOptions = await cdp.evaluate(`[...document.querySelectorAll('.rm-clear-menu button')].map(item => item.textContent.trim())`)
  check(
    '清除菜单按完成时间分档',
    ['超过 1 个月', '超过 6 个月', '超过 1 年', '所有完成项目'].every(label => clearOptions.includes(label)),
    clearOptions
  )
  await cdp.evaluate(`[...document.querySelectorAll('.rm-clear-menu button')].find(item => item.textContent.trim() === '所有完成项目')?.click(); true`)
  await sleep(900)
  const afterClear = await cdp.evaluate(`(async () => (await window.electronAPI.getReminders()).filter(item => item.is_completed).length)()`)
  const undoVisible = await cdp.evaluate(`!!document.querySelector('.undo-toast-action')`)
  check('清除完成项目', beforeClear > 0 && afterClear === 0, { beforeClear, afterClear })
  check('清除后可撤回', undoVisible)
  await cdp.evaluate(`document.querySelector('.undo-toast-action')?.click(); true`)
  await sleep(900)
  const afterUndo = await cdp.evaluate(`(async () => (await window.electronAPI.getReminders()).filter(item => item.is_completed).length)()`)
  check('撤回清除', afterUndo === beforeClear, { beforeClear, afterUndo })

  await cdp.evaluate(`[...document.querySelectorAll('.rm-list-row')].find(item => item.textContent.includes('工作'))?.click(); true`)
  await sleep(350)
  await cdp.evaluate(`document.querySelector('[title="显示选项"]')?.click(); true`)
  await sleep(250)
  const optionsOpen = await waitFor(cdp, `!!document.querySelector('.rm-options')`)
  check('选项菜单打开', optionsOpen)
  await cdp.evaluate(`[...document.querySelectorAll('.rm-option-item')].find(item => item.textContent.includes('截止日期'))?.click(); true`)
  await sleep(350)
  const sortSetting = await cdp.evaluate(`localStorage.getItem('bongmaster:reminders:sort')`)
  const optionsClosed = await cdp.evaluate(`!document.querySelector('.rm-options')`)
  check('排序选项生效并关闭菜单', sortSetting === 'due' && optionsClosed, { sortSetting, optionsClosed })

  await cdp.evaluate(`location.hash = '#/calendar'; true`)
  await waitFor(cdp, `!!document.querySelector('.calendar-pro-page')`)
  await waitFor(cdp, `!!document.querySelector('.cp-agenda')`)
  await sleep(900)
  const calendarLinked = await cdp.evaluate(`(() => {
    const cards = [...document.querySelectorAll('.cp-agenda-card.is-linked-reminder')]
    const target = cards.find(card => card.textContent.includes('今日全天'))
    if (!target) return { ok: false, cards: cards.map(card => card.textContent.trim()).slice(0, 6) }
    target.click()
    return { ok: true, count: cards.length }
  })()`)
  const linkedOpened = await waitFor(cdp, `location.hash.includes('/reminders') && !!document.querySelector('.rm-detail[open]')`)
  const linkedDetail = await cdp.evaluate(`document.querySelector('.rm-detail-title')?.value || ''`)
  check('日历联动打开提醒详情', calendarLinked?.ok && linkedOpened && linkedDetail === '今日全天', { calendarLinked, linkedOpened, linkedDetail })

  const errors = cdp.runtimeErrors.filter(error => !/ResizeObserver|favicon/i.test(error))
  check('无运行时异常', errors.length === 0, errors.slice(0, 4))
} finally {
  cdp.close()
  child.kill()
  await sleep(500)
  try { fs.rmSync(profileDir, { recursive: true, force: true }) } catch {}
}

const failed = checks.filter(item => !item.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
console.log('screenshots:', shots.join(', '))
if (failed.length) process.exit(1)
