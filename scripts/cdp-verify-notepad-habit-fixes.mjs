// 验证三处改动（需先启动: npm run dev:vite 与 NODE_ENV=development npx electron . --remote-debugging-port=9222）：
//   1. 习惯取消打卡 / 删除单条打卡不再弹 confirm（删除习惯仍确认）
//   2. 便签右键：一次 contextmenu 即选中并弹出菜单，菜单动作仍作用于该便签
//   3. 预览模式右侧章节导航：层级缩进、点击滚动、当前章节高亮、分屏不显示、无标题不显示
// 用法: node scripts/cdp-verify-notepad-habit-fixes.mjs
// 脚本会创建/删除 ZZTEST-* 测试数据，建议用一次性数据目录运行：
//   NODE_ENV=development npx electron . --remote-debugging-port=9222 --user-data-dir=/tmp/bm-verify-profile
// 环境变量: BONGMASTER_CDP_PORT（默认 9222）
import http from 'node:http'

const DEBUG_PORT = Number(process.env.BONGMASTER_CDP_PORT || 9222)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function httpJson(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: DEBUG_PORT, path }, (res) => {
      let body = ''
      res.on('data', (d) => { body += d })
      res.on('end', () => { try { resolve(JSON.parse(body)) } catch (err) { reject(err) } })
    }).on('error', reject)
  })
}

const FILLER = '这是一段用于撑高预览区的正文内容。'.repeat(4)

function noteContent(title, headings) {
  if (!headings) return `${FILLER}\n\n${FILLER}\n`
  return headings.map(([level, text]) => {
    const hashes = '#'.repeat(level)
    return `${hashes} ${text}\n\n${Array.from({ length: 14 }, () => FILLER).join('\n\n')}`
  }).join('\n\n')
}

async function main() {
  let targets = null
  for (let i = 0; i < 40; i++) {
    try { targets = await httpJson('/json/list'); break } catch { await sleep(500) }
  }
  if (!targets) { console.error('CDP 端口不可达'); process.exit(1) }
  const page = targets.find((t) => t.type === 'page' && t.url.includes('localhost:5173'))
  if (!page) { console.error('找不到应用窗口 target', targets.map((t) => t.url)); process.exit(1) }
  console.log('[target]', page.url)

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  const pending = new Map()
  const errors = []
  let nextId = 0

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
      return
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params?.exceptionDetails?.exception?.description || 'exception')
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
      if (pending.has(id)) { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }
    }, 30000)
  })

  await send('Runtime.enable')
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result?.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'eval failed')
    return result?.result?.value
  }

  const checks = []
  const check = (name, ok, detail) => {
    checks.push({ name, ok, detail })
    console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail === undefined ? '' : ` -> ${JSON.stringify(detail)}`}`)
  }
  const waitFor = async (expression, timeout = 10000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await evaluate(`(() => { try { return Boolean(${expression}) } catch { return false } })()`)) return true
      await sleep(200)
    }
    return false
  }

  // 等待应用启动完成后再操作
  await waitFor(`document.querySelector('.bm-navbar')`, 30000)

  // 清空上次运行遗留的测试数据，并刷新页面让 store 与数据库一致
  await evaluate(`(async () => {
    const api = window.electronAPI
    const notes = await api.getDesktopNotes()
    for (const note of notes || []) {
      if ((note.title || '').startsWith('ZZTEST-')) await api.deleteDesktopNote(note.id)
    }
    const habits = await api.getAllHabits()
    for (const habit of habits || []) {
      if ((habit.name || '').startsWith('ZZTEST-')) await api.deleteHabit(habit.id)
    }
  })()`)
  await evaluate(`location.hash = '#/notepad'`)
  await evaluate(`location.reload()`)
  await sleep(3000)
  await waitFor(`document.querySelector('.bm-navbar')`, 30000)

  // 拦截 confirm / alert：记录是否被调用（改动要求：取消打卡 / 删除单条打卡不弹窗）
  await evaluate(`(() => {
    window.__confirms = []
    window.__alerts = []
    window.confirm = (message) => { window.__confirms.push(String(message)); return true }
    window.alert = (message) => { window.__alerts.push(String(message)) }
    return true
  })()`)

  // —— 便签：创建测试数据 ——
  await evaluate(`location.hash = '#/notepad'`)
  if (!await waitFor(`document.querySelector('.notepad-view')`)) {
    console.error('便签页未渲染:', await evaluate(`(document.body.innerText || '').slice(0, 300)`))
    process.exit(1)
  }
  const created = await evaluate(`(async () => {
    const api = window.electronAPI
    const notes = await api.getDesktopNotes()
    for (const note of notes) {
      if ((note.title || '').startsWith('ZZTEST-')) await api.deleteDesktopNote(note.id)
    }
    const a = await api.createDesktopNote({ title: 'ZZTEST-A', content: ${JSON.stringify(noteContent('A', [[1, '甲标题'], [2, '重复节'], [3, '重复节']]))} })
    const b = await api.createDesktopNote({ title: 'ZZTEST-B', content: ${JSON.stringify(noteContent('B', [[1, '乙标题']]))} })
    const c = await api.createDesktopNote({ title: 'ZZTEST-C', content: ${JSON.stringify(noteContent('C', null))} })
    return { a: a?.id, b: b?.id, c: c?.id }
  })()`)
  console.log('[created]', JSON.stringify(created))
  if (!await waitFor(`[...document.querySelectorAll('.note-item')].some((el) => (el.querySelector('.note-title')?.textContent || '').trim() === 'ZZTEST-B')`)) {
    console.error('测试便签未出现在列表:', await evaluate(`[...document.querySelectorAll('.note-item')].map((el) => el.querySelector('.note-title')?.textContent)`))
    process.exit(1)
  }

  // —— 便签：一次右键即选中并弹出菜单 ——
  const menuState = await evaluate(`(async () => {
    const items = [...document.querySelectorAll('.note-item')]
    const target = items.find((el) => (el.querySelector('.note-title')?.textContent || '').trim() === 'ZZTEST-B')
    if (!target) return { error: 'note item not found', titles: items.map((el) => el.querySelector('.note-title')?.textContent?.trim()) }
    // 复现原始场景：编辑器处于焦点且处于滚动状态，切便签会带来程序化滚动
    const textarea = document.querySelector('textarea.markdown-body-textarea')
    if (textarea) {
      textarea.focus()
      textarea.scrollTop = 500
    }
    const rect = target.getBoundingClientRect()
    target.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, button: 2,
      clientX: rect.left + 24, clientY: rect.top + 24
    }))
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const menu = document.querySelector('.note-context-menu')
    return {
      menuVisible: Boolean(menu),
      menuItems: menu ? [...menu.querySelectorAll('.context-menu-item')].map((b) => b.textContent.trim()) : [],
      activeTitle: document.querySelector('.note-item.active .note-title')?.textContent?.trim(),
      confirms: window.__confirms.length
    }
  })()`)
  console.log('[context menu]', JSON.stringify(menuState))
  check('右键一次即弹出便签菜单', menuState.menuVisible === true, menuState.error || menuState.menuItems)
  check('右键同时选中该便签', menuState.activeTitle === 'ZZTEST-B', menuState.activeTitle)
  check('便签右键不触发 confirm', menuState.confirms === 0, menuState.confirms)

  // —— 便签：菜单动作仍作用于该便签（getContextNote 有效） ——
  const pinState = await evaluate(`(async () => {
    const menu = document.querySelector('.note-context-menu')
    if (!menu) return { error: 'menu closed before action' }
    const pin = [...menu.querySelectorAll('.context-menu-item')].find((b) => /置顶/.test(b.textContent))
    if (!pin) return { error: 'pin action missing' }
    pin.click()
    await new Promise((resolve) => setTimeout(resolve, 1200))
    const target = [...document.querySelectorAll('.note-item')].find((el) => (el.querySelector('.note-title')?.textContent || '').trim() === 'ZZTEST-B')
    const stored = await window.electronAPI.getDesktopNotes()
    const saved = (stored || []).find((n) => n.title === 'ZZTEST-B')
    return {
      pinnedInDb: Boolean(saved?.is_pinned),
      pinnedInDom: target ? target.classList.contains('pinned') : null,
      menuClosed: !document.querySelector('.note-context-menu')
    }
  })()`)
  console.log('[menu action]', JSON.stringify(pinState))
  check('菜单动作作用在右键的便签上（置顶生效）', pinState.pinnedInDb === true && pinState.pinnedInDom === true, pinState)
  check('动作后菜单关闭', pinState.menuClosed === true, pinState.menuClosed)

  // —— 便签：连续右键不同便签，每次都要弹出菜单 ——
  const repeatState = await evaluate(`(async () => {
    const rightClick = async (title) => {
      const target = [...document.querySelectorAll('.note-item')].find((el) => (el.querySelector('.note-title')?.textContent || '').trim() === title)
      const rect = target.getBoundingClientRect()
      target.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, button: 2,
        clientX: rect.left + 24, clientY: rect.top + 24
      }))
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      return {
        menuVisible: Boolean(document.querySelector('.note-context-menu')),
        activeTitle: document.querySelector('.note-item.active .note-title')?.textContent?.trim()
      }
    }
    const again = await rightClick('ZZTEST-B')
    const other = await rightClick('ZZTEST-A')
    return { again, other }
  })()`)
  console.log('[repeat context menu]', JSON.stringify(repeatState))
  check('已选中便签再次右键仍弹菜单', repeatState.again?.menuVisible === true && repeatState.again.activeTitle === 'ZZTEST-B', repeatState.again)
  check('菜单打开时右键另一便签仍弹菜单', repeatState.other?.menuVisible === true && repeatState.other.activeTitle === 'ZZTEST-A', repeatState.other)

  // —— 便签：切换便签后 autosave 仍正常（输入 → 内容最终落库） ——
  const autosaveState = await evaluate(`(async () => {
    const target = [...document.querySelectorAll('.note-item')].find((el) => (el.querySelector('.note-title')?.textContent || '').trim() === 'ZZTEST-B')
    target.click()
    await new Promise((resolve) => setTimeout(resolve, 400))
    const modeBtn = [...document.querySelectorAll('.editor-mode-switch .mode-btn')].find((b) => b.title === '编辑')
    modeBtn.click()
    await new Promise((resolve) => setTimeout(resolve, 300))
    const editor = document.querySelector('textarea.markdown-body-textarea')
    if (!editor) return { error: 'textarea missing', body: (document.body.innerText || '').slice(0, 200) }
    editor.value = editor.value + '\\n\\n自动保存检查'
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    const states = []
    let persisted = false
    for (let i = 0; i < 16 && !persisted; i++) {
      await new Promise((resolve) => setTimeout(resolve, 300))
      states.push(document.querySelector('.save-status-text')?.textContent?.trim() || 'idle')
      const stored = await window.electronAPI.getDesktopNotes()
      const saved = (stored || []).find((n) => n.title === 'ZZTEST-B')
      persisted = (saved?.content || '').includes('自动保存检查')
    }
    return { states, persisted, alerts: window.__alerts }
  })()`)
  console.log('[autosave]', JSON.stringify(autosaveState))
  check('切便签后自动保存仍落库', autosaveState.persisted === true, autosaveState)

  // —— 预览模式：章节导航 ——
  const outlineState = await evaluate(`(async () => {
    const target = [...document.querySelectorAll('.note-item')].find((el) => (el.querySelector('.note-title')?.textContent || '').trim() === 'ZZTEST-A')
    target.click()
    await new Promise((resolve) => setTimeout(resolve, 500))
    const modeBtn = [...document.querySelectorAll('.editor-mode-switch .mode-btn')].find((b) => b.title === '预览')
    modeBtn.click()
    await new Promise((resolve) => setTimeout(resolve, 500))
    const outline = document.querySelector('.markdown-preview-outline')
    const items = [...document.querySelectorAll('.markdown-preview-outline-item')]
    const scroll = document.querySelector('.markdown-preview-scroll')
    const headings = [...document.querySelectorAll('.markdown-preview-content h1, .markdown-preview-content h2, .markdown-preview-content h3')]
    const before = scroll ? scroll.scrollTop : null
    if (items.length) items[items.length - 1].click()
    await new Promise((resolve) => setTimeout(resolve, 900))
    return {
      visible: Boolean(outline),
      texts: items.map((b) => b.textContent.trim()),
      paddingLeft: items.map((b) => b.style.paddingLeft),
      headingCount: headings.length,
      activeText: document.querySelector('.markdown-preview-outline-item.active')?.textContent?.trim(),
      scrollTopBefore: before,
      scrollTopAfter: scroll ? scroll.scrollTop : null,
      activeElement: document.activeElement?.className || document.activeElement?.tagName
    }
  })()`)
  console.log('[outline]', JSON.stringify(outlineState))
  check('预览模式显示章节导航', outlineState.visible === true, outlineState.headingCount)
  check('目录项与渲染标题一一对应（含重复标题）', outlineState.headingCount === outlineState.texts.length && outlineState.texts.length === 3, outlineState.texts)
  check('目录按标题层级缩进', JSON.stringify(outlineState.paddingLeft) === JSON.stringify(['10px', '20px', '30px']), outlineState.paddingLeft)
  check('点击目录滚动到对应章节', (outlineState.scrollTopAfter || 0) > (outlineState.scrollTopBefore || 0), [outlineState.scrollTopBefore, outlineState.scrollTopAfter])
  check('滚动后高亮当前章节', outlineState.activeText === '重复节', outlineState.activeText)
  check('目录点击不夺走编辑光标焦点', !String(outlineState.activeElement).includes('outline-item'), outlineState.activeElement)

  const splitState = await evaluate(`(async () => {
    const modeBtn = [...document.querySelectorAll('.editor-mode-switch .mode-btn')].find((b) => b.title === '分屏')
    modeBtn.click()
    await new Promise((resolve) => setTimeout(resolve, 500))
    return { outline: Boolean(document.querySelector('.markdown-preview-outline')) }
  })()`)
  check('分屏模式不显示目录', splitState.outline === false, splitState)

  const noHeadingState = await evaluate(`(async () => {
    const target = [...document.querySelectorAll('.note-item')].find((el) => (el.querySelector('.note-title')?.textContent || '').trim() === 'ZZTEST-C')
    target.click()
    await new Promise((resolve) => setTimeout(resolve, 500))
    const modeBtn = [...document.querySelectorAll('.editor-mode-switch .mode-btn')].find((b) => b.title === '预览')
    modeBtn.click()
    await new Promise((resolve) => setTimeout(resolve, 600))
    return { outline: Boolean(document.querySelector('.markdown-preview-outline')) }
  })()`)
  check('无标题便签不显示目录', noHeadingState.outline === false, noHeadingState)

  // —— 习惯：取消打卡与删除单条打卡不再确认 ——
  const habitState = await evaluate(`(async () => {
    const habits = await window.electronAPI.getAllHabits()
    for (const habit of habits) {
      if ((habit.name || '').startsWith('ZZTEST-')) await window.electronAPI.deleteHabit(habit.id)
    }
    await window.electronAPI.createHabit({ name: 'ZZTEST-H', color: '#10b981', icon: 'fa-fire' })
    location.hash = '#/notepad'
    await new Promise((resolve) => setTimeout(resolve, 300))
    location.hash = '#/habits'
    await new Promise((resolve) => setTimeout(resolve, 1200))
    if (![...document.querySelectorAll('.habit-item .habit-name')].some((el) => el.textContent.trim() === 'ZZTEST-H')) {
      return { error: 'habit not listed', text: (document.body.innerText || '').slice(0, 200) }
    }
    window.__confirms.length = 0
    const findButton = (text) => [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes(text))
    const checkinBtn = findButton('完成今日打卡')
    if (!checkinBtn) return { error: 'checkin button missing', text: (document.body.innerText || '').slice(0, 200) }
    checkinBtn.click()
    await new Promise((resolve) => setTimeout(resolve, 900))
    const cancelBtn = findButton('取消打卡')
    if (!cancelBtn) return { error: 'cancel button missing' }
    cancelBtn.click()
    await new Promise((resolve) => setTimeout(resolve, 900))
    const afterCancel = {
      confirms: window.__confirms.slice(),
      alerts: window.__alerts.slice(),
      backToUnchecked: Boolean(findButton('完成今日打卡')),
      checkins: (await window.electronAPI.getHabitCheckins(
        (await window.electronAPI.getAllHabits()).find((h) => h.name === 'ZZTEST-H').id
      ) || []).length
    }

    // 重新打卡，再从热力图打开编辑弹窗删除单条记录
    findButton('完成今日打卡').click()
    await new Promise((resolve) => setTimeout(resolve, 900))
    const todayCell = document.querySelector('.heatmap-cell.is-today')
    if (!todayCell) return { error: 'today heatmap cell missing', afterCancel }
    todayCell.click()
    await new Promise((resolve) => setTimeout(resolve, 600))
    const deleteBtn = [...document.querySelectorAll('button')].find((b) => b.classList.contains('bm-btn-danger'))
    if (!deleteBtn) return { error: 'checkin delete button missing', afterCancel }
    const beforeDelete = window.__confirms.length
    deleteBtn.click()
    await new Promise((resolve) => setTimeout(resolve, 900))
    return {
      afterCancel,
      afterDelete: {
        confirmsBeforeDelete: beforeDelete,
        confirms: window.__confirms.slice(),
        alerts: window.__alerts.slice(),
        backToUnchecked: Boolean(findButton('完成今日打卡'))
      }
    }
  })()`)
  console.log('[habit]', JSON.stringify(habitState))
  check('取消今日打卡不弹确认', habitState?.afterCancel?.confirms?.length === 0 && habitState.afterCancel.backToUnchecked === true, habitState?.afterCancel || habitState)
  check('删除单条打卡记录不弹确认', habitState?.afterDelete?.confirms?.length === 0 && habitState.afterDelete.backToUnchecked === true, habitState?.afterDelete || habitState)

  // —— 删除习惯仍保留确认（HabitList 右键删除） ——
  const habitDeleteState = await evaluate(`(async () => {
    window.__confirms.length = 0
    const item = document.querySelector('.habit-item')
    if (!item) return { error: 'habit item missing' }
    item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 200, clientY: 200 }))
    await new Promise((resolve) => setTimeout(resolve, 400))
    const deleteEntry = [...document.querySelectorAll('.habit-context-menu .context-menu-item')].find((b) => (b.textContent || '').trim() === '删除')
    if (!deleteEntry) return { error: 'habit delete action missing', text: (document.body.innerText || '').slice(0, 200) }
    deleteEntry.click()
    await new Promise((resolve) => setTimeout(resolve, 400))
    return { confirms: window.__confirms.slice() }
  })()`)
  console.log('[habit delete]', JSON.stringify(habitDeleteState))
  check('删除习惯仍有确认', habitDeleteState?.confirms?.some((m) => m.includes('ZZTEST-H')) === true, habitDeleteState)

  // —— 清理测试数据 ——
  const cleaned = await evaluate(`(async () => {
    const api = window.electronAPI
    const notes = await api.getDesktopNotes({})
    let removedNotes = 0
    for (const note of notes || []) {
      if ((note.title || '').startsWith('ZZTEST-')) { await api.deleteDesktopNote(note.id); removedNotes += 1 }
    }
    const habits = await api.getAllHabits()
    let removedHabits = 0
    for (const habit of habits || []) {
      if ((habit.name || '').startsWith('ZZTEST-')) { await api.deleteHabit(habit.id); removedHabits += 1 }
    }
    return { removedNotes, removedHabits }
  })()`)
  console.log('[cleanup]', JSON.stringify(cleaned))

  ws.close()
  const failed = checks.filter((c) => !c.ok)
  console.log(`\n===== RESULT: ${checks.length - failed.length}/${checks.length} passed =====`)
  if (errors.length) console.log('[page errors]\n' + errors.slice(0, 10).join('\n'))
  process.exit(failed.length ? 1 : 0)
}

main().catch((err) => { console.error('DRIVER FAIL', err); process.exit(1) })
