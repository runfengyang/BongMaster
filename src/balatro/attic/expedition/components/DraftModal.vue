<template>
  <div class="dm-overlay">
    <div class="dm-stage">
      <div class="dm-title">起始构筑</div>
      <div v-if="draft.label" class="dm-label">{{ draft.label }}</div>

      <!-- 小丑 N 选 M -->
      <div class="dm-sec-head">选择 {{ draft.jokerChoose }} 张小丑</div>
      <div class="dm-row">
        <div
          v-for="(opt, i) in draft.jokerOptions"
          :key="'j' + i"
          class="dm-slot"
          :class="{ selected: jokerIdx === i }"
        >
          <PlayingCard
            :def="defOf(opt.id)"
            kind="joker"
            :edition="opt.edition"
            :width="86"
            @click="jokerIdx = i"
          />
          <div class="dm-opt-name">{{ defOf(opt.id)?.name }}</div>
          <div class="dm-opt-text">{{ defOf(opt.id)?.text }}</div>
        </div>
      </div>

      <!-- 扑克牌 N 选 M -->
      <div class="dm-sec-head">选择 {{ draft.cardChoose }} 张扑克牌（已选 {{ cardIdxs.length }}/{{ draft.cardChoose }}）</div>
      <div class="dm-row">
        <div
          v-for="(opt, i) in draft.cardOptions"
          :key="'c' + i"
          class="dm-slot"
          :class="{ selected: cardIdxs.includes(i) }"
        >
          <PlayingCard
            :card="opt.card"
            kind="playing"
            :edition="opt.card.edition"
            :width="86"
            @click="toggleCard(i)"
          />
          <div class="dm-opt-name">{{ cardName(opt.card) }}</div>
          <div v-if="opt.card.enhancement" class="dm-opt-text">{{ ENH_NAMES[opt.card.enhancement] || opt.card.enhancement }}</div>
        </div>
      </div>

      <div class="dm-bar">
        <button class="bt-btn primary lg" :disabled="!canConfirm" @click="confirm">
          出征！
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
// DraftModal（契约 §2.1/§6）：起始构筑 —— 小丑 3 选 1 + 扑克牌 5 选 2
import { ref, computed } from 'vue'
import PlayingCard from '../../../components/PlayingCard.vue'
import { BY_ID } from '../../../data/index.js'

const props = defineProps({
  draft: { type: Object, required: true }, // { jokerOptions, cardOptions, jokerChoose, cardChoose, label }
})
const emit = defineEmits(['confirm'])

const jokerIdx = ref(0)
const cardIdxs = ref([0, 1])

const canConfirm = computed(() =>
  jokerIdx.value >= 0 && cardIdxs.value.length === (props.draft.cardChoose || 2))

function toggleCard(i) {
  const at = cardIdxs.value.indexOf(i)
  if (at >= 0) {
    cardIdxs.value.splice(at, 1)
    return
  }
  if (cardIdxs.value.length >= (props.draft.cardChoose || 2)) cardIdxs.value.shift()
  cardIdxs.value.push(i)
}

function defOf(id) { return BY_ID[id] }

const R = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }
const S = { spades: '♠', hearts: '♥', clubs: '♣', diamonds: '♦' }
const ENH_NAMES = {
  bonus: '奖励牌', mult: '倍率牌', wild: '万能牌', glass: '玻璃牌',
  steel: '钢铁牌', stone: '石头牌', gold: '黄金牌', lucky: '幸运牌',
}
function cardName(c) {
  return `${R[c.rank] || c.rank}${S[c.suit] || ''}`
}

function confirm() {
  emit('confirm', { jokerIndex: jokerIdx.value, cardIndices: [...cardIdxs.value] })
}
</script>

<style scoped>
.dm-overlay {
  position: fixed; inset: 0; z-index: 60;
  display: flex; align-items: center; justify-content: center;
  background: rgba(4, 9, 8, 0.78);
  backdrop-filter: blur(4px);
  font-family: 'm6x11', 'PingFang SC', monospace;
}
.dm-stage {
  display: flex; flex-direction: column; align-items: center; gap: 12px;
  padding: 26px 34px; max-width: 860px;
  background: rgba(10, 14, 16, 0.92);
  border: 2px solid rgba(255, 213, 79, 0.35);
  border-radius: 14px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.65);
}
.dm-title { font-size: 26px; font-weight: 900; letter-spacing: 4px; color: #ffd54f; text-shadow: 0 2px 0 rgba(0,0,0,0.5); }
.dm-label { font-size: 12px; color: #8fa39c; }
.dm-sec-head { font-size: 14px; font-weight: 800; color: #c9d9c9; margin-top: 6px; }
.dm-row { display: flex; gap: 14px; }
.dm-slot {
  display: flex; flex-direction: column; align-items: center; gap: 5px;
  padding: 8px;
  border: 2px solid transparent; border-radius: 12px;
  cursor: pointer;
  transition: transform 0.15s, border-color 0.15s, background 0.15s;
}
.dm-slot:hover { transform: translateY(-4px); }
.dm-slot.selected {
  border-color: #ffd54f;
  background: rgba(255, 213, 79, 0.10);
  transform: translateY(-6px);
  box-shadow: 0 0 14px rgba(255, 213, 79, 0.35);
}
.dm-opt-name { font-size: 12px; font-weight: 800; color: #e8f0ec; }
.dm-opt-text { font-size: 10px; color: #8fa39c; max-width: 100px; text-align: center; line-height: 1.4; }
.dm-bar { margin-top: 10px; }
.bt-btn.lg { font-size: 16px; padding: 10px 34px; }
</style>
