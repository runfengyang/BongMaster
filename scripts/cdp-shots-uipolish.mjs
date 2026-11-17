// UI 优化（A 项 6 要点）+ 第二批 Mod 导入（B 项）视觉证据
// （file:// 生产模式 + 独立 --user-data-dir 临时 profile，不碰真实数据库）
// 用法: 先 `npm run build:vite`，再 `electron . --remote-debugging-port=9333 --user-data-dir=/tmp/bm-uipolish-profile`
//       然后 node scripts/cdp-shots-uipolish.mjs → work/cdp-shots/ui-polish-*.png
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
        })
      }
      return null })()`)
    return raw ? JSON.parse(raw) : null
  }

  // —— 注入存档：j_joker×3 / mj_oly_zeus×2 / c_fool×2 / 其余新 mod 各 1 / 扑克变体与重复 ——
  console.log('\n--- STEP: 注入存档并重载到 #/cards ---')
  const now = new Date().toISOString()
  const seedState = {
    version: 1, savedAt: now, run: null,
    collection: {
      discovered: [
        'j_joker', 'j_greedy_joker',
        'c_fool',
        'mj_oly_artemis', 'mj_oly_apollo', 'mj_oly_hephaestus', 'mj_oly_hades', 'mj_oly_hera', 'mj_oly_zeus',
        'mj_pi_pi', 'mj_mik_prime_time', 'mj_mik_dagonet', 'mj_mik_cicero', 'mj_mik_horseshoe',
        'pc_spades_14', 'pc_hearts_10', 'pc_spades_13', 'pc_clubs_2',
      ],
      ownedCards: [
        { id: 'j_joker', edition: null, obtainedAt: now },
        { id: 'j_joker', edition: null, obtainedAt: now },
        { id: 'j_joker', edition: null, obtainedAt: now },
        { id: 'j_greedy_joker', edition: null, obtainedAt: now },
        { id: 'c_fool', edition: null, obtainedAt: now },
        { id: 'c_fool', edition: null, obtainedAt: now },
        { id: 'mj_oly_artemis', edition: null, obtainedAt: now },
        { id: 'mj_oly_apollo', edition: null, obtainedAt: now },
        { id: 'mj_oly_hephaestus', edition: null, obtainedAt: now },
        { id: 'mj_oly_hades', edition: null, obtainedAt: now },
        { id: 'mj_oly_hera', edition: null, obtainedAt: now },
        { id: 'mj_oly_zeus', edition: null, obtainedAt: now },
        { id: 'mj_oly_zeus', edition: null, obtainedAt: now },
        { id: 'mj_pi_pi', edition: null, obtainedAt: now },
        { id: 'mj_mik_prime_time', edition: null, obtainedAt: now },
        { id: 'mj_mik_dagonet', edition: null, obtainedAt: now },
        { id: 'mj_mik_cicero', edition: null, obtainedAt: now },
        { id: 'mj_mik_horseshoe', edition: null, obtainedAt: now },
        { kind: 'playing', rank: 14, suit: 'spades', enhancement: null, seal: null, edition: null, obtainedAt: now },
        { kind: 'playing', rank: 14, suit: 'spades', enhancement: 'gold', seal: 'red', edition: 'poly', obtainedAt: now },
        { kind: 'playing', rank: 14, suit: 'spades', enhancement: 'gold', seal: 'red', edition: 'poly', obtainedAt: now },
        { kind: 'playing', rank: 10, suit: 'hearts', enhancement: null, seal: null, edition: 'foil', obtainedAt: now },
        { kind: 'playing', rank: 13, suit: 'spades', enhancement: 'steel', seal: null, edition: null, obtainedAt: now },
        { kind: 'playing', rank: 2, suit: 'clubs', enhancement: null, seal: null, edition: null, obtainedAt: now },
        { kind: 'playing', rank: 2, suit: 'clubs', enhancement: null, seal: null, edition: null, obtainedAt: now },
        { kind: 'playing', rank: 2, suit: 'clubs', enhancement: null, seal: null, edition: null, obtainedAt: now },
      ],
    },
    settings: { volume: 0.5, muted: true, animations: true },
    productivity: { count: 60, pendingMoney: 0, pendingPacks: [], streak: 0 },
    economy: { gold: 100, packsOpened: 5 },
  }
  await evaluate(`window.electronAPI.balatroSave(${JSON.stringify(JSON.stringify(seedState))})`)
  await evaluate(`location.hash='#/cards'; location.reload()`)
  await sleep(6000)
  ok(await alive(), '重载后存活')
  // confirm 间谍：批量卖出只弹一次；单张出售零确认
  await evaluate(`window.__confirms = []; window.confirm = (m) => { window.__confirms.push(String(m)); return true }`)

  // —— ① 角标 ×N + 一键卖出重复（小丑页签） ——
  console.log('\n--- STEP: 角标与一键卖出重复 ---')
  ok(await evaluate(`!!document.querySelector('.cv-sell-dupes')`), '页签行出现一键卖出重复按钮')
  const dupeBtnText = await evaluate(`document.querySelector('.cv-sell-dupes')?.innerText || ''`)
  ok(/卖出重复 3 张/.test(dupeBtnText), `重复预览正确（j_joker×2 + mj_oly_zeus×1 = 3 张）：「${dupeBtnText}」`)
  // 滚到小丑 cell 让其入镜
  await evaluate(`(() => {
    const cell = [...document.querySelectorAll('.cv-cell')].find(c => c.querySelector('.cv-name')?.innerText === '小丑')
    cell?.scrollIntoView({ block: 'center' }) })()`)
  await sleep(500)
  const badge = await evaluate(`(() => {
    const cell = [...document.querySelectorAll('.cv-cell')].find(c => c.querySelector('.cv-name')?.innerText === '小丑')
    return cell?.querySelector('.cv-owned')?.innerText || null })()`)
  ok(badge === '×3', `角标 ×3 显示（实际 ${badge}）`)
  await shot('ui-polish-01-badge-selldupes.png')
  const g0 = (await storeState())?.gold
  await evaluate(`document.querySelector('.cv-sell-dupes')?.click()`)
  await sleep(900)
  const confirms1 = await evaluate(`window.__confirms`)
  ok(confirms1?.length === 1 && /将卖出 3 张重复卡，合计获得 \d+ 金币/.test(confirms1[0]),
    `批量卖出仅 1 次确认且文案正确：「${confirms1?.[0] || ''}」`)
  const g1 = (await storeState())?.gold
  ok(g1 > g0, `批量卖出入账：金币 ${g0}→${g1}`)
  const badgeAfter = await evaluate(`(() => {
    const cell = [...document.querySelectorAll('.cv-cell')].find(c => c.querySelector('.cv-name')?.innerText === '小丑')
    return cell?.querySelector('.cv-owned')?.innerText || null })()`)
  ok(badgeAfter === null, '卖出后角标消失（各留 1 张）')
  ok(await evaluate(`!document.querySelector('.cv-sell-dupes')`), '无重复后按钮消失')
  await shot('ui-polish-02-after-selldupes.png')

  // —— ② 单张出售零确认（愚者 ×2 → 塔罗页签细看出售 1 张；与小丑页签批量卖出互不干扰） ——
  console.log('\n--- STEP: 单张出售免确认 ---')
  await evaluate(`[...document.querySelectorAll('.cv-tab')].find(t => t.innerText === '塔罗')?.click()`)
  await sleep(900)
  await evaluate(`(() => {
    const cell = [...document.querySelectorAll('.cv-cell')].find(c => c.querySelector('.cv-name')?.innerText === '愚者')
    cell?.scrollIntoView({ block: 'center' }) })()`)
  await sleep(400)
  await evaluate(`(() => {
    const cell = [...document.querySelectorAll('.cv-cell')].find(c => c.querySelector('.cv-name')?.innerText === '愚者')
    cell?.click() })()`)
  await sleep(1000)
  ok(await evaluate(`document.querySelector('.cv-inspect')?.className.includes('in')`), '细看打开')
  ok(await evaluate(`!!document.querySelector('.cv-sell-btn')`), '愚者 ×2 出现出售按钮')
  ok(await evaluate(`!document.querySelector('.cv-detail-owned')`), '「已持有」冗余文案行已删除')
  await shot('ui-polish-03-inspect-fool.png')
  const g2 = (await storeState())?.gold
  await evaluate(`document.querySelector('.cv-sell-btn')?.click()`)
  await sleep(800)
  const g3 = (await storeState())?.gold
  ok(g3 > g2, `单张出售入账：金币 ${g2}→${g3}`)
  ok((await evaluate(`window.__confirms.length`)) === 1, '单张出售未再弹确认（仍为 1 次批量确认）')
  await shot('ui-polish-04-after-single-sell.png')
  await evaluate(`document.querySelector('.cv-inspect')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
  await sleep(500)

  // —— ③ 增强·蜡封·版本页签：52 格图谱卡面 + 参考区 ——
  console.log('\n--- STEP: 扑克 52 格与参考区 ---')
  await evaluate(`[...document.querySelectorAll('.cv-tab')].find(t => t.innerText.includes('增强'))?.click()`)
  await sleep(900)
  ok(await evaluate(`document.querySelectorAll('.cv-pcell').length === 52`), '52 格扑克区渲染')
  ok(await evaluate(`document.querySelectorAll('.cv-pcell .cv-mc').length === 4`), '4 格已点亮迷你卡渲染')
  ok(await evaluate(`!!document.querySelector('.cv-pcell .cv-mc-rank')`), '迷你卡左上角标渲染')
  ok(await evaluate(`document.querySelectorAll('.cv-pcell .cv-mc-seal').length >= 1`), '蜡封整卡覆盖渲染')
  ok(await evaluate(`!!document.querySelector('.cv-pcell .cv-mc-ed-poly, .cv-pcell .cv-mc-ed-foil')`), '版本着色层渲染')
  ok(await evaluate(`!!document.querySelector('.cv-sell-dupes.inline')`), '扑克区标题行一键卖出重复按钮（2♣×3 + A♠多彩×2 = 3 张）')
  await shot('ui-polish-05-playing-grid.png')

  // —— ④ 变体矩阵（A♠：素牌×1 / 多彩+黄金+红蜡封×2） ——
  console.log('\n--- STEP: 变体矩阵 ---')
  await evaluate(`(() => {
    const cells = [...document.querySelectorAll('.cv-pcell')]
    const cell = cells.find(c => (c.querySelector('.cv-mc-rank')?.innerText || '').replace(/\\s+/g, '') === 'A♠')
    cell?.click() })()`)
  await sleep(1000)
  ok(await evaluate(`!!document.querySelector('.cv-mc-big')`), '细看大图 cv-mc-big 150px')
  ok(await evaluate(`document.querySelectorAll('.cv-pcvar-row').length === 2`), '变体矩阵 2 行（素牌 / 多彩+黄金+红蜡封）')
  ok(await evaluate(`document.querySelectorAll('.cv-pcvar-row .cv-mc-sm').length === 2`), '每行带着色小卡缩略图')
  ok(await evaluate(`!!document.querySelector('.cv-pcvar-row .cv-sell-btn')`), '重复变体行出现出售按钮')
  await shot('ui-polish-06-variant-matrix.png')
  const pg0 = (await storeState())?.gold
  await evaluate(`document.querySelector('.cv-pcvar-row .cv-sell-btn')?.click()`)
  await sleep(800)
  const pg1 = (await storeState())?.gold
  ok(pg1 > pg0, `变体出售入账：金币 ${pg0}→${pg1}`)
  ok((await evaluate(`window.__confirms.length`)) === 1, '变体出售未再弹确认')
  await shot('ui-polish-07-variant-sold.png')
  await evaluate(`document.querySelector('.cv-mc-big')?.click()`)
  await sleep(500)

  // —— ⑤ 参考区（增强整卡瓦片 / 蜡封覆盖 / 版本样卡） ——
  console.log('\n--- STEP: 参考区 ---')
  await evaluate(`(() => {
    const refs = [...document.querySelectorAll('.cv-mc-ref')]
    refs[0]?.scrollIntoView({ block: 'center' }) })()`)
  await sleep(500)
  ok((await evaluate(`document.querySelectorAll('.cv-mc-ref').length`)) >= 12, '增强+蜡封参考卡渲染（≥12）')
  await shot('ui-polish-08-ref-sections.png')

  // —— ⑥ 新 Mod 卡（小丑页签：稀有筛选用 Olympus/Pi/mika，传奇用 dagonet/cicero） ——
  console.log('\n--- STEP: 新 Mod 卡精灵 ---')
  await evaluate(`[...document.querySelectorAll('.cv-tab')].find(t => t.innerText === '小丑')?.click()`)
  await sleep(900)
  await evaluate(`[...document.querySelectorAll('.cv-rf')].find(b => b.innerText === '稀有')?.click()`)
  await sleep(700)
  ok(await evaluate(`(() => {
    const names = [...document.querySelectorAll('.cv-cell:not(.undiscovered) .cv-name')].map(n => n.innerText)
    return ['阿尔忒弥斯', '阿波罗', '赫菲斯托斯', '圆周率小丑'].every(n => names.includes(n)) })()`),
    '稀有筛选下新 Mod 卡点亮（Olympus/Pi）')
  await evaluate(`(() => {
    const cell = [...document.querySelectorAll('.cv-cell')].find(c => c.querySelector('.cv-name')?.innerText === '阿尔忒弥斯')
    cell?.scrollIntoView({ block: 'center' }) })()`)
  await sleep(500)
  await shot('ui-polish-09-new-mods-rare.png')
  await evaluate(`[...document.querySelectorAll('.cv-rf')].find(b => b.innerText === '传奇')?.click()`)
  await sleep(700)
  ok(await evaluate(`(() => {
    const names = [...document.querySelectorAll('.cv-cell:not(.undiscovered) .cv-name')].map(n => n.innerText)
    return names.includes('达戈内特') && names.includes('西塞罗') })()`), '传奇筛选下达戈内特/西塞罗点亮')
  await shot('ui-polish-10-new-mods-legendary.png')
  ok(await evaluate(`!!document.querySelector('.cv-cell canvas, .cv-cell img, .cv-cell .pc-sprite')`), 'Mod 卡精灵渲染元素存在')

  console.log('\n===== CDP SHOTS UI-POLISH RESULT =====')
  console.log('[target alive]', await alive())
  console.log('[crashes]', crashes.length ? '\n' + crashes.join('\n---\n') : 'none')
  console.log(consoleErrors.length ? '[console errors]\n' + consoleErrors.slice(0, 20).join('\n---\n') : 'NO CONSOLE ERRORS')
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
  process.exit(fail || crashes.length ? 1 : 0)
}
main().catch(e => { console.error('DRIVER FAIL', e); process.exit(1) })
