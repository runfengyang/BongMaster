// Balatro UI 纯函数助手：Boss 出牌约束、消耗牌目标规格、最近标签
// 只读引擎快照/数据 def，不改任何游戏状态；引擎仍是唯一规则来源

// ---- Boss 出牌约束（供出牌按钮 gating 与提示） ----
// 返回 { exactCount, bannedTypes, forcedType, debuffSuit, debuffFace, jokerDisabled }
export function computePlayRules(round) {
  const none = {
    exactCount: 0, bannedTypes: [], forcedType: null,
    debuffSuit: null, debuffFace: false, jokerDisabled: false,
  }
  if (!round?.boss || round.bossDisabled) return none
  const h = round.boss.effect?.handler
  const p = round.boss.effect?.params || {}
  const rules = { ...none }
  if (h === 'psychic') rules.exactCount = 5
  else if (h === 'eye') rules.bannedTypes = [...(round.handTypesPlayed || [])]
  else if (h === 'mouth' && round.handTypesPlayed?.length) rules.forcedType = round.handTypesPlayed[0]
  else if (h === 'debuffSuit') rules.debuffSuit = p.suit || null
  else if (h === 'plant' || h === 'verdantLeaf') rules.debuffFace = true
  else if (h === 'crimsonHeart') rules.jokerDisabled = true
  return rules
}

// ---- 消耗牌目标规格（§3.4 选牌目标 UI） ----
// 返回 { min, max, hint }；null = 无需选牌（立即生效）
export function consumableTargetSpec(def) {
  if (!def?.effect) return null
  const h = def.effect.handler
  const p = def.effect.params || {}
  switch (h) {
    case 'enhance':
      return { min: 1, max: p.count || 1, hint: `选择至多 ${p.count || 1} 张牌增强` }
    case 'strength':
      return { min: 1, max: p.count || 2, hint: `选择至多 ${p.count || 2} 张牌点数 +1` }
    case 'destroyCards':
      return { min: 1, max: p.count || 2, hint: `选择至多 ${p.count || 2} 张牌销毁` }
    case 'death':
      return { min: 2, max: 2, hint: '选择 2 张牌，左边变成右边' }
    case 'convertSuit':
      return { min: 1, max: p.count || 3, hint: `选择至多 ${p.count || 3} 张牌转换花色` }
    case 'addSeal':
      return { min: 1, max: 1, hint: '选择 1 张牌添加蜡封' }
    case 'aura':
      return { min: 1, max: 1, hint: '选择 1 张牌添加版本' }
    case 'cryptid':
      return { min: 1, max: 1, hint: '选择 1 张牌创建 2 张复制' }
    default:
      return null
  }
}

// ---- 最近获得的标签（供 ScorePanel 旁 chips 展示） ----
export function recentTags(log, n = 3) {
  if (!Array.isArray(log)) return []
  const out = []
  for (let i = log.length - 1; i >= 0 && out.length < n; i--) {
    if (log[i]?.type === 'tag') out.push(log[i].id)
  }
  return out
}

// ---- 卡包选项稀有度判定（开包悬念演出用） ----
export function packOptionRare(opt, jokersById, spectralById) {
  if (opt.kind === 'joker') return (jokersById[opt.id]?.rarity || 1) >= 3
  if (opt.kind === 'spectral') return !!spectralById[opt.id]?.rare
  return false
}
