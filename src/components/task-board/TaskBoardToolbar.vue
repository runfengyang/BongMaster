<template>
  <div class="tb-toolbar">
    <span class="bm-tab-title tb-toolbar-title">任务看板</span>

    <div class="tb-toolbar-spacer"></div>

    <label class="tb-search">
      <i class="fas fa-search" aria-hidden="true"></i>
      <input
        type="text"
        v-model="filters.search"
        placeholder="搜索任务或项目"
        @keydown.esc="filters.search = ''"
      >
      <button
        v-if="filters.search"
        type="button"
        class="tb-search-clear"
        aria-label="清除搜索"
        @click="filters.search = ''"
      >
        <i class="fas fa-times" aria-hidden="true"></i>
      </button>
    </label>

    <button
      ref="filterButton"
      type="button"
      class="tb-filter-button"
      :class="{ active: filterOpen || activeFilterCount > 0 }"
      @click="toggleFilter"
    >
      <i class="fas fa-sliders-h" aria-hidden="true"></i>
      <span>筛选</span>
      <span v-if="activeFilterCount" class="tb-filter-badge">{{ activeFilterCount }}</span>
    </button>

    <div class="tb-view-toggle" role="group" aria-label="视图">
      <button
        type="button"
        :class="{ active: viewMode === 'board' }"
        @click="$emit('update:view-mode', 'board')"
      >
        看板
      </button>
      <button
        type="button"
        :class="{ active: viewMode === 'list' }"
        @click="$emit('update:view-mode', 'list')"
      >
        列表
      </button>
    </div>

    <button type="button" class="bm-btn bm-btn-primary tb-new-button" @click="$emit('new-task')">
      新建任务
    </button>

    <TaskFilterPopover
      v-if="filterOpen"
      :filters="filters"
      :assignees="assigneeOptions"
      :anchor="filterAnchor"
      @close="filterOpen = false"
      @clear="$emit('clear-filters')"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, ref } from 'vue'
import TaskFilterPopover from './TaskFilterPopover.vue'

const props = defineProps({
  filters: { type: Object, required: true },
  tasks: { type: Array, default: () => [] },
  activeFilterCount: { type: Number, default: 0 },
  viewMode: { type: String, default: 'board' }
})

defineEmits(['update:view-mode', 'clear-filters', 'new-task'])

const filterOpen = ref(false)
const filterButton = ref(null)
const filterAnchor = ref(null)

const assigneeOptions = computed(() => {
  const names = new Set()
  props.tasks.forEach(task => {
    if (task.assignee) names.add(task.assignee)
  })
  return Array.from(names).sort()
})

const toggleFilter = async () => {
  if (filterOpen.value) {
    filterOpen.value = false
    return
  }
  await nextTick()
  filterAnchor.value = filterButton.value?.getBoundingClientRect() || null
  filterOpen.value = true
}
</script>

<style scoped>
.tb-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  min-height: 44px;
  padding: 6px 10px 6px 14px;
  border-bottom: 1px solid var(--bm-border-subtle);
  background: var(--bm-bg-card);
}

.tb-toolbar-title {
  color: var(--bm-text-primary);
  white-space: nowrap;
}

.tb-toolbar-spacer { flex: 1; }

.tb-search {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 200px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--bm-border-default);
  border-radius: var(--bm-radius-md);
  background: var(--bm-bg-card);
  color: var(--bm-text-muted);
  transition: border-color 120ms ease, box-shadow 120ms ease;
}

.tb-search:focus-within {
  border-color: var(--bm-accent-blue);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--bm-accent-blue) 14%, transparent);
}

.tb-search i { font-size: 11px; flex: 0 0 auto; }

.tb-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--bm-text-primary);
  font: inherit;
  font-size: 12.5px;
}

.tb-search input::placeholder { color: var(--bm-text-muted); }

.tb-search-clear {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--bm-border-default);
  color: var(--bm-bg-card);
  font-size: 8px;
  cursor: pointer;
}

.tb-filter-button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 9px;
  border: 1px solid transparent;
  border-radius: var(--bm-radius-md);
  background: transparent;
  color: var(--bm-text-secondary);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
}

.tb-filter-button:hover { background: var(--bm-bg-hover); color: var(--bm-text-primary); }
.tb-filter-button.active { border-color: var(--bm-border-default); background: var(--bm-bg-hover); color: var(--bm-text-primary); }
.tb-filter-button i { font-size: 11px; }

.tb-filter-badge {
  display: inline-grid;
  place-items: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--bm-accent-blue);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
}

.tb-view-toggle {
  display: inline-flex;
  height: 28px;
  padding: 2px;
  border: 1px solid var(--bm-border-default);
  border-radius: var(--bm-radius-md);
  background: var(--bm-bg-sidebar);
}

.tb-view-toggle button {
  padding: 0 9px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--bm-text-secondary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.tb-view-toggle button.active {
  background: var(--bm-bg-card);
  color: var(--bm-text-primary);
  font-weight: 600;
  box-shadow: var(--bm-shadow-sm);
}

.tb-new-button {
  height: 28px;
  padding: 0 11px;
  font-size: 12.5px;
}

@media (max-width: 900px) {
  .tb-search { width: 150px; }
  .tb-toolbar-title { display: none; }
}
</style>
