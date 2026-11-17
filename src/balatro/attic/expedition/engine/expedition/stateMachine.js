// 远征局状态机（契约 §3，老虎机模型）
// 5 个活跃日，与日历日彻底解耦：无行动日不推进、不惩罚、不结算（红线 §10.1）
// 节点路线固定：普通 → 精英 → 商店 → 普通 → Boss；节点 HP 池，溢出伤害 50% 结转
// 压力系统：活跃日伤害 < 最低线 +1；违反 Boss 当日意图 +1；满 5 失败
// 一切卡牌局内获得、局终清算（§2.4）；图鉴见过即永久点亮（§1）
// 状态可 JSON 序列化；任何反序列化异常降级为空局由调用方兜底（§7）

import { Rng } from '../../../../engine/rng.js'
import { HANDS } from '../../../../data/hands.js'
import { EXPEDITION_BOSSES_BY_ID, EXPEDITION_THEMES_BY_ID } from '../../data/expedition/bosses.js'
import {
  DAYS_PER_RUN, MAX_PRESSURE, OVERFLOW_CARRY_RATIO,
  NODE_ROUTE, NODE_HP, NODE_MIN_DAMAGE, NODE_RESEARCH,
  STARTING_RESEARCH, MAX_PULLS_PER_DAY,
} from './balance.js'
import { buildActionCards } from './actionCards.js'
import { scoreDay } from './dayScore.js'
import {
  rollStarterDraft, applyStarterDraft, offerForNodeCleared, buildSettlementReport,
  starterSpec,
} from './economy.js'
import { addJokerToExp, addDeckCard, destroyLineupJoker, emitJokersPhase, adapterRun, adapterRound } from './adapter.js'

let _uidCounter = 0
const uid = p => `${p}_${Date.now().toString(36)}_${(++_uidCounter).toString(36)}`

export class Expedition {
  // opts: { themeId?, bossId, difficulty=1, seed, wins=0, research?,
  //         lineup?/deck?（测试直装，跳过 draft）, balance? }
  constructor(opts = {}) {
    const theme = opts.themeId ? EXPEDITION_THEMES_BY_ID[opts.themeId] : null
    const bossId = opts.bossId || theme?.bossId
    const boss = EXPEDITION_BOSSES_BY_ID[bossId]
    if (!boss) throw new Error(`unknown expedition boss: ${bossId}`)
    const bal = { NODE_ROUTE, NODE_HP, NODE_MIN_DAMAGE, NODE_RESEARCH, ...(opts.balance || {}) }
    const difficulty = Math.min(3, Math.max(1, opts.difficulty || 1))

    this.version = 2
    this.id = opts.id || uid('exp')
    this.themeId = theme?.id || null
    this.bossId = bossId
    this.difficulty = difficulty
    this.seed = String(opts.seed ?? 'expedition')
    this.rng = new Rng(this.seed)
    this.balance = bal
    this.wins = opts.wins || 0 // 历史通关数（卡池阶梯/起始构筑阶梯输入）

    this.status = 'active'           // active | won | lost | abandoned
    this.failReason = null           // pressure | boss_alive | abandoned
    this.dayIndex = 0                // 已结算活跃日数 0..5
    this.nodeIndex = 0               // 当前节点 0..4
    this.pressure = 0
    this.research = opts.research ?? STARTING_RESEARCH
    this.bossDisabledToday = false

    // 节点 HP 池
    this.nodes = bal.NODE_ROUTE.map(kind => {
      const hpMax = kind === 'boss' ? boss.hp[difficulty - 1] : bal.NODE_HP[kind][difficulty - 1]
      const minDamage = kind === 'boss' ? (bal.BOSS_MIN_DAMAGE ?? boss.minDamagePerDay) : bal.NODE_MIN_DAMAGE[kind]
      return { kind, hp: hpMax, hpMax, minDamage }
    })

    // ---- 局内构筑（§2：局内获得、局终清算） ----
    this.jokers = []                 // 阵容（起始 draft 1 张 + 局内获得）
    this.deck = []                   // 本局扑克牌组（起始 draft + 局内获得，上限 52）
    this.deckStart = 0               // 起始牌组大小（侵蚀等读）
    this.consumables = []            // 消耗牌栏
    this.pendingDayEffects = []      // 当日修正队列（下个活跃日结算时应用并清空）

    // ---- 栏位/修正（灵质 -1 抽取；阶梯奖励） ----
    const spec = starterSpec(this.wins)
    this.jokerSlotBonus = spec.jokerSlotBonus || 0
    this.consumableSlotBonus = spec.consumableBonus || 0
    this.jokerSlotModifier = 0
    this.drawCountModifier = 0

    // ---- 牌型等级（星球升级本局永久） ----
    this.handLevels = Object.fromEntries(HANDS.map(h => [h.id, 1]))
    this.modifiers = {}
    this.stats = {
      handsPlayed: {}, handsPlayedTotal: 0, tarotsUsed: 0,
      planetsUsedUnique: [], researchEarned: 0, packsSkipped: 0,
    }

    // ---- 起始构筑 draft（§2.1）与卡包队列 ----
    this.draft = null
    this.packQueue = []              // 节点奖励待选包
    this.pendingPack = null          // 开启中的包（待选牌）
    this.seen = {}                   // 图鉴点亮记账（见过即发现）

    if (opts.lineup || opts.deck) {
      // 测试直装：跳过 draft
      for (const entry of opts.lineup || []) addJokerToExp(this, entry, this.rng)
      for (const c of opts.deck || []) addDeckCard(this, c, this.rng)
      this.deckStart = this.deck.length
    } else {
      this.draft = rollStarterDraft(this)
    }

    this.intentHistory = []
    this.dayRecords = []
    this.settlementReport = null     // 局终清算单（§2.4）
    this.lastConsumableId = null     // 愚者复制目标
    this.forcedIntent = null         // 塔罗「塔」重 roll 的意图
    this.createdAt = opts.createdAt || new Date().toISOString()
    this.updatedAt = this.createdAt
  }

  // 应用起始构筑选择（UI/测试调用）
  applyDraft(picks) { return applyStarterDraft(this, picks) }

  _drawIntent() {
    const boss = EXPEDITION_BOSSES_BY_ID[this.bossId]
    return this.rng.weightedPick(boss.intents, i => i.weight ?? 1)
  }

  // 结算一个活跃日。events = 当日行动事件流（见 actionCards.js 形状）
  // 无有效行动 → 不推进、不惩罚、不结算（红线：系统永不惩罚休息）
  settleDay({ date, events = [], intent = null } = {}) {
    if (this.status !== 'active') return { settled: false, reason: 'run_over', status: this.status }
    if (this.draft && !this.draft.resolved) this.applyDraft() // 未选先默认（UI 总会先选；兜底防卡死）
    const { cards, scoringCards } = buildActionCards(events, { date: date ?? new Date(), maxScoring: MAX_PULLS_PER_DAY })
    if (!cards.length) return { settled: false, reason: 'no_actions', status: this.status }

    const todayIntent = intent || this.forcedIntent || this._drawIntent()
    this.forcedIntent = null
    const nodeAtStart = this.nodes[this.nodeIndex] || null
    const minLine = nodeAtStart?.minDamage ?? 0

    // ---- 老虎机日计分（拉杆制） ----
    const res = scoreDay(this, { actionCards: scoringCards, intent: todayIntent, rng: this.rng })
    const events2 = [...res.events]

    // ---- 未使用拉杆 1:1 转化研料（契约 §2.3） ----
    const unusedPulls = Math.max(0, MAX_PULLS_PER_DAY - scoringCards.length)
    if (unusedPulls > 0) {
      this.research += unusedPulls
      events2.push({ type: 'researchGain', source: 'unusedPulls', amount: unusedPulls })
    }

    // ---- 节点伤害与溢出 50% 结转 ----
    let dmg = res.total
    const clearedNodes = []
    while (dmg > 0 && this.nodeIndex < this.nodes.length) {
      const node = this.nodes[this.nodeIndex]
      node.hp -= dmg
      if (node.hp <= 0) {
        const overflow = -node.hp
        node.hp = 0
        this.nodeIndex += 1
        clearedNodes.push(node)
        events2.push({ type: 'nodeCleared', nodeIndex: this.nodeIndex - 1, kind: node.kind, overflow })
        dmg = Math.floor(overflow * OVERFLOW_CARRY_RATIO)
        if (dmg > 0 && this.nodeIndex < this.nodes.length) {
          events2.push({ type: 'overflowCarry', amount: dmg, toNodeIndex: this.nodeIndex })
        }
      } else {
        dmg = 0
      }
    }

    // ---- 节点通关奖励（契约 §2.2：研料 + 卡包） ----
    for (const node of clearedNodes) {
      const reward = this.balance.NODE_RESEARCH[node.kind] || 0
      if (reward) {
        this.research += reward
        events2.push({ type: 'researchGain', source: 'nodeReward', kind: node.kind, amount: reward })
      }
      const offer = offerForNodeCleared(this, node.kind)
      if (offer) {
        this.packQueue.push(offer)
        events2.push({ type: 'packOffer', offer })
      }
      if (node.kind === 'shop') {
        // 离开商店节点 → shopEnd 阶段（Perkeo）
        events2.push(...emitJokersPhase(this, adapterRun(this), adapterRound(this), this.rng, 'shopEnd'))
      }
    }

    // ---- 压力（来源只有两种：伤害低于最低线；违反 Boss 当日意图） ----
    const pressureEvents = []
    if (res.total < minLine) {
      this.pressure = Math.min(MAX_PRESSURE, this.pressure + 1)
      pressureEvents.push({ type: 'pressure', reason: 'below_min_damage', total: res.total, minDamage: minLine, pressure: this.pressure })
    }
    for (const flag of res.pressureFlags) {
      this.pressure = Math.min(MAX_PRESSURE, this.pressure + 1)
      pressureEvents.push({ type: 'pressure', reason: 'intent_violation', intent: flag.intent, pressure: this.pressure })
    }
    // 白骨精（Mr. Bones）：压力将满时，当日伤害 ≥ 当前节点 HP 上限 25% → 免死一次（消耗该小丑）
    if (this.pressure >= MAX_PRESSURE) {
      const bones = this.jokers.find(j => j.id === 'j_mr_bones' && !j.debuffed)
      if (bones && res.total >= (nodeAtStart?.hpMax || 0) * 0.25) {
        destroyLineupJoker(this, bones.uid)
        this.pressure = MAX_PRESSURE - 1
        pressureEvents.push({ type: 'mrBonesSave', jokerUid: bones.uid, pressure: this.pressure })
      }
    }
    events2.push(...pressureEvents)

    this.dayIndex += 1
    this.intentHistory.push({ day: this.dayIndex, intent: todayIntent?.id || null })
    this.dayRecords.push({
      day: this.dayIndex, date: typeof date === 'string' ? date : null,
      actionCards: scoringCards.map(c => ({ rank: c.rank, suit: c.suit, source: c.source, taskId: c.taskId })),
      pulls: res.pulls, total: res.total,
      pressure: this.pressure, intent: todayIntent?.id || null,
      researchAfter: res.researchAfter,
    })
    this.updatedAt = new Date().toISOString()

    // ---- 终局判定（压力优先于通关；契约 §3.4） ----
    const bossNode = this.nodes[this.nodes.length - 1]
    if (bossNode.hp <= 0 && !this._bossDefeatedFired) {
      // 火箭/篝火等：Boss 击破触发 blindDefeated 阶段（镜像 run.js）
      this._bossDefeatedFired = true
      events2.push(...emitJokersPhase(this, adapterRun(this), adapterRound(this), this.rng, 'blindDefeated', { blindType: 'boss' }))
    }
    if (this.pressure >= MAX_PRESSURE) this._endRun('lost', 'pressure', events2)
    else if (bossNode.hp <= 0) this._endRun('won', 'boss_down', events2)
    else if (this.dayIndex >= DAYS_PER_RUN) this._endRun('lost', 'boss_alive', events2)

    return {
      settled: true, day: this.dayIndex, intent: todayIntent,
      total: res.total, pulls: res.pulls, scoringCards,
      minDamage: minLine, pressure: this.pressure,
      pressureEvents, nodeIndex: this.nodeIndex, nodes: this.nodes,
      events: events2, status: this.status, failReason: this.failReason,
      settlementReport: this.settlementReport,
    }
  }

  // 中途放弃 = 失败，同样只清算局内构筑（契约 §3.4/§2.4）
  abandon() {
    if (this.status !== 'active') return this.status
    this._endRun('abandoned', 'abandoned', [])
    return this.status
  }

  // 阵容拖拽排序（E3 UI；jokers 顺序即触发顺序，序列化天然保留）
  reorderJokers(from, to) {
    if (from === to || from < 0 || to < 0 || from >= this.jokers.length || to >= this.jokers.length) return false
    const [j] = this.jokers.splice(from, 1)
    this.jokers.splice(to, 0, j)
    this.updatedAt = new Date().toISOString()
    return true
  }

  // 局终清算（契约 §2.4）：局内卡牌/研料/牌型等级/临时强化全部清算；
  // 永久保留：图鉴点亮、通关次数、卡池解锁、起始构筑升级
  _endRun(status, reason, events) {
    this.status = status
    this.failReason = status === 'won' ? null : reason
    this.settlementReport = buildSettlementReport(this, status, reason)
    const cleared = this.settlementReport.cleared
    this.research = 0 // 研料局终清零
    events.push({ type: 'runEnd', status, reason, settlement: this.settlementReport })
    this.updatedAt = new Date().toISOString()
    void cleared
  }

  // ================= 序列化（持久化用） =================
  serialize() {
    const plain = { ...this, rng: this.rng.getState() }
    delete plain.balance // 数值表不入存档（版本升级以代码为准）
    return JSON.parse(JSON.stringify(plain))
  }

  static deserialize(snap) {
    const s = typeof snap === 'string' ? JSON.parse(snap) : snap
    const exp = Object.create(Expedition.prototype)
    Object.assign(exp, s)
    exp.rng = new Rng(0)
    exp.rng.setState(s.rng)
    exp.balance = { NODE_ROUTE, NODE_HP, NODE_MIN_DAMAGE, NODE_RESEARCH }
    return exp
  }
}
