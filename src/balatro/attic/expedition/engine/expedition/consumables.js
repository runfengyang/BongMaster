// 远征消耗牌引擎（契约 §5.4，老虎机模型）：塔罗/幻灵/星球的使用与日修正应用
// 改牌类恢复原作语义，直接作用于本局扑克牌组（永久）；
// 当日类（符印/占卜/火祭/商店强化）暂存 exp.pendingDayEffects，下个活跃日结算时应用并清空。
// 翻译表在 data/expedition/consumableTranslation.js（数据/逻辑分离）。

import { TAROT } from '../../../../data/tarot.js'
import { PLANETS, PLANETS_BY_ID } from '../../../../data/planets.js'
import { SPECTRAL_POOL } from '../../../../data/spectral.js'
import { JOKERS_BY_ID } from '../../../../data/jokers.js'
import { EXPEDITION_BOSSES_BY_ID } from '../../data/expedition/bosses.js'
import { TAROT_TRANSLATION, SPECTRAL_TRANSLATION } from '../../data/expedition/consumableTranslation.js'
import { RANK_LABELS, SUITS } from '../../../../engine/deck.js'
import {
  addConsumableToExp, destroyLineupJoker, destroyDeckCard, addJokerToExp, addDeckCard,
  adapterRun, adapterRound, emitJokersPhase,
} from './adapter.js'
import { poolForWins } from './economy.js'
import { MAX_PRESSURE } from './balance.js'

// ================= 使用消耗牌 =================
// targets: 可选目标（牌组牌 id 或阵容小丑 uid，按效果类型解释）；缺省随机。失败时不消耗。
export function useConsumable(exp, uid, { targets = [] } = {}) {
  const idx = exp.consumables.findIndex(c => c.uid === uid)
  if (idx < 0) return { ok: false, reason: 'not_found', events: [] }
  const c = exp.consumables[idx]
  exp.consumables.splice(idx, 1) // 使用即消耗（契约 §2.1）；执行失败则放回
  const events = []
  const emit = e => events.push(e)
  const res = executeConsumableEffect(exp, c.id, { targets, emit })
  if (!res.ok) {
    exp.consumables.splice(idx, 0, c)
    return { ...res, events }
  }
  emit({ type: 'consumableUsed', id: c.id, uid })

  // 统计（占卜师/卫星等依赖）
  const type = c.id.startsWith('p_') ? 'planet' : c.id.startsWith('s_') ? 'spectral' : 'tarot'
  if (type === 'planet') {
    if (!exp.stats.planetsUsedUnique.includes(c.id)) exp.stats.planetsUsedUnique.push(c.id)
  } else if (type === 'tarot') {
    exp.stats.tarotsUsed = (exp.stats.tarotsUsed || 0) + 1
  }
  if (c.id !== 'c_fool') exp.lastConsumableId = c.id

  // consumableUsed 阶段（星座：使用星球成长）
  const run = adapterRun(exp)
  const round = adapterRound(exp)
  events.push(...emitJokersPhase(exp, run, round, exp.rng, 'consumableUsed', { consumableType: type }))
  return { ok: true, events }
}

// ================= 目标选择 =================
function pickDeckCards(exp, targets, count, filter = () => true) {
  const eligible = exp.deck.filter(filter)
  const picked = []
  for (const t of targets || []) {
    const c = eligible.find(x => x.id === t)
    if (c && !picked.includes(c)) picked.push(c)
  }
  while (picked.length < count && eligible.length) {
    const c = exp.rng.pick(eligible)
    if (!picked.includes(c)) picked.push(c)
    else if (eligible.length <= picked.length) break
  }
  return picked.slice(0, count)
}

function pickLineupJoker(exp, targets, filter = () => true) {
  const candidates = exp.jokers.filter(j => !j.debuffed && filter(j))
  if (targets?.length) {
    const t = candidates.find(j => j.uid === targets[0])
    if (t) return t
  }
  return candidates.length ? exp.rng.pick(candidates) : null
}

function relabel(card) { card.rankLabel = RANK_LABELS[card.rank] }

function applyMutation(card, mutation) {
  if (mutation.enhancement) card.enhancement = mutation.enhancement
  if (mutation.seal) card.seal = mutation.seal
  if (mutation.suit) card.suit = mutation.suit
  if (mutation.rankPlus) { card.rank = Math.min(14, card.rank + mutation.rankPlus); relabel(card) }
}

// ================= 效果执行 =================
function executeConsumableEffect(exp, id, { targets, emit, fromFool = false }) {
  // ---- 星球（12）：对应牌型等级 +1，本局永久（原作语义不变） ----
  if (id.startsWith('p_')) {
    const p = PLANETS_BY_ID[id]
    if (!p) return { ok: false, reason: 'unknown_planet' }
    exp.handLevels[p.hand] = Math.max(1, (exp.handLevels[p.hand] || 1) + 1)
    emit({ type: 'planetUpgrade', id, hand: p.hand, level: exp.handLevels[p.hand] })
    return { ok: true }
  }

  const tr = TAROT_TRANSLATION[id] || SPECTRAL_TRANSLATION[id]
  if (!tr) return { ok: false, reason: 'unknown_consumable' }
  const eff = tr.effect
  const rng = exp.rng

  switch (eff.kind) {
    case 'fool': {
      const last = exp.lastConsumableId
      if (!last || last === 'c_fool') {
        emit({ type: 'foolNoop', text: '本局尚未使用过消耗牌' })
        return { ok: true } // 原作：无上一张牌时无事发生（仍消耗）
      }
      emit({ type: 'foolCopy', copiedId: last })
      return executeConsumableEffect(exp, last, { targets, emit, fromFool: true })
    }
    case 'create': {
      const pool = eff.pool === 'planet' ? PLANETS : eff.pool === 'spectral' ? SPECTRAL_POOL : TAROT
      const created = []
      for (let i = 0; i < eff.count; i++) {
        const c = addConsumableToExp(exp, rng.pick(pool).id)
        if (!c) break // 栏满即止（原作需有空位语义）
        created.push(c.id)
      }
      emit({ type: 'consumablesCreated', ids: created })
      return created.length ? { ok: true } : { ok: false, reason: 'no_slot' }
    }
    case 'research':
      exp.research += eff.amount
      emit({ type: 'researchGain', id, amount: eff.amount })
      return { ok: true }
    case 'pressure':
      exp.pressure = Math.max(0, Math.min(MAX_PRESSURE, exp.pressure + eff.amount))
      emit({ type: 'pressureShift', id, amount: eff.amount, pressure: exp.pressure })
      return { ok: true }
    case 'rerollIntent': {
      const boss = EXPEDITION_BOSSES_BY_ID[exp.bossId]
      exp.forcedIntent = rng.weightedPick(boss.intents, i => i.weight ?? 1)
      emit({ type: 'intentRerolled', id, intent: exp.forcedIntent.id })
      return { ok: true }
    }
    case 'deckMutate': {
      const cards = pickDeckCards(exp, targets, eff.count)
      if (!cards.length) return { ok: false, reason: 'no_valid_card' }
      for (const card of cards) {
        if (eff.mutation.edition === 'random') card.edition = rng.pick(['foil', 'holo', 'poly'])
        else applyMutation(card, eff.mutation)
        emit({ type: 'cardMutated', id, cardId: card.id, mutation: eff.mutation, rank: card.rank, suit: card.suit, enhancement: card.enhancement, seal: card.seal, edition: card.edition })
      }
      return { ok: true }
    }
    case 'destroy': {
      const cards = pickDeckCards(exp, targets, eff.count)
      if (!cards.length) return { ok: false, reason: 'no_valid_card' }
      for (const card of cards) {
        destroyDeckCard(exp, card.id)
        emit({ type: 'cardDestroyed', id, cardId: card.id })
      }
      return { ok: true }
    }
    case 'death': {
      // 死神：左牌变成右牌的复制（原作语义；牌组数量不变）
      const cards = pickDeckCards(exp, targets, 2)
      if (cards.length < 2) return { ok: false, reason: 'need_2_cards' }
      const [left, right] = cards
      left.rank = right.rank; relabel(left)
      left.suit = right.suit
      left.enhancement = right.enhancement
      left.edition = right.edition
      left.seal = right.seal
      emit({ type: 'deathConverted', id, fromCardId: left.id, toRank: left.rank, toSuit: left.suit })
      return { ok: true }
    }
    case 'destroyAdd': {
      const cards = pickDeckCards(exp, targets, eff.destroy)
      if (!cards.length) return { ok: false, reason: 'no_valid_card' }
      for (const card of cards) {
        destroyDeckCard(exp, card.id)
        emit({ type: 'cardDestroyed', id, cardId: card.id })
      }
      const ENHANCEMENTS = ['bonus', 'mult', 'wild', 'glass', 'steel', 'stone', 'gold', 'lucky']
      const added = []
      for (let i = 0; i < eff.add.count; i++) {
        const c = addDeckCard(exp, {
          rank: rng.pick(eff.add.ranks),
          enhancement: eff.add.enhanced ? rng.pick(ENHANCEMENTS) : null,
        })
        if (c) added.push(c.id)
      }
      emit({ type: 'cardsAdded', id, cardIds: added })
      return { ok: true }
    }
    case 'cryptid': {
      const cards = pickDeckCards(exp, targets, 1)
      if (!cards.length) return { ok: false, reason: 'no_valid_card' }
      const src = cards[0]
      const added = []
      for (let i = 0; i < 2; i++) {
        const c = addDeckCard(exp, { rank: src.rank, suit: src.suit, enhancement: src.enhancement, edition: src.edition, seal: src.seal })
        if (c) added.push(c.id)
      }
      emit({ type: 'cardsCopied', id, fromCardId: src.id, cardIds: added })
      return added.length ? { ok: true } : { ok: false, reason: 'deck_full' }
    }
    case 'wheel': {
      // 命运之轮：1/4 概率随机小丑随机版本（版本 = 数值加成；负片由灵质/灵魂通道产出）
      if (exp.jokers.length && rng.chance(1, 4)) {
        const j = rng.pick(exp.jokers)
        j.edition = rng.pick(['foil', 'holo', 'poly'])
        emit({ type: 'wheelHit', id, jokerUid: j.uid, jokerId: j.id, edition: j.edition })
      } else {
        emit({ type: 'wheelMiss', id })
      }
      return { ok: true }
    }
    case 'ectoplasm': {
      const target = pickLineupJoker(exp, targets)
      if (!target) return { ok: false, reason: 'no_valid_joker' }
      target.edition = 'negative' // +1 栏（原作/adapter 栏位语义）
      exp.drawCountModifier = (exp.drawCountModifier || 0) - 1 // 每次拉杆抽取 -1（原作 -1 手牌上限）
      emit({ type: 'editionApplied', id, jokerUid: target.uid, jokerId: target.id, edition: 'negative', drawModifier: exp.drawCountModifier })
      return { ok: true }
    }
    case 'immolate': {
      // 契约「诅咒」：销毁 1 张小丑 → 当日全部拉杆伤害 ×2
      const target = pickLineupJoker(exp, targets)
      if (!target) return { ok: false, reason: 'no_valid_joker' }
      destroyLineupJoker(exp, target.uid)
      exp.pendingDayEffects.push({ type: 'dayDamageMult', x: 2, sourceId: id })
      emit({ type: 'jokerSacrificed', id, jokerUid: target.uid, jokerId: target.id, damageMult: 2 })
      return { ok: true }
    }
    case 'ankh': {
      // 降神：复制阵容 1 张小丑（局内副本，不复制版本；需空栏位）
      const target = pickLineupJoker(exp, targets)
      if (!target) return { ok: false, reason: 'no_valid_joker' }
      const copy = addJokerToExp(exp, { id: target.id, edition: null }, rng)
      if (!copy) return { ok: false, reason: 'lineup_full' }
      copy.state = JSON.parse(JSON.stringify(target.state || {}))
      emit({ type: 'jokerCopied', id, from: target.id, copyUid: copy.uid })
      return { ok: true }
    }
    case 'hex': {
      // 妖法：随机 1 张变多彩，销毁其余（原作语义）
      if (!exp.jokers.length) return { ok: false, reason: 'no_valid_joker' }
      const keep = rng.pick(exp.jokers)
      for (const j of [...exp.jokers]) if (j.uid !== keep.uid) destroyLineupJoker(exp, j.uid)
      keep.edition = 'poly'
      emit({ type: 'hexed', id, keptUid: keep.uid, keptId: keep.id })
      return { ok: true }
    }
    case 'soul': {
      // 灵魂：随机传奇入阵容（需空栏位）
      const legendaries = Object.values(JOKERS_BY_ID).filter(j => j.rarity === 4)
      const def = rng.pick(legendaries)
      const j = addJokerToExp(exp, { id: def.id, edition: null }, rng)
      if (!j) return { ok: false, reason: 'lineup_full' }
      emit({ type: 'legendarySummoned', id, jokerId: def.id })
      return { ok: true }
    }
    case 'wraith': {
      // 幽灵：随机稀有入阵容，研料归零（原作语义）
      const rares = poolForWins(exp.wins || 0).filter(j => j.rarity === 3)
      if (!rares.length) return { ok: false, reason: 'pool_empty' }
      const def = rng.pick(rares)
      const j = addJokerToExp(exp, { id: def.id, edition: null }, rng)
      if (!j) return { ok: false, reason: 'lineup_full' }
      exp.research = 0
      emit({ type: 'wraithSummoned', id, jokerId: def.id, research: 0 })
      return { ok: true }
    }
    case 'createJoker': {
      // 审判：随机小丑入阵容（稀有度按原作 70/25/5；卡池按解锁阶梯）
      const pool = poolForWins(exp.wins || 0)
      const roll = rng.next() * 100
      const rarity = roll < 70 ? 1 : roll < 95 ? 2 : 3
      const candidates = pool.filter(j => j.rarity === rarity)
      if (!candidates.length) return { ok: false, reason: 'pool_empty' }
      const def = rng.pick(candidates)
      const j = addJokerToExp(exp, { id: def.id, edition: null }, rng)
      if (!j) return { ok: false, reason: 'lineup_full' }
      emit({ type: 'jokerSummoned', id, jokerId: def.id, rarity })
      return { ok: true }
    }
    case 'blackHole':
      for (const h of Object.keys(exp.handLevels)) exp.handLevels[h] += 1
      emit({ type: 'allHandsUpgraded', id })
      return { ok: true }
    case 'dayFx':
      exp.pendingDayEffects.push({ ...eff.fx, sourceId: id })
      emit({ type: 'dayFxPending', id, fx: eff.fx.type })
      return { ok: true }
    default:
      return { ok: false, reason: `unhandled_effect:${eff.kind}` }
  }
}

// ================= 当日修正应用（dayScore 调用） =================
// 把 pendingDayEffects 应用到抽取池（当日有效、日终还原），返回按抽分数修正 scoreMods
export function applyDayEffects(exp, pool, emit) {
  const fxList = exp.pendingDayEffects.splice(0)
  const scoreMods = { chipsAdd: 0, multAdd: 0, damageMult: 1, mutations: [] }
  for (const fx of fxList) {
    switch (fx.type) {
      case 'allSameSuit': {
        const suit = exp.rng.pick(SUITS)
        for (const c of pool) { scoreMods.mutations.push([c, 'suit', c.suit]); c.suit = suit }
        emit({ type: 'dayFxApplied', fx: 'allSameSuit', sourceId: fx.sourceId, suit })
        break
      }
      case 'allSameRank': {
        // 取池中最众数点数（原作占卜语义）
        const counts = {}
        for (const c of pool) counts[c.rank] = (counts[c.rank] || 0) + 1
        const rank = +Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
        for (const c of pool) {
          scoreMods.mutations.push([c, 'rank', c.rank], [c, 'rankLabel', c.rankLabel])
          c.rank = rank; c.rankLabel = RANK_LABELS[rank]
        }
        emit({ type: 'dayFxApplied', fx: 'allSameRank', sourceId: fx.sourceId, rank })
        break
      }
      case 'dayChips': scoreMods.chipsAdd += fx.amount; emit({ type: 'dayFxApplied', fx: 'dayChips', sourceId: fx.sourceId, amount: fx.amount }); break
      case 'dayMult': scoreMods.multAdd += fx.amount; emit({ type: 'dayFxApplied', fx: 'dayMult', sourceId: fx.sourceId, amount: fx.amount }); break
      case 'dayDamageMult': scoreMods.damageMult *= fx.x; emit({ type: 'dayFxApplied', fx: 'dayDamageMult', sourceId: fx.sourceId, x: fx.x }); break
      default:
        emit({ type: 'dayFxSkipped', fx: fx.type })
    }
  }
  return scoreMods
}

// 日终还原当日修正对池牌的临时改动（逆序）
export function revertCardMutations(mutations) {
  for (let i = mutations.length - 1; i >= 0; i--) {
    const [card, field, oldValue] = mutations[i]
    card[field] = oldValue
  }
}
