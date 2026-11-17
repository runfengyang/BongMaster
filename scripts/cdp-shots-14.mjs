// §14 视觉证据：锯齿撕裂/爆开震屏/爆开发牌/3D 细看（file:// 生产模式）→ work/cdp-shots/*.png
// 用法: node scripts/cdp-shots-14.mjs   依赖: electron . --remote-debugging-port=9222（无 vite，dist file://）
// 监控 Inspector.targetCrashed / Runtime.exceptionThrown / console error
import http from 'node:http'
import net from 'node:net'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const { MOD_JOKERS } = await import('../src/balatro/data/modJokers.js')
const { PACKS_BY_ID } = await import('../src/balatro/data/packs.js')

const DEBUG_PORT = 9222
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
  for (let i = 0; i < 40; i++) {
    try { targets = await httpJson('/json/list'); break } catch { await sleep(500) }
  }
  if (!targets) { console.error('CDP 端口不可达'); process.exit(1) }
  // file:// 生产模式（dist/renderer）优先，dev 5173 兜底
  const page = targets.find(t => t.type === 'page' && (t.url.includes('dist/renderer') || t.url.includes('localhost:5173')))
  if (!page) { console.error('找不到应用窗口 target', targets.map(t => t.url)); process.exit(1) }
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
    if (ev.method === 'Inspector.targetCrashed') {
      crashes.push('RENDERER CRASHED (Inspector.targetCrashed)')
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
  const alive = async () => {
    try { const t = await httpJson('/json/list'); return t.some(x => x.id === page.id) } catch { return false }
  }
  const shot = async (name) => {
    const r = await ws.call('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'))
    console.log(`  📸 ${name}`)
  }

  // —— 注入存档：j_joker 仅多彩（细看 poly 着色）、卡尼奥闪箔、mega 小丑包（强震屏+5 张） ——
  console.log('\n--- STEP: 注入存档并重载 ---')
  const now = new Date().toISOString()
  const seedState = {
    version: 1, savedAt: now, run: null,
    collection: {
      discovered: [
        'j_joker', 'j_greedy_joker', 'j_mad_joker', 'j_blueprint', 'j_brainstorm',
        'j_canio', 'j_triboulet', 'j_yorick', 'j_chicot', 'j_perkeo',
        'c_fool', 'c_magician', 'c_world', 'p_mercury', 'p_pluto', 's_familiar', 's_soul', 's_aura',
        ...MOD_JOKERS.map(j => j.id),
      ],
      ownedCards: [
        { id: 'j_joker', edition: 'poly', obtainedAt: now },   // 仅多彩：细看必现 poly 着色
        { id: 'j_canio', edition: 'foil', obtainedAt: now },
        { id: 'c_fool', edition: null, obtainedAt: now },
      ],
    },
    settings: { volume: 0.5, muted: true, animations: true },
    productivity: { count: 40, pendingMoney: 0, pendingPacks: ['pack_buffoon_mega'], streak: 0 },
  }
  await evaluate(`window.electronAPI.balatroSave(${JSON.stringify(JSON.stringify(seedState))})`)
  await evaluate(`location.hash='#/cards'; location.reload()`)
  await sleep(6000)
  ok(await alive(), '重载后存活')

  // —— 开包：idle 撕条区 → 锯齿裂缝中段 → 爆开震屏 → 扇形 ——
  console.log('\n--- STEP: 锯齿撕裂 + 爆开关键帧 ---')
  await evaluate(`document.querySelector('.cv-pack-tile')?.click()`)
  await sleep(1300)
  ok(await evaluate(`!!document.querySelector('.pm-sealed-wrap')`), '卡包弹层出现')
  ok(await evaluate(`!!document.querySelector('.pm-pack-perf')`), 'idle 锯齿撕条区（perforated 虚线）存在')
  await shot('20-pack-sealed-perf.png')
  await evaluate(`document.querySelector('.pm-sealed-wrap')?.click()`)
  await sleep(250) // p≈0.5
  ok(await evaluate(`!!document.querySelector('.pm-tear-front')`), '撕裂前沿光点存在')
  const midClip = await evaluate(`document.querySelector('.pm-pack-part.top')?.style.clipPath || ''`)
  ok(midClip.includes('polygon'), '撕裂中段 top 为锯齿 clip-path')
  await shot('21-tear-jag-mid.png')
  await sleep(180) // p≈0.86
  await shot('22-tear-jag-late.png')
  await sleep(230) // 撕裂完成 → 爆开 +160ms：白闪/两瓣/震屏进行中
  ok(await evaluate(`!!document.querySelector('.pm-flash')`), '爆开白闪存在')
  ok(await evaluate(`document.querySelector('.pm-overlay')?.className.includes('pm-shake-strong')`), 'mega 包 = 强震屏')
  await shot('23-burst-shake.png')
  await sleep(900) // open + 爆开发牌落定
  const expectN = PACKS_BY_ID.pack_buffoon_mega.count
  const slots = await evaluate(`document.querySelectorAll('.pm-slot').length`)
  ok(slots === expectN, `mega 小丑包 ${expectN} 张扇形（实际 ${slots}）`)
  await shot('24-fan-burst.png')

  // —— 翻牌 → 细看（选择模式）→ 选这张 → 拿走 ——
  console.log('\n--- STEP: 翻牌 + 3D 细看选卡流程 ---')
  for (let i = 0; i < (slots || 0); i++) {
    await evaluate(`document.querySelectorAll('.pm-slot .pc-wrap')[${i}]?.click()`)
    await sleep(650)
  }
  await evaluate(`document.querySelectorAll('.pm-slot .pc-wrap')[0]?.click()`)
  await sleep(800)
  ok(await evaluate(`document.querySelector('.pm-inspect')?.className.includes('in')`), '细看视图打开（FLIP 飞入）')
  ok(await evaluate(`document.querySelector('.pm-ibtn.pick')?.innerText === '选这张'`), '细看含「选这张」按钮')
  await shot('25-inspect-fan.png')
  await evaluate(`document.querySelector('.pm-ibtn.pick')?.click()`)
  await sleep(600)
  ok(await evaluate(`document.querySelectorAll('.pm-chosen-badge').length === 1`), '细看选这张 → 扇形 ✓ 角标')
  // 选满 chooseLeft：逐张细看→选这张（已选的显示「取消选择」则跳过）
  for (let i = 1; i < (slots || 0); i++) {
    const disabled = await evaluate(`[...document.querySelectorAll('.pm-actions button')].find(b => b.innerText.includes('拿走'))?.disabled`)
    if (disabled === false) break
    await evaluate(`document.querySelectorAll('.pm-slot .pc-wrap')[${i}]?.click()`)
    await sleep(700)
    const label = await evaluate(`document.querySelector('.pm-ibtn.pick')?.innerText || ''`)
    if (label === '选这张') await evaluate(`document.querySelector('.pm-ibtn.pick')?.click()`)
    else await evaluate(`[...document.querySelectorAll('.pm-ibtn')].find(b => b.innerText === '返回')?.click()`)
    await sleep(550)
  }
  const takeDisabled = await evaluate(`[...document.querySelectorAll('.pm-actions button')].find(b => b.innerText.includes('拿走'))?.disabled`)
  ok(takeDisabled === false, '选满后「拿走」可点')
  await evaluate(`[...document.querySelectorAll('.pm-actions button')].find(b => b.innerText.includes('拿走'))?.click()`)
  await sleep(1800)
  ok(await evaluate(`!document.querySelector('.pm-overlay')`), '拿走后弹层关闭（choose 流未破坏）')

  // —— 收藏详情 → 3D 细看：传奇卡尼奥 + 多彩 j_joker ——
  console.log('\n--- STEP: 收藏详情 3D 细看（传奇 + 多彩） ---')
  const clickCell = async (name) => evaluate(`(() => {
    const cells = [...document.querySelectorAll('.cv-grid .cv-cell')]
    const c = cells.find(x => !x.classList.contains('undiscovered') && (x.querySelector('.cv-name')?.innerText || '') === ${JSON.stringify(name)})
    if (!c) return false
    c.click(); return true })()`)
  ok(await clickCell('卡尼奥'), '点击卡尼奥格')
  await sleep(900)
  ok(await evaluate(`!!document.querySelector('.cv-detail')`), '详情面板打开')
  await evaluate(`document.querySelector('.cv-detail .pc-wrap')?.click()`)
  await sleep(850)
  ok(await evaluate(`document.querySelector('.cv-inspect')?.className.includes('in')`), '细看视图打开（传奇）')
  await shot('26-inspect-legendary.png')
  await evaluate(`document.querySelector('.cv-inspect')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
  await sleep(500)
  await evaluate(`document.querySelector('.cv-detail-close')?.click()`)
  await sleep(500)
  ok(await clickCell('小丑'), '点击小丑格')
  await sleep(900)
  await evaluate(`document.querySelector('.cv-detail .pc-wrap')?.click()`)
  await sleep(850)
  ok(await evaluate(`!!document.querySelector('.cv-inspect .ed-poly')`), '细看呈现多彩版本着色（.ed-poly）')
  await shot('27-inspect-poly.png')
  await evaluate(`document.querySelector('.cv-inspect')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
  await sleep(400)
  ok(await alive(), '全流程存活')

  console.log('\n===== CDP SHOTS §14 RESULT =====')
  console.log('[target alive]', await alive())
  console.log('[crashes]', crashes.length ? '\n' + crashes.join('\n---\n') : 'none')
  console.log(consoleErrors.length ? '[console errors]\n' + consoleErrors.slice(0, 20).join('\n---\n') : 'NO CONSOLE ERRORS')
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
  process.exit(fail || crashes.length ? 1 : 0)
}
main().catch(e => { console.error('DRIVER FAIL', e); process.exit(1) })
