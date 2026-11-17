// UI 微调 6 项 视觉证据：撕裂精修关键帧 / 像素「全部收下」/ 商店面板 / 出售交互 / 扑克收藏区
// （file:// 生产模式 + 独立 --user-data-dir 临时 profile，不碰真实数据库）
// 用法: 先 `npm run build:vite`，再 `electron . --remote-debugging-port=9333 --user-data-dir=/tmp/bm-uitweak-profile`
//       然后 node scripts/cdp-shots-uitweak.mjs → work/cdp-shots/ui-tweak-*.png
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
  for (let i = 0; i < 40; i++) {
    try { targets = await httpJson('/json/list'); break } catch { await sleep(500) }
  }
  if (!targets) { console.error('CDP 端口不可达'); process.exit(1) }
  const page = targets.find(t => t.type === 'page' && t.url.includes('dist/renderer'))
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
    if (ev.method === 'Inspector.targetCrashed') crashes.push('RENDERER CRASHED')
    // window.confirm 自动接受（出售二次确认）
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
  const alive = async () => {
    try { const t = await httpJson('/json/list'); return t.some(x => x.id === page.id) } catch { return false }
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
          pending: (s.productivity?.pendingPacks || []).length,
        })
      }
      return null })()`)
    return raw ? JSON.parse(raw) : null
  }

  // —— 注入存档：金币 120 / 已开 5 包 / 待开 2 包 / 重复小丑 + 扑克变体 ——
  console.log('\n--- STEP: 注入存档并重载到 #/cards ---')
  const now = new Date().toISOString()
  const seedState = {
    version: 1, savedAt: now, run: null,
    collection: {
      discovered: ['j_joker', 'j_greedy_joker', 'pc_spades_14', 'pc_hearts_10', 'pc_spades_13', 'pc_clubs_2'],
      ownedCards: [
        { id: 'j_joker', edition: null, obtainedAt: now },
        { id: 'j_joker', edition: null, obtainedAt: now },
        { kind: 'playing', rank: 14, suit: 'spades', enhancement: null, seal: null, edition: null, obtainedAt: now },
        { kind: 'playing', rank: 14, suit: 'spades', enhancement: 'gold', seal: 'red', edition: 'poly', obtainedAt: now },
        { kind: 'playing', rank: 14, suit: 'spades', enhancement: 'gold', seal: 'red', edition: 'poly', obtainedAt: now },
        { kind: 'playing', rank: 10, suit: 'hearts', enhancement: null, seal: null, edition: 'foil', obtainedAt: now },
        { kind: 'playing', rank: 13, suit: 'spades', enhancement: 'steel', seal: null, edition: null, obtainedAt: now },
      ],
    },
    settings: { volume: 0.5, muted: true, animations: true },
    productivity: { count: 60, pendingMoney: 0, pendingPacks: ['pack_buffoon_mega', 'pack_standard_normal'], streak: 0 },
    economy: { gold: 120, packsOpened: 5 },
  }
  await evaluate(`window.electronAPI.balatroSave(${JSON.stringify(JSON.stringify(seedState))})`)
  await evaluate(`location.hash='#/cards'; location.reload()`)
  await sleep(6000)
  ok(await alive(), '重载后存活')

  // —— ① 商店面板 + 购买 ——
  console.log('\n--- STEP: 商店面板 ---')
  ok(await evaluate(`!!document.querySelector('.cv-shop')`), '商店面板存在')
  ok(await evaluate(`document.querySelectorAll('.cv-shop-tile').length === 15`), '5 类 × 3 规格 = 15 个商品')
  ok(await evaluate(`document.querySelector('.cv-shop-gold')?.innerText.includes('120')`), '金币余额显示 120')
  ok(await evaluate(`document.querySelector('.cv-shop-opened')?.innerText.includes('5')`), '累计开包显示 5')
  await shot('ui-tweak-01-shop.png')
  const st0 = await storeState()
  await evaluate(`[...document.querySelectorAll('.cv-shop-tile')].find(t => t.innerText.includes('秘术包') && !t.innerText.includes('巨') && !t.innerText.includes('超'))?.click()`)
  await sleep(700)
  const st1 = await storeState()
  ok(st1?.gold === st0?.gold - 40 && st1?.pending === st0?.pending + 1, `购买秘术包：金币 ${st0?.gold}→${st1?.gold}，待开 +1`)
  await shot('ui-tweak-02-shop-bought.png')

  // —— ② 撕裂精修关键帧（无 perf 虚线 / 细锯齿 / 裂缝明暗边） ——
  console.log('\n--- STEP: 开包撕裂关键帧 ---')
  await evaluate(`document.querySelector('.cv-pack-tile')?.click()`)
  await sleep(1100)
  ok(await evaluate(`!!document.querySelector('.pm-sealed-wrap')`), '卡包弹层出现')
  ok(await evaluate(`!document.querySelector('.pm-pack-perf')`), 'perforated 虚线已删除')
  await shot('ui-tweak-03-sealed-no-perf.png')
  await evaluate(`document.querySelector('.pm-sealed-wrap')?.click()`)
  await sleep(140)
  ok(await evaluate(`!!document.querySelector('.pm-crack-light') && !!document.querySelector('.pm-crack-shadow')`), '裂缝高光/暗边条带渲染')
  await shot('ui-tweak-04-tearing-early.png')
  await sleep(180)
  await shot('ui-tweak-05-tearing-late.png')
  await sleep(900)

  // —— ③ 扇形 + 像素「全部收下」（hint 条已删） ——
  const slots = (await evaluate(`document.querySelectorAll('.pm-slot').length`)) || 0
  ok(slots > 0, `扇形展开 ${slots} 张`)
  ok(await evaluate(`!document.querySelector('.pm-bar .pm-hint')`), '底部 hint 提示条已删除')
  ok(await evaluate(`!!document.querySelector('.pm-actions .pm-collect-btn')`), '像素风「全部收下」scoped 按钮存在')
  ok(await evaluate(`!document.querySelector('.pm-actions .bt-btn.primary')`), '非 pickMode 下不再用全局 bt-btn')
  await shot('ui-tweak-06-fan-pixel-btn.png')
  await evaluate(`document.querySelector('.pm-collect-btn')?.click()`)
  await sleep(300)
  await shot('ui-tweak-07-collect-fly.png')
  await sleep(900)

  // —— ④ 图鉴细看：锁定提示 + 出售 ——
  console.log('\n--- STEP: 细看出售 + 锁定提示 ---')
  // j_joker ×2：细看应出现出售按钮；点击（confirm 自动接受）→ 金币 +8
  await evaluate(`(() => {
    const cells = [...document.querySelectorAll('.cv-cell:not(.undiscovered)')]
    const cell = cells.find(c => c.querySelector('.cv-name')?.innerText === '小丑')
    cell?.click() })()`)
  await sleep(1000)
  ok(await evaluate(`document.querySelector('.cv-inspect')?.className.includes('in')`), '细看打开')
  ok(await evaluate(`!!document.querySelector('.cv-sell-btn')`), '重复卡出现出售按钮')
  ok(await evaluate(`document.querySelector('.cv-sell-btn')?.innerText.includes('8')`), '普通卡售价 +8')
  await shot('ui-tweak-08-inspect-sell.png')
  const g0 = (await storeState())?.gold
  await evaluate(`document.querySelector('.cv-sell-btn')?.click()`)
  await sleep(800)
  const g1 = (await storeState())?.gold
  ok(g1 === g0 + 8, `出售入账：金币 ${g0}→${g1}`)
  ok(await evaluate(`!document.querySelector('.cv-sell-btn')`), '仅剩 1 张后出售按钮消失（首张保护）')
  await shot('ui-tweak-09-after-sell.png')
  await evaluate(`document.querySelector('.cv-inspect')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
  await sleep(500)

  // 锁定提示：稀有卡 packsOpened=5 <10 → 显示梯度提示（直接找一张稀有卡看详情；未发现则改查数据层断言）
  const lockShown = await evaluate(`(() => {
    const cells = [...document.querySelectorAll('.cv-cell')]
    const rare = cells.find(c => !c.classList.contains('undiscovered') && c.querySelector('.cv-name')?.innerText === '贪婪小丑')
    rare?.click()
    return !!rare })()`)
  if (lockShown) {
    await sleep(900)
    // 贪婪小丑是 rarity 1 无锁定；这里只确认细看无锁提示不报错
    await evaluate(`document.querySelector('.cv-inspect')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
    await sleep(400)
  }

  // —— ⑤ 扑克收藏区（mods 页签 52 格 + 变体出售） ——
  console.log('\n--- STEP: 扑克收藏区 ---')
  await evaluate(`[...document.querySelectorAll('.cv-tab')].find(t => t.innerText.includes('增强'))?.click()`)
  await sleep(800)
  ok(await evaluate(`document.querySelectorAll('.cv-pcell').length === 52`), '52 格扑克区渲染')
  ok(await evaluate(`document.querySelectorAll('.cv-pcell.found').length === 4`), '4 格已点亮（pc_ 键）')
  ok(await evaluate(`document.querySelectorAll('.cv-pvar').length > 0`), '变体徽章渲染')
  await shot('ui-tweak-10-playing-grid.png')
  // 点黑桃 A（3 变体组：素牌×1 / 黄金+红蜡封+多彩×2）→ 变体列表 + 可售组出现出售按钮
  await evaluate(`(() => {
    const cells = [...document.querySelectorAll('.cv-pcell.found')]
    const cell = cells.find(c => c.querySelector('.cv-pcell-label')?.innerText === 'A♠')
    cell?.click() })()`)
  await sleep(900)
  ok(await evaluate(`document.querySelectorAll('.cv-pcvar-row').length === 2`), '变体列表 2 组（素牌 / 黄金+红蜡封+多彩）')
  ok(await evaluate(`!!document.querySelector('.cv-pcvar-row .cv-sell-btn')`), '重复变体出现出售按钮（+8）')
  await shot('ui-tweak-11-playing-variants.png')
  const pg0 = (await storeState())?.gold
  await evaluate(`document.querySelector('.cv-pcvar-row .cv-sell-btn')?.click()`)
  await sleep(800)
  const pg1 = (await storeState())?.gold
  ok(pg1 === pg0 + 8, `扑克变体出售入账：金币 ${pg0}→${pg1}`)
  await shot('ui-tweak-12-playing-sold.png')

  console.log('\n===== CDP SHOTS UI-TWEAK RESULT =====')
  console.log('[target alive]', await alive())
  console.log('[crashes]', crashes.length ? '\n' + crashes.join('\n---\n') : 'none')
  console.log(consoleErrors.length ? '[console errors]\n' + consoleErrors.slice(0, 20).join('\n---\n') : 'NO CONSOLE ERRORS')
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
  process.exit(fail || crashes.length ? 1 : 0)
}
main().catch(e => { console.error('DRIVER FAIL', e); process.exit(1) })
