// 小丑效果注册表（§5.3）
// 统一签名：handler(ctx, params)
// ctx = { run, round, played, scored, held, joker, def, hand, emit, rng, phase, card,
//         discarded, score: {chips, mult}, helpers }
// phase: blindSelect | roundStart | handPlayed | scoredCard | heldCard | jokerScore
//        | discard | roundEnd | shopStart | shopEnd | packOpened | sell | blindDefeated
//        | reroll | cardSold | consumableUsed
// Blueprint/Brainstorm 复制通过 jokerHandlerFor() 解析目标后二次执行目标 handler

import { JOKERS_BY_ID } from '../data/jokers.js'
import { HAND_CONTAINS } from '../data/hands.js'
import { isFace, suitIs, cardChips } from './deck.js'

// ---- 工具 ----
export function prob(ctx, denominator) { // 「1 in d」概率，Oops! All 6s 翻倍
  const k = ctx.run.modifiers?.doubleProb ? 2 : 1
  return ctx.rng.chance(k, denominator)
}
export function handContains(ctx, handId) {
  const t = ctx.hand.royal ? 'straight_flush' : ctx.hand.handType
  return (HAND_CONTAINS[t] || []).includes(handId) || t === handId
}
function faceCards(arr) { return arr.filter(c => isFace(c)) }
function trig(ctx, extra = {}) {
  ctx.emit({ type: 'jokerTrigger', uid: ctx.joker.uid, id: ctx.joker.id, ...extra })
}
function addC(ctx, n) { ctx.score.chips += n; trig(ctx, { chips: n }) }
function addM(ctx, n) { ctx.score.mult += n; trig(ctx, { mult: n }) }
function mulM(ctx, x) { ctx.score.mult = round2(ctx.score.mult * x); trig(ctx, { xMult: x }) }
export function round2(n) { return Math.round(n * 100) / 100 }

// ---- Blueprint / Brainstorm 复制解析 ----
const COPY_HANDLERS = new Set(['copyRight', 'copyLeftRight'])
export function jokerHandlerFor(joker, jokers) {
  const def = JOKERS_BY_ID[joker.id]
  const h = def.effect.handler
  if (h === 'copyRight') {
    const idx = jokers.findIndex(j => j.uid === joker.uid)
    const right = jokers[idx + 1]
    if (right && !right.debuffed) {
      const rd = JOKERS_BY_ID[right.id]
      if (!COPY_HANDLERS.has(rd.effect.handler)) return { def: rd, joker: right, copiedBy: joker }
    }
    return null // 无可复制目标：不触发
  }
  if (h === 'copyLeftRight') {
    const leftmost = jokers[0]
    if (leftmost && leftmost.uid !== joker.uid && !leftmost.debuffed) {
      const ld = JOKERS_BY_ID[leftmost.id]
      if (!COPY_HANDLERS.has(ld.effect.handler)) return { def: ld, joker: leftmost, copiedBy: joker }
    }
    return null
  }
  return { def, joker }
}

// ============================================================
// 注册表
// ============================================================
export const JOKER_HANDLERS = {
  noop() {},

  // ---- 静态/参数化加成 ----
  addMult(ctx, p) { if (ctx.phase === 'jokerScore') addM(ctx, p.mult) },
  suitScoredBonus(ctx, p) {
    if (ctx.phase !== 'scoredCard') return
    if (ctx.card.enhancement === 'stone' || !suitIs(ctx.card, p.suit)) return
    if (p.chance && !prob(ctx, p.chance)) return
    if (p.chips) { ctx.score.chips += p.chips; trig(ctx, { chips: p.chips, cardId: ctx.card.id }) }
    if (p.mult) { ctx.score.mult += p.mult; trig(ctx, { mult: p.mult, cardId: ctx.card.id }) }
    if (p.xMult) { ctx.score.mult = round2(ctx.score.mult * p.xMult); trig(ctx, { xMult: p.xMult, cardId: ctx.card.id }) }
    if (p.money) { ctx.helpers.addMoney(p.money); trig(ctx, { money: p.money, cardId: ctx.card.id }) }
  },
  handContainsBonus(ctx, p) {
    if (ctx.phase !== 'jokerScore' || !handContains(ctx, p.hand)) return
    if (p.chips) addC(ctx, p.chips)
    if (p.mult) addM(ctx, p.mult)
    if (p.xMult) mulM(ctx, p.xMult)
  },
  playedSizeBonus(ctx, p) {
    if (ctx.phase === 'jokerScore' && ctx.played.length <= p.maxSize) addM(ctx, p.mult)
  },
  rankScoredBonus(ctx, p) {
    if (ctx.phase !== 'scoredCard') return
    if (ctx.card.enhancement === 'stone' || !p.ranks.includes(ctx.card.rank)) return
    if (p.chips) { ctx.score.chips += p.chips; trig(ctx, { chips: p.chips, cardId: ctx.card.id }) }
    if (p.mult) { ctx.score.mult += p.mult; trig(ctx, { mult: p.mult, cardId: ctx.card.id }) }
  },
  faceScoredBonus(ctx, p) {
    if (ctx.phase !== 'scoredCard') return
    if (!isFace(ctx.card) && !ctx.run.modifiers?.allFace) return
    if (p.chips) { ctx.score.chips += p.chips; trig(ctx, { chips: p.chips, cardId: ctx.card.id }) }
    if (p.mult) { ctx.score.mult += p.mult; trig(ctx, { mult: p.mult, cardId: ctx.card.id }) }
  },
  ruleMod() {}, // 被动规则：由 run.modifiers 读取，此处不触发

  // ---- 独立条件加成 ----
  banner(ctx, p) { if (ctx.phase === 'jokerScore') { const n = p.chipsPer * ctx.round.discardsLeft; if (n) addC(ctx, n) } },
  mysticSummit(ctx, p) { if (ctx.phase === 'jokerScore' && ctx.round.discardsLeft === 0) addM(ctx, p.mult) },
  misprint(ctx, p) { if (ctx.phase === 'jokerScore') addM(ctx, ctx.rng.int(0, p.max)) },
  raisedFist(ctx) {
    if (ctx.phase !== 'jokerScore') return
    const held = ctx.held.filter(c => c.enhancement !== 'stone')
    if (!held.length) return
    const lowest = held.reduce((a, b) => (a.rank <= b.rank ? a : b))
    addM(ctx, Math.min(lowest.rank, 10) * 2)
  },
  abstractJoker(ctx, p) { if (ctx.phase === 'jokerScore') addM(ctx, p.multPer * ctx.run.jokers.length) },
  supernova(ctx) { if (ctx.phase === 'jokerScore') { const n = ctx.run.stats.handsPlayed[ctx.hand.handType] || 0; if (n) addM(ctx, n) } },
  blueJoker(ctx, p) { if (ctx.phase === 'jokerScore') addC(ctx, p.chipsPer * ctx.round.drawPile.length) },
  fortuneTeller(ctx, p) { if (ctx.phase === 'jokerScore') { const n = ctx.run.stats.tarotsUsed * p.multPer; if (n) addM(ctx, n) } },
  erosion(ctx, p) { if (ctx.phase === 'jokerScore') { const n = (ctx.run.fullDeckStart - ctx.helpers.fullDeckCount()) * p.multPer; if (n > 0) addM(ctx, n) } },
  bull(ctx, p) { if (ctx.phase === 'jokerScore') { const n = Math.max(0, ctx.run.money) * p.chipsPer; if (n) addC(ctx, n) } },
  bootstraps(ctx, p) { if (ctx.phase === 'jokerScore') { const n = Math.floor(Math.max(0, ctx.run.money) / p.per) * p.multPer; if (n) addM(ctx, n) } },
  swashbuckler(ctx) {
    if (ctx.phase !== 'jokerScore') return
    const v = ctx.run.jokers.filter(j => j.uid !== ctx.joker.uid).reduce((s, j) => s + ctx.helpers.sellValue(j), 0)
    addM(ctx, Math.max(1, v))
  },
  steelJoker(ctx, p) { if (ctx.phase === 'jokerScore') { const n = ctx.helpers.countInFullDeck(c => c.enhancement === 'steel'); if (n) mulM(ctx, round2(1 + n * p.xMultPer)) } },
  stoneJoker(ctx, p) { if (ctx.phase === 'jokerScore') { const n = ctx.helpers.countInFullDeck(c => c.enhancement === 'stone'); if (n) addC(ctx, n * p.chipsPer) } },
  blackboard(ctx, p) {
    if (ctx.phase !== 'jokerScore') return
    const ok = ctx.held.every(c => c.enhancement === 'stone' || suitIs(c, 'spades') || suitIs(c, 'clubs'))
    if (ok) mulM(ctx, p.xMult)
  },
  flowerPot(ctx, p) {
    if (ctx.phase !== 'jokerScore') return
    const scored = ctx.scored.filter(c => c.enhancement !== 'stone')
    const ok = ['diamonds', 'clubs', 'hearts', 'spades'].every(s => scored.some(c => suitIs(c, s)))
    if (ok) mulM(ctx, p.xMult)
  },
  seeingDouble(ctx, p) {
    if (ctx.phase !== 'jokerScore') return
    const scored = ctx.scored.filter(c => c.enhancement !== 'stone')
    const hasClub = scored.some(c => suitIs(c, 'clubs'))
    const hasOther = scored.some(c => suitIs(c, 'spades') || suitIs(c, 'hearts') || suitIs(c, 'diamonds'))
    if (hasClub && hasOther) mulM(ctx, p.xMult)
  },
  driversLicense(ctx, p) { if (ctx.phase === 'jokerScore' && ctx.helpers.countInFullDeck(c => !!c.enhancement) >= p.count) mulM(ctx, p.xMult) },
  cardSharp(ctx, p) { if (ctx.phase === 'jokerScore' && ctx.round.handTypesPlayed.filter(t => t === ctx.hand.handType).length >= 1) mulM(ctx, p.xMult) },
  acrobat(ctx, p) { if (ctx.phase === 'jokerScore' && ctx.round.handsLeft === 0) mulM(ctx, p.xMult) },
  loyaltyCard(ctx, p) {
    if (ctx.phase === 'jokerScore' && (ctx.run.stats.handsPlayedTotal + 1) % p.every === 0) mulM(ctx, p.xMult)
  },

  // ---- 成长型（状态存 joker.state） ----
  runner(ctx, p) {
    if (ctx.phase === 'jokerScore') {
      if (handContains(ctx, 'straight')) ctx.joker.state.chips = (ctx.joker.state.chips || 0) + p.chipsPer
      const n = ctx.joker.state.chips || 0; if (n) addC(ctx, n)
    }
  },
  iceCream(ctx, p) {
    if (ctx.phase === 'jokerScore') {
      const n = (ctx.joker.state.chips ?? p.chips) - (ctx.joker.state.decayed || 0)
      if (n > 0) addC(ctx, n)
      ctx.joker.state.decayed = (ctx.joker.state.decayed || 0) + p.decay
    }
  },
  greenJoker(ctx) {
    if (ctx.phase === 'jokerScore') { const n = ctx.joker.state.mult || 0; if (n) addM(ctx, n) }
    else if (ctx.phase === 'handPlayed') ctx.joker.state.mult = (ctx.joker.state.mult || 0) + 1
    else if (ctx.phase === 'discard') ctx.joker.state.mult = (ctx.joker.state.mult || 0) - 1
  },
  rideTheBus(ctx) {
    if (ctx.phase !== 'jokerScore') return
    const hasFace = ctx.scored.some(c => isFace(c))
    if (hasFace) ctx.joker.state.mult = 0
    else ctx.joker.state.mult = (ctx.joker.state.mult || 0) + 1
    const n = ctx.joker.state.mult || 0; if (n) addM(ctx, n)
  },
  squareJoker(ctx, p) {
    if (ctx.phase === 'jokerScore') {
      if (ctx.played.length === 4) ctx.joker.state.chips = (ctx.joker.state.chips || 0) + p.chipsPer
      const n = ctx.joker.state.chips || 0; if (n) addC(ctx, n)
    }
  },
  spareTrousers(ctx, p) {
    if (ctx.phase === 'jokerScore') {
      if (handContains(ctx, 'two_pair')) ctx.joker.state.mult = (ctx.joker.state.mult || 0) + p.multPer
      const n = ctx.joker.state.mult || 0; if (n) addM(ctx, n)
    }
  },
  redCard(ctx, p) { if (ctx.phase === 'jokerScore') { const n = ctx.joker.state.mult || 0; if (n) addM(ctx, n) } },
  weeJoker(ctx, p) {
    if (ctx.phase === 'scoredCard' && ctx.card.rank === 2) {
      ctx.joker.state.chips = (ctx.joker.state.chips || 0) + p.chipsPer
      trig(ctx, { text: `+${p.chipsPer} (成长)`, cardId: ctx.card.id })
    } else if (ctx.phase === 'jokerScore') { const n = ctx.joker.state.chips || 0; if (n) addC(ctx, n) }
  },
  castle(ctx, p) {
    if (ctx.phase === 'discard') {
      const suit = ctx.joker.state.suit
      const n = ctx.discarded.filter(c => suitIs(c, suit)).length
      if (n) { ctx.joker.state.chips = (ctx.joker.state.chips || 0) + n * p.chipsPer; trig(ctx, { text: `+${n * p.chipsPer} (成长)` }) }
    } else if (ctx.phase === 'jokerScore') { const n = ctx.joker.state.chips || 0; if (n) addC(ctx, n) }
  },
  vampire(ctx, p) {
    if (ctx.phase === 'scoredCard' && ctx.card.enhancement && !ctx.card.debuffed) {
      ctx.card.enhancement = null
      ctx.joker.state.xMult = round2((ctx.joker.state.xMult || 1) + p.xMultPer)
      trig(ctx, { text: `×${p.xMultPer} (成长)`, cardId: ctx.card.id })
    } else if (ctx.phase === 'jokerScore') { const x = ctx.joker.state.xMult || 1; if (x !== 1) mulM(ctx, x) }
  },
  constellation(ctx, p) {
    if (ctx.phase === 'consumableUsed' && ctx.consumableType === 'planet') {
      ctx.joker.state.xMult = round2((ctx.joker.state.xMult || 1) + p.xMultPer)
      trig(ctx, { text: `×${p.xMultPer} (成长)` })
    } else if (ctx.phase === 'jokerScore') { const x = ctx.joker.state.xMult || 1; if (x !== 1) mulM(ctx, x) }
  },
  hologram(ctx, p) {
    if (ctx.phase === 'cardAdded') {
      ctx.joker.state.xMult = round2((ctx.joker.state.xMult || 1) + p.xMultPer)
    } else if (ctx.phase === 'jokerScore') { const x = ctx.joker.state.xMult || 1; if (x !== 1) mulM(ctx, x) }
  },
  luckyCat(ctx, p) {
    if (ctx.phase === 'jokerScore') { const x = ctx.joker.state.xMult || 1; if (x !== 1) mulM(ctx, x) }
  },
  glassJoker(ctx, p) {
    if (ctx.phase === 'glassDestroyed') {
      ctx.joker.state.xMult = round2((ctx.joker.state.xMult || 1) + p.xMultPer)
      trig(ctx, { text: `×${p.xMultPer} (成长)` })
    } else if (ctx.phase === 'jokerScore') { const x = ctx.joker.state.xMult || 1; if (x !== 1) mulM(ctx, x) }
  },
  campfire(ctx, p) {
    if (ctx.phase === 'cardSold') ctx.joker.state.xMult = round2((ctx.joker.state.xMult || 1) + p.xMultPer)
    else if (ctx.phase === 'blindDefeated' && ctx.blindType === 'boss') ctx.joker.state.xMult = 1
    else if (ctx.phase === 'jokerScore') { const x = ctx.joker.state.xMult || 1; if (x !== 1) mulM(ctx, x) }
  },
  flashCard(ctx, p) {
    if (ctx.phase === 'reroll') ctx.joker.state.mult = (ctx.joker.state.mult || 0) + p.multPer
    else if (ctx.phase === 'jokerScore') { const n = ctx.joker.state.mult || 0; if (n) addM(ctx, n) }
  },
  throwback(ctx, p) { if (ctx.phase === 'jokerScore') { const x = round2(1 + (ctx.run.stats.blindsSkipped || 0) * p.xMultPer); if (x !== 1) mulM(ctx, x) } },
  obelisk(ctx, p) {
    if (ctx.phase !== 'jokerScore') return
    const mostPlayed = ctx.helpers.mostPlayedHand()
    if (ctx.hand.handType === mostPlayed) ctx.joker.state.xMult = 1
    else ctx.joker.state.xMult = round2((ctx.joker.state.xMult || 1) + p.xMultPer)
    const x = ctx.joker.state.xMult || 1; if (x !== 1) mulM(ctx, x)
  },
  hitTheRoad(ctx, p) {
    if (ctx.phase === 'jokerScore') { const x = ctx.joker.state.xMult || 1; if (x !== 1) mulM(ctx, x) }
  },
  madness(ctx, p) {
    if (ctx.phase === 'blindSelect' && (ctx.blindType === 'small' || ctx.blindType === 'big')) {
      ctx.joker.state.xMult = round2((ctx.joker.state.xMult || 1) + p.xMultPer)
      const others = ctx.run.jokers.filter(j => j.uid !== ctx.joker.uid && !j.debuffed)
      if (others.length) ctx.helpers.destroyJoker(ctx.rng.pick(others).uid)
      trig(ctx, { text: `×${p.xMultPer} (成长)` })
    } else if (ctx.phase === 'jokerScore') { const x = ctx.joker.state.xMult || 1; if (x !== 1) mulM(ctx, x) }
  },
  ramen(ctx, p) {
    if (ctx.phase === 'discard') ctx.joker.state.xMult = round2(Math.max(1, (ctx.joker.state.xMult ?? p.xMult) - p.decay * ctx.discarded.length))
    else if (ctx.phase === 'jokerScore') { const x = ctx.joker.state.xMult ?? p.xMult; if (x !== 1) mulM(ctx, x) }
  },
  ancientJoker(ctx, p) {
    if (ctx.phase === 'scoredCard' && ctx.card.enhancement !== 'stone' && suitIs(ctx.card, ctx.joker.state.suit)) {
      ctx.score.mult = round2(ctx.score.mult * p.xMult); trig(ctx, { xMult: p.xMult, cardId: ctx.card.id })
    }
  },
  theIdol(ctx, p) {
    if (ctx.phase === 'scoredCard' && ctx.card.enhancement !== 'stone' &&
        ctx.card.rank === ctx.joker.state.rank && ctx.card.suit === ctx.joker.state.suit) {
      ctx.score.mult = round2(ctx.score.mult * p.xMult); trig(ctx, { xMult: p.xMult, cardId: ctx.card.id })
    }
  },
  triboulet(ctx, p) {
    if (ctx.phase === 'scoredCard' && (ctx.card.rank === 13 || ctx.card.rank === 12)) {
      ctx.score.mult = round2(ctx.score.mult * p.xMult); trig(ctx, { xMult: p.xMult, cardId: ctx.card.id })
    }
  },
  canio(ctx, p) {
    if (ctx.phase === 'jokerScore') { const x = ctx.joker.state.xMult || 1; if (x !== 1) mulM(ctx, x) }
  },
  yorick(ctx, p) {
    if (ctx.phase === 'jokerScore') { const x = ctx.joker.state.xMult || 1; if (x !== 1) mulM(ctx, x) }
  },
  baseballCard(ctx, p) {
    if (ctx.phase !== 'jokerScore') return
    const n = ctx.run.jokers.filter(j => JOKERS_BY_ID[j.id].rarity === 2).length
    for (let i = 0; i < n; i++) mulM(ctx, p.xMult)
  },
  stencil(ctx) {
    if (ctx.phase !== 'jokerScore') return
    const empty = ctx.helpers.jokerSlotCount() - ctx.run.jokers.length
    const x = Math.max(1, empty + 1) // 含自身
    if (x !== 1) mulM(ctx, x)
  },
  cavendish(ctx, p) {
    if (ctx.phase === 'jokerScore') mulM(ctx, p.xMult)
    else if (ctx.phase === 'roundEnd' && ctx.rng.chance(1, p.chance)) ctx.helpers.destroyJoker(ctx.joker.uid)
  },
  grosMichel(ctx, p) {
    if (ctx.phase === 'jokerScore') addM(ctx, p.mult)
    else if (ctx.phase === 'roundEnd' && ctx.rng.chance(1, p.chance)) ctx.helpers.destroyJoker(ctx.joker.uid)
  },
  popcorn(ctx, p) {
    if (ctx.phase === 'jokerScore') { const n = (ctx.joker.state.mult ?? p.mult); if (n) addM(ctx, n) }
    else if (ctx.phase === 'roundEnd') ctx.joker.state.mult = (ctx.joker.state.mult ?? p.mult) - p.decay
  },

  // ---- 打出/计分触发的特效 ----
  eightBall(ctx, p) {
    if (ctx.phase === 'scoredCard' && ctx.card.rank === 8 && prob(ctx, p.chance)) {
      if (ctx.helpers.createTarot()) trig(ctx, { text: '+塔罗', cardId: ctx.card.id })
    }
  },
  businessCard(ctx, p) {
    if (ctx.phase === 'scoredCard' && (isFace(ctx.card) || ctx.run.modifiers?.allFace) && prob(ctx, p.chance)) {
      ctx.helpers.addMoney(p.money); trig(ctx, { money: p.money, cardId: ctx.card.id })
    }
  },
  goldenTicket(ctx, p) {
    if (ctx.phase === 'scoredCard' && ctx.card.enhancement === 'gold') {
      ctx.helpers.addMoney(p.money); trig(ctx, { money: p.money, cardId: ctx.card.id })
    }
  },
  hiker(ctx, p) {
    if (ctx.phase === 'scoredCard') {
      ctx.card.bonusChips = (ctx.card.bonusChips || 0) + p.chipsAdd
      trig(ctx, { text: `+${p.chipsAdd} (永久)`, cardId: ctx.card.id })
    }
  },
  photograph(ctx, p) {
    if (ctx.phase === 'scoredCard' && isFace(ctx.card) && !ctx.round.photoUsed) {
      ctx.round.photoUsed = true
      ctx.score.mult = round2(ctx.score.mult * p.xMult); trig(ctx, { xMult: p.xMult, cardId: ctx.card.id })
    }
  },
  midasMask(ctx) {
    if (ctx.phase === 'scoredCard' && isFace(ctx.card)) {
      ctx.card.enhancement = 'gold'
      trig(ctx, { text: '黄金化', cardId: ctx.card.id })
    }
  },
  reservedParking(ctx, p) {
    if (ctx.phase === 'heldCard' && isFace(ctx.card) && prob(ctx, p.chance)) {
      ctx.helpers.addMoney(p.money); trig(ctx, { money: p.money, cardId: ctx.card.id })
    }
  },
  baron(ctx, p) {
    if (ctx.phase === 'heldCard' && ctx.card.rank === 13) {
      ctx.score.mult = round2(ctx.score.mult * p.xMult); trig(ctx, { xMult: p.xMult, cardId: ctx.card.id })
    }
  },
  shootTheMoon(ctx, p) {
    if (ctx.phase === 'heldCard' && ctx.card.rank === 12) {
      ctx.score.mult += p.mult; trig(ctx, { mult: p.mult, cardId: ctx.card.id })
    }
  },
  spaceJoker(ctx, p) {
    if (ctx.phase === 'handPlayed' && prob(ctx, p.chance)) {
      ctx.helpers.levelUpHand(ctx.hand.handType, 1)
      trig(ctx, { text: '升级!' })
    }
  },
  dna(ctx) {
    if (ctx.phase === 'handPlayed' && ctx.round.handsPlayedThisRound === 0 && ctx.played.length === 1) {
      const copy = ctx.helpers.copyCardToDeck(ctx.played[0], true)
      if (copy) trig(ctx, { text: '复制!' })
    }
  },
  sixthSense(ctx) {
    if (ctx.phase === 'handPlayed' && ctx.round.handsPlayedThisRound === 0 &&
        ctx.played.length === 1 && ctx.played[0].rank === 6) {
      ctx.helpers.destroyCard(ctx.played[0].id)
      if (ctx.helpers.createSpectral()) trig(ctx, { text: '+幻灵' })
    }
  },
  superposition(ctx) {
    if (ctx.phase === 'jokerScore') {
      const hasAce = ctx.played.some(c => c.rank === 14)
      if (hasAce && handContains(ctx, 'straight') && ctx.helpers.createTarot()) trig(ctx, { text: '+塔罗' })
    }
  },
  seance(ctx) {
    if (ctx.phase === 'jokerScore' && ctx.hand.handType === 'straight_flush' && ctx.helpers.createSpectral()) trig(ctx, { text: '+幻灵' })
  },
  vagabond(ctx, p) {
    if (ctx.phase === 'jokerScore' && ctx.run.money <= p.maxMoney && ctx.helpers.createTarot()) trig(ctx, { text: '+塔罗' })
  },
  matador(ctx, p) {
    if (ctx.phase === 'jokerScore' && ctx.round.bossTriggeredThisHand) {
      ctx.helpers.addMoney(p.money); trig(ctx, { money: p.money })
    }
  },

  // ---- 弃牌触发 ----
  facelessJoker(ctx, p) {
    if (ctx.phase === 'discard' && faceCards(ctx.discarded).length >= p.count) {
      ctx.helpers.addMoney(p.money); trig(ctx, { money: p.money })
    }
  },
  mailInRebate(ctx, p) {
    if (ctx.phase === 'discard') {
      const n = ctx.discarded.filter(c => c.rank === ctx.joker.state.rank).length
      if (n) { ctx.helpers.addMoney(n * p.money); trig(ctx, { money: n * p.money }) }
    }
  },
  tradingCard(ctx, p) {
    if (ctx.phase === 'discard' && ctx.round.firstDiscard && ctx.discarded.length === 1) {
      ctx.helpers.destroyCard(ctx.discarded[0].id)
      ctx.helpers.addMoney(p.money); trig(ctx, { money: p.money })
    }
  },
  burntJoker(ctx) {
    if (ctx.phase === 'discard' && ctx.round.firstDiscard) {
      const r = ctx.helpers.evaluateCards(ctx.discarded)
      ctx.helpers.levelUpHand(r.handType, 1)
      trig(ctx, { text: '升级!' })
    }
  },

  // ---- 盲注选择/回合开始 ----
  riffRaff(ctx, p) {
    if (ctx.phase === 'blindSelect') {
      for (let i = 0; i < p.count; i++) if (!ctx.helpers.createJoker({ rarity: 1 })) break
      trig(ctx, { text: '+小丑' })
    }
  },
  cartomancer(ctx) {
    if (ctx.phase === 'blindSelect' && ctx.helpers.createTarot()) trig(ctx, { text: '+塔罗' })
  },
  marbleJoker(ctx) {
    if (ctx.phase === 'blindSelect') { ctx.helpers.addCardToDeck({ enhancement: 'stone' }); trig(ctx, { text: '+石头牌' }) }
  },
  burglar(ctx, p) {
    if (ctx.phase === 'blindSelect') {
      ctx.round.handsLeft += p.hands
      ctx.round.discardsLeft = 0
      trig(ctx, { text: `+${p.hands} 出牌` })
    }
  },
  ceremonialDagger(ctx) {
    if (ctx.phase !== 'blindSelect') return
    const idx = ctx.run.jokers.findIndex(j => j.uid === ctx.joker.uid)
    const right = ctx.run.jokers[idx + 1]
    if (right) {
      const v = ctx.helpers.sellValue(right) * 2
      ctx.helpers.destroyJoker(right.uid)
      ctx.joker.state.mult = (ctx.joker.state.mult || 0) + v
      trig(ctx, { text: `+${v} (成长)` })
    }
  },
  certificate(ctx) {
    if (ctx.phase === 'roundStart') { ctx.helpers.addRandomSealedCardToHand(); trig(ctx, { text: '+牌' }) }
  },

  // ---- 经济（回合结束） ----
  goldenJoker(ctx, p) { if (ctx.phase === 'roundEnd') { ctx.helpers.addMoney(p.money); trig(ctx, { money: p.money }) } },
  delayedGratification(ctx, p) {
    if (ctx.phase === 'roundEnd' && ctx.round.discardsUsed === 0 && ctx.round.discardsLeft > 0) {
      const n = ctx.round.discardsLeft * p.moneyPer
      ctx.helpers.addMoney(n); trig(ctx, { money: n })
    }
  },
  cloudNine(ctx, p) {
    if (ctx.phase === 'roundEnd') {
      const n = ctx.helpers.countInFullDeck(c => c.rank === 9) * p.moneyPer
      if (n) { ctx.helpers.addMoney(n); trig(ctx, { money: n }) }
    }
  },
  rocket(ctx, p) {
    if (ctx.phase === 'roundEnd') { const n = ctx.joker.state.payout ?? p.moneyStart; ctx.helpers.addMoney(n); trig(ctx, { money: n }) }
    else if (ctx.phase === 'blindDefeated' && ctx.blindType === 'boss') ctx.joker.state.payout = (ctx.joker.state.payout ?? p.moneyStart) + p.moneyPer
  },
  satellite(ctx, p) {
    if (ctx.phase === 'roundEnd') {
      const n = ctx.run.stats.planetsUsedUnique.size ? ctx.run.stats.planetsUsedUnique.size * p.moneyPer : Object.keys(ctx.run.stats.planetsUsedUnique).length * p.moneyPer
      if (n) { ctx.helpers.addMoney(n); trig(ctx, { money: n }) }
    }
  },
  toTheMoon(ctx, p) {
    if (ctx.phase === 'roundEnd') {
      const n = Math.floor(Math.max(0, ctx.run.money) / p.per) * p.money
      if (n) { ctx.helpers.addMoney(n); trig(ctx, { money: n }) }
    }
  },
  egg(ctx, p) { if (ctx.phase === 'roundEnd') { ctx.joker.sellBonus = (ctx.joker.sellBonus || 0) + p.sellAdd; trig(ctx, { text: `+$${p.sellAdd} 价值` }) } },
  giftCard(ctx, p) {
    if (ctx.phase === 'roundEnd') {
      for (const j of ctx.run.jokers) j.sellBonus = (j.sellBonus || 0) + p.sellAdd
      for (const c of ctx.run.consumables) c.sellBonus = (c.sellBonus || 0) + p.sellAdd
      trig(ctx, { text: `+$${p.sellAdd} 价值` })
    }
  },

  toDoList(ctx, p) {
    if (ctx.phase === 'jokerScore' && ctx.hand.handType === ctx.joker.state.hand) {
      ctx.helpers.addMoney(p.money); trig(ctx, { money: p.money })
    }
  },

  // ---- 被动栏位/次数（数值在 roundSetup 汇总，此处仅占位触发态） ----
  juggler() {}, drunkard() {}, turtleBean() {}, merryAndy() {}, stuntman(ctx, p) {
    if (ctx.phase === 'jokerScore') addC(ctx, p.chips)
  }, troubadour() {},

  // ---- 商店/卡包/卖出 ----
  hallucination(ctx, p) {
    if (ctx.phase === 'packOpened' && prob(ctx, p.chance) && ctx.helpers.createTarot()) trig(ctx, { text: '+塔罗' })
  },
  luchador(ctx) { if (ctx.phase === 'sell') { ctx.helpers.disableBoss(); trig(ctx, { text: 'Boss 已禁用' }) } },
  dietCola(ctx) { if (ctx.phase === 'sell') { ctx.helpers.addTag('tag_double'); trig(ctx, { text: '+双倍标签' }) } },
  invisibleJoker(ctx, p) {
    if (ctx.phase === 'roundEnd') ctx.joker.state.rounds = (ctx.joker.state.rounds || 0) + 1
    else if (ctx.phase === 'sell' && (ctx.joker.state.rounds || 0) >= p.rounds) {
      const others = ctx.run.jokers.filter(j => j.uid !== ctx.joker.uid)
      if (others.length && ctx.helpers.jokerSlotCount() > ctx.run.jokers.length - 1) {
        const src = ctx.rng.pick(others)
        ctx.helpers.createJoker({ id: src.id, edition: src.edition === 'negative' ? null : src.edition })
        trig(ctx, { text: '复制!' })
      }
    }
  },
  perkeo(ctx) {
    if (ctx.phase === 'shopEnd' && ctx.run.consumables.length) {
      const src = ctx.rng.pick(ctx.run.consumables)
      ctx.helpers.createConsumable(src.id, 'negative')
      trig(ctx, { text: '负片复制!' })
    }
  },
  mrBones() {}, // 死亡保护在 run.js 失败判定时处理
  chicot() {},  // Boss 禁用在 run.js 选择 Boss 时处理
  mime() {},    // 重触发在 RETRIGGERS 中处理
  hack() {}, dusk() {}, sockAndBuskin() {}, hangingChad() {}, seltzer() {},
  copyRight() {}, copyLeftRight() {}, // 由 jokerHandlerFor 解析
}

// ============================================================
// 重触发表：返回对 ctx.card 的额外触发次数
// kind: 'played'（打出的计分牌） | 'held'（手牌持有效果）
// ============================================================
export const RETRIGGERS = {
  hack: { kind: 'played', count: (ctx, p) => (ctx.card.enhancement !== 'stone' && p.ranks.includes(ctx.card.rank)) ? 1 : 0 },
  dusk: { kind: 'played', count: (ctx) => (ctx.round.handsLeft === 0 ? 1 : 0) },
  sockAndBuskin: { kind: 'played', count: (ctx) => isFace(ctx.card) ? 1 : 0 },
  hangingChad: { kind: 'played', count: (ctx, p) => ctx.card.id === ctx.scored[0]?.id ? p.times : 0 },
  seltzer: { kind: 'played', count: (ctx) => (ctx.joker.state.handsLeft ?? 10) > 0 ? 1 : 0 },
  mime: { kind: 'held', count: () => 1 },
}

// 计算某张牌的总触发次数（1 + 小丑重触发 + 红蜡封）
export function triggerCountFor(card, jokers, ctxBase, kind) {
  let extra = 0
  for (const j of jokers) {
    if (j.debuffed) continue
    const resolved = jokerHandlerFor(j, jokers)
    if (!resolved) continue
    const key = resolved.def.effect.handler
    const rt = RETRIGGERS[key]
    if (!rt || rt.kind !== kind) continue
    const n = rt.count({ ...ctxBase, card, joker: resolved.joker }, resolved.def.effect.params || {})
    if (n) extra += n
  }
  if (card.seal === 'red') extra += 1
  return 1 + extra
}

// 初始 state
export function initialJokerState(def) {
  const s = {}
  const p = def.effect?.params || {}
  if (p.xMult !== undefined) s.xMult = p.xMult
  if (def.id === 'j_seltzer') s.handsLeft = p.hands
  return s
}
