// 真机（Electron + CDP）验证本轮改动：
//   A. 便签眼睛预览态：toolbar 命令后 Ctrl/Cmd+Z 能恢复内容与 DOM 光标，Ctrl+Shift+Z 重做
//   B. 娱乐中心 6 个站点，抖音 url/partition 正确
//   C. 每日任务在外部（IPC / MCP 同路径）写入后 2 秒内自动刷新，无需切 tab
//   D. 章节导航超长标题换行不撑宽
//   E. 删除后顶部胶囊提示 + 撤回，撤回后便签 id / 项目关联不变
//
// 需要先用一次性数据目录启动：
//   npm run dev:vite
//   NODE_ENV=development npx electron . --remote-debugging-port=9231 --user-data-dir=/tmp/bm-verify-undo
// 然后: BONGMASTER_CDP_PORT=9231 node scripts/cdp-verify-undo-toast.mjs
import http from 'node:http'

const DEBUG_PORT = Number(process.env.BONGMASTER_CDP_PORT || 9231)
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

const checks = []
const check = (name, ok, detail) => {
  checks.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail === undefined ? '' : ` -> ${JSON.stringify(detail)}`}`)
}

async function main() {
  let targets = null
  for (let i = 0; i < 40; i++) {
    try { targets = await httpJson('/json/list'); break } catch { await sleep(500) }
  }
  if (!targets) { console.error('CDP 端口不可达'); process.exit(1) }
  const page = targets.find((t) => t.type === 'page' && t.url.includes('localhost:5173'))
  if (!page) { console.error('找不到应用窗口 target', targets.map((t) => t.url)); process.exit(1) }

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
  const waitFor = async (expression, timeout = 12000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await evaluate(`(() => { try { return Boolean(${expression}) } catch { return false } })()`)) return true
      await sleep(200)
    }
    return false
  }

  const PROBES = `
    window.__bmv = {
      go: async (hash) => {
        location.hash = hash
        await new Promise((r) => setTimeout(r, 600))
        return location.hash
      },
      hidden: () => document.hidden,
      note: async (title) => {
        for (let i = 0; i < 40; i += 1) {
          const item = [...document.querySelectorAll('.note-item')]
            .find((el) => (el.querySelector('.note-title')?.textContent || '').trim() === title)
          if (item) { item.click(); await new Promise((r) => setTimeout(r, 400)); return true }
          await new Promise((r) => setTimeout(r, 150))
        }
        return false
      },
      previewRoot: () => document.querySelector('.markdown-preview-content.is-editable'),
      // 选中预览里第 blockIndex 个文本节点的一段，模拟用户拖选
      selectText: (needle) => {
        const root = document.querySelector('.markdown-preview-content.is-editable')
        if (!root) return null
        root.focus({ preventScroll: true })
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        let node = walker.nextNode()
        while (node) {
          const idx = node.nodeValue.indexOf(needle)
          if (idx !== -1) {
            const range = document.createRange()
            range.setStart(node, idx)
            range.setEnd(node, idx + needle.length)
            const sel = getSelection()
            sel.removeAllRanges()
            sel.addRange(range)
            return { text: sel.toString() }
          }
          node = walker.nextNode()
        }
        return null
      },
      caretAtEnd: (needle) => {
        const root = document.querySelector('.markdown-preview-content.is-editable')
        if (!root) return false
        root.focus({ preventScroll: true })
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        let node = walker.nextNode()
        while (node) {
          const idx = node.nodeValue.indexOf(needle)
          if (idx !== -1) {
            const range = document.createRange()
            range.setStart(node, idx + needle.length)
            range.collapse(true)
            const sel = getSelection()
            sel.removeAllRanges()
            sel.addRange(range)
            return true
          }
          node = walker.nextNode()
        }
        return false
      },
      key: (init) => {
        const root = document.querySelector('.markdown-preview-content.is-editable')
        if (!root) return false
        const event = new KeyboardEvent('keydown', Object.assign({ bubbles: true, cancelable: true }, init))
        root.dispatchEvent(event)
        return event.defaultPrevented
      },
      // 在光标处插入文本（走 beforeinput + input，和真实输入同路径）
      typeAtCaret: (text) => {
        const root = document.querySelector('.markdown-preview-content.is-editable')
        const sel = getSelection()
        if (!root || !sel || !sel.rangeCount) return false
        const range = sel.getRangeAt(0)
        root.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }))
        range.deleteContents()
        const node = document.createTextNode(text)
        range.insertNode(node)
        range.setStart(node, node.length)
        range.collapse(true)
        sel.removeAllRanges()
        sel.addRange(range)
        root.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
        return true
      },
      preview: () => {
        const root = document.querySelector('.markdown-preview-content.is-editable')
        return {
          html: root ? root.innerHTML : null,
          text: root ? root.textContent : null,
          strong: root ? root.querySelectorAll('strong').length : 0,
          selection: (getSelection() || {}).toString?.() || ''
        }
      },
      outline: () => {
        const nav = document.querySelector('.markdown-preview-outline')
        if (!nav) return null
        const items = [...nav.querySelectorAll('.markdown-preview-outline-item')]
        // 文本行数要量文字（Range），block 元素的 getClientRects 只会给一个边框矩形
        const textLines = (el) => {
          const range = document.createRange()
          range.selectNodeContents(el)
          return range.getClientRects().length
        }
        return {
          texts: items.map((el) => (el.textContent || '').trim()),
          navWidth: Math.round(nav.getBoundingClientRect().width),
          maxScrollWidth: items.reduce((max, el) => Math.max(max, el.scrollWidth), 0),
          maxClientWidth: items.reduce((max, el) => Math.max(max, el.clientWidth), 0),
          lines: items.map(textLines)
        }
      },
      entertainment: () => ({
        tabs: [...document.querySelectorAll('.tab-btn span')].map((el) => el.textContent.trim()),
        webviews: [...document.querySelectorAll('webview')].map((el) => ({
          src: el.getAttribute('src'),
          partition: el.getAttribute('partition')
        })),
        address: document.querySelector('.address-bar input')?.value || null
      }),
      clickTab: (label) => {
        const tab = [...document.querySelectorAll('.tab-btn')].find((el) => el.textContent.trim() === label)
        if (!tab) return false
        tab.click()
        return true
      },
      dailyRows: () => [...document.querySelectorAll('.bm-daily-task')],
      dailyTitles: () => [...document.querySelectorAll('.bm-daily-task .bm-task-text')]
        .map((el) => el.textContent.trim()),
      dailyHas: (needle) => [...document.querySelectorAll('.bm-daily-task')]
        .some((el) => (el.textContent || '').includes(needle)),
      dailyDate: () => document.querySelector('.bm-page-header input[type=date]')?.value || null,
      deleteDaily: (title) => {
        const row = [...document.querySelectorAll('.bm-daily-task')]
          .find((el) => (el.textContent || '').includes(title))
        if (!row) return false
        const button = [...row.querySelectorAll('button')].find((b) => b.getAttribute('title') === '删除')
        if (!button) return false
        button.click()
        return true
      },
      expandDaily: (title) => {
        const row = [...document.querySelectorAll('.bm-daily-task')]
          .find((el) => (el.textContent || '').includes(title))
        if (!row) return false
        const button = [...row.querySelectorAll('button')].find((b) => b.getAttribute('title') === '展开子任务')
        if (!button) return false
        button.click()
        return true
      },
      toast: () => {
        const el = document.querySelector('.undo-toast')
        if (!el) return null
        return {
          text: el.textContent.trim(),
          action: el.querySelector('.undo-toast-action')?.textContent.trim() || null,
          hasClose: Boolean(el.querySelector('.undo-toast-close'))
        }
      },
      clickToast: () => {
        const button = document.querySelector('.undo-toast .undo-toast-action')
        if (!button) return false
        button.click()
        return true
      },
      deleteCurrentNote: () => {
        const button = document.querySelector('.toolbar-btn.delete-btn')
        if (!button) return false
        button.click()
        return true
      }
    };
    true
  `
  await evaluate(PROBES)

  // ================= A. 预览态撤回/重做 =================
  const stamp = Date.now()
  const noteTitle = `ZZTEST-UNDO-${stamp}`
  await evaluate(PROBES)
  await evaluate(`window.__bmv.go('#/notepad')`)
  await waitFor(`document.querySelector('.note-sidebar, .notepad-sidebar, .note-list')`)

  const note = await evaluate(`window.electronAPI.createDesktopNote({ title: ${JSON.stringify(noteTitle)}, content: 'alpha beta gamma' })`)
  check('A0 测试便签创建成功', Boolean(note?.id), note?.id)

  await evaluate(`location.reload()`)
  await sleep(1500)
  await evaluate(PROBES)
  const opened = await evaluate(`window.__bmv.note(${JSON.stringify(noteTitle)})`)
  check('A1 打开测试便签', opened === true)
  check('A2 默认进入可编辑预览态', await waitFor(`document.querySelector('.markdown-preview-content.is-editable')`))

  // --- toolbar 命令（加粗）+ 撤回 ---
  const selected = await evaluate(`window.__bmv.selectText('beta')`)
  check('A3 选中 beta', selected?.text === 'beta', selected)
  const prevented = await evaluate(`window.__bmv.key({ key: 'b', ctrlKey: true })`)
  check('A4 Ctrl+B 被预览面板接管', prevented === true)
  await waitFor(`document.querySelector('.markdown-preview-content.is-editable strong')`)
  const afterBold = await evaluate(`window.__bmv.preview()`)
  check('A5 加粗生效（DOM 出现 strong）', afterBold?.strong === 1, afterBold?.strong)
  await sleep(1600)
  const boldContent = await evaluate(`
    (async () => {
      const notes = await window.electronAPI.getDesktopNotes({ includeArchived: false })
      return notes.find((n) => n.id === ${note.id})?.content || null
    })()
  `)
  check('A6 加粗后的 markdown 已落库', String(boldContent || '').includes('**beta**'), boldContent)

  // 撤回
  const undoPrevented = await evaluate(`window.__bmv.key({ key: 'z', ctrlKey: true })`)
  check('A7 Ctrl+Z 被预览面板接管', undoPrevented === true)
  await sleep(300)
  const afterUndo = await evaluate(`window.__bmv.preview()`)
  check('A8 撤回后粗体消失', afterUndo?.strong === 0, afterUndo?.strong)
  check('A9 撤回后 DOM 光标恢复成原来的选中区', afterUndo?.selection === 'beta', afterUndo?.selection)
  await sleep(1600)
  const undoContent = await evaluate(`
    (async () => {
      const notes = await window.electronAPI.getDesktopNotes({ includeArchived: false })
      return notes.find((n) => n.id === ${note.id})?.content || null
    })()
  `)
  check('A10 撤回后的 markdown 已落库', undoContent === 'alpha beta gamma', undoContent)

  // 重做
  await evaluate(`window.__bmv.key({ key: 'z', ctrlKey: true, shiftKey: true })`)
  await sleep(300)
  const afterRedo = await evaluate(`window.__bmv.preview()`)
  check('A11 Ctrl+Shift+Z 重做回粗体', afterRedo?.strong === 1, afterRedo?.strong)

  // Ctrl+Y 也能重做（先撤回再试 Y）
  await evaluate(`window.__bmv.key({ key: 'z', ctrlKey: true })`)
  await sleep(200)
  await evaluate(`window.__bmv.key({ key: 'y', ctrlKey: true })`)
  await sleep(300)
  const afterY = await evaluate(`window.__bmv.preview()`)
  check('A12 Ctrl+Y 同样能重做', afterY?.strong === 1, afterY?.strong)

  // 普通输入 + 撤回
  await evaluate(`window.__bmv.key({ key: 'z', ctrlKey: true })`)
  await sleep(250)
  await evaluate(`window.__bmv.caretAtEnd('gamma')`)
  await evaluate(`window.__bmv.typeAtCaret(' DELTA')`)
  await sleep(200)
  const afterTyping = await evaluate(`window.__bmv.preview()`)
  check('A13 输入进入内容', String(afterTyping?.text || '').includes('DELTA'), afterTyping?.text)
  await evaluate(`window.__bmv.key({ key: 'z', ctrlKey: true })`)
  await sleep(300)
  const afterTypingUndo = await evaluate(`window.__bmv.preview()`)
  check('A14 输入也能撤回', !String(afterTypingUndo?.text || '').includes('DELTA'), afterTypingUndo?.text)

  // ================= A15. textarea 的撤回不受影响 =================
  const textareaProbe = await evaluate(`
    (() => {
      const button = [...document.querySelectorAll('.editor-mode-switch .mode-btn')]
        .find((el) => el.getAttribute('title') === '分屏')
      if (!button) return null
      button.click()
      return true
    })()
  `)
  check('A15 切到分屏模式', textareaProbe === true)
  await sleep(500)
  const textareaUndo = await evaluate(`
    (() => {
      const textarea = document.querySelector('.markdown-body-textarea')
      if (!textarea) return null
      const event = new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true, cancelable: true })
      textarea.dispatchEvent(event)
      return {
        editablePreview: Boolean(document.querySelector('.markdown-preview-content.is-editable')),
        hijacked: event.defaultPrevented
      }
    })()
  `)
  // 预览面板的 keydown 只挂在 .markdown-preview-content 上（split 下它是 textarea 的兄弟
  // 节点，事件到不了），且 editable=false 时直接 return；textarea 的 Cmd+Z 仍由
  // MarkdownTextareaEditor 自己的既有实现（execCommand undo）处理。
  check('A16 分屏下预览面板不接管撤销（textarea 走既有实现）', textareaUndo?.editablePreview === false, textareaUndo)
  await evaluate(`
    (() => {
      const button = [...document.querySelectorAll('.editor-mode-switch .mode-btn')]
        .find((el) => el.getAttribute('title') === '预览')
      if (button) button.click()
      return true
    })()
  `)
  await sleep(500)

  // ================= D. 章节导航长标题换行 =================
  const longHeading = `ZZTEST 超长标题 ${'https://example.com/very/long/path/segment/'.repeat(3)}end`
  await sleep(1600)
  await evaluate(`
    (async () => {
      const notes = await window.electronAPI.getDesktopNotes({ includeArchived: false })
      const target = notes.find((n) => n.id === ${note.id})
      await window.electronAPI.updateDesktopNote(${note.id}, Object.assign({}, target, { content: '# ' + ${JSON.stringify(longHeading)} + '\\n\\nalpha beta gamma' }))
    })()
  `)
  const outlineReady = await waitFor(`document.querySelectorAll('.markdown-preview-outline-item').length > 0`)
  check('D1 目录生成', outlineReady)
  const outline = await evaluate(`window.__bmv.outline()`)
  check('D2 长标题换行（多于一行）', (outline?.lines?.[0] || 0) > 1, outline?.lines)
  check(
    'D3 目录不被长 URL 撑宽（无横向溢出）',
    Boolean(outline) && outline.maxScrollWidth <= outline.maxClientWidth + 1,
    outline && { scrollWidth: outline.maxScrollWidth, clientWidth: outline.maxClientWidth, navWidth: outline.navWidth }
  )

  // ================= E. 删除便签 + 胶囊撤回 =================
  const project = await evaluate(`window.electronAPI.createProject({ name: 'ZZTEST-UNDO-PROJECT-${stamp}' })`)
  await evaluate(`window.electronAPI.setDesktopNoteProjects(${note.id}, [${project.id}])`)
  await evaluate(`location.reload()`)
  await sleep(1500)
  await evaluate(PROBES)
  await evaluate(`window.__bmv.note(${JSON.stringify(noteTitle)})`)
  await sleep(500)

  const deleted = await evaluate(`window.__bmv.deleteCurrentNote()`)
  check('E1 点击工具栏删除', deleted === true)
  await waitFor(`document.querySelector('.undo-toast')`)
  const toast = await evaluate(`window.__bmv.toast()`)
  check('E2 顶部胶囊提示出现', Boolean(toast), toast)
  check('E3 提示写明"已删除"并带撤回按钮', Boolean(toast?.action === '撤回' && toast.text.includes('已删除')), toast)
  check('E4 提示有关闭按钮', toast?.hasClose === true)

  const gone = await evaluate(`
    (async () => {
      const notes = await window.electronAPI.getDesktopNotes({ includeArchived: true })
      return notes.some((n) => n.id === ${note.id})
    })()
  `)
  check('E5 便签确实已删除', gone === false)

  // 切到别的页面，撤回入口不能丢
  await evaluate(`window.__bmv.go('#/daily-tasks')`)
  await sleep(400)
  const toastAfterNav = await evaluate(`window.__bmv.toast()`)
  check('E6 切换页面后提示仍在', Boolean(toastAfterNav), toastAfterNav)

  const clicked = await evaluate(`window.__bmv.clickToast()`)
  check('E7 点击撤回', clicked === true)
  await sleep(800)
  const restored = await evaluate(`
    (async () => {
      const notes = await window.electronAPI.getDesktopNotes({ includeArchived: true })
      const found = notes.find((n) => n.id === ${note.id})
      return found ? { id: found.id, title: found.title, project_ids: found.project_ids || [] } : null
    })()
  `)
  check('E8 撤回后便签用回原 id', restored?.id === note.id, restored)
  check('E9 撤回后项目关联也恢复', JSON.stringify(restored?.project_ids || []) === JSON.stringify([project.id]), restored?.project_ids)
  check('E10 撤回后提示收起', (await evaluate(`window.__bmv.toast()`)) === null)

  // ================= B. 娱乐中心抖音 =================
  await evaluate(`window.__bmv.go('#/entertainment')`)
  await waitFor(`document.querySelectorAll('.tab-btn').length >= 6`)
  await sleep(600)
  const ent = await evaluate(`window.__bmv.entertainment()`)
  check('B1 站点数 = 6', ent?.tabs?.length === 6, ent?.tabs)
  check('B2 含抖音', (ent?.tabs || []).includes('抖音'), ent?.tabs)
  const douyin = (ent?.webviews || []).find((w) => w.partition === 'persist:douyin')
  check('B3 抖音 webview src 正确', douyin?.src === 'https://www.douyin.com/jingxuan', douyin)
  check(
    'B4 原有 5 个站点仍在',
    ['persist:xiaohongshu', 'persist:bilibili', 'persist:youtube', 'persist:instagram', 'persist:x']
      .every((p) => (ent?.webviews || []).some((w) => w.partition === p)),
    (ent?.webviews || []).map((w) => w.partition)
  )
  await evaluate(`window.__bmv.clickTab('抖音')`)
  await sleep(500)
  const entAfterClick = await evaluate(`window.__bmv.entertainment()`)
  check('B5 切到抖音后地址栏显示抖音', String(entAfterClick?.address || '').includes('douyin'), entAfterClick?.address)

  // ================= F. 项目级联删除 + 撤回（不能只恢复项目壳） =================
  const projName = `ZZTEST-PROJ-${stamp}`
  const proj = await evaluate(`window.electronAPI.createProject({ name: ${JSON.stringify(projName)} })`)
  const projTaskA = await evaluate(`window.electronAPI.createTask({ project_id: ${proj.id}, name: 'ZZTEST-TASK-A' })`)
  const projTaskB = await evaluate(`window.electronAPI.createTask({ project_id: ${proj.id}, name: 'ZZTEST-TASK-B', status: '已完成' })`)
  const projNote = await evaluate(`window.electronAPI.createDesktopNote({ title: 'ZZTEST-PROJ-NOTE-${stamp}', content: '', project_ids: [${proj.id}] })`)
  await evaluate(`
    window.electronAPI.uploadDocument(${proj.id}, { name: 'zztest.txt', size: 3, type: 'text/plain', data: [1,2,3] })
  `)
  const beforeProjectDelete = await evaluate(`window.electronAPI.getProjectById(${proj.id})`)
  check(
    'F1 项目删除前拿到任务/附件/便签',
    beforeProjectDelete?.tasks?.length === 2 && beforeProjectDelete?.documents?.length === 1 && beforeProjectDelete?.notes?.length === 1,
    { tasks: beforeProjectDelete?.tasks?.length, docs: beforeProjectDelete?.documents?.length, notes: beforeProjectDelete?.notes?.length }
  )

  await evaluate(`window.confirm = () => true`) // 项目删除仍有确认框，这里只验撤回
  await evaluate(`window.__bmv.go('#/projects/${proj.id}')`)
  await waitFor(`document.querySelector('.bm-page-header .bm-btn-danger')`)
  await evaluate(`document.querySelector('.bm-page-header .bm-btn-danger')?.click()`)
  await waitFor(`document.querySelector('.undo-toast')`)
  const projToast = await evaluate(`window.__bmv.toast()`)
  check('F2 项目删除后出现提示', projToast?.action === '撤回', projToast)
  const projGone = await evaluate(`window.electronAPI.getProjectById(${proj.id})`)
  check('F3 项目已删除', projGone === null)

  await evaluate(`window.__bmv.clickToast()`)
  await sleep(1200)
  const projBack = await evaluate(`window.electronAPI.getProjectById(${proj.id})`)
  check('F4 撤回后项目用回原 id', projBack?.id === proj.id, projBack?.name)
  check(
    'F5 撤回后项目任务用回原 id',
    JSON.stringify((projBack?.tasks || []).map((t) => t.id).sort()) === JSON.stringify([projTaskA.id, projTaskB.id].sort()),
    (projBack?.tasks || []).map((t) => t.id)
  )
  check(
    'F6 撤回后任务完成状态保留',
    (projBack?.tasks || []).find((t) => t.id === projTaskB.id)?.status === '已完成',
    (projBack?.tasks || []).find((t) => t.id === projTaskB.id)?.status
  )
  check('F7 撤回后附件恢复', (projBack?.documents || []).length === 1, (projBack?.documents || []).map((d) => d.id))
  const docDownload = await evaluate(`
    (async () => {
      const detail = await window.electronAPI.getProjectById(${proj.id})
      const doc = (detail.documents || [])[0]
      if (!doc) return null
      const data = await window.electronAPI.downloadDocument(doc.id)
      return data ? { size: (data.data || []).length } : null
    })()
  `)
  check('F8 撤回后附件内容仍可下载', docDownload?.size === 3, docDownload)
  check(
    'F9 撤回后便签关联恢复',
    JSON.stringify((projBack?.notes || []).map((n) => n.id)) === JSON.stringify([projNote.id]),
    (projBack?.notes || []).map((n) => n.id)
  )

  // 项目任务（任务板抽屉）删除 + 撤回
  await evaluate(`window.__bmv.go('#/tasks')`)
  await waitFor(`document.querySelector('.bm-page-header')`)
  const boardDeleted = await evaluate(`
    (async () => {
      await window.electronAPI.deleteTask(${projTaskA.id})
      return true
    })()
  `)
  check('F10 直接调用删除接口（任务板撤回闭包依赖的同一路径）', boardDeleted === true)
  await evaluate(`window.electronAPI.restoreEntities('tasks', [${projTaskA.id}])`)
  const taskBack = await evaluate(`
    (async () => {
      const tasks = await window.electronAPI.getAllTasks()
      return tasks.some((t) => t.id === ${projTaskA.id})
    })()
  `)
  check('F11 项目任务撤回后回到任务列表', taskBack === true)

  // ================= C. 每日任务外部刷新 =================
  await evaluate(`window.__bmv.go('#/daily-tasks')`)
  await waitFor(`document.querySelector('.daily-console-card')`)
  await sleep(600)
  const hidden = await evaluate(`window.__bmv.hidden()`)
  check('C0 应用窗口可见（document.hidden=false）', hidden === false, hidden)

  const date = await evaluate(`window.__bmv.dailyDate()`)
  const liveTitle = `ZZTEST-LIVE-${stamp}`
  const titlesBefore = await evaluate(`window.__bmv.dailyTitles()`)
  await evaluate(`window.electronAPI.createDailyTask({ title: ${JSON.stringify(liveTitle)}, date: ${JSON.stringify(date)}, priority: '中' })`)
  const appeared = await waitFor(`window.__bmv.dailyHas(${JSON.stringify(liveTitle)})`, 8000)
  const titlesAfter = await evaluate(`window.__bmv.dailyTitles()`)
  check('C1 外部写入的每日任务 2 秒内自动出现在列表中（未切 tab）', appeared === true, { titlesBefore, titlesAfter })

  // 外部改标题 → 列表跟着变
  const liveId = await evaluate(`
    (async () => {
      const tasks = await window.electronAPI.getDailyTasksByDate(${JSON.stringify(date)})
      return tasks.find((t) => t.title === ${JSON.stringify(liveTitle)})?.id || null
    })()
  `)
  const renamedTitle = `${liveTitle}-RENAMED`
  await evaluate(`
    (async () => {
      const tasks = await window.electronAPI.getDailyTasksByDate(${JSON.stringify(date)})
      const task = tasks.find((t) => t.id === ${liveId})
      await window.electronAPI.updateDailyTask(${liveId}, Object.assign({}, task, { title: ${JSON.stringify(renamedTitle)} }))
    })()
  `)
  const renamed = await waitFor(`window.__bmv.dailyHas(${JSON.stringify(renamedTitle)})`, 8000)
  check('C2 外部改名后列表自动更新', renamed === true, await evaluate(`window.__bmv.dailyTitles()`))

  // 外部完成 → 完成状态与进度自动更新
  const beforeComplete = await evaluate(`document.querySelector('.bm-card-header .bm-badge')?.textContent.trim() || ''`)
  await evaluate(`window.electronAPI.toggleDailyTaskComplete(${liveId}, true)`)
  const badgeChanged = await waitFor(
    `(document.querySelector('.bm-card-header .bm-badge')?.textContent.trim() || '') !== ${JSON.stringify(beforeComplete)}`,
    8000
  )
  const afterComplete = await evaluate(`document.querySelector('.bm-card-header .bm-badge')?.textContent.trim() || ''`)
  check('C3 外部完成后完成计数自动更新', badgeChanged === true, { before: beforeComplete, after: afterComplete })

  // 外部新增子任务 → 子任务进度自动更新
  const sub = await evaluate(`window.electronAPI.createDailySubtask(${liveId}, { title: 'ZZTEST-SUB' })`)
  const progressShown = await waitFor(`
    (() => {
      const row = [...document.querySelectorAll('.bm-daily-task')].find((el) => el.textContent.includes(${JSON.stringify(renamedTitle)}))
      return Boolean(row) && /\\d+\\/1/.test(row.textContent)
    })()
  `, 8000)
  check('C4 外部新增子任务后进度自动更新', progressShown === true, sub?.id)
  await evaluate(`window.__bmv.expandDaily(${JSON.stringify(renamedTitle)})`)
  const subShown = await waitFor(`window.__bmv.dailyHas('ZZTEST-SUB')`, 4000)
  check('C4b 展开后能看到外部写入的子任务', subShown === true)

  // 弹窗打开时暂停刷新（不覆盖正在编辑的内容）
  await evaluate(`
    (() => {
      const row = [...document.querySelectorAll('.bm-daily-task')].find((el) => el.textContent.includes(${JSON.stringify(renamedTitle)}))
      const edit = row && [...row.querySelectorAll('button')].find((b) => b.getAttribute('title') === '编辑')
      if (edit) edit.click()
      return Boolean(edit)
    })()
  `)
  await waitFor(`document.querySelector('.bm-modal-overlay.show')`)
  const modalOpen = await evaluate(`Boolean(document.querySelector('.bm-modal-overlay.show'))`)
  check('C5 打开编辑弹窗', modalOpen === true)
  if (modalOpen) {
    await evaluate(`window.electronAPI.createDailyTask({ title: 'ZZTEST-PAUSED-${stamp}', date: ${JSON.stringify(date)}, priority: '低' })`)
    await sleep(3200)
    const paused = await evaluate(`window.__bmv.dailyHas('ZZTEST-PAUSED-${stamp}')`)
    check('C6 弹窗打开期间暂停外部刷新（不覆盖编辑态）', paused === false, paused)
    await evaluate(`document.querySelector('.bm-modal-overlay.show .bm-modal-close')?.click()`)
    await sleep(2600)
    const resumed = await evaluate(`window.__bmv.dailyHas('ZZTEST-PAUSED-${stamp}')`)
    check('C7 关闭弹窗后恢复正常刷新', resumed === true, resumed)
  }

  // 每日任务删除 + 撤回
  const titlesBeforeDelete = await evaluate(`window.__bmv.dailyTitles()`)
  const deleteClicked = await evaluate(`window.__bmv.deleteDaily(${JSON.stringify(renamedTitle)})`)
  check('E11a 点击每日任务删除按钮', deleteClicked === true)
  await waitFor(`document.querySelector('.undo-toast')`)
  const dailyToast = await evaluate(`window.__bmv.toast()`)
  check('E11 每日任务删除后出现提示', dailyToast?.action === '撤回', dailyToast)
  const dailyGone = await evaluate(`!window.__bmv.dailyHas(${JSON.stringify(renamedTitle)})`)
  check('E12 每日任务确实已从列表移除', dailyGone === true, { titlesBeforeDelete })
  await evaluate(`window.__bmv.clickToast()`)
  await sleep(1200)
  const dailyBack = await waitFor(`window.__bmv.dailyHas(${JSON.stringify(renamedTitle)})`, 8000)
  check('E13 撤回后每日任务回到列表', dailyBack === true, await evaluate(`window.__bmv.dailyTitles()`))
  await evaluate(`window.__bmv.expandDaily(${JSON.stringify(renamedTitle)})`)
  const dailyBackSubtasks = await waitFor(`window.__bmv.dailyHas('ZZTEST-SUB')`, 4000)
  check('E14 撤回后子任务也回来', dailyBackSubtasks === true)

  // ================= 收尾 =================
  await evaluate(`
    (async () => {
      const tasks = await window.electronAPI.getDailyTasksByDate(${JSON.stringify(date)})
      for (const task of tasks) {
        if (String(task.title).startsWith('ZZTEST')) await window.electronAPI.deleteDailyTask(task.id)
      }
      const notes = await window.electronAPI.getDesktopNotes({ includeArchived: true })
      for (const n of notes) {
        if (String(n.title).startsWith('ZZTEST')) await window.electronAPI.deleteDesktopNote(n.id)
      }
      const projects = await window.electronAPI.getAllProjects()
      for (const p of projects) {
        if (String(p.name).startsWith('ZZTEST')) await window.electronAPI.deleteProject(p.id)
      }
    })()
  `)
  check('Z1 页面运行期间无未捕获异常', errors.length === 0, errors.slice(0, 3))

  const failed = checks.filter((c) => !c.ok)
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
  if (failed.length) {
    console.log('FAILED: ' + failed.map((c) => c.name).join(' | '))
    process.exitCode = 1
  }
  ws.close()
}

main().catch((err) => {
  console.error('verify failed:', err)
  process.exit(1)
})
