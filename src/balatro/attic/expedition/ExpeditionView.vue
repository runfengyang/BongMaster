<template>
  <div class="exp-view balatro-font">
    <div class="exp-bg"><CrtBackground :animated="true" /></div>

    <div class="exp-content">
      <!-- ============ 无局：选择远征 ============ -->
      <template v-if="!snap">
        <header class="exp-panel exp-head">
          <h1 class="exp-title">⚔️ 远征模式</h1>
          <p class="exp-sub">5 个活跃日 · 节点推进 · Boss 攻坚 · 一切卡牌局内获得、局终清算</p>
        </header>
        <div class="exp-themes">
          <div v-for="t in store.themes" :key="t.id" class="exp-panel exp-theme">
            <div class="exp-theme-name">{{ t.name }}</div>
            <div class="exp-theme-tend">{{ t.tendency }}</div>
            <div class="exp-theme-boss">
              <span class="exp-boss-tag">Boss</span>
              <b>{{ bossDef(t.bossId)?.name }}</b>
              <span class="exp-boss-hp">HP {{ bossDef(t.bossId)?.hp?.[difficulty - 1] }}</span>
            </div>
            <div class="exp-theme-rule">{{ bossDef(t.bossId)?.rules?.[0]?.text }}</div>
            <button class="bt-btn primary" @click="start(t.id)">选择远征</button>
          </div>
        </div>
        <div class="exp-diff">
          <span>难度：</span>
          <button
            v-for="d in [1, 2, 3]"
            :key="d"
            class="bt-btn sm"
            :class="{ primary: difficulty === d }"
            :disabled="d > 1 && store.meta.wins < d - 1"
            @click="difficulty = d"
          >{{ DIFF_NAMES[d] }}</button>
          <span class="exp-diff-tip">生涯通关 {{ store.meta.wins }} 次 · 通关解锁更高难度</span>
        </div>
      </template>

      <!-- ============ 有局：主战场 ============ -->
      <template v-else>
        <!-- 顶栏状态 -->
        <header class="exp-panel exp-hud">
          <span class="exp-hud-name">⚔️ {{ themeName }}</span>
          <span class="exp-hud-item">活跃日 {{ snap.dayIndex }}/{{ store.limits.daysPerRun }}</span>
          <span class="exp-hud-item">难度 {{ DIFF_NAMES[snap.difficulty] }}</span>
          <span class="exp-hud-item pressure">压力 {{ pressureDots }}</span>
          <span class="exp-hud-item research">🔬 研料 {{ snap.research }}</span>
          <span class="exp-hud-spacer"></span>
          <button class="bt-btn sm" @click="abandon">放弃远征</button>
        </header>

        <!-- 节点路线 -->
        <NodeRoute :nodes="snap.nodes" :node-index="snap.nodeIndex" />

        <!-- Boss 图腾（始终展示关底 Boss；当前节点为 Boss 时显示实时血量） -->
        <div class="exp-boss-area">
          <BossTotem
            ref="bossTotem"
            :boss="boss"
            :hp="bossNode.hp"
            :hp-max="bossNode.hpMax"
            :intent="todayIntent"
          />
        </div>

        <!-- 行动区 -->
        <div class="exp-panel exp-actions">
          <div class="exp-actions-row">
            <button
              class="bt-btn primary lg"
              :disabled="store.settledToday || !!reportPlaying || snap.status !== 'active' || draftOpen"
              @click="settleMock(mockLevel)"
            >
              🎰 拉杆结算（{{ store.pullsToday }}/{{ store.limits.maxPulls }}）
            </button>
            <div class="exp-mock">
              <span class="exp-mock-label">模拟行动：</span>
              <button
                v-for="(m, k) in MOCK_LEVELS"
                :key="k"
                class="bt-btn sm"
                :class="{ primary: mockLevel === k }"
                @click="mockLevel = k"
              >{{ m.label }}</button>
            </div>
          </div>
          <div class="exp-actions-row">
            <button
              v-if="store.pendingReport"
              class="bt-btn"
              @click="reportPlaying = store.pendingReport.result"
            >📜 播放今日战报</button>
            <button
              v-if="snap.packQueue.length"
              class="bt-btn pack"
              @click="packOpen = true"
            >🎁 开卡包 ×{{ snap.packQueue.length }}</button>
            <button
              v-if="store.canShopNow"
              class="bt-btn shop"
              @click="openShop"
            >🛒 商店</button>
            <span v-if="store.settledToday" class="exp-settled-tip">今日已结算，明天再来（无行动日不惩罚）</span>
          </div>
        </div>

        <!-- 阵容 + 消耗牌 -->
        <div class="exp-panel exp-lineup">
          <LineupBar
            :jokers="snap.jokers"
            :consumables="snap.consumables"
            :joker-slots="snap.jokerSlots"
            :consumable-slots="snap.consumableSlots"
            @reorder="onReorder"
            @use-consumable="onUseConsumable"
          />
          <div class="exp-deck-count">牌组 {{ snap.deckCount }} 张</div>
        </div>
      </template>
    </div>

    <!-- 起始 draft -->
    <DraftModal
      v-if="draftOpen"
      :draft="snap.draft"
      @confirm="onDraft"
    />

    <!-- 局内开包：队列三选一 -->
    <div v-if="packOpen && !snap?.pendingPack" class="exp-modal" @click.self="packOpen = false">
      <div class="exp-panel exp-packchoice">
        <div class="exp-pc-title">🎁 卡包队列 ×{{ snap.packQueue.length }}</div>
        <template v-if="offer">
          <div v-if="offer.kind === 'packChoice'" class="exp-pc-row">
            <button
              v-for="pid in offer.options"
              :key="pid"
              class="bt-btn"
              @click="openPack(pid)"
            >{{ packName(pid) }}</button>
          </div>
          <div v-else-if="offer.kind === 'pack'" class="exp-pc-row">
            <button class="bt-btn primary" @click="openPack(null)">开启 {{ packName(offer.packId) }}</button>
          </div>
          <div v-else-if="offer.kind === 'bossReward'" class="exp-pc-row">
            <button class="bt-btn primary" @click="openPack(null)">Boss 掉落 ×{{ offer.offers.length }}，逐个开启</button>
          </div>
        </template>
        <button class="bt-btn sm" @click="packOpen = false">稍后再开</button>
      </div>
    </div>

    <!-- 局内开包：撕开选牌（PackModal pickMode） -->
    <PackModal
      v-if="snap?.pendingPack"
      :key="snap.pendingPack.packId"
      :pack-state="packState"
      :pick-mode="true"
      @pick="onPick"
      @skip="onSkipPack"
    />

    <!-- 商店面板 -->
    <div v-if="store.shop" class="exp-modal" @click.self="store.closeShop()">
      <div class="exp-panel exp-shop">
        <div class="exp-pc-title">🛒 远征商店 · 研料 {{ snap.research }}</div>
        <div class="exp-shop-row">
          <div v-for="(o, i) in store.shop.offers" :key="o.id + i" class="exp-shop-offer">
            <div class="exp-shop-text">{{ o.text }}</div>
            <button class="bt-btn sm primary" @click="buy(i)">🔬 {{ o.cost }}</button>
          </div>
        </div>
        <div class="exp-pc-row">
          <button class="bt-btn sm" @click="reroll">重 roll（🔬 {{ store.shop.rerollCost }}）</button>
          <button class="bt-btn sm" @click="store.closeShop()">离开</button>
        </div>
      </div>
    </div>

    <!-- 每日战报 -->
    <SlotReportModal
      v-if="reportPlaying"
      :report="reportPlaying"
      :boss="boss"
      :jokers="reportPlaying.jokersSnapshot || snap?.jokers || []"
      @close="onReportClose"
    />

    <!-- 终局清算 -->
    <div v-if="snap && snap.status !== 'active' && snap.settlementReport" class="exp-modal">
      <div class="exp-panel exp-end" :class="snap.status">
        <div class="exp-end-title">{{ END_TITLES[snap.status] }}</div>
        <div class="exp-end-line">活跃日 {{ snap.settlementReport.days }} · 清算小丑 ×{{ snap.settlementReport.cleared.jokers.length }} · 牌组 {{ snap.settlementReport.cleared.deckCount }} 张</div>
        <div class="exp-end-line">图鉴点亮 {{ snap.settlementReport.discovered.length }} 项（永久保留）· 生涯通关 {{ store.meta.wins }} 次</div>
        <div class="exp-pc-row">
          <button class="bt-btn primary" @click="newRun">开始新的远征</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
// ExpeditionView（契约 §6）：/expedition 主战场
// 组装：BossTotem + NodeRoute + LineupBar + DraftModal + PackModal(pickMode)
//       + SlotReportModal + 商店面板 + 终局清算。视觉：CrtBackground + m6x11 + balatro 变量。
// E3：行动事件为模拟（E4 才挂真实 integration），UI 只调 store，不碰引擎内部。
import { ref, computed, onMounted } from 'vue'
import CrtBackground from '../../components/CrtBackground.vue'
import PackModal from '../../components/PackModal.vue'
import BossTotem from './components/BossTotem.vue'
import NodeRoute from './components/NodeRoute.vue'
import LineupBar from './components/LineupBar.vue'
import DraftModal from './components/DraftModal.vue'
import SlotReportModal from './components/SlotReportModal.vue'
import { useExpeditionStore } from './expeditionStore.js'
import { PACKS_BY_ID } from '../../data/index.js'

const store = useExpeditionStore()
const bossTotem = ref(null)

const difficulty = ref(1)
const mockLevel = ref('standard')
const packOpen = ref(false)
const reportPlaying = ref(null)

const DIFF_NAMES = { 1: '普通', 2: '进阶', 3: '大师' }
const END_TITLES = { won: '🏆 远征通关！', lost: '💀 远征失败', abandoned: '🏳️ 远征已放弃' }

// E3 模拟行动事件（契约 §5.1 形状；E4 由真实 integration 替换）
const MOCK_LEVELS = {
  light: {
    label: '轻量日',
    events: () => [
      { type: 'daily_task', taskId: 'mock-d1', priority: 'normal', completedAt: Date.now() },
      { type: 'habit_checkin', taskId: 'mock-h1', streak: 3, completedAt: Date.now() },
    ],
  },
  standard: {
    label: '标准日',
    events: () => [
      { type: 'daily_task', taskId: 'mock-d1', priority: 'high', completedAt: Date.now() },
      { type: 'habit_checkin', taskId: 'mock-h1', streak: 8, completedAt: Date.now() },
      { type: 'project_task', taskId: 'mock-p1', projectId: 'proj-a', priority: 'normal', completedAt: Date.now() },
    ],
  },
  heavy: {
    label: '重度日',
    events: () => [
      { type: 'project_milestone', taskId: 'mock-m1', projectId: 'proj-a', completedAt: Date.now() },
      { type: 'day_cleared', taskId: 'mock-dc', completedAt: Date.now() },
      { type: 'project_task', taskId: 'mock-p1', projectId: 'proj-a', priority: 'high', completedAt: Date.now() },
      { type: 'daily_task', taskId: 'mock-d1', priority: 'high', completedAt: Date.now() },
      { type: 'habit_checkin', taskId: 'mock-h1', streak: 12, completedAt: Date.now() },
    ],
  },
}

onMounted(async () => {
  await store.init()
  // 次日首开自动弹战报（契约 §5：无待结算不弹）
  const r = store.pendingReport
  if (r && r.date < todayStr()) {
    reportPlaying.value = r.result
  }
})

function todayStr() { return new Date().toISOString().slice(0, 10) }

const snap = computed(() => store.snap)
const themeName = computed(() => store.themes.find(t => t.id === snap.value?.themeId)?.name || '远征')
const boss = computed(() => store.bossesById[snap.value?.bossId] || store.bossesById[store.themes[0].bossId])
const bossNode = computed(() => snap.value ? snap.value.nodes[snap.value.nodes.length - 1] : { hp: 1, hpMax: 1 })
const pressureDots = computed(() => snap.value
  ? '●'.repeat(snap.value.pressure) + '○'.repeat(store.limits.maxPressure - snap.value.pressure)
  : '')
// 当日意图：结算后展示本日意图；未结算时展示「待揭示」
const todayIntent = computed(() => {
  if (store.settledToday && store.lastDayResult?.intent) return store.lastDayResult.intent
  return null
})

const draftOpen = computed(() => !!(snap.value && snap.value.draft && !snap.value.draft.resolved))
const offer = computed(() => (snap.value ? store.nextPackOffer() : null))
const packState = computed(() => {
  const pp = snap.value?.pendingPack
  if (!pp) return null
  return { packId: pp.packId, def: PACKS_BY_ID[pp.packId], options: pp.options, choose: pp.choose, picked: [] }
})

function bossDef(id) { return store.bossesById[id] }
function packName(pid) { return PACKS_BY_ID[pid]?.name || pid }

function start(themeId) {
  const res = store.startExpedition(themeId, { difficulty: difficulty.value })
  if (!res.ok) console.warn('[Expedition] 开局失败:', res.error)
}

function onDraft(picks) {
  store.applyDraft(picks)
}

function settleMock(level) {
  const res = store.settleToday(MOCK_LEVELS[level].events())
  if (!res.ok) {
    console.warn('[Expedition] 结算失败:', res.reason)
    return
  }
  // 结算完自动播放战报
  reportPlaying.value = { ...res, jokersSnapshot: [...(store.snap?.jokers || [])] }
}

function onReportClose() {
  reportPlaying.value = null
  store.markReportPlayed()
}

function openPack(chosenPackId) {
  const res = store.openPackFromQueue(chosenPackId)
  if (res.ok) packOpen.value = false
  else console.warn('[Expedition] 开包失败:', res.error)
}
function onPick(indices) {
  store.pickPackCards(indices)
}
function onSkipPack() {
  store.skipPack()
}

function openShop() {
  const res = store.openShop()
  if (!res.ok) console.warn('[Expedition]', res.error)
}
function buy(i) {
  const res = store.buyShopItem(i)
  if (!res.ok) console.warn('[Expedition] 购买失败:', res.reason)
  // 买到卡包 → pendingPack 自动弹出 PackModal（v-if snap.pendingPack）
}
function reroll() {
  const res = store.rerollShop()
  if (!res.ok) console.warn('[Expedition] 重 roll 失败:', res.reason)
}

function onReorder(from, to) {
  store.reorderJokers(from, to)
}
function onUseConsumable(uid) {
  const res = store.useConsumable(uid, [])
  if (!res.ok) console.warn('[Expedition] 使用失败:', res.reason)
}

function abandon() {
  if (window.confirm('确定放弃本次远征？（按失败清算，只保留图鉴点亮）')) {
    store.abandonExpedition()
  }
}
function newRun() {
  store.clearRun()
  difficulty.value = 1
}
</script>

<style scoped>
.exp-view { position: relative; min-height: calc(100vh - var(--bm-navbar-height)); }
.exp-bg { position: fixed; inset: 0; z-index: 0; }
.exp-content {
  position: relative; z-index: 1;
  display: flex; flex-direction: column; align-items: center; gap: 16px;
  padding: 24px 20px 48px;
  max-width: 980px; margin: 0 auto;
  font-family: 'm6x11', 'PingFang SC', monospace;
}
.exp-panel {
  background: rgba(10, 14, 16, 0.88);
  border: 2px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  padding: 14px 18px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}
.exp-head { text-align: center; }
.exp-title { font-size: 30px; font-weight: 900; letter-spacing: 4px; color: #ffd54f; margin: 0; }
.exp-sub { color: #8fa39c; font-size: 13px; margin: 6px 0 0; }

.exp-themes { display: flex; gap: 18px; flex-wrap: wrap; justify-content: center; }
.exp-theme { display: flex; flex-direction: column; gap: 8px; width: 320px; }
.exp-theme-name { font-size: 20px; font-weight: 900; color: #e8f0ec; }
.exp-theme-tend { font-size: 12px; color: #4fe0b0; }
.exp-theme-boss { display: flex; align-items: center; gap: 8px; font-size: 14px; color: #ff8787; }
.exp-boss-tag {
  font-size: 10px; font-weight: 900; letter-spacing: 1px;
  background: #c92a2a; color: #fff; padding: 1px 6px; border-radius: 3px;
}
.exp-boss-hp { font-size: 11px; color: #a58a8a; }
.exp-theme-rule { font-size: 11px; color: #8fa39c; line-height: 1.5; }
.exp-diff { display: flex; align-items: center; gap: 8px; color: #c9d9c9; font-size: 13px; }
.exp-diff-tip { font-size: 11px; color: #5a6f68; }

.exp-hud { display: flex; align-items: center; gap: 16px; width: 100%; }
.exp-hud-name { font-size: 17px; font-weight: 900; color: #ffd54f; }
.exp-hud-item { font-size: 13px; color: #c9d9c9; }
.exp-hud-item.pressure { color: #ff8787; letter-spacing: 2px; }
.exp-hud-item.research { color: #4fe0b0; }
.exp-hud-spacer { flex: 1; }

.exp-boss-area { padding: 6px 0; }

.exp-actions { display: flex; flex-direction: column; gap: 10px; align-items: center; }
.exp-actions-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; justify-content: center; }
.exp-mock { display: flex; align-items: center; gap: 6px; }
.exp-mock-label { font-size: 11px; color: #5a6f68; }
.exp-settled-tip { font-size: 12px; color: #8fa39c; }
.bt-btn.pack { border-color: #f4c14f; color: #f4c14f; }
.bt-btn.shop { border-color: #4fe0b0; color: #4fe0b0; }

.exp-lineup { width: 100%; display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
.exp-deck-count { font-size: 12px; color: #8fa39c; white-space: nowrap; }

.exp-modal {
  position: fixed; inset: 0; z-index: 55;
  display: flex; align-items: center; justify-content: center;
  background: rgba(4, 9, 8, 0.72);
  backdrop-filter: blur(3px);
  font-family: 'm6x11', 'PingFang SC', monospace;
}
.exp-packchoice, .exp-shop { display: flex; flex-direction: column; gap: 14px; align-items: center; min-width: 360px; }
.exp-pc-title { font-size: 17px; font-weight: 900; color: #ffd54f; }
.exp-pc-row { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
.exp-shop-row { display: flex; flex-direction: column; gap: 8px; width: 100%; }
.exp-shop-offer {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
}
.exp-shop-text { font-size: 13px; color: #e8f0ec; }

.exp-end { display: flex; flex-direction: column; gap: 10px; align-items: center; min-width: 420px; }
.exp-end.won { border-color: #ffd54f; }
.exp-end.lost, .exp-end.abandoned { border-color: #ff6b6b; }
.exp-end-title { font-size: 24px; font-weight: 900; color: #ffd54f; }
.exp-end.lost .exp-end-title, .exp-end.abandoned .exp-end-title { color: #ff8787; }
.exp-end-line { font-size: 13px; color: #c9d9c9; }
</style>
