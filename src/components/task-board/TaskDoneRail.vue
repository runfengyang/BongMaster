<template>
  <aside class="tb-done-rail">
    <header class="tb-col-head">
      <span class="tb-col-dot" aria-hidden="true"></span>
      <span class="tb-col-title">已完成</span>
      <span class="tb-col-count">{{ tasks.length }}</span>
    </header>

    <p v-if="!tasks.length" class="tb-done-empty">还没有完成的任务</p>

    <draggable
      v-model="localDone"
      group="tasks"
      item-key="id"
      :sort="false"
      :animation="150"
      class="tb-done-list"
      ghost-class="tb-done-ghost"
      @start="onDragStart"
      @end="onDragEnd"
    >
      <template #item="{ element: task }">
        <button
          type="button"
          class="tb-done-row"
          :data-task-id="task.id"
          @click="handleClick(task)"
          @contextmenu.prevent="$emit('context-menu', task, $event)"
        >
          <span class="tb-done-check" aria-hidden="true">
            <i class="fas fa-check"></i>
          </span>
          <span class="tb-done-copy">
            <span class="tb-done-title">{{ task.name }}</span>
            <span class="tb-done-meta">
              <span class="tb-done-project">
                {{ task.project_name }}
              </span>
              <span>{{ completedLabel(task) }}</span>
            </span>
          </span>
        </button>
      </template>
    </draggable>

    <button
      v-if="tasks.length > RAIL_LIMIT"
      type="button"
      class="tb-done-more"
      @click="$emit('toggle')"
    >
      {{ expanded ? '收起' : `查看全部 ${tasks.length}` }}
      <i class="fas" :class="expanded ? 'fa-chevron-up' : 'fa-chevron-down'" aria-hidden="true"></i>
    </button>
  </aside>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import draggable from 'vuedraggable'
import { formatDateShort } from '@utils/task-board.js'

const RAIL_LIMIT = 7

const props = defineProps({
  tasks: { type: Array, default: () => [] },
  expanded: { type: Boolean, default: false }
})

const emit = defineEmits(['task-click', 'context-menu', 'toggle', 'status-change'])

const visibleTasks = computed(() => (
  props.expanded ? props.tasks : props.tasks.slice(0, RAIL_LIMIT)
))

const localDone = ref([])
let dragHappened = false
let dragResetTimer = null

watch(visibleTasks, value => {
  localDone.value = [...value]
}, { immediate: true })

const onDragStart = () => {
  dragHappened = true
  if (dragResetTimer) window.clearTimeout(dragResetTimer)
}

const onDragEnd = event => {
  try {
    const taskId = event.item.__draggable_context?.element?.id
      || Number(event.item.dataset.taskId)
    const targetStatus = event.to.closest('.tb-column')?.dataset.status
    const newStatus = targetStatus || (event.to.closest('.tb-done-rail') ? '已完成' : '')
    const oldStatus = event.from.closest('.tb-done-rail')
      ? '已完成'
      : event.from.closest('.tb-column')?.dataset.status
    if (taskId && newStatus && newStatus !== oldStatus) {
      emit('status-change', { taskId, newStatus, oldStatus })
    }
  } finally {
    window.setTimeout(() => {
      localDone.value = [...visibleTasks.value]
      dragHappened = false
      dragResetTimer = null
    }, 140)
  }
}

const handleClick = task => {
  if (dragHappened) return
  emit('task-click', task)
}

const completedLabel = task => {
  const value = task.completed_at || task.updated_at
  return value ? formatDateShort(value) : ''
}
</script>

<style scoped>
.tb-done-rail {
  display: flex;
  flex-direction: column;
  flex: 0 0 280px;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--bm-border-subtle);
  border-radius: 10px;
  background: var(--bm-bg-sidebar);
}

.tb-col-head {
  display: flex;
  align-items: center;
  gap: 7px;
  flex: 0 0 auto;
  height: 36px;
  padding: 0 10px;
}

.tb-col-dot {
  width: 7px;
  height: 7px;
  border-radius: 2px;
  background: var(--bm-accent-teal, #0f9d8a);
  flex: 0 0 auto;
}

.tb-col-title {
  color: var(--bm-text-primary);
  font-size: 13px;
  font-weight: 600;
}

.tb-col-count {
  color: var(--bm-text-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.tb-done-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 6px 4px;
}

.tb-done-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  padding: 6px 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.tb-done-row:hover { background: var(--bm-bg-hover); }

.tb-done-ghost { opacity: 0.3; }

.tb-done-check {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  margin-top: 1px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--bm-accent-teal, #0f9d8a) 16%, transparent);
  color: var(--bm-accent-teal, #0f9d8a);
  font-size: 8px;
  flex: 0 0 auto;
}

.tb-done-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.tb-done-title {
  overflow: hidden;
  color: var(--bm-text-muted);
  font-size: 12.5px;
  line-height: 1.35;
  text-decoration: line-through;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tb-done-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--bm-text-tertiary);
  font-size: 10.5px;
}

.tb-done-project {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tb-done-empty {
  margin: 0;
  padding: 14px 10px;
  color: var(--bm-text-tertiary);
  font-size: 12px;
}

.tb-done-more {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  flex: 0 0 auto;
  height: 34px;
  border: 0;
  border-top: 1px solid var(--bm-border-subtle);
  background: transparent;
  color: var(--bm-text-secondary);
  font: inherit;
  font-size: 11.5px;
  cursor: pointer;
}

.tb-done-more:hover { background: var(--bm-bg-hover); color: var(--bm-text-primary); }
.tb-done-more i { font-size: 8px; }
</style>
