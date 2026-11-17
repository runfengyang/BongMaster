// Balatro 优惠券（Voucher，32 张全量：16 基础 + 16 升级）
// 数据来源：balatrowiki.org/Vouchers（已核对官方效果，统一 $10）
// requires = 需先购买的基础版 id

export const VOUCHERS = [
  { id: 'v_overstock',        name: '库存过剩',     nameEn: 'Overstock',        cost: 10, text: '商店卡牌位 +1（至 3 格）', effect: { shopSlots: 1 }, art: { bg: '#3a4a5a', motif: '📦', accent: '#8cb8e0' } },
  { id: 'v_overstock_plus',   name: '库存过剩+',    nameEn: 'Overstock Plus',   cost: 10, text: '商店卡牌位再 +1（至 4 格）', effect: { shopSlots: 1 }, requires: 'v_overstock', art: { bg: '#3a4a5a', motif: '📦', accent: '#8cb8e0' } },
  { id: 'v_clearance_sale',   name: '清仓甩卖',     nameEn: 'Clearance Sale',   cost: 10, text: '商店所有卡牌与卡包 75 折', effect: { discount: 0.75 }, art: { bg: '#5a4a3a', motif: '🏷️', accent: '#e0c98c' } },
  { id: 'v_liquidation',      name: '清算',         nameEn: 'Liquidation',      cost: 10, text: '商店所有卡牌与卡包 5 折', effect: { discount: 0.5 }, requires: 'v_clearance_sale', art: { bg: '#5a4a3a', motif: '🏷️', accent: '#e0c98c' } },
  { id: 'v_hone',             name: '磨砺',         nameEn: 'Hone',             cost: 10, text: '闪箔/全息/多彩卡牌出现率 ×2', effect: { hone: 1 }, art: { bg: '#4a4a5a', motif: '💎', accent: '#c9c9e0' } },
  { id: 'v_glow_up',          name: '焕彩',         nameEn: 'Glow Up',          cost: 10, text: '闪箔/全息/多彩卡牌出现率 ×4', effect: { hone: 2 }, requires: 'v_hone', art: { bg: '#4a4a5a', motif: '💎', accent: '#c9c9e0' } },
  { id: 'v_reroll_surplus',   name: '重掷盈余',     nameEn: 'Reroll Surplus',   cost: 10, text: '重掷费用 -$2', effect: { rerollDiscount: 2 }, art: { bg: '#3a5a4a', motif: '🎲', accent: '#8ce0b8' } },
  { id: 'v_reroll_glut',      name: '重掷过剩',     nameEn: 'Reroll Glut',      cost: 10, text: '重掷费用再 -$2', effect: { rerollDiscount: 2 }, requires: 'v_reroll_surplus', art: { bg: '#3a5a4a', motif: '🎲', accent: '#8ce0b8' } },
  { id: 'v_crystal_ball',     name: '水晶球',       nameEn: 'Crystal Ball',     cost: 10, text: '+1 消耗牌栏位', effect: { consumableSlots: 1 }, art: { bg: '#4a3a5a', motif: '🔮', accent: '#b88ce0' } },
  { id: 'v_omen_globe',       name: '预兆球',       nameEn: 'Omen Globe',       cost: 10, text: '秘术包中可出现幻灵牌（每张 20% 概率替换）', effect: { omenGlobe: true }, requires: 'v_crystal_ball', art: { bg: '#4a3a5a', motif: '🔮', accent: '#b88ce0' } },
  { id: 'v_telescope',        name: '望远镜',       nameEn: 'Telescope',        cost: 10, text: '天体包必含你最常打出牌型对应的星球牌', effect: { telescope: true }, art: { bg: '#3a4a5a', motif: '🔭', accent: '#8cb8e0' } },
  { id: 'v_observatory',      name: '天文台',       nameEn: 'Observatory',      cost: 10, text: '消耗栏中的星球牌为其对应牌型提供 ×1.5 倍率', effect: { observatory: true }, requires: 'v_telescope', art: { bg: '#3a4a5a', motif: '🔭', accent: '#8cb8e0' } },
  { id: 'v_grabber',          name: '抓取器',       nameEn: 'Grabber',          cost: 10, text: '永久每回合 +1 次出牌', effect: { hands: 1 }, art: { bg: '#5a3a3a', motif: '🤏', accent: '#e08c8c' } },
  { id: 'v_nacho_tong',       name: '玉米片钳',     nameEn: 'Nacho Tong',       cost: 10, text: '永久每回合再 +1 次出牌', effect: { hands: 1 }, requires: 'v_grabber', art: { bg: '#5a3a3a', motif: '🤏', accent: '#e08c8c' } },
  { id: 'v_wasteful',         name: '浪费',         nameEn: 'Wasteful',         cost: 10, text: '永久每回合 +1 次弃牌', effect: { discards: 1 }, art: { bg: '#4a5a3a', motif: '🗑️', accent: '#b8e08c' } },
  { id: 'v_recyclomancy',     name: '回收魔法',     nameEn: 'Recyclomancy',     cost: 10, text: '永久每回合再 +1 次弃牌', effect: { discards: 1 }, requires: 'v_wasteful', art: { bg: '#4a5a3a', motif: '♻️', accent: '#b8e08c' } },
  { id: 'v_tarot_merchant',   name: '塔罗商人',     nameEn: 'Tarot Merchant',   cost: 10, text: '商店中塔罗牌出现率 ×2', effect: { tarotWeight: 9.6 }, art: { bg: '#4a3a5a', motif: '🃏', accent: '#c9a0e8' } },
  { id: 'v_tarot_tycoon',     name: '塔罗大亨',     nameEn: 'Tarot Tycoon',     cost: 10, text: '商店中塔罗牌出现率 ×4', effect: { tarotWeight: 32 }, requires: 'v_tarot_merchant', art: { bg: '#4a3a5a', motif: '🃏', accent: '#c9a0e8' } },
  { id: 'v_planet_merchant',  name: '星球商人',     nameEn: 'Planet Merchant',  cost: 10, text: '商店中星球牌出现率 ×2', effect: { planetWeight: 9.6 }, art: { bg: '#3a4a5a', motif: '🪐', accent: '#8cd9e0' } },
  { id: 'v_planet_tycoon',    name: '星球大亨',     nameEn: 'Planet Tycoon',    cost: 10, text: '商店中星球牌出现率 ×4', effect: { planetWeight: 32 }, requires: 'v_planet_merchant', art: { bg: '#3a4a5a', motif: '🪐', accent: '#8cd9e0' } },
  { id: 'v_seed_money',       name: '种子基金',     nameEn: 'Seed Money',       cost: 10, text: '每回合利息上限提高至 $10', effect: { interestCap: 10 }, art: { bg: '#3a5a3a', motif: '🌱', accent: '#8ce08c' } },
  { id: 'v_money_tree',       name: '摇钱树',       nameEn: 'Money Tree',       cost: 10, text: '每回合利息上限提高至 $20', effect: { interestCap: 20 }, requires: 'v_seed_money', art: { bg: '#3a5a3a', motif: '🌳', accent: '#8ce08c' } },
  { id: 'v_blank',            name: '空白',         nameEn: 'Blank',            cost: 10, text: '什么都不做？', effect: {}, art: { bg: '#3a3a3a', motif: '⬜', accent: '#c9c9c9' } },
  { id: 'v_antimatter',       name: '反物质',       nameEn: 'Antimatter',       cost: 10, text: '+1 小丑栏位', effect: { jokerSlots: 1 }, requires: 'v_blank', art: { bg: '#2a2a3a', motif: '🌑', accent: '#9090e0' } },
  { id: 'v_magic_trick',      name: '魔术把戏',     nameEn: 'Magic Trick',      cost: 10, text: '商店中可购买扑克牌', effect: { shopPlayingCards: true }, art: { bg: '#4a4a3a', motif: '🎩', accent: '#e0d98c' } },
  { id: 'v_illusion',         name: '幻术',         nameEn: 'Illusion',         cost: 10, text: '商店中的扑克牌可带增强与版本', effect: { illusion: true }, requires: 'v_magic_trick', art: { bg: '#4a4a3a', motif: '🎩', accent: '#e0d98c' } },
  { id: 'v_hieroglyph',       name: '象形文字',     nameEn: 'Hieroglyph',       cost: 10, text: 'Ante -1，每回合出牌次数 -1', effect: { anteDown: 1, hands: -1 }, art: { bg: '#5a4a3a', motif: '𓂀', accent: '#e0c98c' } },
  { id: 'v_petroglyph',       name: '岩画',         nameEn: 'Petroglyph',       cost: 10, text: 'Ante 再 -1，每回合弃牌次数 -1', effect: { anteDown: 1, discards: -1 }, requires: 'v_hieroglyph', art: { bg: '#5a4a3a', motif: '𓃒', accent: '#e0c98c' } },
  { id: 'v_directors_cut',    name: '导演剪辑版',   nameEn: "Director's Cut",   cost: 10, text: '每个 Ante 可重掷 1 次 Boss 盲注（$10/次）', effect: { bossReroll: 1 }, art: { bg: '#3a3a4a', motif: '🎬', accent: '#c9c9e0' } },
  { id: 'v_retcon',           name: '重构',         nameEn: 'Retcon',           cost: 10, text: '可无限重掷 Boss 盲注（$10/次）', effect: { bossReroll: 99 }, requires: 'v_directors_cut', art: { bg: '#3a3a4a', motif: '🎬', accent: '#c9c9e0' } },
  { id: 'v_paint_brush',      name: '画笔',         nameEn: 'Paint Brush',      cost: 10, text: '手牌上限 +1', effect: { handSize: 1 }, art: { bg: '#5a3a4a', motif: '🖌️', accent: '#e08cb8' } },
  { id: 'v_palette',          name: '调色板',       nameEn: 'Palette',          cost: 10, text: '手牌上限再 +1', effect: { handSize: 1 }, requires: 'v_paint_brush', art: { bg: '#5a3a4a', motif: '🎨', accent: '#e08cb8' } },
]

export const VOUCHERS_BY_ID = Object.fromEntries(VOUCHERS.map(v => [v.id, v]))
