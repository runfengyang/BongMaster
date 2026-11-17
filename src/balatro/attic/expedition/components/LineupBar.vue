<template>
  <div class="lb">
    <!-- 阵容栏（小丑，拖拽排序 = 触发顺序） -->
    <div class="lb-row-wrap">
      <div class="lb-label">阵容<span class="lb-count">{{ jokers.length }}/{{ jokerSlots }}</span></div>
      <div class="lb-row">
        <div
          v-for="(j, i) in jokers"
          :key="j.uid"
          class="lb-slot filled"
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
          <div class="lb-tip">
            <div class="t-name">{{ defOf(j.id)?.name }}</div>
            <div class="t-text">{{ defOf(j.id)?.text }}</div>
            <div v-if="stateText(j)" class="t-state">{{ stateText(j) }}</div>
            <div class="t-order">触发顺位 #{{ i + 1 }} · 拖拽调整</div>
          </div>
        </div>
        <div v-for="k in emptyJokerSlots" :key="'ej' + k" class="lb-slot empty"></div>
      </div>
    </div>

    <!-- 消耗牌栏 -->
    <div class="lb-row-wrap">
      <div class="lb-label">消耗<span class="lb-count">{{ consumables.length }}/{{ consumableSlots }}</span></div>
      <div class="lb-row">
        <div v-for="c in consumables" :key="c.uid" class="lb-slot filled sm-slot">
          <PlayingCard
            :def="defOf(c.id)"
            :kind="defOf(c.id)?.type || 'tarot'"
            :edition="c.edition"
            :width="52"
            @click="$emit('consumableClick', c)"
          />
          <div class="lb-tip">
            <div class="t-name">{{ defOf(c.id)?.name }}</div>
            <div class="t-text">{{ defOf(c.id)?.text }}</div>
            <div class="t-actions">
              <button class="bt-btn sm" @click.stop="$emit('useConsumable', c.uid)">使用</button>
            </div>
          </div>
        </div>
        <div v-for="k in emptyConsumableSlots" :key="'ec' + k" class="lb-slot empty sm-slot"></div>
      </div>
    </div>
  </div>
</template>

<script setup>
// LineupBar（契约 §6）：远征阵容栏（5 卡位拖拽排序）+ 消耗牌栏
// 拖拽逻辑抄自 attic/JokerBar.vue（HTML5 drag: start 记 from / over 记 over / drop emit reorder）
import { ref, computed } from 'vue'
import PlayingCard from '../../../components/PlayingCard.vue'
import { BY_ID } from '../../../data/index.js'

const props = defineProps({
  jokers: { type: Array, default: () => [] },
  consumables: { type: Array, default: () => [] },
  jokerSlots: { type: Number, default: 5 },
  consumableSlots: { type: Number, default: 2 },
})
const emit = defineEmits(['jokerClick', 'consumableClick', 'useConsumable', 'reorder'])

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
function stateText(j) {
  const s = j.state || {}
  const parts = []
  if (s.mult) parts.push(`+${s.mult} 倍率`)
  if (s.chips) parts.push(`+${s.chips} 筹码`)
  if (s.xMult && s.xMult !== 1) parts.push(`×${s.xMult} 倍率`)
  return parts.join('，')
}
</script>

<style scoped>
.lb { display: flex; flex-direction: column; gap: 8px; }
.lb-row-wrap { display: flex; align-items: flex-end; gap: 8px; }
.lb-label {
  display: flex; flex-direction: column; align-items: center; gap: 1px;
  font-size: 11px; font-weight: 900; letter-spacing: 2px; color: #8fa39c;
  writing-mode: vertical-lr;
  padding-bottom: 2px;
}
.lb-count { font-size: 10px; color: #c9d9c9; letter-spacing: 0; }
.lb-row { display: flex; gap: 6px; align-items: flex-end; }
.lb-slot { position: relative; }
.lb-slot.empty {
  width: 62px; height: 83px;
  border: 2px dashed rgba(255, 255, 255, 0.25);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.25);
}
.lb-slot.empty.sm-slot { width: 52px; height: 70px; }
.lb-slot.drag-over :deep(.pc-wrap) { transform: translateY(-6px); }
.lb-slot.debuffed :deep(.pc-card) { filter: grayscale(1) brightness(0.55); }
.lb-slot.debuffed::after {
  content: '禁用';
  position: absolute; top: -7px; right: -7px;
  font-size: 9px; font-weight: 900; color: #ffcdd2;
  background: rgba(122, 31, 31, 0.9);
  border: 1px solid rgba(239, 154, 154, 0.6);
  padding: 1px 5px; border-radius: 6px;
  pointer-events: none;
}
.lb-tip {
  position: absolute; bottom: 105%; left: 50%; transform: translateX(-50%);
  width: 190px; background: rgba(10, 14, 12, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 8px;
  padding: 8px 10px; z-index: 30; pointer-events: none;
  opacity: 0; transition: opacity 0.15s;
  text-align: left;
}
.lb-slot:hover .lb-tip { opacity: 1; pointer-events: auto; }
.t-name { color: #fff; font-weight: 900; font-size: 13px; }
.t-text { color: #c9d9c9; font-size: 12px; margin-top: 4px; line-height: 1.4; }
.t-state { color: #50a0ff; font-size: 12px; margin-top: 3px; font-weight: 700; }
.t-order { color: #8fa39c; font-size: 10px; margin-top: 4px; }
.t-actions { display: flex; gap: 6px; margin-top: 6px; }
</style>
