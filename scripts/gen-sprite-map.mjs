// §12 生成 spriteMap.js + 用官方 zh_CN 校对中文名/效果文本
// 解析 work/balatro-source/game.lua（150 j_ + 55 c_ + 31 v_ + backs/enhancers 的 pos/set/name）
// 与 work/balatro-source/localization/zh_CN.lua（官方简中 name/text）
// §15 扩展：mod 小丑图集（modJokers.js 手工提取的 pos → mod_pampa/mod_jelly/mod_yuni）
//   + 增强卡面/蜡封精灵（centers 图集 set='Enhanced' 8 张 + shared_seals 4 枚）
// 输出: src/balatro/data/spriteMap.js；就地更新 jokers/tarot/planets/spectral.js 的 name/text
// 运行: node scripts/gen-sprite-map.mjs
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'

const ROOT = new URL('..', import.meta.url).pathname
const game = readFileSync(ROOT + 'work/balatro-source/game.lua', 'utf8')
const zh = readFileSync(ROOT + 'work/balatro-source/localization/zh_CN.lua', 'utf8')

// ---------- 0. 从最近一次构建产物提取我方原始文本（校对前的可信底本） ----------
// dist bundle 在 §12 校对前构建，内含数据层原始 name/text（反引号字符串形式）
const originals = new Map() // id -> { name, text }
try {
  const assetsDir = ROOT + 'dist/renderer/assets'
  const bundleFile = readdirSync(assetsDir)
    .filter(f => /^store-.*\.js$/.test(f))
    .map(f => ({ f, m: statSync(assetsDir + '/' + f).mtimeMs }))
    .sort((a, b) => b.m - a.m)[0]?.f
  if (bundleFile) {
    const bundle = readFileSync(assetsDir + '/' + bundleFile, 'utf8')
    for (const chunk of bundle.split('},{id:`')) {
      const m = chunk.match(/^(\w+)`,name:`([^`]*)`,nameEn:`[^`]*`/)
      if (!m) continue
      const tm = chunk.match(/,text:`([^`]*)`/)
      originals.set(m[1], { name: m[2], text: tm ? tm[1] : '' })
    }
    console.log(`[底本] 从 dist/${bundleFile} 提取 ${originals.size} 条原始文本`)
  } else {
    console.warn('[底本] 未找到 store bundle，含变量文本将保留现状')
  }
} catch (err) {
  console.warn('[底本] 读取失败:', err.message)
}

// ---------- 1. 解析 game.lua 单行卡牌定义 ----------
// 形如: j_joker= {order = 1, ..., name = "Joker", pos = {x=0,y=0}, set = "Joker", ...},
const gameByKey = new Map() // key -> { name, x, y, set }
const gameBySetName = new Map() // `${set}|${normName}` -> { key, name, x, y, set }
for (const line of game.split('\n')) {
  const km = line.match(/^\s*(\w+)\s*=\s*\{/)
  if (!km) continue
  const posM = line.match(/pos\s*=\s*\{x\s*=\s*(\d+)\s*,\s*y\s*=\s*(\d+)\}/)
  const soulM = line.match(/soul_pos\s*=\s*\{x\s*=\s*(\d+)\s*,\s*y\s*=\s*(\d+)\}/)
  const setM = line.match(/set\s*=\s*['"](\w+)['"]/)
  const nameM = line.match(/name\s*=\s*['"]([^'"]+)['"]/)
  if (!posM || !setM) continue
  const key = km[1]
  const entry = { key, name: nameM ? nameM[1] : key, x: +posM[1], y: +posM[2], set: setM[1] }
  // 传奇小丑：波纹名牌底帧（pos）+ 透明真身叠加层（soul_pos）
  if (soulM) { entry.sx = +soulM[1]; entry.sy = +soulM[2] }
  gameByKey.set(key, entry)
  const norm = entry.name.toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (!gameBySetName.has(`${entry.set}|${norm}`)) gameBySetName.set(`${entry.set}|${norm}`, entry)
}
console.log(`[game.lua] 解析 ${gameByKey.size} 条带 pos 的卡牌定义`)

const SET_ATLAS = {
  Joker: 'jokers', Tarot: 'tarots', Planet: 'tarots', Spectral: 'tarots',
  Voucher: 'vouchers', Back: 'enhancers', Enhanced: 'enhancers', Seal: 'enhancers', Edition: 'enhancers',
  Booster: 'boosters',
}

// ---------- 2. 读取我们的数据文件（单行条目） ----------
const FILES = {
  jokers: { path: 'src/balatro/data/jokers.js', set: 'Joker', exactPrefix: true },
  tarots: { path: 'src/balatro/data/tarot.js', set: 'Tarot', exactPrefix: true },
  planets: { path: 'src/balatro/data/planets.js', set: 'Planet', exactPrefix: false },
  spectral: { path: 'src/balatro/data/spectral.js', set: 'Spectral', exactPrefix: false },
  vouchers: { path: 'src/balatro/data/vouchers.js', set: 'Voucher', exactPrefix: true },
}
function normName(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '') }
function parseOurs(path) {
  const out = []
  for (const line of readFileSync(ROOT + path, 'utf8').split('\n')) {
    const m = line.match(/\bid:\s*'(\w+)'/)
    if (!m) continue
    const nameM = line.match(/\bname:\s*'([^']*)'/)
    const nameEnM = line.match(/\bnameEn:\s*'([^']*)'/)
    const textM = line.match(/,\s*text:\s*'([^']*)'/)
    out.push({ id: m[1], name: nameM?.[1] ?? '', nameEn: nameEnM?.[1] ?? '', text: textM?.[1] ?? '', line })
  }
  return out
}

// ---------- 3. 映射我们的 id → game key/pos ----------
// 游戏 key 与我们 id 不一致且英文名也被官方改拼写的个别卡（手动别名）
const KEY_ALIASES = { j_canio: 'j_caino' }
const spriteMap = {} // ourId -> { atlas, x, y }
const unresolved = []
const matchNotes = []
const oursAll = {}
for (const [group, cfg] of Object.entries(FILES)) {
  const list = parseOurs(cfg.path)
  oursAll[group] = list
  for (const card of list) {
    let hit = null, how = ''
    const alias = KEY_ALIASES[card.id]
    if (alias && gameByKey.has(alias)) { hit = gameByKey.get(alias); how = `alias(${alias})` }
    if (!hit && cfg.exactPrefix && gameByKey.has(card.id)) { hit = gameByKey.get(card.id); how = 'key' }
    if (!hit) {
      const norm = normName(card.nameEn)
      const byName = gameBySetName.get(`${cfg.set}|${norm}`)
      if (byName) { hit = byName; how = `name(${byName.key})` }
    }
    if (hit) {
      spriteMap[card.id] = { atlas: SET_ATLAS[hit.set] || 'enhancers', x: hit.x, y: hit.y }
      if (hit.sx !== undefined) { spriteMap[card.id].sx = hit.sx; spriteMap[card.id].sy = hit.sy }
      card.gameKey = hit.key
      if (how !== 'key') matchNotes.push(`  ${card.id} → ${how}`)
    } else {
      unresolved.push(`${group}:${card.id} (${card.nameEn})`)
    }
  }
}
console.log(`[spriteMap] 解析成功 ${Object.keys(spriteMap).length} 条`)
if (matchNotes.length) console.log('[名称回退匹配]\n' + matchNotes.join('\n'))
if (unresolved.length) console.log('[未解析]\n' + unresolved.join('\n'))

// ---------- 3b. 卡包（Booster）：我方 pack_<type>_<size> → 游戏 p_<type>_<size>_1（首个变体） ----------
// packs.js 的 id 由模板字面量生成（5 类 × 3 规格 = 15），此处按同一规则展开
const PACK_TYPES = ['arcana', 'celestial', 'standard', 'spectral', 'buffoon']
const PACK_SIZES = ['normal', 'jumbo', 'mega']
let packMapped = 0
for (const t of PACK_TYPES) {
  for (const s of PACK_SIZES) {
    const gameKey = `p_${t}_${s}_1`
    const hit = gameByKey.get(gameKey)
    if (hit && hit.set === 'Booster') {
      spriteMap[`pack_${t}_${s}`] = { atlas: 'boosters', x: hit.x, y: hit.y }
      packMapped++
    } else {
      unresolved.push(`packs:pack_${t}_${s} (${gameKey})`)
    }
  }
}
console.log(`[boosters] 卡包映射 ${packMapped}/15`)

// ---------- 3c. §15 Mod 小丑：modJokers.js 手工提取的 pos → 6 张 mod 图集 ----------
// 来源：Pampa 30 / JellyMod 30 / 7DeadlySins 8（老式 Steamodded 0.9.x SMODS.Joker 定义）
//   + Olympus 6 / PiJoker 1 / MikasBalatro 60（单瓦片 PNG 由 PIL 拼成网格图集）
// modJokers.js 每条带 pos:{x,y}（可选 soul:{x,y}），atlas 由 mod 字段映射
const MOD_ATLAS = {
  Pampa: 'mod_pampa', JellyMod: 'mod_jelly', '7DeadlySins': 'mod_yuni',
  Olympus: 'mod_olympus', PiJoker: 'mod_pijoker', MikasBalatro: 'mod_mika',
}
let modMapped = 0
const { MOD_JOKERS } = await import('../src/balatro/data/modJokers.js')
for (const d of MOD_JOKERS) {
  const atlas = MOD_ATLAS[d.mod]
  if (!atlas || !d.pos) { unresolved.push(`mods:${d.id} (${d.mod} pos=${JSON.stringify(d.pos || null)})`); continue }
  spriteMap[d.id] = { atlas, x: d.pos.x, y: d.pos.y }
  if (d.soul) { spriteMap[d.id].sx = d.soul.x; spriteMap[d.id].sy = d.soul.y }
  modMapped++
}
console.log(`[mods] mod 小丑映射 ${modMapped}/${MOD_JOKERS.length}（Pampa/JellyMod/7DeadlySins/Olympus/PiJoker/MikasBalatro）`)

// ---------- 4. 卡背（Back set）单独导出 ----------
const backs = {}
for (const e of gameByKey.values()) {
  if (e.set === 'Back') backs[e.key] = { x: e.x, y: e.y }
}
console.log(`[backs] ${Object.keys(backs).length} 个卡背（b_red 默认背: ${JSON.stringify(backs.b_red || null)}）`)

// ---------- 4b. §15 增强卡面（set='Enhanced'）+ 蜡封（shared_seals）单独导出 ----------
// 图鉴「增强·蜡封·版本」页签真精灵用。均在 enhancers（centers）图集，71×95 瓦片。
const enhSprites = {} // 我方 enhancements.js id（去 m_ 前缀）→ {x,y}
for (const e of gameByKey.values()) {
  if (e.set === 'Enhanced' && e.key.startsWith('m_')) enhSprites[e.key.slice(2)] = { x: e.x, y: e.y }
}
// 蜡封不是 {set='Seal'} 定义，而是 game.lua 里的 self.shared_seals 常量块（Gold/Purple/Red/Blue）
// 条目形如: Gold = Sprite(0, 0, self.CARD_W, self.CARD_H, self.ASSET_ATLAS["centers"], {x = 2,y = 0}),
const sealSprites = {} // 键转小写 → {x,y}
const sealsBlock = game.match(/shared_seals\s*=\s*\{([\s\S]*?)\n\s*\}/)
if (sealsBlock) {
  for (const line of sealsBlock[1].split('\n')) {
    const m = line.match(/(\w+)\s*=\s*Sprite\([^)]*\{x\s*=\s*(\d+)\s*,\s*y\s*=\s*(\d+)\}\)/)
    if (m && /centers/.test(line)) sealSprites[m[1].toLowerCase()] = { x: +m[2], y: +m[3] }
  }
}
console.log(`[增强/蜡封] 增强卡面 ${Object.keys(enhSprites).length} 张；蜡封 ${Object.keys(sealSprites).length} 枚: ${JSON.stringify(sealSprites)}`)

// ---------- 5. 解析 zh_CN.lua ----------
// descriptions 下 Joker/Tarot/Planet/Spectral 段，条目: key={ name="...", text={ "l1", "l2" } }
function parseZhSection(sectionName) {
  // 同名段可能出现多次（misc 里也有 Joker），解析所有候选，取条目最多者
  const startRe = new RegExp(`^\\s{1,12}${sectionName}\\s*=\\s*\\{\\s*$`)
  const lines = zh.split('\n')
  let best = new Map()
  for (let start = 0; start < lines.length; start++) {
    if (!startRe.test(lines[start])) continue
    const entries = new Map()
    let depth = 1
    let i = start + 1
    for (; i < lines.length && depth > 0; i++) {
      const l = lines[i]
      const em = l.match(/^\s*(\w+)\s*=\s*\{\s*$/)
      if (depth === 1 && em) {
        const key = em[1]
        let name = ''
        const textLines = []
        let j = i + 1
        let d2 = 1
        for (; j < lines.length && d2 > 0; j++) {
          const l2 = lines[j]
          const nm = l2.match(/name\s*=\s*"([^"]*)"/)
          if (nm) name = nm[1]
          const tm = l2.match(/^\s*"((?:[^"\\]|\\.)*)"\s*,?\s*$/)
          if (tm && /^\s*"/.test(l2) && !/name\s*=/.test(l2)) textLines.push(tm[1])
          d2 += (l2.match(/\{/g) || []).length - (l2.match(/\}/g) || []).length
        }
        entries.set(key, { name, textLines })
        i = j - 1 // 外层 i++ 后正好落在条目结束行的下一行
        continue
      }
      depth += (l.match(/\{/g) || []).length - (l.match(/\}/g) || []).length
    }
    if (entries.size > best.size) best = entries
  }
  return best
}
const zhSections = {
  jokers: parseZhSection('Joker'),
  tarots: parseZhSection('Tarot'),
  planets: parseZhSection('Planet'),
  spectral: parseZhSection('Spectral'),
}
for (const [g, m] of Object.entries(zhSections)) console.log(`[zh] ${g}: ${m.size} 条`)

// 清洗官方文本：去 {C:...}/{X:...}/{E:...}/{} 标签，拼接行
function cleanZhText(textLines) {
  return textLines
    .map(l => l.replace(/\{[^{}]*\}/g, ''))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

// ---------- 6. 校对 name/text 并就地改写数据文件 ----------
let nameChanged = 0, textChanged = 0, keptOurs = 0
const flagged = []
const NUM_RE = /\d+(?:\.\d+)?/g
for (const group of ['jokers', 'tarots', 'planets', 'spectral']) {
  const cfg = FILES[group]
  const filePath = ROOT + cfg.path
  let src = readFileSync(filePath, 'utf8')
  const zhMap = zhSections[group]
  for (const card of oursAll[group]) {
    if (!card.gameKey) continue
    const z = zhMap.get(card.gameKey)
    if (!z || !z.name) { flagged.push(`${card.id}: zh 无条目(${card.gameKey})`); continue }
    // ---- name ----
    if (z.name !== card.name) {
      const oldLine = src.split('\n').find(l => l.includes(`id: '${card.id}'`))
      if (oldLine) {
        const newLine = oldLine.replace(/(\bid:\s*'\w+',\s*name:\s*)'[^']*'/, `$1'${z.name}'`)
        if (newLine !== oldLine) { src = src.replace(oldLine, newLine); nameChanged++ }
      }
    }
    // ---- text ----
    // 规则：官方文本无 #n# 变量 → 直接用官方；恰好 1 个变量且我方恰好 1 个数 → 变量替换；
    // 其余（多变量/变量数对不上）→ 恢复 bundle 底本原始文本（§12 初版位置替换有误伤，底本可回滚）
    const official = cleanZhText(z.textLines)
    if (!official) continue
    const uniqueVars = [...new Set([...official.matchAll(/#(\d+)#/g)].map(m => +m[1]))].sort((a, b) => a - b)
    const original = originals.get(card.id)
    const baseNums = (original?.text || card.text).match(NUM_RE) || []
    let finalText = null
    if (uniqueVars.length === 0) {
      finalText = official
    } else if (uniqueVars.length === 1 && baseNums.length === 1) {
      finalText = official.replace(/#(\d+)#/g, baseNums[0]).replace(/\s+/g, ' ').trim()
    } else if (original?.text) {
      finalText = original.text // 恢复我方底本
      if (card.text !== original.text) keptOurs++
    } else {
      flagged.push(`${card.id}: 官方文本含 ${uniqueVars.length} 个变量且无底本（保留现状）`)
      continue
    }
    if (finalText && finalText !== card.text) {
      const oldLine = src.split('\n').find(l => l.includes(`id: '${card.id}'`))
      if (oldLine && /,\s*text:\s*'[^']*'/.test(oldLine)) {
        const esc = finalText.replace(/'/g, "\\'")
        const newLine = oldLine.replace(/,\s*text:\s*'[^']*'/, `, text: '${esc}'`)
        if (newLine !== oldLine) { src = src.replace(oldLine, newLine); textChanged++ }
      }
    }
  }
  // dataVerified 标注
  if (!/zh_CN 官方简中校对/.test(src)) {
    src = src.replace(/(\/\/ dataVerified: true[^\n]*)/, '$1；§12 经 zh_CN 官方简中校对')
    if (!/zh_CN 官方简中校对/.test(src)) src = `// dataVerified: true —— §12 经 zh_CN 官方简中校对\n` + src
  }
  writeFileSync(filePath, src)
}
console.log(`[校对] name 更新 ${nameChanged} 条；text 更新 ${textChanged} 条；保留我方文本 ${keptOurs} 条`)
if (flagged.length) console.log('[需人工留意]\n' + flagged.join('\n'))

// ---------- 7. 输出 spriteMap.js ----------
const header = `// Balatro 精灵图集映射（§12）——由 scripts/gen-sprite-map.mjs 生成，请勿手改
// 来源：work/balatro-source/game.lua（1.0.1o-FULL 反编译）pos/set 定义
// 图集：public/sprites/*.webp（与游戏 Jokers.png/Tarots.png/Vouchers.png/Enhancers.png 同构，71×95 瓦片）
// §15：mod 小丑（Pampa/JellyMod/7DeadlySins 手工提取）+ 增强卡面/蜡封真精灵
`
const atlasMeta = `export const ATLAS_META = {
  jokers: { url: 'sprites/jokers.webp', cols: 10, rows: 16 },
  tarots: { url: 'sprites/tarots.webp', cols: 10, rows: 6 },
  vouchers: { url: 'sprites/vouchers.webp', cols: 9, rows: 4 },
  enhancers: { url: 'sprites/enhancers.webp', cols: 7, rows: 5 },
  boosters: { url: 'sprites/boosters.webp', cols: 4, rows: 9 },
  // §15 mod 图集（PIL 实测瓦片 71×95 原生，行列按图集像素 / 71×95 算得）
  mod_pampa: { url: 'sprites/mod_pampa.webp', cols: 10, rows: 6 },
  mod_jelly: { url: 'sprites/mod_jelly.webp', cols: 10, rows: 18 },
  mod_yuni: { url: 'sprites/mod_yuni.webp', cols: 8, rows: 2 },
  mod_olympus: { url: 'sprites/mod_olympus.webp', cols: 6, rows: 1 },
  mod_pijoker: { url: 'sprites/mod_pijoker.webp', cols: 1, rows: 1 },
  mod_mika: { url: 'sprites/mod_mika.webp', cols: 10, rows: 6 },
}
`
const entries = Object.entries(spriteMap)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([id, s]) => `  ${id}: { atlas: '${s.atlas}', x: ${s.x}, y: ${s.y}${s.sx !== undefined ? `, sx: ${s.sx}, sy: ${s.sy}` : ''} },`)
  .join('\n')
const backEntries = Object.entries(backs)
  .map(([id, s]) => `  ${id}: { x: ${s.x}, y: ${s.y} },`)
  .join('\n')
const enhEntries = Object.entries(enhSprites)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([id, s]) => `  ${id}: { x: ${s.x}, y: ${s.y} },`)
  .join('\n')
const sealEntries = Object.entries(sealSprites)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([id, s]) => `  ${id}: { x: ${s.x}, y: ${s.y} },`)
  .join('\n')
const out = `${header}
${atlasMeta}
// 卡牌 id → 图集坐标（瓦片单位）
export const SPRITE_MAP = {
${entries}
}

// 卡背 → enhancers 图集坐标（b_red 为默认红背）
export const BACK_SPRITES = {
${backEntries}
}

// §15 增强卡面 → enhancers 图集坐标（enhancements.js 的 id 直查）
export const ENH_SPRITES = {
${enhEntries}
}

// §15 蜡封 → enhancers 图集坐标（seals.js 的 id 直查）
export const SEAL_SPRITES = {
${sealEntries}
}
`
writeFileSync(ROOT + 'src/balatro/data/spriteMap.js', out)
console.log(`[spriteMap.js] 写入 ${Object.keys(spriteMap).length} 条映射 + ${Object.keys(backs).length} 个卡背`)
