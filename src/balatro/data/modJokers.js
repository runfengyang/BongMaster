// Balatro 社区 Mod 小丑（§15：135 张全量，真实 Mod 源码复刻 + 官方像素图）
// §15 数据来源（均为本地克隆的真实 Mod 仓库，字段/坐标直接解析其 Lua 源码）：
//   Pampa Joker Pack  work/pampa/PampaJokers.lua（Matelote，30 张；图集 assets/1x/Jokers_mtl.png）
//   Jelly's Jokers    work/jellymod/JellyJokers.lua（JamesTheJellyfish，30 张；图集 assets/1x/Jokers_JellyMod.png）
//   7 Deadly Sins     work/yuni/sevendeadlysins/sevendeadlysins.lua（Alex Davies，8 张；图集 assets/1x/jokers.png）
//   Olympus           work/mods/olympus/olympus.lua（6 张；assets/1x/j_*.png 单瓦片拼接）
//   PiJoker           work/mods/pijoker/PiJoker.lua（Beeks17，1 张；assets/1x/j_pi(grassy).png）
//   MikasBalatro      work/mods/mika/MikasModCollection.lua（Mika，60 张；assets/1x/j_mmc_*.png 单瓦片拼接）
// 忠实性说明：nameEn/textEn 为 Mod 源码 localization 原文（已剥离 {C:..} 标记、保留 #n# 变量）；
//   中文名/效果为简洁译写，变量数值以「X」占位（不臆造）。稀有度/cost 为 Mod 原值。
// 这些卡仅用于图鉴收藏与 Buffoon 包混入演出，不进 Run 卡池、不参与引擎计分；
// effect.handler 仅为占位声明（不接线）。
// pos/soul 为各 Mod 图集 71×95 瓦片坐标（供 gen-sprite-map.mjs §3c 生成 SPRITE_MAP）：
//   Pampa → mod_pampa（10×6）；JellyMod → mod_jelly（10×18）；7DeadlySins → mod_yuni（8×2）
//   Olympus → mod_olympus（6×1）；PiJoker → mod_pijoker（1×1）；MikasBalatro → mod_mika（10×6）
// rarity: 1普通 2罕见 3稀有 4传奇；type 固定 'joker'

const A = (bg, motif, accent) => ({ bg, motif, accent })
const ART = {
  Pampa: A('#3a2f4a', '🃏', '#c9b8e8'),
  JellyMod: A('#2a4a3a', '🍮', '#a0e8c0'),
  '7DeadlySins': A('#4a2a2a', '😈', '#ff9c80'),
  Olympus: A('#2a3a5a', '🏛️', '#a8c8ff'),
  PiJoker: A('#3a4a2a', '🥧', '#c8e8a0'),
  MikasBalatro: A('#4a3a2a', '🎪', '#ffd8a0'),
}
const J = (id, name, nameEn, mod, rarity, cost, text, textEn, pos, soul = null) => ({
  id, name, nameEn, mod, type: 'joker', rarity, cost, text, textEn, unlock: null,
  pos, ...(soul ? { soul } : {}), art: ART[mod], effect: { handler: 'noop', params: {} },
})

export const MOD_JOKERS = [
  // ===== Pampa（30，图集 mod_pampa）=====
  J('mj_pam_jazztrio', '爵士三重奏', 'Jazz Trio', 'Pampa', 1, 4, '出牌含计分的 J、Q、K 各一张时，升级 2 个随机牌型', 'When played hand contains a scoring Jack, Queen and King, upgrade 2 random Poker Hands', { x: 0, y: 0 }),
  J('mj_pam_subway', '地铁图', 'Subway Map', 'Pampa', 1, 5, '出牌含迄今最大顺子时 +X 倍率（当前 +X）', 'Gains +#1# Mult if played hand contains the highest Straight so far. (Currently: +#2#)', { x: 3, y: 0 }),
  J('mj_pam_snecko', '蛇眼', 'Snecko Eye', 'Pampa', 2, 6, '每回合首次摸到的牌，其点数永久随机化', 'The ranks of first drawn cards each round are permanently randomized.', { x: 5, y: 1 }),
  J('mj_pam_sealbouquet', '蜡封花束', 'Seal Bouquet', 'Pampa', 2, 7, '黑桃同花的首张牌若带蜡封，随机另一张牌获得随机蜡封', 'If first card of a Spades flush contains a seal, add a random seal to another random card.', { x: 0, y: 2 }),
  J('mj_pam_mixtape', '混音带', 'Mixtape', 'Pampa', 2, 7, '回合结束时，牌组中每张增强梅花 +$X（当前 $X）', 'Gain $#1# at the end of round for each enchanced Clubs card in your deck. (Currently $#2#)', { x: 1, y: 2 }),
  J('mj_pam_bikini', '虎纹比基尼', 'Tiger Bikini', 'Pampa', 2, 7, '牌组中红桃超过 X 张的部分，每张 +X 倍率（当前 +X）', '+#1# Mult for each hearts card above #2# in your full deck (Currently +#3# Mult)', { x: 1, y: 0 }),
  J('mj_pam_flamingo', '火烈鸟', 'Flamingo', 'Pampa', 2, 7, '打出时，方块牌有 X/X 概率变为多彩', 'When played, Diamonds cards have #1# in #2# chance to become polychrome.', { x: 2, y: 2 }),
  J('mj_pam_sliding', '滑动小丑', 'Sliding Joker', 'Pampa', 1, 4, '含同花的出牌 +X 倍率，含顺子的出牌 +X 筹码；每底注重置', 'Gains +#1# Mult for each hand containing a Flush. Gains +#2# Chips for each hand containing a Straight. Resets at the end of each ante.', { x: 4, y: 0 }),
  J('mj_pam_claw', '利爪', 'Claw', 'Pampa', 2, 6, '打出任意 3 时，牌组中所有 3 永久 +X 筹码', 'When any 3 is played, permanently give +#1# chips to ALL 3s in the deck.', { x: 4, y: 1 }),
  J('mj_pam_mahjong', '麻将小丑', 'Mahjong Joker', 'Pampa', 2, 6, '每 X 手含三条的出牌获得 X 倍率（当前 X）', 'Gains X#1# Mult for every #2# hands containing Three of a Kind (Currently X#4# Mult)', { x: 6, y: 0 }),
  J('mj_pam_blackstar', '黑星', 'Black Star', 'Pampa', 3, 8, '免于落败一次；触发后销毁所有小丑并补发 2 张随机稀有小丑', 'Prevents death once. Destroy all jokers and replace them with 2 random rare jokers.', { x: 7, y: 0 }),
  J('mj_pam_moon', '月兔', 'Moon Rabbit', 'Pampa', 1, 5, '打出含葫芦的牌型时，X/X 概率生成 1 张「愚者」复制', '#1# in #2# chance to generate a copy of The Fool when a hand containing a Full House is played', { x: 0, y: 1 }),
  J('mj_pam_bell', '钟形曲线', 'Bell Curve', 'Pampa', 1, 5, '每回合首次摸牌时，随机 1 张牌增强为幸运牌', 'Enhance one random card into a Lucky Card when first hand is drawn', { x: 3, y: 1 }),
  J('mj_pam_konbini', '便利店', 'Konbini', 'Pampa', 1, 4, '本局每使用过 1 种塔罗牌 +X 倍率（当前 +X）', 'Gains +#1# mult per unique Tarot card used this run (Currently +#2#)', { x: 3, y: 2 }),
  J('mj_pam_3776', '三七七六', '3776', 'Pampa', 2, 6, '打出的 3、6、7 计分时 +X 倍率；重新触发所有 7', 'Each played 3, 6 or 7, gives +#1# Mult when scored. Retrigger all 7', { x: 4, y: 2 }),
  J('mj_pam_pampa', '潘帕', 'Pampa', 'Pampa', 1, 5, '回合结束 +$X；每回合结束有 X/X 概率自毁', 'Gain $#1# at the end of round. #2# in #3# chance this card is destroyed at end of round', { x: 5, y: 2 }),
  J('mj_pam_voodoo', '巫毒娃娃', 'Voodoo Doll', 'Pampa', 2, 6, '本回合每打出过 1 种点数 X 倍率', 'X#1# Mult for each unique played rank already played this round. (Played ranks: #2#)', { x: 9, y: 1 }),
  J('mj_pam_cherry', '樱桃', 'Cherry', 'Pampa', 1, 4, '每弃掉 1 个对子 +X 倍率；弃掉 X 个对子后自毁（当前 +X）', 'Gains +#1# Mult whenever a pair is discarded. Destroyed after #3# pairs discarded (Currently: +#2# Mult)', { x: 2, y: 0 }),
  J('mj_pam_cafeg', '咖啡美食家', 'Café Gourmand', 'Pampa', 1, 4, '本回合出牌次数不超过 X 时 +X 筹码', '+#1# chips if hand has been played #2# times or less.', { x: 8, y: 1 }),
  J('mj_pam_pimpbus', '豪华巴士', 'Pimp The Bus', 'Pampa', 2, 6, '连续打出含增强/版本/蜡封的计分牌型，每次 X 倍率递增（当前 X）', 'Gains x#1# Mult for each consecutive scoring hand with at least one enhancement, edition or seal (Currently x#2#)', { x: 7, y: 1 }),
  J('mj_pam_selfpaint', '自画像', 'Self Portrait', 'Pampa', 2, 6, '首张未计分的人头牌变为随机非人头点数', 'First unscoring face card turns into a random non-face rank.', { x: 8, y: 2 }),
  J('mj_pam_matry', '套娃', 'Matryoshka', 'Pampa', 1, 5, '本回合每打出 1 种不同计分牌数 +X 筹码', '+#1# chips for each unique scoring hand size played this round', { x: 2, y: 1 }),
  J('mj_pam_mathurine', '玛蒂琳', 'Mathurine', 'Pampa', 4, 15, '固定所有小丑并 3 次复制右侧小丑能力；每次出牌后向右移动一格', 'Pins all jokers and copies ability of joker to the right thrice. Each time a hand is played, move Mathurine one step to the right.', { x: 6, y: 1 }),
  J('mj_pam_trick', '不给糖就捣蛋', 'Trick or Treat', 'Pampa', 3, 8, '每使用 1 张幻灵牌 X 倍率（当前 X）', 'Gains x#1# Mult for each Spectral card used (Currently x#2#)', { x: 9, y: 0 }),
  J('mj_pam_13', '数字13', 'Number 13', 'Pampa', 3, 8, '任意玻璃牌碎裂时，向牌组加入 1 张玻璃 13', 'When any Glass Card breaks add one Glass Rank 13 card to your deck', { x: 1, y: 1 }),
  J('mj_pam_fabric', '织物设计', 'Fabric Design', 'Pampa', 3, 8, '选择盲注时失去全部弃牌且牌组所有牌获得随机增强；被移除时全部还原', 'When Blind is selected lose all Discards and apply a random enhancement to all cards in the deck. When removed, turn all cards back to normal.', { x: 7, y: 2 }),
  J('mj_pam_open', '大满贯', 'Grand Slam', 'Pampa', 2, 6, '本回合每种已打出的同花花色 X 倍率（当前 X）', 'x#1# Mult for each unique flush suit played this round (Currently x#2# Mult)', { x: 8, y: 0 }),
  J('mj_pam_thedream', '梦境', 'The Dream', 'Pampa', 3, 8, '打出隐藏牌型时将其升级', 'Level Up secret poker hands when played', { x: 0, y: 3 }),
  J('mj_pam_ishihara', '石原色觉测试', 'Ishihara Test', 'Pampa', 1, 5, '所有 9 和 6 打出时视为万能牌', 'All 9 and 6 become Wild cards when played.', { x: 9, y: 2 }),
  J('mj_pam_scopedog', '眼镜斗犬', 'Scopedog', 'Pampa', 2, 6, '打出含 A 三条的牌型时，禁用 Boss 盲注', 'Playing a hand containing an Aces Three of a Kind disables the Boss Blind', { x: 5, y: 0 }),

  // ===== JellyMod（30，图集 mod_jelly）=====
  J('mj_jel_tarlton', '塔尔顿', 'Tarlton', 'JellyMod', 4, 20, '复制你拥有的所有其他小丑的效果（需兼容）', 'Copies the effects of all other Jokers In your possession. (must be compatible)', { x: 1, y: 16 }, { x: 1, y: 9 }),
  J('mj_jel_pierrot', '皮埃罗', 'Pierrot', 'JellyMod', 4, 20, '出牌时可多选择并打出 1 张牌', 'Allows for +1 card to be selected and played,', { x: 5, y: 16 }, { x: 0, y: 9 }),
  J('mj_jel_lipographic_jokr', '缺字小丑', 'Lipographic Jokr', 'JellyMod', 2, 5, '所有计分牌 +X 倍率；牌面别名含第五符号的计分牌 -X 倍率', 'will grant +#1# mult according to all scoring cards. Grants -#2# mult for all fifth symbol in alias of scoring card.', { x: 2, y: 16 }),
  J('mj_jel_oops_1s', '全是1', 'Oops! All 1s', 'JellyMod', 1, 4, '所有列出的概率减半（如 1/3 → 1/6）', 'Halves all listed probabilities (ex: 1 in 3 -> 1 in 6)', { x: 3, y: 16 }),
  J('mj_jel_safari', '狩猎旅行', 'Safari Joker', 'JellyMod', 3, 7, '所有牌视为同一花色', 'All cards will now count as the same suit', { x: 4, y: 16 }),
  J('mj_jel_copycat', '模仿猫', 'Copycat', 'JellyMod', 3, 10, '随机复制你拥有的 1 张小丑的能力（当前复制：X）', 'Copies ability of a random Joker in your possession (currently copying #1#)', { x: 0, y: 16 }),
  J('mj_jel_pessimist', '悲观者', 'Pessimist', 'JellyMod', 3, 10, '卖出此牌：随机 1 张小丑变为负片；永久 -X 手牌（选择盲注时自毁）', 'sell this card to apply negative to a random Joker. Permanent -#1# hands. (Destroys itself when blind selected)', { x: 6, y: 16 }),
  J('mj_jel_prosopagnosia', '脸盲症', 'Prosopagnosia', 'JellyMod', 1, 5, '所有牌均不视为人头牌', 'NO cards are considered face cards', { x: 7, y: 16 }),
  J('mj_jel_double_vision', '重影', 'Double Vision', 'JellyMod', 3, 10, '所有牌均视为 2', 'All cards are considered 2s', { x: 8, y: 16 }),
  J('mj_jel_scouter', '战斗力探测器', 'Scouter Joker', 'JellyMod', 1, 4, '显示当前牌型的预期得分（含全部加成；条件效果或有误差）', 'Tells you what a given hand would score, including all bonuses. (May not score correctly for conditional effects, such as Wee Joker or Blackboard)', { x: 9, y: 16 }),
  J('mj_jel_zeno', '芝诺小丑', "Zeno's Joker", 'JellyMod', 3, 8, '若本回合摸牌达到牌组一半，销毁 1 张未摸到的随机牌并生成 1 张幻灵牌', "if you draw at least 50% of your deck during the round, a random card you didn't draw will be destroyed and a Spectral card will be created", { x: 0, y: 17 }),
  J('mj_jel_one_more', '再来一次！', 'One More Time!', 'JellyMod', 1, 8, '卖出此牌：将上一手牌的得分加入当前得分（当前 X）', 'Sell this card to Add your previous hand to current score (Currently #1#)', { x: 1, y: 17 }),
  J('mj_jel_collector', '收藏家', 'The Collector', 'JellyMod', 3, 7, '每拥有 1 张非基础版本的小丑 X 倍率（当前 X）', 'This Joker gains X#1# Mult for each non-base edition Joker you have. (Currently X#2# Mult)', { x: 2, y: 17 }),
  J('mj_jel_buckleswasher', '右邻跟班', 'Buckleswasher', 'JellyMod', 2, 4, '将此牌右侧所有小丑的售价加为倍率（当前 +X）', 'Adds the sell value of all owned Jokers RIGHT of this card to Mult (Currently +#1# Mult)', { x: 3, y: 17 }),
  J('mj_jel_hatter', '疯帽匠', 'Mad Hatter', 'JellyMod', 2, 7, '洗乱打出牌的增强、蜡封与版本', 'shuffles the Enhancements, Seals, and Editions of played hand', { x: 4, y: 17 }),
  J('mj_jel_greener_pastures', '彼岸草更绿', 'Greener Pastures', 'JellyMod', 2, 8, '选择盲注时生成 1 张售价恒为 $0 的随机负片小丑，每回合销毁重换', 'When blind is selected, creates a random negative Joker that always sells for $0. The joker is destroyed and replaced every round.', { x: 5, y: 17 }),
  J('mj_jel_special_snowflake', '特殊雪花', 'Special Snowflake', 'JellyMod', 2, 6, '牌组中每种独特增强组合 X 倍率（当前 X）', 'This Joker gains X#1# Mult for each Uniquely enhanced card in your full deck (ex: gold, gold with red seal, steel, etc.) (Currently X#2# Mult)', { x: 6, y: 17 }, { x: 7, y: 17 }),
  J('mj_jel_glutton_joker', '饕餮小丑', 'Glutton Joker', 'JellyMod', 2, 6, '本局每被吃掉 1 张食物小丑 X 倍率（当前 X）', 'x#1# Mult for every food joker that has been consumed this game Currently x#2# Mult', { x: 2, y: 14 }),
  J('mj_jel_mineral_deposit', '矿脉', 'Mineral Deposit', 'JellyMod', 2, 5, '重新触发所有无点数或无花色的牌', 'retriggers all cards that have no rank or suit', { x: 1, y: 14 }),
  J('mj_jel_brownie', '两口布朗尼', 'Two-Bite Brownie', 'JellyMod', 1, 4, '重新触发所有 2 共 X 次，每回合递减 X', 'retriggers all twos #1# times reduces by #2# each round', { x: 0, y: 14 }),
  J('mj_jel_caviar', '鱼子酱', 'Caviar', 'JellyMod', 2, 2, '每打出 1 手牌 +$X，每回合递减 X', 'gives $#1# per hand played. reduces by #2# each round,', { x: 9, y: 15 }),
  J('mj_jel_chef_joker', '厨师小丑', 'Chef Joker', 'JellyMod', 2, 5, '选择盲注时，生成 1 张随机食物小丑（需空位）', 'When blind is selected, create a random food joker (Must have room.)', { x: 8, y: 15 }),
  J('mj_jel_pink_menace', '粉红威胁', 'The Pink Menace', 'JellyMod', 2, 3, '选择盲注时，若右侧是食物小丑则吃掉它，下回合获得其双倍收益', 'When blind is selected, if the card to the right of this one is a food joker, consume it, and for the next round, The Pink Menace provides twice the benefit that you would have received from the food joker.', { x: 7, y: 15 }),
  J('mj_jel_greedy_pot', '贪心锅', 'Greedy Pot', 'JellyMod', 3, 10, '出牌或弃牌后，总是多摸 2 张牌', 'After play or discard, always draw 2 more cards than you would otherwise.', { x: 6, y: 15 }),
  J('mj_jel_magnate', '富豪', 'Magnate', 'JellyMod', 2, 5, '标准包只含与牌组中已有牌同点数同花色的牌', 'standard packs will only contain cards that are the same rank and suit as cards already in your deck.', { x: 5, y: 15 }),
  J('mj_jel_edition_eater', '版本吞噬者', 'Edition Eater', 'JellyMod', 2, 8, '选择盲注时移除右侧小丑的版本，按版本获得 X 倍率（负片且无空位时销毁之）', "When blind is Selected, removes the edition of the joker to its right. Gains xN Mult per edition eaten. (N = Foil x#1#, Holographic x#2#, Negative x#4#, Polychrome x#3#) (Will Destroy the joker if it's negative and there's no room) Currently x#5# Mult.", { x: 4, y: 15 }),
  J('mj_jel_krampus', '坎卜斯', 'Krampus', 'JellyMod', 2, 6, '每个盲注开始时，向手牌加入 1 张煤块牌', 'Adds a Coal Card to your hand at the start of each blind.', { x: 3, y: 15 }),
  J('mj_jel_fridge', '冰箱', 'Fridge', 'JellyMod', 2, 3, '食物小丑不再腐坏或灭绝', 'Food Jokers no longer decay or go extinct.', { x: 2, y: 15 }),
  J('mj_jel_furnace', '熔炉', 'Furnace', 'JellyMod', 3, 6, '所有煤块牌同时升级', 'all coal cards upgrade at the same time', { x: 1, y: 15 }),
  J('mj_jel_wise_penny', '明智便士', 'Wise Penny', 'JellyMod', 2, 7, '若在商店未消费，随机 1 张无蜡封牌获得黄金蜡封', "if you don't spend money at a shop, a random nonsealed card gets a gold seal", { x: 0, y: 15 }),

  // ===== 7DeadlySins（8，图集 mod_yuni）=====
  J('mj_sds_sloth', '懒惰', 'Sloth', '7DeadlySins', 2, 6, '每次在商店消费失去 X0.25 倍率，击败 Boss 盲注后重置（当前 X）', 'This Joker loses X#2# Mult each time you buy from the shop, resets when Boss Blind is defeated (Currently X#1# Mult)', { x: 1, y: 0 }),
  J('mj_sds_gluttony', '暴食', 'Gluttony', '7DeadlySins', 2, 6, '每销毁 1 张牌 +8 筹码（当前 +X）', 'This joker gains +#2# Chips per card destroyed (Currently +#1# Chips)', { x: 0, y: 0 }),
  J('mj_sds_pride', '傲慢', 'Pride', '7DeadlySins', 2, 6, '其他小丑按稀有度给倍率：普通+2 / 罕见+4 / 稀有+8 / 传奇+16', 'Other Jokers give Mult based on rarity Common: +2 Mult Uncommon: +4 Mult Rare: +8 Mult Legendary: +16 Mult', { x: 3, y: 0 }),
  J('mj_sds_lust', '色欲', 'Lust', '7DeadlySins', 2, 6, '出牌同时含计分的 K 和 Q 时 +100 筹码', '+#1# Chips if played hand contains both a scoring King and Queen', { x: 2, y: 0 }),
  J('mj_sds_wrath', '暴怒', 'Wrath', '7DeadlySins', 2, 6, '选择盲注时，销毁随机 1 张小丑并生成 1 张随机幻灵牌（可能自毁）', 'When Blind is selected, destroy a random Joker then create a random Spectral card (Can destroy self)', { x: 5, y: 0 }),
  J('mj_sds_greed', '贪婪', 'Greed', '7DeadlySins', 2, 6, '每持有 $15 获得 X0.25 倍率（当前 X）', 'Gains X#1# Mult for every #2#$ you have (Currently X#3#)', { x: 6, y: 0 }),
  J('mj_sds_envy', '嫉妒', 'Envy', '7DeadlySins', 2, 6, '将计分牌中最高与最低点数之差的三倍加为倍率', 'Adds triple the difference in rank between the lowest and highest scoring cards to Mult', { x: 4, y: 0 }),
  J('mj_sds_sin', '原罪', 'Sin', '7DeadlySins', 3, 6, '伪装成随机一宗罪；击败 Boss 盲注后更换伪装', 'Disguises as a random Sin Sin changes when Boss Blind is defeated', { x: 7, y: 1 }, { x: 7, y: 0 }),

  // ===== Olympus（6，图集 mod_olympus）=====
  J('mj_oly_artemis', '阿尔忒弥斯', 'Artemis', 'Olympus', 3, 8, '选择盲注时生成 1 张「月亮」塔罗牌', "Creates a The Moon Tarot card when Blind is selected", { x: 0, y: 0 }),
  J('mj_oly_apollo', '阿波罗', 'Apollo', 'Olympus', 3, 8, '选择盲注时生成 1 张「太阳」塔罗牌', "Creates a The Sun Tarot card when Blind is selected", { x: 1, y: 0 }),
  J('mj_oly_hephaestus', '赫菲斯托斯', 'Hephaestus', 'Olympus', 3, 8, '所有牌计分时变为钢铁牌', "All cards become Steel cards when scored", { x: 2, y: 0 }),
  J('mj_oly_hades', '哈迪斯', 'Hades', 'Olympus', 2, 5, '回合第一手仅有 1 张牌时，销毁之并获得 $3', "If first hand of round has only 1 card, destroy it and earn $3", { x: 3, y: 0 }),
  J('mj_oly_hera', '赫拉', 'Hera', 'Olympus', 2, 6, '每张打出的 Q 计分时 +13 倍率', "Each played Queen gives +13 Mult when scored", { x: 4, y: 0 }),
  J('mj_oly_zeus', '宙斯', 'Zeus', 'Olympus', 2, 6, '每张打出的 K 计分时 +13 倍率', "Each played King gives +13 Mult when scored", { x: 5, y: 0 }),

  // ===== PiJoker（1，图集 mod_pijoker）=====
  J('mj_pi_pi', '圆周率小丑', 'Pi Joker', 'PiJoker', 3, 7, '每有 1 个未计分的连续 π 数字，X 倍率递增；数字错误时失去增幅；10 与人头牌视为 0、A 视为 1（当前 X）', 'This Joker gains X#1# Mult for every non-scoring played consecutive digit of Pi. Loses X#1# on incorrect digit. 10s & face cards count as 0s, Aces as 1s. Next five digits of Pi: #2# (Currently X#3#)', { x: 0, y: 0 }),

  // ===== MikasBalatro（60，图集 mod_mika）=====
  J('mj_mik_prime_time', '黄金时段', 'Prime Time', 'MikasBalatro', 1, 4, '打出的 2、3、5、7 或 A 计分时给予 X 倍率', 'Each played 2, 3, 5, 7 or Ace, gives X#1# Mult when scored', { x: 0, y: 0 }),
  J('mj_mik_straight_nate', '顺子内特', 'Straight Nate', 'MikasBalatro', 3, 7, '出牌含顺子且同时拥有奇数托德与偶数史蒂文时 X 倍率；+X 小丑槽', 'X#1# Mult if played hand contains a Straight and you have both Odd Todd and Even Steven Gives +#2# Joker slot', { x: 1, y: 0 }),
  J('mj_mik_fisherman', '渔夫', 'The Fisherman', 'MikasBalatro', 2, 6, '每弃 1 次牌 +X 手牌上限，每出 1 次牌 -X 手牌上限；每回合重置（当前 +X）', '+#2# hand size per discard -#2# hand size per hand played Resets every round (Currently +#1# hand size)', { x: 2, y: 0 }),
  J('mj_mik_impatient', '急躁小丑', 'Impatient Joker', 'MikasBalatro', 2, 6, '每弃 1 张牌 +X 倍率；每回合重置（当前 +X）', '+#2# Mult per card discarded Resets every round (Currently +#1# Mult)', { x: 3, y: 0 }),
  J('mj_mik_cultist', '邪教徒', 'Cultist', 'MikasBalatro', 3, 8, '每出 1 次牌 X 倍率递增；每回合重置（当前 X）', 'X#2# Mult per hand played Resets every round (Currently X#1# Mult)', { x: 4, y: 0 }),
  J('mj_mik_seal_collector', '蜡封收藏家', 'Seal Collector', 'MikasBalatro', 1, 4, '每张带蜡封的牌使本小丑 +X 筹码（当前 +X）', 'Gains +#2# Chips for every card with a seal (Currently +#1# Chips)', { x: 5, y: 0 }),
  J('mj_mik_camper', '露营者', 'Camper', 'MikasBalatro', 2, 5, '每张被弃掉的牌永久 +X 筹码', 'Every discarded card permanently gains +#1# Chips', { x: 6, y: 0 }),
  J('mj_mik_scratch_card', '刮刮乐', 'Scratch Card', 'MikasBalatro', 1, 4, '计分 1、2、3、4、5 张 7 时分别获得 $X、$X、$X、$X、$X', 'Gain $#1#, $#2#, $#3#, $#4#, $#5# when 1, 2, 3, 4 or 5 7 cards are scored, respectively', { x: 7, y: 0 }),
  J('mj_mik_delayed', '延迟小丑', 'Delayed Joker', 'MikasBalatro', 2, 7, '第 X 次行动时给予 +X 倍率、+X 筹码与 X 倍率（当前第 X 次）', 'Gives +#1# Mult, +#2# Chips and X#3# Mult on the #5#th action (Current action: #4# )', { x: 8, y: 0 }),
  J('mj_mik_showoff', '炫耀者', 'The Show-Off', 'MikasBalatro', 3, 8, '以 X 倍筹码要求通关盲注时获得 X 倍率（当前 X）', 'Gains X#2# Mult when a blind is finished with X#3# the chip requirement (Currently X#1# Mult)', { x: 9, y: 0 }),
  J('mj_mik_sniper', '狙击手', 'The Sniper', 'MikasBalatro', 3, 10, '以误差不超过 X% 的精准筹码通关盲注时获得 X 倍率（当前 X）', 'Gains X#2# Mult when a blind is finished within #3#% of the exact chip requirement (Currently X#1# Mult)', { x: 0, y: 1 }),
  J('mj_mik_blackjack', '二十一点', 'Blackjack Joker', 'MikasBalatro', 2, 6, '打出牌点数之和恰为 X 时给予 X 倍率；每低 1 点倍率减少 X', 'Gives X#1# Mult when the ranks of all played cards is exactly #2# Gives X#3# Mult less for every point below #2#', { x: 1, y: 1 }),
  J('mj_mik_batman', '蝙蝠侠', 'Batman', 'MikasBalatro', 3, 8, '每次非致命出牌 +X 倍率；名字含蝙蝠标记的小丑会提升增幅（当前 +X）', 'Gains +#2# Mult for every non-lethal hand played Mult gain increases for every Joker with \\ in the name (Currently +#1# Mult)', { x: 2, y: 1 }),
  J('mj_mik_bomb', '炸弹', 'Bomb', 'MikasBalatro', 1, 5, '每回合 +X 倍率，X 回合后自毁（当前 +X）', 'Gains +#2# Mult per round self destructs after #3# rounds (Currently +#1# Mult)', { x: 3, y: 1 }),
  J('mj_mik_eye_chart', '视力表', 'Eye Chart', 'MikasBalatro', 1, 4, '你的小丑名中每有一个字母「X」+X 筹码；每次出现在商店时更换字母', 'Gives +#1# Chips for every letter \\ in your Jokers Letter changes when this Joker appears in the shop', { x: 4, y: 1 }),
  J('mj_mik_grudgeful', '记仇小丑', 'Grudgeful Joker', 'MikasBalatro', 3, 9, '用上一回合的超额筹码抵扣盲注要求，至多抵扣 X%（当前 +X）', 'Lowers blind requirement with excess Chips from last round. Caps at #2#% of current blind\'s Chips (Currently +#1# Chips)', { x: 5, y: 1 }),
  J('mj_mik_finishing_blow', '终结一击', 'Finishing Blow', 'MikasBalatro', 2, 6, '以高牌通关盲注时，随机增强计分牌', 'If a blind is finished with a High Card, randomly Enhance scored cards', { x: 6, y: 1 }),
  J('mj_mik_aurora_borealis', '北极光', 'Aurora Borealis', 'MikasBalatro', 1, 6, '蓝色蜡封额外给予一张负片行星牌', 'Blue Seals give an extra negative Planet card', { x: 7, y: 1 }),
  J('mj_mik_historical', '历史小丑', 'Historical Joker', 'MikasBalatro', 3, 9, '计分牌的点数与顺序和上一手完全相同时，按上一手筹码抵扣盲注要求（上限 X%）', 'If scored cards have the same ranks and order as previous hand, reduce blind requirement by previous hands Chips. Caps at #1#% of current blind\'s Chips', { x: 8, y: 1 }),
  J('mj_mik_suit_alley', '花色巷', 'Suit Alley', 'MikasBalatro', 1, 4, '方块与梅花计分时 +X 筹码；红桃与黑桃计分时 +X 倍率', 'Diamond and Club cards gain +#1# Chips when scored Heart and Spade cards gain +#2# Mult when scored', { x: 9, y: 1 }),
  J('mj_mik_printer', '打印机', 'The Printer', 'MikasBalatro', 3, 9, '出牌得分超过盲注筹码时，复制打出的牌', 'If hand scores more than blind\'s Chips, duplicate played cards', { x: 0, y: 2 }),
  J('mj_mik_training_wheels', '辅助轮', 'Training Wheels', 'MikasBalatro', 2, 6, 'X 倍率；每计分 X 张牌再 +X 倍率（当前已计分 X 张）', 'X#1# Mult, gains X#2# Mult per #4# cards scored Currently #3# cards scored', { x: 1, y: 2 }),
  J('mj_mik_horseshoe', '马蹄铁', 'Horseshoe', 'MikasBalatro', 2, 6, '重新触发所有计分的幸运牌', 'Retrigger all scored Lucky cards', { x: 2, y: 2 }),
  J('mj_mik_incomplete', '残缺小丑', 'Incomplete Joker', 'MikasBalatro', 1, 4, '出牌不超过 X 张时 +X 筹码', '+#1# Chips if played hand contains #2# or fewer cards', { x: 3, y: 2 }),
  J('mj_mik_abbey_road', '艾比路', 'Abbey Road', 'MikasBalatro', 2, 6, '至少 X 种牌型的打出次数相同时，给予 X 倍率', 'If at least #2# poker hands have been played the same amount of times, give X#1# Mult', { x: 4, y: 2 }),
  J('mj_mik_fishing_license', '钓鱼执照', 'Fishing License', 'MikasBalatro', 3, 8, '复制所有计分增强牌的效果', 'Copies effects of all scored Enhanced cards', { x: 5, y: 2 }),
  J('mj_mik_gold_bar', '金条', 'Gold Bar', 'MikasBalatro', 1, 5, '回合结束时，每个金色蜡封与每张金牌 +$X', 'Earn $#1# for every Gold Seal and Gold card at end of round', { x: 6, y: 2 }),
  J('mj_mik_rigged', '出千小丑', 'Rigged Joker', 'MikasBalatro', 1, 5, '每手一次：幸运牌未触发时，所有列出的概率 +X；每回合重置', 'Once per hand, add +#1# to all listed probabilities whenever a Lucky card does not trigger Resets every round', { x: 7, y: 2 }),
  J('mj_mik_commander', '指挥官', 'The Commander', 'MikasBalatro', 3, 9, '回合第一手仅有 X 张牌时，给予其随机增强、蜡封与版本', 'If first hand of round has only #1# card, give it a random Enhancement, Seal and Edition', { x: 8, y: 2 }),
  J('mj_mik_blue_moon', '蓝月', 'Blue Moon', 'MikasBalatro', 2, 8, '一手中触发 X 张幸运牌时，生成一张随机负片小丑', 'If #1# Lucky cards trigger in one hand, create a random negative Joker', { x: 9, y: 2 }),
  J('mj_mik_dagonet', '达戈内特', 'Dagonet', 'MikasBalatro', 4, 20, '其他小丑的基础数值全部翻倍（如可行）', 'Doubles all base values on other Jokers (If possible)', { x: 0, y: 3 }),
  J('mj_mik_glue', '胶水', 'Glue', 'MikasBalatro', 1, 5, '同时拥有「半个小丑」与「残缺小丑」时，+X 小丑槽并给予 X 倍率', 'If you have both Half and Incomplete Joker, give +#2# Joker slots and X#1# Mult', { x: 1, y: 3 }),
  J('mj_mik_harp_seal', '竖琴海豹', 'Harp Seal', 'MikasBalatro', 2, 6, '所有蜡封的效果翻倍', 'Doubles the effect of all Seals', { x: 2, y: 3 }),
  J('mj_mik_football_card', '橄榄球卡', 'Football Card', 'MikasBalatro', 2, 7, '每张普通品质小丑 +X 筹码', 'Common Jokers each give +#1# Chips', { x: 3, y: 3 }),
  J('mj_mik_special_edition', '特别版小丑', 'Special Edition Joker', 'MikasBalatro', 2, 6, '牌组中每个蜡封 +X 倍率、每个增强 +X 筹码、每个版本 X 倍率（当前 +X、+X、X）', 'Gains +#2# Mult per Seal, +#4# Chips per Enhancement and X#6# Mult per Edition for every card in deck (Currently +#1# Mult, +#3#, Chips and X#5# Mult)', { x: 4, y: 3 }),
  J('mj_mik_stockpiler', '囤货者', 'The Stockpiler', 'MikasBalatro', 1, 4, '牌组超过 X 张的部分每 X 张 +X 手牌上限；上限为当前底注（当前 +X）', '+#2# hand size for every #4# cards in deck above #3# Caps at the current Ante (Currently +#1# hand size)', { x: 5, y: 3 }),
  J('mj_mik_student_loans', '助学贷款', 'Student Loans', 'MikasBalatro', 2, 4, '最多可负债 -$X；每负债 -$X 减少 X 次弃牌（当前 X 次）', 'Go up to -$#1# in debt Gives -#4# discard for every -$#2# in debt (Currently #3# discards)', { x: 6, y: 3 }),
  J('mj_mik_broke', '破产小丑', 'Broke Joker', 'MikasBalatro', 1, 2, '每负债 -$X +X 倍率（当前 +X）', 'Gains +#1# Mult per -$#3# (Currently #2# Mult)', { x: 7, y: 3 }),
  J('mj_mik_go_for_broke', '孤注一掷', 'Go For Broke', 'MikasBalatro', 1, 4, '每负债 -$X +X 筹码（当前 +X）', 'Gains +#1# Chips per -$#3# (Currently #2# Chips)', { x: 8, y: 3 }),
  J('mj_mik_street_fighter', '街头霸王', 'Street Fighter', 'MikasBalatro', 2, 7, '余额不高于 -$X 时给予 X 倍率', 'Gives X#1# Mult when balance is at or below -$#2#', { x: 9, y: 3 }),
  J('mj_mik_checklist', '清单', 'Checklist', 'MikasBalatro', 2, 7, '打出「X」牌型时将其提升 X 级；回合结束时更换牌型', 'Playing #1# upgrades it by #2# level, poker hand changes at end of round', { x: 0, y: 4 }),
  J('mj_mik_one_of_us', '我们中的一员', 'One Of Us', 'MikasBalatro', 2, 6, '出牌含 X 张增强牌时，随机 1 张小丑获得随机版本', 'If played hand contains #1# Enhanced cards, give a random Joker a random Edition', { x: 1, y: 4 }),
  J('mj_mik_investor', '投资者', 'The Investor', 'MikasBalatro', 1, 4, '回合结束时 +$X；有 X/X 概率改为 -$X', 'Gives $#1# at end of round. #3# in #2# chance to give -$#1# instead', { x: 2, y: 4 }),
  J('mj_mik_mountain_climber', '登山者', 'Mountain Climber', 'MikasBalatro', 2, 7, '每张打出的牌计分时永久 +X 倍率', 'Every played card permanently gains +#1# Mult when scored', { x: 3, y: 4 }),
  J('mj_mik_shackles', '枷锁', 'Shackles', 'MikasBalatro', 1, 5, '+X 出牌、+X 弃牌、+X 手牌上限；单手打出超过 X 张牌时销毁', '+#1# hand, +#2# discard, +#3# hand size. Destroyed if you play more than #4# cards in one hand', { x: 4, y: 4 }),
  J('mj_mik_buy_one_get_one', '买一送一', 'Buy One Get One', 'MikasBalatro', 1, 5, '购买时有 X/X 概率额外获得 1 张同类随机牌（需有空位）', '#2# in #1# chance to get a random extra card of whatever you\'re buying (Must have room)', { x: 5, y: 4 }),
  J('mj_mik_pack_a_punch', '强化改造', 'Pack A Punch', 'MikasBalatro', 3, 10, '选择盲注时失去 $X，最左侧小丑获得随机版本（覆盖现有版本）', 'When Blind is selected, lose $#1# and give the left-most Joker a random Edition (Will replace current edition)', { x: 6, y: 4 }),
  J('mj_mik_seal_steal', '窃封', 'Seal Steal', 'MikasBalatro', 1, 5, '打出的紫色与蓝色蜡封在计分时也会触发', 'Played Purple and Blue Seals trigger when scored', { x: 7, y: 4 }),
  J('mj_mik_tax_collector', '税务官', 'Tax Collector', 'MikasBalatro', 1, 4, '回合结束时，按稀有度分别为每张小丑给予 $X、$X、$X', 'Gives $#1#, $#2# or $#3# per Joker with the respective rarity at end of round', { x: 8, y: 4 }),
  J('mj_mik_glass_cannon', '玻璃大炮', 'Glass Cannon', 'MikasBalatro', 2, 7, '重新触发所有玻璃牌，但它们必定碎裂', 'Retrigger all Glass Cards, but they are guaranteed to break', { x: 9, y: 4 }),
  J('mj_mik_scoring_test', '计分测验', 'Scoring Test', 'MikasBalatro', 2, 6, '出牌得分低于盲注要求 X% 时，销毁打出的牌', 'If played hand scores less than #1#% of blind requirement destroy it', { x: 0, y: 5 }),
  J('mj_mik_cicero', '西塞罗', 'Cicero', 'MikasBalatro', 4, 20, '不提供倍率、筹码或重新触发的小丑，在商店中变为负片', 'Jokers that do not give Mult, Chips or retriggers will be negative in the shop', { x: 1, y: 5 }),
  J('mj_mik_dawn', '黎明', 'Dawn', 'MikasBalatro', 2, 6, '重新触发回合第一手中所有打出的牌', 'Retrigger all played cards in first hand of round', { x: 2, y: 5 }),
  J('mj_mik_savings', '储蓄', 'Savings', 'MikasBalatro', 2, 6, '每回合 +X 倍率；购买卡牌时重置（当前 +X）', '+#1# Mult per round Resets when buying a card (Currently +#2# Mult)', { x: 3, y: 5 }),
  J('mj_mik_monopolist', '垄断者', 'Monopolist', 'MikasBalatro', 3, 10, 'X 倍率；余额达到 $X 时再 +X 倍率，达成后门槛翻倍', 'X#1# Mult, gains X#2# Mult at $#3#, requirement doubles when met', { x: 4, y: 5 }),
  J('mj_mik_nebula', '星云', 'Nebula', 'MikasBalatro', 1, 5, '所有牌型超过 X 级的部分，等级之和加入倍率', 'Adds all poker hand levels above #1# to Mult', { x: 5, y: 5 }),
  J('mj_mik_cheapskate', '小气鬼', 'Cheapskate', 'MikasBalatro', 1, 0, '跳过补充包时，获得其价格的一半', 'If a Booster Pack is skipped, earn half of it\'s cost', { x: 6, y: 5 }),
  J('mj_mik_psychic', '通灵小丑', 'Psychic Joker', 'MikasBalatro', 1, 5, '+X 筹码；单手打出少于 X 张牌时销毁', '+#1# Chips, destroyed if you play less than #2# cards in one hand', { x: 7, y: 5 }),
  J('mj_mik_cheat', '老千', 'Cheat', 'MikasBalatro', 2, 6, '出牌含顺子时，重新触发所有牌', 'Retrigger all cards if played hand contains a Straight', { x: 8, y: 5 }),
  J('mj_mik_plus_one', '加一', 'Plus One', 'MikasBalatro', 3, 8, '回合第一手中，计分牌点数 +X', 'Increases rank of scored cards by #1# on the first hand of round', { x: 9, y: 5 }),
]

export const MOD_JOKERS_BY_ID = Object.fromEntries(MOD_JOKERS.map(j => [j.id, j]))
