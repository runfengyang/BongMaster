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
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-taskboard-'))
  const port = 9900 + Math.floor(Math.random() * 180)
  const child = spawn(electronBin, ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BM_E2E_HIDDEN: '1' }
  })
  child.stdout.on('data', () => {})
  child.stderr.on('data', () => {})
  let targets = null
  for (let i = 0; i < 100; i += 1) {
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

async function waitFor(cdp, expression, attempts = 80) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      if (await cdp.evaluate(expression)) return true
    } catch {}
    await sleep(250)
  }
  return false
}

const { child, page } = await startApp()
const cdp = await connectCdp(page)
const shots = []

const clickScope = async label => {
  const target = JSON.stringify(label)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const clicked = await cdp.evaluate(`(() => {
      const chip = [...document.querySelectorAll('.tb-scope-chip')].find(item => item.textContent.includes(${target}))
      if (!chip) return false
      chip.click()
      return true
    })()`)
    if (!clicked) return false
    await sleep(400)
    const active = await cdp.evaluate(`[...document.querySelectorAll('.tb-scope-chip')].some(item => item.textContent.includes(${target}) && item.classList.contains('active'))`)
    if (active) return true
  }
  return false
}

try {
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  check('应用加载', await waitFor(cdp, `!!document.querySelector('.bm-page')`))

  const seeded = await cdp.evaluate(`(async () => {
    const p1 = await window.electronAPI.createProject({ name: 'Data Risk', status: '进行中', priority: '高' })
    const p2 = await window.electronAPI.createProject({ name: '金融科技课程', status: '进行中', priority: '中' })
    const p3 = await window.electronAPI.createProject({ name: 'JBF 返修', status: '未开始', priority: '高' })
    await window.electronAPI.createProject({ name: '已完成项目', status: '已完成' })
    const create = payload => window.electronAPI.createTask(payload)
    await create({ project_id: p1.id, name: '跟进 Data Risk 指标进展', status: '进行中', priority: '高', due_date: '2026-11-01', assignee: '杨润峰', tags: '论文,数据分析', description: '核对指标口径' })
    await create({ project_id: p1.id, name: '整理数据说明', status: '待办', priority: '中', due_date: '2026-11-10' })
    await create({ project_id: p2.id, name: '第三节备课：树模型', status: '进行中', priority: '中', due_date: '2026-11-14' })
    await create({ project_id: p2.id, name: '课程材料归档', status: '已完成', priority: '低' })
    await create({ project_id: p3.id, name: 'JBF 二轮审稿反馈', status: '待办', priority: '高' })
    return { p1: p1.id, p2: p2.id, p3: p3.id }
  })()`)
  check('隔离数据创建成功', Boolean(seeded?.p1), seeded)

  await cdp.evaluate(`location.hash = '#/tasks'; true`)
  check('任务看板加载', await waitFor(cdp, `!!document.querySelector('.tb-shell')`))
  await sleep(700)

  const initial = await cdp.evaluate(`({
    title: document.querySelector('.tb-toolbar-title')?.textContent.trim(),
    newButton: document.querySelector('.tb-new-button')?.textContent.trim(),
    chips: [...document.querySelectorAll('.tb-scope-chip')].map(item => item.textContent.replace(/\\s+/g, ' ').trim()),
    columns: [...document.querySelectorAll('.tb-column')].map(item => ({
      status: item.dataset.status,
      count: item.querySelector('.tb-col-count')?.textContent.trim(),
      cards: [...item.querySelectorAll('.tb-card-title')].map(title => title.textContent.trim())
    })),
    doneCount: document.querySelector('.tb-done-rail .tb-col-count')?.textContent.trim(),
    doneTitles: [...document.querySelectorAll('.tb-done-row .tb-done-title')].map(item => item.textContent.trim())
  })`)
  check('工具栏标题与新建按钮', initial?.title === '任务看板' && initial?.newButton === '新建任务', initial)
  check(
    '项目范围条只显示进行中/未开始项目',
    initial?.chips?.length === 4
      && initial.chips.some(text => text.includes('Data Risk'))
      && !initial.chips.some(text => text.includes('已完成项目')),
    initial?.chips
  )
  check('双列 + 完成栏', initial?.columns?.length === 2 && initial?.columns[0].status === '待办' && initial?.columns[1].status === '进行中', initial?.columns)
  check('列计数正确', initial?.columns[0].count === '2' && initial?.columns[1].count === '2' && initial?.doneCount === '1', {
    todo: initial?.columns[0].count,
    doing: initial?.columns[1].count,
    done: initial?.doneCount
  })
  check('完成栏显示已完成任务', initial?.doneTitles?.includes('课程材料归档'), initial?.doneTitles)
  shots.push(await cdp.screenshot('taskboard-board'))

  await clickScope('金融科技课程')
  const scopeFiltered = await cdp.evaluate(`(async () => {
    await new Promise(resolve => setTimeout(resolve, 200))
    return {
      doing: [...document.querySelectorAll('.tb-column[data-status="进行中"] .tb-card-title')].map(item => item.textContent.trim()),
      todo: [...document.querySelectorAll('.tb-column[data-status="待办"] .tb-card-title')].map(item => item.textContent.trim()),
      done: [...document.querySelectorAll('.tb-done-row .tb-done-title')].map(item => item.textContent.trim())
    }
  })()`)
  check('项目范围切换生效', scopeFiltered?.doing?.length === 1 && scopeFiltered.doing[0].includes('第三节备课') && scopeFiltered.todo.length === 0 && scopeFiltered.done.includes('课程材料归档'), scopeFiltered)
  await clickScope('全部项目')

  const searched = await cdp.evaluate(`(async () => {
    const input = document.querySelector('.tb-search input')
    if (!input) return { error: 'no-search-input', toolbar: !!document.querySelector('.tb-toolbar') }
    input.value = 'JBF 二轮'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 350))
    return { cards: [...document.querySelectorAll('.tb-card-title')].map(item => item.textContent.trim()) }
  })()`)
  check('搜索过滤任务', searched?.cards?.length === 1 && searched.cards[0].includes('JBF 二轮'), searched)
  await cdp.evaluate(`(() => {
    const input = document.querySelector('.tb-search input')
    if (!input) return false
    input.value = ''
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await sleep(300)

  const filterOpened = await cdp.evaluate(`(async () => {
    document.querySelector('.tb-filter-button')?.click()
    await new Promise(resolve => setTimeout(resolve, 250))
    return {
      open: !!document.querySelector('.tb-filter-popover'),
      labels: [...document.querySelectorAll('.tb-filter-label')].map(item => item.textContent.trim()),
      chips: [...document.querySelectorAll('.tb-filter-popover .tb-chip')].map(item => item.textContent.trim())
    }
  })()`)
  check('筛选弹层打开', filterOpened?.open && filterOpened.labels.includes('优先级') && filterOpened.labels.includes('截止日期'), filterOpened)
  shots.push(await cdp.screenshot('taskboard-filter'))

  const priorityFiltered = await cdp.evaluate(`(async () => {
    [...document.querySelectorAll('.tb-filter-popover .tb-chip')].find(item => item.textContent.trim() === '高')?.click()
    await new Promise(resolve => setTimeout(resolve, 350))
    return {
      cards: [...document.querySelectorAll('.tb-card-title')].map(item => item.textContent.trim()),
      badge: document.querySelector('.tb-filter-badge')?.textContent.trim()
    }
  })()`)
  check('优先级筛选生效', priorityFiltered?.cards?.length === 2 && priorityFiltered.cards.every(title => /Data Risk 指标|JBF 二轮/.test(title)) && priorityFiltered.badge === '1', priorityFiltered)

  await cdp.evaluate(`(async () => {
    document.querySelector('.tb-filter-clear')?.click()
    await new Promise(resolve => setTimeout(resolve, 250))
    document.querySelector('.tb-filter-done')?.click()
    return true
  })()`)
  await sleep(300)
  const filterClosed = await cdp.evaluate(`!document.querySelector('.tb-filter-popover')`)
  const filterBadgeCleared = await cdp.evaluate(`!document.querySelector('.tb-filter-badge')`)
  check('清除筛选并关闭弹层', filterClosed === true && filterBadgeCleared === true, { filterClosed, filterBadgeCleared })

  await clickScope('Data Risk')
  const quickAdded = await cdp.evaluate(`(async () => {
    const column = document.querySelector('.tb-column[data-status="待办"]')
    if (!column) {
      return {
        error: 'no-column',
        view: document.querySelector('.tb-view-toggle button.active')?.textContent.trim(),
        board: Boolean(document.querySelector('.tb-board')),
        boardHidden: document.querySelector('.tb-board')?.offsetParent === null
      }
    }
    column.querySelector('.tb-col-add')?.click()
    await new Promise(resolve => setTimeout(resolve, 350))
    const input = column.querySelector('.tb-quick-input')
    if (!input) return { error: 'no-quick-input' }
    input.value = '新建的看板任务'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 600))
    const rows = await window.electronAPI.getAllTasks()
    const created = rows.find(item => item.name === '新建的看板任务')
    const visible = [...document.querySelectorAll('.tb-column[data-status="待办"] .tb-card-title')].some(item => item.textContent.includes('新建的看板任务'))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    return created ? { status: created.status, project: created.project_name, visible } : null
  })()`)
  check('列内行内新建任务', quickAdded?.status === '待办' && quickAdded?.project === 'Data Risk' && quickAdded?.visible === true, quickAdded)
  await clickScope('全部项目')

  const contextMenu = await cdp.evaluate(`(async () => {
    const card = [...document.querySelectorAll('.tb-card')].find(item => item.textContent.includes('跟进 Data Risk 指标进展'))
    for (let attempt = 0; attempt < 3; attempt += 1) {
      card?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 600, clientY: 420 }))
      await new Promise(resolve => setTimeout(resolve, 300))
      if (document.querySelector('.tb-context')) break
    }
    const menu = document.querySelector('.tb-context')
    const rect = menu?.getBoundingClientRect()
    const labelOf = item => item.querySelector(':scope > span')?.textContent.trim() || item.textContent.trim()
    const items = [...document.querySelectorAll('.tb-context > .tb-context-item')].map(labelOf)
    const priorityItem = [...document.querySelectorAll('.tb-context > .tb-context-item')].find(item => labelOf(item) === '优先级')
    const priorityRect = priorityItem?.getBoundingClientRect()
    priorityItem?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }))
    await new Promise(resolve => setTimeout(resolve, 300))
    const submenu = document.querySelector('.tb-context-sub')
    const subRect = submenu?.getBoundingClientRect()
    return {
      cardFound: Boolean(card),
      open: !!menu,
      rect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
      items,
      submenu: subRect ? {
        left: subRect.left,
        top: subRect.top,
        width: subRect.width,
        right: subRect.right,
        parentRight: priorityRect?.right
      } : null
    }
  })()`)
  check('右键菜单位置贴近鼠标', Boolean(contextMenu?.rect) && Math.abs(contextMenu.rect.left - 600) <= 2 && Math.abs(contextMenu.rect.top - 420) <= 2, contextMenu)
  check('右键菜单项完整', ['优先级', '移动到', '截止日期', '复制任务', '删除'].every(name => contextMenu?.items?.includes(name)), contextMenu?.items)
  check('右键子菜单向右展开', Boolean(contextMenu?.submenu) && contextMenu.submenu.left >= contextMenu.submenu.parentRight - 2, contextMenu?.submenu)
  shots.push(await cdp.screenshot('taskboard-context'))

  const completedByMenu = await cdp.evaluate(`(async () => {
    [...document.querySelectorAll('.tb-context > .tb-context-item')].find(item => item.textContent.includes('标记为完成'))?.click()
    await new Promise(resolve => setTimeout(resolve, 1200))
    const rows = await window.electronAPI.getAllTasks()
    return {
      hash: location.hash,
      board: Boolean(document.querySelector('.task-board-page')),
      doneCount: document.querySelector('.tb-done-rail .tb-col-count')?.textContent.trim(),
      doneTitles: [...document.querySelectorAll('.tb-done-row .tb-done-title')].map(item => item.textContent.trim()),
      inDoing: [...document.querySelectorAll('.tb-column[data-status="进行中"] .tb-card-title')].some(item => item.textContent.includes('跟进 Data Risk 指标进展')),
      bodyText: document.body.innerText.slice(0, 160),
      db: rows.map(item => ({ title: item.name, status: item.status }))
    }
  })()`)
  check('右键标记完成进入完成栏', completedByMenu?.doneCount === '2' && completedByMenu.doneTitles.includes('跟进 Data Risk 指标进展') && completedByMenu.inDoing === false, completedByMenu)

  const restoredByMenu = await cdp.evaluate(`(async () => {
    const row = [...document.querySelectorAll('.tb-done-row')].find(item => item.textContent.includes('跟进 Data Risk 指标进展'))
    for (let attempt = 0; attempt < 3; attempt += 1) {
      row?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 900, clientY: 300 }))
      await new Promise(resolve => setTimeout(resolve, 300))
      if (document.querySelector('.tb-context')) break
    }
    const menu = document.querySelector('.tb-context')
    const restore = [...document.querySelectorAll('.tb-context > .tb-context-item')].find(item => item.textContent.includes('标记为未完成'))
    restore?.click()
    await new Promise(resolve => setTimeout(resolve, 1200))
    const rows = await window.electronAPI.getAllTasks()
    return {
      rowFound: Boolean(row),
      menuOpened: Boolean(menu),
      menuItems: [...document.querySelectorAll('.tb-context > .tb-context-item')].map(item => item.textContent.trim()),
      restoreFound: Boolean(restore),
      doneCount: document.querySelector('.tb-done-rail .tb-col-count')?.textContent.trim(),
      todoTitles: [...document.querySelectorAll('.tb-column[data-status="待办"] .tb-card-title')].map(item => item.textContent.trim()),
      db: rows.map(item => ({ title: item.name, status: item.status }))
    }
  })()`)
  check('完成栏右键恢复任务', restoredByMenu?.doneCount === '1' && restoredByMenu.todoTitles.some(title => title.includes('跟进 Data Risk 指标进展')), restoredByMenu)

  const listView = await cdp.evaluate(`(async () => {
    [...document.querySelectorAll('.tb-view-toggle button')].find(item => item.textContent.trim() === '列表')?.click()
    await new Promise(resolve => setTimeout(resolve, 400))
    const list = document.querySelector('.tb-list')
    const doneHead = [...document.querySelectorAll('.tb-list-head')].find(item => item.textContent.includes('已完成'))
    return {
      visible: Boolean(list && list.offsetParent !== null),
      boardHidden: document.querySelector('.tb-board')?.offsetParent === null,
      groups: [...document.querySelectorAll('.tb-list-head-title')].map(item => item.textContent.trim()),
      rows: [...document.querySelectorAll('.tb-list-row .tb-list-title')].map(item => item.textContent.trim()),
      doneCollapsed: doneHead?.getAttribute('aria-expanded') === 'false',
      doneRows: [...document.querySelectorAll('.tb-list-row.done .tb-list-title')].map(item => item.textContent.trim())
    }
  })()`)
  check(
    '列表视图分组与已完成默认折叠',
    listView?.visible
      && listView.boardHidden
      && ['待办', '进行中', '已完成'].every(group => listView.groups.includes(group))
      && listView.rows.length === 5
      && listView.doneCollapsed === true
      && listView.doneRows.length === 0,
    listView
  )
  shots.push(await cdp.screenshot('taskboard-list'))

  const doneToggle = await cdp.evaluate(`(async () => {
    const head = () => [...document.querySelectorAll('.tb-list-head')].find(item => item.textContent.includes('已完成'))
    head()?.click()
    await new Promise(resolve => setTimeout(resolve, 300))
    const expanded = {
      aria: head()?.getAttribute('aria-expanded'),
      rows: [...document.querySelectorAll('.tb-list-row .tb-list-title')].map(item => item.textContent.trim()),
      doneRows: [...document.querySelectorAll('.tb-list-row.done .tb-list-title')].map(item => item.textContent.trim())
    }
    head()?.click()
    await new Promise(resolve => setTimeout(resolve, 300))
    const collapsed = {
      aria: head()?.getAttribute('aria-expanded'),
      rows: [...document.querySelectorAll('.tb-list-row .tb-list-title')].map(item => item.textContent.trim())
    }
    return { expanded, collapsed }
  })()`)
  check(
    '列表已完成可展开/收起',
    doneToggle?.expanded?.aria === 'true'
      && doneToggle.expanded.rows.length === 6
      && doneToggle.expanded.doneRows.includes('课程材料归档')
      && doneToggle.collapsed?.aria === 'false'
      && doneToggle.collapsed.rows.length === 5,
    doneToggle
  )

  const detailPanel = await cdp.evaluate(`(async () => {
    [...document.querySelectorAll('.tb-list-row')].find(item => item.textContent.includes('整理数据说明'))?.click()
    await new Promise(resolve => setTimeout(resolve, 400))
    const panel = document.querySelector('.task-detail-drawer.is-panel')
    const layer = document.querySelector('.task-detail-layer.is-panel')
    const style = panel ? getComputedStyle(panel) : null
    return {
      open: !!panel,
      position: style?.position,
      width: panel?.getBoundingClientRect().width,
      overlay: !!document.querySelector('.drawer-overlay'),
      title: panel?.querySelector('#task-name')?.value,
      layerWidth: layer?.getBoundingClientRect().width
    }
  })()`)
  check('详情为内嵌面板且无遮罩', detailPanel?.open && detailPanel.position === 'relative' && detailPanel.overlay === false && detailPanel.title === '整理数据说明' && detailPanel.width >= 330, detailPanel)
  shots.push(await cdp.screenshot('taskboard-detail'))
  await cdp.evaluate(`document.querySelector('.drawer-close')?.click(); true`)
  await sleep(300)
  const detailClosed = await cdp.evaluate(`!document.querySelector('.task-detail-drawer')`)
  check('详情面板关闭', detailClosed === true, detailClosed)

  await cdp.evaluate(`[...document.querySelectorAll('.tb-view-toggle button')].find(item => item.textContent.trim() === '看板')?.click(); true`)
  await sleep(350)
  const backToBoard = await cdp.evaluate(`(() => {
    const board = document.querySelector('.tb-board')
    const list = document.querySelector('.tb-list')
    return Boolean(board && board.offsetParent !== null && (!list || list.offsetParent === null))
  })()`)
  check('切回看板视图', backToBoard === true, backToBoard)

  const dragCardTo = async (title, targetSelector) => {
    const source = await cdp.evaluate(`(() => {
      const el = [...document.querySelectorAll('.tb-card, .tb-done-row')].find(item => item.textContent.includes(${JSON.stringify(title)}))
      if (!el) return null
      const rect = el.getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top + Math.min(rect.height / 2, 18) }
    })()`)
    const target = await cdp.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(targetSelector)})
      if (!el) return null
      const rect = el.getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top + Math.min(rect.height / 2, 120) }
    })()`)
    if (!source || !target) return { ok: false, source, target }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: source.x, y: source.y })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: source.x, y: source.y, button: 'left', buttons: 1, clickCount: 1 })
    await sleep(60)
    for (let i = 1; i <= 14; i += 1) {
      const x = source.x + (target.x - source.x) * (i / 14)
      const y = source.y + (target.y - source.y) * (i / 14)
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 })
      await sleep(20)
    }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', buttons: 0, clickCount: 1 })
    await sleep(1000)
    return { ok: true, source, target }
  }

  const dragToDone = await dragCardTo('第三节备课：树模型', '.tb-done-list')
  const droppedDone = await cdp.evaluate(`(async () => {
    const rows = await window.electronAPI.getAllTasks()
    const task = rows.find(item => item.name === '第三节备课：树模型')
    return {
      status: task?.status,
      inDone: [...document.querySelectorAll('.tb-done-title')].some(item => item.textContent.includes('第三节备课')),
      inDoing: [...document.querySelectorAll('.tb-column[data-status="进行中"] .tb-card-title')].some(item => item.textContent.includes('第三节备课'))
    }
  })()`)
  check(
    '拖到已完成栏完成任务',
    dragToDone?.ok === true && droppedDone?.status === '已完成' && droppedDone.inDone === true && droppedDone.inDoing === false,
    { dragToDone, droppedDone }
  )
  shots.push(await cdp.screenshot('taskboard-drag-done'))

  const dragBack = await dragCardTo('第三节备课：树模型', '.tb-column[data-status="进行中"] .tb-column-list')
  const droppedBack = await cdp.evaluate(`(async () => {
    const rows = await window.electronAPI.getAllTasks()
    const task = rows.find(item => item.name === '第三节备课：树模型')
    return {
      status: task?.status,
      inDoing: [...document.querySelectorAll('.tb-column[data-status="进行中"] .tb-card-title')].some(item => item.textContent.includes('第三节备课'))
    }
  })()`)
  check(
    '从已完成拖回进行中',
    dragBack?.ok === true && droppedBack?.status === '进行中' && droppedBack.inDoing === true,
    { dragBack, droppedBack }
  )

  const runtimeErrors = cdp.runtimeErrors.filter(error => !String(error).includes('ResizeObserver'))
  check('无运行时异常', runtimeErrors.length === 0, runtimeErrors)
} finally {
  cdp.close()
  child.kill('SIGKILL')
}

const passed = checks.filter(item => item.ok).length
console.log(`\n${passed}/${checks.length} checks passed`)
console.log(`screenshots: ${shots.join(', ')}`)
process.exit(passed === checks.length ? 0 : 1)
