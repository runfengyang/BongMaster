// 扑克牌构建 / 洗牌 / 牌堆操作
// 牌形：{ id, rank(2-14, 11=J 12=Q 13=K 14=A), rankLabel, suit,
//   enhancement: null|'bonus'|'mult'|'wild'|'glass'|'steel'|'stone'|'gold'|'lucky',
//   edition: null|'foil'|'holo'|'poly'|'negative', seal: null|'red'|'blue'|'purple'|'gold',
//   bonusChips: 0(徒步者等永久加成), debuffed: false, faceDown: false }

export const SUITS = ['spades', 'hearts', 'diamonds', 'clubs']
export const SUIT_NAMES = { spades: '黑桃', hearts: '红桃', diamonds: '方片', clubs: '梅花' }
export const RANK_LABELS = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }

let _uid = 0
export function nextCardUid() { return `pc_${++_uid}_${Math.random().toString(36).slice(2, 8)}` }
export function resetCardUid(n = 0) { _uid = n }

export function makeCard(rank, suit, extra = {}) {
  return {
    id: extra.id || nextCardUid(),
    rank, rankLabel: RANK_LABELS[rank], suit,
    enhancement: null, edition: null, seal: null,
    bonusChips: 0, debuffed: false, faceDown: false,
    ...extra,
  }
}

// 标准 52 张
export function buildStandardDeck() {
  const cards = []
  for (const suit of SUITS) for (let r = 2; r <= 14; r++) cards.push(makeCard(r, suit))
  return cards
}

// 按牌组效果构建初始牌堆
export function buildDeckFor(deckEffect = {}, rng) {
  if (deckEffect.erratic) {
    // 错乱牌组：52 张，点数花色全随机
    const cards = []
    for (let i = 0; i < 52; i++) cards.push(makeCard(rng.int(2, 14), rng.pick(SUITS)))
    return cards
  }
  if (deckEffect.checkered) {
    const cards = []
    for (let i = 0; i < 2; i++) {
      for (let r = 2; r <= 14; r++) cards.push(makeCard(r, 'spades'), makeCard(r, 'hearts'))
    }
    return cards
  }
  let cards = buildStandardDeck()
  if (deckEffect.noFace) cards = cards.filter(c => c.rank <= 10) // 遗弃牌组：40 张无人头牌
  return cards
}

export function isFace(card) { return card.rank >= 11 && card.rank <= 13 }

// 计分点数：A=11，人头=10，其余面值；石头牌固定 50（无点数）
export function cardChips(card) {
  if (card.enhancement === 'stone') return 50
  if (card.rank === 14) return 11
  if (card.rank >= 11) return 10
  return card.rank
}

// 有效花色（万能牌视为所有花色；污迹小丑合并在 evaluate 中处理）
export function suitIs(card, suit) {
  if (card.enhancement === 'stone') return false
  if (card.enhancement === 'wild') return true
  return card.suit === suit
}

export function sortCards(cards, by = 'rank') {
  const suitOrder = { spades: 0, hearts: 1, diamonds: 2, clubs: 3 }
  const arr = [...cards]
  if (by === 'rank') arr.sort((a, b) => b.rank - a.rank || suitOrder[a.suit] - suitOrder[b.suit])
  else arr.sort((a, b) => suitOrder[a.suit] - suitOrder[b.suit] || b.rank - a.rank)
  return arr
}

export function cloneCard(card, keepId = false) {
  return { ...card, id: keepId ? card.id : nextCardUid() }
}
