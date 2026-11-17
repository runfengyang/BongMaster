/**
 * expeditionStore.js — Phase E3：远征模式的 Pinia 桥接层。
 *
 * 与旧 store.js（单机局）完全平行、互不依赖：
 *   - 引擎 Expedition 实例为非响应式，UI 只读 sync() 产出的浅快照；
 *   - 持久化走 balatro_state 表，键名 'expedition:run'（引擎序列化）、
 *     'expedition:meta'（生涯战绩）、'expedition:report'（待播每日战报）；
 *     IPC 不可用时降级 localStorage；反序列化异常静默降级为空局（契约 §7）。
 *
 * E3 阶段的行动事件由 UI 喂入（模拟或真实挂钩均可），store 只负责：
 * 调引擎 → 落盘 → 发快照。战斗计分一律在引擎内完成，UI 永不重算。
 */

import { defineStore } from 'pinia'
import { Expedition } from './engine/expedition/stateMachine.js'
import { EXPEDITION_THEMES, EXPEDITION_BOSSES_BY_ID } from './data/expedition/bosses.js'
import { MAX_PULLS_PER_DAY, DAYS_PER_RUN, MAX_PRESSURE } from './engine/expedition/balance.js'
import {
  openInRunPack, applyPackPicks, skipInRunPack,
  generateExpeditionShop, buyShopOffer, rerollExpeditionShop, canShop,
} from './engine/expedition/economy.js'
import { useConsumable } from './engine/expedition/consumables.js'
import { jokerSlotCountOf, consumableSlotCountOf } from './engine/expedition/adapter.js'

const RUN_KEY = 'expedition:run'
const META_KEY = 'expedition:meta'
const REPORT_KEY = 'expedition:report'
const LS_PREFIX = 'balatro_expedition_'

/* ---------------- 持久化（沿用 store.js 的 IPC → localStorage 降级） ---------------- */

function hasIPC () {
  return typeof window !== 'undefined' && window.electronAPI &&
    typeof window.electronAPI.balatroLoadKey === 'function'
}

async function persistLoad (key) {
  try {
    if (hasIPC()) {
      const raw = await window.electronAPI.balatroLoadKey(key)
      return raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null
    }
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(LS_PREFIX + key)
      return raw ? JSON.parse(raw) : null
    }
  } catch (err) {
    console.warn('[Expedition] 读档失败:', err)
  }
  return null
}

async function persistSave (key, value) {
  const raw = JSON.stringify(value)
  try {
    if (hasIPC()) return await window.electronAPI.balatroSaveKey(key, raw)
    if (typeof localStorage !== 'undefined') localStorage.setItem(LS_PREFIX + key, raw)
  } catch (err) {
    console.warn('[Expedition] 存档失败:', err)
  }
}

function todayStr () {
  return new Date().toISOString().slice(0, 10)
}

/* ---------------- store ---------------- */

export const useExpeditionStore = defineStore('expedition', {
  state: () => ({
    loaded: false,
    exp: null,            // Expedition | null（非响应式引擎实例）
    snap: null,           // 引擎快照（响应式）
    meta: { wins: 0, runs: 0, bestDay: 0 },
    lastDayResult: null,  // 最近一次 settleDay 的返回（事件流供战报播放）
    report: null,         // 持久化的待播战报 { date, result, played }
    shop: null,           // 商店节点打开时的 offers 快照
    saveTimer: null,
  }),

  getters: {
    active: (s) => !!(s.snap && s.snap.status === 'active'),
    themes: () => EXPEDITION_THEMES,
    bossesById: () => EXPEDITION_BOSSES_BY_ID,
    limits: () => ({ maxPulls: MAX_PULLS_PER_DAY, daysPerRun: DAYS_PER_RUN, maxPressure: MAX_PRESSURE }),

    /** 今日已用拉杆数（今日已结算过则取当日 pulls，否则 0） */
    pullsToday: (s) => {
      const rec = s.snap && s.snap.dayRecords[s.snap.dayRecords.length - 1]
      return rec && rec.date === todayStr() ? rec.pulls : 0
    },
    /** 今日是否已结算过 */
    settledToday: (s) => {
      const rec = s.snap && s.snap.dayRecords[s.snap.dayRecords.length - 1]
      return !!(rec && rec.date === todayStr())
    },
    /** 待播战报：已结算但未播放；次日首开自动弹由界面判断 report.date < today */
    pendingReport: (s) => (s.report && !s.report.played) ? s.report : null,
    /** 当前节点快照 */
    currentNode: (s) => (s.snap && s.snap.nodes[s.snap.nodeIndex]) || null,
    /** 商店节点可购物 */
    canShopNow: (s) => !!(s.exp && canShop(s.exp)),
    /** 未结算战报 + 待开包数（导航角标用） */
    badgeCount: (s) => {
      let n = s.snap ? s.snap.packQueue.length : 0
      if (s.report && !s.report.played) n += 1
      return n
    },
  },

  actions: {
    async init () {
      if (this.loaded) return
      this.loaded = true
      const [savedRun, savedMeta, savedReport] = await Promise.all([
        persistLoad(RUN_KEY),
        persistLoad(META_KEY),
        persistLoad(REPORT_KEY),
      ])
      if (savedMeta && typeof savedMeta === 'object') {
        this.meta = { wins: 0, runs: 0, bestDay: 0, ...savedMeta }
      }
      if (savedReport && typeof savedReport === 'object' && savedReport.result) {
        this.report = savedReport
      }
      if (savedRun) {
        try {
          const e = Expedition.deserialize(savedRun)
          if (e && e.status === 'active') this.exp = e
        } catch {
          this.exp = null // 损坏数据 → 空局，永不抛
        }
      }
      this.sync()
    },

    sync () {
      const e = this.exp
      this.snap = e
        ? {
            status: e.status,
            themeId: e.themeId,
            bossId: e.bossId,
            difficulty: e.difficulty,
            wins: e.wins,
            failReason: e.failReason,
            dayIndex: e.dayIndex,
            nodeIndex: e.nodeIndex,
            pressure: e.pressure,
            research: e.research,
            nodes: e.nodes.map(n => ({ ...n })),
            dayRecords: e.dayRecords.map(r => ({ ...r })),
            intentHistory: [...e.intentHistory],
            draft: e.draft ? { ...e.draft } : null,
            packQueue: e.packQueue.map(p => ({ ...p })),
            pendingPack: e.pendingPack ? { ...e.pendingPack } : null,
            jokers: e.jokers,
            deckCount: e.deck.length,
            deck: e.deck,
            consumables: e.consumables,
            handLevels: e.handLevels,
            seen: e.seen,
            stats: e.stats,
            settlementReport: e.settlementReport,
            jokerSlotBonus: e.jokerSlotBonus,
            consumableSlotBonus: e.consumableSlotBonus,
            jokerSlots: jokerSlotCountOf(e),
            consumableSlots: consumableSlotCountOf(e),
          }
        : null
    },

    save () {
      if (this.saveTimer) clearTimeout(this.saveTimer)
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null
        if (this.exp) persistSave(RUN_KEY, this.exp.serialize())
        persistSave(META_KEY, this.meta)
        persistSave(REPORT_KEY, this.report)
      }, 500)
    },

    /* ---------------- 开 / 弃局 ---------------- */

    /**
     * 开新局：themeId 必填；difficulty 1-3（默认 1，通关后 UI 可解锁更高）；
     * Boss 由主题决定，生涯 wins 喂给卡池/起始构筑阶梯。
     */
    startExpedition (themeId, { difficulty = 1 } = {}) {
      const theme = EXPEDITION_THEMES.find(t => t.id === themeId)
      if (!theme) return { ok: false, error: '未知主题' }
      try {
        this.exp = new Expedition({
          themeId,
          bossId: theme.bossId,
          difficulty: Math.min(3, Math.max(1, difficulty)),
          wins: this.meta.wins,
        })
      } catch (err) {
        return { ok: false, error: String(err && err.message || err) }
      }
      this.meta.runs += 1
      this.lastDayResult = null
      this.report = null
      this.shop = null
      this.sync()
      this.save()
      return { ok: true }
    },

    /** 起始构筑：{ jokerIndex, cardIndices } */
    applyDraft (picks = {}) {
      if (!this.exp) return { ok: false, error: '没有进行中的远征' }
      const res = this.exp.applyDraft(picks)
      this.sync()
      if (res.ok) this.save()
      return res
    },

    abandonExpedition () {
      if (!this.exp) return { ok: false, error: '没有进行中的远征' }
      this.exp.abandon()
      this.shop = null
      this.sync()
      this.save()
      return { ok: true, status: this.exp.status }
    },

    /** 终局后开新局前清掉旧引擎实例 */
    clearRun () {
      this.exp = null
      this.lastDayResult = null
      this.shop = null
      this.sync()
      persistSave(RUN_KEY, null)
    },

    /* ---------------- 每日结算 ---------------- */

    /**
     * 今日拉杆结算。events 为行动事件数组（E3 由 UI 模拟或真实挂钩喂入），
     * 引擎内完成全部计分；返回引擎 settleDay 的结果，事件流供战报只播放。
     */
    settleToday (events) {
      if (!this.exp) return { ok: false, error: '没有进行中的远征' }
      const before = this.exp.status
      const res = this.exp.settleDay({ date: todayStr(), events: events || [] })
      if (!res.settled) return { ok: false, reason: res.reason, status: res.status }

      this.lastDayResult = res
      this.report = { date: todayStr(), result: res, played: false }
      if (before === 'active' && this.exp.status === 'won') {
        this.meta.wins += 1
      }
      if (this.exp.dayIndex > (this.meta.bestDay || 0)) {
        this.meta.bestDay = this.exp.dayIndex
      }
      this.sync()
      this.save()
      return { ok: true, ...res }
    },

    /** 战报播放完毕：标记已播并落盘（之后不再自动弹） */
    markReportPlayed () {
      if (this.report) {
        this.report = { ...this.report, played: true }
        this.save()
      }
    },

    /* ---------------- 局内开包（packQueue → pendingPack → pick/skip） ---------------- */

    /** packQueue 队首（供 UI 展示三选一 / 直接开包 / Boss 掉落） */
    nextPackOffer () {
      if (!this.exp || !this.exp.packQueue.length) return null
      return { ...this.exp.packQueue[0] }
    },

    /**
     * 从队列开包：
     *  - packChoice：需传 chosenPackId（三选一结果）；
     *  - pack：直接开 head.packId；
     *  - bossReward：依次开 offers[0]，剩余保留。
     */
    openPackFromQueue (chosenPackId = null) {
      if (!this.exp) return { ok: false, error: '没有进行中的远征' }
      const head = this.exp.packQueue[0]
      if (!head) return { ok: false, error: '没有待开的包' }
      if (this.exp.pendingPack) return { ok: false, error: '有正在开启的包' }

      let packId = null
      if (head.kind === 'packChoice') {
        if (!chosenPackId || !head.options.includes(chosenPackId)) {
          return { ok: false, error: '需要从三个包型中选择一个' }
        }
        packId = chosenPackId
        this.exp.packQueue.shift()
      } else if (head.kind === 'pack') {
        packId = head.packId
        this.exp.packQueue.shift()
      } else if (head.kind === 'bossReward') {
        const offer = head.offers[0]
        if (!offer) {
          this.exp.packQueue.shift()
          this.sync(); this.save()
          return { ok: false, error: 'Boss 奖励已领完' }
        }
        packId = offer.packId
        head.offers.shift()
        if (!head.offers.length) this.exp.packQueue.shift()
      } else {
        return { ok: false, error: '未知的队列项' }
      }

      const res = openInRunPack(this.exp, packId)
      this.sync()
      this.save()
      return res
    },

    pickPackCards (indices = []) {
      if (!this.exp) return { ok: false, error: '没有进行中的远征' }
      const res = applyPackPicks(this.exp, indices)
      this.sync()
      if (res.ok) this.save()
      return res
    },

    skipPack () {
      if (!this.exp) return { ok: false, error: '没有进行中的远征' }
      const res = skipInRunPack(this.exp)
      this.sync()
      this.save()
      return res
    },

    /* ---------------- 商店（商店节点；研料消费） ---------------- */

    openShop () {
      if (!this.exp) return { ok: false, error: '没有进行中的远征' }
      if (!canShop(this.exp)) return { ok: false, error: '当前不在商店节点' }
      this.shop = generateExpeditionShop(this.exp)
      this.save()
      return { ok: true, shop: this.shop }
    },

    buyShopItem (offerIndex) {
      if (!this.exp || !this.shop) return { ok: false, error: '没有打开的商店' }
      const res = buyShopOffer(this.exp, this.shop, offerIndex)
      this.sync()
      if (res.ok) this.save()
      return res
    },

    rerollShop () {
      if (!this.exp || !this.shop) return { ok: false, error: '没有打开的商店' }
      const res = rerollExpeditionShop(this.exp, this.shop)
      this.sync()
      if (res.ok) this.save()
      return res
    },

    closeShop () {
      this.shop = null
    },

    /* ---------------- 阵容 / 消耗牌 ---------------- */

    reorderJokers (from, to) {
      if (!this.exp) return false
      const ok = this.exp.reorderJokers(from, to)
      if (ok) {
        this.sync()
        this.save()
      }
      return ok
    },

    useConsumable (uid, targets = []) {
      if (!this.exp) return { ok: false, error: '没有进行中的远征' }
      const res = useConsumable(this.exp, uid, { targets })
      this.sync()
      if (res.ok) this.save()
      return res
    },
  },
})
