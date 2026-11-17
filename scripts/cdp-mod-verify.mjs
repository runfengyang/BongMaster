// §12 Mod/精灵真机验证：CDP 驱动真实 BongMaster Electron 应用
// 用法: node scripts/cdp-mod-verify.mjs   依赖: vite(5173) + electron . --remote-debugging-port=9222 已启动
// 验证：官方精灵卡面渲染（.pc-sprite 背景图）+ 图鉴 Mod 页签（50 张/详情 🧩 来源标签）
//       + Buffoon 包真机混入 Mod 卡并选入收藏 + 截图留证 + 全程无页面错误
// 零依赖：内置最小 WebSocket 客户端（与 scripts/cdp-collect-drive.mjs 同款）。
import http from 'node:http'
import net from 'node:net'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const SHOTS = path.join(ROOT, 'work', 'cdp-shots')
fs.mkdirSync(SHOTS, { recursive: true })

const { MOD_JOKERS } = await import('../src/balatro/data/modJokers.js')
const MOD_NAMES = new Set(MOD_JOKERS.map(j => j.name))

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
      const text = ev.params.args.map(a => a.value ?? a.description ?? '').join(' ')
      if (!text.includes('favicon')) consoleErrors.push(text.slice(0, 300))
    }
    if (ev.method === 'Inspector.targetCrashed') {
      console.log('!!! RENDERER CRASHED !!!')
      consoleErrors.push('RENDERER CRASHED')
    }
  }
  await ws.connect()
  await ws.call('Runtime.enable')
  await ws.call('Page.enable')
  await ws.call('Inspector.enable')

  const evaluate = async (expr) => {
    const r = await ws.call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    if (r?.exceptionDetails) console.error('[eval error]', JSON.stringify(r.exceptionDetails).slice(0, 200))
    return r?.result?.value
  }
  const alive = async () => {
    try { const t = await httpJson('/json/list'); return t.some(x => x.id === page.id) } catch { return false }
  }
  const shot = async (file) => {
    const r = await ws.call('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(SHOTS, file), Buffer.from(r.data, 'base64'))
    console.log('[shot]', file)
  }

  // —— STEP 0: 图集可达性 + 注入存档并重载 ——
  console.log('\n--- STEP: 图集可达 + 注入存档重载 ---')
  const atlasOk = await evaluate(`(async () => {
    const out = {}
    for (const a of ['jokers', 'tarots', 'vouchers', 'enhancers']) {
      try { out[a] = (await fetch('/sprites/' + a + '.webp', { method: 'HEAD' })).ok } catch { out[a] = false }
    }
    return out })()`)
  console.log('[atlas]', JSON.stringify(atlasOk))
  ok(Object.values(atlasOk).every(Boolean), '4 张图集 webp 全部可访问')

  const seedState = {
    version: 1,
    savedAt: new Date().toISOString(),
    run: null,
    collection: {
      discovered: [
        'j_joker', 'j_greedy_joker', 'j_lusty_joker', 'j_wrathful_joker', 'j_gluttonous_joker',
        'j_jolly_joker', 'j_zany_joker', 'j_mad_joker', 'j_blueprint', 'j_brainstorm',
        'j_canio', 'j_triboulet', 'j_yorick', 'j_chicot', 'j_perkeo',
        'c_fool', 'c_magician', 'p_mercury', 's_familiar', 's_soul',
        ...MOD_JOKERS.map(j => j.id),
      ],
      ownedCards: [
        { id: 'mj_cry_m', edition: 'holo', obtainedAt: new Date().toISOString() },
        { id: 'mj_pk_mewtwo', edition: null, obtainedAt: new Date().toISOString() },
        { id: 'j_joker', edition: null, obtainedAt: new Date().toISOString() },
      ],
    },
    settings: { volume: 0.5, muted: true, animations: true },
    productivity: { count: 40, pendingMoney: 0, pendingPacks: ['pack_buffoon_jumbo', 'pack_buffoon_jumbo', 'pack_buffoon_normal', 'pack_buffoon_normal'], streak: 0 },
  }
  await evaluate(`window.electronAPI.balatroSave(${JSON.stringify(JSON.stringify(seedState))})`)
  await evaluate(`location.hash='#/cards'; location.reload()`)
  await sleep(6000)
  ok(await alive(), '重载后渲染进程存活')

  // —— STEP 1: 小丑页签官方精灵渲染 ——
  console.log('\n--- STEP: 小丑页签精灵渲染 ---')
  const sp = await evaluate(`(() => {
    const tiles = [...document.querySelectorAll('.cv-grid .pc-sprite')]
    const first = tiles[0] ? getComputedStyle(tiles[0]).backgroundImage : ''
    const legendary = document.querySelectorAll('.cv-grid .pc-sprite-soul').length
    return { n: tiles.length, bg: first.slice(0, 120), legendary } })()`)
  console.log('[sprites]', JSON.stringify(sp))
  ok(sp.n >= 15, `精灵卡面渲染 ×${sp.n}（含已发现官方卡）`)
  ok(sp.bg.includes('sprites/jokers.webp'), '背景图指向 jokers 图集')
  ok(sp.legendary >= 1, `传奇灵魂叠加层渲染 ×${sp.legendary}`)
  await evaluate(`document.querySelector('.cv-body')?.scrollTo(0, 0)`)
  await sleep(500)
  await shot('cards-joker-sprites.png')

  // —— STEP 2: Mod 页签 ——
  console.log('\n--- STEP: Mod 页签 ---')
  await evaluate(`[...document.querySelectorAll('.cv-tab')].find(b => b.innerText.trim() === 'Mod')?.click()`)
  await sleep(1200)
  const mod = await evaluate(`(() => {
    const cells = document.querySelectorAll('.cv-grid .cv-cell')
    const sprites = document.querySelectorAll('.cv-grid .pc-sprite').length
    const names = [...document.querySelectorAll('.cv-grid .cv-name')].map(e => e.innerText)
    const owned = [...document.querySelectorAll('.cv-owned')].map(e => e.innerText)
    return { cells: cells.length, sprites, owned,
             hasM: names.includes('M'), hasArticuno: names.includes('急冻鸟'), hasEnvelope: names.includes('红包') } })()`)
  console.log('[mod tab]', JSON.stringify(mod))
  ok(mod.cells === 50, `Mod 页签渲染 50 张（实际 ${mod.cells}）`)
  ok(mod.sprites === 0, 'Mod 卡无官方精灵（走程序化 motif 回退）')
  ok(mod.hasM && mod.hasArticuno && mod.hasEnvelope, '三个 Mod 来源代表卡均在（M/急冻鸟/红包）')
  ok(mod.owned.includes('×1'), '持有角标 ×1（mj_cry_m / mj_pk_mewtwo）')
  await shot('cards-mod-tab.png')

  // 详情：来源标签
  await evaluate(`document.querySelectorAll('.cv-grid .cv-cell')[0].click()`)
  await sleep(900)
  const det = await evaluate(`(() => {
    const tags = [...document.querySelectorAll('.cv-detail .cv-tag')].map(e => e.innerText)
    const unlock = (document.querySelector('.cv-detail-unlock') || {}).innerText || ''
    const name = (document.querySelector('.cv-detail-name') || {}).innerText || ''
    return { tags, unlock: unlock.slice(0, 80), name: name.slice(0, 30) } })()`)
  console.log('[mod detail]', JSON.stringify(det))
  ok(det.tags.some(t => t.includes('🧩') && t.includes('Cryptid')), '详情 🧩 来源标签 = Cryptid')
  ok(det.unlock.includes('来源 Mod') && det.unlock.includes('不进 Run 卡池'), '详情来源说明文案')
  await shot('cards-mod-detail.png')
  await evaluate(`document.querySelector('.cv-detail-close')?.click()`)
  await sleep(500)

  // —— STEP 3: Buffoon 包真机混入 ——
  console.log('\n--- STEP: Buffoon 包真机混入（最多 4 包） ---')
  const modNamesArr = JSON.stringify([...MOD_NAMES])
  let mixFound = false, pickedName = ''
  for (let p = 0; p < 4 && !mixFound; p++) {
    const hasTile = await evaluate(`!!document.querySelector('.cv-pack-tile')`)
    if (!hasTile) break
    await evaluate(`document.querySelector('.cv-pack-tile').click()`)
    await sleep(1200)
    await evaluate(`document.querySelector('.pm-sealed-wrap')?.click()`)
    await sleep(1800)
    const slots = await evaluate(`document.querySelectorAll('.pm-slot').length`)
    for (let i = 0; i < slots; i++) {
      await evaluate(`document.querySelectorAll('.pm-slot .pc-wrap')[${i}]?.click()`)
      await sleep(800)
    }
    const names = await evaluate(`[...document.querySelectorAll('.pm-opt-name')].map(e => e.innerText)`)
    console.log(`[pack ${p + 1}]`, JSON.stringify(names))
    const modIdx = (names || []).findIndex(n => MOD_NAMES.has(n))
    if (modIdx >= 0) {
      mixFound = true
      pickedName = names[modIdx]
      await shot('pack-mod-mixed.png')
      await evaluate(`document.querySelectorAll('.pm-slot .pc-wrap')[${modIdx}]?.click()`)
      await sleep(600)
      await evaluate(`[...document.querySelectorAll('.pm-actions button')].find(b => b.innerText.includes('拿走'))?.click()`)
      await sleep(2000)
    } else {
      await evaluate(`[...document.querySelectorAll('.pm-actions button')].find(b => b.innerText.includes('跳过'))?.click()`)
      await sleep(1200)
    }
  }
  ok(mixFound, `Buffoon 包真机混入 Mod 卡${pickedName ? `（抽到「${pickedName}」并拿走）` : ''}`)

  if (mixFound) {
    const saved = await evaluate(`(async () => {
      try {
        const raw = await window.electronAPI.balatroLoad()
        if (typeof raw !== 'string') return { err: 'raw not string' }
        const s = JSON.parse(raw)
        return { mods: (s.collection?.ownedCards || []).filter(o => o.id.startsWith('mj_')).map(o => o.id) }
      } catch (e) { return { err: String(e) } }
    })()`)
    console.log('[saved mj owned]', JSON.stringify(saved))
    ok(saved.mods && saved.mods.length >= 3, `真机收藏持久化含 ${saved.mods?.length ?? 0} 张 Mod 卡（含新开 1 张）`)
  }

  console.log('\n===== CDP MOD VERIFY RESULT =====')
  console.log('[target alive]', await alive())
  console.log(consoleErrors.length ? '[errors]\n' + consoleErrors.slice(0, 20).join('\n---\n') : 'NO PAGE ERRORS')
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
  process.exit(fail || consoleErrors.length ? 1 : 0)
}
main().catch(e => { console.error('DRIVER FAIL', e); process.exit(1) })
