// 远征模式数值常量表（契约 §5.5：全部数值集中于此，禁止散落硬编码）
// 标定来源：scripts/expedition-stats.mjs（E1 真实数据画像：日均 2.92 抽、
//   同项目集中度 86.6%、散牌日 46.8%）+ scripts/expedition-monte-carlo.mjs
//   蒙特卡洛模拟（牌堆构成 → 抽取分布 → 日伤害期望/方差）
// 标定目标（契约 §5.5）：
//   裸装日伤害期望 ≈ Boss HP 的 12-15%（必须构筑）
//   合理构筑日伤害期望 ≈ 22-28%（5 日稳过）
//   同花日概率 ≥15%（专注日有惊喜感）

// ================= 局结构 =================
export const DAYS_PER_RUN = 5            // 一局 = 5 个活跃日（与日历日解耦）
export const MAX_PRESSURE = 5            // 压力满 5 → 失败
export const OVERFLOW_CARRY_RATIO = 0.5  // 节点溢出伤害结转比例
export const LINEUP_SIZE = 5             // 阵容栏位（负片版本 +1 栏/张，原作语义）

// ================= 老虎机（契约 §5.1/§5.3） =================
export const DRAW_PER_PULL = 5           // 每次拉杆抽取 5 张（无放回；池不足重洗补足）
export const MAX_PULLS_PER_DAY = 5       // 每日最多 5 次拉杆（= 每日最多 5 张行动牌）
export const MAX_SCORING_CARDS_PER_DAY = MAX_PULLS_PER_DAY // actionCards 层别名（防刷规则 3）
export const DECK_CAP = 52               // 本局扑克牌组上限

// ================= 节点路线（v1 固定，契约 §3.2） =================
// 普通 → 精英 → 商店 → 普通 → Boss
export const NODE_ROUTE = ['normal', 'elite', 'shop', 'normal', 'boss']

// 节点 HP（按难度档 1/2/3；Boss 节点 HP 在 data/expedition/bosses.js 按 Boss 定义）
// 蒙特卡洛标定（scripts/expedition-monte-carlo.mjs）：裸装日伤害期望 ~130（≈ Boss HP1 的
// 13-16%）；合理构筑日 ~210-290（22-28% 区间，5 日稳过全轨 ~1050）
export const NODE_HP = {
  normal: [60, 80, 100],
  elite: [95, 125, 155],
  shop: [35, 45, 55],
}

// 各节点活跃日最低伤害线（未达 → 压力 +1，契约 §4.2）
// 蒙特卡洛标定（scripts/expedition-monte-carlo.mjs，真实 90 天画像）：
//   裸装 1-3 行动日 mean 11/42/144（median 全日 72）；起始构筑 1-2 行动日 mean 113/156。
//   normal 线 80：裸装衰日（≤3 行动）多数触线 → 压力成为裸装主败因（「必须构筑」）；
//   draft 起手 1-2 行动日 mean > 80 免疫，个别衰日容错（压力上限 5）。
//   elite 线 105：高于起始构筑 1 行动日 mean（113 边沿），中期节点要求稳定投入。
// 商店节点是休整节点：无最低伤害线（永不惩罚休息的延伸），但违反 Boss 意图仍 +1
export const NODE_MIN_DAMAGE = {
  normal: 80,
  elite: 105,
  shop: 0,
}

// 节点通关奖励研料（契约 §2.3：研料来源之一 = 节点奖励）
export const NODE_RESEARCH = { normal: 2, elite: 3, shop: 0, boss: 5 }

// ================= 行动牌 rank 表（契约 §5.1） =================
export const RANK_RULES = {
  habitCheckin: { base: 4, streakMin: 7, streakRank: 6 }, // 习惯打卡 4（streak ≥7 → 6）
  dailyTask: { base: 5, highPriority: 7 },               // 完成每日任务 5（高优先级 7）
  projectTask: { base: 8, highPriority: 10 },            // 完成项目任务 8（高优先级 10）
  dayCleared: 12,  // 清空当日全部每日任务 → Q
  projectMilestone: 14, // 项目完成/里程碑 → A
}

// 高优先级标签（数据库 priority 字段为中文）
export const HIGH_PRIORITY_LABELS = ['高', 'high', 'High', 'HIGH', 'urgent', 'Urgent']

// ================= 防刷三规则（契约 §5.1 红线） =================
export const ANTI_ABUSE = {
  sameDayCreateDivisor: 2, // 当日新建当日完成 → rank 减半
  sameDayCreateFloor: 2,   // 减半向下取整，最低 2
  recompleteCountFirstOnly: true, // 完成→撤销→再完成：只计首次
}

// ================= 花色规则 =================
export const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'] // ♠♥♦♣
export const DEFAULT_SUIT = 'diamonds' // 无项目行动（打卡/日常任务）固定 ♦

// ================= 研料（局内货币，契约 §2.3：局终清零） =================
export const STARTING_RESEARCH = 4 // 开局研料

// ================= 消耗牌栏 =================
export const CONSUMABLE_SLOTS = 2 // 塔罗/星球/幻灵共用

// ================= 起始构筑（开局 draft，契约 §2.1） =================
export const STARTER_DRAFT = { jokerOptions: 3, jokerChoose: 1, cardOptions: 5, cardChoose: 2 }

// 起始构筑升级阶梯（契约 §8 第 2 条，Phase E2 定稿）：
// 通关次数达标 → 开局包规格提升 + 栏位扩展
export const STARTER_LADDER = [
  { wins: 0, jokerOptions: 3, jokerChoose: 1, cardOptions: 5, cardChoose: 2, consumableBonus: 0, jokerSlotBonus: 0, label: 'Normal' },
  { wins: 3, jokerOptions: 4, jokerChoose: 1, cardOptions: 5, cardChoose: 2, consumableBonus: 0, jokerSlotBonus: 0, label: 'Jumbo' },
  { wins: 5, jokerOptions: 4, jokerChoose: 1, cardOptions: 5, cardChoose: 2, consumableBonus: 1, jokerSlotBonus: 0, label: 'Jumbo+消耗栏' },
  { wins: 8, jokerOptions: 4, jokerChoose: 2, cardOptions: 5, cardChoose: 3, consumableBonus: 1, jokerSlotBonus: 0, label: 'Mega' },
  { wins: 12, jokerOptions: 4, jokerChoose: 2, cardOptions: 5, cardChoose: 3, consumableBonus: 1, jokerSlotBonus: 1, label: 'Mega+小丑栏' },
]

// ================= 卡池解锁阶梯（契约 §8 第 1 条：通关 → 局内卡包池扩容） =================
// commons/uncommons/rares 为各稀有度按 JOKERS 顺序取前 N 张（'all' = 全量）
export const POOL_LADDER = [
  { wins: 0, commons: 40, uncommons: 20, rares: 0, enhancementBoost: 0, soulBoost: 0 },
  { wins: 3, commons: 'all', uncommons: 'all', rares: 0 },
  { wins: 5, rares: 20 },
  { wins: 8, enhancementBoost: 0.2 }, // 增强/蜡封入包率 +20pp（40%→60% / 20%→40%）
  { wins: 12, soulBoost: 0.003 },     // 灵魂/黑洞出率翻倍（0.3%→0.6%）
]

// ================= 局内卡包来源（契约 §2.2） =================
export const PACK_REWARD = {
  normalChoices: 3,   // 普通节点通关：卡包类型三选一
  eliteSize: 'jumbo', // 精英节点通关：Jumbo 档
  bossSize: 'mega',   // Boss 通关：Mega 档
  bossRareChance: 0.2, // Boss 稀有掉落概率（幻灵包附加）
}
export const PACK_TYPES = ['arcana', 'celestial', 'spectral', 'buffoon', 'standard']

// ================= 远征商店（商店节点；研料消费；优惠券 E4 接入） =================
export const SHOP_REROLL_COST = 2
export const CREDIT_LIMIT = -20 // 信用卡小丑：研料可负债下限

// ================= 统计脚本内置假设（DB 缺失/为空时降级用） =================
// 「普通一天」假设：3 个项目任务（2 个同项目 A + 1 个项目 B）+ 2 个日常任务 + 1 个打卡
export const FALLBACK_DAY_ASSUMPTION = {
  projectTasksSameProject: 2,
  projectTasksOtherProject: 1,
  dailyTasks: 2,
  habitCheckins: 1,
}
