// dataVerified: true —— §12 经 zh_CN 官方简中校对
// Balatro 星球牌（12 张）—— 每张升级对应牌型 1 级
// 数据来源：balatrowiki.org/Poker_Hands（已核对）
// 皇家同花顺无专属星球，随同花顺（海王星）升级（原作设定）

export const PLANETS = [
  { id: 'p_pluto',    name: '冥王星', nameEn: 'Pluto',    type: 'planet', cost: 3, hand: 'high_card',       text: '升级「高牌」1 级（+10 筹码，+1 倍率）',       art: { bg: '#4a3b52', motif: '🪐', accent: '#b8a9c9' } },
  { id: 'p_mercury',  name: '水星',   nameEn: 'Mercury',  type: 'planet', cost: 3, hand: 'pair',            text: '升级「对子」1 级（+15 筹码，+1 倍率）',       art: { bg: '#5c4a3b', motif: '☿️', accent: '#d9b08c' } },
  { id: 'p_uranus',   name: '天王星', nameEn: 'Uranus',   type: 'planet', cost: 3, hand: 'two_pair',        text: '升级「两对」1 级（+20 筹码，+1 倍率）',       art: { bg: '#3b5c5c', motif: '⛢', accent: '#8cd9d9' } },
  { id: 'p_venus',    name: '金星',   nameEn: 'Venus',    type: 'planet', cost: 3, hand: 'three_of_a_kind', text: '升级「三条」1 级（+20 筹码，+2 倍率）',       art: { bg: '#5c5240', motif: '♀️', accent: '#e8d9a0' } },
  { id: 'p_saturn',   name: '土星',   nameEn: 'Saturn',   type: 'planet', cost: 3, hand: 'straight',        text: '升级「顺子」1 级（+30 筹码，+3 倍率）',       art: { bg: '#54452e', motif: '🪐', accent: '#d9c08c' } },
  { id: 'p_jupiter',  name: '木星',   nameEn: 'Jupiter',  type: 'planet', cost: 3, hand: 'flush',           text: '升级「同花」1 级（+15 筹码，+2 倍率）',       art: { bg: '#5c4030', motif: '♃', accent: '#e0a070' } },
  { id: 'p_earth',    name: '地球',   nameEn: 'Earth',    type: 'planet', cost: 3, hand: 'full_house',      text: '升级「葫芦」1 级（+25 筹码，+2 倍率）',       art: { bg: '#2e4a5c', motif: '🌍', accent: '#70b0e0' } },
  { id: 'p_mars',     name: '火星',   nameEn: 'Mars',     type: 'planet', cost: 3, hand: 'four_of_a_kind',  text: '升级「四条」1 级（+30 筹码，+3 倍率）',       art: { bg: '#5c2e2e', motif: '♂️', accent: '#e07070' } },
  { id: 'p_neptune',  name: '海王星', nameEn: 'Neptune',  type: 'planet', cost: 3, hand: 'straight_flush',  text: '升级「同花顺」1 级（+40 筹码，+4 倍率）',     art: { bg: '#2e3a5c', motif: '🔱', accent: '#7090e0' } },
  { id: 'p_planet_x', name: 'X行星', nameEn: 'Planet X', type: 'planet', cost: 3, hand: 'five_of_a_kind',  text: '升级「五条」1 级（+35 筹码，+3 倍率）',       art: { bg: '#3d2e5c', motif: '❌', accent: '#a070e0' } },
  { id: 'p_ceres',    name: '谷神星', nameEn: 'Ceres',    type: 'planet', cost: 3, hand: 'flush_house',     text: '升级「同花葫芦」1 级（+40 筹码，+4 倍率）',   art: { bg: '#4a4a3a', motif: '⚳', accent: '#c9c990' } },
  { id: 'p_eris',     name: '阋神星', nameEn: 'Eris',     type: 'planet', cost: 3, hand: 'flush_five',      text: '升级「同花五条」1 级（+50 筹码，+3 倍率）',   art: { bg: '#3a3a4a', motif: '⯰', accent: '#9090c9' } },
]

export const PLANETS_BY_ID = Object.fromEntries(PLANETS.map(p => [p.id, p]))
