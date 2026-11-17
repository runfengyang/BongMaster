<template>
  <div
    class="rm-row"
    :class="{
      completed: reminder.is_completed,
      selected,
      deleted,
      'is-flagged': reminder.is_flagged
    }"
    :data-reminder-id="reminder.id"
    @click="$emit('select', reminder, $event)"
    @dblclick.stop="startTitleEdit"
    @contextmenu.prevent="$emit('context', $event, reminder)"
  >
    <div class="rm-row-main">
      <button
        v-if="!deleted"
        type="button"
        class="rm-check"
        :class="{ checked: reminder.is_completed }"
        :disabled="busy"
        :aria-label="reminder.is_completed ? '标记为未完成' : '标记为完成'"
        @click.stop="toggleComplete"
      >
        <ReminderIcon name="check" :size="12" :stroke-width="2.6" class="rm-check-glyph" />
      </button>
      <span v-else class="rm-deleted-dot" aria-hidden="true"></span>

      <div class="rm-row-copy">
        <div class="rm-row-title-line">
          <span v-if="priorityMarks" :key="priorityMarks" class="rm-priority" :title="`优先级：${reminder.priority}`">{{ priorityMarks }}</span>
          <span v-if="reminder.is_flagged" class="rm-flag" title="已加旗标">
            <ReminderIcon name="flag" :size="13" :stroke-width="1.8" />
          </span>
          <input
            v-if="editingTitle"
            ref="titleInput"
            v-model="titleDraft"
            class="rm-title-input"
            type="text"
            @click.stop
            @keydown.enter.prevent="saveTitle"
            @keydown.esc.prevent="cancelTitle"
            @blur="saveTitle"
          >
          <span v-else class="rm-row-title" :title="reminder.title">{{ reminder.title }}</span>
          <button
            v-if="!deleted && subtaskCount"
            type="button"
            class="rm-subtask-toggle"
            :aria-label="expanded ? '收起子任务' : '展开子任务'"
            @click.stop="expanded = !expanded"
          >
            <ReminderIcon :name="expanded ? 'chevron-down' : 'chevron-right'" :size="12" :stroke-width="2" />
          </button>
        </div>

        <div v-if="metaText" class="rm-row-meta" :class="{ overdue }">
          <span class="rm-meta-text">{{ metaText }}</span>
          <span v-if="reminder.notes" class="rm-meta-icon" title="有备注">
            <ReminderIcon name="note" :size="12" />
          </span>
          <span v-if="reminder.url" class="rm-meta-icon" title="有链接">
            <ReminderIcon name="link" :size="12" />
          </span>
          <span v-if="Number(reminder.attachment_count) > 0" class="rm-meta-icon" title="有附件">
            <ReminderIcon name="paperclip" :size="12" />
          </span>
          <span v-if="reminder.recurrence_type && reminder.recurrence_type !== 'none'" class="rm-meta-icon" :title="recurrenceText">
            <ReminderIcon name="repeat" :size="12" />
          </span>
          <span v-if="tags.length" class="rm-meta-tags" :title="tags.map(tag => `#${tag}`).join(' ')">
            {{ tags.slice(0, 2).map(tag => `#${tag}`).join(' ') }}
          </span>
          <span v-if="subtaskCount" class="rm-meta-subtasks">{{ completedSubtaskCount }}/{{ subtaskCount }}</span>
        </div>

        <div v-if="metaMode === 'completed' && completedText" class="rm-row-meta rm-completed-meta">
          完成时间：{{ completedText }}
        </div>
        <div v-if="deleted && deletedText" class="rm-row-meta rm-completed-meta">
          删除于 {{ deletedText }}
        </div>
      </div>

      <div class="rm-row-actions">
        <template v-if="deleted">
          <button type="button" class="rm-text-action" @click.stop="restore">恢复</button>
          <button type="button" class="rm-text-action danger" @click.stop="purge">永久删除</button>
        </template>
        <button
          v-else
          type="button"
          class="rm-info"
          title="详细信息"
          aria-label="详细信息"
          @click.stop="$emit('detail', reminder, $event)"
        >
          <ReminderIcon name="info" :size="16" :stroke-width="1.5" />
        </button>
      </div>
    </div>

    <Transition name="rm-subtasks">
      <div v-if="!deleted && expanded && subtaskCount" class="rm-subtasks" @click.stop>
        <div
          v-for="subtask in subtasks"
          :key="subtask.id"
          class="rm-subtask"
          :class="{ completed: subtask.is_completed }"
        >
          <button
            type="button"
            class="rm-sub-check"
            :class="{ checked: subtask.is_completed }"
            :aria-label="subtask.is_completed ? '标记子任务为未完成' : '标记子任务为完成'"
            @click="toggleSubtask(subtask)"
          >
            <ReminderIcon name="check" :size="8" :stroke-width="3" />
          </button>
          <span class="rm-subtitle">{{ subtask.title }}</span>
          <button type="button" class="rm-sub-delete" title="删除子任务" @click="deleteSubtask(subtask)">
            <ReminderIcon name="close" :size="11" />
          </button>
        </div>
        <div class="rm-sub-add">
          <span class="rm-sub-plus"><ReminderIcon name="plus" :size="12" :stroke-width="2" /></span>
          <input
            ref="subtaskInput"
            v-model="subtaskDraft"
            type="text"
            placeholder="添加子任务"
            @keydown.enter.prevent="addSubtask"
          >
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import ReminderIcon from './ReminderIcon.vue'
import { useReminderStore } from '@stores/reminder-store'
import { playDoneSound } from '@composables/useCompletionEffect.js'
import {
  PRIORITY_MARKS,
  describeRecurrence,
  formatCompletedAt,
  formatDueDate,
  formatDueDateCompact,
  humanizeDate,
  isOverdue,
  normalizeTags
} from '@utils/reminders'

const props = defineProps({
  reminder: { type: Object, required: true },
  metaMode: { type: String, default: 'date' },
  selected: { type: Boolean, default: false },
  deleted: { type: Boolean, default: false }
})

defineEmits(['select', 'detail', 'context'])

const store = useReminderStore()
const editingTitle = ref(false)
const titleDraft = ref('')
const titleInput = ref(null)
const expanded = ref(false)
const subtaskDraft = ref('')
const subtaskInput = ref(null)
const busy = ref(false)

watch(() => store.subtasksExpanded, value => {
  expanded.value = !!value
})

const subtasks = computed(() => store.taskSubtasks[props.reminder.id] || [])
const subtaskCount = computed(() => subtasks.value.length)
const completedSubtaskCount = computed(() => subtasks.value.filter(item => item.is_completed).length)
const tags = computed(() => normalizeTags(props.reminder.tags))
const priorityMarks = computed(() => PRIORITY_MARKS[props.reminder.priority] || '')
const recurrenceText = computed(() => describeRecurrence(props.reminder))

const overdue = computed(() => isOverdue(props.reminder, store.today))

const metaText = computed(() => {
  const reminder = props.reminder
  if (props.metaMode === 'completed') {
    return [reminder.list_name, formatDueDateCompact(reminder)].filter(Boolean).join('  ')
  }
  if (props.metaMode === 'list-time') {
    if (overdue.value) {
      return [reminder.list_name, formatDueDate(reminder, store.today)].filter(Boolean).join('  ')
    }
    return [reminder.list_name, reminder.due_time].filter(Boolean).join('  ')
  }
  if (props.metaMode === 'list-date') {
    return [reminder.list_name, formatDueDate(reminder, store.today)].filter(Boolean).join('  ')
  }
  return formatDueDate(reminder, store.today)
})

const completedText = computed(() => {
  if (!props.reminder.is_completed) return ''
  return formatCompletedAt(props.reminder.completed_at || props.reminder.date, store.today)
})

const deletedText = computed(() => formatCompletedAt(props.reminder.deleted_at, store.today))

const toggleComplete = async () => {
  if (busy.value || props.deleted) return
  if (!props.reminder.is_completed && subtasks.value.some(item => !item.is_completed)) {
    const remaining = subtasks.value.filter(item => !item.is_completed).length
    if (!window.confirm(`还有 ${remaining} 个子任务未完成，仍然完成这个提醒事项吗？`)) return
  }
  busy.value = true
  const wasCompleted = props.reminder.is_completed
  const result = await store.toggleComplete(props.reminder.id, !wasCompleted)
  busy.value = false
  if (!wasCompleted && result?.reminder?.is_completed) playDoneSound()
}

const startTitleEdit = event => {
  if (props.deleted) return
  if (event?.target?.closest?.('button, input, textarea')) return
  titleDraft.value = props.reminder.title
  editingTitle.value = true
  nextTick(() => {
    titleInput.value?.focus()
    titleInput.value?.select()
  })
}

const saveTitle = async () => {
  if (!editingTitle.value) return
  editingTitle.value = false
  const title = titleDraft.value.trim()
  if (!title || title === props.reminder.title) return
  await store.updateReminder(props.reminder.id, { title })
}

const cancelTitle = () => {
  editingTitle.value = false
  titleDraft.value = ''
}

const toggleSubtask = async subtask => {
  await store.updateSubtask(subtask.id, props.reminder.id, { is_completed: !subtask.is_completed })
}

const addSubtask = async () => {
  const title = subtaskDraft.value.trim()
  if (!title) return
  await store.createSubtask(props.reminder.id, { title, sort_order: subtaskCount.value })
  subtaskDraft.value = ''
  nextTick(() => subtaskInput.value?.focus())
}

const deleteSubtask = async subtask => {
  await store.deleteSubtask(subtask.id, props.reminder.id)
}

const restore = async () => {
  await store.restoreReminders([props.reminder.id])
}

const purge = async () => {
  if (!window.confirm(`永久删除「${props.reminder.title}」？此操作无法撤销。`)) return
  await store.purgeReminder(props.reminder.id)
}
</script>

<style scoped>
.rm-row {
  padding: 0 12px 0 10px;
  border-radius: 8px;
  transition: background 120ms ease, opacity 160ms ease;
}

.rm-row:hover { background: var(--bm-bg-hover); }
.rm-row.selected { background: var(--bm-bg-active); }
.rm-row.completed { opacity: 0.62; }
.rm-row.deleted { opacity: 0.9; }

.rm-row-main {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  min-height: 38px;
  padding: 5px 0;
}

.rm-check {
  position: relative;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  margin-top: 1px;
  padding: 0;
  border: 1.5px solid var(--bm-border-strong);
  border-radius: 50%;
  background: transparent;
  color: transparent;
  cursor: pointer;
  flex: 0 0 auto;
  transition: border-color 120ms ease, background 120ms ease, color 120ms ease;
}

.rm-check:hover { border-color: var(--bm-text-muted); color: var(--bm-border-strong); }
.rm-check.checked {
  border-color: var(--bm-text-muted);
  background: var(--bm-text-muted);
  color: #fff;
}
.rm-check:disabled { cursor: default; opacity: 0.7; }
.rm-check-glyph { opacity: 0; transform: scale(0.6); transition: opacity 140ms ease, transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1); }
.rm-check:hover .rm-check-glyph { opacity: 1; }
.rm-check.checked .rm-check-glyph { opacity: 1; transform: scale(1); }

.rm-deleted-dot {
  width: 20px;
  height: 20px;
  margin-top: 2px;
  border-radius: 50%;
  background: var(--bm-bg-active);
  flex: 0 0 auto;
}

.rm-row-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.rm-row-title-line {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.rm-priority {
  display: inline-block;
  color: var(--bm-accent-danger);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: -0.06em;
  flex: 0 0 auto;
  animation: rmPriorityPop 320ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.rm-flag {
  color: var(--bm-accent-orange);
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  animation: rmFlagPop 300ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.rm-row-title {
  position: relative;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--bm-text-primary);
  font-size: 14px;
  line-height: 1.25;
  letter-spacing: -0.01em;
}

.rm-row-title::after {
  content: "";
  position: absolute;
  top: 52%;
  right: 0;
  left: 0;
  height: 1px;
  background: currentColor;
  transform: scaleX(0);
  transform-origin: left center;
  transition: transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.rm-row.completed .rm-row-title { color: var(--bm-text-muted); }
.rm-row.completed .rm-row-title::after { transform: scaleX(1); }

.rm-title-input {
  flex: 1;
  min-width: 0;
  height: 24px;
  padding: 0 4px;
  border: 1px solid var(--bm-accent-blue);
  border-radius: var(--bm-radius-sm);
  outline: none;
  background: var(--bm-bg-card);
  color: var(--bm-text-primary);
  font: inherit;
  font-size: 14.5px;
}

.rm-subtask-toggle {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--bm-text-muted);
  cursor: pointer;
  flex: 0 0 auto;
}

.rm-subtask-toggle:hover { background: var(--bm-bg-hover); }

.rm-row-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  color: var(--bm-text-muted);
  font-size: 11.5px;
  line-height: 1.3;
}

.rm-row-meta.overdue .rm-meta-text { color: var(--bm-accent-danger); }

.rm-meta-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rm-meta-icon {
  display: grid;
  place-items: center;
  color: var(--bm-text-tertiary);
  flex: 0 0 auto;
}

.rm-meta-tags {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--bm-text-muted);
}

.rm-meta-subtasks {
  flex: 0 0 auto;
  color: var(--bm-text-muted);
  font-variant-numeric: tabular-nums;
}

.rm-completed-meta { color: var(--bm-text-tertiary); }

.rm-row-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 20px;
  flex: 0 0 auto;
}

.rm-info {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--bm-text-tertiary);
  cursor: pointer;
  opacity: 0;
  transition: opacity 120ms ease, background 120ms ease;
}

.rm-row:hover .rm-info,
.rm-row.selected .rm-info { opacity: 1; }
.rm-info:hover { background: var(--bm-bg-hover); color: var(--bm-text-secondary); }

.rm-text-action {
  padding: 4px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--bm-accent-blue);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}

.rm-text-action:hover { background: color-mix(in srgb, var(--bm-accent-blue) 8%, transparent); }
.rm-text-action.danger { color: var(--bm-accent-danger); }
.rm-text-action.danger:hover { background: color-mix(in srgb, var(--bm-accent-danger) 8%, transparent); }

.rm-subtasks {
  margin: 0 0 8px 30px;
  padding: 2px 0 2px 10px;
  border-left: 1.5px solid var(--bm-border-default);
}

.rm-subtask {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
}

.rm-sub-check {
  display: grid;
  place-items: center;
  width: 15px;
  height: 15px;
  padding: 0;
  border: 1.3px solid var(--bm-border-strong);
  border-radius: 50%;
  background: transparent;
  color: transparent;
  cursor: pointer;
  flex: 0 0 auto;
}

.rm-sub-check.checked {
  border-color: var(--bm-text-muted);
  background: var(--bm-text-muted);
  color: #fff;
}

.rm-subtitle {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--bm-text-secondary);
  font-size: 13px;
}

.rm-subtask.completed .rm-subtitle {
  color: var(--bm-text-tertiary);
  text-decoration: line-through;
}

.rm-sub-delete {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--bm-text-tertiary);
  cursor: pointer;
  opacity: 0;
}

.rm-subtask:hover .rm-sub-delete { opacity: 1; }
.rm-sub-delete:hover { background: color-mix(in srgb, var(--bm-accent-danger) 8%, transparent); color: var(--bm-accent-danger); }

.rm-sub-add {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 26px;
  color: var(--bm-text-muted);
}

.rm-sub-plus { display: grid; place-items: center; }

.rm-sub-add input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--bm-text-primary);
  font: inherit;
  font-size: 13px;
}

.rm-sub-add input::placeholder { color: var(--bm-text-muted); }

.rm-subtasks-enter-active,
.rm-subtasks-leave-active {
  transition: opacity 120ms ease, transform 120ms ease;
  transform-origin: top;
}

.rm-subtasks-enter-from,
.rm-subtasks-leave-to {
  opacity: 0;
  transform: translateY(-3px);
}

@keyframes rmFlagPop {
  0% { transform: scale(0.6) rotate(-8deg); opacity: 0; }
  60% { transform: scale(1.18) rotate(3deg); opacity: 1; }
  100% { transform: scale(1) rotate(0); opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .rm-check-glyph { transition: opacity 120ms ease; transform: none; }
  .rm-row-title::after { transition: none; }
  .rm-flag { animation: none; }
}

@keyframes rmPriorityPop {
  0% { opacity: 0; transform: translateY(2px) scale(0.6); }
  55% { opacity: 1; transform: translateY(-1px) scale(1.18); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .rm-priority { animation: none; }
}
</style>
