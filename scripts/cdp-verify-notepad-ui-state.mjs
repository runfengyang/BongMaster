// 验证便签三处改动（需先启动: npm run dev:vite 与 NODE_ENV=development npx electron . --remote-debugging-port=9222）：
//   1. 从别的 tab 切回便签页时保留离开时的 UI 状态（选中便签、归档/分类/项目筛选、搜索、编辑模式、列表滚动位置、侧栏宽度）
//   2. 点开已有便签默认进入眼睛预览；新建便签仍进入编辑，切换便签时自动保存不受影响
//   3. 预览态右侧章节导航可拖动调宽、可隐藏并可恢复，宽度/隐藏状态本地记忆；分屏与编辑态不显示
// 用法: node scripts/cdp-verify-notepad-ui-state.mjs
// 脚本会创建/删除 ZZTEST-* 测试数据，建议用一次性数据目录运行：
//   NODE_ENV=development npx electron . --remote-debugging-port=9222 --user-data-dir=/tmp/bm-verify-notepad
// 环境变量: BONGMASTER_CDP_PORT（默认 9222）
import http from 'node:http'

const DEBUG_PORT = Number(process.env.BONGMASTER_CDP_PORT || 9222)
const UI_STATE_KEY = 'bongmaster-notepad-ui-state'
const OUTLINE_KEY = 'bongmaster-markdown-outline'
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

const FILLER = 'ZZTEST 正文段落，用于撑高预览区与列表。'.repeat(6)

function noteContent(headings) {
  if (!headings) return `${FILLER}\n`
  return headings
    .map(([level, text]) => `${'#'.repeat(level)} ${text}\n\n${Array.from({ length: 12 }, () => FILLER).join('\n\n')}`)
    .join('\n\n')
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
    checks.push({ name, ok })
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

  // 页面内复用的探针
  const PROBES = `
    window.__bm = {
      // 等离场的面板过渡结束，否则会读到上一模式残留的 DOM
      mode: async () => {
        for (let i = 0; i < 30; i += 1) {
          if (!document.querySelector('.editor-mode-panel-leave-active')) break
          await new Promise((resolve) => setTimeout(resolve, 60))
        }
        const active = [...document.querySelectorAll('.editor-mode-switch .mode-btn')]
          .find((button) => button.classList.contains('active'))
        return {
          mode: active?.getAttribute('title') || null,
          hasPreviewPane: Boolean(document.querySelector('.markdown-preview-pane')),
          editablePreview: Boolean(document.querySelector('.markdown-preview-content.is-editable')),
          hasTextarea: Boolean(document.querySelector('.markdown-body-textarea')),
          activeNote: (document.querySelector('.note-item.active .note-title')?.textContent || '').trim() || null,
          archiveTab: document.querySelector('.archive-switch-btn.active')?.getAttribute('title') || null
        }
      },
      outline: () => {
        const nav = document.querySelector('.markdown-preview-outline')
        return {
          visible: Boolean(nav),
          width: nav ? Math.round(nav.getBoundingClientRect().width) : null,
          resizer: Boolean(document.querySelector('.markdown-preview-outline-resizer')),
          restore: Boolean(document.querySelector('.markdown-preview-outline-restore')),
          items: nav ? nav.querySelectorAll('.markdown-preview-outline-item').length : 0
        }
      },
      clickNote: async (title) => {
        for (let i = 0; i < 30; i += 1) {
          const item = [...document.querySelectorAll('.note-item')]
            .find((el) => (el.querySelector('.note-title')?.textContent || '').trim() === title)
          if (item) { item.click(); return true }
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        return false
      },
      clickMode: async (title) => {
        for (let i = 0; i < 30; i += 1) {
          const button = [...document.querySelectorAll('.editor-mode-switch .mode-btn')]
            .find((el) => el.getAttribute('title') === title)
          if (button) { button.click(); return true }
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        return false
      },
      clickArchive: async (title) => {
        for (let i = 0; i < 30; i += 1) {
          const button = [...document.querySelectorAll('.archive-switch-btn')]
            .find((el) => el.getAttribute('title') === title)
          if (button) { button.click(); return true }
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        return false
      },
      clickOutline: async (selector) => {
        for (let i = 0; i < 30; i += 1) {
          const button = document.querySelector(selector)
          if (button) { button.click(); return true }
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        return false
      },
      drag: (selector, fromX, toX, y) => {
        const el = document.querySelector(selector)
        if (!el) return false
        const rect = el.getBoundingClientRect()
        const clientY = y === undefined ? rect.top + rect.height / 2 : y
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: fromX, clientY }))
        document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: toX, clientY }))
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: toX, clientY }))
        return true
      },
      resizeHandlersCleared: async () => {
        // 拖动结束后不应残留 document 级监听：再发一次 mousemove 宽度不应变化
        const before = document.querySelector('.markdown-preview-outline')?.getBoundingClientRect().width ?? null
        document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 10, clientY: 10 }))
        await new Promise((resolve) => requestAnimationFrame(resolve))
        const after = document.querySelector('.markdown-preview-outline')?.getBoundingClientRect().width ?? null
        return before === after
      }
    }
    true
  `

  await waitFor(`document.querySelector('.bm-navbar')`, 30000)

  // —— 清理旧测试数据，进入便签页，清空 UI 状态 ——
  await evaluate(`(async () => {
    const notes = await window.electronAPI.getDesktopNotes()
    for (const note of notes || []) {
      if ((note.title || '').startsWith('ZZTEST-')) await window.electronAPI.deleteDesktopNote(note.id)
    }
  })()`)
  const created = await evaluate(`(async () => {
    const api = window.electronAPI
    const a = await api.createDesktopNote({ title: 'ZZTEST-A', content: ${JSON.stringify(noteContent([[1, '甲标题'], [2, '甲小节']]))} })
    const b = await api.createDesktopNote({ title: 'ZZTEST-B', content: ${JSON.stringify(noteContent(null))} })
    const c = await api.createDesktopNote({ title: 'ZZTEST-C', content: ${JSON.stringify(noteContent([[1, '丙标题']]))} })
    // 撑高列表，保证可以产生滚动位置
    for (let i = 0; i < 16; i += 1) {
      await api.createDesktopNote({ title: 'ZZTEST-FILL-' + i, content: 'ZZTEST 填充便签 ' + i })
    }
    return { a: a?.id, b: b?.id, c: c?.id }
  })()`)
  console.log('[created]', JSON.stringify(created))
  await evaluate(`localStorage.removeItem(${JSON.stringify(UI_STATE_KEY)}); localStorage.removeItem(${JSON.stringify(OUTLINE_KEY)}); location.hash = '#/notepad'; location.reload()`)
  await sleep(2500)
  if (!await waitFor(`document.querySelector('.notepad-view')`, 30000)) {
    console.error('便签页未渲染:', await evaluate(`(document.body.innerText || '').slice(0, 300)`))
    process.exit(1)
  }
  await evaluate(PROBES)
  if (!await waitFor(`[...document.querySelectorAll('.note-item')].some((el) => (el.querySelector('.note-title')?.textContent || '').trim() === 'ZZTEST-A')`)) {
    console.error('测试便签未出现在列表')
    process.exit(1)
  }

  // ============ 需求 2：点开便签默认进入眼睛预览 ============
  await evaluate(`window.__bm.clickNote('ZZTEST-A')`)
  await waitFor(`document.querySelector('.markdown-preview-pane')`)
  await sleep(400)
  const openedA = await evaluate(`window.__bm.mode()`)
  console.log('[open A]', JSON.stringify(openedA))
  check('点开已有便签默认进入预览（眼睛）', openedA.mode === '预览' && openedA.editablePreview === true && openedA.hasTextarea === false, openedA)

  // 新建便签仍进入编辑，并聚焦标题
  await evaluate(`window.__bm.clickOutline('.btn-new')`)
  await waitFor(`document.querySelector('.markdown-body-textarea')`)
  await sleep(500)
  const newNote = await evaluate(`(async () => {
    const state = await window.__bm.mode()
    return { ...state, focusedClass: document.activeElement?.className || document.activeElement?.tagName || null }
  })()`)
  console.log('[new note]', JSON.stringify(newNote))
  check('新建便签进入编辑模式并聚焦标题', newNote.mode === '编辑' && newNote.hasTextarea === true && /markdown-title-input/.test(String(newNote.focusedClass)), newNote)

  // 从编辑态点开另一个便签 → 预览
  await evaluate(`window.__bm.clickNote('ZZTEST-A')`)
  await sleep(300)
  await evaluate(`window.__bm.clickNote('ZZTEST-B')`)
  await waitFor(`document.querySelector('.markdown-preview-content.is-editable')`)
  await sleep(400)
  const openedB = await evaluate(`window.__bm.mode()`)
  console.log('[open B]', JSON.stringify(openedB))
  check('从编辑态点开另一个便签也进入预览', openedB.mode === '预览' && openedB.activeNote === 'ZZTEST-B' && openedB.hasTextarea === false, openedB)

  // 重复点击当前便签不应把编辑模式踢回预览
  await evaluate(`window.__bm.clickMode('编辑')`)
  await waitFor(`document.querySelector('.markdown-body-textarea')`)
  await evaluate(`window.__bm.clickNote('ZZTEST-B')`)
  await sleep(300)
  const reclick = await evaluate(`window.__bm.mode()`)
  console.log('[re-click active note]', JSON.stringify(reclick))
  check('再次点击当前便签不会打断编辑模式', reclick.mode === '编辑' && reclick.activeNote === 'ZZTEST-B', reclick)

  // ============ 需求 1：切走再切回保留状态 ============
  await evaluate(`window.__bm.clickNote('ZZTEST-A')`)
  await sleep(400)
  // 手动切到编辑模式
  await evaluate(`window.__bm.clickMode('编辑')`)
  await waitFor(`document.querySelector('.markdown-body-textarea')`)
  // 搜索 + 项目筛选 + 列表滚动 + 侧栏拖宽
  const before = await evaluate(`(async () => {
    const search = document.querySelector('.sidebar-search input')
    search.value = 'ZZTEST'
    search.dispatchEvent(new Event('input', { bubbles: true }))
    const projectSelect = document.querySelector('.project-filter-select')
    projectSelect.value = '__unlinked__'
    projectSelect.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const item = [...document.querySelectorAll('.note-item')].find((el) => (el.querySelector('.note-title')?.textContent || '').trim() === 'ZZTEST-A')
    item.click()
    await new Promise((resolve) => setTimeout(resolve, 300))
    const list = document.querySelector('.sidebar-list')
    list.scrollTop = 36
    const width = Math.round(document.querySelector('.notepad-sidebar').getBoundingClientRect().width)
    window.__bm.drag('.sidebar-resizer', 800, 860)
    await new Promise((resolve) => setTimeout(resolve, 200))
    return {
      sidebarWidth: Math.round(document.querySelector('.notepad-sidebar').getBoundingClientRect().width),
      widthBefore: width,
      scrollTop: list.scrollTop,
      mode: (await window.__bm.mode()).mode,
      activeNote: (await window.__bm.mode()).activeNote
    }
  })()`)
  console.log('[state before leaving]', JSON.stringify(before))
  check('离开前：编辑模式 + 选中便签 + 搜索/筛选已设置 + 侧栏已拖宽',
    before.mode === '编辑' &&
    before.activeNote === 'ZZTEST-A' &&
    before.sidebarWidth === before.widthBefore + 60 &&
    before.scrollTop === 36,
    before)

  const storedState = await evaluate(`(async () => {
    // 持久化有 300ms 防抖，等它落盘后再读
    await new Promise((resolve) => setTimeout(resolve, 700))
    return JSON.parse(localStorage.getItem(${JSON.stringify(UI_STATE_KEY)}) || '{}')
  })()`)
  console.log('[ui state]', JSON.stringify(storedState))
  check('UI 状态已写入本地存储且不含便签内容',
    storedState.noteId === created.a &&
    storedState.editorMode === 'edit' &&
    storedState.searchQuery === 'ZZTEST' &&
    storedState.selectedProjectFilter === '__unlinked__' &&
    storedState.sidebarWidth === before.sidebarWidth &&
    storedState.listScrollTop === 36 &&
    !('content' in storedState) &&
    !('title' in storedState) &&
    !JSON.stringify(storedState).includes('正文段落'),
    storedState)

  // 切到别的 tab 再切回
  await evaluate(`location.hash = '#/tasks'`)
  await waitFor(`document.querySelector('.task-board-view, .task-board, .task-board-page, main')`)
  await sleep(600)
  await evaluate(`location.hash = '#/notepad'`)
  if (!await waitFor(`document.querySelector('.notepad-view')`, 15000)) {
    console.error('回到便签页失败')
    process.exit(1)
  }
  await sleep(1200)
  await evaluate(PROBES)
  const after = await evaluate(`(async () => {
    const list = document.querySelector('.sidebar-list')
    return {
      ...(await window.__bm.mode()),
      searchQuery: document.querySelector('.sidebar-search input')?.value ?? null,
      projectFilter: document.querySelector('.project-filter-select')?.value ?? null,
      sidebarWidth: Math.round(document.querySelector('.notepad-sidebar').getBoundingClientRect().width),
      scrollTop: list ? list.scrollTop : null,
      textareaHasContent: (document.querySelector('.markdown-body-textarea')?.value || '').includes('甲标题'),
      previewScrollTop: document.querySelector('.markdown-preview-scroll')?.scrollTop ?? null
    }
  })()`)
  console.log('[state after returning]', JSON.stringify(after))
  check('切回便签页：仍是离开时选中的便签', after.activeNote === 'ZZTEST-A', after.activeNote)
  check('切回便签页：仍是编辑模式且内容仍在', after.mode === '编辑' && after.textareaHasContent === true, after)
  check('切回便签页：搜索/项目筛选保持', after.searchQuery === 'ZZTEST' && after.projectFilter === '__unlinked__', after)
  check('切回便签页：列表滚动位置与侧栏宽度恢复',
    after.scrollTop === 36 && after.sidebarWidth === before.sidebarWidth,
    { scrollTop: after.scrollTop, sidebarWidth: after.sidebarWidth, expectedWidth: before.sidebarWidth })

  // 切换便签时原有自动保存逻辑仍工作
  const autosave = await evaluate(`(async () => {
    const textarea = document.querySelector('.markdown-body-textarea')
    const marker = 'ZZTEST-自动保存标记-' + Date.now()
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(textarea, (textarea.value || '') + '\\n' + marker)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 150))
    window.__bm.clickNote('ZZTEST-C')
    await new Promise((resolve) => setTimeout(resolve, 2200))
    const notes = await window.electronAPI.getDesktopNotes()
    const saved = (notes || []).find((note) => note.title === 'ZZTEST-A')
    return { saved: (saved?.content || '').includes(marker), active: (await window.__bm.mode()).activeNote }
  })()`)
  console.log('[autosave on switch]', JSON.stringify(autosave))
  check('切换便签时切走前的编辑内容仍被保存', autosave.saved === true && autosave.active === 'ZZTEST-C', autosave)

  // 预览滚动位置同样要恢复
  await evaluate(`window.__bm.clickMode('预览')`)
  await waitFor(`document.querySelector('.markdown-preview-scroll')`)
  await sleep(400)
  const previewScrollBefore = await evaluate(`(async () => {
    let pane = null
    for (let i = 0; i < 30 && !pane; i += 1) {
      pane = document.querySelector('.markdown-preview-scroll')
      if (!pane) await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (!pane) return { error: 'preview pane missing' }
    pane.scrollTop = 300
    await new Promise((resolve) => setTimeout(resolve, 200))
    return { top: Math.round(pane.scrollTop), height: pane.scrollHeight, client: pane.clientHeight, note: (await window.__bm.mode()).activeNote }
  })()`)
  await evaluate(`location.hash = '#/tasks'`)
  await sleep(600)
  await evaluate(`location.hash = '#/notepad'`)
  await waitFor(`document.querySelector('.notepad-view')`, 15000)
  await sleep(1600)
  await evaluate(PROBES)
  const previewScrollAfter = await evaluate(`(async () => {
    const pane = document.querySelector('.markdown-preview-scroll')
    const first = { top: Math.round(pane.scrollTop), height: pane.scrollHeight, client: pane.clientHeight }
    const stored = JSON.parse(localStorage.getItem(${JSON.stringify(UI_STATE_KEY)}) || '{}')
    await new Promise((resolve) => setTimeout(resolve, 900))
    const later = { top: Math.round(pane.scrollTop), height: pane.scrollHeight, client: pane.clientHeight }
    return { ...first, later, ratio: stored.previewScrollRatio, ...(await window.__bm.mode()) }
  })()`)
  console.log('[preview scroll]', JSON.stringify({ before: previewScrollBefore, after: previewScrollAfter }))
  check('切回后预览滚动位置恢复，且保持原便签与模式',
    previewScrollBefore.top === 300 &&
    previewScrollAfter.top !== null &&
    Math.abs(previewScrollAfter.top - previewScrollBefore.top) <= 6 &&
    previewScrollAfter.mode === '预览' &&
    previewScrollAfter.activeNote === previewScrollBefore.note,
    { before: previewScrollBefore, after: previewScrollAfter })

  // 归档视图 + 被选中的归档便签同样要保留
  await evaluate(`(async () => {
    const notes = await window.electronAPI.getDesktopNotes()
    const target = (notes || []).find((note) => note.title === 'ZZTEST-C')
    if (target) await window.electronAPI.archiveDesktopNote(target.id, true)
    return Boolean(target)
  })()`)
  await sleep(2500)
  await evaluate(`window.__bm.clickArchive('归档箱')`)
  await sleep(400)
  await evaluate(`window.__bm.clickNote('ZZTEST-C')`)
  await sleep(600)
  const archiveBefore = await evaluate(`window.__bm.mode()`)
  await evaluate(`location.hash = '#/tasks'`)
  await sleep(600)
  await evaluate(`location.hash = '#/notepad'`)
  await waitFor(`document.querySelector('.notepad-view')`, 15000)
  await sleep(1500)
  await evaluate(PROBES)
  const archiveAfter = await evaluate(`(async () => ({ ...(await window.__bm.mode()) }))()`)
  console.log('[archive restore]', JSON.stringify({ before: archiveBefore, after: archiveAfter }))
  check('切回后仍停留在归档视图并保持选中的归档便签',
    archiveBefore.archiveTab === '归档箱' &&
    archiveAfter.archiveTab === '归档箱' &&
    archiveAfter.activeNote === 'ZZTEST-C',
    { before: archiveBefore, after: archiveAfter })

  // ============ 需求 3：章节导航拖动 / 隐藏 / 恢复 ============
  // 回到「当前」视图（上一段停在归档视图）
  await evaluate(`window.__bm.clickArchive('当前便签')`)
  await sleep(500)
  await evaluate(`window.__bm.clickNote('ZZTEST-A')`)
  await waitFor(`document.querySelector('.markdown-preview-outline')`)
  await sleep(500)
  const outlineInitial = await evaluate(`window.__bm.outline()`)
  console.log('[outline initial]', JSON.stringify(outlineInitial))
  check('预览态显示章节导航与拖动条', outlineInitial.visible && outlineInitial.resizer && outlineInitial.items >= 2, outlineInitial)

  // 拖宽 +70px（向左拖）
  const dragged = await evaluate(`(async () => {
    const nav = document.querySelector('.markdown-preview-outline')
    const startWidth = Math.round(nav.getBoundingClientRect().width)
    const left = nav.getBoundingClientRect().left
    window.__bm.drag('.markdown-preview-outline-resizer', left, left - 70)
    await new Promise((resolve) => setTimeout(resolve, 200))
    return {
      startWidth,
      width: Math.round(nav.getBoundingClientRect().width),
      stored: JSON.parse(localStorage.getItem(${JSON.stringify(OUTLINE_KEY)}) || '{}'),
      handlersCleared: await window.__bm.resizeHandlersCleared()
    }
  })()`)
  console.log('[outline drag]', JSON.stringify(dragged))
  check('拖动分隔条调整目录宽度并写入本地存储',
    dragged.width === dragged.startWidth + 70 && dragged.stored.width === dragged.width,
    dragged)
  check('拖动结束后移除 document 级拖动监听', dragged.handlersCleared === true, dragged.handlersCleared)

  // 极限值钳制：上限 420，同时不超过预览面板可用空间的 46%
  const clamped = await evaluate(`(async () => {
    const nav = document.querySelector('.markdown-preview-outline')
    const paneWidth = document.querySelector('.markdown-preview-pane').getBoundingClientRect().width
    const left = nav.getBoundingClientRect().left
    window.__bm.drag('.markdown-preview-outline-resizer', left, left - 2000)
    await new Promise((resolve) => setTimeout(resolve, 150))
    const wide = Math.round(nav.getBoundingClientRect().width)
    window.__bm.drag('.markdown-preview-outline-resizer', left, left + 2000)
    await new Promise((resolve) => setTimeout(resolve, 150))
    return { wide, narrow: Math.round(nav.getBoundingClientRect().width), cap: Math.round(paneWidth * 0.46), paneWidth: Math.round(paneWidth) }
  })()`)
  console.log('[outline clamp]', JSON.stringify(clamped))
  check('拖动宽度被限制在合理区间（最小 140，最大不超过可用空间）',
    clamped.wide === Math.min(420, clamped.cap) && clamped.narrow === 140,
    clamped)

  // 隐藏 / 恢复
  const hidden = await evaluate(`(async () => {
    window.__bm.drag('.markdown-preview-outline-resizer', 600, 600 - 40)
    await new Promise((resolve) => setTimeout(resolve, 150))
    const widthBeforeHide = Math.round(document.querySelector('.markdown-preview-outline').getBoundingClientRect().width)
    await window.__bm.clickOutline('.markdown-preview-outline-toggle')
    await new Promise((resolve) => setTimeout(resolve, 250))
    return {
      widthBeforeHide,
      afterHide: window.__bm.outline(),
      stored: JSON.parse(localStorage.getItem(${JSON.stringify(OUTLINE_KEY)}) || '{}'),
      contentWidth: Math.round(document.querySelector('.markdown-preview-scroll').getBoundingClientRect().width)
    }
  })()`)
  console.log('[outline hide]', JSON.stringify(hidden))
  check('隐藏目录后导航消失并出现恢复入口',
    hidden.afterHide.visible === false && hidden.afterHide.restore === true && hidden.stored.hidden === true,
    hidden)

  // 隐藏状态在切 tab 后仍然保持，恢复后宽度一致
  await evaluate(`location.hash = '#/tasks'`)
  await sleep(600)
  await evaluate(`location.hash = '#/notepad'`)
  await waitFor(`document.querySelector('.notepad-view')`, 15000)
  await sleep(1200)
  await evaluate(PROBES)
  const afterReturnOutline = await evaluate(`window.__bm.outline()`)
  console.log('[outline after tab switch]', JSON.stringify(afterReturnOutline))
  check('切回后仍保持隐藏状态（恢复入口可见）',
    afterReturnOutline.visible === false && afterReturnOutline.restore === true,
    afterReturnOutline)

  const restored = await evaluate(`(async () => {
    await window.__bm.clickOutline('.markdown-preview-outline-restore')
    await new Promise((resolve) => setTimeout(resolve, 250))
    return { ...window.__bm.outline(), stored: JSON.parse(localStorage.getItem(${JSON.stringify(OUTLINE_KEY)}) || '{}') }
  })()`)
  console.log('[outline restore]', JSON.stringify(restored))
  check('恢复入口可重新显示目录并沿用记忆宽度',
    restored.visible === true &&
    restored.stored.hidden === false &&
    restored.width === hidden.widthBeforeHide + 0 &&
    restored.width === Math.max(140, Math.min(420, hidden.widthBeforeHide)),
    restored)

  // 无标题便签：不显示空栏，也没有恢复入口
  await evaluate(`window.__bm.clickNote('ZZTEST-B')`)
  await sleep(600)
  const noHeadings = await evaluate(`window.__bm.outline()`)
  console.log('[outline no headings]', JSON.stringify(noHeadings))
  check('无标题便签不显示空目录栏，也不显示恢复入口',
    noHeadings.visible === false && noHeadings.resizer === false && noHeadings.restore === false,
    noHeadings)

  // 分屏模式不显示目录（先选中便签再切分屏：点开便签默认预览是预期行为）
  await evaluate(`window.__bm.clickNote('ZZTEST-A')`)
  await waitFor(`document.querySelector('.markdown-preview-outline')`)
  await evaluate(`window.__bm.clickMode('分屏')`)
  await waitFor(`document.querySelector('.editor-split-resizer')`)
  await waitFor(`!document.querySelector('.markdown-preview-outline')`)
  await sleep(400)
  const splitState = await evaluate(`(async () => ({ ...window.__bm.outline(), ...(await window.__bm.mode()), split: Boolean(document.querySelector('.editor-split-resizer')), textarea: Boolean(document.querySelector('.markdown-body-textarea')) }))()`)
  console.log('[outline split]', JSON.stringify(splitState))
  check('分屏模式不显示章节导航/拖动条，且分屏未被破坏',
    splitState.visible === false && splitState.resizer === false && splitState.split === true && splitState.textarea === true,
    splitState)

  // 编辑态光标可用，且目录栏随过渡结束后移除
  await evaluate(`window.__bm.clickMode('编辑')`)
  await waitFor(`document.querySelector('.markdown-body-textarea')`)
  await waitFor(`!document.querySelector('.markdown-preview-outline')`)
  const caret = await evaluate(`(async () => {
    const textarea = document.querySelector('.markdown-body-textarea')
    textarea.focus()
    textarea.setSelectionRange(3, 3)
    await new Promise((resolve) => setTimeout(resolve, 100))
    return {
      focused: document.activeElement === textarea,
      selectionStart: textarea.selectionStart,
      outline: Boolean(document.querySelector('.markdown-preview-outline')),
      resizer: Boolean(document.querySelector('.markdown-preview-outline-resizer'))
    }
  })()`)
  console.log('[edit caret]', JSON.stringify(caret))
  check('编辑模式光标正常且不显示目录栏',
    caret.focused && caret.selectionStart === 3 && caret.outline === false && caret.resizer === false,
    caret)

  // —— 清理测试数据 ——
  const cleanup = await evaluate(`(async () => {
    const notes = await window.electronAPI.getDesktopNotes()
    let removed = 0
    for (const note of notes || []) {
      if ((note.title || '').startsWith('ZZTEST-')) { await window.electronAPI.deleteDesktopNote(note.id); removed += 1 }
    }
    return removed
  })()`)
  console.log('[cleanup] removed', cleanup)
  await evaluate(`localStorage.removeItem(${JSON.stringify(UI_STATE_KEY)}); localStorage.removeItem(${JSON.stringify(OUTLINE_KEY)})`)

  const failed = checks.filter((c) => !c.ok)
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
  if (errors.length) console.log('[page errors]', JSON.stringify(errors.slice(0, 5)))
  ws.close()
  process.exit(failed.length ? 1 : 0)
}

main().catch((err) => { console.error(err); process.exit(1) })
