<template>
  <div class="score-panel">
    <!-- Ante / 盲注徽章 -->
    <div class="sp-ante">
      <div class="ante-label">ANTE</div>
      <div class="ante-num">{{ ante }}</div>
    </div>
    <div class="sp-blind" :class="'blind-' + blindKind">
      <div class="blind-name">{{ blindName }}</div>
      <div class="blind-target">
        <span class="t-label">目标</span>
        <span class="t-val">{{ fmt(target) }}</span>
      </div>
      <div class="blind-progress">
        <div class="bp-fill" :style="{ width: progress + '%' }"></div>
        <span class="bp-text">{{ fmt(score) }}</span>
      </div>
    </div>

    <!-- 本手得分预览 -->
    <div class="sp-score">
      <div class="sc-row">
        <div class="sc-box chips">{{ fmt(lastChips) }}</div>
        <div class="sc-x">×</div>
        <div class="sc-box mult">{{ fmt(lastMult) }}</div>
      </div>
      <div class="sc-total">{{ fmt(lastTotal) }}</div>
    </div>

    <!-- 次数 / 金钱 -->
    <div class="sp-stats">
      <div class="stat"><span class="s-icon">🂡</span><span class="s-val">{{ handsLeft }}</span><span class="s-label">出牌</span></div>
      <div class="stat"><span class="s-icon">🗑</span><span class="s-val">{{ discardsLeft }}</span><span class="s-label">弃牌</span></div>
      <div class="stat money"><span class="s-icon">$</span><span class="s-val">{{ money }}</span><span class="s-label">金钱</span></div>
    </div>

    <!-- 牌型等级表 -->
    <div class="sp-hands" v-if="showHands">
      <div
        v-for="h in handRows"
        :key="h.id"
        class="hand-row"
        :class="{ active: h.id === currentHandType, 'lv-flash': flashedHands.has(h.id) }"
      >
        <span class="h-name">{{ h.name }} <em>Lv.{{ h.level }}</em></span>
        <span class="h-val">{{ h.chips }}×{{ h.mult }}</span>
      </div>
    </div>
    <button class="bt-btn sm sp-toggle" @click="showHands = !showHands">{{ showHands ? '收起牌型' : '牌型信息' }}</button>
  </div>
</template>

<script setup>
// ScorePanel（§3）：左侧信息面板 —— Ante/盲注/目标进度/得分/次数/金钱/牌型等级
import { ref, computed, watch } from 'vue'
import { HANDS, handScore } from '../data/hands.js'

const props = defineProps({
  ante: { type: Number, default: 1 },
  blindName: { type: String, default: '' },
  blindKind: { type: String, default: 'small' }, // small|big|boss
  target: { type: Number, default: 300 },
  score: { type: Number, default: 0 },
  handsLeft: { type: Number, default: 4 },
  discardsLeft: { type: Number, default: 3 },
  money: { type: Number, default: 4 },
  handLevels: { type: Object, default: () => ({}) },
  currentHandType: { type: String, default: null },
  lastChips: { type: Number, default: 0 },
  lastMult: { type: Number, default: 0 },
  lastTotal: { type: Number, default: 0 },
})

const showHands = ref(false)
const progress = computed(() => Math.min(100, (props.score / props.target) * 100))

// 星球牌升级反馈：等级变化的牌型行闪烁
const flashedHands = ref(new Set())
let flashTimer = null
watch(() => ({ ...props.handLevels }), (now, prev) => {
  const changed = Object.keys(now).filter(k => (now[k] || 1) > (prev?.[k] ?? 1))
  if (!changed.length) return
  flashedHands.value = new Set(changed)
  showHands.value = true // 升级时自动展开牌型表
  if (flashTimer) clearTimeout(flashTimer)
  flashTimer = setTimeout(() => { flashedHands.value = new Set() }, 1100)
})

const handRows = computed(() =>
  HANDS.filter(h => !h.secret || (props.handLevels[h.id] || 0) > 1 || h.played).map(h => {
    const lv = props.handLevels[h.id] || 1
    const s = handScore(h.id, lv)
    return { id: h.id, name: h.name, level: lv, chips: s.chips, mult: s.mult }
  })
)

function fmt(n) {
  if (n === undefined || n === null) return '0'
  if (n >= 1e12) return n.toExponential(2)
  return Math.round(n).toLocaleString('en-US')
}
</script>

<style scoped>
.score-panel {
  width: 210px;
  display: flex; flex-direction: column; gap: 10px;
  font-family: 'Arial Black', 'PingFang SC', sans-serif;
}
.sp-ante {
  display: flex; align-items: center; gap: 8px;
  background: rgba(0,0,0,0.45); border-radius: 8px; padding: 6px 10px;
}
.ante-label { color: #e0a040; font-size: 12px; letter-spacing: 2px; }
.ante-num { color: #fff; font-size: 24px; }
.sp-blind {
  background: rgba(0,0,0,0.45); border-radius: 8px; padding: 8px 10px;
  border-left: 4px solid #50a0ff;
}
.sp-blind.blind-big { border-left-color: #e0a040; }
.sp-blind.blind-boss { border-left-color: #e04040; }
.blind-name { color: #fff; font-size: 15px; }
.blind-target { display: flex; justify-content: space-between; margin-top: 4px; }
.t-label { color: #9ab; font-size: 12px; }
.t-val { color: #ffd700; font-size: 14px; }
.blind-progress {
  position: relative; height: 18px; margin-top: 6px;
  background: rgba(255,255,255,0.12); border-radius: 9px; overflow: hidden;
}
.bp-fill {
  height: 100%; border-radius: 9px;
  background: linear-gradient(90deg, #2e7d32, #66bb6a);
  transition: width 0.4s ease;
}
.bp-text {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 11px; text-shadow: 0 1px 2px #000;
}
.sp-score { background: rgba(0,0,0,0.45); border-radius: 8px; padding: 8px 10px; text-align: center; }
.sc-row { display: flex; align-items: center; justify-content: center; gap: 6px; }
.sc-box { min-width: 62px; padding: 4px 8px; border-radius: 6px; font-size: 18px; }
.sc-box.chips { background: #1a4a8a; color: #7ec3ff; }
.sc-box.mult { background: #8a1a2a; color: #ff9e9e; }
.sc-x { color: #fff; font-size: 16px; }
.sc-total { color: #fff; font-size: 26px; margin-top: 4px; text-shadow: 0 2px 4px #000; }
.sp-stats { display: flex; gap: 6px; }
.stat {
  flex: 1; display: flex; flex-direction: column; align-items: center;
  background: rgba(0,0,0,0.45); border-radius: 8px; padding: 6px 2px;
}
.s-icon { font-size: 13px; color: #9ab; }
.s-val { color: #fff; font-size: 18px; }
.s-label { font-size: 10px; color: #9ab; }
.stat.money .s-val { color: #ffd700; }
.sp-hands {
  background: rgba(0,0,0,0.5); border-radius: 8px; padding: 6px 8px;
  max-height: 220px; overflow-y: auto;
}
.hand-row {
  display: flex; justify-content: space-between; padding: 2px 4px;
  font-size: 11px; color: #b9c9b9; border-radius: 4px;
}
.hand-row.active { background: rgba(80,160,255,0.25); color: #fff; }
.hand-row.lv-flash { animation: lvFlash 1.05s ease-out; color: #fff; }
@keyframes lvFlash {
  0% { background: rgba(255, 213, 79, 0.75); box-shadow: 0 0 14px rgba(255, 213, 79, 0.6); }
  100% { background: transparent; box-shadow: none; }
}
.h-name em { color: #e0a040; font-style: normal; margin-left: 2px; }
.h-val { font-weight: 700; }
.sp-toggle { align-self: center; }
</style>
