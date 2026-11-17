// Balatro 版本（Edition）—— 5 种
// 数据来源：balatrowiki.org/Card_modifiers（已核对）
// 商店加价：闪箔 +$2 / 全息 +$3 / 多彩 +$5 / 负片 +$5
// 小丑/消耗牌出现概率（无优惠券）：负片 0.3% / 多彩 0.3% / 全息 1.4% / 闪箔 2%
// 扑克牌（卡包）：多彩 1.2% / 全息 2.8% / 闪箔 4%
// 磨砺(Hone)：多彩 0.9% / 全息 2.8% / 闪箔 4%（小丑）；扑克牌 ×2
// 焕彩(Glow Up)：多彩 2.1% / 全息 5.6% / 闪箔 8%（小丑）；扑克牌 ×4

export const EDITIONS = [
  { id: 'base',    name: '基础',  nameEn: 'Base',        costAdd: 0, text: '无额外效果' },
  { id: 'foil',    name: '闪箔',  nameEn: 'Foil',        costAdd: 2, chips: 50,  text: '+50 筹码' },
  { id: 'holo',    name: '全息',  nameEn: 'Holographic', costAdd: 3, mult: 10,   text: '+10 倍率' },
  { id: 'poly',    name: '多彩',  nameEn: 'Polychrome',  costAdd: 5, xMult: 1.5, text: '×1.5 倍率' },
  { id: 'negative', name: '负片', nameEn: 'Negative',    costAdd: 5, extraSlot: 1, text: '+1 栏位' },
]

export const EDITIONS_BY_ID = Object.fromEntries(EDITIONS.map(e => [e.id, e]))

// 小丑版本概率（返回 { foil, holo, poly, negative } 各项概率）
export function jokerEditionChances(honeLevel = 0) {
  if (honeLevel >= 2) return { foil: 0.08, holo: 0.056, poly: 0.021, negative: 0.003 }
  if (honeLevel >= 1) return { foil: 0.04, holo: 0.028, poly: 0.009, negative: 0.003 }
  return { foil: 0.02, holo: 0.014, poly: 0.003, negative: 0.003 }
}

// 卡包中扑克牌版本概率（无负片）
export function cardEditionChances(honeLevel = 0) {
  if (honeLevel >= 2) return { foil: 0.16, holo: 0.112, poly: 0.048 }
  if (honeLevel >= 1) return { foil: 0.08, holo: 0.056, poly: 0.024 }
  return { foil: 0.04, holo: 0.028, poly: 0.012 }
}
