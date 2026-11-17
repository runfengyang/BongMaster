// Balatro 收藏模式纯金币经济（§21 起含碎片/合成）
// 金币来源：生产力奖励按来源发放；金币用途：/cards 顶部商店购买卡包（入待开队列）
// 重复卡（同 id+版本 ≥2）与重复扑克变体可出售换金币，首张保护、点亮不受影响

// ---- §21 碎片（半张卡）：开包收下的每张卡独立概率成为碎片 ----
// 两张同变体碎片（同 id+版本；扑克同 rank+suit+enhancement+seal+edition）免费合成整卡
// 碎片不点亮图鉴、不计入出率重复权重、不参与一键卖出；单张可半价出售（2 张时不卖，引导合成）
export const FRAGMENT_RATE = 0.4

// 碎片 roll（rng 返回 [0,1)）；__force_mod 测试钩子由调用方豁免
export function rollFragment(rng = Math.random) {
  return rng() < FRAGMENT_RATE
}

// 碎片售价 = 整卡半价（向下取整，最低 1）
export function fragmentSellValue(wholeValue) {
  return Math.max(1, Math.floor((wholeValue || 0) / 2))
}

// ---- 生产力奖励金币（按来源） ----
export const GOLD_REWARDS = {
  checkin: 2,       // 习惯打卡
  task: 3,          // 每日任务完成
  project_task: 5,  // 项目任务完成
}

// ---- 商店卡包金币价（按规格；与 Run 内 $cost 无关） ----
export const SHOP_PACK_PRICES = {
  normal: 40,
  jumbo: 60,
  mega: 80,
}

// ---- §19 收藏开包出率调优：已拥有卡重复权重 ----
// 塔罗/星球池小（22/12 张），不干预会太快集齐 → owned ×3
// 小丑/幻灵池大（285/18 张），影响小 → owned ×1.5
// 应用于 store.openCollectionPack 选项生成后（官方 id 选项；Mod 混入与 __force_mod 豁免）
export const PACK_DUPLICATE_WEIGHT = {
  tarot: 3,
  planet: 3,
  joker: 1.5,
  spectral: 1.5,
}

// 按重复权重从卡池抽 1 张（owned 权重 ×w，未拥有 ×1；rng 为 [0,1) 随机源）
// pool: [{ id, ... }]；ownedIds: Set<string>；返回被抽中的 id（不放回由调用方控制）
export function drawWithDuplicateWeight(pool, ownedIds, weight, rng = Math.random) {
  if (!pool.length) return null
  let total = 0
  for (const c of pool) total += ownedIds.has(c.id) ? weight : 1
  let roll = rng() * total
  for (const c of pool) {
    roll -= ownedIds.has(c.id) ? weight : 1
    if (roll <= 0) return c.id
  }
  return pool[pool.length - 1].id
}

// ---- 卡牌出售价（小丑按稀有度；塔罗/星球/幻灵无稀有度按普通档） ----
export const SELL_BY_RARITY = {
  1: 8,    // 普通
  2: 16,   // 罕见
  3: 40,   // 稀有
  4: 120,  // 传奇
}

// 版本加成（在稀有度底价上累加）
export const SELL_EDITION_BONUS = {
  foil: 2,
  holo: 4,
  poly: 8,
  negative: 16,
}

// ---- 扑克出售价：基础 2 + 增强/蜡封/版本各 +1~4 ----
export const PLAYING_SELL = {
  base: 2,
  enhancement: 1, // 任一增强 +1
  seal: 2,        // 任一蜡封 +2
  edition: { foil: 1, holo: 2, poly: 3, negative: 4 }, // 版本 +1~4
}

// 小丑/消耗牌售价：稀有度底价（无稀有度按普通 8）+ 版本加成
export function sellValueOfJoker(def, edition = null) {
  if (!def) return 0
  const base = SELL_BY_RARITY[def.rarity] ?? SELL_BY_RARITY[1]
  return base + (edition && SELL_EDITION_BONUS[edition] ? SELL_EDITION_BONUS[edition] : 0)
}

// 扑克售价：基础 + 增强 + 蜡封 + 版本
export function sellValueOfPlaying(card) {
  if (!card) return 0
  let v = PLAYING_SELL.base
  if (card.enhancement) v += PLAYING_SELL.enhancement
  if (card.seal) v += PLAYING_SELL.seal
  if (card.edition && PLAYING_SELL.edition[card.edition]) v += PLAYING_SELL.edition[card.edition]
  return v
}
