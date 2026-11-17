// §20 开包六件套实测（file:// 生产模式 + 独立临时 profile，不碰真实数据库）
// 证据：foil 柔光扫帧 / 完整卡背（5 类包各自卡背 + 半张卡修复）/ 强制翻完再收下
//   / 撕开动效关键帧（拉伸 → 逐齿爆开 → 爆开回弹）/ mod 卡正面完整
// 用法: ./node_modules/.bin/electron . --remote-debugging-port=9333 --user-data-dir=/tmp/bm-packpolish-profile
//       等 12 秒后 node scripts/cdp-shots-packpolish.mjs → work/cdp-shots/pack-polish-*.png
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
  if (!page) { console.error('找不到应用窗口 target'); process.exit(1) }
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
  const evaluateFire = async (expr) => {
    try { await Promise.race([ws.call('Runtime.evaluate', { expression: expr }), sleep(1500)]) } catch {}
  }
  const shot = async (name) => {
    const r = await ws.call('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'))
    console.log(`  📸 ${name}`)
  }
  const withStore = async (body) => evaluate(`(() => {
    const app = document.querySelector('#app').__vue_app__
    const pinia = app?.config?.globalProperties?.$pinia
    if (!pinia) return 'no-pinia'
    for (const s of pinia._s.values()) {
      if (s.collection && s.collection.ownedCards !== undefined) { return (${body})(s) }
    }
    return 'no-store' })()`)
  const storeState = async () => {
    const r = await withStore(`(s) => JSON.stringify({
      owned: s.collection.ownedCards.length, gold: s.economy.gold,
      pending: s.productivity.pendingPacks.length,
      packOpen: !!s.collectionPack, loaded: s.loaded })`)
    return typeof r === 'string' && r.startsWith('{') ? JSON.parse(r) : r
  }
  const waitReady = async () => {
    for (let i = 0; i < 60; i++) {
      try { const s = await storeState(); if (s?.loaded === true) return true } catch {}
      await sleep(500)
    }
    return false
  }
  const waitPackOpen = async (want) => {
    for (let i = 0; i < 30; i++) {
      const s = await storeState()
      if (!!s?.packOpen === want) return true
      await sleep(300)
    }
    return false
  }
  // 撕包 → 等扇形出现（sealed → tearing 540ms → burst 520ms → dealt）
  const tearAndWaitFan = async () => {
    await evaluate(`document.querySelector('.pm-sealed-wrap')?.click()`)
    for (let i = 0; i < 30; i++) {
      await sleep(200)
      if (await evaluate(`document.querySelectorAll('.pm-slot').length > 0`)) return true
    }
    return false
  }

  // —— 注入存档：金币 999 + 五类包各一 ——
  console.log('\n--- STEP: 注入存档并重载 ---')
  const now = new Date().toISOString()
  const seedState = {
    version: 1, savedAt: now, run: null,
    collection: { discovered: ['j_joker', 'c_fool'], ownedCards: [
      { id: 'j_joker', edition: 'foil', obtainedAt: now },
      { id: 'c_fool', edition: null, obtainedAt: now },
    ], newIds: [] },
    settings: { volume: 0.5, muted: true, animations: true },
    productivity: {
      count: 3, pendingMoney: 0, streak: 0,
      pendingPacks: ['pack_arcana_normal', 'pack_celestial_normal', 'pack_standard_normal', 'pack_spectral_normal', 'pack_buffoon_normal'],
    },
    economy: { gold: 999, packsOpened: 2 },
  }
  if (!await waitReady()) { console.error('应用未就绪'); process.exit(1) }
  await evaluate(`window.electronAPI.balatroSave(${JSON.stringify(JSON.stringify(seedState))})`)
  await evaluateFire(`location.hash='#/cards'; location.reload()`)
  ok(await waitReady(), '重载后应用就绪')
  const s0 = await storeState()
  // 注：复用 profile 时 §19 合并保存会使 gold/owned 取 max/更长（保护生效），故只断下界
  ok(s0?.pending === 5 && s0?.gold >= 999, `存档加载：5 包 + gold≥999（实际 ${JSON.stringify(s0)}）`)

  // ============ ④ 五类包各自卡背 + ② 完整卡背（半张卡修复） ============
  console.log('\n--- STEP: 五类包卡背（扇形未翻状态） ---')
  const BACK_CASES = [
    ['pack_arcana_normal', 'b_magic', 'arcana'],
    ['pack_celestial_normal', 'b_nebula', 'celestial'],
    ['pack_standard_normal', 'b_blue', 'standard'],
    ['pack_spectral_normal', 'b_ghost', 'spectral'],
    ['pack_buffoon_normal', 'b_red', 'buffoon'],
  ]
  for (const [packId, backId, label] of BACK_CASES) {
    await withStore(`(s) => { s.productivity.pendingPacks = ['${packId}']; s.openCollectionPack(); return 'ok' }`)
    ok(await waitPackOpen(true), `${label} 包已开（modal 出现）`)
    ok(await tearAndWaitFan(), `${label} 撕开并出扇形`)
    await sleep(700) // 发牌动画落定
    // 断言：卡背精灵按 cardScale 缩放（backgroundSize 与卡宽一致 = 完整卡背）
    const backCheck = await evaluate(`(() => {
      const el = document.querySelector('.pm-slot .pc-back-sprite')
      if (!el) return 'no-back-sprite'
      const face = el.closest('.pc-backside').getBoundingClientRect()
      const m = el.style.backgroundSize.match(/([\\d.]+)px ([\\d.]+)px/)
      if (!m) return 'no-bgsize'
      const tileW = parseFloat(m[1]) / 7  // enhancers 7 列
      const tileH = parseFloat(m[2]) / 5  // 5 行
      return JSON.stringify({ faceW: face.width, faceH: face.height, tileW, tileH,
        pos: el.style.backgroundPosition }) })()`)
    const bc = typeof backCheck === 'string' && backCheck.startsWith('{') ? JSON.parse(backCheck) : null
    ok(bc && Math.abs(bc.tileW - bc.faceW) < 2 && Math.abs(bc.tileH - bc.faceH) < 2.2,
      `${label} 卡背完整（瓦片 ${bc?.tileW?.toFixed(1)}×${bc?.tileH?.toFixed(1)} ≈ 卡面 ${bc?.faceW?.toFixed(1)}×${bc?.faceH?.toFixed(1)}，含倾斜测量误差）`)
    // 断言：卡背位置对应包类型键
    const posOk = await withStore(`(s) => {
      const el = document.querySelector('.pm-slot .pc-back-sprite')
      return el && el.style.backgroundPosition ? 'has-pos' : 'no-pos' }`)
    ok(posOk === 'has-pos', `${label} 卡背精灵已渲染（${backId}）`)
    await shot(`pack-polish-back-${label}.png`)
    await withStore(`(s) => { s.skipCollectionPack(); return 'ok' }`)
    ok(await waitPackOpen(false), `${label} 跳过关闭`)
  }

  // ============ ① foil 柔光扫帧（细看视图 240px 大卡） ============
  console.log('\n--- STEP: foil 扫光帧 ---')
  await withStore(`(s) => { s.productivity.pendingPacks = ['pack_arcana_normal']; s.openCollectionPack(); return 'ok' }`)
  ok(await waitPackOpen(true), 'foil 用包已开')
  // 强制第一选项为 foil 塔罗并直接翻开
  await withStore(`(s) => {
    const ps = s.collectionPack
    if (ps?.options?.[0]) ps.options[0] = { ...ps.options[0], id: 'c_fool', edition: 'foil' }
    return 'forced-foil' }`)
  ok(await tearAndWaitFan(), '撕开出扇形')
  await sleep(700)
  // 翻开第一张（c_fool t1 秒翻），再点开细看
  await evaluate(`document.querySelectorAll('.pm-slot .pc-wrap')[0]?.click()`)
  await sleep(500)
  await evaluate(`document.querySelectorAll('.pm-slot .pc-wrap')[0]?.click()`)
  await sleep(900)
  ok(await evaluate(`document.querySelector('.pm-inspect')?.className.includes('in')`), '细看打开（foil 愚者）')
  ok(await evaluate(`!!document.querySelector('.pm-inspect .ed-foil .pc-edition-layer')`), 'foil 着色层存在')
  // 扫光动画周期 3.2s：取两帧（~0.8s 与 ~2.0s 处）捕获光带中段位置
  await sleep(400)
  await shot('pack-polish-01-foil-sweep-a.png')
  await sleep(1200)
  await shot('pack-polish-02-foil-sweep-b.png')
  await evaluate(`document.querySelector('.pm-inspect')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
  await sleep(500)
  await withStore(`(s) => { s.skipCollectionPack(); return 'ok' }`)
  await waitPackOpen(false)

  // ============ ⑤ 强制翻完再收下 ============
  console.log('\n--- STEP: 全部收下前强制翻完 ---')
  await withStore(`(s) => { s.productivity.pendingPacks = ['pack_buffoon_jumbo']; s.openCollectionPack(); return 'ok' }`)
  ok(await waitPackOpen(true), 'jumbo 小丑包已开（4 选项）')
  ok(await tearAndWaitFan(), '撕开出扇形')
  await sleep(700)
  const ownedBefore = (await storeState())?.owned
  const flipState0 = await evaluate(`(() => {
    const slots = [...document.querySelectorAll('.pm-slot')]
    return slots.map(sl => !sl.querySelector('.pc-card').classList.contains('faceDown')) })()`)
  ok(flipState0?.every(v => v === false), `收下前全部未翻（实际 ${JSON.stringify(flipState0)}）`)
  // 不手动翻，直接点「全部收下」→ 应先自动逐张翻开
  await evaluate(`document.querySelector('.pm-collect-btn')?.click()`)
  await sleep(600) // 自动翻牌进行中
  const midState = await evaluate(`(() => {
    const btn = document.querySelector('.pm-collect-btn')
    const slots = [...document.querySelectorAll('.pm-slot')]
    return JSON.stringify({
      label: btn?.innerText || '', disabled: btn?.disabled,
      flipped: slots.filter(sl => !sl.querySelector('.pc-card').classList.contains('faceDown')).length,
      total: slots.length }) })()`)
  const mid = typeof midState === 'string' ? JSON.parse(midState) : null
  ok(mid?.disabled === true && mid?.label.includes('翻牌中'),
    `自动翻牌进行中：按钮锁定且提示「翻牌中…」（实际 ${midState}）`)
  await shot('pack-polish-03-autoflip-mid.png')
  // 等收下完成（4 张 ×(180+等待) + 220 + 640 飞行，上限 12s）
  ok(await waitPackOpen(false), '自动翻完后收下，modal 关闭')
  const ownedAfter = (await storeState())?.owned
  ok(ownedAfter > ownedBefore, `卡片入图鉴：${ownedBefore}→${ownedAfter}`)
  // 竞态：连点不重复触发（此时 modal 已关；再开一包连点两次收下按钮）
  await withStore(`(s) => { s.productivity.pendingPacks = ['pack_arcana_normal']; s.openCollectionPack(); return 'ok' }`)
  ok(await waitPackOpen(true), '竞态用包已开')
  ok(await tearAndWaitFan(), '撕开出扇形')
  await sleep(700)
  const ownedC0 = (await storeState())?.owned
  await evaluate(`document.querySelector('.pm-collect-btn')?.click(); document.querySelector('.pm-collect-btn')?.click()`)
  ok(await waitPackOpen(false), '连点两次后正常收下关闭')
  const ownedC1 = (await storeState())?.owned
  ok(ownedC1 - ownedC0 === 3, `连点不重复入账：+3 张（实际 +${ownedC1 - ownedC0}）`)

  // ============ ⑥ 撕开动效关键帧 ============
  console.log('\n--- STEP: 撕开关键帧（拉伸/逐齿爆开/爆开回弹） ---')
  await withStore(`(s) => { s.productivity.pendingPacks = ['pack_celestial_mega']; s.openCollectionPack(); return 'ok' }`)
  ok(await waitPackOpen(true), 'mega 天体包已开')
  await evaluate(`document.querySelector('.pm-sealed-wrap')?.click()`)
  await sleep(150) // 拉伸相位（raw p ~0.28 内）
  const stretching = await evaluate(`(() => {
    const top = document.querySelector('.pm-pack-part.top')
    return top ? top.style.transform : 'none' })()`)
  await shot('pack-polish-04-tear-stretch.png')
  await sleep(220) // 逐齿爆开中段
  await shot('pack-polish-05-tear-ratchet.png')
  await sleep(260) // 爆开瞬间/回弹
  await shot('pack-polish-06-tear-burst.png')
  ok(typeof stretching === 'string' && stretching !== 'none', `拉伸相位撕条形变（${String(stretching).slice(0, 90)}…）`)
  for (let i = 0; i < 30; i++) { await sleep(200); if (await evaluate(`document.querySelectorAll('.pm-slot').length > 0`)) break }
  ok(await evaluate(`document.querySelectorAll('.pm-slot').length > 0`), '撕裂完成后出扇形')
  await withStore(`(s) => { s.skipCollectionPack(); return 'ok' }`)
  ok(await waitPackOpen(false), '撕开关键帧包已关闭')

  // ============ ② mod 卡正面完整（__force_mod 钩子） ============
  console.log('\n--- STEP: mod 卡正面完整 ---')
  await evaluateFire(`location.hash='#/cards?__force_mod=mj_pi_pi'`)
  await sleep(400)
  await withStore(`(s) => { s.productivity.pendingPacks = ['pack_buffoon_normal']; s.openCollectionPack(); return 'ok' }`)
  ok(await waitPackOpen(true), '强制 mod 包已开')
  ok(await tearAndWaitFan(), '撕开出扇形')
  await sleep(700)
  const hasMod = await withStore(`(s) => s.collectionPack?.options?.some(o => o.id === 'mj_pi_pi') ? 'yes' : 'no'`)
  ok(hasMod === 'yes', 'mod 卡已混入（mj_pi_pi）')
  // 翻开 mod 卡并断言正面精灵完整（front 在 142×190 版式内，2x 背景）
  const modIdx = await withStore(`(s) => {
    const idx = s.collectionPack.options.findIndex(o => o.id === 'mj_pi_pi')
    const slots = [...document.querySelectorAll('.pm-slot')]
    slots[idx]?.querySelector('.pc-wrap')?.click()
    return idx }`)
  await sleep(1300) // t3 悬念档 400ms + 余量
  const frontCheck = await evaluate(`(() => {
    const el = [...document.querySelectorAll('.pm-slot .pc-front .pc-sprite')]
      .find(e => e.style.backgroundImage.includes('mod_pijoker'))
    if (!el) return 'no-mod-sprite'
    const m = el.style.backgroundSize.match(/([\\d.]+)px ([\\d.]+)px/)
    return JSON.stringify({ bg: m?.[1] + 'x' + m?.[2], pos: el.style.backgroundPosition }) })()`)
  ok(typeof frontCheck === 'string' && frontCheck.includes('142x190'),
    `mod 卡正面精灵完整 142×190 2x（实际 ${frontCheck}）`)
  await shot('pack-polish-07-modcard-front.png')

  console.log('\n===== CDP SHOTS PACK-POLISH RESULT =====')
  console.log('[crashes]', crashes.length ? '\n' + crashes.join('\n---\n') : 'none')
  console.log(consoleErrors.length ? '[console errors]\n' + consoleErrors.slice(0, 20).join('\n---\n') : 'NO CONSOLE ERRORS')
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
  await sleep(500)
  process.exit(fail || crashes.length ? 1 : 0)
}
main().catch(e => { console.error('DRIVER FAIL', e); process.exit(1) })
