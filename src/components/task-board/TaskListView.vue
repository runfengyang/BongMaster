<template>
  <div class="tb-list">
    <section v-for="group in groups" :key="group.status" class="tb-list-group">
      <button
        type="button"
        class="tb-list-head"
        :aria-expanded="!isCollapsed(group.status)"
        @click="toggleGroup(group.status)"
      >
        <i
          class="fas tb-list-chevron"
          :class="isCollapsed(group.status) ? 'fa-chevron-right' : 'fa-chevron-down'"
          aria-hidden="true"
        ></i>
        <span class="tb-list-dot" :class="group.className" aria-hidden="true"></span>
        <span class="tb-list-head-title">{{ group.status }}</span>
        <span class="tb-list-head-count">{{ group.tasks.length }}</span>
      </button>

      <p v-if="!isCollapsed(group.status) && !group.tasks.length" class="tb-list-empty">暂无任务</p>

      <button
        v-for="task in visibleTasks(group)"
        :key="task.id"
        type="button"
        class="tb-list-row"
        :class="{ done: task.status === '已完成' }"
        @click="$emit('task-click', task)"
        @contextmenu.prevent="$emit('context-menu', task, $event)"
      >
        <span class="tb-list-check" aria-hidden="true">
          <i v-if="task.status === '已完成'" class="fas fa-check"></i>
        </span>

        <span class="tb-list-title">{{ task.name }}</span>

        <span class="tb-list-meta">
          <span class="tb-list-project">
            <span class="tb-list-project-name">{{ task.project_name }}</span>
          </span>
          <span class="tb-list-priority" :class="priorityClass(task)">{{ task.priority || '中' }}</span>
          <span
            v-if="task.due_date"
            class="tb-list-due"
            :class="{ overdue: isOverdue(task.due_date), today: isDueToday(task.due_date) }"
          >
            {{ formatDueLabel(task.due_date) }}
          </span>
          <span v-if="task.assignee" class="tb-list-assignee">{{ task.assignee }}</span>
        </span>
      </button>
    </section>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import {
  formatDueLabel,
  isDueToday,
  isOverdue,
  sortBoardTasks,
  sortCompletedTasks
} from '@utils/task-board.js'

const props = defineProps({
  tasks: { type: Array, default: () => [] }
})

defineEmits(['task-click', 'context-menu'])

const groups = computed(() => [
  {
    status: '待办',
    className: 'todo',
    tasks: sortBoardTasks(props.tasks.filter(task => task.status === '待办'))
  },
  {
    status: '进行中',
    className: 'doing',
    tasks: sortBoardTasks(props.tasks.filter(task => task.status === '进行中'))
  },
  {
    status: '已完成',
    className: 'done',
    tasks: sortCompletedTasks(props.tasks.filter(task => task.status === '已完成'))
  }
])

const collapsed = ref({ '待办': false, '进行中': false, '已完成': true })

const isCollapsed = status => Boolean(collapsed.value[status])

const toggleGroup = status => {
  collapsed.value[status] = !collapsed.value[status]
}

const visibleTasks = group => (isCollapsed(group.status) ? [] : group.tasks)

const priorityClass = task => {
  if (task.priority === '高') return 'high'
  if (task.priority === '低') return 'low'
  return 'medium'
}
</script>

<style scoped>
.tb-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 12px 18px;
}

.tb-list-group + .tb-list-group { margin-top: 4px; }

.tb-list-head {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  min-height: 30px;
  padding: 8px 2px 4px;
  border: 0;
  border-top: 1px solid var(--bm-border-subtle);
  border-radius: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.tb-list-head:hover { background: var(--bm-bg-hover); }

.tb-list-group:first-child .tb-list-head { border-top: 0; }

.tb-list-chevron {
  width: 10px;
  color: var(--bm-text-muted);
  font-size: 8px;
  flex: 0 0 auto;
}

.tb-list-dot {
  width: 6px;
  height: 6px;
  border-radius: 2px;
  background: var(--bm-text-tertiary);
}

.tb-list-dot.doing { background: var(--bm-accent-blue); }
.tb-list-dot.done { background: var(--bm-accent-teal, #0f9d8a); }

.tb-list-head-title {
  color: var(--bm-text-primary);
  font-size: 12.5px;
  font-weight: 600;
}

.tb-list-head-count {
  color: var(--bm-text-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.tb-list-row {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-height: 36px;
  padding: 4px 6px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.tb-list-row:hover { background: var(--bm-bg-hover); }

.tb-list-check {
  display: grid;
  place-items: center;
  width: 17px;
  height: 17px;
  border: 1.4px solid var(--bm-border-strong);
  border-radius: 50%;
  color: transparent;
  font-size: 8px;
  flex: 0 0 auto;
}

.tb-list-row.done .tb-list-check {
  border-color: color-mix(in srgb, var(--bm-accent-teal, #0f9d8a) 55%, var(--bm-border-strong));
  background: color-mix(in srgb, var(--bm-accent-teal, #0f9d8a) 16%, transparent);
  color: var(--bm-accent-teal, #0f9d8a);
}

.tb-list-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--bm-text-primary);
  font-size: 13.5px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tb-list-row.done .tb-list-title {
  color: var(--bm-text-muted);
  text-decoration: line-through;
}

.tb-list-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
  color: var(--bm-text-muted);
  font-size: 11px;
}

.tb-list-project {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 150px;
}

.tb-list-project-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tb-list-priority { color: var(--bm-text-secondary); }
.tb-list-priority.high { color: var(--bm-accent-danger); }
.tb-list-priority.low { color: var(--bm-text-tertiary); }

.tb-list-due { font-variant-numeric: tabular-nums; }
.tb-list-due.today { color: var(--bm-accent-blue); }
.tb-list-due.overdue { color: var(--bm-accent-danger); }

.tb-list-assignee {
  max-width: 90px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tb-list-empty {
  margin: 0;
  padding: 8px 6px;
  color: var(--bm-text-tertiary);
  font-size: 12px;
}

@media (max-width: 900px) {
  .tb-list-project { max-width: 90px; }
  .tb-list-assignee { display: none; }
}
</style>
