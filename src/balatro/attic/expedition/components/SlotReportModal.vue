<template>
  <div class="sr-overlay" @click.self="onBgClick">
    <div class="sr-stage">
      <!-- 顶栏：标题 + 控制 -->
      <div class="sr-head">
        <div class="sr-title">⚔️ 第 {{ report.day }} 活跃日 · 战报</div>
        <div class="sr-controls">
          <button class="sr-ctrl" :title="'播放速度'" @click="cycleSpeed">×{{ speedLabel }}</button>
          <button v-if="!done" class="sr-ctrl" @click="skip">跳过 ⏭</button>
          <button class="sr-ctrl primary" :disabled="!done" @click="close">收下战报</button>
        </div>
      </div>

      <!-- Boss 区（受击/施压/碎裂反馈在这里演） -->
      <div class="sr-boss">
        <BossTotem
          ref="totem"
          :boss="boss"
          :hp="bossHp"
          :hp-max="bossHpMax"
          :intent="intentObj"
          compact
        />
        <transition name="sr-dmg">
          <div v-if="dmgFloat" :key="dmgKey" class="sr-dmg-float">-{{ dmgFloat }}</div>
        </transition>
      </div>

      <!-- 老虎机：5 格轮带 -->
      <div class="sr-reels">
        <div
          v-for="(slot, i) in reelSlots"
          :key="i"
          class="sr-reel"
          :class="{ phantom: slot && slot.phantom, pop: slot && slot.pop }"
        >
          <PlayingCard
            v-if="slot"
            :ref="el => setCardRef(slot.id, el)"
            :card="slot.card"
            kind="playing"
            :edition="slot.card.edition"
            :width="64"
            :selectable="false"
          />
          <div v-else class="sr-reel-empty"></div>
        </div>
      </div>

      <!-- 牌型爆出横幅 -->
      <transition name="sr-hand">
        <div v-if="handBanner" :key="handKey" class="sr-hand-banner">
          <span class="sr-hand-name">{{ handBanner.name }}</span>
          <span class="sr-hand-score">{{ handBanner.chips }} × {{ handBanner.mult }}</span>
        </div>
      </transition>

      <!-- Boss 规则 / 意图横幅 -->
      <transition name="sr-hand">
        <div v-if="bossBanner" :key="'bb' + bossKey" class="sr-boss-banner">{{ bossBanner }}</div>
      </transition>

      <!-- 小丑连锁条 -->
      <div v-if="jokers.length" class="sr-jokers">
        <div
          v-for="j in jokers"
          :key="j.uid"
          class="sr-joker"
          :class="{ firing: firingJoker === j.uid }"
        >
          <PlayingCard
            :ref="el => setJokerRef(j.uid, el)"
            :def="jokerDef(j.id)"
            kind="joker"
            :edition="j.edition"
            :width="40"
            :selectable="false"
          />
        </div>
      </div>

      <!-- 事件日志 -->
      <div ref="logEl" class="sr-log">
        <div v-for="(l, i) in logLines" :key="i" class="sr-log-line" :class="l.kind">{{ l.text }}</div>
        <div v-if="!logLines.length && !done" class="sr-log-line dim">拉杆中…</div>
      </div>

      <!-- 结算 / 清算单 -->
      <transition name="sr-hand">
        <div v-if="daySummary" class="sr-summary">
          <span>今日总伤害 <b class="sr-total">{{ daySummary.total }}</b></span>
          <span>拉杆 {{ daySummary.pulls }}/5</span>
          <span v-if="daySummary.pressure > 0" class="sr-pressure">压力 {{ '●'.repeat(daySummary.pressure) }}</span>
        </div>
      </transition>
      <transition name="sr-hand">
        <div v-if="settlement" class="sr-settlement" :class="settlement.won ? 'won' : 'lost'">
          <div class="sr-set-title">{{ settlement.won ? '🏆 远征通关！' : '💀 远征失败' }}</div>
          <div class="sr-set-line">清算：小丑 ×{{ settlement.cleared.jokers.length }} · 牌组 {{ settlement.cleared.deckCount }} 张 · 消耗牌 ×{{ settlement.cleared.consumables.length }} · 研料 {{ settlement.cleared.research }}</div>
          <div class="sr-set-line">图鉴新点亮 {{ settlement.discovered.length }} 项（永久保留）</div>
        </div>
      </transition>
    </div>
  </div>
</template>

<script setup>
// SlotReportModal（契约 §5）：老虎机每日战报覆盖层
// 事件流驱动（UI 只播不重算）：拉杆 → 逐格定格 → 牌型爆出 → 逐牌计分飘字
// → 小丑连锁（抖动+飘字）→ 本次伤害 → Boss 受击 → 压力/节点推进 → 日总结 → 清算单
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import PlayingCard from '../../../components/PlayingCard.vue'
import BossTotem from './BossTotem.vue'
import { BY_ID } from '../../../data/index.js'
import { HANDS } from '../../../data/hands.js'

const props = defineProps({
  report: { type: Object, required: true },  // settleDay 返回 { day, events, total, pulls, nodes, nodeIndex, intent, pressure, settlementReport, ... }
  boss: { type: Object, required: true },    // Boss def
  jokers: { type: Array, default: () => [] },// 结算时阵容快照
})
const emit = defineEmits(['close'])

// ---------- 播放控制 ----------
const SPEEDS = [1, 2, 4]
const speedIdx = ref(0)
const speedLabel = computed(() => SPEEDS[speedIdx.value])
function cycleSpeed() { speedIdx.value = (speedIdx.value + 1) % SPEEDS.length }
const speedMul = () => 1 / SPEEDS[speedIdx.value]

const done = ref(false)
const skipped = ref(false)
let alive = true

function wait(ms) {
  return new Promise(resolve => {
    const t = Math.max(16, ms * speedMul())
    setTimeout(() => resolve(), skipped.value ? 16 : t)
  })
}
function skip() { skipped.value = true }
function onBgClick() { if (!done.value) skip() }
function close() { emit('close') }

// ---------- 播放状态 ----------
const totem = ref(null)
const reelSlots = ref([null, null, null, null, null]) // { id, card, phantom, pop }
const cardRefs = new Map()
const jokerRefs = new Map()
const handBanner = ref(null)
const handKey = ref(0)
const bossBanner = ref(null)
const bossKey = ref(0)
const firingJoker = ref(null)
const dmgFloat = ref(0)
const dmgKey = ref(0)
const logLines = ref([])
const logEl = ref(null)
const daySummary = ref(null)
const settlement = ref(null)

const bossHp = ref(0)
const bossHpMax = ref(1)
const intentObj = computed(() => props.report.intent || null)

const HAND_NAMES = Object.fromEntries(HANDS.map(h => [h.id, h.name]))

function setCardRef(id, el) { if (el) cardRefs.set(id, el) }
function setJokerRef(uid, el) { if (el) jokerRefs.set(uid, el) }
function jokerDef(id) { return BY_ID[id] }

function pushLog(text, kind = '') {
  logLines.value.push({ text, kind })
  nextTick(() => {
    if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight
  })
}

function fmtScore(e) {
  if (e.xMult) return { text: `×${e.xMult}`, kind: 'xmult' }
  if (e.mult) return { text: `+${e.mult}`, kind: 'mult' }
  if (e.chips) return { text: `+${e.chips}`, kind: 'chips' }
  return null
}

// ---------- 主播放流程（顺序消费事件流，绝不重算数值） ----------
async function play() {
  const events = props.report.events || []
  // Boss HP 初值 = 结算前（回放伤害逐步扣）
  const nodesAfter = props.report.nodes || []
  const bossIdx = nodesAfter.length - 1
  const bossNode = nodesAfter[bossIdx] || { hp: 0, hpMax: props.boss.hp?.[0] || 800 }
  // 起始节点 = 结算后 nodeIndex - 今日通关节点数（nodeCleared 每次 +1）
  const clearedToday = events.filter(e => e.type === 'nodeCleared').length
  const startNodeIdx = (props.report.nodeIndex ?? 0) - clearedToday
  // 今日伤害触及 Boss：起始就在 Boss 节点，或结算后已到达 Boss 节点
  const onBossToday = startNodeIdx >= bossIdx || (props.report.nodeIndex ?? 0) >= bossIdx
  bossHpMax.value = bossNode.hpMax
  if (onBossToday) {
    // 对 Boss 造成的伤害不超过 Boss 已损血量（回放口径，仅视觉）
    const bossDmg = Math.min(props.report.total, bossNode.hpMax - bossNode.hp)
    bossHp.value = bossNode.hp + bossDmg
  } else {
    bossHp.value = bossNode.hp
  }

  for (const e of events) {
    if (!alive) return
    switch (e.type) {
      case 'pullStart': {
        // 拉杆 → 逐格定格（stagger）
        handBanner.value = null
        reelSlots.value = [null, null, null, null, null]
        cardRefs.clear()
        await wait(180)
        for (let i = 0; i < 5; i++) {
          const d = e.drawn[i]
          reelSlots.value[i] = d
            ? { id: d.id, card: d, phantom: i >= e.drawn.length - (e.phantom || 0) && (e.phantom || 0) > 0, pop: true }
            : null
          await wait(110)
        }
        break
      }
      case 'pullVoid': {
        pushLog('第 ' + (e.pullIndex + 1) + ' 杆：全部牌被削弱，本次无伤害', 'warn')
        await wait(300)
        break
      }
      case 'handEvaluated': {
        handBanner.value = { name: HAND_NAMES[e.handType] || e.handType, chips: e.chips, mult: e.mult }
        handKey.value++
        await wait(420)
        break
      }
      case 'cardScore': {
        const f = fmtScore(e)
        const el = cardRefs.get(e.cardId)
        if (el && f) {
          el.floatText(f.text, f.kind)
          if (e.retrigger) el.shake()
        }
        await wait(95)
        break
      }
      case 'heldCard': {
        pushLog('钢铁牌持有加成 ×' + e.xMult)
        await wait(120)
        break
      }
      case 'jokerTrigger': {
        firingJoker.value = e.uid
        const el = jokerRefs.get(e.uid)
        const f = fmtScore(e)
        if (el) {
          el.shake()
          if (f) el.floatText(f.text, f.kind)
        }
        const def = BY_ID[e.id]
        pushLog(`🃏 ${def?.name || e.id}${f ? ' ' + f.text : ''}${e.copiedById ? '（复制）' : ''}`, 'joker')
        await wait(220)
        firingJoker.value = null
        break
      }
      case 'bossRule': {
        bossBanner.value = `👑 Boss 规则：${ruleText(e)}`
        bossKey.value++
        totem.value?.casting()
        await wait(500)
        bossBanner.value = null
        break
      }
      case 'bossIntent': {
        bossBanner.value = `👑 Boss 意图生效：${intentText(e)}`
        bossKey.value++
        totem.value?.casting()
        await wait(500)
        bossBanner.value = null
        break
      }
      case 'dayMod': {
        if (e.chipsAdd) pushLog(`当日修正 +${e.chipsAdd} 筹码`)
        if (e.multAdd) pushLog(`当日修正 +${e.multAdd} 倍率`)
        if (e.damageMult) pushLog(`当日修正 伤害 ×${e.damageMult}`)
        await wait(120)
        break
      }
      case 'final': {
        // 本次拉杆合计（scoreHand 末事件），飘一个大数
        handBanner.value = handBanner.value
          ? { ...handBanner.value, chips: e.chips, mult: e.mult }
          : { name: '', chips: e.chips, mult: e.mult }
        await wait(200)
        break
      }
      case 'pullTotal': {
        dmgFloat.value = e.total
        dmgKey.value++
        if (onBossToday) {
          bossHp.value = Math.max(0, bossHp.value - e.total)
          totem.value?.hit()
        }
        pushLog(`第 ${e.pullIndex + 1} 杆合计：${e.total} 伤害`, 'total')
        await wait(520)
        dmgFloat.value = 0
        handBanner.value = null
        break
      }
      case 'dayTotal': {
        daySummary.value = { total: e.total, pulls: e.pulls, pressure: props.report.pressure }
        await wait(400)
        break
      }
      case 'pressure': {
        totem.value?.pressure()
        pushLog(e.reason === 'below_min_damage'
          ? `⚠️ 伤害 ${e.total} 未达最低线 ${e.minDamage}，压力 +1（${e.pressure}/5）`
          : `⚠️ 违反 Boss 意图，压力 +1（${e.pressure}/5）`, 'warn')
        await wait(500)
        break
      }
      case 'intentViolation': {
        pushLog('⚠️ 意图违规：' + (e.intent || ''), 'warn')
        await wait(300)
        break
      }
      case 'mrBonesSave': {
        pushLog('💀 白骨精发动！免死一次，压力回落至 ' + e.pressure, 'joker')
        await wait(500)
        break
      }
      case 'nodeCleared': {
        pushLog(`🏁 节点通关：${KIND_NAMES[e.kind] || e.kind}${e.overflow ? `（溢出 ${e.overflow} ×50% 结转）` : ''}`, 'good')
        await wait(420)
        break
      }
      case 'overflowCarry': {
        pushLog(`溢出伤害 ${e.amount} 结转至下一节点`)
        await wait(240)
        break
      }
      case 'researchGain': {
        pushLog(`🔬 研料 +${e.amount}（${e.source === 'unusedPulls' ? '未用拉杆转化' : '节点奖励'}）`, 'good')
        await wait(220)
        break
      }
      case 'packOffer': {
        pushLog('🎁 获得卡包奖励！（回到战场开启）', 'good')
        await wait(300)
        break
      }
      case 'sealRefund': {
        pushLog('🔵 蓝色符印返还：' + (e.planetId || ''))
        await wait(200)
        break
      }
      case 'runEnd': {
        if (e.status === 'won') totem.value?.shatter()
        settlement.value = e.settlement || props.report.settlementReport
        await wait(900)
        break
      }
      default:
        break
    }
  }
  done.value = true
}

const KIND_NAMES = { normal: '普通节点', elite: '精英节点', shop: '商店节点', boss: 'Boss 节点' }
function ruleText(e) {
  if (e.rule === 'suit_diversity_penalty') return `${e.suits} 种花色，倍率 ×${round2(e.factor)}（${e.multFrom} → ${e.multTo}）`
  if (e.rule === 'repeat_rank_decay') return `重复点数衰减：${e.rank} 筹码 ${e.chipsFrom} → ${e.chipsTo}`
  return e.rule
}
function intentText(e) {
  if (e.intent === 'suit_weaken') return `花色削弱（${e.suit || ''}）`
  if (e.intent === 'grace_flush') return '恩赐日：视为同花色'
  if (e.intent === 'straight_grace') return `顺子恩赐 ×${e.xMult}`
  return e.intent
}
function round2(x) { return Math.round(x * 100) / 100 }

onMounted(() => { play() })
onUnmounted(() => { alive = false })
</script>

<style scoped>
.sr-overlay {
  position: fixed; inset: 0; z-index: 80;
  display: flex; align-items: center; justify-content: center;
  background: rgba(3, 6, 10, 0.86);
  backdrop-filter: blur(5px);
  font-family: 'm6x11', 'PingFang SC', monospace;
}
.sr-stage {
  position: relative;
  display: flex; flex-direction: column; align-items: center; gap: 12px;
  width: min(680px, 94vw);
  max-height: 92vh;
  padding: 18px 24px 20px;
  background: rgba(10, 14, 18, 0.95);
  border: 2px solid rgba(255, 213, 79, 0.3);
  border-radius: 14px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.7);
  overflow: hidden;
}
.sr-head { display: flex; align-items: center; justify-content: space-between; width: 100%; }
.sr-title { font-size: 18px; font-weight: 900; letter-spacing: 2px; color: #ffd54f; }
.sr-controls { display: flex; gap: 8px; }
.sr-ctrl {
  height: 28px; padding: 0 12px;
  border-radius: 6px;
  border: 1px solid #3d5a54;
  background: rgba(14, 26, 23, 0.9);
  color: #9fc0b4;
  font-family: inherit; font-size: 12px; font-weight: 800;
  cursor: pointer;
}
.sr-ctrl:hover { filter: brightness(1.3); }
.sr-ctrl.primary { border-color: #f4c14f; color: #f4c14f; }
.sr-ctrl:disabled { opacity: 0.4; cursor: default; }

.sr-boss { position: relative; display: flex; align-items: center; justify-content: center; }
.sr-dmg-float {
  position: absolute; right: -56px; top: 20%;
  font-size: 26px; font-weight: 900; color: #ff5252;
  text-shadow: 0 2px 0 #000;
  animation: dmgRise 0.9s ease-out forwards;
}
@keyframes dmgRise {
  0% { opacity: 0; transform: translateY(10px) scale(0.7); }
  20% { opacity: 1; transform: translateY(0) scale(1.15); }
  100% { opacity: 0; transform: translateY(-34px) scale(1); }
}
.sr-dmg-enter-active, .sr-dmg-leave-active { transition: opacity 0.2s; }

.sr-reels { display: flex; gap: 10px; min-height: 96px; align-items: center; }
.sr-reel { position: relative; width: 64px; height: 86px; }
.sr-reel-empty {
  width: 64px; height: 86px;
  border: 2px dashed rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.3);
}
.sr-reel.pop { animation: reelPop 0.24s cubic-bezier(0.34, 1.56, 0.64, 1); }
@keyframes reelPop {
  0% { transform: translateY(-26px) scale(0.6); opacity: 0; }
  100% { transform: none; opacity: 1; }
}
.sr-reel.phantom :deep(.pc-card) { opacity: 0.45; filter: saturate(0.4); }
.sr-reel.phantom::after {
  content: '幻影';
  position: absolute; bottom: -4px; left: 50%; transform: translateX(-50%);
  font-size: 9px; color: #8fa39c;
}

.sr-hand-banner {
  display: flex; align-items: baseline; gap: 12px;
  padding: 6px 18px;
  background: linear-gradient(160deg, rgba(255, 213, 79, 0.16), rgba(255, 213, 79, 0.05));
  border: 2px solid #ffd54f;
  border-radius: 10px;
  animation: handPop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes handPop {
  0% { transform: scale(0.5); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}
.sr-hand-name { font-size: 20px; font-weight: 900; color: #ffd54f; letter-spacing: 2px; }
.sr-hand-score { font-size: 15px; font-weight: 900; color: #e8f0ec; }
.sr-hand-enter-active, .sr-hand-leave-active { transition: opacity 0.25s, transform 0.25s; }
.sr-hand-enter-from, .sr-hand-leave-to { opacity: 0; transform: scale(0.8); }

.sr-boss-banner {
  padding: 5px 14px;
  background: rgba(60, 20, 40, 0.85);
  border: 2px solid #c86ef0;
  border-radius: 8px;
  font-size: 13px; font-weight: 800; color: #f0c8ff;
  animation: handPop 0.3s;
}

.sr-jokers { display: flex; gap: 8px; min-height: 54px; }
.sr-joker { border-radius: 6px; transition: filter 0.15s; }
.sr-joker.firing { filter: drop-shadow(0 0 10px rgba(255, 213, 79, 0.9)); }

.sr-log {
  width: 100%;
  height: 108px;
  overflow-y: auto;
  padding: 8px 10px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  font-size: 12px; line-height: 1.7;
}
.sr-log-line { color: #c9d9c9; }
.sr-log-line.warn { color: #ffab91; font-weight: 700; }
.sr-log-line.good { color: #4fe0b0; }
.sr-log-line.joker { color: #ffd54f; }
.sr-log-line.total { color: #ff8787; font-weight: 900; }
.sr-log-line.dim { color: #5a6f68; }

.sr-summary {
  display: flex; gap: 18px; align-items: center;
  font-size: 14px; color: #e8f0ec;
}
.sr-total { font-size: 22px; color: #ff5252; }
.sr-pressure { color: #ff5252; letter-spacing: 2px; }

.sr-settlement {
  width: 100%;
  padding: 10px 14px;
  border-radius: 10px;
  border: 2px solid;
  text-align: center;
}
.sr-settlement.won { border-color: #ffd54f; background: rgba(60, 48, 10, 0.5); }
.sr-settlement.lost { border-color: #ff6b6b; background: rgba(60, 16, 16, 0.5); }
.sr-set-title { font-size: 18px; font-weight: 900; margin-bottom: 4px; }
.sr-settlement.won .sr-set-title { color: #ffd54f; }
.sr-settlement.lost .sr-set-title { color: #ff8787; }
.sr-set-line { font-size: 12px; color: #c9d9c9; }
</style>
