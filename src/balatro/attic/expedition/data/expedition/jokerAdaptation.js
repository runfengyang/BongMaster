// 150 张小丑三档适配登记（契约 §9 Phase E2 交付①：handler 逐张过，§16 老虎机模型修订）
//
// 拉杆模型通用映射（adapter.js 文件头 [M1]-[M9]）：
//   一手 = 一次拉杆；played = 本抽抽中牌；held = 本抽未抽中的池牌（钢铁/男爵/射月由此生效）；
//   金钱 = 研料；手牌上限类 = 每抽张数（drawCount）；handsLeft = 剩余拉杆；弃牌槽 = 未用拉杆槽；
//   blindSelect = 活跃日开始（boss 节点 = boss，其余 = small）；日 = 回合；
//   销毁/加牌作用于本局牌组（持久）；blindDefeated = Boss 击破；packOpened/packSkipped/shopEnd 已接线。
//
// 三档定义：
//   direct   直接可用 —— 经通用映射零偏差运行
//   adapted  适配可用 —— 经登记的专用桥，语义近似、逐条注明偏差
//   fidelity 无法映射登记 —— 依赖远征不存在的机制（弃牌动作/卖出/跳盲注/主引擎未实现的成长钩子），
//            handler 不触发或恒空转；保留在阵容只有版本/售价等残值
//
// 统计（由 scripts/expedition-e2-test.mjs 断言）：direct 122 / adapted 12 / fidelity 16
// 契约目标「≥120 直接可用」达成（122）。fidelity 集中：弃牌动作 7、卖出 4、跳盲注 1、
// E4 商店规则 2、主引擎未实现成长钩子 2（lucky_cat 幸运触发 / canio 人头销毁，已 grep 证实）。

export const JOKER_ADAPTATION = {
  // ================= 普通（rarity 1，61 张） =================
  j_joker:            { tier: 'direct', note: '+4 倍率直通' },
  j_greedy_joker:     { tier: 'direct', note: '♦计分 +3 倍率 → 无项目行动（打卡/日常）固定 ♦，天然高频' },
  j_lusty_joker:      { tier: 'direct', note: '♥计分 +3 倍率 → 项目花色行动牌' },
  j_wrathful_joker:   { tier: 'direct', note: '♠计分 +3 倍率 → 项目花色行动牌' },
  j_gluttonous_joker: { tier: 'direct', note: '♣计分 +3 倍率 → 项目花色行动牌' },
  j_jolly_joker:      { tier: 'direct', note: '对子 +8 倍率直通' },
  j_zany_joker:       { tier: 'direct', note: '三条 +12 倍率直通' },
  j_mad_joker:        { tier: 'direct', note: '两对 +10 倍率直通' },
  j_crazy_joker:      { tier: 'direct', note: '顺子 +12 倍率直通' },
  j_droll_joker:      { tier: 'direct', note: '同花 +10 倍率（同项目专注日）直通' },
  j_sly_joker:        { tier: 'direct', note: '对子 +50 筹码直通' },
  j_wily_joker:       { tier: 'direct', note: '三条 +100 筹码直通' },
  j_clever_joker:     { tier: 'direct', note: '两对 +80 筹码直通' },
  j_devious_joker:    { tier: 'direct', note: '顺子 +100 筹码直通' },
  j_crafty_joker:     { tier: 'direct', note: '同花 +80 筹码直通' },
  j_half_joker:       { tier: 'direct', note: '本抽 ≤3 张 +20 倍率（小抽数构筑）直通' },
  j_credit_card:      { tier: 'adapted', note: '商店桥：研料可负债至 -20（CREDIT_LIMIT）' },
  j_banner:           { tier: 'direct', note: '每剩余弃牌槽 +30 筹码 = 每剩余未用拉杆槽（[M6] 映射）' },
  j_mystic_summit:    { tier: 'direct', note: '弃牌槽 0 时 +15 倍率 = 拉杆打满且无槽位加成（[M6]）' },
  j_8_ball:           { tier: 'direct', note: '8 计分 1/4 产塔罗（项目任务天然 8）直通' },
  j_misprint:         { tier: 'direct', note: '+0~23 随机倍率直通' },
  j_raised_fist:      { tier: 'direct', note: 'held=未抽中池牌：其中最低点数 ×2 倍率' },
  j_scary_face:       { tier: 'direct', note: '人头牌计分 +30 筹码（Q=清空日）直通' },
  j_abstract_joker:   { tier: 'direct', note: '阵容每小丑 +3 倍率直通' },
  j_delayed_gratification: { tier: 'direct', note: '日终每剩余弃牌槽研料 +2 = 每剩余未用拉杆槽（[M6]）' },
  j_gros_michel:      { tier: 'direct', note: '+15 倍率；日终 1/6 自毁 → 阵容销毁桥' },
  j_even_steven:      { tier: 'direct', note: '偶数计分 +4 倍率直通' },
  j_odd_todd:         { tier: 'direct', note: '奇数计分 +31 筹码（A 视为奇数沿用原作）直通' },
  j_scholar:          { tier: 'direct', note: 'A 计分 +20 筹码 +4 倍率（里程碑）直通' },
  j_business_card:    { tier: 'direct', note: '人头牌计分 1/2 研料 +2（Q=清空日）直通' },
  j_supernova:        { tier: 'direct', note: '本局该牌型已打次数 → 倍率（逐抽跨日统计）直通' },
  j_ride_the_bus:     { tier: 'direct', note: '连续无人头牌 +1 倍率；Q 出现即清零，原作语义直通' },
  j_egg:              { tier: 'direct', note: '日终售价 +3（供剑客读取；远征无卖出口，残值语义）' },
  j_runner:           { tier: 'direct', note: '顺子 +15 筹码成长，逐抽跨日持久直通' },
  j_ice_cream:        { tier: 'direct', note: '100 筹码逐抽 -5 直通' },
  j_splash:           { tier: 'direct', note: '本抽每张抽中牌均计分（ruleMod 桥）直通' },
  j_blue_joker:       { tier: 'direct', note: '本抽未抽中池牌每张 +2 筹码（drawPile=held 映射）' },
  j_faceless_joker:   { tier: 'fidelity', note: '弃牌动作不存在（E4 重转复活候选）' },
  j_green_joker:      { tier: 'direct', note: '每抽 +1 倍率成长，跨日持久直通' },
  j_superposition:    { tier: 'direct', note: 'A+顺子 → 产塔罗（里程碑+多样 rank 日）直通' },
  j_to_do_list:       { tier: 'direct', note: '每日轮换指定牌型（日=回合，rollDailyJokerStates）；命中研料 +4' },
  j_cavendish:        { tier: 'direct', note: '×3 倍率；日终 1/1000 自毁 → 阵容销毁桥' },
  j_red_card:         { tier: 'direct', note: '跳过卡包 +3 倍率（skipInRunPack 已接 packSkipped 阶段）' },
  j_square_joker:     { tier: 'direct', note: '本抽恰好 4 张 +16 筹码成长（小抽数构筑）直通' },
  j_riff_raff:        { tier: 'direct', note: 'blindSelect=日初：每活跃日开始产 2 普通小丑' },
  j_photograph:       { tier: 'direct', note: '首张人头计分 ×2（photoUsed 每日重置）直通' },
  j_reserved_parking: { tier: 'direct', note: 'held=未抽中池牌：其中人头 1/2 研料 +1' },
  j_mail_in_rebate:   { tier: 'fidelity', note: '弃牌动作不存在（每日轮换 rank 保留但无触发口）' },
  j_hallucination:    { tier: 'direct', note: '开包 1/2 产塔罗（packOpened 阶段已接线）' },
  j_fortune_teller:   { tier: 'direct', note: '本局每用 1 张塔罗 +1 倍率（tarotsUsed 统计）直通' },
  j_juggler:          { tier: 'adapted', note: '手牌上限桥：每抽张数 +1（drawCountOf）' },
  j_drunkard:         { tier: 'adapted', note: '弃牌槽桥：未用拉杆槽 +1（unusedSlotsOf）' },
  j_golden_joker:     { tier: 'direct', note: '日终研料 +4 直通' },
  j_popcorn:          { tier: 'direct', note: '+20 倍率逐日 -4 直通' },
  j_walkie_talkie:    { tier: 'direct', note: '10/4 计分 +10 筹码 +4 倍率（高优项目 10/打卡 4）直通' },
  j_smiley_face:      { tier: 'direct', note: '人头牌计分 +5 倍率（Q=清空日）直通' },
  j_golden_ticket:    { tier: 'direct', note: '牌组黄金牌计分研料 +4（增强回归牌组载体）' },
  j_swashbuckler:     { tier: 'direct', note: '阵容售价和 → 倍率（真实计价；与蛋/礼物卡联动）直通' },
  j_hanging_chad:     { tier: 'direct', note: '首张计分牌重触发 2 次直通' },
  j_shoot_the_moon:   { tier: 'direct', note: 'held=未抽中池牌：其中每张 Q +13 倍率' },
  j_chaos_the_clown:  { tier: 'adapted', note: '商店桥：每商店节点 1 次免费重 roll（rerollExpeditionShop）' },

  // ================= 罕见（rarity 2，64 张） =================
  j_fibonacci:        { tier: 'direct', note: 'A/2/3/5/8 计分 +8 倍率（里程碑 A/项目 8 高频命中）直通' },
  j_joker_stencil:    { tier: 'direct', note: '每空阵容位 ×1 倍率（含自身）直通' },
  j_four_fingers:     { tier: 'direct', note: '同花/顺子 4 张即成（ruleMod 桥）直通' },
  j_mime:             { tier: 'direct', note: 'held 能力重触发：未抽中池牌的钢铁/蓝封等重触发 1 次' },
  j_ceremonial_dagger:{ tier: 'direct', note: 'blindSelect=日初：销毁右侧小丑抢其售价倍率' },
  j_marble_joker:     { tier: 'direct', note: 'blindSelect=日初：石头牌加入本局牌组（addCardToDeck 桥）' },
  j_loyalty_card:     { tier: 'direct', note: '每第 6 抽 ×4（handsPlayedTotal 跨日累计，原作语义）' },
  j_dusk:             { tier: 'direct', note: '最后一次拉杆（handsLeft=0）全计分牌重触发 1 次' },
  j_steel_joker:      { tier: 'direct', note: '牌组每张钢铁牌 ×0.2（countInFullDeck 桥）' },
  j_hack:             { tier: 'direct', note: '2/3/4/5 计分重触发（当日新建降级牌高频命中）直通' },
  j_pareidolia:       { tier: 'direct', note: '全部牌视为人头（allFace 规则桥）直通' },
  j_space_joker:      { tier: 'direct', note: '1/4 升级本抽牌型（本局永久）直通' },
  j_burglar:          { tier: 'direct', note: 'blindSelect=日初：拉杆 +2、弃牌槽清零（读回 handsLeft/discardsLeft）' },
  j_blackboard:       { tier: 'direct', note: 'held=未抽中池牌：全 ♠/♣ 时 ×3；无未抽中恒触发（原作 empty-held 语义）' },
  j_sixth_sense:      { tier: 'direct', note: '首抽仅 1 张且为 6 → 销毁产幻灵（drawCount=1 极限构筑可达）' },
  j_constellation:    { tier: 'direct', note: '每用星球 ×0.1 成长（consumableUsed 阶段接入）直通' },
  j_hiker:            { tier: 'direct', note: '计分牌永久 +5 筹码：牌组牌持久生效；行动牌每日重生不保留（注明）' },
  j_card_sharp:       { tier: 'direct', note: '本日已打过的牌型 ×3（handTypesPlayed 逐抽累计）' },
  j_madness:          { tier: 'direct', note: '非 Boss 节点日 blindSelect：销毁随机阵容小丑 ×0.5 成长' },
  j_seance:           { tier: 'direct', note: '同花顺 → 产幻灵直通' },
  j_vampire:          { tier: 'direct', note: '吸取计分牌组牌的增强 ×0.2 成长（增强回归牌组载体）' },
  j_shortcut:         { tier: 'direct', note: '顺子可隔 1 点（ruleMod 桥）直通' },
  j_hologram:         { tier: 'direct', note: '每有牌加入牌组 ×0.25 成长（cardAdded 已接线：开包/基因/DNA）' },
  j_cloud_9:          { tier: 'direct', note: '牌组每张 9 日终研料 +1（countInFullDeck 桥）' },
  j_rocket:           { tier: 'direct', note: '日终研料产出；Boss 击破 +2（blindDefeated 桥）直通' },
  j_midas_mask:       { tier: 'direct', note: '计分人头牌黄金化（作用于牌组牌持久，行动牌当日内有效）' },
  j_luchador:         { tier: 'fidelity', note: '卖出阶段不存在（奇科特已承接 Boss 禁用语义）' },
  j_gift_card:        { tier: 'direct', note: '日终阵容售价 +1（供剑客读取）直通' },
  j_turtle_bean:      { tier: 'adapted', note: '手牌上限桥：每抽张数 +5，每个活跃日 -1（drawCountOf）' },
  j_erosion:          { tier: 'direct', note: 'deckStart−现存每张 +4 倍率（deckStart 已记录）' },
  j_to_the_moon:      { tier: 'direct', note: '日终研料利息（每 5 研料 +1）直通' },
  j_stone_joker:      { tier: 'direct', note: '牌组每张石头牌 +25 筹码（countInFullDeck 桥）' },
  j_lucky_cat:        { tier: 'fidelity', note: '主引擎幸运触发成长钩子未实现（jokerEffects 仅 jokerScore 读取分支）' },
  j_bull:             { tier: 'direct', note: '每研料 +2 筹码（金钱→研料映射）直通' },
  j_diet_cola:        { tier: 'fidelity', note: '卖出阶段不存在' },
  j_trading_card:     { tier: 'fidelity', note: '弃牌动作不存在（E4 重转复活候选）' },
  j_flash_card:       { tier: 'adapted', note: '商店桥：每次重 roll +2 倍率（reroll 阶段已接线）' },
  j_spare_trousers:   { tier: 'direct', note: '两对 +2 倍率成长直通' },
  j_ramen:            { tier: 'direct', note: '×2 倍率；远征无弃牌动作 → 永不衰减常驻 ×2（注明偏差）' },
  j_seltzer:          { tier: 'direct', note: '10 抽内全计分牌重触发（逐抽递减）直通' },
  j_castle:           { tier: 'fidelity', note: '弃牌成长不存在（每日轮换花色保留但无触发口）' },
  j_mr_bones:         { tier: 'adapted', note: '免死桥：压力将满且当日伤害 ≥ 节点 HP 上限 25% → 消耗自身免死一次' },
  j_acrobat:          { tier: 'direct', note: '最后一次拉杆（handsLeft=0）×3 倍率' },
  j_sock_and_buskin:  { tier: 'direct', note: '人头牌重触发（Q=清空日）直通' },
  j_troubadour:       { tier: 'adapted', note: '手牌/手数桥：每抽张数 +2、拉杆 -1（drawCountOf/pullsCapOf）' },
  j_certificate:      { tier: 'direct', note: 'roundStart=日初：随机蜡封牌加入本局牌组（addRandomSealedCardToHand 桥）' },
  j_smeared_joker:    { tier: 'direct', note: '♥♦/♠♣ 同视（ruleMod 桥）直通' },
  j_throwback:        { tier: 'fidelity', note: '无跳盲注统计（blindsSkipped 恒 0）' },
  j_rough_gem:        { tier: 'direct', note: '♦计分研料 +1 直通' },
  j_bloodstone:       { tier: 'direct', note: '♥计分 1/2 ×1.5 直通' },
  j_arrowhead:        { tier: 'direct', note: '♠计分 +50 筹码直通' },
  j_onyx_agate:       { tier: 'direct', note: '♣计分 +7 倍率直通' },
  j_glass_joker:      { tier: 'direct', note: '牌组玻璃牌碎裂 ×0.75 成长（glassDestroyed 已接线）' },
  j_showman:          { tier: 'fidelity', note: 'E4 商店规则：重复出现当前无对象' },
  j_flower_pot:       { tier: 'direct', note: '四花色同抽 ×3（多项目多样日）直通' },
  j_merry_andy:       { tier: 'adapted', note: '手牌/弃牌桥：每抽张数 -1、未用拉杆槽 +3（drawCountOf/unusedSlotsOf）' },
  j_oops_all_6s:      { tier: 'direct', note: '概率翻倍（doubleProb 规则桥，含命运之轮/血石等）直通' },
  j_the_idol:         { tier: 'direct', note: '每日轮换指定花色+点数（rollDailyJokerStates）；命中 ×2' },
  j_seeing_double:    { tier: 'direct', note: '♣+其他花色同抽 ×2 直通' },
  j_matador:          { tier: 'adapted', note: '干预桥：Boss 当日规则/意图实际干预过 → 研料 +8' },
  j_satellite:        { tier: 'direct', note: '日终每种本局用过星球研料 +1（planetsUsedUnique 统计）直通' },
  j_cartomancer:      { tier: 'direct', note: 'blindSelect=日初：每活跃日开始产 1 塔罗' },
  j_astronomer:       { tier: 'fidelity', note: 'E4 商店规则：星球免费当前无对象' },
  j_bootstraps:       { tier: 'direct', note: '每 5 研料 +2 倍率（金钱→研料映射）直通' },

  // ================= 稀有（rarity 3，20 张） =================
  j_campfire:         { tier: 'fidelity', note: '卖出成长不存在（cardSold 不触发）' },
  j_dna:              { tier: 'direct', note: '首抽仅 1 张 → 复制入牌组（drawCount=1 极限构筑可达）' },
  j_vagabond:         { tier: 'direct', note: '研料 ≤4 时打出即产塔罗（金钱→研料映射）直通' },
  j_baron:            { tier: 'direct', note: 'held=未抽中池牌：每张 K ×1.5（K 来自本局牌组）' },
  j_obelisk:          { tier: 'direct', note: '连续非常用牌型 ×0.2 成长直通' },
  j_baseball_card:    { tier: 'direct', note: '阵容每罕见小丑 ×1.5 直通' },
  j_ancient_joker:    { tier: 'direct', note: '每日轮换指定花色（rollDailyJokerStates）；该花色计分 ×1.5' },
  j_blueprint:        { tier: 'direct', note: '复制右侧小丑（复制解析原逻辑不变）直通' },
  j_wee_joker:        { tier: 'direct', note: '2 计分 +8 筹码成长（当日新建降级牌天然产 2）直通' },
  j_hit_the_road:     { tier: 'fidelity', note: '弃 J 成长不存在（弃牌动作；rank 表也无 J）' },
  j_the_duo:          { tier: 'direct', note: '对子 ×2 直通' },
  j_the_trio:         { tier: 'direct', note: '三条 ×3 直通' },
  j_the_family:       { tier: 'direct', note: '四条 ×4 直通' },
  j_the_order:        { tier: 'direct', note: '顺子 ×3 直通' },
  j_the_tribe:        { tier: 'direct', note: '同花 ×2 直通' },
  j_stuntman:         { tier: 'adapted', note: '手牌上限桥：每抽张数 -2；+250 筹码触发照常（drawCountOf）' },
  j_invisible_joker:  { tier: 'fidelity', note: '卖出阶段不存在' },
  j_brainstorm:       { tier: 'direct', note: '复制最左小丑（复制解析原逻辑不变）直通' },
  j_drivers_license:  { tier: 'direct', note: '牌组增强牌 ≥16 → ×3（countInFullDeck 桥）' },
  j_burnt_joker:      { tier: 'fidelity', note: '弃牌升级阶段不存在（E4 重转复活候选）' },

  // ================= 传奇（rarity 4，5 张） =================
  j_canio:            { tier: 'fidelity', note: '主引擎人头销毁成长钩子未实现（已 grep 证实）' },
  j_triboulet:        { tier: 'direct', note: 'Q/K 计分 ×2：Q（清空日）有效；K 来自本局牌组' },
  j_yorick:           { tier: 'fidelity', note: '弃牌计数不存在（23 次弃牌成长不触发）' },
  j_chicot:           { tier: 'adapted', note: '禁用桥：Boss 常驻规则与当日意图全禁（scoreDay 前置判定）' },
  j_perkeo:           { tier: 'direct', note: 'shopEnd 阶段已接线：离开商店节点时消耗牌栏每张产 1 负片复制' },
}

export const VALID_TIERS = ['direct', 'adapted', 'fidelity']

export function adaptationTierOf(id) {
  return JOKER_ADAPTATION[id]?.tier || null
}

// 静态汇总（测试另行动态断言与 JOKERS 全量一致）
export const ADAPTATION_SUMMARY = {
  total: 150,
  direct: 122,
  adapted: 12,
  fidelity: 16,
  usable: 134, // direct + adapted
  note: 'fidelity 集中：弃牌动作 7 / 卖出 4 / 跳盲注 1 / E4 商店规则 2 / 主引擎未实现成长钩子 2',
}
