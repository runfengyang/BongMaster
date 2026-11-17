<template>
  <div class="joker-bar">
    <!-- 小丑栏 -->
    <div class="jb-row">
      <div
        v-for="(j, i) in jokers"
        :key="j.uid"
        class="jb-slot filled"
        :class="{ 'drag-over': dragOver === i, debuffed: j.debuffed }"
        draggable="true"
        @dragstart="onDragStart(i, $event)"
        @dragover.prevent="dragOver = i"
        @dragleave="dragOver = -1"
        @drop.prevent="onDrop(i)"
        @dragend="dragOver = -1"
      >
        <PlayingCard
          :def="defOf(j.id)"
          kind="joker"
          :edition="j.edition"
          :width="62"
          @click="$emit('jokerClick', j, i)"
        />
        <div class="jb-tip">
          <div class="t-name">{{ defOf(j.id)?.name }} <span class="t-sell">${{ sellValue(j) }}</span></div>
          <div class="t-text">{{ defOf(j.id)?.text }}</div>
          <div v-if="stateText(j)" class="t-state">{{ stateText(j) }}</div>
          <button class="bt-btn sm" @click.stop="$emit('sellJoker', i)">卖出</button>
        </div>
      </div>
      <div v-for="k in emptyJokerSlots" :key="'ej' + k" class="jb-slot empty"></div>
      <div class="jb-count">{{ jokers.length }}/{{ jokerSlots }}</div>
    </div>
    <!-- 消耗牌栏 -->
    <div class="jb-row">
      <div v-for="(c, i) in consumables" :key="c.uid" class="jb-slot filled sm-slot">
        <PlayingCard
          :def="defOf(c.id)"
          :kind="defOf(c.id)?.type || 'tarot'"
          :edition="c.edition"
          :width="52"
          @click="$emit('consumableClick', c, i)"
        />
        <div class="jb-tip">
          <div class="t-name">{{ defOf(c.id)?.name }} <span class="t-sell">${{ sellValue(c) }}</span></div>
          <div class="t-text">{{ defOf(c.id)?.text }}</div>
          <div class="t-actions">
            <button class="bt-btn sm" @click.stop="$emit('useConsumable', i)">使用</button>
            <button class="bt-btn sm" @click.stop="$emit('sellConsumable', i)">卖出</button>
          </div>
        </div>
      </div>
      <div v-for="k in emptyConsumableSlots" :key="'ec' + k" class="jb-slot empty sm-slot"></div>
      <div class="jb-count">{{ consumables.length }}/{{ consumableSlots }}</div>
    </div>
  </div>
</template>

<script setup>
// JokerBar：小丑栏 + 消耗牌栏（拖拽重排 / 悬停详情 / 卖出）
import { ref, computed } from 'vue'
import PlayingCard from './PlayingCard.vue'
import { BY_ID, baseSellValue } from '../data/index.js'

const props = defineProps({
  jokers: { type: Array, default: () => [] },
  consumables: { type: Array, default: () => [] },
  jokerSlots: { type: Number, default: 5 },
  consumableSlots: { type: Number, default: 2 },
})
const emit = defineEmits(['jokerClick', 'consumableClick', 'sellJoker', 'sellConsumable', 'useConsumable', 'reorder'])

const dragFrom = ref(-1)
const dragOver = ref(-1)
function onDragStart(i, e) {
  dragFrom.value = i
  e.dataTransfer.effectAllowed = 'move'
}
function onDrop(i) {
  if (dragFrom.value >= 0 && dragFrom.value !== i) emit('reorder', dragFrom.value, i)
  dragFrom.value = -1
  dragOver.value = -1
}

const emptyJokerSlots = computed(() => Math.max(0, props.jokerSlots - props.jokers.length))
const emptyConsumableSlots = computed(() => Math.max(0, props.consumableSlots - props.consumables.length))

function defOf(id) { return BY_ID[id] }
function sellValue(item) {
  const def = defOf(item.id)
  return baseSellValue(def || { cost: 2 }, item.edition) + (item.sellBonus || 0)
}
function stateText(j) {
  const s = j.state || {}
  const parts = []
  if (s.mult) parts.push(`+${s.mult} 倍率`)
  if (s.chips) parts.push(`+${s.chips} 筹码`)
  if (s.xMult && s.xMult !== 1) parts.push(`×${s.xMult} 倍率`)
  if (s.payout) parts.push(`$${s.payout}`)
  if (s.rounds !== undefined && j.id === 'j_invisible_joker') parts.push(`${s.rounds}/2 回合`)
  return parts.join('，')
}
</script>

<style scoped>
.joker-bar { display: flex; flex-direction: column; gap: 6px; }
.jb-row { display: flex; gap: 6px; align-items: flex-end; }
.jb-slot { position: relative; }
.jb-slot.empty {
  width: 62px; height: 83px;
  border: 2px dashed rgba(255,255,255,0.25);
  border-radius: 6px;
  background: rgba(0,0,0,0.25);
}
.jb-slot.empty.sm-slot { width: 52px; height: 70px; }
.jb-slot.drag-over :deep(.pc-wrap) { transform: translateY(-6px); }
/* Boss 禁用（绯红之心等）：小丑变灰 */
.jb-slot.debuffed :deep(.pc-card) { filter: grayscale(1) brightness(0.55); }
.jb-slot.debuffed::after {
  content: '禁用';
  position: absolute; top: -7px; right: -7px;
  font-size: 9px; font-weight: 900; color: #ffcdd2;
  background: rgba(122, 31, 31, 0.9);
  border: 1px solid rgba(239, 154, 154, 0.6);
  padding: 1px 5px; border-radius: 6px;
  pointer-events: none;
}
.jb-count { color: #c9d9c9; font-size: 12px; font-weight: 700; align-self: center; }
.jb-tip {
  position: absolute; bottom: 105%; left: 50%; transform: translateX(-50%);
  width: 190px; background: rgba(10,14,12,0.95);
  border: 1px solid rgba(255,255,255,0.2); border-radius: 8px;
  padding: 8px 10px; z-index: 30; pointer-events: none;
  opacity: 0; transition: opacity 0.15s;
}
.jb-slot:hover .jb-tip { opacity: 1; pointer-events: auto; }
.t-name { color: #fff; font-weight: 900; font-size: 13px; display: flex; justify-content: space-between; }
.t-sell { color: #ffd700; }
.t-text { color: #c9d9c9; font-size: 12px; margin-top: 4px; line-height: 1.4; }
.t-state { color: #50a0ff; font-size: 12px; margin-top: 3px; font-weight: 700; }
.t-actions { display: flex; gap: 6px; margin-top: 6px; }
.jb-tip .bt-btn.sm { margin-top: 6px; }
.t-actions .bt-btn.sm { margin-top: 0; }
</style>
