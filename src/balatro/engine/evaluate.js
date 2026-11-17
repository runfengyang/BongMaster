// 牌型判定（含 Four Fingers / Shortcut / Smeared / Splash 修正钩子）
// evaluate(playedCards, modifiers) → { handType, scoringIds, royal }
// modifiers: { fourFingers, shortcut, smeared, splash }

const FLUSH_SUITS = ['spades', 'hearts', 'diamonds', 'clubs']

function suitGroups(cards, smeared) {
  // 返回 { groupKey: [cards] }，万能牌计入所有组；石头牌不参与
  const groups = {}
  const keys = smeared ? ['red', 'black'] : FLUSH_SUITS
  for (const k of keys) groups[k] = []
  for (const c of cards) {
    if (c.enhancement === 'stone') continue
    const wild = c.enhancement === 'wild'
    if (smeared) {
      const g = (c.suit === 'hearts' || c.suit === 'diamonds') ? 'red' : 'black'
      if (wild) { groups.red.push(c); groups.black.push(c) } else groups[g].push(c)
    } else {
      if (wild) for (const k of keys) groups[k].push(c)
      else groups[c.suit].push(c)
    }
  }
  return groups
}

function bestFlush(groups, need) {
  let best = null
  for (const [k, arr] of Object.entries(groups)) {
    if (arr.length >= need && (!best || arr.length > best.cards.length)) best = { suit: k, cards: arr.slice(0, Math.max(need, arr.length)) }
  }
  return best // {suit, cards} 取该花色全部（≤5 张打出牌）
}

function findStraightRanks(cards, need, allowGap) {
  // 返回组成顺子的点数数组（A 可为 14 或 1），或 null
  const rankSet = new Set()
  for (const c of cards) {
    if (c.enhancement === 'stone') continue
    rankSet.add(c.rank)
  }
  const ranks = [...rankSet]
  if (rankSet.has(14)) ranks.push(1) // A 低位
  ranks.sort((a, b) => b - a)
  for (let i = 0; i < ranks.length; i++) {
    const seq = [ranks[i]]
    for (let j = i + 1; j < ranks.length && seq.length < need; j++) {
      const diff = seq[seq.length - 1] - ranks[j]
      if (diff >= 1 && (allowGap ? diff <= 2 : diff === 1)) seq.push(ranks[j])
    }
    if (seq.length === need) return seq
  }
  return null
}

function cardsForRanks(cards, seqRanks, suitFilter = null) {
  // 为每个点数挑一张牌（可选限定花色组），返回选中的牌
  const used = new Set()
  const out = []
  for (const r of seqRanks) {
    const target = r === 1 ? 14 : r
    const c = cards.find(x =>
      !used.has(x.id) && x.enhancement !== 'stone' && x.rank === target &&
      (!suitFilter || suitFilter(x)))
    if (c) { used.add(c.id); out.push(c) }
  }
  return out
}

export function evaluate(played, modifiers = {}) {
  const { fourFingers = false, shortcut = false, smeared = false, splash = false } = modifiers
  const cards = played
  const n = cards.length
  const groups = suitGroups(cards, smeared)
  const flushNeed = fourFingers ? 4 : 5
  const straightNeed = fourFingers ? 4 : 5
  const flush = n >= flushNeed ? bestFlush(groups, flushNeed) : null

  // 点数统计（石头牌不参与）
  const rankCounts = new Map()
  for (const c of cards) {
    if (c.enhancement === 'stone') continue
    rankCounts.set(c.rank, (rankCounts.get(c.rank) || 0) + 1)
  }
  const countGroups = new Map() // count → [ranks]
  for (const [r, cnt] of rankCounts) {
    if (!countGroups.has(cnt)) countGroups.set(cnt, [])
    countGroups.get(cnt).push(r)
  }
  const has = cnt => countGroups.has(cnt)

  const straightRanks = n >= straightNeed ? findStraightRanks(cards, straightNeed, shortcut) : null

  let handType = 'high_card'
  let scoringIds = []
  let royal = false

  const sameSuitAll5 = gs => Object.values(gs).some(arr => arr.length >= 5)

  if (has(5)) {
    // 五条 / 同花五条
    const r = countGroups.get(5)[0]
    const five = cards.filter(c => c.rank === r)
    if (sameSuitAll5(suitGroups(five, smeared))) {
      handType = 'flush_five'; scoringIds = five.map(c => c.id)
    } else {
      handType = 'five_of_a_kind'; scoringIds = five.map(c => c.id)
    }
  } else if (has(3) && has(2)) {
    // 葫芦 / 同花葫芦
    const r3 = countGroups.get(3)[0]
    const r2 = countGroups.get(2)[0]
    const fh = cards.filter(c => c.rank === r3 || c.rank === r2)
    if (fh.length === 5 && sameSuitAll5(suitGroups(fh, smeared))) handType = 'flush_house'
    else handType = 'full_house'
    scoringIds = fh.map(c => c.id)
  } else if (has(4)) {
    handType = 'four_of_a_kind'
    const r = countGroups.get(4)[0]
    scoringIds = cards.filter(c => c.rank === r).map(c => c.id)
  } else if (straightRanks && flush) {
    // 同花顺（含皇家）：尝试在某个花色组内找顺子
    let sfCards = null
    for (const arr of Object.values(groups)) {
      if (arr.length >= Math.max(straightNeed, flushNeed)) {
        const seq = findStraightRanks(arr, straightNeed, shortcut)
        if (seq) {
          const suitCards = new Set(arr.map(c => c.id))
          const picked = cardsForRanks(arr, seq, c => suitCards.has(c.id))
          if (picked.length === seq.length) { sfCards = picked; break }
        }
      }
    }
    if (sfCards) {
      handType = 'straight_flush'
      scoringIds = sfCards.map(c => c.id)
      const rs = sfCards.map(c => c.rank)
      royal = [10, 11, 12, 13, 14].every(r => rs.includes(r))
    }
  }
  if (handType === 'high_card') {
    if (flush) {
      handType = 'flush'
      scoringIds = flush.cards.map(c => c.id)
    } else if (straightRanks) {
      handType = 'straight'
      scoringIds = cardsForRanks(cards, straightRanks).map(c => c.id)
    } else if (has(3)) {
      handType = 'three_of_a_kind'
      const r = countGroups.get(3)[0]
      scoringIds = cards.filter(c => c.rank === r).map(c => c.id)
    } else if (has(2) && countGroups.get(2).length >= 2) {
      handType = 'two_pair'
      const rs = countGroups.get(2).slice(0, 2)
      scoringIds = cards.filter(c => rs.includes(c.rank)).map(c => c.id)
    } else if (has(2)) {
      handType = 'pair'
      const r = countGroups.get(2)[0]
      scoringIds = cards.filter(c => c.rank === r).map(c => c.id)
    } else {
      // 高牌：最高点数一张
      const nonStone = cards.filter(c => c.enhancement !== 'stone')
      const top = nonStone.length ? nonStone.reduce((a, b) => (a.rank >= b.rank ? a : b)) : cards[0]
      scoringIds = top ? [top.id] : []
    }
  }

  // 石头牌总是参与计分；飞溅：所有打出牌计分
  const set = new Set(scoringIds)
  for (const c of cards) {
    if (c.enhancement === 'stone') set.add(c.id)
  }
  if (splash) for (const c of cards) set.add(c.id)
  scoringIds = cards.filter(c => set.has(c.id)).map(c => c.id) // 保持打出顺序

  return { handType, scoringIds, royal }
}
