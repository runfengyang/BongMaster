// Balatro 数据层聚合导出 + 全局 BY_ID 查找表
import { HANDS, HANDS_BY_ID } from './hands.js'
import { PLANETS, PLANETS_BY_ID } from './planets.js'
import { TAROT, TAROT_BY_ID } from './tarot.js'
import { SPECTRAL, SPECTRAL_BY_ID } from './spectral.js'
import { JOKERS, JOKERS_BY_ID } from './jokers.js'
import { SMALL_BLIND, BIG_BLIND, BOSS_BLINDS, SHOWDOWN_BLINDS, ALL_BOSS_BLINDS, BLINDS_BY_ID } from './blinds.js'
import { PACKS, PACKS_BY_ID } from './packs.js'
import { DECKS, DECKS_BY_ID } from './decks.js'
import { EDITIONS, EDITIONS_BY_ID } from './editions.js'
import { ENHANCEMENTS, ENHANCEMENTS_BY_ID, SEALS, SEALS_BY_ID } from './enhancements.js'
import { VOUCHERS, VOUCHERS_BY_ID } from './vouchers.js'
import { TAGS, TAGS_BY_ID } from './tags.js'
import { MOD_JOKERS, MOD_JOKERS_BY_ID } from './modJokers.js'

export {
  HANDS, HANDS_BY_ID,
  PLANETS, PLANETS_BY_ID,
  TAROT, TAROT_BY_ID,
  SPECTRAL, SPECTRAL_BY_ID,
  JOKERS, JOKERS_BY_ID,
  SMALL_BLIND, BIG_BLIND, BOSS_BLINDS, SHOWDOWN_BLINDS, ALL_BOSS_BLINDS, BLINDS_BY_ID,
  PACKS, PACKS_BY_ID,
  DECKS, DECKS_BY_ID,
  EDITIONS, EDITIONS_BY_ID,
  ENHANCEMENTS, ENHANCEMENTS_BY_ID, SEALS, SEALS_BY_ID,
  VOUCHERS, VOUCHERS_BY_ID,
  TAGS, TAGS_BY_ID,
  MOD_JOKERS, MOD_JOKERS_BY_ID,
}

// 全局查找表：所有可购买/可收集卡牌（小丑/塔罗/星球/幻灵/卡包/优惠券/标签）
// §12：合入 Mod 致敬小丑（mj_*）仅供 UI 查找（PackModal/图鉴显示名称与卡面）；
// 引擎卡池均从 data/jokers.js 等具体文件构建，不受此合并影响，Mod 卡永不进 Run
export const BY_ID = {
  ...JOKERS_BY_ID, ...TAROT_BY_ID, ...PLANETS_BY_ID, ...SPECTRAL_BY_ID,
  ...PACKS_BY_ID, ...VOUCHERS_BY_ID, ...TAGS_BY_ID, ...DECKS_BY_ID, ...BLINDS_BY_ID,
  ...MOD_JOKERS_BY_ID,
}

// 卖出价：floor(基础价 + 版本加价) / 2，至少 1
export function baseSellValue(def, edition = null) {
  const cost = (def.cost || 0) + (edition && EDITIONS_BY_ID[edition] ? EDITIONS_BY_ID[edition].costAdd : 0)
  return Math.max(1, Math.floor(cost / 2))
}
