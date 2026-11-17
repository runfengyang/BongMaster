// §11 收藏模式真机验证：通过 CDP 驱动真实 BongMaster Electron 应用
// 用法: node scripts/cdp-collect-drive.mjs   依赖: vite(5173) + electron . --remote-debugging-port=9222 已启动
// 验证：/cards 图鉴 + m6x11 字体 + 🎁 角标 + 卡包区 + 独立开包全流程（撕开→翻牌→选卡→入收藏）
//       + /entertainment 恢复为 webview 娱乐中心 + 全程无页面错误/渲染进程崩溃
// 零依赖：内置最小 WebSocket 客户端（与 scripts/cdp-drive.mjs 同款）。
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
      if (op === 9) { this.sendRaw(0x8A, payload); continue } // ping→pong
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
  // 等调试端口就绪
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
      console.log('!!! RENDERER CRASHED (Inspector.targetCrashed) !!!')
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

  // —— 步骤 0: 注入带卡包/收藏/发现的存档（走真实 IPC 存档链路），再重载 ——
  console.log('\n--- STEP: 注入存档（IPC balatroSave）并重载 ---')
  const seedState = {
    version: 1,
    savedAt: new Date().toISOString(),
    run: null,
    collection: {
      discovered: ['j_joker', 'j_greedy_joker', 'j_lusty_joker', 'j_wrathful_joker', 'j_gluttonous_joker',
        'j_jolly_joker', 'j_zany_joker', 'j_mad_joker', 'j_crazy_joker', 'j_droll_joker',
        't_fool', 't_magician', 'p_mercury', 's_familiar'],
      ownedCards: [
        { id: 'j_joker', edition: null, obtainedAt: new Date().toISOString() },
        { id: 'j_joker', edition: 'foil', obtainedAt: new Date().toISOString() },
      ],
    },
    settings: { volume: 0.5, muted: true, animations: true },
    productivity: { count: 20, pendingMoney: 0, pendingPacks: ['pack_buffoon_normal', 'pack_celestial_normal'], streak: 0 },
  }
  await evaluate(`window.electronAPI.balatroSave(${JSON.stringify(JSON.stringify(seedState))})`)
  await evaluate(`location.hash='#/cards'; location.reload()`)
  await sleep(6000)
  ok(await alive(), '重载后渲染进程存活')

  // —— 步骤 1: /cards 图鉴页 ——
  console.log('\n--- STEP: #/cards 图鉴 ---')
  const fontOk = await evaluate(`document.fonts.check('12px m6x11')`)
  ok(fontOk === true, 'm6x11 字体已加载（document.fonts.check）')
  const gridInfo = await evaluate(`(() => {
    const cards = document.querySelectorAll('.cv-grid .pc-wrap').length
    const silhouette = document.querySelectorAll('.cv-silhouette').length
    const owned = [...document.querySelectorAll('.cv-owned')].map(e => e.innerText)
    const eds = document.querySelectorAll('.cv-eds .cv-ed').length
    return { cards, silhouette, owned, eds } })()`)
  console.log('[grid]', JSON.stringify(gridInfo))
  ok(gridInfo.cards >= 10, `已发现卡渲染 PlayingCard ×${gridInfo.cards}`)
  ok(gridInfo.owned.includes('×2'), 'j_joker 持有角标 ×2')
  ok(gridInfo.eds >= 2, '版本徽章圆点渲染（基础+闪箔）')
  const badge = await evaluate(`(document.querySelector('.bm-pack-badge')||{}).innerText || ''`)
  ok(badge.includes('2'), `导航 🎁 角标 = 2（实际 "${badge}"）`)
  const packTiles = await evaluate(`document.querySelectorAll('.cv-pack-tile').length`)
  ok(packTiles === 2, `卡包区 2 个待开卡包（实际 ${packTiles}）`)

  // —— 步骤 2: 独立开包全流程 ——
  console.log('\n--- STEP: 独立开包（撕开→翻牌→选卡→入收藏） ---')
  await evaluate(`document.querySelector('.cv-pack-tile').click()`)
  await sleep(1200)
  ok(await evaluate(`!!document.querySelector('.pm-overlay')`), 'PackModal 开包弹层出现')
  ok(await evaluate(`!!document.querySelector('canvas.crt-bg')`), 'CRT 漩涡背景衬底在')
  await evaluate(`document.querySelector('.pm-sealed-wrap').click()`) // 撕开
  await sleep(1600)
  const slots = await evaluate(`document.querySelectorAll('.pm-slot').length`)
  ok(slots >= 2, `扇形展开 ${slots} 个选项`)
  // 逐张翻开（稀有卡有 0.4s 悬念，逐张点击间隔留足）
  for (let i = 0; i < slots; i++) {
    await evaluate(`document.querySelectorAll('.pm-slot .pc-wrap')[${i}].click()`)
    await sleep(900)
  }
  // 选中第 0 张（再点一次 = 选择）
  await evaluate(`document.querySelectorAll('.pm-slot .pc-wrap')[0].click()`)
  await sleep(600)
  const chosen = await evaluate(`document.querySelectorAll('.pm-slot.chosen').length`)
  ok(chosen === 1, '选中 1 张（chosen 高亮）')
  await evaluate(`[...document.querySelectorAll('.pm-actions button')].find(b => b.innerText.includes('拿走')).click()`)
  await sleep(2000)
  ok(await evaluate(`!document.querySelector('.pm-overlay')`), '拿走后弹层关闭')
  const ownedAfter = await evaluate(`(() => {
    const owned = [...document.querySelectorAll('.cv-owned')].map(e => e.innerText)
    const badgeNow = (document.querySelector('.bm-pack-badge')||{}).innerText || ''
    return { owned, badgeNow } })()`)
  console.log('[owned after pick]', JSON.stringify(ownedAfter))
  ok(ownedAfter.badgeNow.includes('1'), `角标递减为 1（实际 "${ownedAfter.badgeNow}"）`)
  const savedOwned = await evaluate(`(async () => {
    try {
      const raw = await window.electronAPI.balatroLoad()
      if (typeof raw !== 'string') return { err: 'raw not string: ' + typeof raw }
      const s = JSON.parse(raw)
      return { n: (s.collection?.ownedCards || []).length,
               editions: (s.collection?.ownedCards || []).map(o => o.edition) }
    } catch (e) { return { err: String(e) } }
  })()`)
  console.log('[saved ownedCards]', JSON.stringify(savedOwned))
  ok(savedOwned && savedOwned.n === 3, `收藏持久化 3 张（含新开出 1 张），实际 ${savedOwned && savedOwned.n}${savedOwned?.err ? '（' + savedOwned.err + '）' : ''}`)

  // —— 步骤 3: 跳过第二个包 ——
  console.log('\n--- STEP: 跳过第二个卡包 ---')
  await evaluate(`document.querySelector('.cv-pack-tile').click()`)
  await sleep(1000)
  await evaluate(`document.querySelector('.pm-sealed-wrap').click()`)
  await sleep(1500)
  await evaluate(`[...document.querySelectorAll('.pm-actions button')].find(b => b.innerText.includes('跳过')).click()`)
  await sleep(1200)
  const badgeFinal = await evaluate(`(document.querySelector('.bm-pack-badge')||{}).innerText || 'NONE'`)
  ok(badgeFinal === 'NONE' || badgeFinal === '', `角标清空（实际 "${badgeFinal}"）`)
  ok(await evaluate(`!document.querySelector('.cv-packs')`), '卡包区随待开数清零而隐藏')

  // —— 步骤 4: /entertainment 恢复为 webview 娱乐中心 ——
  console.log('\n--- STEP: #/entertainment 娱乐中心 ---')
  await evaluate(`location.hash='#/entertainment'`)
  await sleep(6000)
  const ent = await evaluate(`(() => ({
    webviews: document.querySelectorAll('webview').length,
    text: (document.body.innerText||'').slice(0, 120),
    hasBalatroRunUI: !!document.querySelector('[class*=blind], [class*=shop-panel]'),
  }))()`)
  console.log('[entertainment]', JSON.stringify(ent))
  ok(ent.webviews >= 1, `娱乐中心 webview 渲染（${ent.webviews} 个）`)
  ok(!ent.hasBalatroRunUI, '无 Run UI 残留')

  // —— 步骤 5: 再回 /cards 大网格滚动（IO 门控压力面） ——
  console.log('\n--- STEP: 回 /cards 存活复查 ---')
  await evaluate(`location.hash='#/cards'`)
  await sleep(5000)
  await evaluate(`document.querySelector('.cv-body')?.scrollTo(0, 99999)`)
  await sleep(2500)
  ok(await alive(), '滚动全程渲染进程存活')

  console.log('\n===== CDP COLLECT DRIVE RESULT =====')
  console.log('[target alive]', await alive())
  console.log(consoleErrors.length ? '[errors]\n' + consoleErrors.slice(0, 20).join('\n---\n') : 'NO PAGE ERRORS')
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
  process.exit(fail || consoleErrors.length ? 1 : 0)
}
main().catch(e => { console.error('DRIVER FAIL', e); process.exit(1) })
