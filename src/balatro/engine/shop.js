// 商店生成 / 重掷 / 卡包 / 利息（§5.4）
// 卡牌位权重：小丑 20 / 塔罗 4 / 星球 4（商人券 9.6、大亨券 32）/ 扑克 4（魔术把戏）/ 幻灵 2（幽灵牌组）
// 小丑稀有度：70% 普通 / 25% 罕见 / 5% 稀有；版本概率见 editions.js
// 重掷 $5 起每次 +$1；利息每 $5 得 $1，上限 $5（种子基金 $10 / 摇钱树 $20）

import { JOKER_POOL, JOKERS_BY_ID } from '../data/jokers.js'
import { TAROT } from '../data/tarot.js'
import { PLANETS } from '../data/planets.js'
import { SPECTRAL_POOL } from '../data/spectral.js'
import { PACKS } from '../data/packs.js'
import { VOUCHERS, VOUCHERS_BY_ID } from '../data/vouchers.js'
import { jokerEditionChances, cardEditionChances, EDITIONS_BY_ID } from '../data/editions.js'
import { jokerHandlerFor } from './jokerEffects.js'
import { makeCard, SUITS } from './deck.js'

let _shopUid = 0
const uid = p => `${p}_${++_shopUid}`

export function hasRule(run, rule) {
  return run.jokers.some(j => {
    if (j.debuffed) return false
    const def = JOKERS_BY_ID[j.id]
    return def.effect?.handler === 'ruleMod' && def.effect.params?.rule === rule
  })
}

export function discountFactor(run) {
  if (run.vouchers.includes('v_liquidation')) return 0.5
  if (run.vouchers.includes('v_clearance_sale')) return 0.75
  return 1
}

// 售价 = (基础 + 版本加价) × 折扣，四舍五入向下取半，最低 $1
export function priceOf(baseCost, edition, run) {
  const add = edition ? (EDITIONS_BY_ID[edition]?.costAdd || 0) : 0
  const raw = (baseCost + add) * discountFactor(run)
  return Math.max(1, Math.floor(raw + 0.49999))
}

export function sellValueOf(item, def) {
  const add = item.edition ? (EDITIONS_BY_ID[item.edition]?.costAdd || 0) : 0
  return Math.max(1, Math.floor((def.cost + add) / 2)) + (item.sellBonus || 0)
}

function rollEdition(chances, rng) {
  const r = rng.next()
  let acc = 0
  for (const [ed, p] of Object.entries(chances)) {
    acc += p
    if (r < acc) return ed
  }
  return null
}

function honeLevel(run) {
  if (run.vouchers.includes('v_glow_up')) return 2
  if (run.vouchers.includes('v_hone')) return 1
  return 0
}

// 生成 1 个小丑（排除已持有，除非 Showman）
export function generateJoker(run, rng, { rarity = null, legendary = false, edition = null } = {}) {
  let r = rarity
  if (legendary) r = 4
  if (!r) {
    const roll = rng.next() * 100
    r = roll < 70 ? 1 : roll < 95 ? 2 : 3
  }
  let pool
  if (r === 4) {
    pool = Object.values(JOKERS_BY_ID).filter(j => j.rarity === 4)
  } else {
    pool = JOKER_POOL.filter(j => j.rarity === r)
  }
  const owned = new Set(run.jokers.map(j => j.id))
  const showman = hasRule(run, 'showman')
  const candidates = showman ? pool : pool.filter(j => !owned.has(j.id))
  const list = candidates.length ? candidates : pool
  const def = rng.pick(list)
  let ed = edition
  if (!ed && r !== 4) ed = rollEdition(jokerEditionChances(honeLevel(run)), rng)
  return { uid: uid('sj'), kind: 'joker', id: def.id, edition: ed }
}

// 商店单个卡牌位
export function rollShopCard(run, rng) {
  const weights = [
    ['joker', 20],
    ['tarot', run.vouchers.includes('v_tarot_tycoon') ? 32 : run.vouchers.includes('v_tarot_merchant') ? 9.6 : 4],
    ['planet', run.vouchers.includes('v_planet_tycoon') ? 32 : run.vouchers.includes('v_planet_merchant') ? 9.6 : 4],
  ]
  if (run.vouchers.includes('v_magic_trick')) weights.push(['playing', 4])
  if (run.ghostShop) weights.push(['spectral', 2])
  const kind = rng.weightedPick(weights, w => w[1])[0]
  if (kind === 'joker') {
    // 标签强制：免费稀有/罕见/版本小丑
    const forced = consumeForcedJokerTag(run)
    if (forced) return forced
    return generateJoker(run, rng)
  }
  if (kind === 'tarot') return { uid: uid('st'), kind, id: rng.pick(TAROT).id, edition: null }
  if (kind === 'planet') return { uid: uid('sp'), kind, id: rng.pick(PLANETS).id, edition: null }
  if (kind === 'spectral') return { uid: uid('ss'), kind, id: rng.pick(SPECTRAL_POOL).id, edition: null }
  // playing card（魔术把戏；幻术券可带增强/版本）
  const card = makeCard(rng.int(2, 14), rng.pick(SUITS))
  if (run.vouchers.includes('v_illusion')) {
    if (rng.chance(40, 100)) card.enhancement = rng.pick(['bonus', 'mult', 'wild', 'glass', 'steel', 'stone', 'gold', 'lucky'])
    card.edition = rollEdition(cardEditionChances(0), rng) // FIDELITY: 幻术不受磨砺/焕彩影响且不出蜡封（原作 bug 复刻）
  }
  return { uid: uid('sc'), kind, id: 'playing_card', card, edition: card.edition }
}

function consumeForcedJokerTag(run) {
  const q = run.tagQueue.forcedJokers
  if (!q.length) return null
  const f = q.shift()
  return { uid: uid('sj'), kind: 'joker', id: f.id, edition: f.edition || null, freeFromTag: true }
}

export function shopSlotCount(run) {
  let n = 2
  if (run.vouchers.includes('v_overstock')) n += 1
  if (run.vouchers.includes('v_overstock_plus')) n += 1
  return n
}

export function rerollBaseCost(run) {
  let c = 5
  if (run.vouchers.includes('v_reroll_surplus')) c -= 2
  if (run.vouchers.includes('v_reroll_glut')) c -= 2
  if (run.tagQueue.d6) c = 0
  return Math.max(0, c)
}

// 生成整个商店
export function generateShop(run, rng) {
  const cards = []
  for (let i = 0; i < shopSlotCount(run); i++) cards.push(rollShopCard(run, rng))
  const packs = []
  for (let i = 0; i < 2; i++) packs.push({ uid: uid('pk'), ...rng.weightedPick(PACKS, p => p.weight) })
  const voucher = rollVoucher(run, rng)
  const extraVoucher = run.tagQueue.extraVoucher ? rollVoucher(run, rng, voucher) : null
  run.tagQueue.extraVoucher = false
  const shop = {
    cards, packs, voucher, extraVoucher,
    rerollCost: rerollBaseCost(run),
    freeRerollUsed: false,
    coupon: run.tagQueue.coupon, // 优惠券标签：初始卡牌与卡包免费
  }
  run.tagQueue.coupon = false
  run.tagQueue.d6 = false
  return shop
}

function rollVoucher(run, rng, excludeId = null) {
  const owned = new Set(run.vouchers)
  const available = VOUCHERS.filter(v => {
    if (v.id === excludeId) return false
    if (owned.has(v.id)) return false
    if (v.requires && !owned.has(v.requires)) return false
    return true
  })
  if (!available.length) return 'v_blank'
  return rng.pick(available).id
}

// 利息
export function interestFor(run) {
  if (run.greenEconomy) return 0
  let cap = 5
  if (run.vouchers.includes('v_money_tree')) cap = 20
  else if (run.vouchers.includes('v_seed_money')) cap = 10
  return Math.min(Math.floor(Math.max(0, run.money) / 5), cap)
}

// 价格计算（含天文学家/优惠券标签）
export function itemPrice(run, shopItem) {
  if (shopItem.freeFromTag) return 0
  if (shopItem.kind === 'planet' && hasRule(run, 'astronomer')) return 0
  if (shopItem.kind === 'playing') return priceOf(1, shopItem.edition, run)
  const def = JOKERS_BY_ID[shopItem.id] ||
    (shopItem.kind === 'tarot' ? TAROT.find(t => t.id === shopItem.id) : null) ||
    (shopItem.kind === 'planet' ? PLANETS.find(p => p.id === shopItem.id) : null) ||
    (shopItem.kind === 'spectral' ? SPECTRAL_POOL.find(s => s.id === shopItem.id) : null)
  return priceOf(def?.cost || 3, shopItem.edition, run)
}

export function packPrice(run, pack) {
  if (pack.packType === 'celestial' && hasRule(run, 'astronomer')) return 0
  return priceOf(pack.cost, null, run)
}
