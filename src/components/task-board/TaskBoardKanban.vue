<template>
  <div class="tb-board">
    <TaskBoardColumn
      status="待办"
      title="待办"
      :tasks="todoTasks"
      :recently-moved-task-id="recentlyMovedTaskId"
      :recently-completed-task-id="recentlyCompletedTaskId"
      :can-add="canAdd"
      :default-project-name="defaultProjectName"
      @task-click="$emit('task-click', $event)"
      @status-change="$emit('status-change', $event)"
      @quick-add="$emit('quick-add', $event)"
      @context-menu="(task, event) => $emit('context-menu', task, event)"
    />

    <TaskBoardColumn
      status="进行中"
      title="进行中"
      :tasks="doingTasks"
      :recently-moved-task-id="recentlyMovedTaskId"
      :recently-completed-task-id="recentlyCompletedTaskId"
      :can-add="canAdd"
      :default-project-name="defaultProjectName"
      @task-click="$emit('task-click', $event)"
      @status-change="$emit('status-change', $event)"
      @quick-add="$emit('quick-add', $event)"
      @context-menu="(task, event) => $emit('context-menu', task, event)"
    />

    <TaskDoneRail
      :tasks="doneTasks"
      :expanded="doneExpanded"
      @task-click="$emit('task-click', $event)"
      @context-menu="(task, event) => $emit('context-menu', task, event)"
      @toggle="$emit('done-toggle')"
      @status-change="$emit('status-change', $event)"
    />
  </div>
</template>

<script setup>
import TaskBoardColumn from './TaskBoardColumn.vue'
import TaskDoneRail from './TaskDoneRail.vue'

defineProps({
  todoTasks: { type: Array, default: () => [] },
  doingTasks: { type: Array, default: () => [] },
  doneTasks: { type: Array, default: () => [] },
  doneExpanded: { type: Boolean, default: false },
  recentlyMovedTaskId: { type: [Number, String, null], default: null },
  recentlyCompletedTaskId: { type: [Number, String, null], default: null },
  canAdd: { type: Boolean, default: false },
  defaultProjectName: { type: String, default: '' }
})

defineEmits(['task-click', 'status-change', 'quick-add', 'context-menu', 'done-toggle'])
</script>

<style scoped>
.tb-board {
  display: flex;
  align-items: stretch;
  gap: 10px;
  flex: 1;
  min-height: 0;
  padding: 10px;
}

.tb-board > :deep(.tb-column) {
  flex: 1 1 0;
  min-width: 0;
}

@media (max-width: 1000px) {
  .tb-board { flex-direction: column; overflow-y: auto; }
  .tb-board > :deep(.tb-column),
  .tb-board > :deep(.tb-done-rail) { flex: 0 0 auto; min-height: 240px; }
}
</style>
