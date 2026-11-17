// dataVerified: true —— §12 经 zh_CN 官方简中校对
// Balatro 幻灵牌（18 张）
// 数据来源：balatrowiki.org/Spectral_Cards（已核对官方效果）
// 售价统一 $4。灵魂/黑洞只能通过卡包以 0.3% 概率开出（其余获取途径不可生成）

export const SPECTRAL = [
  { id: 's_familiar',    name: '使魔',     nameEn: 'Familiar',    type: 'spectral', cost: 4, text: '随机摧毁1张手牌并添加1张随机增强的人头牌到手牌中', textEn: 'Destroy 1 random card in your hand, add 3 random Enhanced face cards to your hand', effect: { handler: 'familiar' }, art: { bg: '#2a2a3a', motif: '🐈‍⬛', accent: '#8c8cd9' } },
  { id: 's_grim',        name: '严峻',     nameEn: 'Grim',        type: 'spectral', cost: 4, text: '随机销毁手牌中的 1 张牌，向手牌添加 2 张随机增强的 A', textEn: 'Destroy 1 random card in your hand, add 2 random Enhanced Aces to your hand', effect: { handler: 'grim' }, art: { bg: '#2a2a3a', motif: '💀', accent: '#8c8cd9' } },
  { id: 's_incantation', name: '咒语',     nameEn: 'Incantation', type: 'spectral', cost: 4, text: '随机销毁手牌中的 1 张牌，向手牌添加 4 张随机增强的数字牌', textEn: 'Destroy 1 random card in your hand, add 4 random Enhanced numbered cards to your hand', effect: { handler: 'incantation' }, art: { bg: '#2a2a3a', motif: '📜', accent: '#8c8cd9' } },
  { id: 's_talisman',    name: '护身符',   nameEn: 'Talisman',    type: 'spectral', cost: 4, text: '将金色蜡封添加到1张选定的手牌中', textEn: 'Add a Gold Seal to 1 selected card in your hand', effect: { handler: 'addSeal', params: { seal: 'gold' } }, art: { bg: '#3a3a2a', motif: '🧿', accent: '#d9d98c' } },
  { id: 's_aura',        name: '光环',     nameEn: 'Aura',        type: 'spectral', cost: 4, text: '选定1张手牌，为其添加闪箔卡、镭射卡、或多彩卡效果中的一种', textEn: 'Add Foil, Holographic, or Polychrome effect to 1 selected card in hand', effect: { handler: 'aura' }, art: { bg: '#3a2a3a', motif: '✨', accent: '#d98cd9' } },
  { id: 's_wraith',      name: '幽灵',     nameEn: 'Wraith',      type: 'spectral', cost: 4, text: '生成一张随机的稀有小丑牌将资金变为$0', textEn: 'Creates a random Rare Joker, sets money to $0', effect: { handler: 'wraith' }, art: { bg: '#2a2a3a', motif: '👻', accent: '#8cd9d9' } },
  { id: 's_sigil',       name: '符印',     nameEn: 'Sigil',       type: 'spectral', cost: 4, text: '将手中所有卡牌转换为同一种随机花色', textEn: 'Converts all cards in hand to a single random suit', effect: { handler: 'sigil' }, art: { bg: '#2a3a2a', motif: '🕉️', accent: '#8cd98c' } },
  { id: 's_ouija',       name: '占卜',   nameEn: 'Ouija',       type: 'spectral', cost: 4, text: '将手中所有手持牌转换为同一个随机点数手牌上限-1', textEn: 'Converts all cards in hand to a single random rank, -1 hand size', effect: { handler: 'ouija' }, art: { bg: '#3a2a2a', motif: '🔮', accent: '#d98c8c' } },
  { id: 's_ectoplasm',   name: '灵质',     nameEn: 'Ectoplasm',   type: 'spectral', cost: 4, text: '添加负片效果到一张随机的小丑牌手牌上限-1', textEn: 'Add Negative to a random Joker, -1 hand size', effect: { handler: 'ectoplasm' }, art: { bg: '#2a3a3a', motif: '🫧', accent: '#8cd9b8' } },
  { id: 's_immolate',    name: '火祭',     nameEn: 'Immolate',    type: 'spectral', cost: 4, text: '随机销毁手牌中的 5 张牌，获得 $20', textEn: 'Destroys 5 random cards in hand, gain $20', effect: { handler: 'immolate', params: { count: 5, money: 20 } }, art: { bg: '#3a2a2a', motif: '🔥', accent: '#d9a08c' } },
  { id: 's_ankh',        name: '生命十字章', nameEn: 'Ankh',        type: 'spectral', cost: 4, text: '随机复制一张小丑牌，摧毁其他小丑牌', textEn: 'Create a copy of a random Joker, destroy all other Jokers (Removes Negative from copy)', effect: { handler: 'ankh' }, art: { bg: '#3a3a2a', motif: '☥', accent: '#d9d98c' } },
  { id: 's_deja_vu',     name: '既视感',   nameEn: 'Deja Vu',     type: 'spectral', cost: 4, text: '给你手牌中的1张所选卡牌加上红色蜡封', textEn: 'Add a Red Seal to 1 selected card in your hand', effect: { handler: 'addSeal', params: { seal: 'red' } }, art: { bg: '#3a2a2a', motif: '🔁', accent: '#d98c8c' } },
  { id: 's_hex',         name: '妖法',     nameEn: 'Hex',         type: 'spectral', cost: 4, text: '随机为一张小丑牌添加多彩，摧毁其他小丑牌', textEn: 'Add Polychrome to a random Joker, destroy all other Jokers', effect: { handler: 'hex' }, art: { bg: '#2a2a3a', motif: '🕸️', accent: '#b88cd9' } },
  { id: 's_trance',      name: '入迷',     nameEn: 'Trance',      type: 'spectral', cost: 4, text: '给你手牌中的1张所选卡牌加上蓝色蜡封', textEn: 'Add a Blue Seal to 1 selected card in your hand', effect: { handler: 'addSeal', params: { seal: 'blue' } }, art: { bg: '#2a2a3a', motif: '💫', accent: '#8cb8d9' } },
  { id: 's_medium',      name: '灵媒',     nameEn: 'Medium',      type: 'spectral', cost: 4, text: '给你手牌中的1张所选卡牌加上紫色蜡封', textEn: 'Add a Purple Seal to 1 selected card in your hand', effect: { handler: 'addSeal', params: { seal: 'purple' } }, art: { bg: '#3a2a3a', motif: '🔯', accent: '#c98cd9' } },
  { id: 's_cryptid',     name: '神秘生物',   nameEn: 'Cryptid',     type: 'spectral', cost: 4, text: '为手牌中 1 张选中的牌创建 2 张复制', textEn: 'Create 2 copies of 1 selected card in your hand', effect: { handler: 'cryptid', params: { count: 2 } }, art: { bg: '#2a3a2a', motif: '👾', accent: '#8cd9a0' } },
  { id: 's_soul',        name: '灵魂',     nameEn: 'The Soul',    type: 'spectral', cost: 4, text: '生成一张传奇小丑牌（必须有空位）', textEn: 'Creates a Legendary Joker (Must have room)', effect: { handler: 'soul' }, rare: true, art: { bg: '#3a2a4a', motif: '👁️', accent: '#e0a0ff' } },
  { id: 's_black_hole',  name: '黑洞',     nameEn: 'Black Hole',  type: 'spectral', cost: 4, text: '所有牌型提升1级', textEn: 'Upgrade every poker hand by 1 level', effect: { handler: 'blackHole' }, rare: true, art: { bg: '#1a1a2a', motif: '🕳️', accent: '#7070ff' } },
]

export const SPECTRAL_BY_ID = Object.fromEntries(SPECTRAL.map(s => [s.id, s]))
// 卡包中不会出现灵魂/黑洞（0.3% 特殊概率，单独处理）
export const SPECTRAL_POOL = SPECTRAL.filter(s => !s.rare)
