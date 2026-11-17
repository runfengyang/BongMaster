// Balatro UI 真人级冒烟测试（Electron 渲染进程崩溃/错误捕获）
// 用法: node_modules/.bin/electron scripts/electron-smoke.js <baseUrl> [flow]
//   flow = cards | game | all （默认 all）
// 捕获: console error/warning、render-process-gone、unresponsive、did-fail-load、gpu crash
// 并在每个关键步骤截图到 work/smoke/ 目录。
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const baseUrl = process.argv[2] || 'http://localhost:5173'
const flow = process.argv[3] || 'all'
const shotDir = path.join(__dirname, '..', 'work', 'smoke')
fs.mkdirSync(shotDir, { recursive: true })

const problems = []
let win = null
let stepName = 'boot'

function note(kind, detail) {
  const line = `[${kind}] @${stepName}: ${detail}`
  problems.push(line)
  console.log(line)
}

async function shot(name) {
  if (!win || win.isDestroyed()) return
  try {
    const img = await win.webContents.capturePage()
    fs.writeFileSync(path.join(shotDir, `${name}.png`), img.toPNG())
    console.log(`[shot] ${name}.png`)
  } catch (e) { note('shot-fail', e.message) }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function evalJS(code) {
  if (!win || win.isDestroyed()) return null
  try {
    return await win.webContents.executeJavaScript(code, true)
  } catch (e) {
    note('eval-fail', e.message)
    return null
  }
}

// 按可见文本点击按钮/元素
async function clickByText(texts, selector = 'button, a, [role="button"], .bt-btn') {
  return await evalJS(`(() => {
    const want = ${JSON.stringify(texts)}
    const els = [...document.querySelectorAll('${selector}')]
    for (const w of want) {
      const el = els.find(e => e.offsetParent !== null && (e.innerText || '').trim().includes(w))
      if (el) { el.click(); return 'clicked: ' + (el.innerText || '').trim().slice(0, 40) }
    }
    return null
  })()`)
}

async function dumpText() {
  return await evalJS(`(document.body.innerText || '').slice(0, 600)`)
}

async function gotoHash(hash, waitMs = 6000) {
  stepName = `goto ${hash}`
  await evalJS(`location.hash = '${hash}'`)
  await sleep(waitMs)
  if (win.isDestroyed()) { note('CRASH', `窗口在 ${hash} 期间被销毁`); return false }
  const text = await dumpText()
  console.log(`[page ${hash}]`, (text || '').replace(/\s+/g, ' ').slice(0, 200))
  return true
}

app.whenReady().then(async () => {
  win = new BrowserWindow({
    width: 1440, height: 900, show: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  })
  const wc = win.webContents
  wc.on('console-message', (e, level, message, line, sourceId) => {
    if (level >= 2) note(level === 3 ? 'console.error' : 'console.warn', `${message} (${sourceId}:${line})`)
  })
  wc.on('render-process-gone', (e, details) => note('RENDER-GONE', JSON.stringify(details)))
  wc.on('unresponsive', () => note('UNRESPONSIVE', '渲染进程无响应'))
  wc.on('did-fail-load', (e, code, desc) => note('LOAD-FAIL', `${code} ${desc}`))
  wc.on('preload-error', (e, p, m) => note('PRELOAD-ERR', `${p} ${m}`))
  app.on('gpu-process-crashed', (e, killed) => note('GPU-CRASH', `killed=${killed}`))
  win.on('closed', () => { win = null })

  stepName = 'initial load'
  await win.loadURL(baseUrl)
  await sleep(4000)

  if (flow === 'cards' || flow === 'all') {
    if (await gotoHash('#/cards', 7000)) {
      stepName = 'cards idle'
      await shot('01-cards')
      await sleep(5000) // 静置观察动画是否累积崩溃
      await shot('02-cards-idle')
      // 点击第一张卡（剪影或已发现）
      stepName = 'cards click'
      await evalJS(`(() => { const c = document.querySelector('.cv-card, [class*="card"]'); if (c) c.click(); return !!c })()`)
      await sleep(2500)
      await shot('03-cards-detail')
    }
  }

  if (flow === 'game' || flow === 'all') {
    if (await gotoHash('#/entertainment', 7000)) {
      stepName = 'game menu'
      await shot('10-menu')
      // 新 Run
      let r = await clickByText(['新 Run', '新开', '开始'])
      console.log('[click menu]', r)
      await sleep(2500)
      stepName = 'deck select'
      await shot('11-decks')
      // 选第一个牌组
      r = await evalJS(`(() => { const c = document.querySelector('[class*="deck"]'); if (c) { c.click(); return 'deck clicked' } return null })()`)
      console.log('[click deck]', r)
      await sleep(2500)
      // 可能出现的确认按钮
      r = await clickByText(['开始', '确认', '选择'])
      console.log('[click confirm]', r)
      await sleep(3000)
      stepName = 'blind select'
      await shot('12-blind')
      r = await clickByText(['选择', '挑战', '迎战', '开牌'])
      console.log('[click blind]', r)
      await sleep(5000)
      stepName = 'round'
      await shot('13-round')
      // 选中前两张手牌并出牌
      stepName = 'play hand'
      await evalJS(`(() => {
        const cards = [...document.querySelectorAll('[class*="hand"] [class*="card"], .bt-hand *')].filter(e => e.offsetParent)
        return cards.length
      })()`).then(n => console.log('[hand candidates]', n))
      await evalJS(`(() => {
        const els = [...document.querySelectorAll('*')].filter(e => e.offsetParent && e.children.length === 0 && /[AKQJ2-9]|10/.test(e.innerText || ''))
        els.slice(0, 2).forEach(e => e.click())
        return els.length
      })()`)
      await sleep(1200)
      r = await clickByText(['出牌', '打出'])
      console.log('[click play]', r)
      await sleep(9000) // 等待计分演出
      await shot('14-after-play')
      console.log('[round text]', JSON.stringify(((await dumpText()) || '').slice(0, 300)))
    }
  }

  stepName = 'done'
  console.log('\n===== SMOKE RESULT =====')
  console.log(problems.length ? problems.join('\n') : 'NO PROBLEMS DETECTED')
  app.exit(problems.some(p => p.includes('RENDER-GONE') || p.includes('CRASH') || p.includes('GPU')) ? 2 : 0)
})
