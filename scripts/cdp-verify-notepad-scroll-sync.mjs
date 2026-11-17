// 验证便签三种视图切换时的滚动位置同步（需先启动: npm run dev:vite 与
//   NODE_ENV=development npx electron . --remote-debugging-port=9222 --user-data-dir=/tmp/bm-verify-scroll）：
//   1. 眼睛预览滚到中部 → 分屏：右侧预览回到原位，左侧源码定位到相近内容（不再跳回顶部）
//   2. 分屏 → 编辑：textarea 停在相近内容位置
//   3. 编辑/分屏 → 预览：预览回到相近内容位置；分屏两栏来回切换不跳回顶部
//   4. 切换便签：没打开过的便签回到顶部；切回同一便签恢复离开时的位置
// 内容位置用「顶部可见文本」与 textarea 的插入点实测（与组件同口径的镜像测量）判断，
// 不依赖实现里的行高估算，因此能真正抓到"把位置算歪"的回归。
// 用法: node scripts/cdp-verify-notepad-scroll-sync.mjs
// 脚本会创建/删除 ZZTEST-* 测试数据，建议用一次性数据目录运行。
// 环境变量: BONGMASTER_CDP_PORT（默认 9222）
import http from 'node:http'

const DEBUG_PORT = Number(process.env.BONGMASTER_CDP_PORT || 9222)
const UI_STATE_KEY = 'bongmaster-notepad-ui-state'
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

// 每段、每句都带唯一编号：顶部可见文本既能当锚点，也能在源码里唯一定位。
// 段落是长行（会折行），正是"按行高除 scrollTop 会算错位置"的场景。
function longContent(tag, blocks) {
  const parts = []
  for (let i = 0; i < blocks; i += 1) {
    parts.push(`## ${tag} 小节 ${i}`)
    const sentences = []
    for (let j = 0; j < 14; j += 1) {
      sentences.push(`${tag} 第 ${i} 段第 ${j} 句正文内容。`)
    }
    parts.push(sentences.join(''))
  }
  return `${parts.join('\n\n')}\n`
}

const CONTENT_A = longContent('ZZTEST-A', 40)
const CONTENT_B = longContent('ZZTEST-B', 34)

const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim()

function nearText(a, b, need = 12) {
  const A = normalize(a)
  const B = normalize(b)
  if (!A || !B) return false
  return A.slice(0, need) === B.slice(0, need)
    || A.slice(0, 64).includes(B.slice(0, need))
    || B.slice(0, 64).includes(A.slice(0, need))
}

// snippet 是否出现在 offset 附近（容差 window 个字符，约一两行）
function nearSourceOffset(content, snippet, offset, window = 200) {
  const needle = normalize(snippet).slice(0, 12)
  if (!needle || offset < 0) return false
  return content.slice(Math.max(0, offset - window), offset + window).includes(needle)
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

  // 页面内探针：预览取顶部可见文本，textarea 取 rolloutTop 与"某个字符偏移应该滚到的位置"
  // （镜像测量，与组件同口径）。
  const PROBES = `
    window.__bm = {
      mode: async () => {
        for (let i = 0; i < 30; i += 1) {
          if (!document.querySelector('.editor-mode-panel-leave-active')) break
          await new Promise((resolve) => setTimeout(resolve, 60))
        }
        const active = [...document.querySelectorAll('.editor-mode-switch .mode-btn')]
          .find((button) => button.classList.contains('active'))
        return {
          mode: active?.getAttribute('title') || null,
          activeNote: (document.querySelector('.note-item.active .note-title')?.textContent || '').trim() || null,
          hasTextarea: Boolean(document.querySelector('.markdown-body-textarea')),
          hasPreview: Boolean(document.querySelector('.markdown-preview-scroll'))
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
      previewTop: () => {
        const pane = document.querySelector('.markdown-preview-scroll')
        if (!pane) return null
        const root = pane.querySelector('.markdown-preview-content')
        const range = Math.max(1, pane.scrollHeight - pane.clientHeight)
        const base = { text: '', ratio: pane.scrollTop / range, scrollTop: pane.scrollTop, atTop: pane.scrollTop < 4 }
        if (!root) return base
        const rect = pane.getBoundingClientRect()
        const paddingLeft = parseFloat(getComputedStyle(pane).paddingLeft) || 0
        const caret = document.caretRangeFromPoint?.(rect.left + paddingLeft + 2, rect.top + 4)
        let text = ''
        if (caret && root.contains(caret.startContainer) && caret.startContainer.nodeType === 3) {
          text = caret.startContainer.nodeValue.slice(caret.startOffset, caret.startOffset + 64)
        } else {
          for (const child of Array.from(root.children)) {
            if (child.getBoundingClientRect().bottom > rect.top + 4) {
              text = (child.textContent || '').slice(0, 64)
              break
            }
          }
        }
        return { ...base, text: text.replace(/\\s+/g, ' ').trim() }
      },
      scrollPreviewTo: (ratio) => {
        const pane = document.querySelector('.markdown-preview-scroll')
        if (!pane) return false
        pane.scrollTop = ratio * Math.max(0, pane.scrollHeight - pane.clientHeight)
        return pane.scrollTop > 0
      },
      editorTop: () => {
        const textarea = document.querySelector('.markdown-body-textarea')
        if (!textarea) return null
        const range = Math.max(1, textarea.scrollHeight - textarea.clientHeight)
        return {
          scrollTop: textarea.scrollTop,
          ratio: textarea.scrollTop / range,
          atTop: textarea.scrollTop < 4,
          value: textarea.value
        }
      },
      // 与组件 measureCaretTop 同口径：镜像 div 量出该偏移所在行的 y 坐标，
      // 也就是 textarea 为把它放到顶部应有的 scrollTop。
      scrollTopForOffset: (offset) => {
        const textarea = document.querySelector('.markdown-body-textarea')
        if (!textarea) return null
        const style = getComputedStyle(textarea)
        const shadow = document.createElement('div')
        const marker = document.createElement('span')
        for (const prop of ['direction', 'fontFamily', 'fontSize', 'fontStyle', 'fontVariant', 'fontWeight', 'letterSpacing', 'lineHeight', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'tabSize', 'textAlign', 'textIndent', 'textTransform', 'wordBreak', 'wordSpacing']) {
          shadow.style[prop] = style[prop]
        }
        Object.assign(shadow.style, {
          position: 'fixed', top: '0', left: '-99999px', boxSizing: 'border-box',
          width: textarea.clientWidth + 'px', height: 'auto', minHeight: '0', overflow: 'hidden',
          overflowWrap: style.overflowWrap || 'break-word', pointerEvents: 'none',
          visibility: 'hidden', whiteSpace: 'pre-wrap'
        })
        const value = textarea.value
        const safe = Math.max(0, Math.min(offset, value.length))
        shadow.textContent = value.slice(0, safe)
        marker.textContent = value.slice(safe) || '\\u200b'
        shadow.appendChild(marker)
        document.body.appendChild(shadow)
        const top = marker.offsetTop
        shadow.remove()
        return top
      },
      scrollEditorTo: (ratio) => {
        const textarea = document.querySelector('.markdown-body-textarea')
        if (!textarea) return false
        textarea.scrollTop = ratio * Math.max(0, textarea.scrollHeight - textarea.clientHeight)
        return textarea.scrollTop > 0
      }
    }
    true
  `

  await waitFor(`document.querySelector('.bm-navbar')`, 30000)

  await evaluate(`(async () => {
    const notes = await window.electronAPI.getDesktopNotes()
    for (const note of notes || []) {
      if ((note.title || '').startsWith('ZZTEST-')) await window.electronAPI.deleteDesktopNote(note.id)
    }
  })()`)
  const created = await evaluate(`(async () => {
    const api = window.electronAPI
    const a = await api.createDesktopNote({ title: 'ZZTEST-A', content: ${JSON.stringify(CONTENT_A)} })
    const b = await api.createDesktopNote({ title: 'ZZTEST-B', content: ${JSON.stringify(CONTENT_B)} })
    return { a: a?.id, b: b?.id }
  })()`)
  console.log('[created]', JSON.stringify(created))

  await evaluate(`localStorage.removeItem(${JSON.stringify(UI_STATE_KEY)}); location.hash = '#/notepad'; location.reload()`)
  await sleep(2500)
  if (!await waitFor(`document.querySelector('.notepad-view')`, 30000)) {
    console.error('便签页未渲染:', await evaluate(`(document.body.innerText || '').slice(0, 300)`))
    process.exit(1)
  }
  // 重载前页面可能还挂着上一次（含临时改动）的模块，异常只统计本次加载之后的。
  errors.length = 0
  await evaluate(PROBES)
  if (!await waitFor(`[...document.querySelectorAll('.note-item')].some((el) => (el.querySelector('.note-title')?.textContent || '').trim() === 'ZZTEST-A')`)) {
    console.error('测试便签未出现在列表')
    process.exit(1)
  }

  // ============ 0. 打开 A 进眼睛预览，滚到中部 ============
  await evaluate(`window.__bm.clickNote('ZZTEST-A')`)
  await waitFor(`document.querySelector('.markdown-preview-content')`)
  await sleep(500)
  const opened = await evaluate(`window.__bm.mode()`)
  check('打开便签进入眼睛预览', opened.mode === '预览' && opened.hasTextarea === false, opened)

  await evaluate(`window.__bm.scrollPreviewTo(0.55)`)
  await sleep(300)
  const previewStart = await evaluate(`window.__bm.previewTop()`)
  const anchorOffsetA = CONTENT_A.indexOf(normalize(previewStart.text).slice(0, 24))
  console.log('[preview scrolled]', JSON.stringify(previewStart), 'anchorOffset', anchorOffsetA)
  check('预览已滚到中部（前置条件）',
    previewStart.ratio > 0.45 && previewStart.ratio < 0.65 && anchorOffsetA > 0,
    { ratio: previewStart.ratio, anchorOffsetA })

  // ============ 1. 预览 → 分屏 ============
  await evaluate(`window.__bm.clickMode('分屏')`)
  await waitFor(`document.querySelector('.markdown-body-textarea') && document.querySelector('.markdown-preview-scroll')`)
  await sleep(500)
  const splitPreview = await evaluate(`window.__bm.previewTop()`)
  const splitEditor = await evaluate(`window.__bm.editorTop()`)
  const splitExpectedTop = await evaluate(`window.__bm.scrollTopForOffset(${anchorOffsetA})`)
  console.log('[preview -> split]', JSON.stringify({ splitPreview, editorScrollTop: splitEditor.scrollTop, expectedEditorTop: splitExpectedTop }))
  check('预览→分屏：右侧预览没有跳回顶部',
    splitPreview.ratio > 0.3 && !splitPreview.atTop,
    { ratio: splitPreview.ratio })
  check('预览→分屏：右侧预览停在原来的内容位置',
    nearText(previewStart.text, splitPreview.text),
    { before: previewStart.text.slice(0, 32), after: splitPreview.text.slice(0, 32) })
  check('预览→分屏：左侧源码停在相近内容位置（实测插入点，不是行高估算）',
    splitEditor.scrollTop > 4 && Math.abs(splitEditor.scrollTop - splitExpectedTop) < 80,
    { scrollTop: splitEditor.scrollTop, expected: splitExpectedTop, delta: splitEditor.scrollTop - splitExpectedTop })

  // ============ 2. 分屏 → 编辑 ============
  await evaluate(`window.__bm.clickMode('编辑')`)
  await waitFor(`document.querySelector('.markdown-body-textarea') && !document.querySelector('.markdown-preview-scroll')`)
  await sleep(500)
  const editTop = await evaluate(`window.__bm.editorTop()`)
  // 编辑态 textarea 更宽、折行更少，同一内容位置换算出的 px 与分屏态不同，必须重测。
  const editExpectedTop = await evaluate(`window.__bm.scrollTopForOffset(${anchorOffsetA})`)
  console.log('[split -> edit]', JSON.stringify({ scrollTop: editTop.scrollTop, ratio: editTop.ratio, expected: editExpectedTop }))
  check('分屏→编辑：textarea 没有跳回顶部',
    editTop.ratio > 0.3 && !editTop.atTop,
    { ratio: editTop.ratio })
  check('分屏→编辑：textarea 停在相近内容位置',
    Math.abs(editTop.scrollTop - editExpectedTop) < 80,
    { scrollTop: editTop.scrollTop, expected: editExpectedTop })

  // ============ 3. 编辑 → 预览 ============
  await evaluate(`window.__bm.clickMode('预览')`)
  await waitFor(`document.querySelector('.markdown-preview-content') && !document.querySelector('.markdown-body-textarea')`)
  await sleep(500)
  const backToPreview = await evaluate(`window.__bm.previewTop()`)
  console.log('[edit -> preview]', JSON.stringify(backToPreview))
  check('编辑→预览：预览没有跳回顶部',
    backToPreview.ratio > 0.3 && !backToPreview.atTop,
    { ratio: backToPreview.ratio })
  check('编辑→预览：预览停在相近内容位置',
    nearSourceOffset(CONTENT_A, backToPreview.text, anchorOffsetA),
    { text: normalize(backToPreview.text).slice(0, 32), anchorOffsetA })

  // ============ 4. 编辑滚到后段 → 分屏 → 预览，位置不回退 ============
  await evaluate(`window.__bm.clickMode('编辑')`)
  await waitFor(`document.querySelector('.markdown-body-textarea')`)
  await sleep(400)
  await evaluate(`window.__bm.scrollEditorTo(0.8)`)
  await sleep(300)
  const editorLate = await evaluate(`window.__bm.editorTop()`)
  await evaluate(`window.__bm.clickMode('分屏')`)
  await waitFor(`document.querySelector('.markdown-preview-scroll')`)
  await sleep(500)
  const splitLate = await evaluate(`window.__bm.previewTop()`)
  const splitLateEditor = await evaluate(`window.__bm.editorTop()`)
  console.log('[edit(0.8) -> split]', JSON.stringify({
    editorRatio: editorLate.ratio,
    splitEditorRatio: splitLateEditor.ratio,
    previewRatio: splitLate.ratio
  }))
  check('编辑(后段)→分屏：两栏都停在后段',
    splitLateEditor.ratio > 0.55 && splitLate.ratio > 0.55,
    { editorRatio: splitLateEditor.ratio, previewRatio: splitLate.ratio })

  await evaluate(`window.__bm.clickMode('预览')`)
  await waitFor(`!document.querySelector('.markdown-body-textarea')`)
  await sleep(500)
  const previewLate = await evaluate(`window.__bm.previewTop()`)
  console.log('[split -> preview]', JSON.stringify(previewLate))
  check('分屏→预览：预览停在后段而不是回到初始位置',
    previewLate.ratio > 0.55 && !previewLate.atTop,
    { ratio: previewLate.ratio })

  // ============ 5. 切换便签：没打开过回顶部，切回来恢复位置 ============
  await evaluate(`window.__bm.clickNote('ZZTEST-B')`)
  await waitFor(`document.querySelector('.markdown-preview-content')`)
  await sleep(700)
  const noteB = await evaluate(`window.__bm.previewTop()`)
  const modeB = await evaluate(`window.__bm.mode()`)
  console.log('[switch to B]', JSON.stringify({ mode: modeB.mode, activeNote: modeB.activeNote, ratio: noteB.ratio }))
  check('切到没打开过的便签：预览回到顶部',
    modeB.activeNote === 'ZZTEST-B' && noteB.atTop,
    { activeNote: modeB.activeNote, ratio: noteB.ratio })

  await evaluate(`window.__bm.scrollPreviewTo(0.6)`)
  await sleep(400)
  const bScrolled = await evaluate(`window.__bm.previewTop()`)
  await evaluate(`window.__bm.clickNote('ZZTEST-A')`)
  await waitFor(`document.querySelector('.markdown-preview-content')`)
  await sleep(800)
  const backToA = await evaluate(`window.__bm.previewTop()`)
  console.log('[B(0.6) -> A]', JSON.stringify({ restored: backToA.ratio, leftAt: previewLate.ratio, text: backToA.text.slice(0, 24) }))
  check('切回便签 A：恢复离开时的预览位置',
    !backToA.atTop && Math.abs(backToA.ratio - previewLate.ratio) < 0.08,
    { restored: backToA.ratio, leftAt: previewLate.ratio })

  await evaluate(`window.__bm.clickNote('ZZTEST-B')`)
  await waitFor(`document.querySelector('.markdown-preview-content')`)
  await sleep(800)
  const bRestored = await evaluate(`window.__bm.previewTop()`)
  console.log('[A -> B back]', JSON.stringify({ restored: bRestored.ratio, leftAt: bScrolled.ratio }))
  check('切回便签 B：恢复离开时的预览位置（内容也对得上）',
    !bRestored.atTop &&
    Math.abs(bRestored.ratio - bScrolled.ratio) < 0.08 &&
    nearText(bScrolled.text, bRestored.text, 20),
    { restored: bRestored.ratio, leftAt: bScrolled.ratio, before: bScrolled.text.slice(0, 24), after: bRestored.text.slice(0, 24) })

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
  await evaluate(`localStorage.removeItem(${JSON.stringify(UI_STATE_KEY)})`)

  check('页面无运行时异常', errors.length === 0, errors.slice(0, 3))

  const failed = checks.filter((c) => !c.ok)
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
  if (errors.length) console.log('[page errors]', JSON.stringify(errors.slice(0, 5)))
  ws.close()
  process.exit(failed.length ? 1 : 0)
}

main().catch((err) => { console.error(err); process.exit(1) })
