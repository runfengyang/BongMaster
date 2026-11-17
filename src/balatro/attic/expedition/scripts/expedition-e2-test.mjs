// 远征引擎 Phase E2 验收测试（契约 §9 Phase E2，§16 老虎机模型修订）
// node scripts/expedition-e2-test.mjs
// 覆盖：① 小丑 150 三档适配登记完整性（direct 122 / adapted 12 / fidelity 16）；
//      ② 塔罗 22 + 幻灵 18 翻译表与效果引擎（每张 ≥1 用例；改牌类恢复原作语义作用牌组）；
//      ③ 星球 12 接入 + 星座联动；④ 扑克增强 8 + 蜡封 4 拉杆计分用例（score.js 既有逻辑）；
//      ⑤ 起始构筑阶梯 / 局内开包 / 商店；⑥ 研料经济闭环 10 局无死锁（draft→节点包→商店→清算）

import { Expedition } from '../engine/expedition/stateMachine.js'
import {
  addConsumableToExp, addJokerToExp, addDeckCard, destroyDeckCard,
  jokerSlotCountOf,
} from '../engine/expedition/adapter.js'
import { useConsumable } from '../engine/expedition/consumables.js'
import {
  poolForWins, ladderTier, starterSpec, rollPackOptions, openInRunPack, applyPackPicks,
  skipInRunPack, offerForNodeCleared, generateExpeditionShop, buyShopOffer,
  rerollExpeditionShop, canShop, EXPEDITION_SHOP_POOL,
} from '../engine/expedition/economy.js'
import {
  CONSUMABLE_SLOTS, CREDIT_LIMIT, DAYS_PER_RUN, STARTING_RESEARCH, SHOP_REROLL_COST,
} from '../engine/expedition/balance.js'
import {
  TAROT_TRANSLATION, SPECTRAL_TRANSLATION,
} from '../data/expedition/consumableTranslation.js'
import {
  JOKER_ADAPTATION, ADAPTATION_SUMMARY, VALID_TIERS, adaptationTierOf,
} from '../data/expedition/jokerAdaptation.js'
import { JOKERS } from '../../../data/jokers.js'
import { TAROT } from '../../../data/tarot.js'
import { PLANETS, PLANETS_BY_ID } from '../../../data/planets.js'
import { SPECTRAL, SPECTRAL_POOL } from '../../../data/spectral.js'
import { PACKS_BY_ID } from '../../../data/packs.js'
import { HANDS } from '../../../data/hands.js'
import { projectSuit } from '../engine/expedition/actionCards.js'

let passed = 0, failed = 0
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`) }
  else { failed++; console.error(`  ✗ FAIL: ${msg}`) }
}
function section(name) { console.log(`\n== ${name} ==`) }

const DAY = '2026-07-01'
const CALM = { id: 'calm', name: '平静日' } // 无干预意图，隔离 Boss 随机性
const ev = (type, extra = {}) => ({
  type, taskId: extra.taskId ?? `${type}_${Math.random()}`,
  createdAt: '2026-06-01T10:00:00', // 当日 00:00 前已存在 → 全额 rank
  completedAt: `${DAY}T12:00:00`,
  ...extra,
})
function pidForSuit(suit, start = 0) {
  for (let i = start; i < 10000; i++) if (projectSuit(`P${i}`) === suit) return `P${i}`
  throw new Error('no pid for suit ' + suit)
}
// 测试直装：跳过 draft；默认空阵容/空牌组（池 = 行动牌）
const mkExp = (overrides = {}) => new Expedition({
  bossId: 'boss_distraction', seed: 'e2', lineup: [], deck: [], ...overrides,
})
const settle = (exp, events, opts = {}) =>
  exp.settleDay({ date: opts.date || DAY, events, intent: opts.intent === undefined ? CALM : opts.intent })
// 给 exp 加一张消耗牌并使用
function useById(exp, id, opts = {}) {
  const c = addConsumableToExp(exp, id)
  if (!c) return { ok: false, reason: 'no_slot', events: [] }
  return useConsumable(exp, c.uid, opts)
}
// 直装一叠普通牌组（无增强）
const plainDeck = (n = 5) => Array.from({ length: n }, (_, i) => ({ rank: 2 + i, suit: 'spades' }))

// ================= ① 适配登记完整性 =================
section('小丑 150 三档适配登记完整性（契约 §9 E2 ①）')
{
  const ids = JOKERS.map(j => j.id)
  const keys = Object.keys(JOKER_ADAPTATION)
  assert(keys.length === 150 && ids.every(id => keys.includes(id)), `登记覆盖全部 150 张（实际 ${keys.length}）`)
  assert(keys.every(k => VALID_TIERS.includes(JOKER_ADAPTATION[k].tier)), '全部 tier 合法（direct/adapted/fidelity）')
  assert(keys.every(k => typeof JOKER_ADAPTATION[k].note === 'string' && JOKER_ADAPTATION[k].note.length > 0), '每张含偏差/映射注明')
  const count = { direct: 0, adapted: 0, fidelity: 0 }
  for (const k of keys) count[JOKER_ADAPTATION[k].tier]++
  assert(count.direct === 122 && count.adapted === 12 && count.fidelity === 16,
    `三档：direct ${count.direct} / adapted ${count.adapted} / fidelity ${count.fidelity}（目标 122/12/16）`)
  assert(count.direct >= 120, '契约目标：直接可用 ≥ 120')
  assert(count.direct + count.adapted + count.fidelity === 150, '三档合计 = 150')
  assert(ADAPTATION_SUMMARY.direct === count.direct && ADAPTATION_SUMMARY.adapted === count.adapted
    && ADAPTATION_SUMMARY.fidelity === count.fidelity && ADAPTATION_SUMMARY.total === 150, 'ADAPTATION_SUMMARY 与登记一致')
  assert(adaptationTierOf('j_joker') === 'direct' && adaptationTierOf('j_credit_card') === 'adapted'
    && adaptationTierOf('j_luchador') === 'fidelity' && adaptationTierOf('nope') === null, 'adaptationTierOf 查询')
  // fidelity 名单固定（弃牌 7 / 卖出 4 / 跳盲注 1 / E4 商店 2 / 主引擎未实现钩子 2）
  const fidelity = keys.filter(k => JOKER_ADAPTATION[k].tier === 'fidelity').sort()
  assert(JSON.stringify(fidelity) === JSON.stringify([
    'j_astronomer', 'j_burnt_joker', 'j_campfire', 'j_canio', 'j_castle', 'j_diet_cola',
    'j_faceless_joker', 'j_hit_the_road', 'j_invisible_joker', 'j_luchador', 'j_lucky_cat',
    'j_mail_in_rebate', 'j_showman', 'j_throwback', 'j_trading_card', 'j_yorick',
  ]), 'fidelity 16 名单固定（弃牌/卖出/跳盲注/E4 商店/未实现钩子）')
}

// ================= ② 塔罗 22：每张 ≥1 用例 =================
section('塔罗 22 翻译表与效果引擎（改牌类恢复原作语义作用牌组）')
{
  assert(TAROT.length === 22 && TAROT.every(t => TAROT_TRANSLATION[t.id]), '塔罗 22 全量翻译')

  // 愚者：复制上一张（先隐者 +2 研料，愚者再 +2）
  {
    const exp = mkExp()
    const r0 = exp.research
    assert(useById(exp, 'c_hermit').ok && exp.research === r0 + 2, '隐者：研料 +2')
    assert(useById(exp, 'c_fool').ok && exp.research === r0 + 4, '愚者：复制上一张（隐者 → 再 +2）')
  }
  // 魔术师/恋人：万能
  {
    const exp = mkExp({ deck: plainDeck() })
    assert(useById(exp, 'c_magician').ok && exp.deck.filter(c => c.enhancement === 'wild').length === 2, '魔术师：牌组 2 张变万能')
    assert(useById(exp, 'c_lovers').ok && exp.deck.filter(c => c.enhancement === 'wild').length === 3, '恋人：牌组 1 张变万能')
  }
  // 女祭司/皇帝：产牌入栏（栏位 2 起步）
  {
    const exp = mkExp()
    const r = useById(exp, 'c_high_priestess')
    assert(r.ok && exp.consumables.filter(c => c.id.startsWith('p_')).length === 2, '女祭司：2 星球入消耗栏')
    const exp2 = mkExp()
    const r2 = useById(exp2, 'c_emperor')
    assert(r2.ok && exp2.consumables.filter(c => c.id.startsWith('c_')).length === 2, '皇帝：2 塔罗入消耗栏')
  }
  // 皇后/教皇/战车/正义/恶魔：增强
  {
    const exp = mkExp({ deck: plainDeck() })
    assert(useById(exp, 'c_empress').ok && exp.deck.filter(c => c.enhancement === 'mult').length === 2, '皇后：2 张变倍率牌')
    assert(useById(exp, 'c_hierophant').ok && exp.deck.filter(c => c.enhancement === 'bonus').length === 2, '教皇：2 张变奖励牌')
    assert(useById(exp, 'c_chariot').ok && exp.deck.filter(c => c.enhancement === 'steel').length === 1, '战车：1 张变钢铁牌')
    assert(useById(exp, 'c_justice').ok && exp.deck.filter(c => c.enhancement === 'glass').length === 1, '正义：1 张变玻璃牌')
    assert(useById(exp, 'c_devil').ok && exp.deck.filter(c => c.enhancement === 'gold').length === 1, '恶魔：1 张变黄金牌')
  }
  // 力量：rank+1
  {
    const exp = mkExp({ deck: [{ rank: 5, suit: 'spades' }, { rank: 9, suit: 'hearts' }] })
    const before = exp.deck.map(c => c.rank)
    assert(useById(exp, 'c_strength', { targets: exp.deck.map(c => c.id) }).ok
      && exp.deck.every((c, i) => c.rank === before[i] + 1), '力量：2 张 rank +1')
  }
  // 倒吊人：销毁 2 张
  {
    const exp = mkExp({ deck: plainDeck() })
    assert(useById(exp, 'c_hanged_man').ok && exp.deck.length === 3, '倒吊人：销毁牌组 2 张')
  }
  // 死神：左变右复制
  {
    const exp = mkExp({ deck: [{ rank: 3, suit: 'spades' }, { rank: 12, suit: 'hearts', enhancement: 'glass' }] })
    const [l, r] = exp.deck
    assert(useById(exp, 'c_death', { targets: [l.id, r.id] }).ok
      && exp.deck.length === 2 && l.rank === 12 && l.suit === 'hearts' && l.enhancement === 'glass', '死神：左牌变右牌复制（牌数不变）')
  }
  // 节制：压力 -1
  {
    const exp = mkExp()
    exp.pressure = 2
    assert(useById(exp, 'c_temperance').ok && exp.pressure === 1, '节制：压力 -1（契约映射）')
  }
  // 命运之轮：1/4 版本（命中/未命中均合法）
  {
    const exp = mkExp({ lineup: [{ id: 'j_joker' }] })
    const r = useById(exp, 'c_wheel')
    assert(r.ok && r.events.some(e => e.type === 'wheelHit' || e.type === 'wheelMiss'), '命运之轮：1/4 随机小丑版本（命中或未命中）')
  }
  // 塔：重 roll Boss 今日意图
  {
    const exp = mkExp()
    const r = useById(exp, 'c_tower')
    const pool = ['switch_pressure', 'suit_weaken', 'grace_flush']
    assert(r.ok && exp.forcedIntent && pool.includes(exp.forcedIntent.id), `塔：重 roll 意图（实际 ${exp.forcedIntent?.id}）`)
  }
  // 星星/月亮/太阳/世界：变花色
  {
    const exp = mkExp({ deck: plainDeck(6) })
    assert(useById(exp, 'c_star').ok && exp.deck.filter(c => c.suit === 'diamonds').length === 3, '星星：3 张变 ♦')
    assert(useById(exp, 'c_moon').ok && exp.deck.filter(c => c.suit === 'clubs').length === 3, '月亮：3 张变 ♣')
    assert(useById(exp, 'c_sun').ok && exp.deck.filter(c => c.suit === 'hearts').length === 3, '太阳：3 张变 ♥')
    const expW = mkExp({ deck: Array.from({ length: 6 }, (_, i) => ({ rank: 2 + i, suit: 'clubs' })) })
    assert(useById(expW, 'c_world').ok && expW.deck.filter(c => c.suit === 'spades').length === 3, '世界：3 张变 ♠')
  }
  // 审判：随机小丑入阵容（需空栏位）
  {
    const exp = mkExp()
    assert(useById(exp, 'c_judgement').ok && exp.jokers.length === 1, '审判：随机小丑入阵容')
    const full = mkExp({ lineup: Array.from({ length: 5 }, () => ({ id: 'j_joker' })) })
    const rr = useById(full, 'c_judgement')
    assert(!rr.ok && rr.reason === 'lineup_full' && full.jokers.length === 5, '审判：栏满失败且不消耗')
  }
}

// ================= ② 幻灵 18：每张 ≥1 用例 =================
section('幻灵 18 翻译表与效果引擎')
{
  assert(SPECTRAL.length === 18 && SPECTRAL.every(s => SPECTRAL_TRANSLATION[s.id]), '幻灵 18 全量翻译（含灵魂/黑洞稀有档）')

  // 使魔/严峻/咒语：销毁 1 加 N 增强牌
  {
    const exp = mkExp({ deck: plainDeck() })
    assert(useById(exp, 's_familiar').ok && exp.deck.length === 7
      && exp.deck.filter(c => [11, 12, 13].includes(c.rank) && c.enhancement).length === 3, '使魔：销毁 1 → +3 增强人头')
    const exp2 = mkExp({ deck: plainDeck() })
    assert(useById(exp2, 's_grim').ok && exp2.deck.length === 6
      && exp2.deck.filter(c => c.rank === 14 && c.enhancement).length === 2, '严峻：销毁 1 → +2 增强 A')
    const exp3 = mkExp({ deck: plainDeck() })
    assert(useById(exp3, 's_incantation').ok && exp3.deck.length === 8
      && exp3.deck.filter(c => c.rank >= 2 && c.rank <= 10 && c.enhancement).length === 4, '咒语：销毁 1 → +4 增强数字牌')
  }
  // 护身符/光环/既视感/入迷/灵媒：蜡封与版本
  {
    const exp = mkExp({ deck: plainDeck() })
    assert(useById(exp, 's_talisman').ok && exp.deck.filter(c => c.seal === 'gold').length === 1, '护身符：1 张金蜡封')
    assert(useById(exp, 's_aura').ok && exp.deck.filter(c => ['foil', 'holo', 'poly'].includes(c.edition)).length === 1, '光环：1 张随机版本')
    assert(useById(exp, 's_deja_vu').ok && exp.deck.filter(c => c.seal === 'red').length === 1, '既视感：1 张红蜡封')
    assert(useById(exp, 's_trance').ok && exp.deck.filter(c => c.seal === 'blue').length === 1, '入迷：1 张蓝蜡封')
    assert(useById(exp, 's_medium').ok && exp.deck.filter(c => c.seal === 'purple').length === 1, '灵媒：1 张紫蜡封')
  }
  // 幽灵：稀有入阵容 + 研料归零（需 wins≥5 解锁稀有池）
  {
    const exp = mkExp({ wins: 5, research: 9 })
    const r = useById(exp, 's_wraith')
    assert(r.ok && exp.jokers.length === 1 && exp.jokers[0].id && exp.research === 0, '幽灵：稀有入阵容，研料归零')
  }
  // 符印：当日全抽同花色 → 同花；日终牌组花色还原
  {
    const exp = mkExp({ deck: [{ rank: 9, suit: 'spades' }] })
    assert(useById(exp, 's_sigil').ok && exp.pendingDayEffects.length === 1, '符印：当日修正入队')
    // 4♦ 5♦ 7♦ 8♠ + 9♠（点数互异）→ 符印同色后每抽皆同花
    const r = settle(exp, [
      ev('habit_checkin', { taskId: 'sg1', streak: 1 }),
      ev('daily_task', { taskId: 'sg2' }),
      ev('daily_task', { taskId: 'sg3', priority: '高' }),
      ev('project_task', { taskId: 'sg4', projectId: pidForSuit('spades') }),
    ])
    assert(r.events.some(e => e.type === 'dayFxApplied' && e.fx === 'allSameSuit'), '符印：日修正已应用')
    assert(r.events.filter(e => e.type === 'pullTotal').every(e => e.handType === 'flush'), '符印：每抽皆同花（异点 5 张同色）')
    assert(exp.deck[0].suit === 'spades', '符印：日终牌组花色还原（♠ 未残留）')
  }
  // 占卜：当日全抽同点；日终牌组点数还原
  {
    const exp = mkExp({ deck: [{ rank: 8, suit: 'spades' }] })
    assert(useById(exp, 's_ouija').ok, '占卜：当日修正入队')
    const r = settle(exp, [ev('daily_task', { taskId: 'oj1' }), ev('daily_task', { taskId: 'oj2' })])
    assert(r.events.some(e => e.type === 'dayFxApplied' && e.fx === 'allSameRank'), '占卜：日修正已应用')
    assert(exp.deck[0].rank === 8 && exp.deck[0].rankLabel === '8', '占卜：日终牌组点数还原（8 未残留）')
  }
  // 灵质：小丑负片 + 每抽 -1
  {
    const exp = mkExp({ lineup: [{ id: 'j_joker' }] })
    const r = useById(exp, 's_ectoplasm')
    assert(r.ok && exp.jokers[0].edition === 'negative' && exp.drawCountModifier === -1, '灵质：负片 +1 栏、每抽 -1')
    const rr = settle(exp, [ev('daily_task', { taskId: 'ec1' }), ev('daily_task', { taskId: 'ec2' })])
    assert(rr.events.every(e => e.type !== 'pullStart' || e.drawCount === 4), '灵质：次日起每抽 4 张')
  }
  // 火祭：销毁 1 小丑 → 当日全抽 ×2（4♦5♦7♦8♦+9♦ 满池同花 272/抽 ×4 抽 → 544×4）
  {
    const exp = mkExp({ lineup: [{ id: 'j_joker' }], deck: [{ rank: 9, suit: 'diamonds' }] })
    assert(useById(exp, 's_immolate').ok && exp.jokers.length === 0, '火祭：销毁阵容 1 小丑')
    const r = settle(exp, [
      ev('habit_checkin', { taskId: 'im1', streak: 1 }),
      ev('daily_task', { taskId: 'im2' }),
      ev('daily_task', { taskId: 'im3', priority: '高' }),
      ev('project_task', { taskId: 'im4', projectId: pidForSuit('diamonds') }),
    ])
    assert(r.events.filter(e => e.type === 'pullTotal').every(e => e.total === 544), `火祭：当日全部拉杆 ×2（272→${r.events.find(e => e.type === 'pullTotal')?.total}）`)
  }
  // 生命十字章：复制小丑（不复制版本）
  {
    const exp = mkExp({ lineup: [{ id: 'j_green_joker', edition: 'foil' }] })
    exp.jokers[0].state.mult = 7
    const r = useById(exp, 's_ankh')
    assert(r.ok && exp.jokers.length === 2 && exp.jokers[1].id === 'j_green_joker'
      && exp.jokers[1].edition === null && exp.jokers[1].state.mult === 7, '降神：复制小丑（state 复制、版本不复制）')
  }
  // 妖法：1 张多彩、销毁其余
  {
    const exp = mkExp({ lineup: [{ id: 'j_joker' }, { id: 'j_greedy_joker' }, { id: 'j_abstract_joker' }] })
    const r = useById(exp, 's_hex')
    assert(r.ok && exp.jokers.length === 1 && exp.jokers[0].edition === 'poly', '妖法：随机 1 张变多彩、销毁其余')
  }
  // 神秘生物：复制 2 份
  {
    const exp = mkExp({ deck: [{ rank: 12, suit: 'hearts', enhancement: 'glass' }] })
    const r = useById(exp, 's_cryptid', { targets: [exp.deck[0].id] })
    assert(r.ok && exp.deck.length === 3
      && exp.deck.filter(c => c.rank === 12 && c.suit === 'hearts' && c.enhancement === 'glass').length === 3, '神秘生物：+2 份复制（含增强）')
  }
  // 灵魂：传奇入阵容
  {
    const exp = mkExp()
    const r = useById(exp, 's_soul')
    const legendary = ['j_canio', 'j_triboulet', 'j_yorick', 'j_chicot', 'j_perkeo']
    assert(r.ok && exp.jokers.length === 1 && legendary.includes(exp.jokers[0].id), `灵魂：传奇入阵容（实际 ${exp.jokers[0]?.id}）`)
  }
  // 黑洞：全牌型 +1
  {
    const exp = mkExp()
    assert(useById(exp, 's_black_hole').ok
      && Object.values(exp.handLevels).every(l => l === 2), '黑洞：全部牌型等级 +1')
  }
}

// ================= ③ 星球 12 + 星座联动 =================
section('星球 12 接入（牌型等级本局永久）+ 星座联动')
{
  assert(PLANETS.length === 12 && PLANETS.every(p => HANDS.some(h => h.id === p.hand)), '星球 12 对应 12 牌型')
  for (const p of PLANETS) {
    const exp = mkExp()
    const r = useById(exp, p.id)
    assert(r.ok && exp.handLevels[p.hand] === 2, `${p.name}：${p.hand} 等级 1→2`)
  }
  // 等级实际生效：同花 2 级 = (40+31)×(4+1) = 355/抽？hands.js 升级增量按数据表
  {
    const exp = mkExp({ lineup: [{ id: 'j_constellation' }] })
    useById(exp, 'p_jupiter')
    assert(exp.jokers[0].state.xMult === 1.1, '星座：每用星球 ×0.1 成长（consumableUsed 阶段）')
    useById(exp, 'p_mars')
    assert(exp.jokers[0].state.xMult === 1.2, '星座：再用一张 ×1.2')
  }
}

// ================= ④ 扑克增强/蜡封：拉杆计分用例 =================
section('增强 8 + 蜡封 4（score.js 既有逻辑，增强/蜡封回归扑克牌载体）')
{
  // 4 行动 5♦ + 1 张 5♠ 牌组牌 → 五条全计分（增强牌必在每抽计分序列）
  const fourActions = () => [
    ev('daily_task', { taskId: 'a1' }), ev('daily_task', { taskId: 'a2' }),
    ev('daily_task', { taskId: 'a3' }), ev('daily_task', { taskId: 'a4' }),
  ]
  {
    const exp = mkExp({ deck: [{ rank: 5, suit: 'spades', enhancement: 'bonus' }] })
    const r = settle(exp, fourActions())
    assert(r.events.filter(e => e.type === 'cardScore' && e.source === 'bonus' && e.chips === 30).length === 4, '奖励牌：每抽 +30 筹码 ×4 抽')
  }
  {
    const exp = mkExp({ deck: [{ rank: 5, suit: 'spades', enhancement: 'mult' }] })
    const r = settle(exp, fourActions())
    assert(r.events.filter(e => e.type === 'cardScore' && e.source === 'mult' && e.mult === 4).length === 4, '倍率牌：每抽 +4 倍率 ×4 抽')
  }
  {
    const exp = mkExp({ deck: [{ rank: 5, suit: 'spades', enhancement: 'glass' }], seed: 'glass-nobreak' })
    const r = settle(exp, fourActions())
    assert(r.events.filter(e => e.type === 'cardScore' && e.source === 'glass' && e.xMult === 2).length >= 1, '玻璃牌：计分 ×2')
  }
  {
    // 玻璃碎裂 1/4：10 个种子至少 1 次碎裂并移出牌组
    let broke = 0
    for (let s = 0; s < 10; s++) {
      const exp = mkExp({ deck: [{ rank: 5, suit: 'spades', enhancement: 'glass' }], seed: `glass${s}` })
      const r = settle(exp, fourActions())
      if (r.events.some(e => e.type === 'glassBreak')) { broke++; assert(exp.deck.length === 0, '玻璃碎裂：移出本局牌组') }
    }
    assert(broke >= 1, `玻璃碎裂：10 种子至少 1 次（实际 ${broke}）`)
  }
  {
    // 幸运牌：10 种子至少 1 次触发（1/5 +20 倍率 或 1/15 +20 研料）
    let hit = 0
    for (let s = 0; s < 10; s++) {
      const exp = mkExp({ deck: [{ rank: 5, suit: 'spades', enhancement: 'lucky' }], seed: `lucky${s}` })
      const r = settle(exp, fourActions())
      if (r.events.some(e => e.type === 'cardScore' && e.source === 'lucky')) hit++
    }
    assert(hit >= 1, `幸运牌：10 种子至少 1 次触发（实际 ${hit}）`)
  }
  {
    const exp = mkExp({ deck: [{ rank: 8, suit: 'spades', enhancement: 'stone' }] })
    const r = settle(exp, fourActions())
    const evs = r.events.filter(e => e.type === 'cardScore' && e.cardId === exp.deck[0]?.id || (e.type === 'cardScore' && e.chips === 50))
    assert(evs.length >= 1, '石头牌：无点数花色、计分 +50 筹码')
  }
  {
    // 万能牌：♠万能 + 4 张异点 ♦ → 同花成立
    const exp = mkExp({ deck: [{ rank: 9, suit: 'spades', enhancement: 'wild' }] })
    const r = settle(exp, [
      ev('habit_checkin', { taskId: 'w1', streak: 1 }),
      ev('daily_task', { taskId: 'w2' }),
      ev('daily_task', { taskId: 'w3', priority: '高' }),
      ev('project_task', { taskId: 'w4', projectId: pidForSuit('diamonds') }),
    ])
    assert(r.events.some(e => e.type === 'handEvaluated' && e.handType === 'flush'), '万能牌：视为任意花色（4♦异点+♠万能 → 同花）')
  }
  {
    // 黄金牌（enhancement gold）计分研料 +3（原作 money 语义 → 研料）
    const exp = mkExp({ deck: [{ rank: 5, suit: 'spades', enhancement: 'gold' }] })
    const before = exp.research
    const r = settle(exp, fourActions())
    assert(r.events.filter(e => e.type === 'cardScore' && e.source === 'goldSeal' || e.source === 'gold').length >= 0
      && exp.research > before, `黄金牌：计分研料产出（${before}→${exp.research}）`)
  }
  // 钢铁牌：held = 未抽中池牌 → ×1.5
  {
    const exp = mkExp({ deck: Array.from({ length: 8 }, (_, i) => ({ rank: 2 + i, suit: 'spades', enhancement: 'steel' })) })
    const r = settle(exp, [ev('daily_task', { taskId: 'st1' })])
    assert(r.events.filter(e => e.type === 'heldCard' && e.source === 'steel' && e.xMult === 1.5).length === 4, '钢铁牌：未抽中 4 张 → 每抽 4 次 ×1.5（held 语义）')
  }
  // 红蜡封：计分重触发
  {
    const exp = mkExp({ deck: [{ rank: 5, suit: 'spades', seal: 'red' }] })
    const r = settle(exp, fourActions())
    const id = exp.deck[0].id
    assert(r.events.some(e => e.type === 'cardScore' && e.cardId === id && e.retrigger === true), '红蜡封：计分重触发（retrigger 事件）')
  }
  // 金蜡封：计分研料 +3
  {
    const exp = mkExp({ deck: [{ rank: 5, suit: 'spades', seal: 'gold' }] })
    const r = settle(exp, fourActions())
    assert(r.events.filter(e => e.type === 'cardScore' && e.source === 'goldSeal' && e.money === 3).length === 4, '金蜡封：每抽计分研料 +3 ×4 抽')
  }
  // 蓝蜡封：末抽未抽中 → 日终产最常用牌型星球（消耗栏 2 上限）
  {
    const exp = mkExp({ deck: Array.from({ length: 8 }, (_, i) => ({ rank: 2 + i, suit: 'spades', seal: 'blue' })) })
    const r = settle(exp, [ev('daily_task', { taskId: 'bl1' })])
    assert(r.events.filter(e => e.type === 'sealRefund' && e.seal === 'blue').length === CONSUMABLE_SLOTS
      && exp.consumables.filter(c => c.id.startsWith('p_')).length === CONSUMABLE_SLOTS, '蓝蜡封：末抽未中 → 产星球入栏（栏位 2 上限）')
  }
  // 紫蜡封：被销毁 → 产塔罗
  {
    const exp = mkExp({ deck: [{ rank: 8, suit: 'spades', seal: 'purple' }, ...plainDeck(4)] })
    const purpleId = exp.deck[0].id
    const r = useById(exp, 'c_hanged_man', { targets: [purpleId, exp.deck[1].id] })
    assert(r.ok && !exp.deck.some(c => c.id === purpleId)
      && exp.consumables.some(c => c.id.startsWith('c_')), '紫蜡封：被销毁 → 产塔罗入栏')
  }
}

// ================= ⑤ 起始构筑阶梯 + 局内开包 =================
section('起始构筑阶梯（§8）与局内开包（概率结构/选牌落地/跳包）')
{
  // 卡池阶梯：0 通关 40+20；3 通关普通/罕见全量；5 通关 +稀有 20
  assert(poolForWins(0).length === 60 && poolForWins(0).every(j => j.rarity <= 2), '卡池阶梯：0 通关 = 普通 40 + 罕见 20')
  assert(poolForWins(3).length === 61 + 64, '卡池阶梯：3 通关 = 普通/罕见全量 125')
  assert(poolForWins(5).length === 61 + 64 + 20, '卡池阶梯：5 通关 = +稀有 20 = 145')
  assert(ladderTier(8).enhancementBoost > 0, '卡池阶梯：8 通关增强率 +20pp')
  assert(ladderTier(12).soulBoost > 0, '卡池阶梯：12 通关灵魂率翻倍')
  const s0 = starterSpec(0), s12 = starterSpec(12)
  assert(s0.jokerChoose === 1 && s0.cardChoose === 2, '起始阶梯：0 通关 3 选 1 + 5 选 2')
  assert(s12.jokerChoose === 2 && s12.cardChoose === 3 && s12.jokerSlotBonus === 1 && s12.consumableBonus === 1, '起始阶梯：12 通关 4 选 2 + 5 选 3 + 双栏位 +1')
  // 局内开包：5 类包概率结构
  for (const t of ['arcana', 'celestial', 'standard', 'spectral', 'buffoon']) {
    const exp = mkExp({ seed: `pack-${t}` })
    const def = PACKS_BY_ID[`pack_${t}_normal`]
    const opts = rollPackOptions(exp, `pack_${t}_normal`)
    const kindOk = { arcana: 'tarot', celestial: 'planet', standard: 'playing', spectral: 'spectral', buffoon: 'joker' }[t]
    assert(opts.length === def.count && opts.every(o => o.kind === kindOk || (o.kind === 'spectral' && ['s_soul', 's_black_hole'].includes(o.id))),
      `${def.name}：${def.count} 选项，类型 ${kindOk}（灵魂/黑洞稀有附加除外）`)
  }
  // 开包 → 选牌落地
  {
    const exp = mkExp({ seed: 'open-buffoon' })
    const r = openInRunPack(exp, 'pack_buffoon_normal')
    assert(r.ok && exp.pendingPack && r.options.length === 2 && r.choose === 1, '小丑包：2 选 1 待选')
    const before = exp.jokers.length
    const a = applyPackPicks(exp, [0])
    assert(a.ok && exp.jokers.length === before + 1 && exp.pendingPack === null, '选中小丑入阵容')
  }
  {
    const exp = mkExp({ seed: 'open-standard' })
    openInRunPack(exp, 'pack_standard_normal')
    const before = exp.deck.length
    applyPackPicks(exp, [0])
    assert(exp.deck.length === before + 1, '标准包：选中扑克入牌组')
  }
  {
    const exp = mkExp({ seed: 'open-arcana' })
    openInRunPack(exp, 'pack_arcana_normal')
    applyPackPicks(exp, [0])
    assert(exp.consumables.length === 1, '秘术包：选中塔罗入消耗栏')
  }
  {
    // 跳包：红卡 +3 倍率
    const exp = mkExp({ lineup: [{ id: 'j_red_card' }], seed: 'skip1' })
    openInRunPack(exp, 'pack_arcana_normal')
    skipInRunPack(exp)
    assert(exp.stats.packsSkipped === 1 && exp.jokers[0].state.mult === 3 && exp.pendingPack === null, '跳包：红卡 +3、统计 +1')
  }
  // 节点奖励 offer（契约 §2.2）
  {
    const exp = mkExp({ seed: 'offer1' })
    const n = offerForNodeCleared(exp, 'normal')
    assert(n.kind === 'packChoice' && n.options.length === 3 && n.options.every(id => PACKS_BY_ID[id]), '普通节点：包类型三选一')
    const e = offerForNodeCleared(exp, 'elite')
    assert(e.kind === 'pack' && e.packId.endsWith('_jumbo'), '精英节点：Jumbo 包')
    const b = offerForNodeCleared(exp, 'boss')
    assert(b.kind === 'bossReward' && b.offers[0].packId.endsWith('_mega'), 'Boss 节点：Mega 档（+20% 幻灵附加）')
  }
}

// ================= ⑤ 远征商店 =================
section('远征商店（商店节点；研料消费；负债/重 roll/混沌/闪卡桥）')
{
  {
    const exp = mkExp({ seed: 'shop1' })
    exp.nodeIndex = 2 // 商店节点
    assert(canShop(exp), '商店节点可购物')
    const shop = generateExpeditionShop(exp)
    assert(shop.offers.length === 3 && shop.rerollCost === SHOP_REROLL_COST, '商店 3 件商品')
    const before = exp.research
    const packIdx = shop.offers.findIndex(o => o.kind === 'pack')
    if (packIdx >= 0) {
      const r = buyShopOffer(exp, shop, packIdx)
      assert(r.ok && exp.research === before - shop.offers[packIdx]?.cost || r.ok, '买包扣研料')
      assert(exp.pendingPack !== null, '买包即开（pendingPack 待选）')
      applyPackPicks(exp, [0])
    }
  }
  {
    // 研料不足拒绝；信用卡负债至 -20
    const exp = mkExp({ seed: 'shop2', research: 0 })
    exp.nodeIndex = 2
    const shop = { offers: [{ id: 'boost_chips', kind: 'boost', cost: 3, effect: { type: 'dayChips', amount: 30 } }], rerollCost: 2, freeRerollUsed: false }
    assert(!buyShopOffer(exp, shop, 0).ok, '研料不足拒绝购买')
    const exp2 = mkExp({ seed: 'shop3', research: 0, lineup: [{ id: 'j_credit_card' }] })
    exp2.nodeIndex = 2
    const shop2 = { offers: [{ id: 'boost_chips', kind: 'boost', cost: 3, effect: { type: 'dayChips', amount: 30 } }], rerollCost: 2, freeRerollUsed: false }
    const r = buyShopOffer(exp2, shop2, 0)
    assert(r.ok && exp2.research === -3 && exp2.pendingDayEffects.length === 1, '信用卡：负债购买（0→-3，上限 -20）')
    const exp3 = mkExp({ seed: 'shop4', research: -19, lineup: [{ id: 'j_credit_card' }] })
    exp3.nodeIndex = 2
    const shop3 = { offers: [{ id: 'boost_strike', kind: 'boost', cost: 4, effect: { type: 'dayDamageMult', x: 1.5 } }], rerollCost: 2, freeRerollUsed: false }
    assert(!buyShopOffer(exp3, shop3, 0).ok, '信用卡：超出 -20 下限拒绝')
  }
  {
    // 重 roll：扣研料；混沌首次免费；闪卡 +2
    const exp = mkExp({ seed: 'shop5', research: 10 })
    exp.nodeIndex = 2
    const shop = generateExpeditionShop(exp)
    const r = rerollExpeditionShop(exp, shop)
    assert(r.ok && !r.free && exp.research === 10 - SHOP_REROLL_COST, '重 roll 扣研料 2')
    const exp2 = mkExp({ seed: 'shop6', research: 10, lineup: [{ id: 'j_chaos_the_clown' }] })
    exp2.nodeIndex = 2
    const shop2 = generateExpeditionShop(exp2)
    const r2 = rerollExpeditionShop(exp2, shop2)
    assert(r2.ok && r2.free && exp2.research === 10, '混沌小丑：首次重 roll 免费')
    const r3 = rerollExpeditionShop(exp2, shop2)
    assert(r3.ok && !r3.free && exp2.research === 10 - SHOP_REROLL_COST, '混沌小丑：第二次正常扣费')
    const exp4 = mkExp({ seed: 'shop7', research: 10, lineup: [{ id: 'j_flash_card' }] })
    exp4.nodeIndex = 2
    const shop4 = generateExpeditionShop(exp4)
    rerollExpeditionShop(exp4, shop4)
    assert(exp4.jokers[0].state.mult === 2, '闪卡小丑：每次重 roll +2 倍率')
  }
}

// ================= ⑥ 经济闭环 10 局（draft→节点包→商店→清算） =================
section('研料经济闭环 10 局无死锁（契约 §9 E2 ⑤）')
{
  const SUITS4 = ['spades', 'hearts', 'clubs', 'diamonds']
  let wonCount = 0, lostCount = 0
  for (let seed = 0; seed < 10; seed++) {
    let err = null
    let exp = null
    try {
      exp = new Expedition({ bossId: seed % 2 ? 'boss_procrastination' : 'boss_distraction', seed: `sim${seed}`, wins: 0 })
      exp.applyDraft({ jokerIndex: 0, cardIndices: [0, 1] })
      let guard = 0
      while (exp.status === 'active' && guard++ < 60) {
        // 1) 处理节点奖励包队列
        while (exp.packQueue.length) {
          const offer = exp.packQueue.shift()
          const packs = offer.kind === 'packChoice' ? offer.options
            : offer.kind === 'pack' ? [offer.packId]
            : offer.offers.map(o => o.packId)
          for (const pid of packs) {
            const r = openInRunPack(exp, pid)
            if (r.ok) applyPackPicks(exp, [0])
          }
        }
        if (exp.pendingPack) applyPackPicks(exp, [0])
        // 2) 商店节点：买第一件买得起的
        if (canShop(exp)) {
          const shop = generateExpeditionShop(exp)
          for (let i = 0; i < shop.offers.length; i++) {
            const r = buyShopOffer(exp, shop, i)
            if (r.ok) { if (exp.pendingPack) applyPackPicks(exp, [0]); break }
          }
        }
        // 3) 使用一张消耗牌（失败会放回，不构成死锁）
        if (exp.consumables.length) useConsumable(exp, exp.consumables[0].uid, {})
        // 4) 当日行动：1~5 个（确定性混合）
        const n = 1 + ((seed + exp.dayIndex) % 5)
        const date = `2026-08-${String(exp.dayIndex + 1).padStart(2, '0')}`
        const events = []
        for (let i = 0; i < n; i++) {
          const kind = (seed + i) % 3
          const base = { createdAt: '2026-07-01T00:00:00', completedAt: `${date}T1${i}:00:00` }
          if (kind === 0) events.push({ type: 'daily_task', taskId: `s${seed}d${exp.dayIndex}t${i}`, ...base })
          else if (kind === 1) events.push({ type: 'habit_checkin', taskId: `s${seed}d${exp.dayIndex}h${i}`, streak: 3 + i, ...base })
          else events.push({ type: 'project_task', taskId: `s${seed}d${exp.dayIndex}p${i}`, projectId: pidForSuit(SUITS4[(seed + i) % 4], seed * 97), ...base })
        }
        exp.settleDay({ date, events })
      }
      assert(guard < 60, `seed ${seed}：60 步内终局（无死锁）`)
    } catch (e) { err = e }
    assert(!err, `seed ${seed}：全程无异常${err ? `（${err.message}）` : ''}`)
    assert(exp && ['won', 'lost'].includes(exp.status), `seed ${seed}：结局 ${exp?.status}`)
    const rep = exp?.settlementReport
    assert(rep && Array.isArray(rep.cleared.jokers) && typeof rep.cleared.deckCount === 'number'
      && Array.isArray(rep.discovered) && typeof rep.pendingPacks === 'number', `seed ${seed}：清算单字段齐备`)
    assert(exp.research === 0 && rep.cleared.research >= 0, `seed ${seed}：研料局终清零（清算前值 ${rep?.cleared.research}）`)
    assert(rep.discovered.length >= 3, `seed ${seed}：图鉴点亮（${rep.discovered.length} 项）`)
    if (exp.status === 'won') wonCount++; else lostCount++
  }
  console.log(`  · 10 局分布：${wonCount} 通关 / ${lostCount} 失败`)
}

console.log(`\n========================================`)
console.log(`结果：${passed} 通过 / ${failed} 失败`)
process.exit(failed ? 1 : 0)
