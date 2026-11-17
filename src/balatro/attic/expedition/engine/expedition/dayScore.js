// 日计分管线（契约 §5.3 老虎机）：每活跃日 = N 次拉杆（N = 当日行动牌数 ≤ 上限）
// 每次拉杆：可播种 RNG 从抽取池（今日行动牌堆 + 本局扑克牌组）无放回抽 5 张
// （池不足重洗补足）→ evaluate 牌型 → 基础筹码/倍率（hands.js 等级，星球生效）
// → 逐张计分（rank 筹码 + 增强/蜡封/版本，原作语义，score.js 既有逻辑）
// → 小丑从左到右触发（state 跨活跃日持久）→ Boss 规则/意图修正（按本次拉杆）
// → total = chips × mult = 本次拉杆伤害；当日伤害 = Σ 每次拉杆
// 事件流以「一次拉杆」为演出单位（pullStart → 计分事件 → pullTotal）

import { scoreHand } from '../../../../engine/score.js'
import { evaluate } from '../../../../engine/evaluate.js'
import { cardChips, SUITS } from '../../../../engine/deck.js'
import { round2 } from '../../../../engine/jokerEffects.js'
import { HAND_CONTAINS, HANDS } from '../../../../data/hands.js'
import { EXPEDITION_BOSSES_BY_ID } from '../../data/expedition/bosses.js'
import {
  adapterRun, adapterRound, adapterHelpers, emitJokersPhase, computeModifiers,
  drawCountOf, pullsCapOf, unusedSlotsOf,
} from './adapter.js'
import { applyDayEffects, revertCardMutations } from './consumables.js'

// 牌型是否「包含」目标牌型（沿用原作 contains 语义，皇家视为同花顺）
function handIncludes(hand, target) {
  const t = hand.royal ? 'straight_flush' : hand.handType
  return (HAND_CONTAINS[t] || []).includes(target) || t === target
}

function distinctSuits(cards) {
  return new Set(cards.filter(c => c.enhancement !== 'stone').map(c => c.suit)).size
}

// 每日轮换状态（镜像 run.js 的回合开始随机化：远古/偶像/待办清单等，[M8] 日 = 回合）
function rollDailyJokerStates(exp, rng) {
  for (const j of exp.jokers) {
    const hid = j.id
    if (hid === 'j_mail_in_rebate') j.state.rank = rng.int(2, 14)
    else if (hid === 'j_castle' || hid === 'j_ancient_joker') j.state.suit = rng.pick(SUITS)
    else if (hid === 'j_the_idol') { j.state.rank = rng.int(2, 14); j.state.suit = rng.pick(SUITS) }
    else if (hid === 'j_to_do_list') {
      j.state.hand = rng.pick(['pair', 'two_pair', 'three_of_a_kind', 'straight', 'flush', 'full_house', 'high_card'])
    }
  }
}

// 从抽取池无放回抽 n 张；池不足时重洗补足（契约 §5.3，红线 §10.7 可播种 RNG）
export function drawPull(pool, n, rng) {
  const drawn = []
  let pile = rng.shuffle([...pool])
  while (drawn.length < n && pool.length) {
    if (!pile.length) pile = rng.shuffle([...pool]) // 重洗补足
    drawn.push(pile.pop())
  }
  const drawnIds = new Set(drawn.map(c => c.id))
  const left = pool.filter(c => !drawnIds.has(c.id)) // [M2] held = 未抽中的池牌
  return { drawn, left }
}

// 计一个活跃日。actionCards = buildActionCards 返回的计分行动牌（scores=true 子集）
// 返回 { total, pulls, events, pressureFlags, researchBefore, researchAfter }
export function scoreDay(exp, { actionCards, intent = null, rng }) {
  const events = []
  const emit = e => events.push(e)
  const boss = EXPEDITION_BOSSES_BY_ID[exp.bossId]
  const bossRule = boss?.rules?.[0]?.id
  // 奇科特（Chicot）：禁用 Boss 常驻规则与意图（原作「禁用 Boss 盲注效果」语义）
  const chicot = exp.jokers.some(j => !j.debuffed && j.id === 'j_chicot')
  const bossOn = boss && !exp.bossDisabledToday && !chicot

  rollDailyJokerStates(exp, rng)

  // ---- 抽取池 = 今日行动牌堆 + 本局扑克牌组（契约 §5.2） ----
  const pool = [...actionCards, ...exp.deck]

  const run = adapterRun(exp)
  const round = adapterRound(exp)
  const helpers = adapterHelpers(exp, run, rng)
  const researchBefore = exp.research
  const modifiers = computeModifiers(exp)
  const drawCount = drawCountOf(exp) // [M4]
  const node = exp.nodes[exp.nodeIndex] || null

  // ---- 消耗牌/商店的当日修正（作用于池，日终还原；scoreMods 按抽应用） ----
  const dayFx = applyDayEffects(exp, pool, emit)

  // ---- [M7] 盲注选择阶段（活跃日开始；节点即盲注） ----
  const pullsPlanned = Math.max(1, Math.min(actionCards.length, pullsCapOf(exp)))
  round.handsLeft = pullsPlanned
  round.discardsLeft = unusedSlotsOf(exp, actionCards.length) // [M6]
  round.bossDisabled = exp.bossDisabledToday
  const blindType = node?.kind === 'boss' ? 'boss' : 'small'
  events.push(...emitJokersPhase(exp, run, round, rng, 'blindSelect', { blindType }))
  // 窃贼：round.handsLeft/discardsLeft 被 handler 改写 → 读回当日拉杆/槽位
  const pulls = Math.max(1, Math.min(10, Math.round(round.handsLeft)))
  events.push(...emitJokersPhase(exp, run, round, rng, 'roundStart'))

  let dayTotal = 0
  let lastHeld = []
  let bossInterferedPrevPull = false

  for (let i = 0; i < pulls; i++) {
    const { drawn, left } = drawPull(pool, drawCount, rng)
    lastHeld = left
    round.handsLeft = pulls - 1 - i          // [M5] 黄昏/杂技演员：最后一抽 = 最后一手
    round.handsPlayedThisRound = i
    round.drawPile = left
    round.bossTriggeredThisHand = bossInterferedPrevPull

    // 牌型与计分按本抽抽中的物理卡：重洗补足的重复仅为演出占位（契约 §5.5 标定目标
    // 与 §5.3 抽取规则的唯一自洽解读——否则 2-3 卡池必然产出 full_house 起步，
    // 裸装日伤害期望不可能落入 Boss HP 12-15% 带内）。抽取事件仍报 5 个位置。
    const seenIds = new Set()
    const playedCards = drawn.filter(c => !seenIds.has(c.id) && seenIds.add(c.id))

    emit({
      type: 'pullStart', pullIndex: i, pulls, drawCount,
      drawn: drawn.map(c => ({ id: c.id, rank: c.rank, rankLabel: c.rankLabel, suit: c.suit, enhancement: c.enhancement, edition: c.edition, seal: c.seal, source: c.source || 'deck' })),
      phantom: drawn.length - playedCards.length, // 重复占位格数（UI 演出可标识）
    })

    // ---- Boss 当日意图/常驻规则：本抽前置（临时修正，抽后还原） ----
    const mutations = []
    let played = playedCards
    if (bossOn && intent?.id === 'suit_weaken' && intent.suit) {
      // 花色削弱：该花色本抽不计入牌型与计分
      const weakened = played.filter(c => c.suit === intent.suit && c.enhancement !== 'stone')
      if (weakened.length) {
        played = played.filter(c => !weakened.includes(c))
        round.bossTriggeredThisHand = true
        emit({ type: 'bossIntent', intent: intent.id, suit: intent.suit, pullIndex: i, weakenedCardIds: weakened.map(c => c.id) })
      }
    } else if (bossOn && intent?.id === 'grace_flush' && played.length) {
      // 恩赐日：本抽所有牌视为同花色（取本抽最多的花色）
      const counts = {}
      for (const c of played) if (c.enhancement !== 'stone') counts[c.suit] = (counts[c.suit] || 0) + 1
      const suit = SUITS.filter(s => counts[s]).sort((a, b) => counts[b] - counts[a])[0]
      if (suit) {
        for (const c of played) { mutations.push([c, 'suit', c.suit]); c.suit = suit }
        round.bossTriggeredThisHand = true
        emit({ type: 'bossIntent', intent: intent.id, suit, pullIndex: i, grace: true })
      }
    }
    if (bossOn && bossRule === 'repeat_rank_decay') {
      // 拖延之墙：本抽相同点数第 2 张起点数筹码减半
      const seen = new Map()
      for (const c of played) {
        const n = (seen.get(c.rank) || 0) + 1
        seen.set(c.rank, n)
        if (n >= 2) {
          const base = cardChips(c)
          const halved = Math.floor(base / 2)
          mutations.push([c, 'bonusChips', c.bonusChips || 0])
          c.bonusChips = (c.bonusChips || 0) - (base - halved)
          round.bossTriggeredThisHand = true
          emit({ type: 'bossRule', rule: 'repeat_rank_decay', pullIndex: i, cardId: c.id, rank: c.rank, chipsFrom: base, chipsTo: halved })
        }
      }
    }

    let pullTotal = 0
    let handType = null
    if (!played.length) {
      emit({ type: 'pullVoid', pullIndex: i, reason: 'all_weakened' })
    } else {
      // ---- 出牌前置阶段（绿色小丑等成长型逐抽成长） ----
      const preHand = evaluate(played, modifiers)
      events.push(...emitJokersPhase(exp, run, round, rng, 'handPlayed', { played, hand: preHand }))
      // ---- 计分（复用 engine/score.js 完整管线；held = 未抽中的池牌） ----
      const result = scoreHand({ run, round, played, held: left, helpers, rng })
      events.push(...result.events)
      const score = { chips: result.chips, mult: result.mult }
      handType = result.hand.handType

      // ---- Boss 常驻规则/意图：本抽后置修正 ----
      if (bossOn && bossRule === 'suit_diversity_penalty') {
        const factor = boss.rules[0].factor ?? 0.85
        const s = distinctSuits(played)
        if (s >= 2) {
          const beforeM = score.mult
          score.mult = round2(score.mult * Math.pow(factor, s - 1))
          bossInterferedPrevPull = true
          emit({ type: 'bossRule', rule: 'suit_diversity_penalty', pullIndex: i, suits: s, factor: Math.pow(factor, s - 1), multFrom: beforeM, multTo: score.mult })
        }
      }
      if (bossOn && intent?.id === 'straight_grace' && handIncludes(result.hand, 'straight')) {
        const factor = intent.factor ?? 1.5
        const beforeM = score.mult
        score.mult = round2(score.mult * factor)
        emit({ type: 'bossIntent', intent: intent.id, pullIndex: i, xMult: factor, multFrom: beforeM, multTo: score.mult })
      }

      // ---- 消耗牌/商店当日修正（按抽应用） ----
      if (dayFx.chipsAdd) { score.chips += dayFx.chipsAdd; emit({ type: 'dayMod', pullIndex: i, chipsAdd: dayFx.chipsAdd }) }
      if (dayFx.multAdd) { score.mult += dayFx.multAdd; emit({ type: 'dayMod', pullIndex: i, multAdd: dayFx.multAdd }) }
      pullTotal = Math.max(0, Math.round(score.chips * score.mult))
      if (dayFx.damageMult && dayFx.damageMult !== 1) {
        pullTotal = Math.round(pullTotal * dayFx.damageMult)
        emit({ type: 'dayMod', pullIndex: i, damageMult: dayFx.damageMult, total: pullTotal })
      }

      // ---- 牌型统计（超新星/卡牌高手/忠诚等逐抽累计） ----
      exp.stats.handsPlayed[handType] = (exp.stats.handsPlayed[handType] || 0) + 1
      exp.stats.handsPlayedTotal += 1
      round.handTypesPlayed.push(handType)
      // Seltzer 计数（镜像 run.js 出牌后递减，逐抽）
      for (const j of exp.jokers) if (j.id === 'j_seltzer' && (j.state.handsLeft ?? 0) > 0) j.state.handsLeft -= 1
    }

    revertCardMutations(mutations)
    dayTotal += pullTotal
    emit({ type: 'pullTotal', pullIndex: i, total: pullTotal, handType })
  }

  emit({ type: 'dayTotal', total: dayTotal, pulls })

  // ---- 日级意图违规判定（压力来源之二，契约 §4.2；按今日行动牌堆时序） ----
  const pressureFlags = []
  if (bossOn && intent?.id === 'switch_pressure') {
    // 换轨施压：行动牌按时间顺序出现第 2 次换轨（相邻花色变化 ≥2 次）→ 压力 +1
    let switches = 0
    for (let k = 1; k < actionCards.length; k++) if (actionCards[k].suit !== actionCards[k - 1].suit) switches++
    if (switches >= 2) {
      pressureFlags.push({ intent: intent.id, switches })
      emit({ type: 'intentViolation', intent: intent.id, switches })
    }
  } else if (bossOn && intent?.id === 'repeat_suit_pressure') {
    // 重复花色施压：今日行动牌堆出现重复花色 → 压力 +1
    const counts = {}
    let repeated = false
    for (const c of actionCards) { counts[c.suit] = (counts[c.suit] || 0) + 1; if (counts[c.suit] >= 2) repeated = true }
    if (repeated) {
      pressureFlags.push({ intent: intent.id })
      emit({ type: 'intentViolation', intent: intent.id })
    }
  }

  // ---- [M8] 日终阶段（镜像 run.js roundEnd：经济型小丑产出研料） ----
  events.push(...emitJokersPhase(exp, run, round, rng, 'roundEnd'))

  // ---- 蓝蜡封：日终时每张未抽中的蓝封牌 → 产最常用牌型的星球（镜像 run.js:554） ----
  {
    const most = helpers.mostPlayedHand()
    const planet = most && HANDS.find(h => h.id === most)?.planet
    if (planet) {
      for (const c of lastHeld) {
        if (c.seal === 'blue' && !c.debuffed) {
          const created = helpers.createConsumable(planet)
          if (created) emit({ type: 'sealRefund', seal: 'blue', cardId: c.id, planetId: planet })
        }
      }
    }
  }

  // ---- 当日修正的池改动统一还原（sigil/ouija 等临时 mutation 不得残留到次日） ----
  revertCardMutations(dayFx.mutations)

  exp.bossDisabledToday = false // 每日重置
  return {
    total: dayTotal, pulls, events, pressureFlags,
    researchBefore, researchAfter: exp.research,
  }
}
