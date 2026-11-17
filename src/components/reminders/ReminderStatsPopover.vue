<template>
  <Teleport to="body">
    <Transition name="rm-pop">
      <div v-if="show" class="rm-stats" :style="style" @click.stop>
        <header class="rm-stats-header">
          <strong>每日统计</strong>
          <button type="button" aria-label="关闭" @click="$emit('close')">
            <ReminderIcon name="close" :size="12" />
          </button>
        </header>
        <div v-if="!stats" class="rm-stats-loading">载入中…</div>
        <div v-else class="rm-stats-grid">
          <div class="rm-stat">
            <span class="rm-stat-label">今日完成</span>
            <strong>{{ stats.todayCompleted }}</strong>
            <small>项</small>
          </div>
          <div class="rm-stat">
            <span class="rm-stat-label">7天日均</span>
            <strong>{{ stats.weeklyDailyAverage.toFixed(1) }}</strong>
            <small>项</small>
          </div>
          <div class="rm-stat">
            <span class="rm-stat-label">平均完成周期</span>
            <strong>{{ stats.averageCompletionDays == null ? '—' : stats.averageCompletionDays.toFixed(1) }}</strong>
            <small v-if="stats.averageCompletionDays != null">天</small>
          </div>
          <div class="rm-stat">
            <span class="rm-stat-label">积压超7天</span>
            <strong>{{ stats.overdueCount }}</strong>
            <small>项</small>
          </div>
        </div>
        <p class="rm-stats-hint">完成周期按创建到完成计算，仅统计近 30 天有有效时间记录的 {{ stats?.completionSampleCount ?? 0 }} 项。</p>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { computed } from 'vue'
import ReminderIcon from './ReminderIcon.vue'

const props = defineProps({
  show: { type: Boolean, default: false },
  anchor: { type: Object, default: null },
  stats: { type: Object, default: null }
})

defineEmits(['close'])

const style = computed(() => {
  const width = 270
  const anchor = props.anchor
  let left = anchor ? anchor.right - width : window.innerWidth - width - 24
  left = Math.max(12, Math.min(left, window.innerWidth - width - 12))
  const top = anchor ? anchor.bottom + 6 : 70
  return { left: `${left}px`, top: `${top}px` }
})
</script>

<style scoped>
.rm-stats {
  position: fixed;
  z-index: 1250;
  width: 270px;
  padding: 10px 12px 12px;
  border: 1px solid rgb(0 0 0 / 0.12);
  border-radius: 12px;
  background: rgb(255 255 255 / 0.98);
  color: #1d1d1f;
  box-shadow: 0 18px 46px rgb(0 0 0 / 0.2), 0 2px 8px rgb(0 0 0 / 0.06);
  backdrop-filter: blur(18px);
  font-family: var(--bm-font-ui);
}

.rm-stats-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.rm-stats-header strong { font-size: 13px; font-weight: 600; }

.rm-stats-header button {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: #f2f2f7;
  color: #8e8e93;
  cursor: pointer;
}

.rm-stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.rm-stat {
  padding: 8px 9px;
  border: 1px solid #ececee;
  border-radius: 8px;
  background: #fafafa;
}

.rm-stat-label {
  display: block;
  margin-bottom: 3px;
  color: #8e8e93;
  font-size: 10.5px;
}

.rm-stat strong {
  font-size: 20px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.03em;
}

.rm-stat small { margin-left: 3px; color: #8e8e93; font-size: 10px; }

.rm-stats-hint {
  margin: 8px 0 0;
  color: #aeaeb2;
  font-size: 10px;
  line-height: 1.4;
}

.rm-stats-loading { padding: 18px 0; color: #8e8e93; font-size: 12px; text-align: center; }

.rm-pop-enter-active,
.rm-pop-leave-active { transition: opacity 100ms ease, transform 100ms ease; }
.rm-pop-enter-from,
.rm-pop-leave-to { opacity: 0; transform: translateY(-3px) scale(0.98); }
</style>
