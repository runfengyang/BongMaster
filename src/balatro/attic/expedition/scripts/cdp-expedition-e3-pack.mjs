// E3 CDP 补测：局内开包链路（PackModal pickMode）
// 前置：先用 node:sqlite 向 balatro_state 写入一个「packQueue 已有包」的远征存档，
//       再启动 electron 打开 /expedition → 开卡包 → 三选一/直接开 → 撕开 → 翻牌 → 选中 → 收下所选
// 用法: node scripts/cdp-expedition-e3-pack.mjs   （需 electron --remote-debugging-port=9222 运行中）
import http from 'node:http'
import net from 'node:net'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const DEBUG_PORT = 9222
const OUT = path.resolve('work/cdp-shots')
fs.mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

let pass = 0, fail = 0
const pageErrors = []
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ✔ ${name}`) }
  else { fail++; console.error(`  ✘ ${name}`) }
}

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
    this.buf = Buffer.alloc(0); this.frags = []; this.id = 0; this.pending = new Map()
  }
  connect() {
    return new Promise((resolve, reject) => {
      const key = crypto.randomBytes(16).toString('base64')
      this.sock = net.connect(this.port, this.host, () => {
        this.sock.write(`GET ${this.path} HTTP/1.1\r\nHost: ${this.host}:${this.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`)
      })
      let upgraded = false
      this.sock.on('data', d => {
        if (!upgraded) {
          const idx = d.indexOf('\r\n\r\n')
          if (idx === -1) return reject(new Error('WS handshake failed'))
          upgraded = true
          this.buf = Buffer.concat([this.buf, d.subarray(idx + 4)])
          this.drain(); resolve(); return
        }
        this.buf = Buffer.concat([this.buf, d]); this.drain()
      })
      this.sock.on('error', reject)
    })
  }
  drain() {
    while (true) {
      if (this.buf.length < 2) return
      const fin = (this.buf[0] & 0x80) !== 0, op = this.buf[0] & 0x0f
      let len = this.buf[1] & 0x7f, off = 2
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4 }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10 }
      if (this.buf.length < off + len) return
      const payload = this.buf.subarray(off, off + len)
      this.buf = this.buf.subarray(off + len)
      if (op === 9) { this.sendRaw(0x8A, payload); continue }
      if (op === 8) { this.sock.end(); return }
      this.frags.push(payload)
      if (fin) { const msg = Buffer.concat(this.frags).toString('utf8'); this.frags = []; this.dispatch(msg) }
    }
  }
  sendRaw(firstByte, payload) {
    const mask = crypto.randomBytes(4); const len = payload.length
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
      const to = setTimeout(() => reject(new Error('CDP timeout: ' + method)), 25000)
      this.pending.set(id, { resolve, reject, to })
    })
  }
  dispatch(msg) {
    let obj; try { obj = JSON.parse(msg) } catch { return }
    if (obj.id && this.pending.has(obj.id)) {
      const p = this.pending.get(obj.id); clearTimeout(p.to); this.pending.delete(obj.id)
      obj.error ? p.reject(new Error(JSON.stringify(obj.error))) : p.resolve(obj.result)
    } else if (obj.method && this.onEvent) this.onEvent(obj)
  }
}

async function main() {
  let targets = null
  for (let i = 0; i < 40; i++) { try { targets = await httpJson('/json/list'); break } catch { await sleep(500) } }
  const page = targets.find(t => t.type === 'page' && t.url.includes('index.html'))
  if (!page) { console.error('no page target'); process.exit(1) }

  const ws = new MiniWS(page.webSocketDebuggerUrl)
  ws.onEvent = (ev) => {
    if (ev.method === 'Runtime.exceptionThrown') {
      const d = ev.params.exceptionDetails?.exception?.description || ev.params.exceptionDetails?.text || ''
      pageErrors.push('EXC: ' + String(d).slice(0, 300)); console.log('!!EXC', String(d).slice(0, 300))
    }
    if (ev.method === 'Runtime.consoleAPICalled' && ev.params.type === 'error') {
      const t = ev.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300)
      pageErrors.push('ERR: ' + t); console.log('!!ERR', t)
    }
  }
  await ws.connect()
  await ws.call('Runtime.enable'); await ws.call('Page.enable')

  const ev = async (expr) => (await ws.call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }))?.result?.value
  const shot = async (name) => {
    const r = await ws.call('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'))
    console.log(`  📸 ${name}`)
  }
  const click = async (texts) => await ev(`(()=>{const want=${JSON.stringify(texts)};for(const w of want){const el=[...document.querySelectorAll('button,a,[role=button]')].find(e=>e.offsetParent&&(e.innerText||'').includes(w));if(el){el.click();return 'OK:'+(el.innerText||'').trim().slice(0,28)}}return null})()`)
  const has = async (sel) => !!(await ev(`!!document.querySelector(${JSON.stringify(sel)})`))
  const text = async (n = 300) => (await ev(`(document.body.innerText||'').slice(0,${n})`)) || ''
  const count = async (sel) => await ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`)

  await ev(`location.hash='#/expedition'`)
  await sleep(2500)

  console.log('== 1. 读档：packQueue 有包 ==')
  let packBtnReady = false
  for (let i = 0; i < 16 && !packBtnReady; i++) {
    packBtnReady = await ev(`!![...document.querySelectorAll('button')].find(e=>e.offsetParent&&(e.innerText||'').includes('开卡包'))`)
    if (!packBtnReady) await sleep(500)
  }
  ok(packBtnReady, '战场出现「开卡包」按钮')

  console.log('== 2. 开包队列 ==')
  console.log('  [开卡包]', await click(['开卡包']))
  await sleep(1000)
  ok(await has('.exp-packchoice'), '包队列面板弹出')
  await shot('e3-12a-pack-queue.png')
  console.log('  [选包]', await ev(`(()=>{const el=[...document.querySelectorAll('.exp-packchoice button')].find(e=>e.offsetParent&&e.innerText.includes('包'));if(el){el.click();return 'OK:'+el.innerText.slice(0,24)}return null})()`))
  await sleep(1000)
  ok(await has('.pm-overlay'), 'PackModal 弹出（sealed）')
  await shot('e3-12b-pack-sealed.png')

  console.log('== 3. 撕开 → 翻牌 ==')
  console.log('  [撕开]', await ev(`(()=>{const el=document.querySelector('.pm-sealed-wrap');if(el){el.click();return 'OK'}return null})()`))
  await sleep(2200)
  // 逐张翻开（按槽位下标各点一次，避免反复点同一张）
  const nSlots = await count('.pm-slot')
  for (let i = 0; i < nSlots; i++) {
    await ev(`(()=>{const el=document.querySelectorAll('.pm-slot')[${i}];if(el)el.querySelector('.pc-wrap').click();return 1})()`)
    await sleep(1100)
  }
  await shot('e3-12c-pack-opened.png')

  console.log('== 4. 选中 → 收下所选 ==')
  // 点已翻开的首卡 = 选中（pickMode）
  await ev(`(()=>{const el=document.querySelectorAll('.pm-slot')[0];if(el)el.querySelector('.pc-wrap').click();return 1})()`)
  await sleep(700)
  ok((await count('.pm-slot.selected')) >= 1, `选中态 ${await count('.pm-slot.selected')} 张`)
  await shot('e3-12d-pack-picked.png')
  console.log('  [收下所选]', await click(['收下所选']))
  await sleep(1800)
  ok(!(await has('.pm-overlay')), 'PackModal 关闭回战场')
  await shot('e3-12e-pack-done.png')

  console.log('\n===== E3 PACK CDP RESULT =====')
  ok(pageErrors.length === 0, `页面零 JS 错误（实际 ${pageErrors.length} 条）`)
  console.log(`结果：${pass} 通过 / ${fail} 失败`)
  process.exit(fail ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
