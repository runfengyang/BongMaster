// Run 状态机（§5.1）
// idle → deckSelect → blindSelect(small|big|boss) → round → roundEnd → shop → blindSelect …
// → runOver(失败) | victory(Ante 8 Boss 通关)

import { Rng } from './rng.js'
import { buildDeckFor, sortCards, cloneCard, makeCard, SUITS, nextCardUid } from './deck.js'
import { evaluate } from './evaluate.js'
import { scoreHand } from './score.js'
import { JOKER_HANDLERS, jokerHandlerFor, initialJokerState } from './jokerEffects.js'
import { applyConsumable } from './consumables.js'
import * as Shop from './shop.js'
import { HANDS } from '../data/hands.js'
import { DECKS_BY_ID } from '../data/decks.js'
import { JOKERS_BY_ID } from '../data/jokers.js'
import { TAROT_BY_ID } from '../data/tarot.js'
import { PLANETS_BY_ID } from '../data/planets.js'
import { SPECTRAL_BY_ID } from '../data/spectral.js'
import { SMALL_BLIND, BIG_BLIND, BOSS_BLINDS, SHOWDOWN_BLINDS, BLINDS_BY_ID, blindTarget } from '../data/blinds.js'
import { PACKS_BY_ID } from '../data/packs.js'
import { VOUCHERS_BY_ID } from '../data/vouchers.js'
import { TAGS, TAGS_BY_ID } from '../data/tags.js'

let _uid = 0
const uid = p => `${p}_${++_uid}`

export class BalatroRun {
  constructor({ deckId = 'deck_red', seed = 'seed' } = {}) {
    this.deckId = deckId
    this.seed = seed
    this.rng = new Rng(seed)
    const deck = DECKS_BY_ID[deckId]
    const fx = deck?.effect || {}

    this.state = 'blindSelect'
    this.ante = 1
    this.blindIndex = 0 // 0 small / 1 big / 2 boss
    this.bossId = null
    this.bossesSeen = []

    // 基础数值 + 牌组修正
    this.baseHands = 4 + (fx.hands || 0)
    this.baseDiscards = 3 + (fx.discards || 0)
    this.baseHandSize = 8 + (fx.handSize || 0)
    this.baseJokerSlots = 5 + (fx.jokerSlots || 0)
    this.baseConsumableSlots = 2 + (fx.consumableSlots || 0)
    this.money = 4 + (fx.money || 0)
    this.greenEconomy = !!fx.greenEconomy
    this.plasma = !!fx.plasma
    this.ghostShop = !!fx.ghostShop
    this.anaglyph = !!fx.anaglyph
    this.handSizeMod = 0

    this.jokers = []
    this.consumables = []
    this.vouchers = [...(fx.vouchers || [])]
    this.handLevels = Object.fromEntries(HANDS.map(h => [h.id, 1]))

    this.fullDeck = buildDeckFor(fx, this.rng)
    this.fullDeckStart = this.fullDeck.length
    this.round = null
    this.shop = null
    this.packState = null
    this.tags = [] // 持有中未触发标签（仅展示/双倍用）
    this.tagQueue = { coupon: false, d6: false, extraVoucher: false, forcedJokers: [], juggleHandSize: 0, investment: 0 }
    this.stats = {
      handsPlayed: {}, handsPlayedTotal: 0, tarotsUsed: 0, planetsUsedUnique: [],
      blindsSkipped: 0, packsSkipped: 0, lastTarotOrPlanet: null, discardsUnused: 0,
      cardsDiscarded: 0, cardsPlayed: 0, jokersSold: 0, cardsSold: 0, rerolls: 0,
      roundsWon: 0,
      bestHand: 0, moneyEarned: 0, roundsPlayed: 0, // Run 结算页展示（轻量）
    }
    this.lastScoreEvents = []
    this.log = []

    for (const cid of (fx.consumables || [])) this.createConsumable(cid)
    this.rollBoss()
  }

  // ================= 序列化 =================
  serialize() {
    const { rng, ...rest } = this
    return JSON.parse(JSON.stringify({ ...rest, rngState: rng.getState() }))
  }
  static deserialize(data) {
    const run = Object.create(BalatroRun.prototype)
    Object.assign(run, data)
    const rngState = data.rngState
    delete run.rngState
    run.rng = new Rng(data.seed)
    if (rngState) run.rng.setState(rngState)
    return run
  }

  // ================= 派生数据 =================
  defOf(id) {
    return JOKERS_BY_ID[id] || TAROT_BY_ID[id] || PLANETS_BY_ID[id] || SPECTRAL_BY_ID[id] || PACKS_BY_ID[id] || VOUCHERS_BY_ID[id] || TAGS_BY_ID[id] || null
  }
  get modifiers() {
    const m = { plasma: this.plasma }
    for (const j of this.jokers) {
      if (j.debuffed) continue
      const def = JOKERS_BY_ID[j.id]
      if (def?.effect?.handler === 'ruleMod') m[def.effect.params.rule] = true
    }
    return m
  }
  jokerSlotCount() {
    return this.baseJokerSlots + (this.vouchers.includes('v_antimatter') ? 1 : 0) +
      this.jokers.filter(j => j.edition === 'negative').length
  }
  consumableSlotCount() {
    return this.baseConsumableSlots + (this.vouchers.includes('v_crystal_ball') ? 1 : 0) +
      this.consumables.filter(c => c.edition === 'negative').length
  }
  handSizeTotal() {
    let n = this.baseHandSize + (this.handSizeMod || 0) + this.tagQueue.juggleHandSize
    for (const v of this.vouchers) n += VOUCHERS_BY_ID[v]?.effect?.handSize || 0
    for (const j of this.jokers) {
      if (j.debuffed) continue
      const p = JOKERS_BY_ID[j.id]?.effect?.params || {}
      const h = JOKERS_BY_ID[j.id]?.effect?.handler
      if (h === 'juggler') n += p.handSize
      else if (h === 'turtleBean') n += Math.max(0, (p.handSize || 0) - (j.state.decay || 0))
      else if (h === 'merryAndy') n += p.handSize
      else if (h === 'stuntman') n += p.handSize
      else if (h === 'troubadour') n += p.handSize
    }
    if (this.round?.boss?.effect?.handler === 'manacle' && !this.round.bossDisabled) n -= 1
    return Math.max(1, n)
  }
  handsTotal() {
    let n = this.baseHands
    for (const v of this.vouchers) n += VOUCHERS_BY_ID[v]?.effect?.hands || 0
    for (const j of this.jokers) {
      if (j.debuffed) continue
      const h = JOKERS_BY_ID[j.id]?.effect?.handler
      const p = JOKERS_BY_ID[j.id]?.effect?.params || {}
      if (h === 'troubadour') n += p.hands
    }
    if (this.round?.boss?.effect?.handler === 'needle' && !this.round.bossDisabled) return 1
    return Math.max(1, n)
  }
  discardsTotal() {
    let n = this.baseDiscards
    for (const v of this.vouchers) n += VOUCHERS_BY_ID[v]?.effect?.discards || 0
    for (const j of this.jokers) {
      if (j.debuffed) continue
      const h = JOKERS_BY_ID[j.id]?.effect?.handler
      const p = JOKERS_BY_ID[j.id]?.effect?.params || {}
      if (h === 'drunkard') n += p.discards
      else if (h === 'merryAndy') n += p.discards
    }
    if (this.round?.boss?.effect?.handler === 'water' && !this.round.bossDisabled) return 0
    return Math.max(0, n)
  }

  // ================= helpers（供小丑/消耗牌 ctx 使用） =================
  get helpers() {
    const run = this
    return {
      addMoney: n => { run.money += n },
      defOf: id => run.defOf(id),
      sellValue: item => Shop.sellValueOf(item, run.defOf(item.id) || { cost: 2 }),
      jokerSlotCount: () => run.jokerSlotCount(),
      consumableSlotCount: () => run.consumableSlotCount(),
      fullDeckCount: () => run.fullDeck.length,
      countInFullDeck: fn => run.fullDeck.filter(fn).length,
      mostPlayedHand: () => {
        let best = null, bn = -1
        for (const [k, v] of Object.entries(run.stats.handsPlayed)) if (v > bn) { best = k; bn = v }
        return best
      },
      evaluateCards: cards => evaluate(cards, run.modifiers),
      levelUpHand: (handType, n) => { run.handLevels[handType] = Math.max(1, (run.handLevels[handType] || 1) + n) },
      createTarot: () => run.createConsumable(run.rng.pick(Object.keys(TAROT_BY_ID))),
      createPlanet: () => run.createConsumable(run.rng.pick(Object.keys(PLANETS_BY_ID))),
      createSpectral: () => run.createConsumable(run.rng.pick(Object.keys(SPECTRAL_BY_ID).filter(id => id !== 's_soul' && id !== 's_black_hole'))),
      createConsumable: (id, edition) => run.createConsumable(id, edition),
      createJoker: opts => run.createJoker(opts),
      destroyJoker: u => { run.jokers = run.jokers.filter(j => j.uid !== u) },
      destroyCard: cardId => run.destroyCard(cardId),
      addCardToDeck: opts => run.addCardToDeck(opts),
      addCardToHand: opts => run.addCardToHand(opts),
      copyCardToDeck: (card, toHand) => run.copyCardToDeck(card, toHand),
      addRandomSealedCardToHand: () => run.addRandomSealedCardToHand(),
      addTag: tagId => run.addTag(tagId),
      disableBoss: () => { if (run.round) run.round.bossDisabled = true },
    }
  }

  emitJokersPhase(phase, extra = {}) {
    const events = []
    const emit = e => events.push(e)
    for (const j of [...this.jokers]) {
      if (j.debuffed) continue
      const resolved = jokerHandlerFor(j, this.jokers)
      if (!resolved) continue
      const handler = JOKER_HANDLERS[resolved.def.effect.handler]
      if (!handler) continue
      const ctx = {
        run: this, round: this.round, phase, emit, rng: this.rng,
        joker: resolved.joker, def: resolved.def, helpers: this.helpers,
        score: extra.score || { chips: 0, mult: 0 }, played: [], scored: [], held: this.round?.hand || [],
        hand: { handType: null }, ...extra,
      }
      handler(ctx, resolved.def.effect.params || {})
    }
    return events
  }

  // ================= 创建实体 =================
  createJoker({ id = null, rarity = null, edition = null, legendary = false } = {}) {
    if (this.jokers.length >= this.jokerSlotCount()) return null
    let def
    if (id) def = JOKERS_BY_ID[id]
    else {
      const item = Shop.generateJoker(this, this.rng, { rarity, legendary, edition })
      def = JOKERS_BY_ID[item.id]
      edition = item.edition
    }
    if (!def) return null
    const joker = { uid: uid('j'), id: def.id, edition: edition || null, state: initialJokerState(def), sellBonus: 0, debuffed: false }
    this.jokers.push(joker)
    this.markDiscovered(def.id)
    return joker
  }
  createConsumable(id, edition = null) {
    if (!this.defOf(id)) return null
    if (this.consumables.length >= this.consumableSlotCount()) return null
    const c = { uid: uid('c'), id, edition, sellBonus: 0 }
    this.consumables.push(c)
    this.markDiscovered(id)
    return c
  }
  addCardToDeck({ rank = null, suit = null, enhancement = null, edition = null, seal = null } = {}) {
    const card = makeCard(rank || this.rng.int(2, 14), suit || this.rng.pick(SUITS), { enhancement, edition, seal })
    this.fullDeck.push(card)
    if (this.round) this.round.drawPile.push(card)
    this.emitJokersPhase('cardAdded', { card })
    return card
  }
  addCardToHand(opts = {}) {
    const card = makeCard(opts.rank || this.rng.int(2, 14), opts.suit || this.rng.pick(SUITS), {
      enhancement: opts.enhancement || null, edition: opts.edition || null, seal: opts.seal || null,
    })
    this.fullDeck.push(card)
    if (this.round) this.round.hand.push(card)
    this.emitJokersPhase('cardAdded', { card })
    return card
  }
  copyCardToDeck(card, toHand = false) {
    const copy = cloneCard(card)
    this.fullDeck.push(copy)
    if (toHand && this.round) this.round.hand.push(copy)
    else if (this.round) this.round.drawPile.push(copy)
    this.emitJokersPhase('cardAdded', { card: copy })
    return copy
  }
  addRandomSealedCardToHand() {
    return this.addCardToHand({ seal: this.rng.pick(['red', 'blue', 'purple', 'gold']) })
  }
  destroyCard(cardId) {
    this.fullDeck = this.fullDeck.filter(c => c.id !== cardId)
    if (this.round) {
      this.round.hand = this.round.hand.filter(c => c.id !== cardId)
      this.round.drawPile = this.round.drawPile.filter(c => c.id !== cardId)
      this.round.discardPile = this.round.discardPile.filter(c => c.id !== cardId)
    }
  }
  markDiscovered() {} // 图鉴发现由 store 层记录

  // ================= Boss 选择 =================
  rollBoss() {
    const isShowdown = this.ante % 8 === 0
    let pool = isShowdown ? SHOWDOWN_BLINDS : BOSS_BLINDS.filter(b => b.minAnte <= this.ante)
    // FIDELITY: 原作「最少出场优先」完整轮换逻辑简化为「不连续重复」
    const available = pool.filter(b => b.id !== this.bossId)
    this.bossId = this.rng.pick(available.length ? available : pool).id
    this.log.push({ type: 'bossRolled', id: this.bossId, ante: this.ante })
  }

  currentBlindDef() {
    if (this.blindIndex === 0) return SMALL_BLIND
    if (this.blindIndex === 1) return BIG_BLIND
    return BLINDS_BY_ID[this.bossId]
  }

  // ================= 盲注阶段 =================
  selectBlind() {
    if (this.state !== 'blindSelect') throw new Error('not in blindSelect')
    const blind = this.currentBlindDef()
    this.startRound(blind)
  }

  skipBlind() {
    if (this.state !== 'blindSelect') throw new Error('not in blindSelect')
    if (this.blindIndex === 2) throw new Error('boss blind cannot be skipped')
    this.stats.blindsSkipped += 1
    const pool = TAGS.filter(t => t.minAnte <= this.ante)
    const tag = this.rng.pick(pool)
    this.addTag(tag.id)
    this.advanceBlind()
  }

  addTag(tagId) {
    // 双倍标签：复制下一个非双倍标签
    if (tagId !== 'tag_double' && this.tags.includes('tag_double')) {
      this.tags = this.tags.filter(t => t !== 'tag_double')
      this.applyTag(tagId)
    }
    if (tagId === 'tag_double') { this.tags.push(tagId); return }
    this.applyTag(tagId)
  }

  applyTag(tagId) {
    const def = TAGS_BY_ID[tagId]
    const h = def.effect?.handler
    const p = def.effect?.params || {}
    switch (h) {
      case 'bossReroll': this.rollBoss(); break
      case 'freePack': this.openPack(p.pack, true); break
      case 'coupon': this.tagQueue.coupon = true; break
      case 'd6': this.tagQueue.d6 = true; break
      case 'economy': this.money += Math.min(this.money, p.max); break
      case 'garbage': this.money += this.stats.discardsUnused; break
      case 'handy': this.money += this.stats.handsPlayedTotal; break
      case 'investment': this.tagQueue.investment += p.money; break
      case 'juggle': this.tagQueue.juggleHandSize += p.handSize; break
      case 'speed': this.money += this.stats.blindsSkipped * p.per; break
      case 'orbital': {
        const handId = this.rng.pick(HANDS).id
        this.handLevels[handId] = (this.handLevels[handId] || 1) + p.levels
        break
      }
      case 'topUp': for (let i = 0; i < p.count; i++) if (!this.createJoker({ rarity: 1 })) break
        break
      case 'editionJoker': case 'rarityJoker': {
        const item = Shop.generateJoker(this, this.rng, { rarity: p.rarity || null, edition: p.edition || null })
        this.tagQueue.forcedJokers.push({ id: item.id, edition: p.edition || item.edition || null })
        break
      }
      case 'voucher': this.tagQueue.extraVoucher = true; break
    }
    this.log.push({ type: 'tag', id: tagId })
  }

  // ================= 回合 =================
  startRound(blind) {
    const target = blindTarget(this.ante, blind, this.plasma)
    const drawPile = this.rng.shuffle([...this.fullDeck])
    this.round = {
      blindId: blind.id, blindType: this.blindIndex === 0 ? 'small' : this.blindIndex === 1 ? 'big' : 'boss',
      boss: this.blindIndex === 2 ? blind : null,
      bossDisabled: false,
      target, score: 0,
      handsLeft: this.handsTotal(), discardsLeft: this.discardsTotal(),
      drawPile, hand: [], discardPile: [],
      handTypesPlayed: [], handsPlayedThisRound: 0, discardsUsed: 0,
      firstHand: true, firstDiscard: true, photoUsed: false,
      playedThisAnte: this.round?.playedThisAnte || [],
      bossTriggeredThisHand: false,
    }
    // 注意：handsTotal/discardsTotal 依赖 this.round.boss，须在 round 赋值后计算
    this.round.handsLeft = this.handsTotal()
    this.round.discardsLeft = this.discardsTotal()
    this.state = 'round'
    this.stats.roundsPlayed = (this.stats.roundsPlayed || 0) + 1
    // 杂耍标签的手牌加成已在 handSizeTotal() 中计入，本回合有效，回合结束清零

    // Boss 生效检查：Chicot 禁用一切 Boss
    if (this.round.boss && this.jokers.some(j => j.id === 'j_chicot' && !j.debuffed)) this.round.bossDisabled = true

    // 小丑：blindSelect 阶段
    this.emitJokersPhase('blindSelect', { blindType: this.blindIndex === 0 ? 'small' : this.blindIndex === 1 ? 'big' : 'boss' })
    // 回合开始：certificate 等
    this.emitJokersPhase('roundStart')

    // 轮换型小丑状态初始化（每回合）
    for (const j of this.jokers) {
      const hid = j.id
      if (hid === 'j_mail_in_rebate') j.state.rank = this.rng.int(2, 14)
      else if (hid === 'j_castle' || hid === 'j_ancient_joker') j.state.suit = this.rng.pick(SUITS)
      else if (hid === 'j_the_idol') { j.state.rank = this.rng.int(2, 14); j.state.suit = this.rng.pick(SUITS) }
      else if (hid === 'j_to_do_list') j.state.hand = this.rng.pick(['pair', 'two_pair', 'three_of_a_kind', 'straight', 'flush', 'full_house', 'high_card'])
    }

    this.drawUp()
    // Boss 生效
    const bossH = this.round.boss?.effect?.handler
    if (this.round.boss && !this.round.bossDisabled) {
      if (bossH === 'debuffSuit') {
        const suit = this.round.boss.effect.params.suit
        for (const c of this.fullDeck) c.debuffed = c.suit === suit && c.enhancement !== 'stone'
      }
      if (bossH === 'plant') for (const c of this.fullDeck) c.debuffed = c.rank >= 11 && c.rank <= 13
      if (bossH === 'verdantLeaf') for (const c of this.fullDeck) c.debuffed = true
      if (bossH === 'crimsonHeart') this.crimsonHeartDisable()
      if (bossH === 'pillar') {
        for (const c of this.round.hand) if (this.round.playedThisAnte.includes(c.id)) c.debuffed = true
      }
      // FIDELITY: house/wheel/fish/mark（面朝下抽取）与 ceruleanBell（强制选中）、amberAcorn（翻面洗混）
      // 为纯 UI 表现差异，引擎层无计分影响，按无操作处理
    }
  }

  crimsonHeartDisable() {
    for (const j of this.jokers) j.debuffed = false
    const candidates = this.jokers.filter(j => JOKERS_BY_ID[j.id].effect.handler !== 'chicot')
    if (candidates.length) this.rng.pick(candidates).debuffed = true
  }

  drawUp() {
    const r = this.round
    const serpent = r.boss?.effect?.handler === 'serpent' && !r.bossDisabled
    // 蛇：出牌/弃牌后固定抽 3 张（忽略手牌上限）；否则补满手牌上限
    const n = (serpent && (r.handsPlayedThisRound > 0 || r.discardsUsed > 0)) ? 3 : this.handSizeTotal() - r.hand.length
    for (let i = 0; i < n; i++) {
      if (!r.drawPile.length) {
        if (!r.discardPile.length) break
        r.drawPile = this.rng.shuffle(r.discardPile)
        r.discardPile = []
      }
      const c = r.drawPile.pop()
      if (c) r.hand.push(c)
    }
  }

  sortHand(by) {
    if (!this.round) return
    this.round.hand = sortCards(this.round.hand, by)
  }

  // 出牌
  playCards(cardIds) {
    const r = this.round
    if (this.state !== 'round') throw new Error('not in round')
    if (r.handsLeft <= 0) throw new Error('no hands left')
    if (!cardIds.length || cardIds.length > 5) throw new Error('must play 1-5 cards')
    const played = cardIds.map(id => r.hand.find(c => c.id === id))
    if (played.some(c => !c)) throw new Error('card not in hand')

    // Boss 限制
    const bossH = r.boss?.effect?.handler
    if (r.boss && !r.bossDisabled) {
      if (bossH === 'psychic' && played.length !== 5) throw new Error('The Psychic: must play 5 cards')
      const evald = evaluate(played, this.modifiers)
      if (bossH === 'eye' && r.handTypesPlayed.includes(evald.handType)) throw new Error('The Eye: no repeat hand types')
      if (bossH === 'mouth' && r.handTypesPlayed.length && r.handTypesPlayed[0] !== evald.handType) throw new Error('The Mouth: only one hand type')
      if (bossH === 'ox') {
        const most = this.helpers.mostPlayedHand()
        if (most && evald.handType === most) { this.money = 0; r.bossTriggeredThisHand = true }
      }
      if (bossH === 'arm') {
        const lv = this.handLevels[evald.handType] || 1
        this.handLevels[evald.handType] = Math.max(1, lv - 1)
        r.bossTriggeredThisHand = true
      }
      if (bossH === 'tooth') { this.money -= played.length; r.bossTriggeredThisHand = true }
    }

    // 出牌前置阶段（DNA / 第六感 / 太空小丑）
    const preHand = evaluate(played, this.modifiers)
    this.emitJokersPhase('handPlayed', { played, hand: preHand })

    // 计分
    const held = r.hand.filter(c => !cardIds.includes(c.id))
    const result = scoreHand({ run: this, round: r, played, held, helpers: this.helpers, rng: this.rng })
    this.lastScoreEvents = result.events
    r.score += result.total
    this.stats.bestHand = Math.max(this.stats.bestHand || 0, result.total)
    r.handsLeft -= 1
    r.handsPlayedThisRound += 1
    r.handTypesPlayed.push(result.hand.handType)
    r.firstHand = false
    this.stats.handsPlayed[result.hand.handType] = (this.stats.handsPlayed[result.hand.handType] || 0) + 1
    this.stats.handsPlayedTotal += 1
    this.stats.cardsPlayed += played.length
    r.playedThisAnte.push(...played.map(c => c.id))
    r.lastPlayedHandType = result.hand.handType

    // Seltzer 计数
    for (const j of this.jokers) if (j.id === 'j_seltzer' && j.state.handsLeft > 0) j.state.handsLeft -= 1
    // 打出的牌进入弃牌堆
    for (const c of played) {
      if (this.fullDeck.some(x => x.id === c.id)) r.discardPile.push(c) // 未被销毁
    }
    r.hand = held

    // Boss：钩子 —— 出牌后随机弃 2 张
    if (r.boss && !r.bossDisabled && bossH === 'hook') {
      for (const c of this.rng.shuffle([...r.hand]).slice(0, 2)) {
        r.hand = r.hand.filter(x => x.id !== c.id)
        r.discardPile.push(c)
      }
    }
    // Boss：绯红之心 —— 每手换禁用
    if (r.boss && !r.bossDisabled && bossH === 'crimsonHeart') this.crimsonHeartDisable()

    this.drawUp()

    // 胜负判定
    if (r.score >= r.target) this.winRound()
    else if (r.handsLeft <= 0) this.loseRound()
    return result
  }

  // 弃牌
  discardCards(cardIds) {
    const r = this.round
    if (this.state !== 'round') throw new Error('not in round')
    if (r.discardsLeft <= 0) throw new Error('no discards left')
    if (!cardIds.length || cardIds.length > 5) throw new Error('must discard 1-5 cards')
    const discarded = cardIds.map(id => r.hand.find(c => c.id === id))
    if (discarded.some(c => !c)) throw new Error('card not in hand')

    // 紫色蜡封：弃掉生成塔罗
    for (const c of discarded) if (c.seal === 'purple') this.helpers.createTarot()

    // Hit the Road 成长
    for (const j of this.jokers) {
      if (j.id === 'j_hit_the_road') {
        const n = discarded.filter(c => c.rank === 11).length
        if (n) j.state.xMult = Math.round(((j.state.xMult || 1) + n * 0.5) * 100) / 100
      }
      if (j.id === 'j_yorick') {
        j.state.count = (j.state.count || 0) + discarded.length
        while (j.state.count >= 23) { j.state.count -= 23; j.state.xMult = (j.state.xMult || 1) + 1 }
      }
    }
    this.stats.cardsDiscarded += discarded.length

    // 小丑：discard 阶段（含 firstDiscard 判定）
    this.emitJokersPhase('discard', { discarded })
    r.firstDiscard = false

    for (const c of discarded) {
      r.hand = r.hand.filter(x => x.id !== c.id)
      if (this.fullDeck.some(x => x.id === c.id)) r.discardPile.push(c)
    }
    r.discardsLeft -= 1
    r.discardsUsed += 1
    this.drawUp()
  }

  // ================= 回合结算 =================
  winRound() {
    const r = this.round
    const blind = this.currentBlindDef()
    const breakdown = { reward: blind.reward || 0, handsBonus: 0, discardsBonus: 0, interest: 0, jokerEconomy: 0 }

    // 蓝蜡封：回合结束在手 → 最后打出牌型的星球
    if (r.lastPlayedHandType) {
      const planet = HANDS.find(h => h.id === r.lastPlayedHandType)?.planet
      if (planet) for (const c of r.hand) if (c.seal === 'blue' && !c.debuffed) this.createConsumable(planet)
    }
    // 黄金牌：在手 +$3
    for (const c of r.hand) if (c.enhancement === 'gold' && !c.debuffed) { this.money += 3; breakdown.jokerEconomy += 3 }

    if (this.greenEconomy) {
      breakdown.handsBonus = r.handsLeft * 2
      breakdown.discardsBonus = r.discardsLeft
    } else {
      breakdown.handsBonus = r.handsLeft
      breakdown.interest = Shop.interestFor(this)
    }
    this.money += breakdown.reward + breakdown.handsBonus + breakdown.discardsBonus + breakdown.interest

    const moneyBefore = this.money
    this.emitJokersPhase('roundEnd')
    breakdown.jokerEconomy += this.money - moneyBefore

    this.stats.discardsUnused += r.discardsLeft
    this.stats.roundsWon += 1
    this.stats.moneyEarned = (this.stats.moneyEarned || 0) +
      breakdown.reward + breakdown.handsBonus + breakdown.discardsBonus + breakdown.interest + breakdown.jokerEconomy
    this.lastCashout = breakdown

    const wasBoss = this.blindIndex === 2
    if (wasBoss) {
      this.emitJokersPhase('blindDefeated', { blindType: 'boss' })
      if (this.anaglyph) this.addTag('tag_double')
      if (this.tagQueue.investment) { this.money += this.tagQueue.investment; this.tagQueue.investment = 0 }
    }

    // 清理回合 debuff（花色/人头牌/翠绿叶子等 Boss 削弱）
    if (r.boss && ['debuffSuit', 'plant', 'verdantLeaf'].includes(r.boss.effect?.handler)) {
      for (const c of this.fullDeck) c.debuffed = false
    }
    for (const j of this.jokers) if (r.boss?.effect?.handler === 'crimsonHeart') j.debuffed = false
    this.tagQueue.juggleHandSize = 0

    // 胜利判定：Ante 8 Boss
    if (wasBoss && this.ante === 8) {
      this.state = 'victory'
      return
    }
    this.enterShop()
  }

  loseRound() {
    const r = this.round
    // 骨头先生：得分 ≥ 25% 目标免死（自毁）
    const bones = this.jokers.find(j => j.id === 'j_mr_bones' && !j.debuffed)
    if (bones && r.score >= Math.ceil(r.target * 0.25)) {
      this.helpers.destroyJoker(bones.uid)
      this.log.push({ type: 'mrBones' })
      this.winRound() // FIDELITY: 原作免死后按未获奖励进入下一阶段，此处按正常获胜结算
      return
    }
    this.state = 'runOver'
  }

  advanceBlind() {
    if (this.blindIndex < 2) this.blindIndex += 1
    else {
      this.blindIndex = 0
      this.ante += 1
      this.rollBoss()
      // 新 Ante 重置柱子记录
      if (this.round) this.round.playedThisAnte = []
    }
    this.state = 'blindSelect'
  }

  // ================= 商店 =================
  enterShop() {
    this.shop = Shop.generateShop(this, this.rng)
    this.state = 'shop'
    this.emitJokersPhase('shopStart')
  }

  canPay(price) {
    const creditLimit = this.modifiers.creditCard ? -20 : 0
    return this.money - price >= creditLimit
  }

  buyShopItem(slotIndex) {
    if (this.state !== 'shop') throw new Error('not in shop')
    const item = this.shop.cards[slotIndex]
    if (!item) throw new Error('empty slot')
    const price = this.shop.coupon ? 0 : Shop.itemPrice(this, item)
    if (!this.canPay(price)) throw new Error('not enough money')
    if (item.kind === 'joker' && this.jokers.length >= this.jokerSlotCount()) throw new Error('no joker slot')
    if ((item.kind === 'tarot' || item.kind === 'planet' || item.kind === 'spectral') && this.consumables.length >= this.consumableSlotCount()) throw new Error('no consumable slot')
    this.money -= price
    if (item.kind === 'joker') this.createJoker({ id: item.id, edition: item.edition })
    else if (item.kind === 'playing') { this.fullDeck.push(item.card); this.emitJokersPhase('cardAdded', { card: item.card }) }
    else this.createConsumable(item.id)
    this.shop.cards.splice(slotIndex, 1)
    return item
  }

  rerollShop() {
    if (this.state !== 'shop') throw new Error('not in shop')
    let cost = this.shop.rerollCost
    if (this.modifiers.freeReroll && !this.shop.freeRerollUsed) {
      this.shop.freeRerollUsed = true
      cost = 0
    }
    if (!this.canPay(cost)) throw new Error('not enough money')
    this.money -= cost
    this.shop.rerollCost += 1
    this.stats.rerolls += 1
    this.emitJokersPhase('reroll')
    const n = Shop.shopSlotCount(this)
    this.shop.cards = []
    for (let i = 0; i < n; i++) this.shop.cards.push(Shop.rollShopCard(this, this.rng))
  }

  buyVoucher(extra = false) {
    if (this.state !== 'shop') throw new Error('not in shop')
    const id = extra ? this.shop.extraVoucher : this.shop.voucher
    if (!id) throw new Error('no voucher')
    const price = this.shop.coupon ? 0 : Shop.priceOf(10, null, this)
    if (!this.canPay(price)) throw new Error('not enough money')
    this.money -= price
    this.applyVoucher(id)
    if (extra) this.shop.extraVoucher = null
    else this.shop.voucher = null
  }

  applyVoucher(id) {
    this.vouchers.push(id)
    const fx = VOUCHERS_BY_ID[id]?.effect || {}
    if (fx.anteDown) this.ante = Math.max(0, this.ante - fx.anteDown)
    this.markDiscovered(id)
  }

  buyPack(slotIndex) {
    if (this.state !== 'shop') throw new Error('not in shop')
    const pack = this.shop.packs[slotIndex]
    if (!pack) throw new Error('empty slot')
    const price = this.shop.coupon ? 0 : Shop.packPrice(this, pack)
    if (!this.canPay(price)) throw new Error('not enough money')
    this.money -= price
    this.shop.packs.splice(slotIndex, 1)
    this.openPack(pack.id, false)
  }

  // ================= 卡包 =================
  openPack(packId, free = false) {
    const def = PACKS_BY_ID[packId]
    if (!def) throw new Error('unknown pack')
    const options = []
    const ownedJokers = new Set(this.jokers.map(j => j.id))
    for (let i = 0; i < def.count; i++) {
      if (def.contents === 'tarot') {
        if (this.vouchers.includes('v_omen_globe') && this.rng.chance(20, 100)) {
          options.push({ kind: 'spectral', id: this.rng.pick(Object.keys(SPECTRAL_BY_ID).filter(x => x !== 's_soul' && x !== 's_black_hole')) })
        } else if (this.rng.chance(3, 1000)) {
          options.push({ kind: 'spectral', id: 's_soul' })
        } else options.push({ kind: 'tarot', id: this.rng.pick(Object.keys(TAROT_BY_ID)) })
      } else if (def.contents === 'planet') {
        if (this.rng.chance(3, 1000)) options.push({ kind: 'spectral', id: 's_black_hole' })
        else options.push({ kind: 'planet', id: this.rng.pick(Object.keys(PLANETS_BY_ID)) })
      } else if (def.contents === 'spectral') {
        if (this.rng.chance(3, 1000)) options.push({ kind: 'spectral', id: 's_soul' })
        else options.push({ kind: 'spectral', id: this.rng.pick(Object.keys(SPECTRAL_BY_ID).filter(x => x !== 's_soul' && x !== 's_black_hole')) })
      } else if (def.contents === 'playing') {
        const card = makeCard(this.rng.int(2, 14), this.rng.pick(SUITS))
        if (this.rng.chance(40, 100)) card.enhancement = this.rng.pick(['bonus', 'mult', 'wild', 'glass', 'steel', 'stone', 'gold', 'lucky'])
        if (this.rng.chance(20, 100)) card.seal = this.rng.pick(['red', 'blue', 'purple', 'gold'])
        const hone = this.vouchers.includes('v_glow_up') ? 2 : this.vouchers.includes('v_hone') ? 1 : 0
        const chances = hone === 2 ? { foil: 0.16, holo: 0.112, poly: 0.048 } : hone === 1 ? { foil: 0.08, holo: 0.056, poly: 0.024 } : { foil: 0.04, holo: 0.028, poly: 0.012 }
        const roll = this.rng.next()
        let acc = 0
        for (const [ed, p] of Object.entries(chances)) { acc += p; if (roll < acc) { card.edition = ed; break } }
        options.push({ kind: 'playing', card })
      } else if (def.contents === 'joker') {
        const item = Shop.generateJoker(this, this.rng, {})
        if (!this.modifiers.showman && ownedJokers.has(item.id)) item.id = Shop.generateJoker(this, this.rng, {}).id
        options.push({ kind: 'joker', id: item.id, edition: item.edition })
      }
    }
    // 望远镜：必含最常打出牌型的星球
    if (def.contents === 'planet' && this.vouchers.includes('v_telescope')) {
      const most = this.helpers.mostPlayedHand()
      const planet = most && HANDS.find(h => h.id === most)?.planet
      if (planet && !options.some(o => o.id === planet)) options[0] = { kind: 'planet', id: planet }
    }
    this.packState = { packId, def, options, choose: def.choose, picked: [] }
    this.state = 'pack'
    this.emitJokersPhase('packOpened', { packType: def.packType })
    void free
  }

  pickPackCards(indices) {
    if (this.state !== 'pack') throw new Error('not in pack')
    const ps = this.packState
    if (indices.length > ps.choose) throw new Error('too many picks')
    for (const i of indices) {
      const opt = ps.options[i]
      if (!opt || ps.picked.includes(i)) continue
      if (opt.kind === 'joker') {
        if (this.jokers.length >= this.jokerSlotCount()) throw new Error('no joker slot')
        this.createJoker({ id: opt.id, edition: opt.edition })
      } else if (opt.kind === 'playing') {
        this.fullDeck.push(opt.card)
        this.emitJokersPhase('cardAdded', { card: opt.card })
      } else {
        if (this.consumables.length >= this.consumableSlotCount()) throw new Error('no consumable slot')
        this.createConsumable(opt.id)
      }
      ps.picked.push(i)
    }
    if (ps.picked.length >= ps.choose) this.closePack()
  }

  skipPack() {
    if (this.state !== 'pack') throw new Error('not in pack')
    this.stats.packsSkipped += 1
    // 红牌成长
    for (const j of this.jokers) if (j.id === 'j_red_card') j.state.mult = (j.state.mult || 0) + 3
    this.closePack()
  }

  closePack() {
    this.packState = null
    // 从标签开的免费包回到盲注选择；商店买的回商店
    this.state = this.shop ? 'shop' : 'blindSelect'
  }

  leaveShop() {
    if (this.state !== 'shop') throw new Error('not in shop')
    this.emitJokersPhase('shopEnd') // Perkeo
    this.shop = null
    if (this.blindIndex === 2) { /* Boss 后进入新 Ante 的小盲 */ }
    this.advanceBlind()
  }

  // ================= 卖出/消耗 =================
  sellJoker(uidToSell) {
    const j = this.jokers.find(x => x.uid === uidToSell)
    if (!j) throw new Error('joker not found')
    // 卖出特效（Luchador/Diet Cola/Invisible）
    const def = JOKERS_BY_ID[j.id]
    const handler = JOKER_HANDLERS[def.effect.handler]
    if (handler) {
      handler({ run: this, round: this.round, phase: 'sell', emit: () => {}, rng: this.rng, joker: j, def, helpers: this.helpers, score: { chips: 0, mult: 0 }, played: [], scored: [], held: [], hand: {} }, def.effect.params || {})
    }
    this.money += this.helpers.sellValue(j)
    this.jokers = this.jokers.filter(x => x.uid !== uidToSell)
    this.stats.jokersSold += 1
    this.stats.cardsSold += 1
    this.emitJokersPhase('cardSold', {})
    // 翠绿叶子：卖出 1 张小丑解除削弱
    if (this.round?.boss?.effect?.handler === 'verdantLeaf' && !this.round.bossDisabled) {
      for (const c of this.fullDeck) c.debuffed = false
    }
  }

  sellConsumable(uidToSell) {
    const c = this.consumables.find(x => x.uid === uidToSell)
    if (!c) throw new Error('consumable not found')
    this.money += this.helpers.sellValue(c)
    this.consumables = this.consumables.filter(x => x.uid !== uidToSell)
    this.stats.cardsSold += 1
    this.emitJokersPhase('cardSold', {})
  }

  useConsumable(uidToUse, targetIds = []) {
    const c = this.consumables.find(x => x.uid === uidToUse)
    if (!c) throw new Error('consumable not found')
    const def = this.defOf(c.id)
    const zone = this.state === 'round' ? this.round.hand : (this.packState?.handZone || this.round?.hand || [])
    if (def.type === 'planet') {
      this.handLevels[def.hand] = (this.handLevels[def.hand] || 1) + 1
      this.stats.lastTarotOrPlanet = def.id
      if (!this.stats.planetsUsedUnique.includes(def.id)) this.stats.planetsUsedUnique.push(def.id)
    } else {
      applyConsumable({ run: this, def, targets: targetIds, zone, helpers: this.helpers, rng: this.rng, emit: e => this.lastScoreEvents.push(e) })
    }
    this.consumables = this.consumables.filter(x => x.uid !== uidToUse)
    this.emitJokersPhase('consumableUsed', { consumableType: def.type, consumableId: def.id })
    this.markDiscovered(def.id)
  }

  reorderJokers(from, to) {
    const arr = this.jokers
    if (from < 0 || from >= arr.length || to < 0 || to >= arr.length) return
    const [j] = arr.splice(from, 1)
    arr.splice(to, 0, j)
  }
}
