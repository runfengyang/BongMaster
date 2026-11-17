<template>
  <div
    ref="panelRef"
    class="tb-filter-popover"
    :style="{ left: `${panelLeft}px`, top: `${panelTop}px` }"
    @click.stop
    @contextmenu.prevent
  >
    <div class="tb-filter-section">
      <span class="tb-filter-label">优先级</span>
      <div class="tb-filter-chips">
        <button
          v-for="option in PRIORITIES"
          :key="option"
          type="button"
          class="tb-chip"
          :class="{ active: filters.priorities.includes(option) }"
          @click="toggle('priorities', option)"
        >
          {{ option }}
        </button>
      </div>
    </div>

    <div v-if="assignees.length" class="tb-filter-section">
      <span class="tb-filter-label">负责人</span>
      <div class="tb-filter-chips">
        <button
          v-for="name in assignees"
          :key="name"
          type="button"
          class="tb-chip"
          :class="{ active: filters.assignees.includes(name) }"
          @click="toggle('assignees', name)"
        >
          {{ name }}
        </button>
      </div>
    </div>

    <div class="tb-filter-section">
      <span class="tb-filter-label">截止日期</span>
      <div class="tb-filter-chips">
        <button
          v-for="option in DUE_OPTIONS"
          :key="option.value"
          type="button"
          class="tb-chip"
          :class="{ active: filters.dueMode === option.value }"
          @click="filters.dueMode = option.value"
        >
          {{ option.label }}
        </button>
      </div>
    </div>

    <div class="tb-filter-section">
      <span class="tb-filter-label">状态</span>
      <div class="tb-filter-chips">
        <button
          v-for="option in STATUSES"
          :key="option"
          type="button"
          class="tb-chip"
          :class="{ active: filters.statuses.includes(option) }"
          @click="toggle('statuses', option)"
        >
          {{ option }}
        </button>
      </div>
    </div>

    <div class="tb-filter-footer">
      <button type="button" class="tb-filter-clear" @click="$emit('clear')">清除全部</button>
      <button type="button" class="tb-filter-done" @click="$emit('close')">完成</button>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, ref } from 'vue'

const props = defineProps({
  filters: { type: Object, required: true },
  assignees: { type: Array, default: () => [] },
  anchor: { type: Object, default: null }
})

const emit = defineEmits(['close', 'clear'])

const PRIORITIES = ['高', '中', '低']
const STATUSES = ['待办', '进行中', '已完成']
const DUE_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'overdue', label: '逾期' },
  { value: 'today', label: '今天' },
  { value: 'this_week', label: '本周' },
  { value: 'no_date', label: '无日期' }
]

const panelRef = ref(null)
const panelLeft = ref(0)
const panelTop = ref(0)

const toggle = (key, value) => {
  const list = props.filters[key]
  const index = list.indexOf(value)
  if (index >= 0) list.splice(index, 1)
  else list.push(value)
}

const place = () => {
  const width = 280
  const margin = 8
  const anchor = props.anchor
  let left = anchor ? anchor.right - width : margin
  let top = anchor ? anchor.bottom + 6 : 56
  const height = panelRef.value?.offsetHeight || 320
  left = Math.max(margin, Math.min(left, window.innerWidth - width - margin))
  top = Math.max(margin, Math.min(top, window.innerHeight - height - margin))
  panelLeft.value = left
  panelTop.value = top
}

const closeOnOutside = event => {
  if (panelRef.value?.contains(event.target)) return
  if (event.target.closest?.('.tb-filter-button')) return
  emit('close')
}

const closeOnEscape = event => {
  if (event.key !== 'Escape') return
  event.preventDefault()
  emit('close')
}

onMounted(() => {
  place()
  document.addEventListener('click', closeOnOutside, true)
  document.addEventListener('keydown', closeOnEscape)
})

onUnmounted(() => {
  document.removeEventListener('click', closeOnOutside, true)
  document.removeEventListener('keydown', closeOnEscape)
})
</script>

<style scoped>
.tb-filter-popover {
  position: fixed;
  z-index: 1500;
  width: 280px;
  padding: 10px;
  border: 1px solid var(--bm-border-default);
  border-radius: var(--bm-radius-md);
  background: var(--bm-bg-card);
  box-shadow: var(--bm-shadow-lg);
  font-family: var(--bm-font-family);
}

.tb-filter-section {
  padding: 6px 2px 8px;
}

.tb-filter-section + .tb-filter-section {
  border-top: 1px solid var(--bm-border-subtle);
}

.tb-filter-label {
  display: block;
  margin-bottom: 6px;
  color: var(--bm-text-muted);
  font-size: 11px;
  font-weight: 600;
}

.tb-filter-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.tb-chip {
  height: 24px;
  padding: 0 9px;
  border: 1px solid var(--bm-border-default);
  border-radius: 999px;
  background: transparent;
  color: var(--bm-text-secondary);
  font: inherit;
  font-size: 11.5px;
  cursor: pointer;
}

.tb-chip:hover { background: var(--bm-bg-hover); }

.tb-chip.active {
  border-color: var(--bm-accent-blue);
  background: color-mix(in srgb, var(--bm-accent-blue) 11%, transparent);
  color: var(--bm-accent-blue);
  font-weight: 600;
}

.tb-filter-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 4px;
  padding-top: 8px;
  border-top: 1px solid var(--bm-border-subtle);
}

.tb-filter-clear,
.tb-filter-done {
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.tb-filter-clear { color: var(--bm-text-muted); }
.tb-filter-clear:hover { color: var(--bm-accent-danger); }
.tb-filter-done { color: var(--bm-accent-blue); font-weight: 600; }
</style>
