// 远征模式 Phase E3 CDP 真机验收
// 链路：主题选择 → 开局 → draft → 主战场 → 拉杆结算 → 战报播放/跳过 → 持久化刷新
//      → （有包则）局内开包 → 放弃远征 → 清算 → 新局引导 → Dashboard 摘要条
// 用法: node scripts/cdp-expedition-e3.mjs
// 依赖: electron . --remote-debugging-port=9222 运行中（生产模式 file:// dist）
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
  const page = targets.find(t => t.type === 'page' && (t.url.includes('index.html') || t.url.includes('localhost:5173')))
  if (!page) { console.error('no page target'); process.exit(1) }
  console.log('[target]', page.url.slice(0, 80))

  const ws = new MiniWS(page.webSocketDebuggerUrl)
  ws.onEvent = (ev) => {
    if (ev.method === 'Runtime.exceptionThrown') {
      const d = ev.params.exceptionDetails?.exception?.description || ev.params.exceptionDetails?.text || ''
      pageErrors.push('EXC: ' + String(d).slice(0, 300))
      console.log('!!EXC', String(d).slice(0, 300))
    }
    if (ev.method === 'Runtime.consoleAPICalled' && ev.params.type === 'error') {
      const t = ev.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300)
      pageErrors.push('ERR: ' + t)
      console.log('!!ERR', t)
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
  const text = async (n = 200) => (await ev(`(document.body.innerText||'').slice(0,${n})`)) || ''
  const count = async (sel) => await ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`)

  // ---------- 0. 清掉可能残留的远征存档（从干净状态开始） ----------
  await ev(`(async()=>{ if(window.electronAPI?.balatroSaveKey){ await window.electronAPI.balatroSaveKey('expedition:run','null'); await window.electronAPI.balatroSaveKey('expedition:report','null'); } })()`)
  await ev(`location.hash='#/expedition'`)
  await sleep(2500)

  console.log('== 1. 主题选择 ==')
  ok((await text(400)).includes('论文攻坚'), '主题卡渲染（论文攻坚）')
  ok((await text(600)).includes('分心之墙'), 'Boss 预告（分心之墙）')
  await shot('e3-01-theme-select.png')

  console.log('== 2. 开局 → draft ==')
  console.log('  [选择远征]', await click(['选择远征']))
  await sleep(1500)
  ok(await has('.dm-overlay'), 'DraftModal 弹出')
  ok((await count('.dm-slot')) >= 6, `draft 选项卡 ${await count('.dm-slot')} 张`)
  await shot('e3-02-draft.png')
  console.log('  [出征]', await click(['出征！', '出征']))
  await sleep(1500)

  console.log('== 3. 主战场 ==')
  ok(await has('.btotem'), 'Boss 图腾渲染')
  ok(await has('.bt-canvas'), 'pixelMap canvas 存在')
  ok((await count('.bt-chunk')) === 24, `chunky HP 条 24 格（实际 ${await count('.bt-chunk')}）`)
  ok(await has('.nroute'), '节点路线渲染')
  ok((await count('.nr-node')) === 5, `节点 5 站（实际 ${await count('.nr-node')}）`)
  ok(await has('.lb'), '阵容栏渲染')
  ok((await text(300)).includes('活跃日 0/5'), 'HUD 活跃日 0/5')
  await shot('e3-03-battlefield.png')

  console.log('== 4. 拉杆结算 → 战报 ==')
  console.log('  [拉杆]', await click(['拉杆结算']))
  await sleep(3000)
  ok(await has('.sr-overlay'), '战报覆盖层弹出')
  ok((await count('.sr-reel')) === 5, `老虎机 5 格（实际 ${await count('.sr-reel')}）`)
  await shot('e3-04-report-playing.png')
  console.log('  [跳过]', await click(['跳过']))
  await sleep(2500)
  console.log('  [收下战报]', await click(['收下战报']))
  await sleep(1200)
  ok(!(await has('.sr-overlay')), '战报关闭回战场')
  ok((await text(300)).includes('活跃日 1/5'), `活跃日推进 1/5（实际：${(await text(300)).match(/活跃日.{0,5}/)?.[0]}）`)
  ok((await text(500)).includes('今日已结算'), '今日已结算提示')
  await shot('e3-05-after-settle.png')

  console.log('== 5. 持久化（sqlite 读档刷新） ==')
  await sleep(800) // 防抖 500ms 落盘
  await ev(`location.reload()`)
  await sleep(3500)
  ok((await text(300)).includes('活跃日 1/5'), '刷新后进度还在（expedition:run 读档成功）')
  await shot('e3-06-reloaded.png')

  console.log('== 6. 局内开包（若队列有包） ==')
  const packBtn = await click(['开卡包'])
  console.log('  [开卡包]', packBtn)
  if (packBtn) {
    await sleep(1000)
    await shot('e3-07a-pack-queue.png')
    // 三选一 / 直接开
    console.log('  [选包]', await ev(`(()=>{const el=[...document.querySelectorAll('.exp-packchoice button')].find(e=>e.offsetParent);if(el){el.click();return 'OK:'+el.innerText.slice(0,24)}return null})()`))
    await sleep(800)
    ok(await has('.pm-overlay'), 'PackModal 弹出')
    console.log('  [撕开]', await ev(`(()=>{const el=document.querySelector('.pm-sealed-wrap');if(el){el.click();return 'OK'}return null})()`))
    await sleep(1800)
    // 翻开全部卡
    for (let i = 0; i < 5; i++) {
      await ev(`(()=>{const els=[...document.querySelectorAll('.pm-slot:not(.taken)')].filter(e=>e.offsetParent);if(els[0])els[0].querySelector('.pc-wrap').click();return els.length})()`)
      await sleep(900)
    }
    await shot('e3-07b-pack-open.png')
    // 选中第一张已翻卡 → 收下所选
    await ev(`(()=>{const els=[...document.querySelectorAll('.pm-slot:not(.taken)')].filter(e=>e.offsetParent);if(els[0])els[0].querySelector('.pc-wrap').click();return els.length})()`)
    await sleep(600)
    console.log('  [收下所选]', await click(['收下所选']))
    await sleep(1500)
    ok(!(await has('.pm-overlay')), '开包完成回战场')
    await shot('e3-07c-pack-done.png')
  } else {
    console.log('  · 第 1 日未通关节点、无包入队（合法随机结果），跳过')
  }

  console.log('== 7. 放弃远征 → 清算 ==')
  await ev(`window.confirm = () => true`)
  console.log('  [放弃]', await click(['放弃远征']))
  await sleep(1500)
  ok((await text(400)).includes('远征已放弃'), '清算屏（已放弃）')
  ok((await text(600)).includes('图鉴点亮'), '清算单含图鉴点亮')
  await shot('e3-08-settlement.png')
  console.log('  [新的远征]', await click(['开始新的远征']))
  await sleep(1200)
  ok((await text(400)).includes('论文攻坚'), '回到主题选择')
  await shot('e3-09-newrun.png')

  console.log('== 8. Dashboard 摘要条 + 导航角标 ==')
  await ev(`location.hash='#/'`)
  await sleep(2000)
  ok(await has('.xs-empty, .xs-bar'), 'Dashboard 远征摘要区渲染（无局→引导卡）')
  ok((await text(500)).includes('选择你的远征') || (await text(500)).includes('活跃日'), '引导卡/摘要条文案')
  await shot('e3-10-dashboard.png')
  ok(await has('.bm-expedition-btn'), '导航远征 pill 存在')

  console.log('== 9. 图鉴出征入口 ==')
  await ev(`location.hash='#/cards'`)
  await sleep(2500)
  ok(await has('.cv-expedition-btn'), '图鉴卡包区「出征」按钮存在')
  await shot('e3-11-cards-entry.png')

  console.log('\n===== E3 CDP RESULT =====')
  ok(pageErrors.length === 0, `页面零 JS 错误（实际 ${pageErrors.length} 条）`)
  console.log(`结果：${pass} 通过 / ${fail} 失败`)
  process.exit(fail ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
