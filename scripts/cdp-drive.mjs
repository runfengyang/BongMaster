// 通过 CDP 驱动真实 BongMaster Electron 应用（含 preload/IPC/SQLite 完整环境）
// 用法: node scripts/cdp-drive.mjs [steps...]   依赖: electron . --remote-debugging-port=9222 已启动
// 零依赖：内置最小 WebSocket 客户端。
import http from 'node:http'
import net from 'node:net'
import crypto from 'node:crypto'

const DEBUG_PORT = 9222
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

function httpJson(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: DEBUG_PORT, path }, res => {
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
      if (op === 9) { this.sendRaw(0x8A, payload); continue } // ping→pong
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
      this.handlers.message.forEach(f => { }) // events handled via onEvent
      this.onEvent && this.onEvent(obj)
    }
  }
}

async function main() {
  // 等调试端口就绪
  let targets = null
  for (let i = 0; i < 40; i++) {
    try { targets = await httpJson('/json/list'); break } catch { await sleep(500) }
  }
  if (!targets) { console.error('CDP 端口不可达'); process.exit(1) }
  const page = targets.find(t => t.type === 'page' && t.url.includes('localhost:5173'))
  if (!page) { console.error('找不到应用窗口 target', targets.map(t => t.url)); process.exit(1) }
  console.log('[target]', page.url)

  const ws = new MiniWS(page.webSocketDebuggerUrl)
  const consoleErrors = []
  ws.on('message', m => ws.dispatch(m))
  ws.onEvent = (ev) => {
    if (ev.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(ev.params.exceptionDetails?.exception?.description || JSON.stringify(ev.params).slice(0, 300))
    }
    if (ev.method === 'Runtime.consoleAPICalled' && ev.params.type === 'error') {
      consoleErrors.push(ev.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300))
    }
    if (ev.method === 'Inspector.targetCrashed') {
      console.log('!!! RENDERER CRASHED (Inspector.targetCrashed) !!!')
      consoleErrors.push('RENDERER CRASHED')
    }
  }
  await ws.connect()
  await ws.call('Runtime.enable')
  await ws.call('Page.enable')
  await ws.call('Inspector.enable')

  const evaluate = async (expr) => {
    const r = await ws.call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    return r?.result?.value
  }
  const alive = async () => {
    try { const t = await httpJson('/json/list'); return t.some(x => x.id === page.id) } catch { return false }
  }

  // —— 步骤 1: 图鉴页 ——
  console.log('\n--- STEP: #/cards ---')
  await evaluate(`location.hash='#/cards'`)
  await sleep(8000)
  console.log('[alive after /cards]', await alive())
  console.log('[page text]', JSON.stringify((await evaluate(`(document.body.innerText||'').slice(0,150)`)) || ''))

  // —— 步骤 2: 游戏页新 Run ——
  console.log('\n--- STEP: #/entertainment ---')
  await evaluate(`location.hash='#/entertainment'`)
  await sleep(5000)
  console.log('[alive]', await alive())
  const click = async (texts) => await evaluate(`(() => {
    const want=${JSON.stringify(texts)}
    for (const w of want) {
      const el=[...document.querySelectorAll('button,a,[role=button]')].find(e=>e.offsetParent&&(e.innerText||'').includes(w))
      if(el){el.click();return 'clicked:'+(el.innerText||'').trim().slice(0,30)}
    }
    return null })()`)
  console.log('[menu]', JSON.stringify(await click(['新 Run', '开始'])))
  await sleep(2000)
  console.log('[deck]', JSON.stringify(await evaluate(`(()=>{const c=document.querySelector('[class*=deck]');if(c){c.click();return 'ok'}return null})()`)))
  await sleep(2500)
  console.log('[blind]', JSON.stringify(await click(['选择', '迎战', '挑战'])))
  await sleep(4000)
  console.log('[round text]', JSON.stringify((await evaluate(`(document.body.innerText||'').slice(0,200)`)) || ''))
  // 选 2 张牌出牌
  await evaluate(`(()=>{const els=[...document.querySelectorAll('[class*=card]')].filter(e=>e.offsetParent&&/[AKQJ2-9]|10/.test(e.innerText||''));els.slice(0,2).forEach(e=>e.click());return els.length})()`)
  await sleep(1000)
  console.log('[play]', JSON.stringify(await click(['出牌'])))
  await sleep(8000)
  console.log('[alive after play]', await alive())
  console.log('[after play text]', JSON.stringify((await evaluate(`(document.body.innerText||'').slice(0,200)`)) || ''))

  console.log('\n===== CDP DRIVE RESULT =====')
  console.log('[target alive]', await alive())
  console.log(consoleErrors.length ? '[errors]\n' + consoleErrors.slice(0, 20).join('\n---\n') : 'NO PAGE ERRORS')
  process.exit(0)
}
main().catch(e => { console.error('DRIVER FAIL', e); process.exit(1) })
