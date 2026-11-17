// 研料局内经济与卡包系统（契约 §2 局内卡牌生命周期）
// 起始构筑 draft（§2.1）→ 局内卡包来源（节点奖励 §2.2 / 商店 §2.3）→ 局终清算（§2.4）
// 开包概率、版本 roll 全部镜像 §11/§12 现有引擎档位（run.js openPack / shop.js），不做改动；
// 卡池按通关解锁阶梯（§8）过滤；一切卡牌局内获得、局终清算；见过即点亮图鉴。

import { PACKS_BY_ID, PACKS } from '../../../../data/packs.js'
import { TAROT } from '../../../../data/tarot.js'
import { PLANETS } from '../../../../data/planets.js'
import { SPECTRAL_POOL } from '../../../../data/spectral.js'
import { JOKER_POOL } from '../../../../data/jokers.js'
import { jokerEditionChances, cardEditionChances } from '../../../../data/editions.js'
import { makeCard, SUITS } from '../../../../engine/deck.js'
import { Rng } from '../../../../engine/rng.js'
import {
  STARTER_DRAFT, STARTER_LADDER, POOL_LADDER, PACK_REWARD, PACK_TYPES,
  SHOP_REROLL_COST, CREDIT_LIMIT, DECK_CAP,
} from './balance.js'
import {
  addJokerToExp, addDeckCard, addConsumableToExp, markSeen,
  computeModifiers, emitJokersPhase, adapterRun, adapterRound,
} from './adapter.js'

// ================= 卡池解锁阶梯（契约 §8） =================
// 0 通关 = 普通前 40 + 罕见前 20；3 = 普通/罕见全量；5 = 稀有 20 解禁
export function poolForWins(wins = 0) {
  const ladder = [...POOL_LADDER].sort((a, b) => a.wins - b.wins)
  let tier = ladder[0]
  for (const t of ladder) if (wins >= t.wins) tier = { ...tier, ...t }
  const take = (rarity, n) => {
    const all = JOKER_POOL.filter(j => j.rarity === rarity)
    return n === 'all' ? all : all.slice(0, n || 0)
  }
  return [...take(1, tier.commons), ...take(2, tier.uncommons), ...take(3, tier.rares)]
}

export function ladderTier(wins = 0) {
  let tier = POOL_LADDER[0]
  for (const t of [...POOL_LADDER].sort((a, b) => a.wins - b.wins)) if (wins >= t.wins) tier = { ...tier, ...t }
  return tier
}

export function starterSpec(wins = 0) {
  let spec = STARTER_LADDER[0]
  for (const t of [...STARTER_LADDER].sort((a, b) => a.wins - b.wins)) if (wins >= t.wins) spec = t
  return spec
}

// ================= 局内 roll（镜像 run.js openPack / shop.js 概率档位） =================
function rollEditionFrom(chances, rng) {
  const r = rng.next()
  let acc = 0
  for (const [ed, p] of Object.entries(chances)) {
    acc += p
    if (r < acc) return ed
  }
  return null
}

// 小丑 roll：稀有度 70/25/5（mirror shop.js generateJoker），版本 jokerEditionChances(0)
export function rollJokerInRun(exp, { rarity = null } = {}) {
  const rng = exp.rng
  const pool = poolForWins(exp.wins || 0)
  let r = rarity
  if (!r) {
    const roll = rng.next() * 100
    r = roll < 70 ? 1 : roll < 95 ? 2 : 3
  }
  const candidates = pool.filter(j => j.rarity === r)
  if (!candidates.length) return null
  // 排除已持有（Showman E4 接入）
  const owned = new Set(exp.jokers.map(j => j.id))
  const list = candidates.filter(j => !owned.has(j.id))
  const def = rng.pick(list.length ? list : candidates)
  return { kind: 'joker', id: def.id, edition: rollEditionFrom(jokerEditionChances(0), rng) }
}

// 扑克牌 roll（mirror run.js:720-730）：40% 增强 / 20% 蜡封 / 版本 cardEditionChances(0)
export function rollPlayingCardInRun(exp, { enhancementBoost = 0 } = {}) {
  const rng = exp.rng
  const tier = ladderTier(exp.wins || 0)
  const boost = enhancementBoost + (tier.enhancementBoost || 0)
  const card = makeCard(rng.int(2, 14), rng.pick(SUITS))
  if (rng.chance(40 + boost * 100, 100)) card.enhancement = rng.pick(['bonus', 'mult', 'wild', 'glass', 'steel', 'stone', 'gold', 'lucky'])
  if (rng.chance(20 + boost * 100, 100)) card.seal = rng.pick(['red', 'blue', 'purple', 'gold'])
  card.edition = rollEditionFrom(cardEditionChances(0), rng)
  return { kind: 'playing', card }
}

// ================= 起始构筑 draft（契约 §2.1） =================
export function rollStarterDraft(exp) {
  const spec = starterSpec(exp.wins || 0)
  const jokerOptions = []
  for (let i = 0; i < (spec.jokerOptions ?? STARTER_DRAFT.jokerOptions); i++) {
    const j = rollJokerInRun(exp, {})
    if (j) jokerOptions.push(j)
  }
  const cardOptions = []
  for (let i = 0; i < (spec.cardOptions ?? STARTER_DRAFT.cardOptions); i++) {
    cardOptions.push(rollPlayingCardInRun(exp))
  }
  for (const o of [...jokerOptions, ...cardOptions]) markSeen(exp, o.kind === 'joker' ? o.id : 'playing_card')
  return {
    jokerOptions, cardOptions,
    jokerChoose: spec.jokerChoose ?? STARTER_DRAFT.jokerChoose,
    cardChoose: spec.cardChoose ?? STARTER_DRAFT.cardChoose,
    label: spec.label, resolved: false,
  }
}

// 应用 draft 选择：jokerIndex 入阵容；cardIndices 入牌组
export function applyStarterDraft(exp, { jokerIndex = 0, cardIndices = [0, 1] } = {}) {
  const d = exp.draft
  if (!d || d.resolved) return { ok: false, reason: 'no_draft' }
  const picked = []
  const jo = d.jokerOptions[jokerIndex]
  if (jo) {
    const j = addJokerToExp(exp, { id: jo.id, edition: jo.edition }, exp.rng)
    if (j) picked.push(jo.id)
  }
  const cards = []
  for (const i of cardIndices.slice(0, d.cardChoose)) {
    const o = d.cardOptions[i]
    if (!o) continue
    if (exp.deck.length >= DECK_CAP) break
    exp.deck.push(o.card)
    cards.push(o.card.id)
  }
  exp.deckStart = exp.deck.length
  d.resolved = true
  return { ok: true, joker: jo?.id || null, cards }
}

// ================= 局内卡包（契约 §2.2；概率档位镜像 run.js openPack） =================
export function rollPackOptions(exp, packId) {
  const def = PACKS_BY_ID[packId]
  if (!def) throw new Error(`unknown pack: ${packId}`)
  const rng = exp.rng
  const tier = ladderTier(exp.wins || 0)
  const soulP = 0.003 + (tier.soulBoost || 0) // 灵魂/黑洞 0.3%（12 通关后翻倍）
  const options = []
  for (let i = 0; i < def.count; i++) {
    if (def.contents === 'tarot') {
      if (rng.next() < soulP) options.push({ kind: 'spectral', id: 's_soul' })
      else options.push({ kind: 'tarot', id: rng.pick(TAROT).id })
    } else if (def.contents === 'planet') {
      if (rng.next() < soulP) options.push({ kind: 'spectral', id: 's_black_hole' })
      else options.push({ kind: 'planet', id: rng.pick(PLANETS).id })
    } else if (def.contents === 'spectral') {
      if (rng.next() < soulP) options.push({ kind: 'spectral', id: 's_soul' })
      else options.push({ kind: 'spectral', id: rng.pick(SPECTRAL_POOL).id })
    } else if (def.contents === 'playing') {
      options.push(rollPlayingCardInRun(exp))
    } else if (def.contents === 'joker') {
      const j = rollJokerInRun(exp, {})
      if (j) options.push(j)
    }
  }
  for (const o of options) markSeen(exp, o.kind === 'joker' ? o.id : o.kind === 'playing' ? 'playing_card' : o.id)
  return options
}

// 开包：roll 选项 → exp.pendingPack；packOpened 阶段（幻觉小丑）；选牌由 applyPackPicks 落地
export function openInRunPack(exp, packId) {
  const options = rollPackOptions(exp, packId)
  const def = PACKS_BY_ID[packId]
  exp.pendingPack = { packId, options, choose: def.choose }
  const events = emitJokersPhase(exp, adapterRun(exp), adapterRound(exp), exp.rng, 'packOpened', { packType: def.packType })
  return { ok: true, packId, options, choose: def.choose, events }
}

// 选牌落地：小丑入阵容 / 扑克牌入牌组 / 消耗牌入栏（栏满则该张放弃，与原作一致）
export function applyPackPicks(exp, indices = []) {
  const pp = exp.pendingPack
  if (!pp) return { ok: false, reason: 'no_pack' }
  const applied = []
  for (const i of indices.slice(0, pp.choose)) {
    const o = pp.options[i]
    if (!o) continue
    if (o.kind === 'joker') {
      const j = addJokerToExp(exp, { id: o.id, edition: o.edition }, exp.rng)
      if (j) applied.push({ kind: 'joker', id: o.id })
    } else if (o.kind === 'playing') {
      if (exp.deck.length < DECK_CAP) { exp.deck.push(o.card); applied.push({ kind: 'playing', id: o.card.id }) }
    } else {
      const c = addConsumableToExp(exp, o.id)
      if (c) applied.push({ kind: o.kind, id: o.id })
    }
  }
  exp.pendingPack = null
  return { ok: true, applied }
}

// 跳包（红卡小丑成长源；镜像 run.js:773）
export function skipInRunPack(exp) {
  if (exp.pendingPack) exp.pendingPack = null
  exp.stats.packsSkipped = (exp.stats.packsSkipped || 0) + 1
  for (const j of exp.jokers) if (j.id === 'j_red_card') j.state.mult = (j.state.mult || 0) + 3
  return { ok: true, packsSkipped: exp.stats.packsSkipped }
}

// 节点通关奖励（契约 §2.2）：普通 = 卡包类型三选一；精英 = Jumbo；Boss = Mega + 稀有掉落
export function offerForNodeCleared(exp, nodeKind) {
  const rng = exp.rng
  if (nodeKind === 'normal') {
    const types = [...PACK_TYPES]
    const options = []
    for (let i = 0; i < PACK_REWARD.normalChoices && types.length; i++) {
      const t = types.splice(Math.floor(rng.next() * types.length), 1)[0]
      options.push(`pack_${t}_normal`)
    }
    return { kind: 'packChoice', options }
  }
  if (nodeKind === 'elite') {
    const t = PACK_TYPES[Math.floor(rng.next() * PACK_TYPES.length)]
    return { kind: 'pack', packId: `pack_${t}_${PACK_REWARD.eliteSize}` }
  }
  if (nodeKind === 'boss') {
    const t = PACK_TYPES[Math.floor(rng.next() * PACK_TYPES.length)]
    const offers = [{ kind: 'pack', packId: `pack_${t}_${PACK_REWARD.bossSize}` }]
    if (rng.next() < PACK_REWARD.bossRareChance) offers.push({ kind: 'pack', packId: 'pack_spectral_normal' })
    return { kind: 'bossReward', offers }
  }
  return null
}

// ================= 远征商店（商店节点；研料消费；优惠券 E4 接入） =================
export const EXPEDITION_SHOP_POOL = [
  { id: 'pack_arcana_normal', kind: 'pack', cost: 4, weight: 3, text: '秘术包（塔罗 3 选 1）' },
  { id: 'pack_celestial_normal', kind: 'pack', cost: 4, weight: 3, text: '天体包（星球 3 选 1）' },
  { id: 'pack_standard_normal', kind: 'pack', cost: 4, weight: 3, text: '标准包（扑克 3 选 1，补牌组）' },
  { id: 'pack_buffoon_normal', kind: 'pack', cost: 4, weight: 2, text: '小丑包（小丑 2 选 1）' },
  { id: 'pack_spectral_normal', kind: 'pack', cost: 4, weight: 1, text: '幻灵包（幻灵 2 选 1）' },
  { id: 'boost_strike', kind: 'boost', cost: 4, weight: 2, text: '强攻药剂：当日全部拉杆伤害 ×1.5', effect: { type: 'dayDamageMult', x: 1.5 } },
  { id: 'boost_chips', kind: 'boost', cost: 3, weight: 2, text: '筹码补给：当日每次拉杆 +30 筹码', effect: { type: 'dayChips', amount: 30 } },
  { id: 'boost_mult', kind: 'boost', cost: 3, weight: 2, text: '倍率补给：当日每次拉杆 +4 倍率', effect: { type: 'dayMult', amount: 4 } },
]

export function generateExpeditionShop(exp) {
  const rng = exp.rng
  const offers = []
  const pool = [...EXPEDITION_SHOP_POOL]
  for (let i = 0; i < 3 && pool.length; i++) {
    const pick = rng.weightedPick(pool, o => o.weight)
    offers.push(pick)
    pool.splice(pool.indexOf(pick), 1)
    markSeen(exp, pick.id)
  }
  return { offers, rerollCost: SHOP_REROLL_COST, freeRerollUsed: false }
}

// 商店节点且本局进行中时可购物
export function canShop(exp) {
  return exp.status === 'active' && exp.nodes[exp.nodeIndex]?.kind === 'shop'
}

export function buyShopOffer(exp, shop, idx) {
  const offer = shop.offers[idx]
  if (!offer) return { ok: false, reason: 'no_offer' }
  const floor = computeModifiers(exp).creditCard ? CREDIT_LIMIT : 0
  if (exp.research - offer.cost < floor) return { ok: false, reason: 'not_enough_research' }
  exp.research -= offer.cost
  shop.offers.splice(idx, 1)
  if (offer.kind === 'pack') {
    return { ok: true, offer, pack: openInRunPack(exp, offer.id), research: exp.research }
  }
  exp.pendingDayEffects.push({ ...offer.effect, sourceId: offer.id })
  return { ok: true, offer, research: exp.research }
}

// 重 roll（混沌小丑首次免费；闪卡小丑经 reroll 阶段成长）
export function rerollExpeditionShop(exp, shop) {
  const free = computeModifiers(exp).freeReroll && !shop.freeRerollUsed
  if (free) shop.freeRerollUsed = true
  else {
    if (exp.research < shop.rerollCost) return { ok: false, reason: 'not_enough_research' }
    exp.research -= shop.rerollCost
  }
  const next = generateExpeditionShop(exp)
  shop.offers = next.offers
  const events = emitJokersPhase(exp, adapterRun(exp), adapterRound(exp), exp.rng, 'reroll')
  return { ok: true, free, offers: shop.offers, events }
}

// ================= 局终清算（契约 §2.4） =================
// 通关/失败/放弃：局内卡牌、研料、牌型等级、临时强化全部清算；
// 永久保留：图鉴点亮（seen）、通关次数、卡池解锁、起始构筑升级
export function buildSettlementReport(exp, status, reason) {
  return {
    status, reason,
    days: exp.dayIndex,
    cleared: {
      jokers: exp.jokers.map(j => ({ id: j.id, edition: j.edition })),
      deckCount: exp.deck.length,
      consumables: exp.consumables.map(c => c.id),
      research: exp.research, // 局终清零（报告记录清算值）
      handLevels: { ...exp.handLevels },
      pendingDayEffects: exp.pendingDayEffects.length,
    },
    discovered: Object.keys(exp.seen), // 见过即点亮（永久）
    won: status === 'won',
    pendingPacks: exp.packQueue.length, // Boss 掉落等待开启（E3 结算界面）
  }
}

// 独立 Rng（测试/模拟用，不污染远征局内 rng）
export function mkEconomyRng(seed = 'economy') { return new Rng(seed) }
