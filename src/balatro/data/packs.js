// Balatro 卡包：5 类 × 3 规格（Normal/Jumbo/Mega）
// 数据来源：balatrowiki.org/Booster_Packs（已核对官方价格与权重）
// count = 开出卡牌数，choose = 可选择数

const SIZES = {
  normal: { key: 'normal', label: '',    cost: 4 },
  jumbo:  { key: 'jumbo',  label: '巨型', cost: 6 },
  mega:   { key: 'mega',   label: '超级', cost: 8 },
}

const TYPES = [
  { key: 'arcana',    name: '秘术包', nameEn: 'Arcana Pack',    contents: 'tarot',    counts: { normal: [3, 1], jumbo: [5, 1], mega: [5, 2] }, weights: { normal: 4, jumbo: 2, mega: 0.5 } },
  { key: 'celestial', name: '天体包', nameEn: 'Celestial Pack', contents: 'planet',   counts: { normal: [3, 1], jumbo: [5, 1], mega: [5, 2] }, weights: { normal: 4, jumbo: 2, mega: 0.5 } },
  { key: 'standard',  name: '标准包', nameEn: 'Standard Pack',  contents: 'playing',  counts: { normal: [3, 1], jumbo: [5, 1], mega: [5, 2] }, weights: { normal: 4, jumbo: 2, mega: 0.5 } },
  { key: 'spectral',  name: '幻灵包', nameEn: 'Spectral Pack',  contents: 'spectral', counts: { normal: [2, 1], jumbo: [4, 1], mega: [4, 2] }, weights: { normal: 0.6, jumbo: 0.3, mega: 0.07 } },
  { key: 'buffoon',   name: '小丑包', nameEn: 'Buffoon Pack',   contents: 'joker',    counts: { normal: [2, 1], jumbo: [4, 1], mega: [4, 2] }, weights: { normal: 1.2, jumbo: 0.6, mega: 0.15 } },
]

export const PACKS = []
for (const t of TYPES) {
  for (const s of Object.values(SIZES)) {
    const [count, choose] = t.counts[s.key]
    PACKS.push({
      id: `pack_${t.key}_${s.key}`,
      type: 'pack',
      packType: t.key,
      size: s.key,
      name: `${s.label}${t.name}`,
      nameEn: `${s.key === 'normal' ? '' : s.key === 'jumbo' ? 'Jumbo ' : 'Mega '}${t.nameEn}`,
      cost: s.cost,
      contents: t.contents,
      count,
      choose,
      weight: t.weights[s.key],
      art: { bg: t.key === 'arcana' ? '#4a3a6a' : t.key === 'celestial' ? '#2a4a6a' : t.key === 'standard' ? '#4a4a4a' : t.key === 'spectral' ? '#2a2a3a' : '#6a4a3a', motif: '📦', accent: '#c9b8e8' },
    })
  }
}

export const PACKS_BY_ID = Object.fromEntries(PACKS.map(p => [p.id, p]))
