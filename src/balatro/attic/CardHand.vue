<template>
  <div class="hand-area">
    <div class="hand-fan" :style="{ '--n': hand.length }">
      <PlayingCard
        v-for="(card, i) in hand"
        :key="card.id"
        :card="card"
        kind="playing"
        :edition="card.edition"
        :selected="selected.includes(card.id)"
        :face-down="card.faceDown"
        :dealt="dealtIds.has(card.id)"
        :deal-delay="dealIndex(card) * 40"
        :width="cardWidth"
        :style="fanStyle(i)"
        @click="$emit('toggle', card.id)"
      />
    </div>
    <div class="hand-tools">
      <button class="bt-btn" @click="$emit('sort', 'rank')">按点数</button>
      <button class="bt-btn" @click="$emit('sort', 'suit')">按花色</button>
      <span class="sel-count">{{ selected.length }}/5</span>
    </div>
  </div>
</template>

<script setup>
// CardHand（§3.4）：手牌区 —— 扇形排布、stagger 发牌、点击选中（≤5）、排序
import { computed, ref, watch } from 'vue'
import PlayingCard from './PlayingCard.vue'

const props = defineProps({
  hand: { type: Array, default: () => [] },
  selected: { type: Array, default: () => [] },
  cardWidth: { type: Number, default: 71 },
})
defineEmits(['toggle', 'sort'])

// 发牌动画：追踪新进入手牌的 id，一次性播放
const dealtIds = ref(new Set())
const dealtOrder = ref(new Map())
watch(() => props.hand.map(c => c.id).join(','), (now, prev) => {
  const oldIds = new Set((prev || '').split(','))
  const fresh = props.hand.filter(c => !oldIds.has(c.id)).map(c => c.id)
  if (fresh.length) {
    const s = new Set(dealtIds.value)
    const m = new Map(dealtOrder.value)
    fresh.forEach((id, i) => { s.add(id); m.set(id, i) })
    dealtIds.value = s
    dealtOrder.value = m
    setTimeout(() => {
      const s2 = new Set(dealtIds.value)
      fresh.forEach(id => s2.delete(id))
      dealtIds.value = s2
    }, fresh.length * 40 + 500)
  }
}, { immediate: true })

function dealIndex(card) {
  return dealtOrder.value.get(card.id) ?? 0
}

// 扇形排布：中间低两边高的弧形 + 旋转
function fanStyle(i) {
  const n = props.hand.length
  const mid = (n - 1) / 2
  const off = i - mid
  return {
    transform: `translateY(${Math.abs(off) * 6}px) rotate(${off * 2.2}deg)`,
    zIndex: i,
    marginLeft: i === 0 ? '0' : overlap.value,
  }
}
const overlap = computed(() => {
  const n = props.hand.length
  if (n <= 7) return '4px'
  return `${Math.max(-28, 8 - n * 4)}px`
})
</script>

<style scoped>
.hand-area {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
}
.hand-fan {
  display: flex; align-items: flex-end; justify-content: center;
  min-height: 130px;
  transition: all 0.25s ease;
}
.hand-fan > * { transition: transform 0.2s ease, margin 0.2s ease; }
.hand-tools { display: flex; gap: 8px; align-items: center; }
.sel-count { color: #c9d9c9; font-weight: 700; font-size: 13px; }
</style>
