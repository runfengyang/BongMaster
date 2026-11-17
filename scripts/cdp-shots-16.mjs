// §16 视觉证据：开包全收（全部收下飞走）+ NEW 像素徽章（扇形/图鉴格/已读清除）
// （file:// 生产模式）→ work/cdp-shots/*.png
// 用法: node scripts/cdp-shots-16.mjs   依赖: electron . --remote-debugging-port=9222（无 vite，dist file://）
// 监控 Inspector.targetCrashed / Runtime.exceptionThrown / console error
import http from 'node:http'
import net from 'node:net'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

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
  // Pinia store 直读（断言 ground truth）
  const storeState = async () => {
    const raw = await evaluate(`(() => {
      const app = document.querySelector('#app').__vue_app__
      const pinia = app?.config?.globalProperties?.$pinia
      if (!pinia) return null
      for (const s of pinia._s.values()) {
        if (s.collection && s.collection.ownedCards !== undefined) return JSON.stringify({
          pack: s.collectionPack ? { n: s.collectionPack.options.length, firstNew: s.collectionPack.firstNew || [] } : null,
          owned: (s.collection.ownedCards || []).length,
          newIds: s.collection.newIds || [],
          discovered: (s.collection.discovered || []).length,
        })
      }
      return null })()`)
    return raw ? JSON.parse(raw) : null
  }

  // —— 注入存档：只发现 2 张官方（开包选项几乎全是首开 → NEW 徽章好拍） ——
  console.log('\n--- STEP: 注入存档并重载 ---')
  const now = new Date().toISOString()
  const seedState = {
    version: 1, savedAt: now, run: null,
    collection: {
      discovered: ['j_joker', 'j_greedy_joker'],
      ownedCards: [{ id: 'j_joker', edition: null, obtainedAt: now }],
    },
    settings: { volume: 0.5, muted: true, animations: true },
    productivity: { count: 60, pendingMoney: 0, pendingPacks: Array(6).fill('pack_buffoon_mega'), streak: 0 },
  }
  await evaluate(`window.electronAPI.balatroSave(${JSON.stringify(JSON.stringify(seedState))})`)
  await evaluate(`location.hash='#/cards'; location.reload()`)
  await sleep(6000)
  ok(await alive(), '重载后存活')

  // —— ① 开包 → 翻完 → NEW 徽章 → 全部收下 → 飞走帧 ——
  console.log('\n--- STEP: 开包全收流程 + 扇形 NEW 徽章 ---')
  await evaluate(`document.querySelector('.cv-pack-tile')?.click()`)
  await sleep(1200)
  ok(await evaluate(`!!document.querySelector('.pm-sealed-wrap')`), '卡包弹层出现')
  await evaluate(`document.querySelector('.pm-sealed-wrap')?.click()`) // 撕裂
  await sleep(1600)
  const slots = (await evaluate(`document.querySelectorAll('.pm-slot').length`)) || 0
  ok(slots > 0, `扇形展开 ${slots} 张`)
  // 无强制选卡 UI：拿走按钮不存在，「全部收下」存在
  ok(await evaluate(`![...document.querySelectorAll('.pm-actions button')].some(b => b.innerText.includes('拿走'))`), '「拿走 N 张」按钮已移除')
  ok(await evaluate(`[...document.querySelectorAll('.pm-actions button')].some(b => b.innerText === '全部收下')`), '「全部收下」按钮存在')
  const st0 = await storeState()
  // 逐张翻开
  for (let i = 0; i < slots; i++) {
    await evaluate(`document.querySelectorAll('.pm-slot .pc-wrap')[${i}]?.click()`)
    await sleep(850) // 覆盖 t3 400ms / t4 700ms 悬念
  }
  const newBadges = await evaluate(`document.querySelectorAll('.pm-new-badge').length`)
  ok(newBadges === (st0?.pack?.firstNew?.length ?? -1),
    `翻开后 NEW 徽章 ${newBadges} 枚 == firstNew ${st0?.pack?.firstNew?.length}（重复卡无 NEW）`)
  await shot('40-fan-new-badges.png')
  // 细看无「选这张」
  await evaluate(`document.querySelectorAll('.pm-slot .pc-wrap')[0]?.click()`)
  await sleep(800)
  ok(await evaluate(`document.querySelector('.pm-inspect')?.className.includes('in')`), '扇形细看打开')
  ok(await evaluate(`![...document.querySelectorAll('.pm-ibtn')].some(b => b.innerText.includes('选这张'))`), '细看无「选这张」按钮')
  await shot('41-inspect-no-choose.png')
  await evaluate(`[...document.querySelectorAll('.pm-ibtn')].find(b => b.innerText === '返回')?.click()`)
  await sleep(500)
  // 全部收下 → 飞走帧
  await evaluate(`[...document.querySelectorAll('.pm-actions button')].find(b => b.innerText === '全部收下')?.click()`)
  await sleep(260) // 飞行动画进行中（640ms）
  ok(await evaluate(`document.querySelectorAll('.pm-slot.flying').length === ${slots}`), `全部 ${slots} 张一起飞走`)
  await shot('42-collect-all-fly.png')
  await sleep(900)
  const st1 = await storeState()
  ok(st1?.pack === null, '收下后包关闭')
  ok(st1?.owned === (st0?.owned ?? 0) + slots, `ownedCards ${st0?.owned} → ${st1?.owned}（+${slots} 全收）`)
  ok((st1?.newIds?.length ?? 0) === (st0?.pack?.firstNew?.length ?? -1),
    `newIds 持久化首开 ${st1?.newIds?.length} 张`)

  // —— ② 图鉴格 NEW 徽章 + 细看已读 + 全部已读 ——
  console.log('\n--- STEP: 图鉴 NEW 徽章与已读流 ---')
  const gridBadges = await evaluate(`document.querySelectorAll('.cv-new-badge').length`)
  ok(gridBadges > 0 && gridBadges === st1.newIds.length,
    `图鉴格 NEW 徽章 ${gridBadges} 枚 == newIds ${st1.newIds.length}`)
  ok(await evaluate(`!!document.querySelector('.cv-mark-read')`), '页头「全部已读」按钮出现')
  await shot('43-gallery-new-badge.png')
  // 点一个带 NEW 的格子 → 细看（已读）→ 徽章消失
  const cleared = await evaluate(`(() => {
    const badge = document.querySelector('.cv-new-badge')
    if (!badge) return null
    const cell = badge.closest('.cv-cell')
    cell.click()
    return true })()`)
  ok(!!cleared, '点击带 NEW 的格子')
  await sleep(900)
  ok(await evaluate(`document.querySelector('.cv-inspect')?.className.includes('in')`), '细看打开（即已读）')
  const st2 = await storeState()
  ok(st2.newIds.length === st1.newIds.length - 1, `细看后 newIds ${st1.newIds.length} → ${st2.newIds.length}`)
  await shot('44-inspect-clears-new.png')
  await evaluate(`document.querySelector('.cv-inspect')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
  await sleep(500)
  const gridBadges2 = await evaluate(`document.querySelectorAll('.cv-new-badge').length`)
  ok(gridBadges2 === gridBadges - 1, `返回后该格 NEW 徽章消失（${gridBadges} → ${gridBadges2}）`)
  // 全部已读
  await evaluate(`document.querySelector('.cv-mark-read')?.click()`)
  await sleep(600)
  ok(await evaluate(`document.querySelectorAll('.cv-new-badge').length === 0`), '全部已读后徽章清零')
  ok(await evaluate(`!document.querySelector('.cv-mark-read')`), '「全部已读」按钮随空 newIds 消失')
  ok(await alive(), '全流程存活')

  console.log('\n===== CDP SHOTS §16 RESULT =====')
  console.log('[target alive]', await alive())
  console.log('[crashes]', crashes.length ? '\n' + crashes.join('\n---\n') : 'none')
  console.log(consoleErrors.length ? '[console errors]\n' + consoleErrors.slice(0, 20).join('\n---\n') : 'NO CONSOLE ERRORS')
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
  process.exit(fail || crashes.length ? 1 : 0)
}
main().catch(e => { console.error('DRIVER FAIL', e); process.exit(1) })
