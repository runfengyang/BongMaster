<template>
  <div class="rs-overlay" :class="{ 'screen-shake': screenShake }" @click="fast = true">
    <div class="rs-stage">
      <!-- 牌型标签 -->
      <div class="rs-hand-label" :class="{ show: handLabel }">
        {{ handLabel }}<span v-if="handLevel" class="rs-lv">Lv.{{ handLevel }}</span>
      </div>

      <!-- 出牌阵列 -->
      <div class="rs-cards">
        <PlayingCard
          v-for="pc in playedCards"
          :key="pc.card.id"
          :ref="setCardRef"
          :card="pc.card"
          :def="pc.def"
          kind="playing"
          :edition="pc.card.edition || 'none'"
          :selectable="false"
          :width="cardWidth"
        />
      </div>

      <!-- 小丑触发区 -->
      <div class="rs-jokers">
        <div
          v-for="j in jokers"
          :key="j.joker.uid"
          :data-juid="j.joker.uid"
          class="rs-joker"
          :class="{ firing: firingJoker === j.joker.uid }"
          :style="artStyle(j.def)"
        >
          <span class="rs-joker-motif">{{ j.def?.motif || '🃏' }}</span>
          <span class="rs-joker-name">{{ j.def?.name || j.joker.id }}</span>
          <span v-for="(f, i) in jokerFloats[j.joker.uid] || []" :key="i" class="rs-jfloat" :class="f.kind">{{ f.text }}</span>
        </div>
      </div>

      <!-- 运行 chips × mult -->
      <div class="rs-tally" :class="{ bump: tallyBump }">
        <span class="rs-tally-chips">{{ Math.round(dispChips) }}</span>
        <span class="rs-tally-x">×</span>
        <span class="rs-tally-mult">{{ fmtMult(dispMult) }}</span>
      </div>

      <!-- Plasma 平衡提示 -->
      <div v-if="plasmaNote" class="rs-plasma">{{ plasmaNote }}</div>

      <!-- 最终结算撞击 -->
      <div v-if="finalShown" class="rs-final">
        <div class="rs-final-line">
          <span class="rs-final-chips">{{ Math.round(finalChips) }}</span>
          <span class="rs-final-x">×</span>
          <span class="rs-final-mult">{{ fmtMult(finalMult) }}</span>
          <span class="rs-final-eq">=</span>
          <span class="rs-final-total">{{ Math.round(finalTotal).toLocaleString() }}</span>
        </div>
        <div v-if="target > 0" class="rs-final-sub">
          本手得分 {{ Math.round(finalTotal).toLocaleString() }} / 目标 {{ target.toLocaleString() }}
        </div>
      </div>

      <div class="rs-skip-hint">点击加速</div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import PlayingCard from './PlayingCard.vue';
import { sound } from '../sound.js';

const props = defineProps({
  events: { type: Array, required: true },            // engine scoreEvents
  playedCards: { type: Array, default: () => [] },    // [{ card, def }] 快照
  jokers: { type: Array, default: () => [] },         // [{ joker, def }] 快照
  target: { type: Number, default: 0 },
  cardWidth: { type: Number, default: 80 },
});
const emit = defineEmits(['done']);

const handLabel = ref('');
const handLevel = ref(0);
const dispChips = ref(0);
const dispMult = ref(0);
const tallyBump = ref(false);
const firingJoker = ref(null);
const jokerFloats = ref({});
const plasmaNote = ref('');
const finalShown = ref(false);
const finalChips = ref(0);
const finalMult = ref(0);
const finalTotal = ref(0);
const screenShake = ref(false);
const fast = ref(false);

const cardRefs = new Map();
function setCardRef(el) {
  // script setup 组件实例是封闭的：经 $props 读取 card.id
  const id = el?.$props?.card?.id ?? el?.card?.id;
  if (id) cardRefs.set(id, el);
}

function artStyle(def) {
  if (!def) return {};
  return { background: `linear-gradient(160deg, ${def.art?.bg?.[0] || '#37474f'}, ${def.art?.bg?.[1] || '#101821'})` };
}
function fmtMult(v) {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pace = (ms) => sleep(fast.value ? Math.max(40, ms * 0.18) : ms);

function bumpTally() {
  tallyBump.value = false;
  requestAnimationFrame(() => { tallyBump.value = true; });
}
function pushJokerFloat(uid, text, kind) {
  const arr = jokerFloats.value[uid] ? [...jokerFloats.value[uid]] : [];
  arr.push({ text, kind });
  jokerFloats.value = { ...jokerFloats.value, [uid]: arr.slice(-3) };
}
function playValueSounds(e) {
  if (e.money) sound.coin();
  else if (e.xmult && e.xmult !== 1) sound.xmult();
  else if (e.mult) sound.mult();
  else if (e.chips) sound.chips();
}
function floatForValue(e) {
  if (e.xmult && e.xmult !== 1) return { text: `×${e.xmult} 倍率`, kind: 'xmult' };
  if (e.mult) return { text: `+${e.mult} 倍率`, kind: 'mult' };
  if (e.money) return { text: `+$${e.money}`, kind: 'money' };
  if (e.chips) return { text: `+${e.chips}`, kind: 'chips' };
  return null;
}

let playToken = 0;

async function play() {
  const token = ++playToken;
  const alive = () => token === playToken;
  // 重置
  handLabel.value = ''; handLevel.value = 0;
  dispChips.value = 0; dispMult.value = 0;
  firingJoker.value = null; jokerFloats.value = {};
  plasmaNote.value = ''; finalShown.value = false; screenShake.value = false;
  fast.value = false;
  cardRefs.clear();

  await pace(350);

  for (const e of props.events) {
    if (!alive()) return;
    switch (e.type) {
      case 'handEvaluated':
        handLabel.value = e.label; handLevel.value = e.level;
        sound.flip();
        await pace(420);
        break;

      case 'cardScore': {
        const inst = cardRefs.get(e.cardId);
        if (inst) {
          const f = floatForValue(e);
          inst.shake();
          if (f) inst.floatText(f.text, f.kind);
        }
        if (e.chips) dispChips.value += e.chips;
        if (e.mult) dispMult.value += e.mult;
        if (e.xmult) dispMult.value *= e.xmult;
        bumpTally(); playValueSounds(e);
        await pace(430);
        break;
      }
      case 'heldCard': {
        // 手牌留存触发（如 Raising Fist / Baron / Steel）：直接累积，牌型标签处无单卡抖动
        const f = floatForValue(e);
        if (f) {
          if (e.chips) dispChips.value += e.chips;
          if (e.mult) dispMult.value += e.mult;
          if (e.xmult) dispMult.value *= e.xmult;
          bumpTally(); playValueSounds(e);
        }
        await pace(260);
        break;
      }
      case 'jokerTrigger': {
        firingJoker.value = e.jokerId;
        const f = floatForValue(e);
        if (f) pushJokerFloat(e.jokerId, f.text, f.kind);
        else if (e.message) pushJokerFloat(e.jokerId, e.message, 'chips');
        if (e.copiedById) pushJokerFloat(e.copiedById, '复制!', 'xmult');
        if (e.chips) dispChips.value += e.chips;
        if (e.mult) dispMult.value += e.mult;
        if (e.xmult) dispMult.value *= e.xmult;
        bumpTally(); playValueSounds(e);
        await pace(400);
        firingJoker.value = null;
        break;
      }
      case 'glassBreak': {
        const inst = cardRefs.get(e.cardId);
        if (inst) inst.floatText('破碎!', 'xmult');
        sound.glassBreak();
        await pace(320);
        break;
      }
      case 'plasmaBalance': {
        plasmaNote.value = `等离子平衡：${Math.round(e.beforeChips)} × ${fmtMult(e.beforeMult)} → ${Math.round(e.afterChips)} × ${fmtMult(e.afterMult)}`;
        dispChips.value = e.afterChips; dispMult.value = e.afterMult;
        bumpTally(); sound.xmult();
        await pace(650);
        break;
      }
      case 'final': {
        finalChips.value = e.chips; finalMult.value = e.mult; finalTotal.value = e.total;
        dispChips.value = e.chips; dispMult.value = e.mult;
        finalShown.value = true;
        sound.slam();
        if (props.target > 0 && e.total > props.target * 0.5) {
          screenShake.value = true;
          setTimeout(() => { screenShake.value = false; }, 500);
        }
        await pace(1100);
        break;
      }
      default:
        break;
    }
  }

  if (!alive()) return;
  await pace(500);
  emit('done');
}

watch(() => props.events, (evts) => {
  if (evts && evts.length) play();
}, { immediate: true });

onBeforeUnmount(() => { playToken++; });
</script>

<style scoped>
.rs-overlay {
  position: absolute; inset: 0; z-index: 40;
  display: flex; align-items: center; justify-content: center;
  background: rgba(6, 12, 11, 0.55);
  backdrop-filter: blur(2px);
}
.screen-shake { animation: screenShake 0.45s; }
@keyframes screenShake {
  0%, 100% { transform: translate(0, 0); }
  20% { transform: translate(-7px, 4px); }
  40% { transform: translate(6px, -5px); }
  60% { transform: translate(-5px, -3px); }
  80% { transform: translate(4px, 4px); }
}
.rs-stage {
  position: relative;
  display: flex; flex-direction: column; align-items: center; gap: 18px;
  padding: 28px 40px;
  min-width: min(720px, 90%);
}
.rs-hand-label {
  font-size: 26px; font-weight: 900; letter-spacing: 2px; color: #ffd54f;
  text-shadow: 0 2px 0 rgba(0,0,0,0.5), 0 0 18px rgba(255, 213, 79, 0.35);
  opacity: 0; transform: scale(0.8);
  transition: opacity 0.25s, transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.rs-hand-label.show { opacity: 1; transform: scale(1); }
.rs-lv { font-size: 15px; color: #80cbc4; margin-left: 8px; vertical-align: middle; }
.rs-cards { display: flex; gap: 12px; }
.rs-jokers { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; max-width: 640px; }
.rs-joker {
  position: relative;
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  padding: 8px 10px; border-radius: 8px;
  border: 2px solid rgba(255,255,255,0.15);
  min-width: 68px;
  transition: transform 0.15s, border-color 0.15s, box-shadow 0.15s;
}
.rs-joker.firing {
  transform: translateY(-8px) scale(1.08);
  border-color: #ffd54f;
  box-shadow: 0 0 18px rgba(255, 213, 79, 0.5);
  animation: jokerJig 0.32s;
}
@keyframes jokerJig {
  0%, 100% { rotate: 0deg; }
  30% { rotate: -4deg; }
  65% { rotate: 3deg; }
}
.rs-joker-motif { font-size: 20px; }
.rs-joker-name { font-size: 10px; color: #eceff1; max-width: 72px; text-align: center; }
.rs-jfloat {
  position: absolute; left: 50%; top: -6px;
  font-size: 13px; font-weight: 900; white-space: nowrap;
  animation: jfloatUp 0.9s ease-out forwards;
  pointer-events: none;
}
@keyframes jfloatUp {
  0% { opacity: 0; transform: translate(-50%, 6px) scale(0.7); }
  25% { opacity: 1; }
  100% { opacity: 0; transform: translate(-50%, -26px) scale(1.05); }
}
.rs-jfloat.chips { color: #6ec6ff; }
.rs-jfloat.mult { color: #ff8a65; }
.rs-jfloat.xmult { color: #ffd54f; }
.rs-jfloat.money { color: #ffe082; }

.rs-tally {
  display: flex; align-items: baseline; gap: 10px;
  font-weight: 900; font-size: 30px;
  padding: 8px 22px; border-radius: 10px;
  background: rgba(0, 0, 0, 0.45); border: 1px solid rgba(255,255,255,0.12);
}
.rs-tally.bump { animation: tallyPop 0.22s; }
@keyframes tallyPop { 50% { transform: scale(1.07); } }
.rs-tally-chips { color: #6ec6ff; }
.rs-tally-x { color: #90a4ae; font-size: 22px; }
.rs-tally-mult { color: #ff8a65; }
.rs-plasma { font-size: 13px; color: #ce93d8; font-weight: 700; }

.rs-final {
  text-align: center;
  animation: slamIn 0.38s cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes slamIn {
  0% { opacity: 0; transform: scale(2.2); }
  60% { opacity: 1; transform: scale(0.94); }
  100% { transform: scale(1); }
}
.rs-final-line { display: flex; align-items: baseline; gap: 12px; justify-content: center; font-weight: 900; }
.rs-final-chips { font-size: 34px; color: #6ec6ff; }
.rs-final-x, .rs-final-eq { font-size: 26px; color: #90a4ae; }
.rs-final-mult { font-size: 34px; color: #ff8a65; }
.rs-final-total {
  font-size: 46px; color: #ffd54f;
  text-shadow: 0 3px 0 rgba(0,0,0,0.5), 0 0 26px rgba(255, 213, 79, 0.45);
}
.rs-final-sub { margin-top: 6px; font-size: 13px; color: #b0bec5; }
.rs-skip-hint {
  position: absolute; bottom: 10px; right: 16px;
  font-size: 10px; color: rgba(255,255,255,0.35);
}
</style>
