<template>
  <div class="blind-select">
    <h2 class="bs-title">选择盲注 <span class="bs-ante">ANTE {{ ante }}</span></h2>
    <div class="bs-cards">
      <div
        v-for="(b, i) in blinds"
        :key="b.id"
        class="bs-card"
        :class="[b.kind, { current: b.current, done: b.done, upcoming: b.upcoming }]"
      >
        <div class="b-icon">{{ b.icon }}</div>
        <div class="b-name">{{ b.name }}</div>
        <div class="b-target">目标 <b>{{ fmt(b.target) }}</b></div>
        <div class="b-reward">奖励 ${{ b.reward }}</div>
        <div v-if="b.effectText" class="b-effect">{{ b.effectText }}</div>
        <div class="b-actions" v-if="b.current">
          <button class="bt-btn primary" @click="$emit('select')">迎战</button>
          <button v-if="b.kind !== 'boss'" class="bt-btn skip" @click="$emit('skip')">
            跳过<div class="tag-hint">🏷 {{ tagHint }}</div>
          </button>
        </div>
        <div v-else-if="b.done" class="b-stamp">✓</div>
      </div>
    </div>
    <div v-if="tags.length" class="bs-tags">
      <span class="tags-label">持有标签：</span>
      <span v-for="(t, i) in tags" :key="i" class="tag-chip">{{ t }}</span>
    </div>
  </div>
</template>

<script setup>
// BlindSelect：小盲/大盲/Boss 三卡选择（跳过获得标签）
import { computed } from 'vue'
import { SMALL_BLIND, BIG_BLIND, BLINDS_BY_ID, blindTarget } from '../data/blinds.js'
import { TAGS } from '../data/tags.js'

const props = defineProps({
  ante: { type: Number, default: 1 },
  blindIndex: { type: Number, default: 0 }, // 0 small / 1 big / 2 boss
  bossId: { type: String, default: null },
  plasma: { type: Boolean, default: false },
  tags: { type: Array, default: () => [] },
})
defineEmits(['select', 'skip'])

const BLIND_ICONS = { small: '👁', big: '👁‍🗨', boss: '💀' }

const blinds = computed(() => {
  const defs = [
    { ...SMALL_BLIND, kind: 'small' },
    { ...BIG_BLIND, kind: 'big' },
    { ...BLINDS_BY_ID[props.bossId], kind: 'boss' },
  ]
  return defs.map((d, i) => ({
    id: d.id,
    kind: defs[i].kind,
    icon: d.art?.motif || BLIND_ICONS[defs[i].kind],
    name: d.name,
    target: blindTarget(props.ante, d, props.plasma),
    reward: d.reward,
    effectText: defs[i].kind === 'boss' ? d.text : '',
    current: i === props.blindIndex,
    done: i < props.blindIndex,
    upcoming: i > props.blindIndex,
  }))
})

const tagHint = computed(() => {
  const pool = TAGS.filter(t => t.minAnte <= props.ante)
  return pool.length ? `随机标签（${pool.length} 种之一）` : '随机标签'
})

function fmt(n) {
  if (n >= 1e12) return n.toExponential(2)
  return Math.round(n).toLocaleString('en-US')
}
</script>

<style scoped>
.blind-select {
  display: flex; flex-direction: column; align-items: center; gap: 24px;
  padding: 40px 20px;
}
.bs-title {
  color: #fff; font-family: 'Arial Black', 'PingFang SC', sans-serif; font-size: 28px;
  text-shadow: 0 3px 6px rgba(0,0,0,0.6); margin: 0;
}
.bs-ante { color: #e0a040; font-size: 18px; margin-left: 12px; }
.bs-cards { display: flex; gap: 22px; }
.bs-card {
  width: 190px; min-height: 230px;
  background: linear-gradient(165deg, rgba(20,30,26,0.95), rgba(10,16,14,0.95));
  border: 2px solid rgba(255,255,255,0.15); border-radius: 12px;
  padding: 16px 14px; text-align: center;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  font-family: 'Arial Black', 'PingFang SC', sans-serif;
  transition: transform 0.2s, box-shadow 0.2s, opacity 0.2s;
}
.bs-card.current {
  border-color: #50a0ff; transform: translateY(-8px) scale(1.04);
  box-shadow: 0 12px 30px rgba(80,160,255,0.25);
}
.bs-card.boss.current { border-color: #e04040; box-shadow: 0 12px 30px rgba(224,64,64,0.3); }
.bs-card.done { opacity: 0.45; }
.bs-card.upcoming { opacity: 0.7; }
.b-icon { font-size: 40px; }
.b-name { color: #fff; font-size: 16px; }
.b-target { color: #9ab; font-size: 12px; }
.b-target b { color: #ffd700; font-size: 15px; }
.b-reward { color: #ffd700; font-size: 12px; }
.b-effect { color: #ff9e9e; font-size: 11px; line-height: 1.4; font-family: 'PingFang SC', sans-serif; }
.b-actions { display: flex; flex-direction: column; gap: 8px; margin-top: auto; width: 100%; }
.b-stamp { color: #66bb6a; font-size: 26px; margin-top: auto; }
.tag-hint { font-size: 10px; font-weight: 400; opacity: 0.85; }
.bs-tags { color: #9ab; font-size: 13px; }
.tags-label { margin-right: 8px; }
.tag-chip {
  display: inline-block; background: rgba(224,160,64,0.2); color: #e0a040;
  border: 1px solid rgba(224,160,64,0.5); border-radius: 10px;
  padding: 2px 10px; margin: 0 4px; font-size: 12px;
}
</style>
