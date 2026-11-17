// 计分管线（§5.2）：严格按原作顺序，产出有序事件流
// 1 evaluate → 2 基础筹码/倍率 → 3 逐张计分牌（含重触发/增强/蜡封/版本/小丑监听）
// → 4 手牌持有效果（钢铁/男爵等，Mime/红封重触发）→ 5 小丑阵列从左到右
// → 6 Plasma 修正 → 7 total = chips × mult

import { evaluate } from './evaluate.js'
import { handScore } from '../data/hands.js'
import { cardChips } from './deck.js'
import { JOKER_HANDLERS, jokerHandlerFor, triggerCountFor, round2, prob } from './jokerEffects.js'

export function scoreHand({ run, round, played, held, helpers, rng }) {
  const events = []
  const emit = e => events.push(e)
  const hand = evaluate(played, run.modifiers)
  const level = run.handLevels[hand.handType] || 1
  let { chips, mult } = handScore(hand.handType, level)

  // Boss：燧石 —— 基础筹码与倍率减半
  if (round.boss?.effect?.handler === 'flint' && !round.bossDisabled) {
    chips = Math.floor(chips / 2); mult = Math.max(1, Math.floor(mult / 2))
    emit({ type: 'bossEffect', id: 'bl_flint' })
  }
  emit({ type: 'handEvaluated', handType: hand.handType, royal: hand.royal, level, chips, mult, scoringIds: hand.scoringIds })

  const score = { chips, mult }
  const scoringCards = played.filter(c => hand.scoringIds.includes(c.id))
  const ctxBase = { run, round, played, scored: scoringCards, held, hand, emit, rng, score, helpers }

  const callJokersPhase = (phase, extra = {}) => {
    for (const j of run.jokers) {
      if (j.debuffed) continue
      const resolved = jokerHandlerFor(j, run.jokers)
      if (!resolved) continue
      const handler = JOKER_HANDLERS[resolved.def.effect.handler]
      if (!handler) continue
      const ctx = { ...ctxBase, ...extra, phase, joker: resolved.joker, def: resolved.def, sourceUid: j.uid, sourceId: j.id }
      const before = events.length
      handler(ctx, resolved.def.effect.params || {})
      // 蓝图/头脑风暴触发时，事件标记来源
      if (resolved.copiedBy) {
        for (let i = before; i < events.length; i++) {
          if (events[i].type === 'jokerTrigger') { events[i].copiedByUid = resolved.copiedBy.uid; events[i].copiedById = resolved.copiedBy.id }
        }
      }
    }
  }

  // ---- 3. 逐张计分牌 ----
  const glassToBreak = []
  for (const card of scoringCards) {
    const triggers = triggerCountFor(card, run.jokers, ctxBase, 'played')
    for (let t = 0; t < triggers; t++) {
      if (!card.debuffed) {
        const gained = cardChips(card) + (card.bonusChips || 0)
        score.chips += gained
        emit({ type: 'cardScore', cardId: card.id, chips: gained, retrigger: t > 0 })
        // 增强
        if (card.enhancement === 'bonus') { score.chips += 30; emit({ type: 'cardScore', cardId: card.id, chips: 30, source: 'bonus' }) }
        else if (card.enhancement === 'mult') { score.mult += 4; emit({ type: 'cardScore', cardId: card.id, mult: 4, source: 'mult' }) }
        else if (card.enhancement === 'glass') { score.mult = round2(score.mult * 2); emit({ type: 'cardScore', cardId: card.id, xMult: 2, source: 'glass' }) }
        else if (card.enhancement === 'lucky') {
          if (prob(ctxBase, 5)) { score.mult += 20; emit({ type: 'cardScore', cardId: card.id, mult: 20, source: 'lucky' }) }
          if (prob(ctxBase, 15)) { helpers.addMoney(20); emit({ type: 'cardScore', cardId: card.id, money: 20, source: 'lucky' }) }
          if (card.enhancement === 'lucky') { /* Lucky Cat 统计在 run 层 */ }
        }
        // 蜡封
        if (card.seal === 'gold') { helpers.addMoney(3); emit({ type: 'cardScore', cardId: card.id, money: 3, source: 'goldSeal' }) }
        // 版本
        if (card.edition === 'foil') { score.chips += 50; emit({ type: 'cardScore', cardId: card.id, chips: 50, source: 'foil' }) }
        else if (card.edition === 'holo') { score.mult += 10; emit({ type: 'cardScore', cardId: card.id, mult: 10, source: 'holo' }) }
        else if (card.edition === 'poly') { score.mult = round2(score.mult * 1.5); emit({ type: 'cardScore', cardId: card.id, xMult: 1.5, source: 'poly' }) }
      } else {
        emit({ type: 'cardScore', cardId: card.id, debuffed: true })
      }
      // 小丑监听此牌（每次触发都监听）
      callJokersPhase('scoredCard', { card })
    }
    if (card.enhancement === 'glass' && !card.debuffed) glassToBreak.push(card)
  }

  // ---- 4. 手牌持有效果 ----
  for (const card of held) {
    const triggers = triggerCountFor(card, run.jokers, ctxBase, 'held')
    for (let t = 0; t < triggers; t++) {
      if (!card.debuffed && card.enhancement === 'steel') {
        score.mult = round2(score.mult * 1.5)
        emit({ type: 'heldCard', cardId: card.id, xMult: 1.5, source: 'steel', retrigger: t > 0 })
      }
      callJokersPhase('heldCard', { card })
    }
  }

  // ---- 5. 小丑阵列（左 → 右）：版本前置 → 效果 → 多彩后置 ----
  for (const j of run.jokers) {
    if (j.debuffed) continue
    const def = helpers.defOf(j.id)
    if (!def) continue
    if (j.edition === 'foil') { score.chips += 50; emit({ type: 'jokerTrigger', uid: j.uid, id: j.id, chips: 50, source: 'foil' }) }
    else if (j.edition === 'holo') { score.mult += 10; emit({ type: 'jokerTrigger', uid: j.uid, id: j.id, mult: 10, source: 'holo' }) }
    // 效果
    const resolved = jokerHandlerFor(j, run.jokers)
    if (resolved) {
      const handler = JOKER_HANDLERS[resolved.def.effect.handler]
      if (handler) {
        const ctx = { ...ctxBase, phase: 'jokerScore', joker: resolved.joker, def: resolved.def }
        const before = events.length
        handler(ctx, resolved.def.effect.params || {})
        if (resolved.copiedBy) {
          for (let i = before; i < events.length; i++) {
            if (events[i].type === 'jokerTrigger') { events[i].copiedByUid = resolved.copiedBy.uid; events[i].copiedById = resolved.copiedBy.id }
          }
        }
      }
    }
    if (j.edition === 'poly') { score.mult = round2(score.mult * 1.5); emit({ type: 'jokerTrigger', uid: j.uid, id: j.id, xMult: 1.5, source: 'poly' }) }
  }

  // ---- 天文台：消耗栏星球牌为对应牌型 ×1.5 ----
  if (run.vouchers.includes('v_observatory')) {
    for (const c of run.consumables) {
      const def = helpers.defOf(c.id)
      if (def?.type === 'planet' && def.hand === hand.handType) {
        score.mult = round2(score.mult * 1.5)
        emit({ type: 'jokerTrigger', uid: c.uid, id: c.id, xMult: 1.5, source: 'observatory' })
      }
    }
  }

  // ---- 玻璃碎裂：所有计分结束后，每张三分数 1/4 概率销毁 ----
  for (const card of glassToBreak) {
    if (prob(ctxBase, 4)) {
      helpers.destroyCard(card.id)
      emit({ type: 'glassBreak', cardId: card.id })
      callJokersPhase('glassDestroyed', { card })
    }
  }

  // ---- 6. Plasma：筹码与倍率取平均 ----
  let finalChips = score.chips
  let finalMult = score.mult
  if (run.modifiers?.plasma) {
    const avg = Math.floor((score.chips + score.mult) / 2)
    finalChips = avg; finalMult = avg
    emit({ type: 'plasmaBalance', chips: avg, mult: avg })
  }

  // ---- 7. 总分 ----
  const total = Math.max(0, Math.round(finalChips * finalMult))
  emit({ type: 'final', chips: finalChips, mult: finalMult, total })
  return { total, chips: finalChips, mult: finalMult, hand, events }
}
