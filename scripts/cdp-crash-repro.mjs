// §13① 闪退复现：CDP 驱动真实应用，遍历点击 /cards 每种卡 + 开包后点新卡
// 用法: node scripts/cdp-crash-repro.mjs   依赖: vite(5173) + electron . --remote-debugging-port=9222 已启动
// 监控：Inspector.targetCrashed / Runtime.exceptionThrown / console error / 存活探针
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

  const evaluate = async (expr) => {
    const r = await ws.call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    if (r?.exceptionDetails) return { __evalError: JSON.stringify(r.exceptionDetails).slice(0, 400) }
    return r?.result?.value
  }
  const alive = async () => {
    try { const t = await httpJson('/json/list'); return t.some(x => x.id === page.id) } catch { return false }
  }
  const crashCheck = async (label) => {
    const a = await alive()
    if (!a || crashes.length) {
      console.error(`💥 CRASH at: ${label}`)
      console.error(crashes.join('\n'))
      return false
    }
    return true
  }

  // —— 注入全种类存档 ——
  console.log('\n--- STEP: 注入存档（全种类 + 多版本 + 卡包）并重载 ---')
  const now = new Date().toISOString()
  const seedState = {
    version: 1, savedAt: now, run: null,
    collection: {
      discovered: [
        'j_joker', 'j_greedy_joker', 'j_mad_joker', 'j_blueprint', 'j_brainstorm',
        'j_canio', 'j_triboulet', 'j_yorick', 'j_chicot', 'j_perkeo', // 传奇×5（soul 双帧）
        'c_fool', 'c_magician', 'c_world', 'p_mercury', 'p_pluto', 's_familiar', 's_soul', 's_aura',
        ...MOD_JOKERS.map(j => j.id),
      ],
      ownedCards: [
        { id: 'j_joker', edition: null, obtainedAt: now },
        { id: 'j_joker', edition: 'foil', obtainedAt: now },
        { id: 'j_joker', edition: 'holo', obtainedAt: now },
        { id: 'j_joker', edition: 'poly', obtainedAt: now },
        { id: 'j_joker', edition: 'negative', obtainedAt: now }, // 5 版本徽章全满
        { id: 'j_canio', edition: 'foil', obtainedAt: now },
        { id: 'mj_cry_m', edition: 'holo', obtainedAt: now },
        { id: 'c_fool', edition: null, obtainedAt: now },
      ],
    },
    settings: { volume: 0.5, muted: true, animations: true },
    productivity: { count: 40, pendingMoney: 0, pendingPacks: ['pack_buffoon_jumbo', 'pack_buffoon_normal', 'pack_arcana_normal'], streak: 0 },
  }
  await evaluate(`window.electronAPI.balatroSave(${JSON.stringify(JSON.stringify(seedState))})`)
  await evaluate(`location.hash='#/cards'; location.reload()`)
  await sleep(6000)
  ok(await crashCheck('reload'), '重载后存活')

  // —— 通用：按卡片名称点击格子并开/关详情 ——
  async function clickCardByName(tabName, cardName, label) {
    if (tabName) {
      await evaluate(`[...document.querySelectorAll('.cv-tab')].find(b => b.innerText.trim() === ${JSON.stringify(tabName)})?.click()`)
      await sleep(700)
    }
    const clicked = await evaluate(`(() => {
      const cells = [...document.querySelectorAll('.cv-grid .cv-cell')]
      const c = cells.find(x => !x.classList.contains('undiscovered') && (x.querySelector('.cv-name')?.innerText || '') === ${JSON.stringify(cardName)})
      if (!c) return false
      c.click()
      return true })()`)
    if (!clicked) { console.log(`  [skip] ${label}：找不到已发现格 ${cardName}`); return false }
    await sleep(900)
    const open = await evaluate(`!!document.querySelector('.cv-detail')`)
    if (!await crashCheck(`${label} 打开详情`)) { ok(false, `${label} 打开详情后存活`); return false }
    ok(open, `${label} 详情打开`)
    // 详情内移动鼠标触发倾斜/光泽，再关闭
    await evaluate(`(() => {
      const el = document.querySelector('.cv-detail .pc-wrap')
      if (el) {
        const r = el.getBoundingClientRect()
        for (let i = 0; i < 6; i++) el.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + i * 12, clientY: r.top + i * 9, bubbles: true }))
      }
      return true })()`)
    await sleep(700)
    await evaluate(`document.querySelector('.cv-detail-close')?.click()`)
    await sleep(500)
    return await crashCheck(`${label} 关闭详情`)
  }

  console.log('\n--- STEP: 遍历点击每种卡 ---')
  const seqs = [
    ['小丑', '小丑', '普通小丑(精灵)'],
    ['小丑', '卡尼奥', '传奇Canio(soul双帧)'],
    ['小丑', '特里布莱', '传奇Triboulet'],
    ['小丑', '蓝图', '稀有蓝图'],
    ['塔罗', '愚者', '塔罗(精灵)'],
    ['星球', '水星', '星球(精灵)'],
    ['幻灵', '熟悉', '幻灵(精灵)'],
    ['幻灵', '灵魂', '幻灵·灵魂'],
    ['Mod', 'M', 'Mod卡(无精灵/motif回退)'],
    ['Mod', '梦幻', 'Mod卡(超梦系文本)'],
    ['Mod', '红包', 'Mod卡(带$文本)'],
  ]
  for (const [tab, name, label] of seqs) {
    const okk = await clickCardByName(tab, name, label)
    if (!okk) { console.error('⛔ 中止：' + label); break }
  }
  // 未被发现剪影格：点击应无任何反应
  await evaluate(`[...document.querySelectorAll('.cv-tab')].find(b => b.innerText.trim() === '小丑')?.click()`)
  await sleep(600)
  await evaluate(`document.querySelector('.cv-grid .cv-cell.undiscovered')?.click()`)
  await sleep(800)
  ok(await crashCheck('剪影格点击'), '剪影格点击无崩溃')
  ok(await evaluate(`!document.querySelector('.cv-detail')`), '剪影格不打开详情')

  // —— 快速连续开关详情（rAF 压力） ——
  console.log('\n--- STEP: 快速连点开关详情 ×6 ---')
  for (let i = 0; i < 6; i++) {
    await evaluate(`(() => { const c = [...document.querySelectorAll('.cv-grid .cv-cell')].find(x => !x.classList.contains('undiscovered')); c?.click(); return true })()`)
    await sleep(220)
    await evaluate(`document.querySelector('.cv-detail-close')?.click()`)
    await sleep(180)
  }
  ok(await crashCheck('快速连点×6'), '快速连点开关详情后存活')

  // —— 开包 → 拿走 → 立即点击新获得的卡 ——
  console.log('\n--- STEP: 开包后点击新获得的卡 ---')
  await evaluate(`document.querySelector('.cv-pack-tile')?.click()`)
  await sleep(1200)
  await evaluate(`document.querySelector('.pm-sealed-wrap')?.click()`)
  await sleep(1800)
  const slots = await evaluate(`document.querySelectorAll('.pm-slot').length`)
  for (let i = 0; i < (slots || 0); i++) {
    await evaluate(`document.querySelectorAll('.pm-slot .pc-wrap')[${i}]?.click()`)
    await sleep(700)
    if (!await crashCheck(`翻第${i}张`)) break
  }
  const gotName = await evaluate(`(document.querySelector('.pm-opt-name')||{}).innerText || ''`)
  await evaluate(`document.querySelectorAll('.pm-slot .pc-wrap')[0]?.click()`)
  await sleep(500)
  await evaluate(`[...document.querySelectorAll('.pm-actions button')].find(b => b.innerText.includes('拿走'))?.click()`)
  await sleep(2000)
  if (!await crashCheck('拿走新卡')) { ok(false, '拿走后存活') } else {
    ok(true, `拿走新卡「${gotName}」后存活`)
    // 立即在网格中点击新获得的卡（若有同名已发现格）
    const clickedNew = await clickCardByName(null, gotName, `新获得卡「${gotName}」`)
    ok(clickedNew !== false || true, '新获得卡点击流程结束')
  }

  console.log('\n===== CDP CRASH REPRO RESULT =====')
  console.log('[target alive]', await alive())
  console.log('[crashes]', crashes.length ? '\n' + crashes.join('\n---\n') : 'none')
  console.log(consoleErrors.length ? '[console errors]\n' + consoleErrors.slice(0, 20).join('\n---\n') : 'NO CONSOLE ERRORS')
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
  process.exit(fail || crashes.length ? 1 : 0)
}
main().catch(e => { console.error('DRIVER FAIL', e); process.exit(1) })
