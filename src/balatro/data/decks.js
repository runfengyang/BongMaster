// Balatro 牌组（15 个全量）
// 数据来源：balatrowiki.org/Decks（已核对官方效果）
// effect 由 engine/run.js 在 newRun 时解释应用

export const DECKS = [
  { id: 'deck_red',       name: '红色牌组',   nameEn: 'Red Deck',       text: '每回合 +1 次弃牌', effect: { discards: 1 }, art: { bg: '#5c2e2e', motif: '🟥', accent: '#e07070' } },
  { id: 'deck_blue',      name: '蓝色牌组',   nameEn: 'Blue Deck',      text: '每回合 +1 次出牌', effect: { hands: 1 }, art: { bg: '#2e3a5c', motif: '🟦', accent: '#7090e0' } },
  { id: 'deck_yellow',    name: '黄色牌组',   nameEn: 'Yellow Deck',    text: '开局额外 +$10', effect: { money: 10 }, art: { bg: '#5c522e', motif: '🟨', accent: '#e0d970' } },
  { id: 'deck_green',     name: '绿色牌组',   nameEn: 'Green Deck',     text: '回合结束：每个剩余出牌次数 +$2、每个剩余弃牌次数 +$1；不获得利息', effect: { greenEconomy: true }, art: { bg: '#2e5c3a', motif: '🟩', accent: '#70e090' } },
  { id: 'deck_black',     name: '黑色牌组',   nameEn: 'Black Deck',     text: '+1 小丑栏位，每回合 -1 次出牌', effect: { jokerSlots: 1, hands: -1 }, art: { bg: '#2a2a2a', motif: '⬛', accent: '#909090' } },
  { id: 'deck_magic',     name: '魔法牌组',   nameEn: 'Magic Deck',     text: '开局获得「水晶球」优惠券与 2 张「愚者」', effect: { vouchers: ['v_crystal_ball'], consumables: ['c_fool', 'c_fool'] }, art: { bg: '#4a2e5c', motif: '🔮', accent: '#b870e0' } },
  { id: 'deck_nebula',    name: '星云牌组',   nameEn: 'Nebula Deck',    text: '开局获得「望远镜」优惠券，-1 消耗牌栏位', effect: { vouchers: ['v_telescope'], consumableSlots: -1 }, art: { bg: '#2e4a5c', motif: '🌌', accent: '#70b8e0' } },
  { id: 'deck_ghost',     name: '幽灵牌组',   nameEn: 'Ghost Deck',     text: '幻灵牌可出现在商店中，开局获得 1 张「妖术」', effect: { ghostShop: true, consumables: ['s_hex'] }, art: { bg: '#3a3a4a', motif: '👻', accent: '#a0a0e0' } },
  { id: 'deck_abandoned', name: '遗弃牌组',   nameEn: 'Abandoned Deck', text: '牌堆中没有人头牌（40 张）', effect: { noFace: true }, art: { bg: '#4a3a2e', motif: '🏚️', accent: '#c9a070' } },
  { id: 'deck_checkered', name: '格纹牌组',   nameEn: 'Checkered Deck', text: '牌堆为 26 张黑桃 + 26 张红桃', effect: { checkered: true }, art: { bg: '#3a3a3a', motif: '🏁', accent: '#c9c9c9' } },
  { id: 'deck_zodiac',    name: '星座牌组',   nameEn: 'Zodiac Deck',    text: '开局获得「塔罗商人」「星球商人」「库存过剩」', effect: { vouchers: ['v_tarot_merchant', 'v_planet_merchant', 'v_overstock'] }, art: { bg: '#2e5c52', motif: '♈', accent: '#70e0c9' } },
  { id: 'deck_painted',   name: '彩绘牌组',   nameEn: 'Painted Deck',   text: '+2 手牌上限，-1 小丑栏位', effect: { handSize: 2, jokerSlots: -1 }, art: { bg: '#5c2e4a', motif: '🎨', accent: '#e070b8' } },
  { id: 'deck_anaglyph',  name: '浮雕牌组',   nameEn: 'Anaglyph Deck',  text: '击败每个 Boss 盲注后获得 1 个双倍标签', effect: { anaglyph: true }, art: { bg: '#4a2e2e', motif: '🥽', accent: '#e07070' } },
  { id: 'deck_plasma',    name: '等离子牌组', nameEn: 'Plasma Deck',    text: '计分时筹码与倍率取平均后相乘；盲注目标分 ×2', effect: { plasma: true }, art: { bg: '#3a2e5c', motif: '⚡', accent: '#a070ff' } },
  { id: 'deck_erratic',   name: '错乱牌组',   nameEn: 'Erratic Deck',   text: '牌堆中所有牌的点数与花色完全随机', effect: { erratic: true }, art: { bg: '#4a4a2e', motif: '🎲', accent: '#e0e070' } },
]

export const DECKS_BY_ID = Object.fromEntries(DECKS.map(d => [d.id, d]))
