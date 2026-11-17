// 消耗牌效果（塔罗 22 / 星球 12 / 幻灵 18）
// applyConsumable(ctx) ctx = { run, def, targets: [cardId...], zone: [可用目标牌], helpers, rng, emit }

import { ENHANCEMENTS_BY_ID } from '../data/enhancements.js'

const EDITION_ROLL = ['foil', 'holo', 'poly']

export function applyConsumable({ run, def, targets = [], zone = [], helpers, rng, emit }) {
  const p = def.effect?.params || {}
  const h = def.effect?.handler
  const pick = (arr, n) => rng.shuffle([...arr]).slice(0, n)
  const targetCards = targets.map(id => zone.find(c => c.id === id)).filter(Boolean)
  const needTargets = n => targetCards.length >= 1 // 至少选了 1 张（UI 限制上限）
  const events = []
  const push = e => { events.push(e); emit && emit(e) }

  switch (h) {
    case 'fool': {
      const last = run.stats.lastTarotOrPlanet
      if (last && last !== 'c_fool') helpers.createConsumable(last)
      break
    }
    case 'enhance': {
      for (const c of targetCards.slice(0, p.count)) { c.enhancement = p.enhancement; push({ type: 'cardEnhanced', cardId: c.id, enhancement: p.enhancement }) }
      break
    }
    case 'createPlanet': for (let i = 0; i < p.count; i++) if (!helpers.createPlanet()) break
      break
    case 'createTarot': for (let i = 0; i < p.count; i++) if (!helpers.createTarot()) break
      break
    case 'hermit': {
      const gain = Math.min(run.money, p.max)
      if (gain > 0) helpers.addMoney(gain)
      break
    }
    case 'wheelOfFortune': {
      if (rng.chance(1, 4)) {
        const base = run.jokers.filter(j => !j.edition)
        if (base.length) {
          const j = rng.pick(base)
          j.edition = rng.pick(EDITION_ROLL)
          push({ type: 'jokerEdition', uid: j.uid, edition: j.edition })
        }
      } else push({ type: 'nope' })
      break
    }
    case 'strength': {
      for (const c of targetCards.slice(0, p.count)) {
        if (c.rank < 14) { c.rank += 1; c.rankLabel = String(c.rank).replace('11', 'J').replace('12', 'Q').replace('13', 'K').replace('14', 'A') }
        push({ type: 'cardRankUp', cardId: c.id, rank: c.rank })
      }
      break
    }
    case 'destroyCards': {
      for (const c of targetCards.slice(0, p.count)) { helpers.destroyCard(c.id); push({ type: 'cardDestroyed', cardId: c.id }) }
      break
    }
    case 'death': {
      if (targetCards.length === 2) {
        const [left, right] = targetCards
        left.rank = right.rank; left.rankLabel = right.rankLabel; left.suit = right.suit
        left.enhancement = right.enhancement; left.edition = right.edition; left.seal = right.seal
        push({ type: 'cardConverted', cardId: left.id })
      }
      break
    }
    case 'temperance': {
      const v = Math.min(run.jokers.reduce((s, j) => s + helpers.sellValue(j), 0), p.max)
      if (v > 0) helpers.addMoney(v)
      break
    }
    case 'convertSuit': {
      for (const c of targetCards.slice(0, p.count)) { c.suit = p.suit; push({ type: 'cardSuit', cardId: c.id, suit: p.suit }) }
      break
    }
    case 'judgement': helpers.createJoker({})
      break

    // ---- 幻灵 ----
    case 'familiar': case 'grim': case 'incantation': {
      const counts = { familiar: { n: 3, kind: 'face' }, grim: { n: 2, kind: 'ace' }, incantation: { n: 4, kind: 'number' } }[h]
      if (zone.length) helpers.destroyCard(rng.pick(zone).id)
      const enhIds = Object.keys(ENHANCEMENTS_BY_ID)
      for (let i = 0; i < counts.n; i++) {
        let rank
        if (counts.kind === 'face') rank = rng.pick([11, 12, 13])
        else if (counts.kind === 'ace') rank = 14
        else rank = rng.int(2, 10)
        helpers.addCardToHand({ rank, enhancement: rng.pick(enhIds) })
      }
      break
    }
    case 'addSeal': {
      if (targetCards[0]) { targetCards[0].seal = p.seal; push({ type: 'cardSeal', cardId: targetCards[0].id, seal: p.seal }) }
      break
    }
    case 'aura': {
      if (targetCards[0]) { targetCards[0].edition = rng.pick(EDITION_ROLL); push({ type: 'cardEdition', cardId: targetCards[0].id, edition: targetCards[0].edition }) }
      break
    }
    case 'wraith': {
      helpers.createJoker({ rarity: 3 })
      run.money = 0
      break
    }
    case 'sigil': {
      const suit = rng.pick(['spades', 'hearts', 'diamonds', 'clubs'])
      for (const c of zone) c.suit = suit
      push({ type: 'allSuit', suit })
      break
    }
    case 'ouija': {
      const rank = rng.int(2, 14)
      for (const c of zone) { c.rank = rank; c.rankLabel = String(rank).replace('11', 'J').replace('12', 'Q').replace('13', 'K').replace('14', 'A') }
      run.handSizeMod = (run.handSizeMod || 0) - 1
      push({ type: 'allRank', rank })
      break
    }
    case 'ectoplasm': {
      if (run.jokers.length) {
        const j = rng.pick(run.jokers)
        j.edition = 'negative'
        run.handSizeMod = (run.handSizeMod || 0) - 1
        push({ type: 'jokerEdition', uid: j.uid, edition: 'negative' })
      }
      break
    }
    case 'immolate': {
      const victims = pick(zone, p.count)
      for (const c of victims) { helpers.destroyCard(c.id); push({ type: 'cardDestroyed', cardId: c.id }) }
      helpers.addMoney(p.money)
      break
    }
    case 'ankh': {
      if (run.jokers.length) {
        const src = rng.pick(run.jokers)
        const keep = { id: src.id, edition: src.edition === 'negative' ? null : src.edition }
        for (const j of [...run.jokers]) helpers.destroyJoker(j.uid)
        helpers.createJoker(keep)
        helpers.createJoker(keep)
      }
      break
    }
    case 'hex': {
      if (run.jokers.length) {
        const src = rng.pick(run.jokers)
        src.edition = 'poly'
        for (const j of [...run.jokers]) if (j.uid !== src.uid) helpers.destroyJoker(j.uid)
        push({ type: 'jokerEdition', uid: src.uid, edition: 'poly' })
      }
      break
    }
    case 'cryptid': {
      if (targetCards[0]) {
        for (let i = 0; i < p.count; i++) helpers.copyCardToDeck(targetCards[0], true)
      }
      break
    }
    case 'soul': {
      helpers.createJoker({ legendary: true })
      break
    }
    case 'blackHole': {
      for (const k of Object.keys(run.handLevels)) run.handLevels[k] += 1
      push({ type: 'allLevelUp' })
      break
    }
    default:
      throw new Error(`unknown consumable handler: ${h}`)
  }

  // 统计
  if (def.type === 'tarot') run.stats.tarotsUsed += 1
  if (def.type === 'planet') {
    if (!run.stats.planetsUsedUnique.includes) run.stats.planetsUsedUnique = []
    if (!run.stats.planetsUsedUnique.includes(def.id)) run.stats.planetsUsedUnique.push(def.id)
  }
  if (def.type === 'tarot' || def.type === 'planet') run.stats.lastTarotOrPlanet = def.id
  return events
}
