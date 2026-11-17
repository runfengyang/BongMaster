// 远征引擎 Phase E1 验收测试（契约 §9 Phase E1，§16 老虎机模型修订）
// node scripts/expedition-engine-test.mjs
// 覆盖：行动牌生成（含防刷三规则）、起始构筑 draft、拉杆抽取（无放回/重洗补足）、
//       每抽独立计分与事件流、同花/顺子/对子日牌型、成长型小丑逐抽成长与跨日持久、
//       蓝图复制、两个 Boss 每抽规则修正、压力累计、通关/失败/放弃三分支、
//       局终清算单（§2.4）、研料来源（未用拉杆/节点奖励）、版本栏位、序列化往返
// §16 修订说明：E1 旧「日牌型」断言已按拉杆模型改写（日伤害 = Σ 每抽）；
//       旧「耐久扣减」断言已按 §2.4 改写为局终清算断言（跨局耐久模型废弃）。

import { Expedition } from '../engine/expedition/stateMachine.js'
import {
  buildActionCards, rankForEvent, projectSuit, dayStartMs,
} from '../engine/expedition/actionCards.js'
import { drawPull } from '../engine/expedition/dayScore.js'
import { jokerSlotCountOf, addJokerToExp } from '../engine/expedition/adapter.js'
import {
  DAYS_PER_RUN, MAX_PRESSURE, MAX_PULLS_PER_DAY, STARTING_RESEARCH,
  NODE_HP, NODE_MIN_DAMAGE, NODE_RESEARCH, LINEUP_SIZE,
} from '../engine/expedition/balance.js'
import { EXPEDITION_BOSSES, EXPEDITION_THEMES } from '../data/expedition/bosses.js'
import { evaluate } from '../../../engine/evaluate.js'
import { makeCard } from '../../../engine/deck.js'
import { Rng } from '../../../engine/rng.js'

let passed = 0, failed = 0
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`) }
  else { failed++; console.error(`  ✗ FAIL: ${msg}`) }
}
function section(name) { console.log(`\n== ${name} ==`) }

const DAY = '2026-07-01'
const CALM = { id: 'calm', name: '平静日' }
const ev = (type, extra = {}) => ({
  type, taskId: extra.taskId ?? `${type}_${Math.random()}`,
  createdAt: '2026-06-01T10:00:00', // 默认当日 00:00 前已存在 → 全额 rank
  completedAt: `${DAY}T12:00:00`,
  ...extra,
})
// 按期望花色找一个 projectId（projectSuit 是确定性哈希，测试内动态搜索）
function pidForSuit(suit, start = 0) {
  for (let i = start; i < 10000; i++) if (projectSuit(`P${i}`) === suit) return `P${i}`
  throw new Error('no pid for suit ' + suit)
}
// 测试直装：跳过 draft（lineup/deck 默认空，池 = 行动牌，断言可手算）
const mkExp = (overrides = {}) => new Expedition({
  bossId: 'boss_distraction', seed: 'test', lineup: [], deck: [], ...overrides,
})
const settle = (exp, events, opts = {}) =>
  exp.settleDay({ date: opts.date || DAY, events, intent: opts.intent === undefined ? CALM : opts.intent })

// ================= 行动牌生成：rank 表 =================
section('行动牌生成 · rank 表（契约 §5.1）')
{
  const ds = dayStartMs(DAY)
  assert(rankForEvent(ev('habit_checkin', { streak: 3 }), ds) === 4, '习惯打卡 streak<7 → rank 4')
  assert(rankForEvent(ev('habit_checkin', { streak: 7 }), ds) === 6, '习惯打卡 streak≥7 → rank 6')
  assert(rankForEvent(ev('daily_task', { priority: '中' }), ds) === 5, '每日任务 → rank 5')
  assert(rankForEvent(ev('daily_task', { priority: '高' }), ds) === 7, '高优先级每日任务 → rank 7')
  assert(rankForEvent(ev('project_task', { priority: '中', projectId: 'PX' }), ds) === 8, '项目任务 → rank 8')
  assert(rankForEvent(ev('project_task', { priority: '高', projectId: 'PX' }), ds) === 10, '高优先级项目任务 → rank 10')
  assert(rankForEvent(ev('day_cleared'), ds) === 12, '清空当日全部每日任务 → Q(12)')
  assert(rankForEvent(ev('project_milestone'), ds) === 14, '项目完成/里程碑 → A(14)')
}

// ================= 行动牌生成：suit 规则 =================
section('行动牌生成 · suit 规则')
{
  assert(['spades', 'hearts', 'diamonds', 'clubs'].includes(projectSuit('P1')), 'project_id 哈希 → 四花色之一')
  assert(projectSuit('P1') === projectSuit('P1'), '同 project_id 花色确定')
  assert(projectSuit(null) === 'diamonds' && projectSuit('') === 'diamonds', '无项目行动固定 ♦')
  const { cards } = buildActionCards([ev('daily_task'), ev('habit_checkin', { taskId: 'h1' })], { date: DAY })
  assert(cards.every(c => c.suit === 'diamonds'), '打卡/日常任务行动牌均为 ♦')
}

// ================= 防刷三规则 =================
section('防刷三规则（红线 §10.4）')
{
  const ds = dayStartMs(DAY)
  const createdToday = `${DAY}T09:00:00`
  assert(rankForEvent(ev('project_task', { projectId: 'PX', priority: '中', createdAt: createdToday }), ds) === 4, '当日新建项目任务：8 → 4')
  assert(rankForEvent(ev('daily_task', { priority: '高', createdAt: createdToday }), ds) === 3, '当日新建高优日常：7 → 3')
  assert(rankForEvent(ev('daily_task', { priority: '中', createdAt: createdToday }), ds) === 2, '当日新建日常：5 → 2（最低 2）')
  assert(rankForEvent(ev('project_task', { projectId: 'PX', createdAt: '2026-06-30T23:59:00' }), ds) === 8, '前一日已存在 → 全额 8')
  const { cards: dedup } = buildActionCards([
    ev('daily_task', { taskId: 'T1', completedAt: `${DAY}T10:00:00` }),
    ev('daily_task', { taskId: 'T1', completedAt: `${DAY}T20:00:00` }),
  ], { date: DAY })
  assert(dedup.length === 1 && dedup[0].completedAt === new Date(`${DAY}T10:00:00`).getTime(), '同任务重复完成只计首次')
  const many = Array.from({ length: 7 }, (_, i) => ev('daily_task', { taskId: `M${i}`, completedAt: `${DAY}T1${i}:00:00` }))
  const { cards, scoringCards } = buildActionCards(many, { date: DAY })
  assert(cards.length === 7 && scoringCards.length === MAX_PULLS_PER_DAY, `7 事件 → 7 记录 / ${MAX_PULLS_PER_DAY} 计分=拉杆（实际 ${cards.length}/${scoringCards.length}）`)
  assert(cards.filter(c => !c.scores).every(c => c.source === 'daily_task'), '溢出牌保留 source 记录')
}

// ================= 起始构筑 draft（契约 §2.1） =================
section('起始构筑 draft（1 小丑包 3 选 1 + 1 标准包 5 选 2）')
{
  const exp = new Expedition({ bossId: 'boss_distraction', seed: 'draft1' })
  assert(exp.draft && exp.draft.jokerOptions.length === 3 && exp.draft.cardOptions.length === 5, 'draft = 3 小丑选项 + 5 扑克选项')
  assert(exp.draft.jokerChoose === 1 && exp.draft.cardChoose === 2, '选择数 1 + 2')
  assert(exp.jokers.length === 0 && exp.deck.length === 0, '未选前阵容/牌组为空')
  const r = exp.applyDraft({ jokerIndex: 1, cardIndices: [2, 4] })
  assert(r.ok && exp.jokers[0]?.id === exp.draft.jokerOptions[1].id, `选中小丑入阵容（${r.joker}）`)
  assert(exp.deck.length === 2 && exp.deck[0].id === exp.draft.cardOptions[2].card.id
    && exp.deck[1].id === exp.draft.cardOptions[4].card.id && exp.deckStart === 2, '选中 2 张入牌组，deckStart=2')
  assert(exp.seen[exp.draft.jokerOptions[0].id] && exp.seen.playing_card, 'draft 选项已点亮图鉴（见过即发现）')
  assert(exp.applyDraft().ok === false, 'draft 只能选一次')
  // 阶梯：12 通关 → Mega 规格 + 栏位奖励
  const vet = new Expedition({ bossId: 'boss_distraction', seed: 'draft2', wins: 12 })
  assert(vet.draft.jokerChoose === 2 && vet.draft.cardChoose === 3 && vet.jokerSlotBonus === 1 && vet.consumableSlotBonus === 1,
    '起始构筑阶梯：12 通关 → 4 选 2 + 5 选 3 + 双栏位 +1')
}

// ================= 拉杆抽取（无放回 / 池不足重洗补足） =================
section('拉杆抽取（契约 §5.3 + 红线 §10.7 可播种 RNG）')
{
  const pool = Array.from({ length: 7 }, (_, i) => makeCard(i + 2, 'diamonds'))
  const rng = new Rng('pull1')
  const { drawn, left } = drawPull(pool, 5, rng)
  assert(drawn.length === 5 && new Set(drawn.map(c => c.id)).size === 5, '池 7 抽 5：无放回，5 张互异')
  assert(left.length === 2 && left.every(c => !drawn.includes(c)), '未抽中 2 张 = held（钢铁/男爵语义）')
  const rng2 = new Rng('pull1')
  const again = drawPull(pool, 5, rng2)
  assert(again.drawn.every((c, i) => c.id === drawn[i].id), '同种子同序（可复现）')
  // 池不足 5：重洗补足（同卡可重复计入本抽）
  const small = [makeCard(5, 'diamonds'), makeCard(8, 'spades'), makeCard(4, 'clubs')]
  const rng3 = new Rng('pull2')
  const fill = drawPull(small, 5, rng3)
  assert(fill.drawn.length === 5, '池 3 抽 5：重洗补足到 5 张')
  assert(small.every(c => fill.drawn.some(d => d.id === c.id)), '补足后池内牌均被抽中（held 为空）')
}

// ================= 牌型判定日（拉杆制；池 = 行动牌，逐抽同构） =================
section('同花日 / 顺子日 / 对子日牌型判定（每次拉杆）')
{
  // 同花日：同项目 5 任务（10,10,8,4,4 同花色）→ 每抽 flush，分心之墙单花色不罚
  const p = pidForSuit('spades')
  const flushExp = mkExp()
  const r1 = settle(flushExp, [
    ev('project_task', { taskId: 'f1', projectId: p, priority: '高', completedAt: `${DAY}T10:00:00` }),
    ev('project_task', { taskId: 'f2', projectId: p, priority: '高', completedAt: `${DAY}T11:00:00` }),
    ev('project_task', { taskId: 'f3', projectId: p, completedAt: `${DAY}T12:00:00` }),
    ev('project_task', { taskId: 'f4', projectId: p, createdAt: `${DAY}T09:00:00`, completedAt: `${DAY}T13:00:00` }),
    ev('project_task', { taskId: 'f5', projectId: p, createdAt: `${DAY}T09:30:00`, completedAt: `${DAY}T14:00:00` }),
  ])
  const pullTotals = r1.events.filter(e => e.type === 'pullTotal').map(e => e.total)
  assert(r1.pulls === 5 && pullTotals.length === 5, `5 行动 → 5 次拉杆（实际 ${r1.pulls}）`)
  assert(pullTotals.every(t => t === (35 + 10 + 10 + 8 + 4 + 4) * 4), `每抽 flush 284（实际 ${pullTotals}）`)
  assert(r1.total === 284 * 5, `当日伤害 = Σ 每抽 = 1420（实际 ${r1.total}）`)
  assert(evaluate(r1.scoringCards).handType === 'flush', 'evaluate 复用验证（flush）')
  assert(r1.events.filter(e => e.type === 'pullStart').length === 5, '事件流含 5 个 pullStart（演出单位）')

  // 顺子日：4♦ 5♦ 6♦ 7♦ 8♠ → 每抽 straight（拖延之墙无重复点数不衰减）
  const straightExp = mkExp({ bossId: 'boss_procrastination' })
  const r2 = settle(straightExp, [
    ev('habit_checkin', { taskId: 's1', streak: 2, completedAt: `${DAY}T08:00:00` }),
    ev('daily_task', { taskId: 's2', completedAt: `${DAY}T10:00:00` }),
    ev('habit_checkin', { taskId: 's3', streak: 9, completedAt: `${DAY}T09:00:00` }),
    ev('daily_task', { taskId: 's4', priority: '高', completedAt: `${DAY}T11:00:00` }),
    ev('project_task', { taskId: 's5', projectId: pidForSuit('spades'), completedAt: `${DAY}T12:00:00` }),
  ])
  const pt2 = r2.events.filter(e => e.type === 'pullTotal').map(e => e.total)
  assert(pt2.every(t => t === (30 + 4 + 5 + 6 + 7 + 8) * 4) && r2.total === 240 * 5,
    `每抽 straight 240，日计 1200（实际 ${pt2[0]}/${r2.total}）`)

  // 对子日：5♦ 5♦ 8♠ 7♦ 4♦ → 每抽 pair（分心 2 花色 ×0.85：20×1.7=34）
  const pairExp = mkExp()
  const r3 = settle(pairExp, [
    ev('daily_task', { taskId: 'p1', completedAt: `${DAY}T10:00:00` }),
    ev('daily_task', { taskId: 'p2', completedAt: `${DAY}T11:00:00` }),
    ev('project_task', { taskId: 'p3', projectId: pidForSuit('spades'), completedAt: `${DAY}T12:00:00` }),
    ev('daily_task', { taskId: 'p4', priority: '高', completedAt: `${DAY}T13:00:00` }),
    ev('habit_checkin', { taskId: 'p5', streak: 1, completedAt: `${DAY}T08:00:00` }),
  ])
  const pt3 = r3.events.filter(e => e.type === 'pullTotal').map(e => e.total)
  assert(pt3.every(t => t === 34) && r3.total === 170, `每抽 pair 20×1.7=34，日计 170（实际 ${pt3[0]}/${r3.total}）`)
  assert(r3.events.some(e => e.type === 'bossRule' && e.rule === 'suit_diversity_penalty' && e.suits === 2), '分心之墙按抽判定（2 花色）')
}

// ================= 成长型小丑：逐抽成长 + 跨日持久 =================
section('成长型小丑逐抽成长与跨日持久（绿色小丑）')
{
  // 高牌日（4♦ 5♠ 7♥ 8♣ 10♦）：高牌 chips 15；绿色逐抽 +1 倍率
  const dayEvents = (pfx, date) => [
    ev('habit_checkin', { taskId: `${pfx}1`, streak: 1, completedAt: `${date}T08:00:00` }),
    ev('daily_task', { taskId: `${pfx}2`, completedAt: `${date}T09:00:00` }),
    ev('daily_task', { taskId: `${pfx}3`, priority: '高', completedAt: `${date}T10:00:00` }),
    ev('project_task', { taskId: `${pfx}4`, projectId: pidForSuit('spades'), completedAt: `${date}T11:00:00` }),
    ev('project_task', { taskId: `${pfx}5`, projectId: pidForSuit('hearts'), priority: '高', completedAt: `${date}T12:00:00` }),
  ]
  const exp = mkExp({ bossId: 'boss_procrastination', lineup: [{ id: 'j_green_joker' }] })
  const d1 = settle(exp, dayEvents('g', DAY))
  // 每抽：handPlayed +1 → jokerScore +state；第1抽 mult 1+1=2 → 15×2=30 … 第5抽 15×6=90
  const pt = d1.events.filter(e => e.type === 'pullTotal').map(e => e.total)
  assert(pt.join(',') === '30,45,60,75,90', `第 1 日逐抽 30/45/60/75/90（实际 ${pt}）`)
  assert(exp.jokers[0].state.mult === 5, `第 1 日 5 抽后 mult=5（实际 ${exp.jokers[0].state.mult}）`)
  const d2 = settle(exp, dayEvents('h', '2026-07-05'), { date: '2026-07-05' }) // 日历日跳跃不影响
  const pt2 = d2.events.filter(e => e.type === 'pullTotal').map(e => e.total)
  assert(pt2.join(',') === '105,120,135,150,165', `第 2 日逐抽 105…165（state 跨日持久，实际 ${pt2}）`)
  assert(exp.jokers[0].state.mult === 10, `10 抽后 mult=10（实际 ${exp.jokers[0].state.mult}）`)
}

// ================= 蓝图复制相邻 =================
section('蓝图复制相邻小丑')
{
  const exp = mkExp({ bossId: 'boss_procrastination', lineup: [{ id: 'j_blueprint' }, { id: 'j_joker' }] })
  const r = settle(exp, [ev('daily_task', { taskId: 'b1' }), ev('daily_task', { taskId: 'b2' }), ev('daily_task', { taskId: 'b3' }), ev('habit_checkin', { taskId: 'b4', streak: 1 }), ev('daily_task', { taskId: 'b5', priority: '高' })])
  // 5♦ 5♦ 5♦ 4♦ 7♦ → 同花（全 ♦）；拖延 repeat_rank_decay：两张 5 减半 → chips 35+(5+7+2+4+2)=55；mult 4+4+4=12 → 660/抽
  const pt = r.events.filter(e => e.type === 'pullTotal').map(e => e.total)
  assert(pt.every(t => t === 660), `蓝图复制右侧小丑：每抽 55×12=660（实际 ${pt[0]}）`)
  assert(r.events.some(e => e.type === 'jokerTrigger' && e.copiedById === 'j_blueprint'), '复制事件标记来源蓝图')
}

// ================= Boss 规则修正（按每次拉杆） =================
section('Boss 规则修正（契约 §4.2，每抽判定）')
{
  // 分心之墙：3 种花色 → 该抽最终倍率 ×0.85²
  const exp = mkExp()
  const r = settle(exp, [
    ev('project_task', { taskId: 'w1', projectId: pidForSuit('spades'), completedAt: `${DAY}T10:00:00` }),
    ev('project_task', { taskId: 'w2', projectId: pidForSuit('hearts'), completedAt: `${DAY}T11:00:00` }),
    ev('project_task', { taskId: 'w3', projectId: pidForSuit('clubs'), completedAt: `${DAY}T12:00:00` }),
    ev('daily_task', { taskId: 'w4', completedAt: `${DAY}T13:00:00` }),
    ev('habit_checkin', { taskId: 'w5', streak: 1, completedAt: `${DAY}T09:00:00` }),
  ])
  // 8♠ 8♥ 8♣ 5♦ 4♦ → 三条 54 筹码；花色 ♠♥♣♦ = 4 → ×0.85³ → 54×1.84=99.36→99
  const pt = r.events.filter(e => e.type === 'pullTotal').map(e => e.total)
  assert(pt.every(t => t === 99), `4 花色：每抽 54×0.85³≈99（实际 ${pt[0]}）`)
  assert(r.events.filter(e => e.type === 'bossRule' && e.rule === 'suit_diversity_penalty').length === 5, '每抽各记 1 条规则事件')

  // 拖延之墙：重复点数第 2 张起筹码减半（每抽判定）
  const exp2 = mkExp({ bossId: 'boss_procrastination' })
  const p = pidForSuit('hearts')
  const r2 = settle(exp2, [
    ev('project_task', { taskId: 'q1', projectId: p, completedAt: `${DAY}T10:00:00` }),
    ev('project_task', { taskId: 'q2', projectId: p, completedAt: `${DAY}T11:00:00` }),
    ev('daily_task', { taskId: 'q3', completedAt: `${DAY}T12:00:00` }),
    ev('daily_task', { taskId: 'q4', priority: '高', completedAt: `${DAY}T13:00:00` }),
    ev('habit_checkin', { taskId: 'q5', streak: 1, completedAt: `${DAY}T09:00:00` }),
  ])
  // 8♥ 8♥ 5♦ 7♦ 4♦ → 对子；第 2 张 8 → 4：(10+8+4)×2=44/抽
  const pt2 = r2.events.filter(e => e.type === 'pullTotal').map(e => e.total)
  assert(pt2.every(t => t === 44), `重复 8 点减半：每抽 44（实际 ${pt2[0]}）`)
  assert(r2.events.some(e => e.type === 'bossRule' && e.rule === 'repeat_rank_decay' && e.chipsTo === 4), '减半事件记录')

  // 意图：花色削弱（♥ 不计入；拖延之墙无花色罚）
  const exp3 = mkExp({ bossId: 'boss_procrastination' })
  const r3 = settle(exp3, [
    ev('project_task', { taskId: 'e1', projectId: pidForSuit('hearts'), completedAt: `${DAY}T10:00:00` }),
    ev('project_task', { taskId: 'e2', projectId: pidForSuit('hearts'), completedAt: `${DAY}T11:00:00` }),
    ev('daily_task', { taskId: 'e3', completedAt: `${DAY}T12:00:00` }),
    ev('daily_task', { taskId: 'e4', priority: '高', completedAt: `${DAY}T13:00:00` }),
    ev('habit_checkin', { taskId: 'e5', streak: 1, completedAt: `${DAY}T09:00:00` }),
  ], { intent: { id: 'suit_weaken', name: '花色削弱', suit: 'hearts' } })
  // ♥ 移除后 5♦ 7♦ 4♦ → 3 张，无对子 → 高牌 5+7=12？（3 张 ♦ 非同花需 5 张）→ 高牌 12/抽
  const pt3 = r3.events.filter(e => e.type === 'pullTotal').map(e => e.total)
  assert(pt3.every(t => t === 12), `♥ 削弱后每抽高牌 12（实际 ${pt3[0]}）`)
  assert(r3.events.every(e => !(e.type === 'bossRule' && e.rule === 'repeat_rank_decay')), '削弱后无重复点数衰减')

  // 意图：恩赐日（本抽视为同花色 → 免除花色惩罚且成同花）
  const exp4 = mkExp()
  const r4 = settle(exp4, [
    ev('project_task', { taskId: 'g1', projectId: pidForSuit('spades'), completedAt: `${DAY}T10:00:00` }),
    ev('project_task', { taskId: 'g2', projectId: pidForSuit('hearts'), completedAt: `${DAY}T11:00:00` }),
    ev('project_task', { taskId: 'g3', projectId: pidForSuit('clubs'), completedAt: `${DAY}T12:00:00` }),
    ev('daily_task', { taskId: 'g4', completedAt: `${DAY}T13:00:00` }),
    ev('habit_checkin', { taskId: 'g5', streak: 1, completedAt: `${DAY}T09:00:00` }),
  ], { intent: { id: 'grace_flush', name: '恩赐日' } })
  // 全部视为 ♦（当日最多）：8,8,8,5,4 → 同花 35+33=68 ×4 = 272/抽，无花色罚
  const pt4 = r4.events.filter(e => e.type === 'pullTotal').map(e => e.total)
  assert(pt4.every(t => t === 272) && !r4.events.some(e => e.type === 'bossRule' && e.rule === 'suit_diversity_penalty'),
    `恩赐日：每抽同花 272 且免罚（实际 ${pt4[0]}）`)

  // 意图：顺子恩赐 ×1.5（拖延之墙）
  const exp5 = mkExp({ bossId: 'boss_procrastination' })
  const r5 = settle(exp5, [
    ev('habit_checkin', { taskId: 'sg1', streak: 2, completedAt: `${DAY}T08:00:00` }),
    ev('daily_task', { taskId: 'sg2', completedAt: `${DAY}T10:00:00` }),
    ev('habit_checkin', { taskId: 'sg3', streak: 9, completedAt: `${DAY}T09:00:00` }),
    ev('daily_task', { taskId: 'sg4', priority: '高', completedAt: `${DAY}T11:00:00` }),
    ev('project_task', { taskId: 'sg5', projectId: pidForSuit('spades'), completedAt: `${DAY}T12:00:00` }),
  ], { intent: { id: 'straight_grace', name: '顺子恩赐', factor: 1.5 } })
  const pt5 = r5.events.filter(e => e.type === 'pullTotal').map(e => e.total)
  assert(pt5.every(t => t === 360), `顺子恩赐：每抽 (30+30)×(4×1.5)=360（实际 ${pt5[0]}）`)

  // 意图：换轨施压（行动牌第 2 次换轨 → 压力 +1，日级判定）
  const exp6 = mkExp()
  const r6 = settle(exp6, [
    ev('project_task', { taskId: 'v1', projectId: pidForSuit('spades'), completedAt: `${DAY}T10:00:00` }),
    ev('project_task', { taskId: 'v2', projectId: pidForSuit('hearts'), completedAt: `${DAY}T11:00:00` }),
    ev('project_task', { taskId: 'v3', projectId: pidForSuit('spades', 100), completedAt: `${DAY}T12:00:00` }),
  ], { intent: { id: 'switch_pressure', name: '换轨施压' } })
  assert(r6.pressure === 1 && r6.events.some(e => e.type === 'intentViolation' && e.switches === 2), `2 次换轨 → 压力 +1（实际 ${r6.pressure}）`)

  // 意图：重复花色施压（拖延之墙，日级判定）
  const exp7 = mkExp({ bossId: 'boss_procrastination' })
  const r7 = settle(exp7, [
    ev('daily_task', { taskId: 'rp1', completedAt: `${DAY}T10:00:00` }),
    ev('daily_task', { taskId: 'rp2', completedAt: `${DAY}T11:00:00` }),
  ], { intent: { id: 'repeat_suit_pressure', name: '重复花色施压' } })
  assert(r7.pressure >= 1 && r7.events.some(e => e.type === 'intentViolation'), `重复花色 → 压力 +1（实际 ${r7.pressure}，含低于最低线来源）`)

  // 意图从 Boss 意图池抽取（不传 intent 时）
  const exp8 = mkExp({ seed: 'intent-draw' })
  settle(exp8, [ev('daily_task', { taskId: 'i1' })], { intent: null })
  const poolIds = EXPEDITION_BOSSES.find(b => b.id === 'boss_distraction').intents.map(i => i.id)
  assert(poolIds.includes(exp8.intentHistory[0].intent), `意图抽自意图池（实际 ${exp8.intentHistory[0].intent}）`)
}

// ================= 压力系统 =================
section('压力系统：累计到失败')
{
  // 覆盖最低线为 99999（含 Boss 节点）→ 任意日常伤害都触线，稳定验证「低于最低线 → 压力 +1」累计机制
  const exp = mkExp({ seed: 'pressure', balance: { NODE_MIN_DAMAGE: { normal: 99999, elite: 99999, shop: 0 }, BOSS_MIN_DAMAGE: 99999 } })
  for (let d = 0; d < DAYS_PER_RUN; d++) {
    const date = `2026-07-0${d + 1}`
    const r = settle(exp, [
      ev('habit_checkin', { taskId: `pr${d}1`, streak: 1, completedAt: `${date}T08:00:00` }),
      ev('daily_task', { taskId: `pr${d}2`, completedAt: `${date}T09:00:00` }),
      ev('daily_task', { taskId: `pr${d}3`, priority: '高', completedAt: `${date}T10:00:00` }),
      ev('project_task', { taskId: `pr${d}4`, projectId: pidForSuit('spades'), completedAt: `${date}T11:00:00` }),
      ev('project_task', { taskId: `pr${d}5`, projectId: pidForSuit('hearts'), completedAt: `${date}T12:00:00` }),
    ], { date })
    if (d < DAYS_PER_RUN - 1) {
      assert(r.pressure === d + 1 && exp.status === 'active', `第 ${d + 1} 日伤害 < 最低线 → 压力 ${d + 1}`)
    } else {
      assert(r.pressure === MAX_PRESSURE && exp.status === 'lost' && exp.failReason === 'pressure', `压力满 ${MAX_PRESSURE} → 失败(pressure)`)
      assert(exp.settlementReport && exp.settlementReport.status === 'lost', '失败时局终清算单已生成')
    }
  }
  // 无行动日不推进不惩罚（红线）
  const exp2 = mkExp({ seed: 'rest' })
  const idle = exp2.settleDay({ date: DAY, events: [] })
  assert(idle.settled === false && idle.reason === 'no_actions' && exp2.dayIndex === 0 && exp2.pressure === 0, '无行动日：不推进、不惩罚、不结算')
}

// ================= 通关 / 失败(Boss 未倒) / 放弃 三分支 =================
section('通关 / 失败 / 放弃 三分支（契约 §3.4）')
{
  // 通关：专注爆发日（同项目 10,10,8,4,4 同花 → 每抽 284，日计 1420；同花日构造）
  const win = mkExp({ seed: 'win' })
  const burst = d => {
    const p = pidForSuit('clubs')
    return [
      ev('project_task', { taskId: `w${d}_1`, projectId: p, priority: '高', completedAt: `2026-07-0${d}T10:00:00` }),
      ev('project_task', { taskId: `w${d}_2`, projectId: p, priority: '高', completedAt: `2026-07-0${d}T11:00:00` }),
      ev('project_task', { taskId: `w${d}_3`, projectId: p, completedAt: `2026-07-0${d}T12:00:00` }),
      ev('project_task', { taskId: `w${d}_4`, projectId: p, createdAt: `2026-07-0${d}T09:00:00`, completedAt: `2026-07-0${d}T13:00:00` }),
      ev('project_task', { taskId: `w${d}_5`, projectId: p, createdAt: `2026-07-0${d}T09:30:00`, completedAt: `2026-07-0${d}T14:00:00` }),
    ]
  }
  const w1 = settle(win, burst(1), { date: '2026-07-01' })
  assert(w1.total === 1420, `爆发日 1420（实际 ${w1.total}）`)
  // 溢出 50% 结转：1420 −60→680 −95→292 −35→128 −60→34 → Boss 800−34=766
  assert(win.nodes[4].hp === 766, `溢出结转后 Boss HP=766（实际 ${win.nodes[4].hp}）`)
  assert(w1.events.filter(e => e.type === 'overflowCarry').length === 4, '4 次 overflowCarry 事件')
  const w2 = settle(win, burst(2), { date: '2026-07-02' })
  assert(w2.status === 'won' && win.failReason === null && win.pressure === 0, '第 2 日 Boss 倒下 → 通关(won)')
  assert(win.settlementReport.won === true && win.settlementReport.status === 'won', '通关清算单 won')
  assert(win.packQueue.length >= 3, `节点奖励包已入队（${win.packQueue.length} 个）`)
  assert(win.packQueue.some(p => p.kind === 'bossReward'), 'Boss 通关 → Mega 档奖励（§2.2）')

  // 失败（Boss 未倒）：自定义短轨道 + 每日 40 伤害（< 100 Boss 线但够不着 Boss）
  const lose = mkExp({
    seed: 'lose', bossId: 'boss_procrastination',
    balance: { NODE_HP: { normal: [100, 100, 100], elite: [100, 100, 100], shop: [50, 50, 50] }, NODE_MIN_DAMAGE: { normal: 10, elite: 10, shop: 0 } },
  })
  for (let d = 1; d <= DAYS_PER_RUN; d++) {
    settle(lose, [
      ev('habit_checkin', { taskId: `l${d}_1`, streak: 1, completedAt: `2026-07-0${d}T08:00:00` }),
      ev('daily_task', { taskId: `l${d}_2`, completedAt: `2026-07-0${d}T09:00:00` }),
      ev('daily_task', { taskId: `l${d}_3`, priority: '高', completedAt: `2026-07-0${d}T10:00:00` }),
      ev('project_task', { taskId: `l${d}_4`, projectId: pidForSuit('spades'), completedAt: `2026-07-0${d}T11:00:00` }),
      ev('project_task', { taskId: `l${d}_5`, projectId: pidForSuit('hearts'), completedAt: `2026-07-0${d}T12:00:00` }),
    ], { date: `2026-07-0${d}` })
  }
  assert(lose.status === 'lost' && lose.failReason === 'boss_alive' && lose.pressure === 0, `5 日耗尽 Boss 未倒 → 失败(boss_alive)，压力 ${lose.pressure}`)

  // 放弃：局内构筑清算，图鉴点亮保留
  const give = new Expedition({ bossId: 'boss_distraction', seed: 'give' })
  give.applyDraft()
  settle(give, [ev('daily_task', { taskId: 'a1' })])
  give.abandon()
  assert(give.status === 'abandoned' && give.failReason === 'abandoned', '中途放弃 → abandoned')
  const rep = give.settlementReport
  assert(rep.cleared.jokers.length === 1 && rep.cleared.deckCount === 2, '清算单记录局内构筑（1 小丑 + 2 牌）')
  assert(rep.cleared.research >= 0 && give.research === 0, '研料局终清零（清算单记录清算前值）')
  assert(rep.discovered.includes(give.jokers[0].id) && rep.discovered.includes('playing_card'), '图鉴点亮保留（永久）')
}

// ================= 研料经济（局内货币） =================
section('研料来源：未用拉杆 1:1 + 节点奖励（契约 §2.3）')
{
  // 2 行动日 → 2 抽 + 3 未用拉杆 → 研料 +3（HP 覆盖为 99999，隔离节点奖励干扰）
  const exp = mkExp({ seed: 'eco1', balance: { NODE_HP: { normal: [99999, 99999, 99999], elite: [99999, 99999, 99999], shop: [99999, 99999, 99999] } } })
  settle(exp, [ev('daily_task', { taskId: 'e1' }), ev('daily_task', { taskId: 'e2' })])
  assert(exp.research === STARTING_RESEARCH + 3, `3 未用拉杆 → 研料 ${STARTING_RESEARCH}+3（实际 ${exp.research}）`)
  // 爆发日清节点 → 节点奖励研料 + 卡包奖励（同花日 1420：清 normal+elite+shop+normal，Boss 存活）
  const exp2 = mkExp({ seed: 'eco2' })
  const before = exp2.research
  const cp = pidForSuit('clubs')
  settle(exp2, [
    ev('project_task', { taskId: 'nr1', projectId: cp, priority: '高', completedAt: `${DAY}T10:00:00` }),
    ev('project_task', { taskId: 'nr2', projectId: cp, priority: '高', completedAt: `${DAY}T11:00:00` }),
    ev('project_task', { taskId: 'nr3', projectId: cp, completedAt: `${DAY}T12:00:00` }),
    ev('project_task', { taskId: 'nr4', projectId: cp, createdAt: `${DAY}T09:00:00`, completedAt: `${DAY}T13:00:00` }),
    ev('project_task', { taskId: 'nr5', projectId: cp, createdAt: `${DAY}T09:30:00`, completedAt: `${DAY}T14:00:00` }),
  ])
  assert(exp2.research === before + NODE_RESEARCH.normal * 2 + NODE_RESEARCH.elite, `普通×2+精英节点奖励研料（实际 ${exp2.research}）`)
  assert(exp2.packQueue.length === 3 && exp2.packQueue.every(p => p.kind === 'packChoice' || p.kind === 'pack'),
    `普通→三选一、精英→Jumbo 包入队（${exp2.packQueue.map(p => p.kind)}）`)
  assert(exp2.packQueue[0].options?.length === 3, '普通节点包三选一（类型随机）')
}

// ================= 版本与栏位（原作语义） =================
section('版本 = 数值/栏位加成（§2：负片 +1 栏）')
{
  const exp = mkExp({ lineup: [{ id: 'j_joker', edition: 'negative' }] })
  assert(jokerSlotCountOf(exp) === LINEUP_SIZE + 1, '负片小丑 +1 阵容栏')
  let added = 0
  for (const id of ['j_greedy_joker', 'j_lusty_joker', 'j_wrathful_joker', 'j_gluttonous_joker', 'j_abstract_joker']) {
    if (addJokerToExp(exp, { id }, exp.rng)) added++
  }
  assert(added === 5 && exp.jokers.length === 6, '栏位 6 可装满')
  assert(addJokerToExp(exp, { id: 'j_misprint' }, exp.rng) === null, '第 7 张超出栏位 → 拒绝')
  // 版本数值语义：闪箔 +50 筹码（score.js 既有逻辑）
  const exp2 = mkExp({ bossId: 'boss_procrastination', lineup: [{ id: 'j_joker', edition: 'foil' }] })
  const r = settle(exp2, [ev('daily_task', { taskId: 'ed1' }), ev('daily_task', { taskId: 'ed2' }), ev('daily_task', { taskId: 'ed3' }), ev('habit_checkin', { taskId: 'ed4', streak: 1 }), ev('daily_task', { taskId: 'ed5', priority: '高' })])
  // 5♦5♦5♦4♦7♦ 同花，拖延两张 5 减半 → chips 55；mult 4+4(joker)=8；闪箔 +50 筹码 → (55+50)×8=840/抽
  const pt = r.events.filter(e => e.type === 'pullTotal').map(e => e.total)
  assert(pt.every(t => t === 840), `闪箔 +50 筹码按原作生效：每抽 840（实际 ${pt[0]}）`)
}

// ================= 状态 JSON 序列化往返 =================
section('状态 JSON 序列化往返无损')
{
  const exp = new Expedition({ bossId: 'boss_procrastination', seed: 'serde' })
  exp.applyDraft({ jokerIndex: 0, cardIndices: [0, 1] })
  settle(exp, [ev('daily_task', { taskId: 'r1' }), ev('daily_task', { taskId: 'r2' })])
  const snap = JSON.stringify(exp.serialize())
  const restored = Expedition.deserialize(JSON.parse(snap))
  assert(restored.status === 'active' && restored.dayIndex === 1 && restored.pressure === exp.pressure, '基本字段往返一致')
  assert(restored.jokers.length === exp.jokers.length && restored.deck.length === exp.deck.length
    && restored.deckStart === exp.deckStart, '阵容/牌组/deckStart 还原')
  assert(restored.research === exp.research && restored.nodes[0].hp === exp.nodes[0].hp, '研料与节点 HP 还原')
  // 读档后续跑与原局结果一致（rng counter 持久）
  const day2 = [ev('daily_task', { taskId: 'r3', completedAt: '2026-07-02T10:00:00' }), ev('daily_task', { taskId: 'r4', completedAt: '2026-07-02T11:00:00' })]
  const contA = settle(exp, day2, { date: '2026-07-02' })
  const contB = settle(restored, day2, { date: '2026-07-02' })
  assert(contA.total === contB.total && contA.pulls === contB.pulls, `读档后续跑一致（${contA.total}=${contB.total}）`)
}

// ================= 数据完整性 =================
section('远征数据完整性')
{
  assert(EXPEDITION_BOSSES.length === 2 && EXPEDITION_THEMES.length === 2, '2 Boss / 2 远征主题')
  for (const b of EXPEDITION_BOSSES) {
    assert(b.hp.length === 3 && b.hp[0] === 800 && b.minDamagePerDay === 100
      && b.rules.length >= 1 && b.intents.length >= 2 && b.art && 'pixelMap' in b.art,
      `${b.name}：hp 800/1000/1200、minDamage 100、rules/intents/art 齐备（契约 §4.1）`)
  }
  assert(NODE_HP.normal.length === 3 && NODE_MIN_DAMAGE.shop === 0, '节点 HP 三档 + 商店节点无最低线（休整）')
  assert(MAX_PULLS_PER_DAY === 5 && DAYS_PER_RUN === 5, '每日 ≤5 拉杆 / 5 活跃日')
}

console.log(`\n========================================`)
console.log(`结果：${passed} 通过 / ${failed} 失败`)
if (failed > 0) process.exit(1)
