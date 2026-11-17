// Balatro 收藏开包卡池梯度（仅收藏模式；Run 模式卡池完全不受影响）
// 稀有(rarity 3)小丑：累计开 ≥10 包后才可能开出
// 核心强卡（10 张）：累计开 ≥20 包后才可能开出
// 传奇(rarity 4)永不锁定（本就只经幻灵「灵魂」出现）
// 官方与 Mod（mj_*）小丑同规则适用

export const RARE_MIN_PACKS = 10
export const CORE_MIN_PACKS = 20

// 核心 10 张（均为 rarity 3 强卡；吸血鬼 j_vampire 为 rarity 2 不在此列）
export const CORE_JOKERS = [
  'j_blueprint', 'j_brainstorm', 'j_baseball_card', 'j_baron', 'j_dna',
  'j_campfire', 'j_obelisk', 'j_vagabond', 'j_stuntman', 'j_invisible_joker',
]

// 该卡在当前累计开包数下是否被梯度锁定
export function gatedByPacks(id, def, packsOpened = 0) {
  if (!def || def.rarity == null) return false // 非小丑/无稀有度不锁
  if (def.rarity >= 4) return false            // 传奇永不锁定
  if (CORE_JOKERS.includes(id)) return packsOpened < CORE_MIN_PACKS
  if (def.rarity === 3) return packsOpened < RARE_MIN_PACKS
  return false
}

// 锁定提示所需的累计开包数（未锁定返回 null）
export function lockHint(id, def) {
  if (!def || def.rarity == null || def.rarity >= 4) return null
  if (CORE_JOKERS.includes(id)) return CORE_MIN_PACKS
  if (def.rarity === 3) return RARE_MIN_PACKS
  return null
}
