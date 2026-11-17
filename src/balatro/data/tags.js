// Balatro 标签（Tag，24 个全量，跳过小盲/大盲获得）
// 数据来源：balatrowiki.org/Tags（已核对官方效果）
// minAnte = 可出现的最低 Ante（Ante 1 只有 15 种）

export const TAGS = [
  { id: 'tag_boss',        name: '老板标签',   nameEn: 'Boss Tag',        minAnte: 1, text: '重掷 Boss 盲注', effect: { handler: 'bossReroll' } },
  { id: 'tag_buffoon',     name: '小丑标签',   nameEn: 'Buffoon Tag',     minAnte: 2, text: '获得 1 个免费的超级小丑包', effect: { handler: 'freePack', params: { pack: 'pack_buffoon_mega' } } },
  { id: 'tag_charm',       name: '魅力标签',   nameEn: 'Charm Tag',       minAnte: 1, text: '获得 1 个免费的超级秘术包', effect: { handler: 'freePack', params: { pack: 'pack_arcana_mega' } } },
  { id: 'tag_coupon',      name: '优惠券标签', nameEn: 'Coupon Tag',      minAnte: 1, text: '下个商店的初始卡牌与卡包免费', effect: { handler: 'coupon' } },
  { id: 'tag_d6',          name: 'D6 标签',    nameEn: 'D6 Tag',          minAnte: 1, text: '下个商店的重掷费用从 $0 开始', effect: { handler: 'd6' } },
  { id: 'tag_double',      name: '双倍标签',   nameEn: 'Double Tag',      minAnte: 1, text: '复制下一个获得的标签（双倍标签除外）', effect: { handler: 'double' } },
  { id: 'tag_economy',     name: '经济标签',   nameEn: 'Economy Tag',     minAnte: 1, text: '金钱翻倍（最多 $40）', effect: { handler: 'economy', params: { max: 40 } } },
  { id: 'tag_ethereal',    name: '幻灵标签',   nameEn: 'Ethereal Tag',    minAnte: 2, text: '获得 1 个免费的幻灵包', effect: { handler: 'freePack', params: { pack: 'pack_spectral_normal' } } },
  { id: 'tag_foil',        name: '闪箔标签',   nameEn: 'Foil Tag',        minAnte: 1, text: '商店中下一张基础版小丑免费并变为闪箔', effect: { handler: 'editionJoker', params: { edition: 'foil' } } },
  { id: 'tag_garbage',     name: '垃圾标签',   nameEn: 'Garbage Tag',     minAnte: 2, text: '本局每个未使用的弃牌次数获得 $1', effect: { handler: 'garbage' } },
  { id: 'tag_handy',       name: '顺手标签',   nameEn: 'Handy Tag',       minAnte: 2, text: '本局每打出过 1 手牌获得 $1', effect: { handler: 'handy' } },
  { id: 'tag_holo',        name: '全息标签',   nameEn: 'Holographic Tag', minAnte: 1, text: '商店中下一张基础版小丑免费并变为全息', effect: { handler: 'editionJoker', params: { edition: 'holo' } } },
  { id: 'tag_investment',  name: '投资标签',   nameEn: 'Investment Tag',  minAnte: 1, text: '击败下一个 Boss 盲注后获得 $25', effect: { handler: 'investment', params: { money: 25 } } },
  { id: 'tag_juggle',      name: '杂耍标签',   nameEn: 'Juggle Tag',      minAnte: 1, text: '下一回合手牌上限 +3', effect: { handler: 'juggle', params: { handSize: 3 } } },
  { id: 'tag_meteor',      name: '流星标签',   nameEn: 'Meteor Tag',      minAnte: 2, text: '获得 1 个免费的超级天体包', effect: { handler: 'freePack', params: { pack: 'pack_celestial_mega' } } },
  { id: 'tag_negative',    name: '负片标签',   nameEn: 'Negative Tag',    minAnte: 2, text: '商店中下一张基础版小丑免费并变为负片', effect: { handler: 'editionJoker', params: { edition: 'negative' } } },
  { id: 'tag_orbital',     name: '轨道标签',   nameEn: 'Orbital Tag',     minAnte: 2, text: '随机牌型升级 3 级', effect: { handler: 'orbital', params: { levels: 3 } } },
  { id: 'tag_poly',        name: '多彩标签',   nameEn: 'Polychrome Tag',  minAnte: 1, text: '商店中下一张基础版小丑免费并变为多彩', effect: { handler: 'editionJoker', params: { edition: 'poly' } } },
  { id: 'tag_rare',        name: '稀有标签',   nameEn: 'Rare Tag',        minAnte: 1, text: '商店出现 1 张免费的稀有小丑', effect: { handler: 'rarityJoker', params: { rarity: 3 } } },
  { id: 'tag_speed',       name: '速度标签',   nameEn: 'Speed Tag',       minAnte: 1, text: '本局每跳过 1 个盲注获得 $5', effect: { handler: 'speed', params: { per: 5 } } },
  { id: 'tag_standard',    name: '标准标签',   nameEn: 'Standard Tag',    minAnte: 2, text: '获得 1 个免费的超级标准包', effect: { handler: 'freePack', params: { pack: 'pack_standard_mega' } } },
  { id: 'tag_top_up',      name: '充值标签',   nameEn: 'Top-up Tag',      minAnte: 2, text: '生成至多 2 张普通小丑（需有空位）', effect: { handler: 'topUp', params: { count: 2 } } },
  { id: 'tag_uncommon',    name: '罕见标签',   nameEn: 'Uncommon Tag',    minAnte: 1, text: '商店出现 1 张免费的罕见小丑', effect: { handler: 'rarityJoker', params: { rarity: 2 } } },
  { id: 'tag_voucher',     name: '礼券标签',   nameEn: 'Voucher Tag',     minAnte: 1, text: '下个商店额外出现 1 张优惠券', effect: { handler: 'voucher' } },
]

export const TAGS_BY_ID = Object.fromEntries(TAGS.map(t => [t.id, t]))
