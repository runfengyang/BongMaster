// §13① 内存/泄漏压测：40 轮详情开关 + 页签切换 + 堆采样，找 OOM 型闪退
// 用法: node scripts/cdp-mem-stress.mjs   依赖: vite(5173) + electron . --remote-debugging-port=9222 已启动
import http from 'node:http'
import net from 'node:net'
import crypto from 'node:crypto'

const { MOD_JOKERS } = await import('../src/balatro/data/modJokers.js')
const DEBUG_PORT = 9222
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
    this.host = u.hostname; this.port = Number(u.port); this.path = u.pathname + u.search
    this.buf = Buffer.alloc(0); this.frags = []
    this.handlers = { message: [], open: [] }
    this.id = 0; this.pending = new Map()
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

async function main() {
  let targets = null
  for (let i = 0; i < 40; i++) {
    try { targets = await httpJson('/json/list'); break } catch { await sleep(500) }
  }
  if (!targets) { console.error('CDP 端口不可达'); process.exit(1) }
  const page = targets.find(t => t.type === 'page' && t.url.includes('localhost:5173'))
  if (!page) { console.error('找不到应用窗口 target'); process.exit(1) }

  const ws = new MiniWS(page.webSocketDebuggerUrl)
  const crashes = []
  ws.on('message', m => ws.dispatch(m))
  ws.onEvent = (ev) => {
    if (ev.method === 'Runtime.exceptionThrown') {
      const d = ev.params.exceptionDetails
      crashes.push('exceptionThrown: ' + (d?.exception?.description || d?.text || '').slice(0, 400))
    }
    if (ev.method === 'Inspector.targetCrashed') crashes.push('RENDERER CRASHED')
  }
  await ws.connect()
  await ws.call('Runtime.enable')
  await ws.call('Page.enable')
  await ws.call('Inspector.enable')
  await ws.call('HeapProfiler.enable')

  const evaluate = async (expr) => {
    const r = await ws.call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    return r?.result?.value
  }
  const alive = async () => {
    try { const t = await httpJson('/json/list'); return t.some(x => x.id === page.id) } catch { return false }
  }
  const heapMB = async () => {
    const m = await evaluate(`(performance.memory ? performance.memory.usedJSHeapSize / 1048576 : -1)`)
    return Math.round(m * 10) / 10
  }

  // 注入全量发现存档
  const now = new Date().toISOString()
  const seedState = {
    version: 1, savedAt: now, run: null,
    collection: {
      discovered: [
        'j_joker', 'j_greedy_joker', 'j_canio', 'j_triboulet', 'j_yorick', 'j_chicot', 'j_perkeo',
        'c_fool', 'p_mercury', 's_familiar', 's_soul',
        ...MOD_JOKERS.map(j => j.id),
      ],
      ownedCards: [{ id: 'j_joker', edition: 'foil', obtainedAt: now }],
    },
    settings: { volume: 0.5, muted: true, animations: true },
    productivity: { count: 0, pendingMoney: 0, pendingPacks: [], streak: 0 },
  }
  await evaluate(`window.electronAPI.balatroSave(${JSON.stringify(JSON.stringify(seedState))})`)
  await evaluate(`location.hash='#/cards'; location.reload()`)
  await sleep(6000)

  const tabs = ['小丑', '塔罗', '星球', '幻灵', 'Mod']
  const samples = []
  samples.push(['baseline', await heapMB()])
  let crashed = false
  for (let round = 0; round < 40 && !crashed; round++) {
    const tab = tabs[round % tabs.length]
    await evaluate(`[...document.querySelectorAll('.cv-tab')].find(b => b.innerText.trim() === '${tab}')?.click()`)
    await sleep(160)
    // 打开详情（点第一个已发现格）
    await evaluate(`(() => { const c = [...document.querySelectorAll('.cv-grid .cv-cell')].find(x => !x.classList.contains('undiscovered')); c?.click(); return true })()`)
    await sleep(160)
    // 详情内猛滑触发倾斜
    await evaluate(`(() => {
      const el = document.querySelector('.cv-detail .pc-wrap')
      if (el) { const r = el.getBoundingClientRect()
        for (let i = 0; i < 10; i++) el.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + i * 8, clientY: r.top + 100 - i * 8, bubbles: true })) }
      return true })()`)
    await sleep(120)
    await evaluate(`document.querySelector('.cv-detail-close')?.click()`)
    await sleep(120)
    if (round % 8 === 7) {
      await evaluate(`window.gc ? window.gc() : 0`)
      samples.push([`round${round + 1}`, await heapMB()])
      if (!await alive() || crashes.length) { crashed = true; console.error(`💥 crash at round ${round + 1}`) }
    }
  }
  console.log('[heap MB]', JSON.stringify(samples))
  // DOM 节点数（泄漏另一指标）
  const nodes = await evaluate(`document.querySelectorAll('*').length`)
  console.log('[dom nodes]', nodes)
  console.log('[crashes]', crashes.length ? crashes.join('\n') : 'none')
  console.log('[alive]', await alive())
  process.exit(crashes.length ? 1 : 0)
}
main().catch(e => { console.error('DRIVER FAIL', e); process.exit(1) })
