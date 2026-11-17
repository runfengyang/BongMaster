// Balatro 增强（Enhancement，8 种）与蜡封（Seal，4 种）
// 数据来源：balatrowiki.org/Card_modifiers（已核对官方数值与概率）

export const ENHANCEMENTS = [
  { id: 'bonus', name: '奖励牌', nameEn: 'Bonus Card', chips: 30,
    text: '计分时额外 +30 筹码' },
  { id: 'mult',  name: '倍率牌', nameEn: 'Mult Card',  mult: 4,
    text: '计分时 +4 倍率' },
  { id: 'wild',  name: '万能牌', nameEn: 'Wild Card',
    text: '同时被视为所有花色' },
  { id: 'glass', name: '玻璃牌', nameEn: 'Glass Card', xMult: 2, breakChance: 0.25,
    text: '计分时 ×2 倍率，1/4 概率在计分结束后销毁' },
  { id: 'steel', name: '钢铁牌', nameEn: 'Steel Card', heldXMult: 1.5,
    text: '持有在手时 ×1.5 倍率' },
  { id: 'stone', name: '石头牌', nameEn: 'Stone Card', chips: 50, noRankSuit: true, alwaysScores: true,
    text: '无点数无花色，固定 +50 筹码，总是参与计分' },
  { id: 'gold',  name: '黄金牌', nameEn: 'Gold Card',  heldMoney: 3,
    text: '回合结束时若持有在手，获得 $3' },
  { id: 'lucky', name: '幸运牌', nameEn: 'Lucky Card', luckyMult: 20, luckyMultChance: 0.2, luckyMoney: 20, luckyMoneyChance: 1 / 15,
    text: '1/5 概率 +20 倍率，1/15 概率 +$20（分别判定）' },
]

export const SEALS = [
  { id: 'gold',   name: '金色蜡封', nameEn: 'Gold Seal',   money: 3,
    text: '此牌计分时获得 $3' },
  { id: 'red',    name: '红色蜡封', nameEn: 'Red Seal',    retrigger: 1,
    text: '此牌额外触发 1 次（含持有效果）' },
  { id: 'blue',   name: '蓝色蜡封', nameEn: 'Blue Seal',
    text: '回合结束时若持有在手，生成本回合最后打出牌型对应的星球牌（需有空位）' },
  { id: 'purple', name: '紫色蜡封', nameEn: 'Purple Seal',
    text: '此牌被弃掉时生成 1 张随机塔罗牌（需有空位）' },
]

export const ENHANCEMENTS_BY_ID = Object.fromEntries(ENHANCEMENTS.map(e => [e.id, e]))
export const SEALS_BY_ID = Object.fromEntries(SEALS.map(s => [s.id, s]))
