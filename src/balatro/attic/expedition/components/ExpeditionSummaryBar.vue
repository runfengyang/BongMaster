<template>
  <!-- 有局：摘要条 -->
  <div v-if="snap" class="xs-bar" @click="go">
    <span class="xs-name">⚔️ {{ themeName }} · 第 {{ snap.dayIndex + 1 }} 活跃日</span>
    <span class="xs-sep">│</span>
    <span class="xs-boss">
      Boss HP
      <span class="xs-hp">{{ hpBlocks }}</span>
    </span>
    <span class="xs-sep">│</span>
    <span class="xs-pulls">今日拉杆 {{ store.pullsToday }}/{{ store.limits.maxPulls }}</span>
    <span class="xs-sep">│</span>
    <span class="xs-pressure">压力 {{ pressureDots }}</span>
    <span v-if="store.pendingReport" class="xs-report">📜 战报待播</span>
  </div>

  <!-- 无局：选择远征引导卡 -->
  <div v-else class="xs-empty bm-card" @click="go">
    <div class="xs-empty-main">
      <span class="xs-empty-icon">⚔️</span>
      <div class="xs-empty-copy">
        <div class="xs-empty-title">远征模式 · 选择你的远征</div>
        <div class="xs-empty-sub">
          <span v-for="t in store.themes" :key="t.id" class="xs-theme">
            {{ t.name }}（Boss：{{ bossName(t.bossId) }}）
          </span>
        </div>
      </div>
    </div>
    <span class="xs-empty-cta">出征 →</span>
  </div>
</template>

<script setup>
// ExpeditionSummaryBar（契约 §6）：Dashboard 顶部远征摘要条 / 无局引导卡
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useExpeditionStore } from '../expeditionStore.js'

const store = useExpeditionStore()
const router = useRouter()

onMounted(() => { store.init().catch(() => {}) })

const snap = computed(() => store.snap && store.snap.status === 'active' ? store.snap : null)
const themeName = computed(() => store.themes.find(t => t.id === snap.value?.themeId)?.name || '远征')

const bossNode = computed(() => {
  if (!snap.value) return null
  return snap.value.nodes[snap.value.nodes.length - 1]
})
const hpBlocks = computed(() => {
  if (!bossNode.value) return ''
  const total = 8
  const filled = Math.ceil((bossNode.value.hp / bossNode.value.hpMax) * total)
  return '▓'.repeat(filled) + '░'.repeat(total - filled)
})
const pressureDots = computed(() => {
  if (!snap.value) return ''
  return '●'.repeat(snap.value.pressure) + '○'.repeat(store.limits.maxPressure - snap.value.pressure)
})

function bossName(bossId) {
  return store.bossesById[bossId]?.name || bossId
}
function go() { router.push('/expedition') }
</script>

<style scoped>
.xs-bar {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 10px 16px;
  margin-bottom: 14px;
  background: rgba(12, 16, 24, 0.92);
  border: 1px solid rgba(255, 213, 79, 0.35);
  border-radius: 10px;
  color: #e8f0ec;
  font-family: 'm6x11', 'PingFang SC', monospace;
  font-size: 13px;
  cursor: pointer;
  transition: transform 0.12s, box-shadow 0.15s;
}
.xs-bar:hover { transform: translateY(-1px); box-shadow: 0 4px 18px rgba(255, 213, 79, 0.18); }
.xs-name { font-weight: 900; color: #ffd54f; }
.xs-sep { color: #3d5a54; }
.xs-hp { color: #ff6b6b; letter-spacing: 1px; }
.xs-pressure { color: #ff8787; letter-spacing: 2px; }
.xs-report {
  margin-left: auto;
  padding: 2px 8px;
  border-radius: 8px;
  background: linear-gradient(160deg, #ffd54f, #e0a820);
  color: #4a3200;
  font-size: 11px; font-weight: 900;
  animation: xsPulse 2s ease-in-out infinite;
}
@keyframes xsPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }

.xs-empty {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 14px;
  cursor: pointer;
  border: 1px dashed rgba(255, 213, 79, 0.4) !important;
  transition: transform 0.12s, box-shadow 0.15s;
}
.xs-empty:hover { transform: translateY(-1px); box-shadow: 0 4px 18px rgba(255, 213, 79, 0.15); }
.xs-empty-main { display: flex; align-items: center; gap: 12px; }
.xs-empty-icon { font-size: 26px; }
.xs-empty-title { font-weight: 800; font-size: 14px; }
.xs-empty-sub { font-size: 12px; color: var(--bm-text-muted, #8a8a8a); margin-top: 2px; display: flex; gap: 12px; }
.xs-empty-cta { font-weight: 900; color: #c89018; font-size: 14px; }
</style>
