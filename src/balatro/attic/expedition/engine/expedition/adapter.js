// 适配层（契约 §5.3）：把远征状态适配成现有 jokerEffects handler 所需的 ctx
// 老虎机模型的通用语义映射（handler 原样工作的前提，逐条登记即「直接可用」）：
//   [M1] 一手牌 = 一次拉杆；played/scored = 本次抽出的 5 张；牌型/计分/重触发全原作
//   [M2] held（手牌持有）= 本次拉杆未抽中的池牌（钢铁 ×1.5/男爵 K/射月 Q 等由此生效）
//   [M3] 金钱 = 研料（局内货币）；经济型小丑产出研料
//   [M4] 手牌上限 = 每次拉杆抽取张数（默认 5；耍把戏/特技演员/欢乐安迪/龟豆/灵质修正）
//   [M5] 出牌次数 = 拉杆次数（黄昏/杂技演员的 handsLeft=0 = 当日最后一抽）
//   [M6] 弃牌槽位 = 当日未使用拉杆槽位（旗帜/神秘之峰/延迟满足；醉鬼/欢乐安迪加成）
//   [M7] 盲注选择 = 活跃日开始（节点即盲注：Boss 节点 = boss，其余 = small/big）
//   [M8] 回合开始/结束 = 活跃日开始/结束；牌堆 = 本局扑克牌组；每日轮换 = 原作回合轮换
//   [M9] 销毁/加牌作用于本局牌组（永久）；紫蜡封牌被销毁 → 产塔罗（原作弃牌语义的远征映射）
//   无法映射的效果在 data/expedition/jokerAdaptation.js 登记 fidelity

import { evaluate } from '../../../../engine/evaluate.js'
import { sellValueOf } from '../../../../engine/shop.js'
import { JOKERS_BY_ID } from '../../../../data/jokers.js'
import { TAROT } from '../../../../data/tarot.js'
import { PLANETS } from '../../../../data/planets.js'
import { SPECTRAL_POOL } from '../../../../data/spectral.js'
import { JOKER_HANDLERS, jokerHandlerFor, initialJokerState } from '../../../../engine/jokerEffects.js'
import { makeCard, SUITS } from '../../../../engine/deck.js'
import {
  LINEUP_SIZE, CONSUMABLE_SLOTS, DRAW_PER_PULL, MAX_PULLS_PER_DAY, DECK_CAP,
} from './balance.js'

// [M1 前置] 被动规则汇总（镜像 run.js 的 modifiers getter）
export function computeModifiers(exp) {
  const m = { ...exp.modifiers }
  for (const j of exp.jokers) {
    if (j.debuffed) continue
    const def = JOKERS_BY_ID[j.id]
    if (def?.effect?.handler === 'ruleMod') m[def.effect.params.rule] = true
  }
  return m
}

// [M4] 每次拉杆抽取张数（手牌上限类被动桥；龟豆每活跃日衰减 1，镜像原作回合衰减）
export function drawCountOf(exp) {
  let n = DRAW_PER_PULL
  for (const j of exp.jokers) {
    if (j.debuffed) continue
    if (j.id === 'j_juggler') n += 1
    else if (j.id === 'j_stuntman') n -= 2
    else if (j.id === 'j_merry_andy') n -= 1
    else if (j.id === 'j_turtle_bean') n += Math.max(0, 5 - exp.dayIndex)
    else if (j.id === 'j_troubadour') n += 2
  }
  n += exp.drawCountModifier || 0 // 灵质 -1
  return Math.max(1, n)
}

// 每拉杆数上限（ troubadour -1；行动牌数 ≤ 此上限才全部转化为拉杆）
export function pullsCapOf(exp) {
  let n = MAX_PULLS_PER_DAY
  for (const j of exp.jokers) {
    if (j.debuffed) continue
    if (j.id === 'j_troubadour') n -= 1
  }
  return Math.max(1, n)
}

// [M6] 弃牌槽位 = 未使用拉杆槽位 + 阵容弃牌加成（醉鬼/欢乐安迪）
export function unusedSlotsOf(exp, actionCardCount) {
  let n = Math.max(0, MAX_PULLS_PER_DAY - Math.min(actionCardCount, MAX_PULLS_PER_DAY))
  for (const j of exp.jokers) {
    if (j.debuffed) continue
    if (j.id === 'j_drunkard') n += 1
    else if (j.id === 'j_merry_andy') n += 3
  }
  return n
}

// 小丑栏位数（负片 +1 栏/张，原作语义；起始构筑阶梯可 +1）
export function jokerSlotCountOf(exp) {
  let n = LINEUP_SIZE + (exp.jokerSlotBonus || 0) + (exp.jokerSlotModifier || 0)
  for (const j of exp.jokers) if (j.edition === 'negative') n += 1
  return n
}

export function consumableSlotCountOf(exp) {
  return CONSUMABLE_SLOTS + (exp.consumableSlotBonus || 0)
}

// run 语义适配：jokers/handLevels/stats 直接引用远征状态（跨活跃日持久）
export function adapterRun(exp) {
  return {
    jokers: exp.jokers,
    consumables: exp.consumables,
    vouchers: [],             // 优惠券在 E4 商店节点接入
    modifiers: computeModifiers(exp),
    handLevels: exp.handLevels,
    stats: exp.stats,
    money: exp.research,      // [M3] 金钱语义 → 研料
    fullDeckStart: exp.deckStart,
    fullDeck: exp.deck,       // [M8] 牌堆 = 本局扑克牌组
  }
}

// round 语义适配（一日 = 一回合；round 对象全日共享、逐抽更新字段）
// [M5] handsLeft = 本抽之后剩余拉杆次数；[M6] discardsLeft = 未用拉杆槽位+加成
export function adapterRound(exp) {
  return {
    handsLeft: 0, discardsLeft: 0, discardsUsed: 0,
    drawPile: [],             // [M2] 本抽未抽中的池牌（蓝色小丑读 length）
    handTypesPlayed: [],      // 今日已打牌型（卡牌高手读）
    handsPlayedThisRound: 0,  // 本抽序号（DNA/第六感读「本回合第一手」）
    firstDiscard: false,
    boss: null, bossDisabled: exp.bossDisabledToday || false,
    photoUsed: false,         // 照片：每日首个人头（原作每回合一次）
    bossTriggeredThisHand: false, // 斗牛士桥：本抽 Boss 干预即触发
  }
}

// helpers 语义适配
export function adapterHelpers(exp, run, rng = null) {
  const rr = rng || exp.rng
  return {
    addMoney: n => { run.money += n; exp.research += n; exp.stats.researchEarned = (exp.stats.researchEarned || 0) + n },
    defOf: id => JOKERS_BY_ID[id] || null,
    sellValue: item => sellValueOf(item, JOKERS_BY_ID[item.id] || { cost: 2 }),
    jokerSlotCount: () => jokerSlotCountOf(exp),
    consumableSlotCount: () => consumableSlotCountOf(exp),
    fullDeckCount: () => exp.deck.length,
    countInFullDeck: pred => exp.deck.filter(pred).length,
    mostPlayedHand: () => {
      let best = null, bn = -1
      for (const [k, v] of Object.entries(exp.stats.handsPlayed)) if (v > bn) { best = k; bn = v }
      return best
    },
    evaluateCards: cards => evaluate(cards, run.modifiers),
    levelUpHand: (handType, n) => { // 星球升级本局永久生效（契约 §5.4）
      exp.handLevels[handType] = Math.max(1, (exp.handLevels[handType] || 1) + n)
    },
    // 产牌类效果接入远征消耗牌栏（栏满则失败，与原作语义一致）
    createTarot: () => !!addConsumableToExp(exp, rr.pick(TAROT).id),
    createPlanet: () => !!addConsumableToExp(exp, rr.pick(PLANETS).id),
    createSpectral: () => !!addConsumableToExp(exp, rr.pick(SPECTRAL_POOL).id),
    createConsumable: (id, edition) => !!addConsumableToExp(exp, id, edition),
    // 局内生成小丑（开局 draft/卡包/审判/幽灵/里夫拉夫；栏满失败）
    createJoker: (opts = {}) => addJokerToExp(exp, opts, rr),
    destroyJoker: uid => destroyLineupJoker(exp, uid),
    // [M9] 销毁作用于本局牌组；紫蜡封牌被销毁 → 产塔罗（原作弃牌语义映射）
    destroyCard: cardId => destroyDeckCard(exp, cardId),
    addCardToDeck: (opts = {}) => addDeckCard(exp, opts, rr),
    copyCardToDeck: card => {
      if (exp.deck.length >= DECK_CAP) return null
      const copy = { ...card, id: `pc_${Date.now().toString(36)}_${exp.deck.length}_${exp.stats.handsPlayedTotal}` }
      exp.deck.push(copy)
      exp._pendingEvents?.push({ type: 'cardAdded', cardId: copy.id, source: 'copy' })
      return copy
    },
    // 证书：回合开始加随机蜡封牌（原作加入手牌并入牌堆 → 远征直接入牌组）
    addCardToHand: (opts = {}) => addDeckCard(exp, opts, rr),
    addRandomSealedCardToHand: () => addDeckCard(exp, { seal: rr.pick(['red', 'blue', 'purple', 'gold']) }, rr),
    addTag: () => {},
    disableBoss: () => { exp.bossDisabledToday = true },
  }
}

// ================= 局内卡牌操作（economy/consumables 共用） =================
export function addConsumableToExp(exp, id, edition = null) {
  if (!id || exp.consumables.length >= consumableSlotCountOf(exp)) return null
  const c = { uid: `xc_${Date.now().toString(36)}_${exp.consumables.length}_${exp.stats.handsPlayedTotal}`, id, edition }
  exp.consumables.push(c)
  markSeen(exp, id)
  return c
}

// 局内小丑入阵容（版本 = 原作数值语义；栏满返回 null）
export function addJokerToExp(exp, { id, edition = null } = {}, rr = null) {
  const def = JOKERS_BY_ID[id]
  if (!def) return null
  if (exp.jokers.length >= jokerSlotCountOf(exp)) return null
  const j = {
    uid: `xj_${Date.now().toString(36)}_${exp.jokers.length}_${(exp.stats.handsPlayedTotal || 0)}_${Math.floor((rr ? rr.next() : Math.random()) * 1e6)}`,
    id, edition, state: def.effect ? structuredCloneSafe(initialJokerState(def)) : {},
    sellBonus: 0, debuffed: false,
  }
  exp.jokers.push(j)
  markSeen(exp, id)
  return j
}

function structuredCloneSafe(o) { return JSON.parse(JSON.stringify(o)) }

// 扑克牌入本局牌组（上限 52；cardAdded 事件供全息成长）
export function addDeckCard(exp, { rank, suit, enhancement = null, edition = null, seal = null } = {}, rr = null) {
  if (exp.deck.length >= DECK_CAP) return null
  const r = rr || exp.rng
  const card = makeCard(rank || r.int(2, 14), suit || r.pick(SUITS), { enhancement, edition, seal })
  exp.deck.push(card)
  markSeen(exp, 'playing_card')
  exp._pendingEvents?.push({ type: 'cardAdded', cardId: card.id, enhancement, edition, seal })
  return card
}

// 从本局牌组销毁（玻璃碎裂/死神/倒吊人/使魔等；紫蜡封 → 产塔罗）
export function destroyDeckCard(exp, cardId) {
  const card = exp.deck.find(c => c.id === cardId)
  if (!card) return false
  exp.deck = exp.deck.filter(c => c.id !== cardId)
  exp._pendingEvents?.push({ type: 'cardDestroyed', cardId, seal: card.seal || null })
  if (card.seal === 'purple') {
    addConsumableToExp(exp, exp.rng.pick(TAROT).id)
    exp._pendingEvents?.push({ type: 'sealRefund', seal: 'purple', cardId })
  }
  return true
}

// 销毁阵容小丑（巴斯光年自毁/仪式匕首/妖法等）
export function destroyLineupJoker(exp, uid) {
  const j = exp.jokers.find(x => x.uid === uid)
  if (!j) return false
  exp.jokers = exp.jokers.filter(x => x.uid !== uid)
  exp._pendingEvents?.push({ type: 'jokerDestroyed', uid, id: j.id })
  return true
}

// 图鉴点亮（见过即发现，契约 §1；永久层在 store，局内先记账）
export function markSeen(exp, id) {
  if (!id) return
  if (!exp.seen[id]) exp.seen[id] = 0
  exp.seen[id] += 1
}

// 阶段触发（镜像 run.js emitJokersPhase）：蓝图/头脑风暴复制解析逻辑原样复用
export function emitJokersPhase(exp, run, round, rng, phase, extra = {}) {
  const events = []
  const emit = e => events.push(e)
  const helpers = adapterHelpers(exp, run, rng)
  exp._pendingEvents = events // destroyLineupJoker/destroyDeckCard 的事件出口
  for (const j of [...exp.jokers]) {
    if (j.debuffed) continue
    const resolved = jokerHandlerFor(j, exp.jokers)
    if (!resolved) continue
    const handler = JOKER_HANDLERS[resolved.def.effect.handler]
    if (!handler) continue
    const ctx = {
      run, round, phase, emit, rng,
      joker: resolved.joker, def: resolved.def, helpers,
      score: extra.score || { chips: 0, mult: 0 },
      played: [], scored: [], held: [], hand: { handType: null },
      ...extra,
    }
    handler(ctx, resolved.def.effect.params || {})
  }
  exp._pendingEvents = null
  return events
}
