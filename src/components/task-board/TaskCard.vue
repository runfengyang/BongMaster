<template>
  <div
    class="tb-card"
    :class="{
      'is-done': task.status === '已完成',
      'is-moved': recentlyMoved,
      'is-completed-flash': recentlyCompleted
    }"
    :data-task-id="task.id"
    @click="$emit('click', task)"
    @contextmenu.prevent="$emit('context-menu', $event)"
  >
    <div class="tb-card-title">{{ task.name }}</div>

    <div class="tb-card-meta">
      <span class="tb-project">
        <span class="tb-project-name">{{ task.project_name }}</span>
      </span>
      <span v-if="firstTag" class="tb-tag">#{{ firstTag }}</span>
    </div>

    <div class="tb-card-foot">
      <span class="tb-priority" :class="priorityClass">
        <span class="tb-priority-dot"></span>
        {{ task.priority || '中' }}
      </span>
      <span v-if="task.due_date" class="tb-due" :class="{ overdue: isOverdue(task.due_date), today: isDueToday(task.due_date) }">
        <i class="far fa-calendar" aria-hidden="true"></i>
        {{ formatDueLabel(task.due_date) }}
      </span>
      <span v-if="task.assignee" class="tb-assignee" :title="task.assignee">{{ assigneeInitial }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { formatDueLabel, isDueToday, isOverdue, splitTags } from '@utils/task-board.js'

const props = defineProps({
  task: { type: Object, required: true },
  recentlyMoved: { type: Boolean, default: false },
  recentlyCompleted: { type: Boolean, default: false }
})

defineEmits(['click', 'context-menu'])

const priorityClass = computed(() => {
  if (props.task.priority === '高') return 'high'
  if (props.task.priority === '低') return 'low'
  return 'medium'
})

const firstTag = computed(() => splitTags(props.task.tags)[0] || '')

const assigneeInitial = computed(() => {
  const name = String(props.task.assignee || '').trim()
  if (!name) return ''
  return name.slice(-1).toUpperCase()
})
</script>

<style scoped>
.tb-card {
  position: relative;
  padding: 9px 10px 8px;
  border: 1px solid var(--bm-border-default);
  border-radius: 8px;
  background: var(--bm-bg-card);
  cursor: grab;
  transition: border-color 120ms ease, box-shadow 120ms ease, background 120ms ease;
  user-select: none;
}

.tb-card:hover {
  border-color: var(--bm-border-strong);
  box-shadow: var(--bm-shadow-sm);
}

.tb-card:active { cursor: grabbing; }

.tb-card.is-done {
  opacity: 0.62;
}

.tb-card.is-moved,
.tb-card.is-completed-flash {
  border-color: color-mix(in srgb, var(--bm-accent-blue) 52%, var(--bm-border-default));
}

.tb-card-title {
  display: -webkit-box;
  overflow: hidden;
  color: var(--bm-text-primary);
  font-size: 13.5px;
  font-weight: 500;
  line-height: 1.4;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.tb-card-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  margin-top: 4px;
  color: var(--bm-text-muted);
  font-size: 11px;
}

.tb-project {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.tb-project-name {
  max-width: 170px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tb-tag {
  max-width: 90px;
  overflow: hidden;
  color: var(--bm-accent-blue);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tb-card-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}

.tb-priority {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--bm-text-secondary);
  font-size: 10.5px;
}

.tb-priority-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--bm-accent-amber, #d99a2b);
}

.tb-priority.high { color: var(--bm-accent-danger); }
.tb-priority.high .tb-priority-dot { background: var(--bm-accent-danger); }
.tb-priority.low { color: var(--bm-text-muted); }
.tb-priority.low .tb-priority-dot { background: var(--bm-text-tertiary); }

.tb-due {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  color: var(--bm-text-muted);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
}

.tb-due i { font-size: 9px; }
.tb-due.today { color: var(--bm-accent-blue); }
.tb-due.overdue { color: var(--bm-accent-danger); }

.tb-assignee {
  display: grid;
  place-items: center;
  width: 17px;
  height: 17px;
  border-radius: 50%;
  background: var(--bm-bg-hover);
  color: var(--bm-text-secondary);
  font-size: 9px;
  font-weight: 600;
  flex: 0 0 auto;
}
</style>
