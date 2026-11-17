// 生产模式(file://)下图集加载验证：截图 + JS 检测图集可达性
import http from 'node:http'
import net from 'node:net'
import crypto from 'node:crypto'
import fs from 'node:fs'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
function httpJson(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: 9222, path }, res => {
      let b = ''; res.on('data', d => b += d); res.on('end', () => { try { resolve(JSON.parse(b)) } catch (e) { reject(e) } })
    }).on('error', reject)
  })
}
class MiniWS {
  constructor(url) { const u = new URL(url); this.host = u.hostname; this.port = +u.port; this.path = u.pathname; this.buf = Buffer.alloc(0); this.frags = []; this.id = 0; this.pending = new Map() }
  connect() { return new Promise((res, rej) => { const k = crypto.randomBytes(16).toString('base64'); this.sock = net.connect(this.port, this.host, () => { this.sock.write(`GET ${this.path} HTTP/1.1\r\nHost: ${this.host}:${this.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${k}\r\nSec-WebSocket-Version: 13\r\n\r\n`) }); let up = false; this.sock.on('data', d => { if (!up) { const i = d.indexOf('\r\n\r\n'); if (i < 0) return rej(new Error('hs')); up = true; this.buf = Buffer.concat([this.buf, d.subarray(i + 4)]); this.drain(); res(); return } this.buf = Buffer.concat([this.buf, d]); this.drain() }); this.sock.on('error', rej) }) }
  drain() { while (true) { if (this.buf.length < 2) return; const fin = (this.buf[0] & 0x80) !== 0, op = this.buf[0] & 15; let len = this.buf[1] & 127, off = 2; if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4 } else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10 } if (this.buf.length < off + len) return; const p = this.buf.subarray(off, off + len); this.buf = this.buf.subarray(off + len); if (op === 9) { this.send(0x8A, p); continue } if (op === 8) { this.sock.end(); return } this.frags.push(p); if (fin) { const m = Buffer.concat(this.frags).toString(); this.frags = []; this.dispatch(m) } } }
  send(f, p) { const m = crypto.randomBytes(4); const l = p.length; let h; if (l < 126) h = Buffer.from([f, 0x80 | l]); else if (l < 65536) { h = Buffer.alloc(4); h[0] = f; h[1] = 0x80 | 126; h.writeUInt16BE(l, 2) } else { h = Buffer.alloc(10); h[0] = f; h[1] = 0x80 | 127; h.writeBigUInt64BE(BigInt(l), 2) } const x = Buffer.from(p); for (let i = 0; i < x.length; i++) x[i] ^= m[i & 3]; this.sock.write(Buffer.concat([h, m, x])) }
  call(method, params = {}) { const id = ++this.id; this.send(0x81, Buffer.from(JSON.stringify({ id, method, params }))); return new Promise((res, rej) => { const to = setTimeout(() => rej(new Error('timeout ' + method)), 20000); this.pending.set(id, { res, rej, to }) }) }
  dispatch(m) { let o; try { o = JSON.parse(m) } catch { return } if (o.id && this.pending.has(o.id)) { const p = this.pending.get(o.id); clearTimeout(p.to); this.pending.delete(o.id); o.error ? p.rej(new Error(JSON.stringify(o.error))) : p.res(o.result) } }
}
const targets = await (async () => { for (let i = 0; i < 30; i++) { try { return await httpJson('/json/list') } catch { await sleep(500) } } throw new Error('no CDP') })()
const page = targets.find(t => t.type === 'page')
const ws = new MiniWS(page.webSocketDebuggerUrl)
await ws.connect()
const ev = async (e) => (await ws.call('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }))?.result?.value
await ev(`location.hash='#/cards'`)
await sleep(6000)
// 检测 5 个图集是否可加载
const check = await ev(`(async () => {
  const atlases = ['sprites/jokers.webp','sprites/tarots.webp','sprites/boosters.webp','sprites/vouchers.webp','sprites/enhancers.webp']
  const out = {}
  for (const a of atlases) {
    out[a] = await new Promise(r => { const im = new Image(); im.onload = () => r(im.naturalWidth + 'x' + im.naturalHeight); im.onerror = () => r('LOAD-FAIL'); im.src = a })
  }
  const spriteEls = document.querySelectorAll('[style*="sprites/"]').length
  const fontOk = document.fonts ? [...document.fonts].some(f => f.family.includes('m6x11') && f.status === 'loaded') : 'n/a'
  return { out, spriteEls, fontOk }
})()`)
console.log('图集加载:', JSON.stringify(check, null, 1))
const shot = await ws.call('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync('work/cdp-shots/verify-prod-cards.png', Buffer.from(shot.data, 'base64'))
console.log('截图: work/cdp-shots/verify-prod-cards.png')
process.exit(0)
