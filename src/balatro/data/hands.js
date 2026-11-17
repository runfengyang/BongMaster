// Balatro 牌型数据 —— 12 种牌型
// 数据来源：balatrowiki.org/Poker_Hands（已核对官方数值）
// chips/mult = Lv.1 基础值；每级 +chipsInc/+multInc；planet = 对应星球牌 id
// 注意：皇家同花顺(Royal Flush)不单独升级，与同花顺共用等级（原作设定）

export const HANDS = [
  { id: 'high_card',      name: '高牌',       nameEn: 'High Card',      chips: 5,   mult: 1,  chipsInc: 10, multInc: 1, planet: 'p_pluto' },
  { id: 'pair',           name: '对子',       nameEn: 'Pair',           chips: 10,  mult: 2,  chipsInc: 15, multInc: 1, planet: 'p_mercury' },
  { id: 'two_pair',       name: '两对',       nameEn: 'Two Pair',       chips: 20,  mult: 2,  chipsInc: 20, multInc: 1, planet: 'p_uranus' },
  { id: 'three_of_a_kind', name: '三条',      nameEn: 'Three of a Kind', chips: 30, mult: 3,  chipsInc: 20, multInc: 2, planet: 'p_venus' },
  { id: 'straight',       name: '顺子',       nameEn: 'Straight',       chips: 30,  mult: 4,  chipsInc: 30, multInc: 3, planet: 'p_saturn' },
  { id: 'flush',          name: '同花',       nameEn: 'Flush',          chips: 35,  mult: 4,  chipsInc: 15, multInc: 2, planet: 'p_jupiter' },
  { id: 'full_house',     name: '葫芦',       nameEn: 'Full House',     chips: 40,  mult: 4,  chipsInc: 25, multInc: 2, planet: 'p_earth' },
  { id: 'four_of_a_kind', name: '四条',       nameEn: 'Four of a Kind', chips: 60,  mult: 7,  chipsInc: 30, multInc: 3, planet: 'p_mars' },
  { id: 'straight_flush', name: '同花顺',     nameEn: 'Straight Flush', chips: 100, mult: 8,  chipsInc: 40, multInc: 4, planet: 'p_neptune' },
  { id: 'five_of_a_kind', name: '五条',       nameEn: 'Five of a Kind', chips: 120, mult: 12, chipsInc: 35, multInc: 3, planet: 'p_planet_x', secret: true },
  { id: 'flush_house',    name: '同花葫芦',   nameEn: 'Flush House',    chips: 140, mult: 14, chipsInc: 40, multInc: 4, planet: 'p_ceres', secret: true },
  { id: 'flush_five',     name: '同花五条',   nameEn: 'Flush Five',     chips: 160, mult: 16, chipsInc: 50, multInc: 3, planet: 'p_eris', secret: true },
]

// 判定优先级（高 → 低）：评估时取能组成的最高牌型
export const HAND_PRIORITY = [
  'flush_five', 'flush_house', 'five_of_a_kind',
  'straight_flush', 'four_of_a_kind', 'full_house',
  'flush', 'straight', 'three_of_a_kind', 'two_pair', 'pair', 'high_card',
]

// 「包含」关系（原作 contains 语义）：
// 例如三条「包含」对子，但四条不包含两对；五条/同花五条不包含葫芦
export const HAND_CONTAINS = {
  high_card: [],
  pair: ['pair'],
  two_pair: ['two_pair', 'pair'],
  three_of_a_kind: ['three_of_a_kind', 'pair'],
  straight: ['straight'],
  flush: ['flush'],
  full_house: ['full_house', 'three_of_a_kind', 'pair'],
  four_of_a_kind: ['four_of_a_kind', 'three_of_a_kind', 'pair'],
  straight_flush: ['straight_flush', 'straight', 'flush'],
  five_of_a_kind: ['five_of_a_kind', 'four_of_a_kind', 'three_of_a_kind', 'pair'],
  flush_house: ['flush_house', 'full_house', 'flush', 'three_of_a_kind', 'pair'],
  flush_five: ['flush_five', 'five_of_a_kind', 'four_of_a_kind', 'three_of_a_kind', 'pair', 'flush'],
}

export const HANDS_BY_ID = Object.fromEntries(HANDS.map(h => [h.id, h]))

// 计算某等级牌型的筹码/倍率
export function handScore(handId, level = 1) {
  const h = HANDS_BY_ID[handId]
  const lv = Math.max(1, level)
  return { chips: h.chips + h.chipsInc * (lv - 1), mult: h.mult + h.multInc * (lv - 1) }
}
