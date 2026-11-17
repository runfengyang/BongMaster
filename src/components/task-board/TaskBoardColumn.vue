<template>
  <section class="tb-column" :data-status="status">
    <header class="tb-col-head">
      <span class="tb-col-dot" aria-hidden="true"></span>
      <span class="tb-col-title">{{ title }}</span>
      <span class="tb-col-count">{{ tasks.length }}</span>
      <button
        type="button"
        class="tb-col-add"
        :title="canAdd ? '添加任务' : '先创建一个项目'"
        @click="startAdd"
      >
        <i class="fas fa-plus" aria-hidden="true"></i>
      </button>
    </header>

    <div class="tb-column-body">
      <draggable
        v-model="localList"
        group="tasks"
        item-key="id"
        :sort="false"
        :animation="150"
        class="tb-column-list"
        ghost-class="tb-card-ghost"
        drag-class="tb-card-drag"
        @start="onDragStart"
        @end="onDragEnd"
      >
        <template #item="{ element }">
          <TaskCard
            :task="element"
            :recently-moved="recentlyMovedTaskId === element.id"
            :recently-completed="recentlyCompletedTaskId === element.id"
            @click="handleCardClick(element)"
            @context-menu="event => $emit('context-menu', element, event)"
          />
        </template>
      </draggable>

      <div v-if="!tasks.length && !adding" class="tb-column-empty">暂无任务</div>

      <div v-if="adding" class="tb-quick-add">
        <input
          ref="addInput"
          v-model="draft"
          type="text"
          class="tb-quick-input"
          placeholder="输入任务名称，回车创建"
          @keydown.enter.prevent="commitAdd"
          @keydown.esc.prevent="cancelAdd"
          @blur="onBlur"
        >
        <span v-if="defaultProjectName" class="tb-quick-hint">{{ defaultProjectName }}</span>
      </div>

      <button
        v-else
        type="button"
        class="tb-quick-placeholder"
        @click="startAdd"
      >
        <i class="fas fa-plus" aria-hidden="true"></i>
        {{ canAdd ? '添加任务' : '先创建一个项目' }}
      </button>
    </div>
  </section>
</template>

<script setup>
import { nextTick, ref, watch } from 'vue'
import draggable from 'vuedraggable'
import TaskCard from './TaskCard.vue'

const props = defineProps({
  status: { type: String, required: true },
  title: { type: String, required: true },
  tasks: { type: Array, default: () => [] },
  recentlyMovedTaskId: { type: [Number, String, null], default: null },
  recentlyCompletedTaskId: { type: [Number, String, null], default: null },
  canAdd: { type: Boolean, default: false },
  defaultProjectName: { type: String, default: '' }
})

const emit = defineEmits(['task-click', 'status-change', 'quick-add', 'context-menu'])

const localList = ref([])
const adding = ref(false)
const draft = ref('')
const addInput = ref(null)
let dragHappened = false
let dragResetTimer = null

watch(() => props.tasks, value => {
  localList.value = [...value]
}, { immediate: true })

const startAdd = () => {
  if (!props.canAdd) {
    emit('quick-add', { name: '', status: props.status, openCreate: true })
    return
  }
  adding.value = true
  nextTick(() => addInput.value?.focus())
}

const closeAdd = () => {
  adding.value = false
  draft.value = ''
}

const commitAdd = () => {
  const name = draft.value.trim()
  if (!name) {
    closeAdd()
    return
  }
  draft.value = ''
  emit('quick-add', { name, status: props.status })
  nextTick(() => addInput.value?.focus())
}

const cancelAdd = () => closeAdd()

const onBlur = () => {
  if (draft.value.trim()) commitAdd()
  else closeAdd()
}

const onDragStart = () => {
  dragHappened = true
  if (dragResetTimer) window.clearTimeout(dragResetTimer)
}

const onDragEnd = event => {
  try {
    const taskId = event.item.__draggable_context?.element?.id
      || Number(event.item.dataset.taskId)
    const newStatus = event.to.closest('.tb-column')?.dataset.status
      || (event.to.closest('.tb-done-rail') ? '已完成' : '')
    const oldStatus = event.from.closest('.tb-column')?.dataset.status
    if (taskId && newStatus && newStatus !== oldStatus) {
      emit('status-change', { taskId, newStatus, oldStatus })
    }
  } finally {
    localList.value = [...props.tasks]
    dragResetTimer = window.setTimeout(() => {
      dragHappened = false
      dragResetTimer = null
    }, 120)
  }
}

const handleCardClick = task => {
  if (dragHappened) return
  emit('task-click', task)
}
</script>

<style scoped>
.tb-column {
  display: flex;
  flex-direction: column;
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
  background: var(--bm-text-tertiary);
  flex: 0 0 auto;
}

.tb-column[data-status="进行中"] .tb-col-dot { background: var(--bm-accent-blue); }

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

.tb-col-add {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  margin-left: auto;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--bm-text-muted);
  font-size: 10px;
  cursor: pointer;
}

.tb-col-add:hover { background: var(--bm-bg-hover); color: var(--bm-text-primary); }

.tb-column-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.tb-column-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-height: 0;
  padding: 0 8px 4px;
  overflow-y: auto;
}

.tb-column-empty {
  padding: 14px 12px;
  color: var(--bm-text-tertiary);
  font-size: 12px;
}

.tb-quick-add {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 8px 8px;
  padding: 0 8px;
  height: 32px;
  border: 1px solid var(--bm-accent-blue);
  border-radius: 7px;
  background: var(--bm-bg-card);
}

.tb-quick-input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--bm-text-primary);
  font: inherit;
  font-size: 13px;
}

.tb-quick-input::placeholder { color: var(--bm-text-muted); }

.tb-quick-hint {
  flex: 0 0 auto;
  max-width: 90px;
  overflow: hidden;
  color: var(--bm-text-muted);
  font-size: 10.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tb-quick-placeholder {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  margin: 0 8px 8px;
  padding: 0 8px;
  border: 1px dashed transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--bm-text-muted);
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
}

.tb-quick-placeholder:hover {
  border-color: var(--bm-border-default);
  background: var(--bm-bg-hover);
  color: var(--bm-text-secondary);
}

.tb-quick-placeholder i { font-size: 10px; }

:deep(.tb-card-ghost) { opacity: 0.35; }
:deep(.tb-card-drag) { transform: rotate(1deg); }
</style>
