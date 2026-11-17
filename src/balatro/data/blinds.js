// Balatro 盲注：小盲注 / 大盲注 / 28 个 Boss 盲注 + Ante 基础分表
// 数据来源：balatrowiki.org/Blinds（已核对官方数值，White Stake）
// effect.handler 由 engine/run.js 的 BossBlindEffects 解释执行

export const SMALL_BLIND = {
  id: 'bl_small', name: '小盲注', nameEn: 'Small Blind', type: 'small',
  scoreMult: 1, reward: 3, text: '无特殊效果，可跳过获得标签',
}

export const BIG_BLIND = {
  id: 'bl_big', name: '大盲注', nameEn: 'Big Blind', type: 'big',
  scoreMult: 1.5, reward: 4, text: '无特殊效果，可跳过获得标签',
}

// 常规 Boss 盲注（23 个）
export const BOSS_BLINDS = [
  { id: 'bl_hook',     name: '钩子',     nameEn: 'The Hook',     minAnte: 1, scoreMult: 2, reward: 5, text: '每次出牌后随机弃掉手牌中的 2 张牌', effect: { handler: 'hook' }, art: { bg: '#4a2a2a', motif: '🪝', accent: '#e08c8c' } },
  { id: 'bl_ox',       name: '公牛',     nameEn: 'The Ox',       minAnte: 6, scoreMult: 2, reward: 5, text: '打出本局最常打出的牌型时，金钱变为 $0', effect: { handler: 'ox' }, art: { bg: '#4a3a2a', motif: '🐂', accent: '#e0b88c' } },
  { id: 'bl_house',    name: '房屋',     nameEn: 'The House',    minAnte: 2, scoreMult: 2, reward: 5, text: '第一手牌面朝下抽取', effect: { handler: 'house' }, art: { bg: '#3a3a4a', motif: '🏠', accent: '#a0a0e0' } },
  { id: 'bl_wall',     name: '高墙',     nameEn: 'The Wall',     minAnte: 2, scoreMult: 4, reward: 5, text: '超大盲注', effect: { handler: 'none' }, art: { bg: '#3a3a3a', motif: '🧱', accent: '#c9c9c9' } },
  { id: 'bl_wheel',    name: '车轮',     nameEn: 'The Wheel',    minAnte: 2, scoreMult: 2, reward: 5, text: '本回合 1/7 的牌面朝下抽取', effect: { handler: 'wheel' }, art: { bg: '#3a4a3a', motif: '☸️', accent: '#8ce08c' } },
  { id: 'bl_arm',      name: '手臂',     nameEn: 'The Arm',      minAnte: 2, scoreMult: 2, reward: 5, text: '打出的牌型等级永久 -1（最低 1 级，计分前结算）', effect: { handler: 'arm' }, art: { bg: '#4a2a3a', motif: '💪', accent: '#e08cd9' } },
  { id: 'bl_club',     name: '梅花',     nameEn: 'The Club',     minAnte: 1, scoreMult: 2, reward: 5, text: '所有梅花牌被削弱', effect: { handler: 'debuffSuit', params: { suit: 'clubs' } }, art: { bg: '#2a4a2a', motif: '♣️', accent: '#8ce08c' } },
  { id: 'bl_fish',     name: '鱼',       nameEn: 'The Fish',     minAnte: 2, scoreMult: 2, reward: 5, text: '每次出牌后抽的牌面朝下', effect: { handler: 'fish' }, art: { bg: '#2a3a4a', motif: '🐟', accent: '#8cb8e0' } },
  { id: 'bl_psychic',  name: '通灵者',   nameEn: 'The Psychic',  minAnte: 1, scoreMult: 2, reward: 5, text: '必须打出 5 张牌（不要求全部计分）', effect: { handler: 'psychic' }, art: { bg: '#3a2a4a', motif: '👁️', accent: '#b88ce0' } },
  { id: 'bl_goad',     name: '驱使人',   nameEn: 'The Goad',     minAnte: 1, scoreMult: 2, reward: 5, text: '所有黑桃牌被削弱', effect: { handler: 'debuffSuit', params: { suit: 'spades' } }, art: { bg: '#2a2a4a', motif: '♠️', accent: '#8c8ce0' } },
  { id: 'bl_water',    name: '水',       nameEn: 'The Water',    minAnte: 2, scoreMult: 2, reward: 5, text: '以 0 次弃牌开始', effect: { handler: 'water' }, art: { bg: '#2a3a4a', motif: '💧', accent: '#8cd9e0' } },
  { id: 'bl_window',   name: '窗户',     nameEn: 'The Window',   minAnte: 1, scoreMult: 2, reward: 5, text: '所有方片牌被削弱', effect: { handler: 'debuffSuit', params: { suit: 'diamonds' } }, art: { bg: '#4a3a2a', motif: '🪟', accent: '#e0d98c' } },
  { id: 'bl_manacle',  name: '镣铐',     nameEn: 'The Manacle',  minAnte: 1, scoreMult: 2, reward: 5, text: '手牌上限 -1', effect: { handler: 'manacle' }, art: { bg: '#3a3a3a', motif: '⛓️', accent: '#c9c9c9' } },
  { id: 'bl_eye',      name: '眼睛',     nameEn: 'The Eye',      minAnte: 3, scoreMult: 2, reward: 5, text: '本回合不能打出重复的牌型', effect: { handler: 'eye' }, art: { bg: '#3a2a4a', motif: '👀', accent: '#b88ce0' } },
  { id: 'bl_mouth',    name: '嘴',       nameEn: 'The Mouth',    minAnte: 2, scoreMult: 2, reward: 5, text: '本回合只能打出一种牌型', effect: { handler: 'mouth' }, art: { bg: '#4a2a2a', motif: '👄', accent: '#e08c8c' } },
  { id: 'bl_plant',    name: '植物',     nameEn: 'The Plant',    minAnte: 4, scoreMult: 2, reward: 5, text: '所有人头牌被削弱', effect: { handler: 'plant' }, art: { bg: '#2a4a2a', motif: '🌿', accent: '#8ce08c' } },
  { id: 'bl_serpent',  name: '蛇',       nameEn: 'The Serpent',  minAnte: 5, scoreMult: 2, reward: 5, text: '出牌或弃牌后，固定抽 3 张牌（忽略手牌上限）', effect: { handler: 'serpent' }, art: { bg: '#2a4a3a', motif: '🐍', accent: '#8ce0b8' } },
  { id: 'bl_pillar',   name: '柱子',     nameEn: 'The Pillar',   minAnte: 1, scoreMult: 2, reward: 5, text: '本 Ante 之前打出过的牌被削弱', effect: { handler: 'pillar' }, art: { bg: '#3a3a4a', motif: '🏛️', accent: '#c9c9e0' } },
  { id: 'bl_needle',   name: '针',       nameEn: 'The Needle',   minAnte: 2, scoreMult: 1, reward: 5, text: '只能打出 1 手牌', effect: { handler: 'needle' }, art: { bg: '#4a4a2a', motif: '🪡', accent: '#e0e08c' } },
  { id: 'bl_head',     name: '头',       nameEn: 'The Head',     minAnte: 1, scoreMult: 2, reward: 5, text: '所有红桃牌被削弱', effect: { handler: 'debuffSuit', params: { suit: 'hearts' } }, art: { bg: '#4a2a2a', motif: '♥️', accent: '#e08c8c' } },
  { id: 'bl_tooth',    name: '牙齿',     nameEn: 'The Tooth',    minAnte: 3, scoreMult: 2, reward: 5, text: '每打出 1 张牌失去 $1', effect: { handler: 'tooth' }, art: { bg: '#4a4a3a', motif: '🦷', accent: '#e0e0c9' } },
  { id: 'bl_flint',    name: '燧石',     nameEn: 'The Flint',    minAnte: 2, scoreMult: 2, reward: 5, text: '本回合打出牌型的基础筹码与倍率减半', effect: { handler: 'flint' }, art: { bg: '#3a2a2a', motif: '🪨', accent: '#e0a08c' } },
  { id: 'bl_mark',     name: '标记',     nameEn: 'The Mark',     minAnte: 2, scoreMult: 2, reward: 5, text: '所有人头牌面朝下抽取', effect: { handler: 'mark' }, art: { bg: '#3a3a3a', motif: '❓', accent: '#c9c9c9' } },
]

// 决战 Boss 盲注（Showdown，仅 Ante 8/16/24/32）
export const SHOWDOWN_BLINDS = [
  { id: 'bl_amber_acorn',   name: '琥珀橡果',   nameEn: 'Amber Acorn',   minAnte: 8, scoreMult: 2, reward: 8, text: '翻转并洗混所有小丑牌', showdown: true, effect: { handler: 'amberAcorn' }, art: { bg: '#4a3a2a', motif: '🌰', accent: '#e0b88c' } },
  { id: 'bl_verdant_leaf',  name: '翠绿叶子',   nameEn: 'Verdant Leaf',  minAnte: 8, scoreMult: 2, reward: 8, text: '所有牌被削弱，直到卖出 1 张小丑', showdown: true, effect: { handler: 'verdantLeaf' }, art: { bg: '#2a4a2a', motif: '🍃', accent: '#8ce08c' } },
  { id: 'bl_violet_vessel', name: '紫罗兰容器', nameEn: 'Violet Vessel', minAnte: 8, scoreMult: 6, reward: 8, text: '特大盲注', showdown: true, effect: { handler: 'none' }, art: { bg: '#3a2a4a', motif: '🏺', accent: '#b88ce0' } },
  { id: 'bl_crimson_heart', name: '绯红之心',   nameEn: 'Crimson Heart', minAnte: 8, scoreMult: 2, reward: 8, text: '每手牌随机禁用 1 张小丑（每手更换）', showdown: true, effect: { handler: 'crimsonHeart' }, art: { bg: '#4a2a2a', motif: '❤️', accent: '#e08c8c' } },
  { id: 'bl_cerulean_bell', name: '蔚蓝铃铛',   nameEn: 'Cerulean Bell', minAnte: 8, scoreMult: 2, reward: 8, text: '强制 1 张牌始终被选中', showdown: true, effect: { handler: 'ceruleanBell' }, art: { bg: '#2a3a4a', motif: '🔔', accent: '#8cb8e0' } },
]

export const ALL_BOSS_BLINDS = [...BOSS_BLINDS, ...SHOWDOWN_BLINDS]
export const BLINDS_BY_ID = Object.fromEntries(
  [SMALL_BLIND, BIG_BLIND, ...ALL_BOSS_BLINDS].map(b => [b.id, b])
)

// Ante 基础分表（White Stake，已核对 wiki；Ante 9+ 为无尽模式）
export const ANTE_BASE_CHIPS = [100, 300, 800, 2000, 5000, 11000, 20000, 35000, 50000]

export function anteBaseChips(ante) {
  if (ante <= 0) return 100
  if (ante <= 8) return ANTE_BASE_CHIPS[ante]
  // 无尽模式公式（wiki）：Ante8 基础 × (1.6 + 0.75×(A-8))^(1+0.2×(A-8)) 的 (A-8) 次幂，保留两位有效数字
  const k = ante - 8
  const v = 50000 * Math.pow(1.6 + 0.75 * k, (1 + 0.2 * k) * k)
  const mag = Math.pow(10, Math.floor(Math.log10(v)) - 1)
  return Math.round(v / mag) * mag
}

// 盲注目标分 = Ante 基础 × 盲注倍率（Plasma 牌组 ×2）
export function blindTarget(ante, blind, plasma = false) {
  return Math.round(anteBaseChips(ante) * blind.scoreMult * (plasma ? 2 : 1))
}
