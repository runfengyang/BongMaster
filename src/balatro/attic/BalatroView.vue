<template>
  <div class="balatro-view">
    <CrtBackground class="bv-bg" :animated="store.settings.animations !== false" />

    <!-- 顶栏 -->
    <header v-if="run && !['menu', 'deckSelect', 'runEnd'].includes(screen)" class="bv-topbar">
      <div class="bv-top-left">
        <span class="bv-chip money">${{ fmt(run.money) }}</span>
        <span class="bv-chip">ANTE {{ run.ante }}</span>
        <span class="bv-chip dim">{{ deckName }}</span>
      </div>
      <div class="bv-top-right">
        <button class="bt-btn sm" @click="toggleMute">{{ store.settings.muted ? '🔇' : '🔊' }}</button>
        <button class="bt-btn sm danger" @click="onAbandon(false)">放弃 Run</button>
      </div>
    </header>

    <main class="bv-body">
      <!-- 主菜单 -->
      <section v-if="screen === 'menu'" class="bv-center">
        <h1 class="bv-logo">BALATRO</h1>
        <p class="bv-logo-sub">小 丑 牌 · 嵌 入 版</p>
        <button class="bt-btn primary xl" @click="toDeckSelect">开始游戏</button>
        <p class="bv-menu-hint">构建小丑组合，击穿盲注目标分</p>

        <!-- 生产力奖励待领取角标（§7） -->
        <div v-if="pendingText" class="bv-pending">
          🎁 待领取：{{ pendingText }}<span class="bv-pending-note">（开局后可领）</span>
        </div>

        <!-- 设置（§9 Phase 4：音量/静音/减少动效，随存档持久化） -->
        <div class="bv-settings">
          <label class="bv-set-item">
            <span class="bv-set-label">音量</span>
            <input
              type="range" min="0" max="100"
              v-model.number="volumePct"
              @change="store.saveNow()"
            />
            <span class="bv-set-val">{{ volumePct }}%</span>
          </label>
          <label class="bv-set-item chk">
            <input type="checkbox" v-model="store.settings.muted" @change="store.saveNow()" />
            <span>静音</span>
          </label>
          <label class="bv-set-item chk">
            <input type="checkbox" :checked="store.settings.animations === false" @change="onToggleAnimations" />
            <span>减少动效</span>
          </label>
        </div>
      </section>

      <!-- 牌组选择 -->
      <section v-else-if="screen === 'deckSelect'" class="bv-scroll">
        <h2 class="bv-h2">选择牌组</h2>
        <div class="bv-deck-grid">
          <button v-for="d in DECKS" :key="d.id" class="bv-deck" :style="deckStyle(d)" @click="startRun(d)">
            <span class="dk-motif">{{ d.art?.motif }}</span>
            <span class="dk-name">{{ d.name }}</span>
            <span class="dk-text">{{ d.text }}</span>
          </button>
        </div>
        <button class="bt-btn" @click="store.screen = 'menu'">← 返回</button>
      </section>

      <!-- 盲注选择 -->
      <section v-else-if="screen === 'blind'" class="bv-center">
        <BlindSelect
          :ante="run.ante"
          :blind-index="run.blindIndex"
          :boss-id="run.bossId"
          :plasma="!!run.plasma"
          :tags="run.tags || []"
          @select="onSelectBlind"
          @skip="onSkipBlind"
        />
        <button
          v-if="store.productivity.pendingPacks.length"
          class="bt-btn buy bv-claim"
          @click="onClaimPack"
        >🎁 打开免费卡包 ×{{ store.productivity.pendingPacks.length }}</button>
      </section>

      <!-- 回合 -->
      <section v-else-if="screen === 'round' && run.round" class="bv-round">
        <div class="bv-side">
          <ScorePanel
            class="bv-panel"
            :ante="run.ante"
            :blind-name="blindName"
            :blind-kind="run.round.blindType"
            :target="run.round.target"
            :score="run.round.score"
            :hands-left="run.round.handsLeft"
            :discards-left="run.round.discardsLeft"
            :money="run.money"
            :hand-levels="run.handLevels || {}"
            :current-hand-type="run.round.lastPlayedHandType"
            :last-chips="lastFinal?.chips || 0"
            :last-mult="lastFinal?.mult || 0"
            :last-total="lastFinal?.total || 0"
          />
          <!-- Boss 花色削弱提示 -->
          <div v-if="playRules.debuffSuit" class="bv-suit-debuff">
            {{ suitGlyph(playRules.debuffSuit) }} 花色被削弱
          </div>
          <!-- 标签 chips（跳过盲注获得） -->
          <div v-if="tagChips.length" class="bv-tags">
            <span
              v-for="t in tagChips"
              :key="t.state + t.id"
              class="bv-tag"
              :class="t.state"
              :title="BY_ID[t.id]?.text"
            >🏷 {{ BY_ID[t.id]?.name || t.id }}</span>
          </div>
        </div>

        <div class="bv-round-main">
          <JokerBar
            :jokers="run.jokers"
            :consumables="run.consumables"
            :joker-slots="run.meta?.jokerSlots ?? 5"
            :consumable-slots="run.meta?.consumableSlots ?? 2"
            @sell-joker="onSellJoker"
            @sell-consumable="onSellConsumable"
            @use-consumable="onUseConsumable"
            @reorder="onReorder"
          />
          <div v-if="bossNote" class="bv-boss-note" :class="{ off: run.round.bossDisabled }">{{ bossNote }}</div>
          <div class="bv-spacer" />

          <!-- 消耗牌目标选择模式 -->
          <div v-if="targeting" class="bv-targeting">
            <span class="tgt-text">
              {{ targeting.def.name }}：{{ targeting.spec.hint }}
              （已选 {{ store.selectedCardIds.length }}/{{ targeting.spec.max }}）
            </span>
            <button
              class="bt-btn primary sm"
              :disabled="store.selectedCardIds.length < targeting.spec.min"
              @click="confirmTargeting"
            >确认使用</button>
            <button class="bt-btn sm" @click="cancelTargeting">取消</button>
          </div>
          <template v-else>
            <div v-if="playHint" class="bv-play-hint">{{ playHint }}</div>
            <div class="bv-actions">
              <button class="bt-btn primary lg" :disabled="!canPlay" @click="onPlay">
                出牌 <span class="bt-sub">剩 {{ run.round.handsLeft }}</span>
              </button>
              <button class="bt-btn lg" :disabled="!canDiscard" @click="onDiscard">
                弃牌 <span class="bt-sub">剩 {{ run.round.discardsLeft }}</span>
              </button>
            </div>
          </template>

          <CardHand
            :hand="run.round.hand"
            :selected="store.selectedCardIds"
            @toggle="onToggle"
            @sort="onSort"
          />
        </div>
      </section>

      <!-- 商店 -->
      <section v-else-if="screen === 'shop' && run.shop" class="bv-scroll bv-shop">
        <JokerBar
          :jokers="run.jokers"
          :consumables="run.consumables"
          :joker-slots="run.meta?.jokerSlots ?? 5"
          :consumable-slots="run.meta?.consumableSlots ?? 2"
          @sell-joker="onSellJoker"
          @sell-consumable="onSellConsumable"
          @use-consumable="onUseConsumable"
          @reorder="onReorder"
        />
        <button
          v-if="store.productivity.pendingPacks.length"
          class="bt-btn buy bv-claim"
          @click="onClaimPack"
        >🎁 打开免费卡包 ×{{ store.productivity.pendingPacks.length }}</button>
        <ShopPanel
          :run="run"
          :cashout="store.lastCashout"
          @buy-item="onBuyShopItem"
          @buy-pack="onBuyPack"
          @buy-voucher="onBuyVoucher"
          @reroll="onReroll"
          @leave="onLeaveShop"
        />
      </section>

      <!-- 卡包（PackModal 全屏演出） -->
      <section v-else-if="screen === 'pack' && run.packState" class="bv-pack-screen">
        <PackModal
          :pack-state="run.packState"
          :jokers-full="jokersFull"
          :consumables-full="consumablesFull"
          @pick="onPackPick"
          @skip="onSkipPack"
        />
      </section>

      <!-- Run 结算 -->
      <section v-else-if="screen === 'runEnd'" class="bv-center">
        <h1 class="bv-end-title" :class="{ win: run?.state === 'victory' }">
          {{ run?.state === 'victory' ? '🏆 胜利！' : '💀 游戏结束' }}
        </h1>
        <p class="bv-end-sub">{{ run?.state === 'victory' ? '你击败了 Ante 8 的终局盲注！' : '未能达到盲注目标分' }}</p>
        <div v-if="run" class="bv-end-stats">
          <div class="es-row"><span>抵达 Ante</span><b>{{ run.ante }}</b></div>
          <div class="es-row"><span>回合数</span><b>{{ run.stats?.roundsPlayed ?? run.stats?.roundsWon ?? 0 }}</b></div>
          <div class="es-row"><span>最佳一手</span><b>{{ fmt(run.stats?.bestHand ?? 0) }}</b></div>
          <div class="es-row"><span>最常牌型</span><b>{{ mostPlayedHand }}</b></div>
          <div class="es-row"><span>累计获得金钱</span><b>${{ fmt(run.stats?.moneyEarned ?? 0) }}</b></div>
          <div class="es-row"><span>总出牌手数</span><b>{{ run.stats?.handsPlayedTotal ?? 0 }}</b></div>
          <div class="es-row"><span>跳过盲注</span><b>{{ run.stats?.blindsSkipped ?? 0 }}</b></div>
          <div class="es-row"><span>商店重掷</span><b>{{ run.stats?.rerolls ?? 0 }}</b></div>
        </div>
        <div class="bv-menu-btns">
          <button class="bt-btn primary lg" @click="toDeckSelect">再来一局</button>
          <button class="bt-btn lg" @click="onAbandon(true)">回主菜单</button>
        </div>
      </section>
    </main>

    <!-- 计分演出覆盖层（事件流驱动，UI 不重算分数） -->
    <RoundScore
      v-if="scoring && scoringPayload"
      :events="scoringPayload.events"
      :played-cards="scoringPayload.playedCards"
      :jokers="scoringPayload.jokers"
      :target="scoringPayload.target"
      @done="onScoreDone"
    />

    <!-- 灵魂 / 黑洞 全屏演出 -->
    <div v-if="flair" class="bv-flair" :class="flair">
      <div class="flair-motif">{{ flair === 's_soul' ? '👁️' : '🕳️' }}</div>
      <div class="flair-text">{{ flair === 's_soul' ? '传 奇 降 临' : '全 牌 型 升 级' }}</div>
    </div>

    <div v-if="toastMsg" class="bv-toast">{{ toastMsg }}</div>
  </div>
</template>

<script setup>
// BalatroView：全流程编排（§2/§6）
// menu → deckSelect → blind ⇄ round（RoundScore 演出 / 消耗牌目标模式）→ shop →（pack 演出）→ … → runEnd
import { ref, computed, watch, onMounted } from 'vue'
import { useBalatroStore } from '../balatro/store.js'
import { DECKS, BY_ID, BLINDS_BY_ID, HANDS_BY_ID } from '../balatro/data/index.js'
import { consumableTargetSpec } from '../balatro/playRules.js'
import { sound, setSoundSettings } from '../balatro/sound.js'
import CrtBackground from '../balatro/components/CrtBackground.vue'
import ScorePanel from '../balatro/components/ScorePanel.vue'
import JokerBar from '../balatro/components/JokerBar.vue'
import CardHand from '../balatro/components/CardHand.vue'
import BlindSelect from '../balatro/components/BlindSelect.vue'
import RoundScore from '../balatro/components/RoundScore.vue'
import ShopPanel from '../balatro/components/ShopPanel.vue'
import PackModal from '../balatro/components/PackModal.vue'

const store = useBalatroStore()

const screen = computed(() => store.screen)
const run = computed(() => store.run)

const scoring = ref(false)
const scoringPayload = ref(null)
const targeting = ref(null) // { index, def, spec } 消耗牌目标选择模式
const flair = ref(null)     // 's_soul' | 's_black_hole' | null
const toastMsg = ref('')
let toastTimer = null

const ERR_ZH = {
  'no hands left': '出牌次数已用尽',
  'no discards left': '弃牌次数已用尽',
  'must play 1-5 cards': '请选择 1-5 张牌',
  'must discard 1-5 cards': '请选择 1-5 张牌',
  'not enough money': '金钱不足',
  'no joker slot': '小丑栏位已满',
  'no consumable slot': '消耗牌栏位已满',
  'The Psychic: must play 5 cards': '通灵者：必须出满 5 张牌',
  'The Eye: no repeat hand types': '眼睛：本回合不能重复已出过的牌型',
  'The Mouth: only one hand type': '嘴巴：本回合只能出一种牌型',
  'boss blind cannot be skipped': 'Boss 盲注不能跳过',
}

function toast(msg) {
  toastMsg.value = ERR_ZH[msg] || msg || '操作失败'
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastMsg.value = '' }, 2200)
}
function fmt(n) {
  return Math.round(n ?? 0).toLocaleString('en-US')
}
function suitGlyph(s) {
  return { spades: '♠', hearts: '♥', clubs: '♣', diamonds: '♦' }[s] || s
}

const deckName = computed(() => BY_ID[run.value?.deckId]?.name || '')

// 主菜单：待领取奖励角标 + 设置
const pendingText = computed(() => {
  const parts = []
  if (store.productivity.pendingMoney > 0) parts.push(`$${store.productivity.pendingMoney}`)
  if (store.productivity.pendingPacks.length) parts.push(`免费卡包 ×${store.productivity.pendingPacks.length}`)
  return parts.join(' + ')
})
const volumePct = computed({
  get: () => Math.round((store.settings.volume ?? 0.5) * 100),
  set: (v) => { store.settings.volume = Math.min(1, Math.max(0, v / 100)) },
})
function onToggleAnimations(e) {
  store.settings.animations = e.target.checked ? false : true
  store.saveNow()
}
const mostPlayedHand = computed(() => {
  const hp = run.value?.stats?.handsPlayed || {}
  let best = null, bn = -1
  for (const [k, v] of Object.entries(hp)) if (v > bn) { best = k; bn = v }
  return best ? (HANDS_BY_ID[best]?.name || best) : '—'
})
const blindName = computed(() => BLINDS_BY_ID[run.value?.round?.blindId]?.name || '')
const bossNote = computed(() => {
  const r = run.value?.round
  if (!r?.boss) return ''
  return r.bossDisabled ? `${r.boss.name}：已被禁用` : `${r.boss.name}：${r.boss.text || ''}`
})
const lastFinal = computed(() => {
  const evts = store.scoreEvents || []
  for (let i = evts.length - 1; i >= 0; i--) if (evts[i].type === 'final') return evts[i]
  return null
})

// ---- Boss 约束（快照 meta.playRules，引擎注入） ----
const playRules = computed(() => run.value?.meta?.playRules || {})
const selectedHandType = computed(() => store.evaluateSelection(store.selectedCardIds))
const playHint = computed(() => {
  const pr = playRules.value
  const n = store.selectedCardIds.length
  if (pr.exactCount && n > 0 && n !== pr.exactCount) return `通灵者：必须出满 ${pr.exactCount} 张牌`
  const ht = selectedHandType.value
  if (ht && pr.bannedTypes?.includes(ht)) return '眼睛：本回合不能重复已出过的牌型'
  if (ht && pr.forcedType && ht !== pr.forcedType) return '嘴巴：本回合只能出一种牌型'
  return ''
})

// ---- 标签 chips：持有中（active）+ 最近获得（recent） ----
const tagChips = computed(() => {
  const r = run.value
  if (!r) return []
  const held = (r.tags || []).map(id => ({ id, state: 'active' }))
  const heldSet = new Set(r.tags || [])
  const recent = (r.meta?.recentTags || []).filter(id => !heldSet.has(id)).map(id => ({ id, state: 'recent' }))
  return [...held, ...recent]
})

const jokersFull = computed(() => (run.value?.jokers?.length ?? 0) >= (run.value?.meta?.jokerSlots ?? 5))
const consumablesFull = computed(() => (run.value?.consumables?.length ?? 0) >= (run.value?.meta?.consumableSlots ?? 2))

const canPlay = computed(() => {
  if (scoring.value || targeting.value || !run.value?.round) return false
  const n = store.selectedCardIds.length
  if (n < 1 || n > 5 || run.value.round.handsLeft <= 0) return false
  const pr = playRules.value
  if (pr.exactCount && n !== pr.exactCount) return false
  const ht = selectedHandType.value
  if (ht && pr.bannedTypes?.includes(ht)) return false
  if (ht && pr.forcedType && ht !== pr.forcedType) return false
  return true
})
const canDiscard = computed(() =>
  !scoring.value && !targeting.value && run.value?.round &&
  store.selectedCardIds.length >= 1 && run.value.round.discardsLeft > 0)

function deckStyle(d) {
  return {
    background: `linear-gradient(160deg, ${d.art?.bg || '#37474f'}, #10141c 130%)`,
    borderColor: d.art?.accent || 'rgba(255,255,255,0.2)',
  }
}

// ---- 菜单 / 牌组 ----
function toDeckSelect() {
  sound.click()
  store.screen = 'deckSelect'
}
function startRun(d) {
  sound.select()
  store.newRun(d.id)
}

// ---- 盲注 ----
function onSelectBlind() {
  try { store.selectBlind(); sound.deal() } catch (e) { toast(e.message) }
}
function onSkipBlind() {
  try { store.skipBlind(); sound.click() } catch (e) { toast(e.message) }
}
function onClaimPack() {
  if (store.claimPendingPack()) sound.pack()
  else toast('当前阶段无法开包')
}

// ---- 回合 ----
function onToggle(id) {
  if (scoring.value) return
  if (targeting.value) {
    const sel = store.selectedCardIds
    if (!sel.includes(id) && sel.length >= targeting.value.spec.max) {
      toast(`最多选择 ${targeting.value.spec.max} 张`)
      return
    }
    store.toggleCardSelect(id)
    sound.flip()
    return
  }
  store.toggleCardSelect(id)
  sound.flip()
}
function onSort(by) {
  store.sortHand(by)
  sound.click()
}
function onPlay() {
  if (!canPlay.value) return
  const r = run.value.round
  // 快照：出牌阵列与小丑（计分后手牌/小丑可能已变化，RoundScore 只播快照）
  const playedCards = store.selectedCardIds
    .map(id => r.hand.find(c => c.id === id))
    .filter(Boolean)
    .map(card => ({ card: JSON.parse(JSON.stringify(card)), def: null }))
  const jokers = run.value.jokers.map(j => ({ joker: JSON.parse(JSON.stringify(j)), def: BY_ID[j.id] }))
  const target = r.target
  try {
    store.playSelected()
  } catch (e) {
    toast(e.message)
    return
  }
  if (store.scoreEvents?.length) {
    scoringPayload.value = { events: store.scoreEvents, playedCards, jokers, target }
    scoring.value = true
  }
}
function onScoreDone() {
  scoring.value = false
  scoringPayload.value = null
}
function onDiscard() {
  try { store.discardSelected(); sound.flip() } catch (e) { toast(e.message) }
}

// ---- 小丑 / 消耗牌 ----
function onSellJoker(i) {
  try { store.sellCard('joker', i); sound.coin() } catch (e) { toast(e.message) }
}
function onSellConsumable(i) {
  try { store.sellConsumable(i); sound.coin() } catch (e) { toast(e.message) }
}
// 消耗牌：需目标的进入选牌模式；星球立即生效（ScorePanel 闪烁反馈）；灵魂/黑洞全屏演出
function onUseConsumable(i) {
  const c = run.value?.consumables?.[i]
  if (!c) return
  const def = BY_ID[c.id]
  const spec = consumableTargetSpec(def)
  if (spec) {
    if (screen.value !== 'round' || !run.value?.round) {
      toast('这张牌需要在回合中选择手牌使用')
      return
    }
    for (const id of [...store.selectedCardIds]) store.toggleCardSelect(id)
    targeting.value = { index: i, def, spec }
    sound.select()
    return
  }
  doUseConsumable(i, [])
}
function doUseConsumable(i, targets) {
  const defId = run.value?.consumables?.[i]?.id
  try {
    store.useConsumable(i, targets)
  } catch {
    toast('这张牌现在无法使用')
    return
  }
  if (defId === 's_soul' || defId === 's_black_hole') {
    flair.value = defId
    sound.rareReveal()
    setTimeout(() => { flair.value = null }, 1400)
  } else {
    sound.select()
  }
}
function confirmTargeting() {
  const t = targeting.value
  if (!t) return
  const n = store.selectedCardIds.length
  if (n < t.spec.min || n > t.spec.max) return
  // 按手牌位置排序（死神：左边变成右边）
  const hand = run.value.round.hand
  const targets = [...store.selectedCardIds].sort((a, b) =>
    hand.findIndex(c => c.id === a) - hand.findIndex(c => c.id === b))
  targeting.value = null
  doUseConsumable(t.index, targets)
}
function cancelTargeting() {
  for (const id of [...store.selectedCardIds]) store.toggleCardSelect(id)
  targeting.value = null
  sound.click()
}
function onReorder(from, to) {
  store.reorderJokers(from, to)
}

// ---- 商店 ----
function onBuyShopItem(i) {
  try { store.buyShopItem(i); sound.coin() } catch (e) { toast(e.message) }
}
function onReroll() {
  try { store.rerollShop(); sound.click() } catch (e) { toast(e.message) }
}
function onBuyVoucher(extra) {
  try { store.buyVoucher(extra); sound.coin() } catch (e) { toast(e.message) }
}
function onBuyPack(i) {
  try { store.buyPack(i); sound.pack() } catch (e) { toast(e.message) }
}
function onLeaveShop() {
  try { store.leaveShop(); sound.click() } catch (e) { toast(e.message) }
}

// ---- 卡包 ----
function onPackPick(indices) {
  try { store.pickPackCards(indices) } catch (e) { toast(e.message) }
}
function onSkipPack() {
  try { store.skipPack(); sound.click() } catch (e) { toast(e.message) }
}

// ---- 其他 ----
function onAbandon(silent) {
  if (!silent && !window.confirm('确定放弃当前 Run 吗？进度将丢失。')) return
  store.abandonRun()
  sound.click()
}
function toggleMute() {
  store.settings.muted = !store.settings.muted
  store.saveNow()
}

// ---- 音效联动 ----
watch(() => store.settings, (s) => {
  setSoundSettings({ muted: s.muted, volume: s.volume })
}, { deep: true, immediate: true })

watch(screen, (now, prev) => {
  targeting.value = null
  if (now === 'shop' && prev === 'round') sound.coin()
  if (now === 'runEnd') (run.value?.state === 'victory' ? sound.win() : sound.lose())
})

watch(() => run.value?.round?.hand?.length ?? 0, (n, o) => {
  if (screen.value === 'round' && n > o) sound.deal()
})

onMounted(() => { store.init() })
</script>

<!-- 全局按钮样式（.bt-* 前缀，Balatro 各子组件共用） -->
<style>
.bt-btn {
  appearance: none;
  border: 2px solid rgba(255, 255, 255, 0.22);
  background: linear-gradient(180deg, #37474f, #263238);
  color: #eceff1;
  font-weight: 800;
  font-size: 13px;
  padding: 7px 16px;
  border-radius: 9px;
  cursor: pointer;
  letter-spacing: 0.5px;
  box-shadow: 0 3px 0 rgba(0, 0, 0, 0.4);
  transition: transform 0.12s, box-shadow 0.12s, filter 0.12s;
}
.bt-btn:hover:not(:disabled) { transform: translateY(-2px); filter: brightness(1.15); }
.bt-btn:active:not(:disabled) { transform: translateY(1px); box-shadow: 0 1px 0 rgba(0, 0, 0, 0.4); }
.bt-btn:disabled { opacity: 0.38; cursor: not-allowed; }
.bt-btn.primary {
  background: linear-gradient(180deg, #ff8a65, #e0564b);
  border-color: #ffab91;
  text-shadow: 0 1px 0 rgba(0, 0, 0, 0.35);
}
.bt-btn.buy {
  background: linear-gradient(180deg, #ffd54f, #f0a429);
  border-color: #ffe082;
  color: #4e342e;
}
.bt-btn.skip { background: linear-gradient(180deg, #546e7a, #37474f); }
.bt-btn.danger { background: linear-gradient(180deg, #7a2f2f, #5c2222); border-color: #a05050; }
.bt-btn.sm { font-size: 11px; padding: 4px 10px; border-radius: 7px; }
.bt-btn.lg { font-size: 16px; padding: 10px 26px; border-radius: 11px; }
.bt-btn.xl { font-size: 20px; padding: 14px 44px; border-radius: 13px; }
.bt-btn .bt-sub { font-size: 0.72em; opacity: 0.75; margin-left: 4px; }
</style>

<style scoped>
.balatro-view {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 620px;
  overflow: hidden;
  color: #eceff1;
  font-family: 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
}
.bv-bg { position: absolute; inset: 0; z-index: 0; }
.bv-body { position: relative; z-index: 1; height: 100%; display: flex; flex-direction: column; }

.bv-topbar {
  position: relative; z-index: 2;
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 16px;
}
.bv-top-left, .bv-top-right { display: flex; gap: 8px; align-items: center; }
.bv-chip {
  font-weight: 900; font-size: 14px;
  background: rgba(0, 0, 0, 0.5); border: 1px solid rgba(255,255,255,0.16);
  padding: 4px 12px; border-radius: 8px;
}
.bv-chip.money { color: #ffd54f; }
.bv-chip.dim { color: #90a4ae; font-weight: 600; }

.bv-center {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 14px; padding: 20px;
}
.bv-scroll { flex: 1; overflow-y: auto; padding: 12px 20px 24px; display: flex; flex-direction: column; align-items: center; gap: 16px; }
.bv-pack-screen { flex: 1; position: relative; }

.bv-logo {
  font-size: 72px; font-weight: 900; letter-spacing: 10px; margin: 0;
  background: linear-gradient(180deg, #ffd54f 20%, #ff8a65 60%, #e0564b);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 4px 0 rgba(0, 0, 0, 0.5)) drop-shadow(0 0 24px rgba(255, 170, 80, 0.25));
}
.bv-logo-sub { font-size: 16px; letter-spacing: 6px; color: #80cbc4; margin: -6px 0 10px; }
.bv-menu-hint { font-size: 12px; color: #78909c; }

/* 主菜单：待领取角标 + 设置 */
.bv-pending {
  font-size: 13px; font-weight: 800; color: #ffe082;
  background: rgba(80, 64, 16, 0.55);
  border: 1px solid rgba(255, 213, 79, 0.5);
  padding: 7px 16px; border-radius: 20px;
  animation: claimPulse 1.6s infinite;
}
.bv-pending-note { font-size: 10px; color: rgba(255, 224, 130, 0.6); font-weight: 500; margin-left: 4px; }
.bv-settings {
  display: flex; align-items: center; gap: 18px; flex-wrap: wrap; justify-content: center;
  margin-top: 10px;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(255,255,255,0.12);
  padding: 10px 18px; border-radius: 12px;
}
.bv-set-item { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #b0bec5; cursor: pointer; }
.bv-set-item input[type='range'] { width: 110px; accent-color: #ffd54f; }
.bv-set-item input[type='checkbox'] { accent-color: #ffd54f; }
.bv-set-val { min-width: 34px; text-align: right; color: #ffd54f; font-weight: 700; }
.bv-menu-btns { display: flex; gap: 12px; }
.bv-h2 { font-size: 22px; font-weight: 900; letter-spacing: 2px; color: #ffd54f; margin: 6px 0; text-shadow: 0 2px 0 rgba(0,0,0,0.5); }

/* 牌组选择 */
.bv-deck-grid {
  display: grid; grid-template-columns: repeat(5, minmax(150px, 1fr)); gap: 12px;
  max-width: 980px; width: 100%;
}
.bv-deck {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 14px 10px; border-radius: 12px; border: 2px solid;
  cursor: pointer; color: #eceff1; text-align: center;
  transition: transform 0.14s, box-shadow 0.14s;
}
.bv-deck:hover { transform: translateY(-4px) scale(1.02); box-shadow: 0 8px 22px rgba(0,0,0,0.5); }
.dk-motif { font-size: 28px; }
.dk-name { font-size: 14px; font-weight: 900; }
.dk-text { font-size: 10.5px; color: #cfd8dc; line-height: 1.5; min-height: 32px; }

/* 回合布局 */
.bv-round { flex: 1; display: flex; gap: 14px; padding: 8px 16px 14px; min-height: 0; }
.bv-side { flex-shrink: 0; display: flex; flex-direction: column; gap: 8px; }
.bv-round-main { flex: 1; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.bv-spacer { flex: 1; }
.bv-boss-note {
  align-self: center;
  font-size: 12px; font-weight: 700; color: #ef9a9a;
  background: rgba(94, 26, 26, 0.55); border: 1px solid rgba(239, 154, 154, 0.4);
  padding: 5px 14px; border-radius: 8px;
}
.bv-boss-note.off { color: #a5d6a7; background: rgba(27, 62, 32, 0.55); border-color: rgba(165, 214, 167, 0.4); }
.bv-actions { display: flex; gap: 14px; justify-content: center; }
.bv-play-hint {
  align-self: center;
  font-size: 12px; font-weight: 800; color: #ffcc80;
  background: rgba(80, 52, 10, 0.6); border: 1px solid rgba(255, 204, 128, 0.45);
  padding: 4px 14px; border-radius: 8px;
}

/* 目标选择模式 */
.bv-targeting {
  display: flex; align-items: center; justify-content: center; gap: 12px;
  background: rgba(26, 46, 74, 0.75);
  border: 1px solid rgba(110, 198, 255, 0.5);
  border-radius: 10px; padding: 8px 16px;
  animation: tgtIn 0.18s ease-out;
}
@keyframes tgtIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.tgt-text { font-size: 13px; font-weight: 800; color: #b3e5fc; }

/* 花色削弱 + 标签 */
.bv-suit-debuff {
  align-self: flex-start;
  font-size: 11px; font-weight: 800; color: #ef9a9a;
  background: rgba(94, 26, 26, 0.5);
  border: 1px solid rgba(239, 154, 154, 0.4);
  padding: 3px 10px; border-radius: 14px;
}
.bv-tags { display: flex; gap: 6px; flex-wrap: wrap; max-width: 210px; }
.bv-tag {
  font-size: 10px; font-weight: 700;
  padding: 3px 8px; border-radius: 12px;
  border: 1px solid rgba(255, 213, 79, 0.45);
  background: rgba(80, 64, 16, 0.55); color: #ffe082;
  cursor: help;
}
.bv-tag.recent { opacity: 0.55; border-style: dashed; }

/* 免费卡包 */
.bv-claim { animation: claimPulse 1.6s infinite; }
@keyframes claimPulse {
  0%, 100% { box-shadow: 0 3px 0 rgba(0,0,0,0.4); }
  50% { box-shadow: 0 3px 0 rgba(0,0,0,0.4), 0 0 18px rgba(255, 213, 79, 0.55); }
}

/* 商店 */
.bv-shop { gap: 14px; }

/* 结算 */
.bv-end-title { font-size: 44px; font-weight: 900; margin: 0; color: #ef9a9a; text-shadow: 0 3px 0 rgba(0,0,0,0.5); }
.bv-end-title.win { color: #ffd54f; }
.bv-end-sub { font-size: 14px; color: #b0bec5; margin: 0; }
.bv-end-stats {
  display: flex; flex-direction: column; gap: 6px; min-width: 260px;
  background: rgba(0,0,0,0.45); border: 1px solid rgba(255,255,255,0.14);
  border-radius: 12px; padding: 14px 18px;
}
.es-row { display: flex; justify-content: space-between; font-size: 13px; }
.es-row b { color: #ffd54f; }

/* 灵魂 / 黑洞 全屏演出 */
.bv-flair {
  position: absolute; inset: 0; z-index: 55;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px;
  pointer-events: none;
  animation: flairBg 1.4s ease-out forwards;
}
.bv-flair.s_soul { background: radial-gradient(circle, rgba(224, 160, 255, 0.28), rgba(10, 4, 18, 0.85) 70%); }
.bv-flair.s_black_hole { background: radial-gradient(circle, rgba(112, 112, 255, 0.3), rgba(2, 2, 10, 0.9) 70%); }
@keyframes flairBg {
  0% { opacity: 0; }
  15% { opacity: 1; }
  80% { opacity: 1; }
  100% { opacity: 0; }
}
.flair-motif { font-size: 110px; animation: flairZoom 1.35s cubic-bezier(0.2, 1.4, 0.4, 1) forwards; filter: drop-shadow(0 0 30px rgba(224, 160, 255, 0.7)); }
@keyframes flairZoom {
  0% { transform: scale(0.2) rotate(-16deg); opacity: 0; }
  45% { transform: scale(1.15) rotate(3deg); opacity: 1; }
  70% { transform: scale(1); }
  100% { transform: scale(1.05); opacity: 0.9; }
}
.flair-text {
  font-size: 30px; font-weight: 900; letter-spacing: 10px; color: #f3e5f5;
  text-shadow: 0 0 22px rgba(224, 160, 255, 0.8), 0 3px 0 rgba(0,0,0,0.6);
  animation: flairText 1.35s ease-out forwards;
}
@keyframes flairText {
  0% { opacity: 0; transform: translateY(18px); }
  35% { opacity: 1; transform: none; }
  100% { opacity: 0.95; }
}

.bv-toast {
  position: absolute; left: 50%; bottom: 26px; transform: translateX(-50%);
  z-index: 60;
  background: rgba(20, 26, 32, 0.95); color: #ffccbc;
  border: 1px solid rgba(255, 138, 101, 0.5);
  font-size: 13px; font-weight: 700;
  padding: 9px 20px; border-radius: 10px;
  animation: toastIn 0.2s ease-out;
}
@keyframes toastIn { from { opacity: 0; transform: translate(-50%, 8px); } to { opacity: 1; transform: translate(-50%, 0); } }

@media (max-width: 900px) {
  .bv-deck-grid { grid-template-columns: repeat(3, 1fr); }
  .bv-round { flex-direction: column; overflow-y: auto; }
  .bv-logo { font-size: 48px; }
}
</style>
