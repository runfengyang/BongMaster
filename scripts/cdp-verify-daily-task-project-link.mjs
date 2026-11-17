// 每日任务关联活跃项目 · 真机隔离 profile E2E
//   A. UI：快捷添加选项目 → 完成每日任务 → 首页活跃项目卡片进度更新；
//      既有非活跃关联在编辑时保留（不被静默解除），手动改成"不关联"才解除
//   B. MCP（真实 --mcp-server stdio）：关联 / 解除 / 非法与非活跃项目被拒绝
//
// 用一次性 user-data-dir（不碰真实库），生产构建产物（dist/renderer）由本脚本启动。
// 用法: node scripts/cdp-verify-daily-task-project-link.mjs
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

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const checks = []
const check = (name, ok, detail) => {
  checks.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail === undefined ? '' : ` -> ${JSON.stringify(detail)}`}`)
}

function httpJson(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
      let body = ''
      res.on('data', d => { body += d })
      res.on('end', () => { try { resolve(JSON.parse(body)) } catch (err) { reject(err) } })
    }).on('error', reject)
  })
}

// ===== Part A: UI（CDP）=====

async function startApp() {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-e2e-ui-'))
  const port = 9310 + Math.floor(Math.random() * 300)
  const child = spawn(electronBin, [
    '.',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`
  ], { cwd: projectRoot, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', () => {})
  child.stderr.on('data', () => {})

  let targets = null
  for (let i = 0; i < 60; i++) {
    try { targets = await httpJson(port, '/json/list'); if (targets.some(t => t.type === 'page')) break } catch {}
    await sleep(500)
  }
  if (!targets) throw new Error('CDP 端口不可达')
  const page = targets.find(t => t.type === 'page' && t.url.includes('index.html'))
  if (!page) throw new Error(`找不到应用窗口 target: ${targets.map(t => t.url).join(', ')}`)
  return { child, profileDir, port, page }
}

function connectCdp(page) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    const pending = new Map()
    const runtimeErrors = []
    let nextId = 0
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id && pending.has(msg.id)) {
        const { resolve: res, reject: rej } = pending.get(msg.id)
        pending.delete(msg.id)
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result)
        return
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        runtimeErrors.push(msg.params?.exceptionDetails?.exception?.description || 'exception')
      }
    })
    ws.addEventListener('open', () => resolve({
      runtimeErrors,
      evaluate: (expression) => new Promise((res, rej) => {
        const id = ++nextId
        pending.set(id, {
          resolve: (result) => {
            if (result?.exceptionDetails) {
              rej(new Error(result.exceptionDetails.exception?.description || 'eval failed'))
            } else {
              res(result?.result?.value)
            }
          },
          reject: rej
        })
        ws.send(JSON.stringify({
          id,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true }
        }))
        setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('CDP eval timeout')) } }, 30000)
      }),
      close: () => ws.close()
    }))
    ws.addEventListener('error', reject)
  })
}

async function waitFor(cdp, expression, label, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      if (await cdp.evaluate(expression)) return true
    } catch {}
    await sleep(250)
  }
  check(label, false, '等待超时')
  return false
}

async function runUiChecks() {
  const { child, profileDir, page } = await startApp()
  const cdp = await connectCdp(page)
  try {
    await waitFor(cdp, `!!document.querySelector('.bm-page')`, 'UI：应用窗口加载完成')

    const seeded = await cdp.evaluate(`(async () => {
      const pad = (n) => String(n).padStart(2, '0')
      const now = new Date()
      const today = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())
      const active = await window.electronAPI.createProject({ name: 'E2E活跃项目', status: '进行中' })
      const toPause = await window.electronAPI.createProject({ name: 'E2E暂停项目', status: '进行中' })
      const linked = await window.electronAPI.createDailyTask({ title: '暂停项目任务', date: today, project_id: toPause.id })
      await window.electronAPI.updateProject(toPause.id, { status: '已暂停' })
      return { today, activeId: active.id, pausedId: toPause.id, linkedProjectId: linked.project_id, linkedName: linked.project_name }
    })()`)
    check('UI：种子项目/每日任务创建成功', !!seeded?.activeId, seeded)
    check('UI：暂停前建立的关联保留', seeded.linkedProjectId === seeded.pausedId, seeded.linkedProjectId)

    // 进入每日任务页
    await cdp.evaluate(`location.hash = '#/daily-tasks'`)
    await waitFor(cdp, `!!document.querySelector('.bm-quick-add input')`, 'UI：每日任务页渲染')

    // 快捷添加：填标题 + 下拉选活跃项目 + Enter
    const quick = await cdp.evaluate(`(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms))
      const select = document.querySelector('.quick-add-project')
      if (!select) return { error: 'no select' }
      select.value = '${seeded.activeId}'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      await sleep(50)
      const input = document.querySelector('.bm-quick-add-input-wrap input')
      input.value = 'E2E快捷任务'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await sleep(50)
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await sleep(800)
      return { selectValue: select.value }
    })()`)
    check('UI：快捷添加前已选中项目', quick?.selectValue === String(seeded.activeId), quick)

    const created = await cdp.evaluate(`(async () => {
      const tasks = await window.electronAPI.getDailyTasksByDate('${seeded.today}')
      const t = tasks.find(x => x.title === 'E2E快捷任务')
      return t ? { id: t.id, project_id: t.project_id, project_name: t.project_name } : null
    })()`)
    check('UI：快捷添加落库并带上 project_id', created?.project_id === seeded.activeId, created)

    const badge = await cdp.evaluate(`(() => {
      const row = [...document.querySelectorAll('.bm-daily-task')].find(r => r.innerText.includes('E2E快捷任务'))
      return row ? row.innerText : ''
    })()`)
    check('UI：任务行显示关联项目徽标', badge.includes('E2E活跃项目'), badge.slice(0, 80))
    check('UI：任务行不再显示标签 chip', !badge.includes('#'), badge.slice(0, 80))

    const pausedBadge = await cdp.evaluate(`(() => {
      const row = [...document.querySelectorAll('.bm-daily-task')].find(r => r.innerText.includes('暂停项目任务'))
      return row ? row.innerText : ''
    })()`)
    check('UI：已暂停项目的既有关联仍显示', pausedBadge.includes('E2E暂停项目'), pausedBadge.slice(0, 80))

    // 勾选完成
    await cdp.evaluate(`(() => {
      const row = [...document.querySelectorAll('.bm-daily-task')].find(r => r.innerText.includes('E2E快捷任务'))
      row.querySelector('input[type=checkbox]').click()
    })()`)
    await sleep(900)
    const completed = await cdp.evaluate(`(async () => {
      const tasks = await window.electronAPI.getDailyTasksByDate('${seeded.today}')
      const t = tasks.find(x => x.title === 'E2E快捷任务')
      return t ? { is_completed: !!t.is_completed, project_id: t.project_id } : null
    })()`)
    check('UI：勾选完成成功且关联保留', completed?.is_completed === true && completed.project_id === seeded.activeId, completed)

    // 首页活跃项目卡片
    await cdp.evaluate(`location.hash = '#/'`)
    await waitFor(cdp, `!!document.querySelector('.bm-rank-list')`, 'UI：首页活跃项目列表渲染')
    const rank = await cdp.evaluate(`(() => {
      const items = [...document.querySelectorAll('.bm-rank-item')].map(el => el.innerText.replace(/\\n/g, ' | '))
      return items
    })()`)
    const activeItem = (rank || []).find(t => t.includes('E2E活跃项目'))
    check('UI：首页活跃项目含关联每日任务进度 1/1', !!activeItem && activeItem.includes('1/1'), activeItem)
    check('UI：首页只显示未开始/进行中项目（暂停项目不出现）', !(rank || []).some(t => t.includes('E2E暂停项目')), rank)

    // 编辑既有非活跃关联：默认保留
    await cdp.evaluate(`location.hash = '#/daily-tasks'`)
    await waitFor(cdp, `!!document.querySelector('.bm-quick-add input')`, 'UI：返回每日任务页')
    const editState = await cdp.evaluate(`(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms))
      const row = [...document.querySelectorAll('.bm-daily-task')].find(r => r.innerText.includes('暂停项目任务'))
      row.querySelector('button[title="编辑"]').click()
      await sleep(300)
      const modal = [...document.querySelectorAll('.bm-modal-overlay')].find(m => m.classList.contains('show'))
      const select = [...modal.querySelectorAll('select')].find(s => [...s.options].some(o => o.textContent.includes('不关联项目')))
      const value = select.value
      const label = select.options[select.selectedIndex]?.textContent.trim()
      modal.querySelectorAll('.bm-modal-footer button').forEach(b => { if (b.innerText.includes('保存')) b.click() })
      await sleep(600)
      return { value, label }
    })()`)
    check('UI：编辑非活跃关联时下拉保留当前项目', editState?.value === String(seeded.pausedId) && editState.label.includes('已暂停'), editState)
    const keptAfterEdit = await cdp.evaluate(`(async () => {
      const tasks = await window.electronAPI.getDailyTasksByDate('${seeded.today}')
      const t = tasks.find(x => x.title === '暂停项目任务')
      return t ? t.project_id : 'missing'
    })()`)
    check('UI：原样保存不会静默解除关联', keptAfterEdit === seeded.pausedId, keptAfterEdit)

    // 手动改成"不关联项目" → 解除
    await cdp.evaluate(`(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms))
      const row = [...document.querySelectorAll('.bm-daily-task')].find(r => r.innerText.includes('暂停项目任务'))
      row.querySelector('button[title="编辑"]').click()
      await sleep(300)
      const modal = [...document.querySelectorAll('.bm-modal-overlay')].find(m => m.classList.contains('show'))
      const select = [...modal.querySelectorAll('select')].find(s => [...s.options].some(o => o.textContent.includes('不关联项目')))
      select.value = ''
      select.dispatchEvent(new Event('change', { bubbles: true }))
      await sleep(80)
      modal.querySelectorAll('.bm-modal-footer button').forEach(b => { if (b.innerText.includes('保存')) b.click() })
      await sleep(600)
    })()`)
    const unlinked = await cdp.evaluate(`(async () => {
      const tasks = await window.electronAPI.getDailyTasksByDate('${seeded.today}')
      const t = tasks.find(x => x.title === '暂停项目任务')
      return t ? { project_id: t.project_id, project_name: t.project_name } : null
    })()`)
    check('UI：下拉选不关联后解除关联', unlinked?.project_id === null && !unlinked.project_name, unlinked)

    check('UI：无渲染进程异常', cdp.runtimeErrors.length === 0, cdp.runtimeErrors.slice(0, 3))
  } finally {
    cdp.close()
    child.kill('SIGTERM')
    await sleep(800)
    try { fs.rmSync(profileDir, { recursive: true, force: true }) } catch {}
  }
}

// ===== Part B: MCP（真实 stdio）=====

function connectMcp(profileDir) {
  // --mcp-server 必须跑真正的 Electron 进程（ELECTRON_RUN_AS_NODE 下没有 app 模块）
  const child = spawn(electronBin, ['.', '--mcp-server', `--user-data-dir=${profileDir}`], {
    cwd: projectRoot,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const pending = new Map()
  let buffer = ''
  let nextId = 0
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString()
    let index = buffer.indexOf('\n')
    while (index !== -1) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (line) {
        try {
          const msg = JSON.parse(line)
          if (msg.id && pending.has(msg.id)) {
            pending.get(msg.id)(msg)
            pending.delete(msg.id)
          }
        } catch {}
      }
      index = buffer.indexOf('\n')
    }
  })
  child.stderr.on('data', () => {})

  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, resolve)
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`MCP timeout: ${method}`)) } }, 20000)
  })
  const notify = (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
  const callTool = async (name, args) => {
    const res = await request('tools/call', { name, arguments: args })
    const text = res?.result?.content?.map(c => c.text).join('\n') || ''
    return { text, isError: !!res?.result?.isError }
  }
  return { child, request, notify, callTool }
}

async function runMcpChecks() {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-e2e-mcp-'))
  const mcp = connectMcp(profileDir)
  try {
    const init = await mcp.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'e2e', version: '1.0.0' }
    })
    check('MCP：initialize 成功', !!init?.result, init?.error)

    const tools = await mcp.request('tools/list', {})
    const createTool = tools?.result?.tools?.find(t => t.name === 'create_daily_task')
    const updateTool = tools?.result?.tools?.find(t => t.name === 'update_daily_task')
    check('MCP：create_daily_task 暴露 project_id', !!createTool?.inputSchema?.properties?.project_id, Object.keys(createTool?.inputSchema?.properties || {}))
    check('MCP：update_daily_task 暴露 project_id', !!updateTool?.inputSchema?.properties?.project_id, Object.keys(updateTool?.inputSchema?.properties || {}))
    mcp.notify('notifications/initialized', {})

    const active = await mcp.callTool('create_project', { name: 'MCP活跃项目', status: '进行中' })
    const paused = await mcp.callTool('create_project', { name: 'MCP暂停项目', status: '已暂停' })
    const activeId = Number((active.text.match(/ID: (\d+)/) || [])[1])
    const pausedId = Number((paused.text.match(/ID: (\d+)/) || [])[1])
    check('MCP：项目创建成功', Number.isInteger(activeId) && Number.isInteger(pausedId), { activeId, pausedId })

    const created = await mcp.callTool('create_daily_task', { title: 'MCP关联任务', project_id: activeId })
    check('MCP：create 关联项目并在输出中体现', !created.isError && created.text.includes('关联项目「MCP活跃项目」'), created)
    const taskId = Number((created.text.match(/ID: (\d+)/) || [])[1])

    const listed = await mcp.callTool('get_daily_tasks', {})
    check('MCP：get_daily_tasks 输出项目名', listed.text.includes('项目:MCP活跃项目'), listed.text.split('\n').slice(0, 4))

    const rejected = await mcp.callTool('update_daily_task', { task_id: taskId, project_id: pausedId })
    check('MCP：拒绝关联非活跃项目', rejected.isError && rejected.text.includes('只能关联'), rejected)

    const notFound = await mcp.callTool('create_daily_task', { title: 'MCP非法任务', project_id: 999999 })
    check('MCP：拒绝不存在的项目', notFound.isError, notFound)

    const unlink = await mcp.callTool('update_daily_task', { task_id: taskId, project_id: null })
    check('MCP：null 解除关联', !unlink.isError && unlink.text.includes('已解除项目关联'), unlink)

    const afterUnlink = await mcp.callTool('get_daily_tasks', {})
    check('MCP：解除后不再显示项目', !afterUnlink.text.includes('项目:'), afterUnlink.text.split('\n').slice(0, 4))

    const relink = await mcp.callTool('update_daily_task', { task_id: taskId, project_id: activeId })
    check('MCP：可重新关联', !relink.isError && relink.text.includes('关联项目「MCP活跃项目」'), relink)
  } finally {
    mcp.child.kill('SIGTERM')
    await sleep(600)
    try { fs.rmSync(profileDir, { recursive: true, force: true }) } catch {}
  }
}

try {
  await runUiChecks()
  await runMcpChecks()
} catch (err) {
  check('E2E 执行未抛异常', false, err.message)
}

const failed = checks.filter(c => !c.ok)
console.log(failed.length === 0 ? '\nAll E2E checks passed.' : `\n${failed.length} E2E check(s) failed: ${failed.map(f => f.name).join('; ')}`)
process.exit(failed.length === 0 ? 0 : 1)
