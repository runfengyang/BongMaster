// §15 视觉证据：mod 并入小丑页签（真图集）/ 稀有度分级翻卡 / 增强蜡封版本真精灵 / 格子直达细看
// （file:// 生产模式）→ work/cdp-shots/*.png
// 用法: node scripts/cdp-shots-15.mjs   依赖: electron . --remote-debugging-port=9222（无 vite，dist file://）
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

  // —— 注入存档：全部 68 张 mod 已发现 + 官方代表 + 15 个 mega 小丑包（钓鱼用） ——
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
        { id: 'j_joker', edition: 'poly', obtainedAt: now },
        { id: MOD_JOKERS[0].id, edition: 'holo', obtainedAt: now },
        { id: 'c_fool', edition: null, obtainedAt: now },
      ],
    },
    settings: { volume: 0.5, muted: true, animations: true },
    productivity: { count: 60, pendingMoney: 0, pendingPacks: Array(30).fill('pack_buffoon_mega'), streak: 0 },
  }
  await evaluate(`window.electronAPI.balatroSave(${JSON.stringify(JSON.stringify(seedState))})`)
  await evaluate(`location.hash='#/cards'; location.reload()`)
  await sleep(6000)
  ok(await alive(), '重载后存活')

  // —— ① 小丑页签：mod 卡真图集（无独立 Mod 页签） ——
  console.log('\n--- STEP: 小丑页签含 mod 真图 ---')
  ok(await evaluate(`![...document.querySelectorAll('.cv-tab')].some(b => b.innerText === 'Mod')`), '独立 Mod 页签已移除')
  ok(await evaluate(`[...document.querySelectorAll('.cv-tab')].length === 5`), '页签 = 小丑/塔罗/星球/幻灵/增强·蜡封·版本（5 个）')
  // 找一张 mod 卡格（用 modJokers 前几张的中文名）
  const probeNames = [MOD_JOKERS[0].name, MOD_JOKERS[10].name, MOD_JOKERS[40].name]
  const modCellInfo = await evaluate(`(() => {
    const names = ${JSON.stringify(probeNames)}
    const cells = [...document.querySelectorAll('.cv-grid .cv-cell')]
    for (const n of names) {
      const c = cells.find(x => (x.querySelector('.cv-name')?.innerText || '') === n)
      if (!c) continue
      const sp = c.querySelector('.pc-sprite')
      const bg = sp?.style?.backgroundImage || ''
      c.scrollIntoView({ block: 'center' })
      return { name: n, bg }
    }
    return null })()`)
  ok(!!modCellInfo, `找到 mod 卡格（${modCellInfo?.name || '无'}）`)
  ok(/mod_(pampa|jelly|yuni)\.webp/.test(modCellInfo?.bg || ''), `mod 格使用 mod 图集精灵（${(modCellInfo?.bg || '').slice(0, 60)}）`)
  await sleep(700)
  await shot('30-joker-tab-mods.png')

  // —— ③ 稀有度分级翻卡：自然钓 t3；t4 用 Math.random 覆盖确定性驱动（mod 传奇必入包） ——
  console.log('\n--- STEP: 开包钓 t3/t4 翻卡帧 ---')
  const tearToFan = async () => {
    await evaluate(`document.querySelector('.cv-pack-tile')?.click()`)
    await sleep(1200)
    if (!await evaluate(`!!document.querySelector('.pm-sealed-wrap')`)) {
      await skipPack() // 上一包可能还开着（openCollectionPack 会拒开）
      await evaluate(`document.querySelector('.cv-pack-tile')?.click()`)
      await sleep(1200)
      if (!await evaluate(`!!document.querySelector('.pm-sealed-wrap')`)) return 0
    }
    await evaluate(`document.querySelector('.pm-sealed-wrap')?.click()`) // 撕裂
    await sleep(1500) // tearing 500 + burst 520 + 发牌落定
    return (await evaluate(`document.querySelectorAll('.pm-slot').length`)) || 0
  }
  const skipPack = async () => {
    if (await evaluate(`!!document.querySelector('.pm-overlay')`)) {
      await evaluate(`[...document.querySelectorAll('.pm-actions button')].find(b => b.innerText.includes('跳过'))?.click()`)
      await sleep(700)
    }
  }

  // t3：引擎稀有 5% + mod 稀有 ~5%/张，自然钓（mega 小丑包 4 张/包）
  let gotT3 = false
  for (let pack = 0; pack < 12 && !gotT3; pack++) {
    const slots = await tearToFan()
    if (!slots) break
    for (let i = 0; i < slots; i++) {
      const isBack = await evaluate(`!!document.querySelectorAll('.pm-slot .pc-wrap')[${i}]?.querySelector('.pc-card.faceDown')`)
      if (!isBack) continue
      await evaluate(`document.querySelectorAll('.pm-slot .pc-wrap')[${i}]?.click()`)
      await sleep(110) // 悬念窗口内（t3 400ms）
      const cls = await evaluate(`document.querySelectorAll('.pm-slot')[${i}]?.className || ''`)
      if (cls.includes('sus-t3') || cls.includes('sus-t4')) {
        await sleep(120) // 悬念中段
        await shot('31-flip-t3-suspense.png')
        await sleep(460) // 400ms 满 → 揭晓 10 粒子
        const pcount = await evaluate(`document.querySelectorAll('.pm-slot')[${i}]?.querySelectorAll('.pm-particle').length || 0`)
        ok(pcount >= 10, `t3 揭晓：≥10 粒子（实际 ${pcount}）`)
        gotT3 = true
        await sleep(800)
        break
      }
      await sleep(500) // t1/t2 已翻或即翻
    }
    if (!gotT3) await skipPack()
  }
  ok(gotT3, '钓到 t3 稀有翻卡帧')
  await skipPack() // 清掉 t3 残留包，避免 t4 首包拒开

  // t4：§15 store 测试钩子 __force_mod —— hash 注入后开包必出指定 mod 卡（确定性驱动，真实 UI 路径）
  const legId = MOD_JOKERS.find(j => j.rarity === 4)?.id
  ok(!!legId, `mod 传奇存在（${legId}）`)
  let gotT4 = false
  await evaluate(`location.hash = '#/cards?__force_mod=${legId}'`)
  await sleep(300)
  for (let pack = 0; pack < 6 && !gotT4; pack++) {
    const slots = await tearToFan()
    console.log(`  [t4] pack=${pack} slots=${slots}`)
    if (!slots) break
    const legendarySlots = await evaluate(`(() => {
      const out = []
      document.querySelectorAll('.pm-slot').forEach((s, i) => {
        const bg = s.querySelector('.pc-sprite')?.style?.backgroundImage || ''
        if (bg.includes('mod_')) out.push(i)
      })
      return out })()`)
    console.log(`  [t4] legendarySlots=${JSON.stringify(legendarySlots)}`)
    for (const i of legendarySlots || []) {
      const isBack = await evaluate(`!!document.querySelectorAll('.pm-slot .pc-wrap')[${i}]?.querySelector('.pc-card.faceDown')`)
      if (!isBack) continue
      await evaluate(`document.querySelectorAll('.pm-slot .pc-wrap')[${i}]?.click()`)
      await sleep(110)
      const cls = await evaluate(`document.querySelectorAll('.pm-slot')[${i}]?.className || ''`)
      console.log(`  [t4] slot ${i} cls=${cls}`)
      if (cls.includes('sus-t4')) {
        await sleep(140) // 金脉冲 + 兄弟变暗进行中
        const dimmed = await evaluate(`!!document.querySelector('.pm-fan.pm-t4wait')`)
        ok(dimmed, 't4 悬念：兄弟槽变暗（pm-t4wait）')
        await shot('32-flip-t4-suspense.png')
        await sleep(560) // 700ms 满 → 揭晓 + 金爆 20 粒子 + 小震屏
        const pcount = await evaluate(`document.querySelectorAll('.pm-slot')[${i}]?.querySelectorAll('.pm-particle').length || 0`)
        ok(pcount === 20, `t4 揭晓：20 金粒子（实际 ${pcount}）`)
        await shot('33-flip-t4-burst.png')
        gotT4 = true
        await sleep(900)
        break
      }
      await sleep(500)
    }
    if (!gotT4) await skipPack()
  }
  await evaluate(`location.hash = '#/cards'`)
  ok(gotT4, '钓到 t4 传奇翻卡帧')
  await skipPack()

  // —— ④ 增强·蜡封·版本页签：真精灵 ——
  console.log('\n--- STEP: 增强/蜡封/版本页签真精灵 ---')
  await evaluate(`[...document.querySelectorAll('.cv-tab')].find(b => b.innerText.includes('增强'))?.click()`)
  await sleep(900)
  const enhInfo = await evaluate(`(() => {
    const tiles = [...document.querySelectorAll('.cv-mod-tile')]
    const bgs = tiles.map(t => t.style.backgroundImage)
    const edCards = document.querySelectorAll('.cv-mod-card.edition .pc-wrap').length
    const edHolo = !!document.querySelector('.cv-mod-card.edition .ed-holo')
    const edNeg = !!document.querySelector('.cv-mod-card.edition .ed-negative')
    return { n: tiles.length, allEnh: bgs.every(b => b.includes('enhancers.webp')), edCards, edHolo, edNeg } })()`)
  ok(enhInfo?.n === 12, `增强 8 + 蜡封 4 = 12 枚真精灵瓦片（实际 ${enhInfo?.n}）`)
  ok(enhInfo?.allEnh, '瓦片全部来自 enhancers 图集')
  ok(enhInfo?.edCards === 5, `版本 5 张着色器样卡（实际 ${enhInfo?.edCards}）`)
  ok(enhInfo?.edHolo && enhInfo?.edNeg, '样卡含全息/负片着色器层')
  await shot('34-mods-tab-sprites.png')

  // —— ② 格子点击直达 3D 细看（无中间详情面板） ——
  console.log('\n--- STEP: 图鉴格子直达细看 ---')
  await evaluate(`[...document.querySelectorAll('.cv-tab')].find(b => b.innerText === '小丑')?.click()`)
  await sleep(900)
  const clickCell = async (name) => evaluate(`(() => {
    const cells = [...document.querySelectorAll('.cv-grid .cv-cell')]
    const c = cells.find(x => !x.classList.contains('undiscovered') && (x.querySelector('.cv-name')?.innerText || '') === ${JSON.stringify(name)})
    if (!c) return false
    c.scrollIntoView({ block: 'center' }); c.click(); return true })()`)
  ok(await clickCell('卡尼奥'), '点击卡尼奥格')
  await sleep(900)
  ok(await evaluate(`!document.querySelector('.cv-detail')`), '无中间详情面板（直达）')
  ok(await evaluate(`document.querySelector('.cv-inspect')?.className.includes('in')`), '细看视图直接打开（FLIP 飞入）')
  ok(await evaluate(`document.querySelectorAll('.cv-inspect .cv-tag').length >= 2`), '细看信息区含标签（稀有度/类型/售价）')
  ok(await evaluate(`!!document.querySelector('.cv-inspect .cv-detail-unlock')`), '细看信息区含解锁行')
  await shot('35-gallery-direct-inspect.png')
  await evaluate(`document.querySelector('.cv-inspect')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
  await sleep(500)
  // mod 卡细看：🧩 标签 + 来源行
  ok(await clickCell(MOD_JOKERS[0].name), `点击 mod 卡格（${MOD_JOKERS[0].name}）`)
  await sleep(900)
  ok(await evaluate(`!!document.querySelector('.cv-inspect .cv-tag.mod')`), 'mod 卡细看含 🧩 来源标签')
  await shot('36-mod-inspect.png')
  await evaluate(`document.querySelector('.cv-inspect')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
  await sleep(400)
  ok(await alive(), '全流程存活')

  console.log('\n===== CDP SHOTS §15 RESULT =====')
  console.log('[target alive]', await alive())
  console.log('[crashes]', crashes.length ? '\n' + crashes.join('\n---\n') : 'none')
  console.log(consoleErrors.length ? '[console errors]\n' + consoleErrors.slice(0, 20).join('\n---\n') : 'NO CONSOLE ERRORS')
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
  process.exit(fail || crashes.length ? 1 : 0)
}
main().catch(e => { console.error('DRIVER FAIL', e); process.exit(1) })
