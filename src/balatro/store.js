// Balatro Pinia Store（§6 公共 API）
// 引擎为纯 JS 实例（非响应式），store 持有实例并在每次操作后同步响应式快照
// 持久化：Electron IPC 优先（window.electronAPI.balatroLoad/balatroSave），
// 纯网页预览降级 localStorage（键 balatro:state）；防抖 500ms 自动保存

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { BalatroRun } from './engine/run.js'
import { sortCards } from './engine/deck.js'
import { evaluate } from './engine/evaluate.js'
import * as Shop from './engine/shop.js'
import { computePlayRules, recentTags } from './playRules.js'
import { MOD_JOKERS, MOD_JOKERS_BY_ID } from './data/modJokers.js'
import { BY_ID, PACKS_BY_ID, JOKERS, TAROT, PLANETS, SPECTRAL } from './data/index.js'
import { GOLD_REWARDS, SHOP_PACK_PRICES, PACK_DUPLICATE_WEIGHT, drawWithDuplicateWeight, sellValueOfJoker, sellValueOfPlaying, rollFragment, fragmentSellValue } from './data/economy.js'
import { gatedByPacks } from './data/packGating.js'

const STORAGE_KEY = 'balatro:state'

function hasElectron() {
  return typeof window !== 'undefined' && !!window.electronAPI?.balatroLoad
}

async function persistLoad() {
  try {
    if (hasElectron()) {
      const raw = await window.electronAPI.balatroLoad()
      return raw ? JSON.parse(raw) : null
    }
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_KEY)
      return raw ? JSON.parse(raw) : null
    }
  } catch (err) {
    console.warn('[Balatro] 读档失败:', err)
  }
  return null
}

async function persistSave(state, base) {
  try {
    if (hasElectron()) {
      const saved = await window.electronAPI.balatroSave(JSON.stringify({ state, base }))
      if (saved === false) return null
      return typeof saved === 'string' ? JSON.parse(saved) : state
    }
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    return state
  } catch (err) {
    console.warn('[Balatro] 存档失败:', err)
    return null
  }
}

function serialize(data) {
  return JSON.parse(JSON.stringify(data))
}

let saveTimer = null

export const useBalatroStore = defineStore('balatro', () => {
  // ---- state ----
  const screen = ref('menu') // 'menu'|'deckSelect'|'blind'|'round'|'shop'|'pack'|'runEnd'|'collection'
  const run = ref(null) // 当前 run 响应式快照
  const collection = ref({ discovered: [], ownedCards: [] }) // 图鉴发现进度 + 已持有卡（§11）
  const settings = ref({ volume: 0.5, muted: false, animations: true })
  const scoreEvents = ref([]) // 最近一次计分事件流（RoundScore 播放）
  const selectedCardIds = ref([])
  const lastCashout = ref(null)
  const loaded = ref(false)
  const productivity = ref({ count: 0, pendingMoney: 0, pendingPacks: [], streak: 0 })
  // 纯金币经济（收藏模式）：gold 金币余额；packsOpened 累计开包数（卡池梯度依据）
  const economy = ref({ gold: 0, packsOpened: 0 })

  let engine = null // BalatroRun 实例（非响应式）
  let persistedBase = null

  // ---- 快照同步 + 防抖存档 ----
  function sync() {
    if (engine) {
      run.value = serialize(engine.serialize())
      // 注入派生栏位（UI 只读展示，不参与引擎逻辑）
      run.value.meta = {
        jokerSlots: engine.jokerSlotCount(),
        consumableSlots: engine.consumableSlotCount(),
        handSize: engine.handSizeTotal(),
        handsTotal: engine.handsTotal(),
        discardsTotal: engine.discardsTotal(),
        shopSlots: engine.shop ? Shop.shopSlotCount(engine) : 2,
        playRules: computePlayRules(engine.round),
        recentTags: recentTags(engine.log, 3),
      }
      // 注入商店价格（定价规则归引擎，UI 不重算）
      if (engine.shop && run.value.shop) {
        const coupon = !!run.value.shop.coupon
        for (const item of run.value.shop.cards) item.price = coupon ? 0 : Shop.itemPrice(engine, item)
        for (const p of run.value.shop.packs) p.price = coupon ? 0 : Shop.packPrice(engine, p)
        run.value.shop.voucherPrice = coupon ? 0 : Shop.priceOf(10, null, engine)
      }
      // 图鉴「见过即发现」（§1）：商店陈列与卡包选项进入发现集
      if (run.value.shop) {
        for (const item of run.value.shop.cards) if (item.kind !== 'playing') discover(item.id)
        for (const p of run.value.shop.packs) discover(p.id)
        if (run.value.shop.voucher) discover(run.value.shop.voucher)
        if (run.value.shop.extraVoucher) discover(run.value.shop.extraVoucher)
      }
      if (run.value.packState) {
        for (const o of run.value.packState.options) if (o.id) discover(o.id)
      }
      scoreEvents.value = serialize(engine.lastScoreEvents || [])
      lastCashout.value = engine.lastCashout ? serialize(engine.lastCashout) : null
      selectedCardIds.value = selectedCardIds.value.filter(id =>
        engine.round?.hand?.some(c => c.id === id))
      // 同步 screen
      if (engine.state === 'blindSelect') screen.value = 'blind'
      else if (engine.state === 'round') screen.value = 'round'
      else if (engine.state === 'shop') screen.value = 'shop'
      else if (engine.state === 'pack') screen.value = 'pack'
      else if (engine.state === 'runOver' || engine.state === 'victory') screen.value = 'runEnd'
    } else {
      run.value = null
    }
    scheduleSave()
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(saveNow, 500)
  }

  async function saveNow() {
    // §19：存档未加载完成前禁止落盘（防止空状态整体覆盖磁盘上的真实存档）
    if (!loaded.value) return
    const state = {
      version: 1,
      savedAt: new Date().toISOString(),
      run: engine ? engine.serialize() : null,
      collection: collection.value,
      settings: settings.value,
      productivity: productivity.value,
      economy: economy.value,
    }
    const saved = await persistSave(state, persistedBase)
    if (saved) {
      persistedBase = serialize(saved)
      collection.value = { ...collection.value, ...(saved.collection || {}) }
      settings.value = { ...settings.value, ...(saved.settings || {}) }
      productivity.value = { ...productivity.value, ...(saved.productivity || {}) }
      economy.value = { ...economy.value, ...(saved.economy || {}) }
    }
  }

  async function init() {
    if (loaded.value) return
    const saved = await persistLoad()
    if (saved) {
      persistedBase = serialize(saved)
      const savedCollection = saved.collection && typeof saved.collection === 'object' ? saved.collection : {}
      collection.value = {
        ...savedCollection,
        discovered: Array.isArray(savedCollection.discovered) ? savedCollection.discovered : [],
        ownedCards: Array.isArray(savedCollection.ownedCards) ? savedCollection.ownedCards : [],
      }
      settings.value = { ...settings.value, ...(saved.settings || {}) }
      productivity.value = { ...productivity.value, ...(saved.productivity || {}) }
      // 经济字段迁移（幂等）：旧档无 economy → 0 金币 0 开包；gold 兜底非负
      const ec = { gold: 0, packsOpened: 0, ...(saved.economy || {}) }
      ec.gold = Math.max(0, Math.floor(Number(ec.gold) || 0))
      ec.packsOpened = Math.max(0, Math.floor(Number(ec.packsOpened) || 0))
      economy.value = ec
      if (saved.run && saved.run.state !== 'runOver' && saved.run.state !== 'victory') {
        try {
          engine = BalatroRun.deserialize(saved.run)
          patchDiscovery()
        } catch (err) {
          engine = null
          console.warn('[Balatro] 牌局恢复失败，已保留收藏并放弃损坏牌局:', err)
        }
      }
    }
    loaded.value = true
    sync()
  }

  // 图鉴发现：引擎内所有持有物标记为已发现
  function patchDiscovery() {
    if (!engine) return
    const disc = new Set(collection.value.discovered)
    for (const j of engine.jokers) disc.add(j.id)
    for (const c of engine.consumables) disc.add(c.id)
    for (const v of engine.vouchers) disc.add(v)
    collection.value.discovered = [...disc]
  }

  function discover(id) {
    if (!collection.value.discovered.includes(id)) {
      collection.value.discovered.push(id)
    }
  }

  // 扑克收藏键：pc_花色_点数（52 格图鉴点亮用）
  function playingKey(card) {
    return `pc_${card.suit}_${card.rank}`
  }

  // ---- actions（§6 公共 API） ----
  function newRun(deckId) {
    engine = new BalatroRun({ deckId, seed: `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` })
    engine.markDiscovered = discover
    selectedCardIds.value = []
    patchDiscovery()
    sync()
  }

  function continueRun() {
    return !!engine
  }

  function abandonRun() {
    engine = null
    run.value = null
    selectedCardIds.value = []
    screen.value = 'menu'
    scheduleSave()
  }

  function selectBlind() {
    engine.selectBlind()
    selectedCardIds.value = []
    patchDiscovery()
    sync()
  }

  function skipBlind() {
    engine.skipBlind()
    patchDiscovery()
    sync()
  }

  function toggleCardSelect(cardId) {
    const idx = selectedCardIds.value.indexOf(cardId)
    if (idx >= 0) selectedCardIds.value.splice(idx, 1)
    else if (selectedCardIds.value.length < 5) selectedCardIds.value.push(cardId)
  }

  function sortHand(by = 'rank') {
    if (!engine?.round) return
    engine.round.hand = sortCards(engine.round.hand, by)
    sync()
  }

  function playSelected() {
    if (!selectedCardIds.value.length) return null
    const result = engine.playCards([...selectedCardIds.value])
    selectedCardIds.value = []
    patchDiscovery()
    sync()
    return result
  }

  function discardSelected() {
    if (!selectedCardIds.value.length) return
    engine.discardCards([...selectedCardIds.value])
    selectedCardIds.value = []
    sync()
  }

  function buyShopItem(slotIndex) {
    const item = engine.buyShopItem(slotIndex)
    patchDiscovery()
    sync()
    return item
  }

  function rerollShop() {
    engine.rerollShop()
    sync()
  }

  function buyVoucher(extra = false) {
    engine.buyVoucher(extra)
    patchDiscovery()
    sync()
  }

  // type: 'joker' | 'consumable'；index 为数组下标
  function sellCard(type, index) {
    if (type === 'joker') {
      const j = engine.jokers[index]
      if (j) engine.sellJoker(j.uid)
    } else {
      const c = engine.consumables[index]
      if (c) engine.sellConsumable(c.uid)
    }
    sync()
  }

  function buyPack(slotIndex) {
    engine.buyPack(slotIndex)
    patchDiscovery()
    sync()
  }

  function openPack(packId) {
    engine.openPack(packId)
    patchDiscovery()
    sync()
  }

  function pickPackCards(indices) {
    engine.pickPackCards(indices)
    patchDiscovery()
    sync()
  }

  function skipPack() {
    engine.skipPack()
    sync()
  }

  function useConsumable(index, targets = []) {
    const c = engine.consumables[index]
    if (!c) throw new Error('consumable not found')
    engine.useConsumable(c.uid, targets)
    selectedCardIds.value = []
    patchDiscovery()
    sync()
  }

  function sellConsumable(index) {
    sellCard('consumable', index)
  }

  function reorderJokers(from, to) {
    engine.reorderJokers(from, to)
    sync()
  }

  // 选中牌的牌型预览（UI 用于 Boss 约束提示；判定本身仍是引擎 evaluate）
  function evaluateSelection(cardIds) {
    if (!engine?.round || !cardIds?.length) return null
    const cards = cardIds.map(id => engine.round.hand.find(c => c.id === id)).filter(Boolean)
    if (cards.length !== cardIds.length) return null
    try {
      return evaluate(cards, engine.modifiers).handType
    } catch {
      return null
    }
  }

  // 领取生产力奖励的待开卡包（§7）：在盲注选择/商店阶段免费开包
  function claimPendingPack() {
    if (!engine || !productivity.value.pendingPacks.length) return false
    if (engine.state !== 'blindSelect' && engine.state !== 'shop') return false
    const id = productivity.value.pendingPacks.shift()
    engine.openPack(id, true)
    patchDiscovery()
    sync()
    return true
  }

  function leaveShop() {
    engine.leaveShop()
    patchDiscovery()
    sync()
  }

  // ---- 与生产力系统联动（§7，integration.js 于 Phase 4 挂接；§11 起只发卡包不再发钱） ----
  function grantProductivityReward(payload = {}) {
    productivity.value.count += 1
    const n = productivity.value.count
    if (n % 10 === 0) productivity.value.pendingPacks.push('pack_buffoon_normal')
    if (payload.streak >= 7 && !productivity.value.streakRewardClaimed) {
      productivity.value.pendingPacks.push('pack_celestial_normal')
      productivity.value.streakRewardClaimed = true
    }
    // 纯金币经济：按来源发金币（打卡 2 / 每日任务 3 / 项目任务 5）
    const gold = GOLD_REWARDS[payload.source] || 0
    if (gold > 0) economy.value.gold += gold
    scheduleSave()
  }

  // ---- 收藏模式独立开包（§11：无需 Run，卡包即开即收） ----
  // collectionPack 快照形状与引擎 packState 一致：{ packId, def, options, choose, picked }
  const collectionPack = ref(null)

  function openCollectionPack() {
    if (collectionPack.value || !productivity.value.pendingPacks.length) return false
    const packId = productivity.value.pendingPacks.shift()
    try {
      // 一次性引擎实例：版本/稀有度概率全部走引擎官方档位（Shop.generateJoker 等）
      const tmp = new BalatroRun({
        deckId: 'deck_red',
        seed: `col_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      })
      tmp.openPack(packId, true)
      const ps = tmp.packState
      if (!ps) throw new Error('pack did not open')
      // §12 Mod 混入：小丑包每个选项 25% 概率替换为社区 Mod 致敬小丑
      // 仅收藏模式（本函数）；Run 卡池/引擎计分完全不受影响（引擎不认识 mj_* id 也永远不会收到）
      // §15 CDP 测试钩子：hash 含 __force_mod=mj_xxx 时混入必出该 mod 卡（视觉证据确定性驱动用）
      const forceModId = (typeof location !== 'undefined' && location.hash.match(/__force_mod=(\w+)/))?.[1]
      const forced = forceModId ? MOD_JOKERS_BY_ID[forceModId] : null
      // 卡池梯度：Mod 混入池同样剔除未达标的稀有/核心卡（强制钩子除外）
      const opened = economy.value.packsOpened
      const modPool = MOD_JOKERS.filter(mj => !gatedByPacks(mj.id, mj, opened))
      // §19 出率调优：已拥有卡重复权重（塔罗/星球 ×3，小丑/幻灵 ×1.5）
      // 仅替换官方 id 选项（版本沿用引擎 roll 值）；Mod 混入在之后执行不受干扰；__force_mod 豁免
      if (!forced) {
        const w = PACK_DUPLICATE_WEIGHT[ps.def?.contents]
        const pools = {
          tarot: TAROT, planet: PLANETS, spectral: SPECTRAL,
          joker: JOKERS.filter(d => d.rarity < 4 && !gatedByPacks(d.id, d, opened)),
        }
        const pool = w ? pools[ps.def.contents] : null
        if (pool?.length) {
          const ownedIds = new Set((collection.value.ownedCards || []).filter(x => !x.fragment).map(x => x.id).filter(Boolean))
          const seenInPack = new Set()
          for (let i = 0; i < ps.options.length; i++) {
            const opt = ps.options[i]
            if (!opt?.id || opt.id.startsWith('mj_')) continue
            let id = null
            for (let k = 0; k < 8; k++) { // 包内尽量不重复（重抽上限后放行）
              id = drawWithDuplicateWeight(pool, ownedIds, w)
              if (!id || !seenInPack.has(id)) break
            }
            if (id) { ps.options[i] = { ...opt, id }; seenInPack.add(id) }
          }
        }
      }
      if (ps.def.contents === 'joker') {
        for (let i = 0; i < ps.options.length; i++) {
          const opt = ps.options[i]
          if (opt?.kind === 'joker' && (forced || Math.random() < 0.25)) {
            const mj = forced || modPool[Math.floor(Math.random() * modPool.length)]
            if (mj) ps.options[i] = { ...opt, id: mj.id } // edition 保留引擎官方 roll 出的版本
          }
        }
        // 卡池梯度（仅收藏模式）：稀有(≥10 包)/核心(≥20 包)未达标不进开包池，有界重 roll 替换
        for (let i = 0; i < ps.options.length; i++) {
          const opt = ps.options[i]
          if (opt?.kind !== 'joker' || !opt.id) continue
          if (forced && opt.id === forced.id) continue // 测试钩子强制卡不受梯度限制
          const d0 = BY_ID[opt.id]
          if (!d0 || !gatedByPacks(opt.id, d0, opened)) continue
          for (let k = 0; k < 20; k++) {
            const item = Shop.generateJoker(tmp, tmp.rng, {})
            const d1 = BY_ID[item.id]
            if (d1 && !gatedByPacks(item.id, d1, opened)) {
              ps.options[i] = { ...opt, id: item.id, edition: item.edition }
              break
            }
          }
        }
      }
      // §21 碎片 roll：每张选项独立 40% 成为半张碎片（__force_mod 测试钩子豁免）
      // 收下时随选项带入 ownedCards；碎片不点亮图鉴（合成整卡时才点亮）
      for (const opt of ps.options) opt.fragment = forced ? false : rollFragment()
      collectionPack.value = serialize({
        packId, def: ps.def, options: ps.options, choose: ps.choose, picked: [],
        // §16② 首开标记：本包中首次进入图鉴的 id（NEW 徽章用；跳过即作废，收下才入 newIds）
        // §21 碎片不点亮相应不入首开标记
        firstNew: ps.options.filter(o => o.id && !o.fragment && !collection.value.discovered.includes(o.id)).map(o => o.id),
      })
      // 「见过即发现」：所有选项即刻点亮图鉴（扑克按 pc_花色_点数 键点亮）
      // §21 碎片除外：碎片只是半张卡，合成整卡时才点亮
      for (const o of ps.options) {
        if (o.fragment) continue
        if (o.id) discover(o.id)
        else if (o.kind === 'playing' && o.card) discover(playingKey(o.card))
      }
    } catch (err) {
      console.warn('[Balatro] 收藏开包失败:', err)
      productivity.value.pendingPacks.unshift(packId) // 失败返还卡包
      collectionPack.value = null
      scheduleSave()
      return false
    }
    scheduleSave()
    return true
  }

  // §16① 取消强制选卡：开包全部收入收藏（「全部收下」唯一入口）
  // 每个带 id 选项都进 ownedCards（版本沿用开包 roll），首开 id 入 newIds（NEW 徽章）
  // 扑克选项（标准包）同样入藏：{ kind:'playing', rank, suit, enhancement, seal, edition }
  function collectAllPackCards() {
    const ps = collectionPack.value
    if (!ps) return false
    const now = new Date().toISOString()
    if (!Array.isArray(collection.value.ownedCards)) collection.value.ownedCards = []
    if (!Array.isArray(collection.value.newIds)) collection.value.newIds = []
    const firstNew = new Set(ps.firstNew || [])
    let collected = 0
    for (const opt of ps.options) {
      if (!opt.id && opt.kind === 'playing' && opt.card) {
        // 扑克入收藏（增强/蜡封/版本变体完整保留；§21 碎片标记随选项带入）
        const c = opt.card
        collection.value.ownedCards.push({
          kind: 'playing', rank: c.rank, suit: c.suit,
          enhancement: c.enhancement || null, seal: c.seal || null, edition: c.edition || null,
          ...(opt.fragment ? { fragment: true } : {}),
          obtainedAt: now,
        })
        if (!opt.fragment) discover(playingKey(c))
        collected++
        continue
      }
      if (!opt.id) continue
      collection.value.ownedCards.push({
        id: opt.id, edition: opt.edition || null,
        ...(opt.fragment ? { fragment: true } : {}),
        obtainedAt: now,
      })
      if (!opt.fragment) {
        discover(opt.id)
        if (firstNew.has(opt.id) && !collection.value.newIds.includes(opt.id)) {
          collection.value.newIds.push(opt.id)
        }
      }
      collected++
    }
    if (collected > 0) economy.value.packsOpened += 1 // 累计开包（卡池梯度依据）
    collectionPack.value = null
    scheduleSave()
    return collected > 0
  }

  // §16② NEW 徽章已读：3D 细看打开即清除该卡 new 标记
  function markCollectionSeen(id) {
    const arr = collection.value.newIds
    if (!Array.isArray(arr) || !arr.length) return
    const i = arr.indexOf(id)
    if (i >= 0) { arr.splice(i, 1); scheduleSave() }
  }
  function markAllCollectionSeen() {
    if (!Array.isArray(collection.value.newIds) || !collection.value.newIds.length) return
    collection.value.newIds = []
    scheduleSave()
  }

  function skipCollectionPack() {
    if (!collectionPack.value) return
    collectionPack.value = null
    scheduleSave()
  }

  // ---- 纯金币经济：商店购买 / 重复卡出售 ----
  // 商店购买卡包：扣金币 → 入待开队列；返回 { ok, reason?, price }
  function buyShopPack(packId) {
    const def = PACKS_BY_ID[packId]
    if (!def) return { ok: false, reason: 'unknown' }
    const price = SHOP_PACK_PRICES[def.size] ?? SHOP_PACK_PRICES.normal
    if (economy.value.gold < price) return { ok: false, reason: 'gold', price }
    economy.value.gold -= price
    productivity.value.pendingPacks.push(packId)
    scheduleSave()
    return { ok: true, price }
  }

  // 收藏条目去重键：扑克 = 花色+点数+增强+蜡封+版本；其余 = id+版本
  function ownedKey(o) {
    if (o?.kind === 'playing') {
      return `playing|${o.suit}|${o.rank}|${o.enhancement || ''}|${o.seal || ''}|${o.edition || ''}`
    }
    return `card|${o?.id}|${o?.edition || ''}`
  }

  // 收藏条目售价（UI 预览与出售共用；0 = 不可售）
  function ownedSellValue(o) {
    if (!o) return 0
    if (o.kind === 'playing') return sellValueOfPlaying(o)
    return sellValueOfJoker(BY_ID[o.id], o.edition)
  }

  // 出售重复卡：同去重键 ≥2 才可售（首张保护）；点亮（discovered）不受影响
  // §21 碎片规则：碎片不计整卡保有量；单张碎片可半价售（最低 1，免确认）；
  //   同变体碎片 ≥2 时不提供单卖（引导合成）
  function sellOwnedCard(index) {
    const arr = collection.value.ownedCards
    if (!Array.isArray(arr) || index < 0 || index >= arr.length) return { ok: false, reason: 'range' }
    const o = arr[index]
    const key = ownedKey(o)
    if (o.fragment) {
      const frags = arr.filter(x => x.fragment && ownedKey(x) === key).length
      if (frags >= 2) return { ok: false, reason: 'combine' }
      const value = fragmentSellValue(ownedSellValue(o))
      arr.splice(index, 1)
      economy.value.gold += value
      scheduleSave()
      return { ok: true, value }
    }
    const same = arr.filter(x => !x.fragment && ownedKey(x) === key).length
    if (same < 2) return { ok: false, reason: 'last' }
    const value = ownedSellValue(o)
    if (value <= 0) return { ok: false, reason: 'value' }
    arr.splice(index, 1)
    economy.value.gold += value
    scheduleSave()
    return { ok: true, value }
  }

  // §21 合成：同去重键的两张碎片 → 一张整卡（保留版本/变体；免费；合成即点亮）
  function combineFragments(key) {
    const arr = collection.value.ownedCards || []
    const frags = arr.filter(x => x.fragment && ownedKey(x) === key)
    if (frags.length < 2) return { ok: false, reason: 'fragments', have: frags.length }
    let removed = 0
    collection.value.ownedCards = arr.filter(x => {
      if (removed < 2 && x.fragment && ownedKey(x) === key) { removed++; return false }
      return true
    })
    const p = frags[0]
    const now = new Date().toISOString()
    if (p.kind === 'playing') {
      collection.value.ownedCards.push({
        kind: 'playing', rank: p.rank, suit: p.suit,
        enhancement: p.enhancement || null, seal: p.seal || null, edition: p.edition || null,
        obtainedAt: now,
      })
      discover(playingKey(p))
    } else {
      collection.value.ownedCards.push({ id: p.id, edition: p.edition || null, obtainedAt: now })
      discover(p.id)
    }
    scheduleSave()
    return { ok: true }
  }

  // 一键卖出重复：match 范围内同去重键各留 1 张，其余全部卖出
  // §21 碎片不参与一键卖出（只动整卡重复）
  // duplicateOwnedInfo 为预览（按钮文案/确认框），sellDuplicateOwned 为执行
  function duplicateOwnedInfo(match) {
    const arr = collection.value.ownedCards || []
    const seen = new Set()
    let sold = 0, gold = 0
    for (const o of arr) {
      if (o.fragment || !match(o)) continue
      const k = ownedKey(o)
      if (seen.has(k)) { sold++; gold += ownedSellValue(o) }
      else seen.add(k)
    }
    return { sold, gold }
  }
  function sellDuplicateOwned(match) {
    const arr = collection.value.ownedCards || []
    const seen = new Set()
    const sellIdx = []
    let gold = 0
    for (let i = 0; i < arr.length; i++) {
      const o = arr[i]
      if (o.fragment || !match(o)) continue
      const k = ownedKey(o)
      if (seen.has(k)) { sellIdx.push(i); gold += ownedSellValue(o) }
      else seen.add(k)
    }
    if (!sellIdx.length) return { sold: 0, gold: 0 }
    const drop = new Set(sellIdx)
    collection.value.ownedCards = arr.filter((_, i) => !drop.has(i))
    economy.value.gold += gold
    scheduleSave()
    return { sold: sellIdx.length, gold }
  }

  const hasRun = computed(() => !!run.value)
  const discoveredCount = computed(() => collection.value.discovered.length)

  return {
    // state
    screen, run, collection, settings, scoreEvents, selectedCardIds, lastCashout, loaded, productivity,
    hasRun, discoveredCount, collectionPack, economy,
    // lifecycle
    init, saveNow,
    // actions
    newRun, continueRun, abandonRun,
    selectBlind, skipBlind,
    toggleCardSelect, sortHand, playSelected, discardSelected,
    buyShopItem, rerollShop, buyVoucher, sellCard, buyPack,
    openPack, pickPackCards, skipPack, leaveShop,
    useConsumable, sellConsumable, reorderJokers,
    evaluateSelection, claimPendingPack,
    grantProductivityReward,
    openCollectionPack, collectAllPackCards, skipCollectionPack,
    markCollectionSeen, markAllCollectionSeen,
    buyShopPack, sellOwnedCard, ownedSellValue, playingKey,
    duplicateOwnedInfo, sellDuplicateOwned,
    combineFragments, ownedKey,
  }
})
