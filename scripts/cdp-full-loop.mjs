// 完整游戏动线 CDP 压测：新 Run → 出牌 → 商店 → 买包 → 开包 → 下一盲注
// 用法: node scripts/cdp-full-loop.mjs   （需 electron . --remote-debugging-port=9222 运行中）
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
  const page = targets.find(t => t.type === 'page' && t.url.includes('localhost:5173'))
  if (!page) { console.error('no target'); process.exit(1) }
  const ws = new MiniWS(page.webSocketDebuggerUrl)
  ws.onEvent = (ev) => {
    if (ev.method === 'Runtime.exceptionThrown') console.log('!!EXC', (ev.params.exceptionDetails?.exception?.description || '').slice(0, 400))
    if (ev.method === 'Runtime.consoleAPICalled' && ev.params.type === 'error') console.log('!!ERR', ev.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300))
    if (ev.method === 'Inspector.targetCrashed') console.log('!!! RENDERER CRASHED !!!')
  }
  await ws.connect()
  await ws.call('Runtime.enable'); await ws.call('Page.enable'); await ws.call('Inspector.enable')
  const ev = async (expr) => (await ws.call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }))?.result?.value
  const alive = async () => { try { return (await httpJson('/json/list')).some(x => x.id === page.id) } catch { return false } }
  const click = async (texts) => await ev(`(()=>{const want=${JSON.stringify(texts)};for(const w of want){const el=[...document.querySelectorAll('button,a,[role=button]')].find(e=>e.offsetParent&&(e.innerText||'').includes(w));if(el){el.click();return 'OK:'+(el.innerText||'').trim().slice(0,24)}}return null})()`)
  const text = async (n=180) => JSON.stringify((await ev(`(document.body.innerText||'').slice(0,${n})`))||'')
  const checkpoint = async (name) => console.log(`[${name}] alive=${await alive()} text=${await text(140)}`)

  // 确保在游戏主页
  await ev(`location.hash='#/entertainment'`); await sleep(4000)
  await checkpoint('menu')

  // 开始游戏（或继续）
  console.log('[start]', await click(['开始游戏', '继续']))
  await sleep(2500)
  // 牌组选择：点击第一个牌组卡片
  console.log('[deck]', await ev(`(()=>{const els=[...document.querySelectorAll('[class*=deck]')].filter(e=>e.offsetParent);if(els[0]){els[0].click();return 'OK:'+els[0].innerText.slice(0,20)}return null})()`))
  await sleep(2000)
  console.log('[confirm]', await click(['出发', '开始', '确认', '选择牌组']))
  await sleep(2500)
  await checkpoint('after-deck')

  // 盲注选择
  console.log('[blind]', await click(['选择', '迎战', '挑战', '小盲']))
  await sleep(4500)
  await checkpoint('round-start')

  // 打两轮牌：每次选同花顺潜力的前 3 张
  for (let round = 0; round < 3; round++) {
    const n = await ev(`(()=>{const els=[...document.querySelectorAll('[class*=playing-card],[class*=hand] [class*=card]')].filter(e=>e.offsetParent);els.slice(0,3).forEach(e=>e.click());return els.length})()`)
    console.log(`[select cards round ${round}]`, n)
    await sleep(800)
    console.log('[play]', await click(['出牌']))
    // 等待计分演出播完（点击加速一次）
    await sleep(2500)
    await ev(`document.body.click()`)
    await sleep(6000)
    const t = await text(120)
    console.log(`[after play ${round}]`, t)
    if ((await ev(`location.hash`)) !== '#/entertainment') break
    if (JSON.stringify(t).includes('商店') || JSON.stringify(t).includes('下一回合') || JSON.stringify(t).includes('优惠券')) break
    if (JSON.stringify(t).includes('出牌')) continue
    break
  }
  await checkpoint('post-round')

  // 若在商店：买卡包并开包
  console.log('[shop?]', await text(200))
  console.log('[buy pack]', await ev(`(()=>{const els=[...document.querySelectorAll('[class*=pack],[class*=shop] [class*=card],[class*=shop] button')].filter(e=>e.offsetParent&&(e.innerText||'').match(/包|Pack/));if(els[0]){els[0].click();return 'OK:'+els[0].innerText.slice(0,20)}return null})()`))
  await sleep(2000)
  console.log('[open pack]', await click(['打开', '开启', '开包']))
  await sleep(3000)
  await checkpoint('pack-opening')
  // 翻开所有卡
  for (let i = 0; i < 6; i++) {
    await ev(`(()=>{const els=[...document.querySelectorAll('[class*=pack] [class*=card],[class*=modal] [class*=card]')].filter(e=>e.offsetParent);if(els[0])els[0].click();return els.length})()`)
    await sleep(1200)
  }
  await checkpoint('pack-flipped')
  console.log('[pick]', await click(['拿走', '选择', '确认', '选 1']))
  await sleep(2000)
  await checkpoint('pack-done')

  console.log('\n===== FULL LOOP RESULT =====')
  console.log('[final alive]', await alive())
  process.exit(0)
}
main().catch(e => { console.error('DRIVER FAIL', e); process.exit(1) })
