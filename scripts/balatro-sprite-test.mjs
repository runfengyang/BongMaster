// Balatro §12+§15 精灵映射测试：spriteMap 覆盖率（官方 234 + mod 135）+ 坐标合法性 + 图集文件尺寸
// 运行：node scripts/balatro-sprite-test.mjs
import { readFileSync } from 'node:fs'

const { JOKERS, TAROT, PLANETS, SPECTRAL, VOUCHERS } = await import('../src/balatro/data/index.js')
const { MOD_JOKERS } = await import('../src/balatro/data/modJokers.js')
const { SPRITE_MAP, BACK_SPRITES, ATLAS_META, ENH_SPRITES, SEAL_SPRITES } = await import('../src/balatro/data/spriteMap.js')

let pass = 0, fail = 0
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ✔ ${name}`) }
  else { fail++; console.error(`  ✘ ${name}`) }
}

// ---- WebP 尺寸解析（VP8X / VP8L / VP8） ----
function webpSize(path) {
  const b = readFileSync(path)
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null
  const fourcc = b.toString('ascii', 12, 16)
  if (fourcc === 'VP8X') {
    return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) }
  }
  if (fourcc === 'VP8L') {
    const bits = b.readUInt32LE(21)
    return { w: 1 + (bits & 0x3fff), h: 1 + ((bits >> 14) & 0x3fff) }
  }
  if (fourcc === 'VP8 ') {
    return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff }
  }
  return null
}

// ============ 1. 图集文件 ============
console.log('== 图集文件存在且尺寸与游戏一致 ==')
const EXPECT = {
  jokers: { file: 'public/sprites/jokers.webp', w: 710, h: 1520 },
  tarots: { file: 'public/sprites/tarots.webp', w: 710, h: 570 },
  vouchers: { file: 'public/sprites/vouchers.webp', w: 639, h: 380 },
  enhancers: { file: 'public/sprites/enhancers.webp', w: 497, h: 475 },
  boosters: { file: 'public/sprites/boosters.webp', w: 284, h: 855 },
  // §15 mod 图集（PIL 实测 71×95 原生瓦片）
  mod_pampa: { file: 'public/sprites/mod_pampa.webp', w: 710, h: 570 },
  mod_jelly: { file: 'public/sprites/mod_jelly.webp', w: 710, h: 1710 },
  mod_yuni: { file: 'public/sprites/mod_yuni.webp', w: 568, h: 190 },
  // §15 第二批（Olympus/PiJoker/MikasBalatro 单瓦片 PNG 经 PIL 拼格）
  mod_olympus: { file: 'public/sprites/mod_olympus.webp', w: 426, h: 95 },
  mod_pijoker: { file: 'public/sprites/mod_pijoker.webp', w: 71, h: 95 },
  mod_mika: { file: 'public/sprites/mod_mika.webp', w: 710, h: 570 },
}
for (const [atlas, e] of Object.entries(EXPECT)) {
  const size = webpSize(e.file)
  ok(size && size.w === e.w && size.h === e.h, `${atlas}: ${e.w}×${e.h}（实际 ${size ? size.w + '×' + size.h : '读取失败'}）`)
  const meta = ATLAS_META[atlas]
  ok(meta && meta.cols * 71 === e.w && meta.rows * 95 === e.h,
    `${atlas}: ATLAS_META ${meta?.cols}×${meta?.rows} 格与像素尺寸吻合`)
}

// ============ 2. 覆盖率：150 小丑 + 52 消耗牌 100% ============
console.log('== spriteMap 覆盖率 ==')
const missJ = JOKERS.filter(d => !SPRITE_MAP[d.id])
ok(missJ.length === 0, `150 小丑全覆盖（缺 ${missJ.length}${missJ.length ? '：' + missJ.map(d => d.id).join(',') : ''}）`)
const consumables = [...TAROT, ...PLANETS, ...SPECTRAL]
ok(consumables.length === 52, `消耗牌共 52 张（实际 ${consumables.length}）`)
const missC = consumables.filter(d => !SPRITE_MAP[d.id])
ok(missC.length === 0, `52 消耗牌全覆盖（缺 ${missC.length}${missC.length ? '：' + missC.map(d => d.id).join(',') : ''}）`)
const missV = VOUCHERS.filter(d => !SPRITE_MAP[d.id])
ok(missV.length === 0, `32 优惠券全覆盖（缺 ${missV.length}${missV.length ? '：' + missV.map(d => d.id).join(',') : ''}）`)
// §13 卡包 15 张（5 类 × 3 规格，官方 Booster 图集）
const { PACKS } = await import('../src/balatro/data/packs.js')
const missP = PACKS.filter(d => !SPRITE_MAP[d.id])
ok(PACKS.length === 15 && missP.length === 0, `15 卡包全覆盖（缺 ${missP.length}${missP.length ? '：' + missP.map(d => d.id).join(',') : ''}）`)
// §15 mod 小丑 135 张（Pampa 30 / JellyMod 30 / 7DeadlySins 8 / Olympus 6 / PiJoker 1 / MikasBalatro 60）
const missM = MOD_JOKERS.filter(d => !SPRITE_MAP[d.id])
ok(MOD_JOKERS.length === 135 && missM.length === 0,
  `135 mod 小丑全覆盖（缺 ${missM.length}${missM.length ? '：' + missM.map(d => d.id).join(',') : ''}）`)
// mod 中凡声明 soul 叠加层的（modJokers.js 的 soul 字段）必须落到 SPRITE_MAP 的 sx/sy
const modSouls = MOD_JOKERS.filter(d => d.soul)
ok(modSouls.length === 4 && modSouls.every(d => SPRITE_MAP[d.id]?.sx !== undefined),
  `mod soul 叠加层 4 张（${modSouls.map(d => d.id).join(',')}）`)

// ============ 3. 坐标合法性 ============
console.log('== 坐标在图集网格内 ==')
let bad = []
for (const [id, s] of Object.entries(SPRITE_MAP)) {
  const meta = ATLAS_META[s.atlas]
  if (!meta) { bad.push(`${id}: 未知图集 ${s.atlas}`); continue }
  if (s.x < 0 || s.x >= meta.cols || s.y < 0 || s.y >= meta.rows) bad.push(`${id}: (${s.x},${s.y}) 越界 ${s.atlas} ${meta.cols}×${meta.rows}`)
  if (s.sx !== undefined && (s.sx < 0 || s.sx >= meta.cols || s.sy < 0 || s.sy >= meta.rows)) bad.push(`${id}: soul (${s.sx},${s.sy}) 越界`)
}
ok(bad.length === 0, `全部 ${Object.keys(SPRITE_MAP).length} 条坐标合法${bad.length ? '：' + bad.slice(0, 5).join('；') : ''}`)

// 传奇 5 张必须有 soul 叠加层
const legendaries = JOKERS.filter(d => d.rarity === 4)
ok(legendaries.length === 5 && legendaries.every(d => SPRITE_MAP[d.id]?.sx !== undefined),
  `5 张传奇均有 soul_pos 叠加层（${legendaries.map(d => d.id).join(',')}）`)

// 卡背
ok(BACK_SPRITES.b_red && BACK_SPRITES.b_red.x === 0 && BACK_SPRITES.b_red.y === 0, '默认红背 b_red @ enhancers(0,0)')
ok(Object.keys(BACK_SPRITES).length === 16, `16 个卡背坐标（实际 ${Object.keys(BACK_SPRITES).length}）`)

// §15 增强卡面 8 张 + 蜡封 4 枚（图鉴「增强·蜡封·版本」页签真精灵）
const ENH_WANT = {
  bonus: { x: 1, y: 1 }, mult: { x: 2, y: 1 }, wild: { x: 3, y: 1 }, lucky: { x: 4, y: 1 },
  glass: { x: 5, y: 1 }, steel: { x: 6, y: 1 }, stone: { x: 5, y: 0 }, gold: { x: 6, y: 0 },
}
const enhBad = Object.entries(ENH_WANT).filter(([id, w]) => ENH_SPRITES[id]?.x !== w.x || ENH_SPRITES[id]?.y !== w.y)
ok(enhBad.length === 0 && Object.keys(ENH_SPRITES).length === 8,
  `8 增强卡面坐标吻合（不符 ${enhBad.length}${enhBad.length ? '：' + enhBad.map(([id]) => id).join(',') : ''}）`)
const SEAL_WANT = { gold: { x: 2, y: 0 }, purple: { x: 4, y: 4 }, red: { x: 5, y: 4 }, blue: { x: 6, y: 4 } }
const sealBad = Object.entries(SEAL_WANT).filter(([id, w]) => SEAL_SPRITES[id]?.x !== w.x || SEAL_SPRITES[id]?.y !== w.y)
ok(sealBad.length === 0 && Object.keys(SEAL_SPRITES).length === 4,
  `4 蜡封坐标吻合（不符 ${sealBad.length}${sealBad.length ? '：' + sealBad.map(([id]) => id).join(',') : ''}）`)

// ============ 4. 关键卡抽样（已知官方坐标） ============
console.log('== 关键卡坐标抽样 ==')
const SAMPLES = {
  j_joker: { atlas: 'jokers', x: 0, y: 0 },
  j_greedy_joker: { atlas: 'jokers', x: 6, y: 1 },
  j_canio: { atlas: 'jokers', x: 3, y: 8, sx: 3, sy: 9 },
  c_fool: { atlas: 'tarots', x: 0, y: 0 },
  p_mercury: { atlas: 'tarots', x: 0, y: 3 },
  s_soul: { atlas: 'tarots', x: 2, y: 2 },
  pack_arcana_normal: { atlas: 'boosters', x: 0, y: 0 },
  pack_celestial_jumbo: { atlas: 'boosters', x: 0, y: 3 },
  pack_spectral_mega: { atlas: 'boosters', x: 3, y: 4 },
  pack_standard_normal: { atlas: 'boosters', x: 0, y: 6 },
  pack_buffoon_mega: { atlas: 'boosters', x: 3, y: 8 },
  // §15 mod 卡抽样（源码手工提取坐标）
  mj_pam_jazztrio: { atlas: 'mod_pampa', x: 0, y: 0 },
  mj_jel_tarlton: { atlas: 'mod_jelly', x: 1, y: 16, sx: 1, sy: 9 },
  mj_sds_sin: { atlas: 'mod_yuni', x: 7, y: 1, sx: 7, sy: 0 },
  // §15 第二批抽样（Olympus 图集顺序 artemis..zeus；mika 按源码块序 10 列网格）
  mj_oly_artemis: { atlas: 'mod_olympus', x: 0, y: 0 },
  mj_oly_zeus: { atlas: 'mod_olympus', x: 5, y: 0 },
  mj_pi_pi: { atlas: 'mod_pijoker', x: 0, y: 0 },
  mj_mik_prime_time: { atlas: 'mod_mika', x: 0, y: 0 },
  mj_mik_dagonet: { atlas: 'mod_mika', x: 0, y: 3 },
  mj_mik_plus_one: { atlas: 'mod_mika', x: 9, y: 5 },
}
for (const [id, want] of Object.entries(SAMPLES)) {
  const got = SPRITE_MAP[id]
  const match = got && got.atlas === want.atlas && got.x === want.x && got.y === want.y &&
    (want.sx === undefined || (got.sx === want.sx && got.sy === want.sy))
  ok(match, `${id} → ${want.atlas}(${want.x},${want.y})${want.sx !== undefined ? `+soul(${want.sx},${want.sy})` : ''}（实际 ${JSON.stringify(got)}）`)
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
