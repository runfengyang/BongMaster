// §19 金币 bug 修复实测（file:// 生产模式 + 独立临时 profile，不碰真实数据库）
// 流程：注入 gold=100 存档 → #/cards → 模拟打卡发奖（grantProductivityReward checkin）
//   → 断言 +2 且已落盘 → 刷新仍在 → 旧 blob（无 economy）写入不丢 economy（合并保护）
// 用法: ./node_modules/.bin/electron . --remote-debugging-port=9333 --user-data-dir=/tmp/bm-goldfix-profile
//       等 12 秒后 node scripts/cdp-shots-goldfix.mjs → work/cdp-shots/gold-fix-*.png
import http from 'node:http'
import net from 'node:net'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const DEBUG_PORT = 9333
const OUT = path.resolve('work/cdp-shots')
fs.mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

function httpJson(p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: DEBUG_PORT, path: p }, res => {
      let body = ''
      res.on('data', d => body += d)
      res.on('end', () => { try { resolve(JSON.parse(body)) } catch (e) { reject(e) } })
    }).on('error', reject)
  })
}

class MiniWS {
  constructor(url) {
    const u = new URL(url)
    this.host = u.hostname
    this.port = Number(u.port)
    this.path = u.pathname + u.search
    this.buf = Buffer.alloc(0)
    this.frags = []
    this.handlers = { message: [], open: [] }
    this.id = 0
    this.pending = new Map()
  }
  on(ev, fn) { this.handlers[ev].push(fn) }
  connect() {
    return new Promise((resolve, reject) => {
      const key = crypto.randomBytes(16).toString('base64')
      this.sock = net.connect(this.port, this.host, () => {
        this.sock.write(
          `GET ${this.path} HTTP/1.1\r\nHost: ${this.host}:${this.port}\r\n` +
          `Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\n` +
          `Sec-WebSocket-Version: 13\r\n\r\n`)
      })
      let upgraded = false
      this.sock.on('data', d => {
        if (!upgraded) {
          const idx = d.indexOf('\r\n\r\n')
          if (idx === -1) return reject(new Error('WS handshake failed'))
          upgraded = true
          this.buf = Buffer.concat([this.buf, d.subarray(idx + 4)])
          this.handlers.open.forEach(f => f())
          this.drain()
          return resolve()
        }
        this.buf = Buffer.concat([this.buf, d])
        this.drain()
      })
      this.sock.on('error', reject)
    })
  }
  drain() {
    while (true) {
      if (this.buf.length < 2) return
      const fin = (this.buf[0] & 0x80) !== 0
      const op = this.buf[0] & 0x0f
      let len = this.buf[1] & 0x7f
      let off = 2
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4 }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10 }
      if (this.buf.length < off + len) return
      const payload = this.buf.subarray(off, off + len)
      this.buf = this.buf.subarray(off + len)
      if (op === 9) { this.sendRaw(0x8A, payload); continue }
      if (op === 8) { this.sock.end(); return }
      this.frags.push(payload)
      if (fin) {
        const msg = Buffer.concat(this.frags).toString('utf8')
        this.frags = []
        this.handlers.message.forEach(f => f(msg))
      }
    }
  }
  sendRaw(firstByte, payload) {
    const mask = crypto.randomBytes(4)
    const len = payload.length
    let header
    if (len < 126) header = Buffer.from([firstByte, 0x80 | len])
    else if (len < 65536) { header = Buffer.alloc(4); header[0] = firstByte; header[1] = 0x80 | 126; header.writeUInt16BE(len, 2) }
    else { header = Buffer.alloc(10); header[0] = firstByte; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(len), 2) }
    const masked = Buffer.from(payload)
    for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i & 3]
    this.sock.write(Buffer.concat([header, mask, masked]))
  }
  call(method, params = {}) {
    const id = ++this.id
    this.sendRaw(0x81, Buffer.from(JSON.stringify({ id, method, params })))
    return new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('CDP timeout: ' + method)), 20000)
      this.pending.set(id, { resolve, reject, to })
    })
  }
  dispatch(msg) {
    let obj
    try { obj = JSON.parse(msg) } catch { return }
    if (obj.id && this.pending.has(obj.id)) {
      const p = this.pending.get(obj.id)
      clearTimeout(p.to)
      this.pending.delete(obj.id)
      obj.error ? p.reject(new Error(JSON.stringify(obj.error))) : p.resolve(obj.result)
    } else if (obj.method) {
      this.onEvent && this.onEvent(obj)
    }
  }
}

let pass = 0, fail = 0
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ✔ ${name}`) }
  else { fail++; console.error(`  ✘ ${name}`) }
}

async function main() {
  let targets = null
  for (let i = 0; i < 60; i++) {
    try {
      const t = await httpJson('/json/list')
      if (t.some(x => x.type === 'page' && x.url.includes('dist/renderer'))) { targets = t; break }
    } catch {}
    await sleep(500)
  }
  if (!targets) { console.error('CDP 端口不可达或窗口未出现'); process.exit(1) }
  const page = targets.find(t => t.type === 'page' && t.url.includes('dist/renderer'))
  console.log('[target]', page.url)

  const ws = new MiniWS(page.webSocketDebuggerUrl)
  const consoleErrors = []
  const crashes = []
  ws.on('message', m => ws.dispatch(m))
  ws.onEvent = (ev) => {
    if (ev.method === 'Runtime.exceptionThrown') {
      const d = ev.params.exceptionDetails
      crashes.push('exceptionThrown: ' + (d?.exception?.description || d?.text || '').slice(0, 400))
    }
    if (ev.method === 'Runtime.consoleAPICalled' && ev.params.type === 'error') {
      const text = ev.params.args.map(a => a.value ?? a.description ?? '').join(' ')
      if (!text.includes('favicon')) consoleErrors.push(text.slice(0, 300))
    }
    if (ev.method === 'Inspector.targetCrashed') crashes.push('RENDERER CRASHED')
    if (ev.method === 'Page.javascriptDialogOpening') {
      ws.call('Page.handleJavaScriptDialog', { accept: true }).catch(() => {})
    }
  }
  await ws.connect()
  await ws.call('Runtime.enable')
  await ws.call('Page.enable')
  await ws.call('Inspector.enable')
  await ws.call('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 2, mobile: false })

  const evaluate = async (expr) => {
    const r = await ws.call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    if (r?.exceptionDetails) return { __evalError: JSON.stringify(r.exceptionDetails).slice(0, 400) }
    return r?.result?.value
  }
  // 触发页面跳转/刷新用：不等待返回（执行上下文随即销毁，回包可能丢失）
  const evaluateFire = async (expr) => {
    try {
      await Promise.race([ws.call('Runtime.evaluate', { expression: expr }), sleep(1500)])
    } catch {}
  }
  const shot = async (name) => {
    const r = await ws.call('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'))
    console.log(`  📸 ${name}`)
  }
  const storeState = async () => {
    const raw = await evaluate(`(() => {
      const app = document.querySelector('#app').__vue_app__
      const pinia = app?.config?.globalProperties?.$pinia
      if (!pinia) return null
      for (const s of pinia._s.values()) {
        if (s.collection && s.collection.ownedCards !== undefined) return JSON.stringify({
          owned: (s.collection.ownedCards || []).length,
          gold: s.economy?.gold, packsOpened: s.economy?.packsOpened,
          count: s.productivity?.count, loaded: s.loaded,
        })
      }
      return null })()`)
    return raw ? JSON.parse(raw) : null
  }
  const callStore = async (fnCall) => {
    return evaluate(`(() => {
      const app = document.querySelector('#app').__vue_app__
      const pinia = app?.config?.globalProperties?.$pinia
      if (!pinia) return 'no-pinia'
      for (const s of pinia._s.values()) {
        if (s.collection && s.collection.ownedCards !== undefined) { ${fnCall}; return 'ok' }
      }
      return 'no-store' })()`)
  }
  const diskGold = async () => {
    const raw = await evaluate(`(async () => {
      const blob = await window.electronAPI.balatroLoad()
      const st = blob ? JSON.parse(blob) : null
      return st ? JSON.stringify({ gold: st.economy?.gold ?? null, count: st.productivity?.count ?? null }) : null })()`)
    return raw ? JSON.parse(raw) : null
  }

  // 等应用完成启动导航 + store init（过早 evaluate 会因执行上下文销毁被静默丢弃）
  const waitReady = async () => {
    for (let i = 0; i < 60; i++) {
      try {
        const s = await storeState()
        if (s?.loaded === true) return true
      } catch {}
      await sleep(500)
    }
    return false
  }

  // —— 注入 gold=100 存档并重载到 #/cards ——
  console.log('\n--- STEP: 注入 gold=100 存档并重载 ---')
  if (!await waitReady()) { console.error('应用未就绪'); process.exit(1) }
  const now = new Date().toISOString()
  const seedState = {
    version: 1, savedAt: now, run: null,
    collection: { discovered: ['j_joker', 'c_fool'], ownedCards: [
      { id: 'j_joker', edition: null, obtainedAt: now },
      { id: 'c_fool', edition: null, obtainedAt: now },
    ], newIds: [] },
    settings: { volume: 0.5, muted: true, animations: true },
    productivity: { count: 3, pendingMoney: 0, pendingPacks: [], streak: 0 },
    economy: { gold: 100, packsOpened: 2 },
  }
  await evaluate(`window.electronAPI.balatroSave(${JSON.stringify(JSON.stringify(seedState))})`)
  await evaluateFire(`location.hash='#/cards'; location.reload()`)
  ok(await waitReady(), '重载后应用就绪（store.loaded）')
  const s0 = await storeState()
  ok(s0?.gold === 100 && s0?.loaded === true, `存档加载：gold=100（实际 ${JSON.stringify(s0)}）`)
  await shot('gold-fix-01-before-checkin.png')

  // —— ① 模拟打卡发奖：+2 且落盘 ——
  console.log('\n--- STEP: 打卡发奖 +2 ---')
  const r1 = await callStore(`s.grantProductivityReward({ source: 'checkin' })`)
  ok(r1 === 'ok', `grantProductivityReward 调用成功（${r1}）`)
  await sleep(900) // 防抖 500ms + 余量
  const s1 = await storeState()
  ok(s1?.gold === 102, `打卡后金币 100→102（实际 ${s1?.gold}）`)
  ok(s1?.count === 4, `productivity.count 3→4（实际 ${s1?.count}）`)
  const d1 = await diskGold()
  ok(d1?.gold === 102 && d1?.count === 4, `磁盘已持久化 102 / count=4（实际 ${JSON.stringify(d1)}）`)
  await shot('gold-fix-02-after-checkin.png')

  // —— ② 刷新后仍在（不丢不涨回退） ——
  console.log('\n--- STEP: 刷新后金币仍在 ---')
  await evaluateFire(`location.reload()`)
  ok(await waitReady(), '刷新后应用就绪（store.loaded）')
  const s2 = await storeState()
  ok(s2?.gold === 102 && s2?.loaded === true, `刷新后金币仍为 102（实际 ${JSON.stringify(s2)}）`)
  await shot('gold-fix-03-after-reload.png')

  // —— ③ 合并保护：旧 blob（无 economy）写入不丢 economy ——
  console.log('\n--- STEP: 旧版本/并发写入合并保护 ---')
  const oldBlob = {
    version: 1, savedAt: new Date().toISOString(), run: null,
    collection: { discovered: ['j_joker'], ownedCards: [{ id: 'j_joker', edition: null, obtainedAt: now }], newIds: [] },
    settings: { volume: 0.5, muted: true, animations: true },
    // 旧版本 blob：无 economy / productivity 字段
  }
  await evaluate(`window.electronAPI.balatroSave(${JSON.stringify(JSON.stringify(oldBlob))})`)
  await sleep(500)
  const d2 = await diskGold()
  ok(d2?.gold === 102, `旧 blob 写入后磁盘金币仍 102（实际 ${JSON.stringify(d2)}）`)
  const ownedCheck = await evaluate(`(async () => {
    const st = JSON.parse(await window.electronAPI.balatroLoad())
    return st.collection?.ownedCards?.length ?? 0 })()`)
  ok(ownedCheck === 2, `ownedCards 取更长（2 张，未退化为旧 blob 的 1 张，实际 ${ownedCheck}）`)

  console.log('\n===== CDP SHOTS GOLD-FIX RESULT =====')
  console.log('[crashes]', crashes.length ? '\n' + crashes.join('\n---\n') : 'none')
  console.log(consoleErrors.length ? '[console errors]\n' + consoleErrors.slice(0, 20).join('\n---\n') : 'NO CONSOLE ERRORS')
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`)

  await sleep(800)
  process.exit(fail || crashes.length ? 1 : 0)
}
main().catch(e => { console.error('DRIVER FAIL', e); process.exit(1) })
