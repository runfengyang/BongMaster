<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="rm-detail"
      :class="{ 'is-left': placement === 'left', 'is-closing': closing, 'is-opening': opening }"
      :style="popoverStyle"
      @close="$emit('close')"
      @cancel.prevent="$emit('close')"
    >
      <div v-if="reminder" class="rm-detail-body">
        <header class="rm-detail-header">
          <input
            v-model="form.title"
            class="rm-detail-title"
            type="text"
            placeholder="提醒事项"
            @input="onTitleInput"
            @keydown.enter.prevent="flushAndSave"
          >
          <button type="button" class="rm-detail-close" aria-label="关闭" @click="$emit('close')">
            <ReminderIcon name="close" :size="15" />
          </button>
        </header>

        <textarea
          v-model="form.notes"
          class="rm-detail-notes"
          rows="2"
          placeholder="添加备注"
          @input="onNotesInput"
        ></textarea>

        <div class="rm-detail-link">
          <ReminderIcon name="link" :size="14" />
          <input
            v-model="form.url"
            type="url"
            placeholder="添加链接"
            @input="onUrlInput"
            @keydown.enter.prevent="flushAndSave"
          >
        </div>

        <div class="rm-detail-section">
          <div class="rm-field-row rm-field-date">
            <span class="rm-field-icon"><ReminderIcon name="calendar" :size="17" /></span>
            <span class="rm-field-label">日期</span>
            <div class="rm-field-value">
              <template v-if="form.date">
                <div class="rm-quick-dates">
                  <button type="button" @click="quickDate('today')">今天</button>
                  <button type="button" @click="quickDate('tomorrow')">明天</button>
                  <button type="button" @click="quickDate('weekend')">本周末</button>
                </div>
                <div class="rm-date-inputs">
                  <input v-model="form.date" type="date" @change="onDateChange">
                  <input v-model="form.due_time" type="time" @change="onDueTimeChange">
                  <button v-if="form.due_time" type="button" class="rm-clear-time" title="清除时间" @click="clearTime">
                    <ReminderIcon name="close" :size="11" />
                  </button>
                </div>
                <div class="rm-inline-field">
                  <span>提醒我</span>
                  <input v-model="form.remind_time" type="time" @change="onRemindTimeChange">
                </div>
                <div class="rm-inline-field">
                  <span>重复</span>
                  <select v-model="form.recurrence_type" @change="onRecurrenceType">
                    <option v-for="option in RECURRENCE_OPTIONS" :key="option.value" :value="option.value">
                      {{ option.label }}
                    </option>
                  </select>
                </div>
                <div v-if="form.recurrence_type === 'weekly'" class="rm-weekdays">
                  <label v-for="day in weekdays" :key="day.value">
                    <input
                      type="checkbox"
                      :checked="weeklyDays.includes(day.value)"
                      @change="toggleWeekday(day.value)"
                    >
                    {{ day.label }}
                  </label>
                </div>
                <div v-if="form.recurrence_type === 'monthly'" class="rm-inline-field">
                  <span>每月</span>
                  <input
                    :value="form.recurrence_value"
                    type="number"
                    min="1"
                    max="31"
                    class="rm-number-input"
                    @change="onMonthlyDayChange"
                  >
                  <span class="rm-muted">日</span>
                </div>
                <div v-if="form.recurrence_type === 'custom'" class="rm-inline-field">
                  <span>每</span>
                  <input v-model.number="customCount" type="number" min="1" class="rm-number-input" @change="onCustomChange">
                  <select v-model="customUnit" @change="onCustomChange">
                    <option value="days">天</option>
                    <option value="weeks">周</option>
                    <option value="months">个月</option>
                    <option value="years">年</option>
                  </select>
                </div>
                <div v-if="form.recurrence_type !== 'none'" class="rm-inline-field">
                  <span>结束</span>
                  <input v-model="form.recurrence_end_date" type="date" @change="onRecurrenceEnd">
                </div>
                <label v-if="form.recurrence_type !== 'none'" class="rm-check-line">
                  <input v-model="form.repeat_from_completion" type="checkbox" @change="onRepeatFromCompletion">
                  完成后再次提醒
                </label>
              </template>
              <button v-else type="button" class="rm-add-date" @click="toggleDate">添加日期</button>
            </div>
          </div>

          <div class="rm-field-row">
            <span class="rm-field-icon"><ReminderIcon name="flag" :size="17" /></span>
            <span class="rm-field-label">旗标</span>
            <div class="rm-field-value">
              <button
                type="button"
                class="rm-switch"
                :class="{ on: form.is_flagged }"
                :aria-pressed="form.is_flagged"
                @click="toggleFlag"
              >
                <span></span>
              </button>
            </div>
          </div>

          <div class="rm-field-row">
            <span class="rm-field-icon"><ReminderIcon name="exclamation" :size="17" /></span>
            <span class="rm-field-label">优先级</span>
            <div class="rm-field-value">
              <select v-model="form.priority" class="rm-value-select" @change="onPriority">
                <option v-for="option in PRIORITY_OPTIONS" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </div>
          </div>

          <div class="rm-field-row">
            <span class="rm-field-icon"><ReminderIcon name="list" :size="17" /></span>
            <span class="rm-field-label">列表</span>
            <div class="rm-field-value">
              <select v-model.number="form.list_id" class="rm-value-select" @change="onListChange">
                <option v-for="list in lists" :key="list.id" :value="list.id">{{ list.name }}</option>
              </select>
            </div>
          </div>

          <div v-if="sectionsForList.length" class="rm-field-row">
            <span class="rm-field-icon"><ReminderIcon name="list" :size="17" /></span>
            <span class="rm-field-label">分区</span>
            <div class="rm-field-value">
              <select v-model="form.section_id" class="rm-value-select" @change="onSectionChange">
                <option :value="null">无</option>
                <option v-for="section in sectionsForList" :key="section.id" :value="section.id">{{ section.name }}</option>
              </select>
            </div>
          </div>

          <div class="rm-field-row rm-field-tags">
            <span class="rm-field-icon"><ReminderIcon name="tag" :size="17" /></span>
            <span class="rm-field-label">标签</span>
            <div class="rm-field-value rm-tags-editor">
              <span v-for="tag in tagList" :key="tag" class="rm-tag">
                #{{ tag }}
                <button type="button" :aria-label="`删除标签 ${tag}`" @click="removeTag(tag)">
                  <ReminderIcon name="close" :size="9" :stroke-width="2.4" />
                </button>
              </span>
              <input
                v-model="tagDraft"
                type="text"
                :placeholder="tagList.length ? '' : '添加标签'"
                @keydown.enter.prevent="addTag"
                @blur="addTag"
              >
            </div>
          </div>

          <div class="rm-field-row rm-field-attachments">
            <span class="rm-field-icon"><ReminderIcon name="paperclip" :size="17" /></span>
            <span class="rm-field-label">附件</span>
            <div class="rm-field-value rm-attachments">
              <div v-for="attachment in attachments" :key="attachment.id" class="rm-attachment">
                <button type="button" class="rm-attachment-name" @click="openAttachment(attachment)">
                  <ReminderIcon name="paperclip" :size="12" />
                  <span>{{ attachment.original_filename }}</span>
                  <small>{{ formatFileSize(attachment.file_size) }}</small>
                </button>
                <button type="button" class="rm-attachment-delete" aria-label="删除附件" @click="deleteAttachment(attachment)">
                  <ReminderIcon name="close" :size="10" />
                </button>
              </div>
              <button type="button" class="rm-add-attachment" @click="addAttachment">添加附件</button>
            </div>
          </div>

          <details class="rm-more">
            <summary>更多</summary>
            <div class="rm-field-row">
              <span class="rm-field-icon"><ReminderIcon name="folder" :size="17" /></span>
              <span class="rm-field-label">项目</span>
              <div class="rm-field-value">
                <select v-model="form.project_id" class="rm-value-select" @change="onProjectChange">
                  <option value="">不关联项目</option>
                  <option v-for="project in projects" :key="project.id" :value="String(project.id)">
                    {{ project.name }}
                  </option>
                </select>
              </div>
            </div>
          </details>
        </div>

        <div class="rm-detail-section rm-subtasks-section">
          <div class="rm-detail-section-title">子任务</div>
          <div v-for="subtask in subtasks" :key="subtask.id" class="rm-detail-subtask" :class="{ completed: subtask.is_completed }">
            <button
              type="button"
              class="rm-detail-sub-check"
              :class="{ checked: subtask.is_completed }"
              @click="toggleSubtask(subtask)"
            >
              <ReminderIcon name="check" :size="8" :stroke-width="3" />
            </button>
            <span>{{ subtask.title }}</span>
            <button type="button" class="rm-detail-sub-delete" @click="deleteSubtask(subtask)">
              <ReminderIcon name="close" :size="10" />
            </button>
          </div>
          <div class="rm-detail-sub-add">
            <ReminderIcon name="plus" :size="12" />
            <input
              ref="subtaskInput"
              v-model="newSubtask"
              type="text"
              placeholder="添加子任务"
              @keydown.enter.prevent="addSubtask"
            >
          </div>
        </div>

        <footer class="rm-detail-footer">
          <button type="button" class="rm-delete-reminder" @click="deleteReminder">删除提醒事项</button>
        </footer>
      </div>
    </dialog>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onUnmounted, reactive, ref, watch } from 'vue'
import { addDays, format, getDay, getISODay, parseISO } from 'date-fns'
import ReminderIcon from './ReminderIcon.vue'
import { useReminderStore } from '@stores/reminder-store'
import {
  PRIORITY_OPTIONS,
  RECURRENCE_OPTIONS,
  dateKey,
  formatFileSize,
  normalizeTags
} from '@utils/reminders'

const props = defineProps({
  show: { type: Boolean, default: false },
  reminder: { type: Object, default: null },
  anchor: { type: Object, default: null },
  focusField: { type: String, default: '' },
  lists: { type: Array, default: () => [] },
  sections: { type: Array, default: () => [] },
  projects: { type: Array, default: () => [] }
})

const emit = defineEmits(['close', 'delete'])
const store = useReminderStore()

const dialog = ref(null)
const closing = ref(false)
const opening = ref(false)
const syncing = ref(false)
const openedAt = ref(0)
let closeTimer = null
let openTimer = null
let saveTimer = null
let pendingPayload = null

const weekdays = [
  { value: 1, label: '一' },
  { value: 2, label: '二' },
  { value: 3, label: '三' },
  { value: 4, label: '四' },
  { value: 5, label: '五' },
  { value: 6, label: '六' },
  { value: 7, label: '日' }
]

const form = reactive({
  title: '',
  notes: '',
  url: '',
  date: '',
  due_time: '',
  remind_time: '',
  priority: '无',
  is_flagged: false,
  list_id: null,
  section_id: null,
  tags: '',
  project_id: '',
  recurrence_type: 'none',
  recurrence_value: '',
  recurrence_end_date: '',
  repeat_from_completion: false
})

const weeklyDays = ref([])
const customCount = ref(1)
const customUnit = ref('days')
const tagDraft = ref('')
const newSubtask = ref('')
const subtaskInput = ref(null)

const tagList = computed(() => normalizeTags(form.tags))
const sectionsForList = computed(() => (
  props.sections.filter(section => section.list_id === form.list_id)
))
const attachments = computed(() => (
  props.reminder ? store.attachments[props.reminder.id] || [] : []
))
const subtasks = computed(() => (
  props.reminder ? store.taskSubtasks[props.reminder.id] || [] : []
))

const resetForm = () => {
  const reminder = props.reminder
  if (!reminder) return
  syncing.value = true
  Object.assign(form, {
    title: reminder.title || '',
    notes: reminder.notes || '',
    url: reminder.url || '',
    date: reminder.date || '',
    due_time: reminder.due_time || '',
    remind_time: reminder.remind_time || '',
    priority: reminder.priority || '无',
    is_flagged: !!reminder.is_flagged,
    list_id: reminder.list_id || props.lists[0]?.id || null,
    section_id: reminder.section_id || null,
    tags: reminder.tags || '',
    project_id: reminder.project_id ? String(reminder.project_id) : '',
    recurrence_type: reminder.recurrence_type || 'none',
    recurrence_value: reminder.recurrence_value || '',
    recurrence_end_date: reminder.recurrence_end_date || '',
    repeat_from_completion: !!reminder.repeat_from_completion
  })
  weeklyDays.value = String(reminder.recurrence_value || '')
    .split(/[,，]/)
    .map(value => parseInt(value, 10))
    .filter(value => value >= 1 && value <= 7)
  if (reminder.recurrence_type === 'custom') {
    const [count, unit] = String(reminder.recurrence_value || '1:days').split(':')
    customCount.value = Math.max(1, parseInt(count, 10) || 1)
    customUnit.value = ['days', 'weeks', 'months', 'years'].includes(unit) ? unit : 'days'
  }
  tagDraft.value = ''
  newSubtask.value = ''
  nextTick(() => { syncing.value = false })
}

const layout = computed(() => {
  const width = 420
  const estimatedHeight = 640
  const anchor = props.anchor
  let left = (window.innerWidth - width) / 2
  let top = 70
  let side = 'right'
  if (anchor) {
    left = anchor.right + 10
    side = 'right'
    if (left + width > window.innerWidth - 12) {
      left = Math.max(12, anchor.left - width - 10)
      side = 'left'
    }
    top = Math.max(12, anchor.top - 10)
  }
  top = Math.min(top, Math.max(12, window.innerHeight - estimatedHeight - 12))
  const anchorY = anchor ? anchor.top + (anchor.height || 0) / 2 : top + 30
  const arrowTop = Math.max(16, Math.min(anchorY - top - 6, 110))
  return { left, top, side, arrowTop }
})

const placement = computed(() => layout.value.side)

const popoverStyle = computed(() => ({
  left: `${layout.value.left}px`,
  top: `${layout.value.top}px`,
  width: '420px',
  '--rm-arrow-top': `${layout.value.arrowTop}px`
}))

const buildDatePatch = () => ({
  date: form.date || '',
  due_time: form.due_time || null,
  remind_time: form.remind_time || null,
  recurrence_type: form.date ? form.recurrence_type : 'none',
  recurrence_value: form.date ? form.recurrence_value : '',
  recurrence_end_date: form.date ? (form.recurrence_end_date || null) : null,
  repeat_from_completion: form.date ? form.repeat_from_completion : false
})

const buildRecurrencePatch = () => ({
  recurrence_type: form.recurrence_type,
  recurrence_value: form.recurrence_value,
  recurrence_end_date: form.recurrence_end_date || null,
  repeat_from_completion: form.repeat_from_completion
})

const saveNow = async payload => {
  if (!props.reminder || !payload) return null
  return store.updateReminder(props.reminder.id, payload)
}

const save = (payload, { debounce = false } = {}) => {
  if (syncing.value || !props.reminder) return
  pendingPayload = payload
  if (saveTimer) {
    window.clearTimeout(saveTimer)
    saveTimer = null
  }
  if (!debounce) {
    saveNow(payload)
    pendingPayload = null
    return
  }
  saveTimer = window.setTimeout(() => {
    saveTimer = null
    const next = pendingPayload
    pendingPayload = null
    if (next) saveNow(next)
  }, 320)
}

const flushAndSave = () => {
  if (saveTimer) {
    window.clearTimeout(saveTimer)
    saveTimer = null
  }
  if (pendingPayload) {
    const next = pendingPayload
    pendingPayload = null
    saveNow(next)
  }
}

const onTitleInput = () => {
  const title = form.title.trim()
  if (!title) return
  save({ title }, { debounce: true })
}

const onNotesInput = () => save({ notes: form.notes }, { debounce: true })
const onUrlInput = () => save({ url: form.url }, { debounce: true })

const onDateChange = () => {
  if (!form.date) {
    form.recurrence_type = 'none'
    form.recurrence_value = ''
    form.recurrence_end_date = ''
  }
  save(buildDatePatch())
}

const quickDate = kind => {
  const now = new Date()
  if (kind === 'today') form.date = dateKey(now)
  else if (kind === 'tomorrow') form.date = format(addDays(now, 1), 'yyyy-MM-dd')
  else {
    const delta = (6 - getDay(now) + 7) % 7
    form.date = format(addDays(now, delta), 'yyyy-MM-dd')
  }
  save(buildDatePatch())
}

const toggleDate = () => {
  if (form.date) {
    form.date = ''
    form.due_time = ''
    form.remind_time = ''
    form.recurrence_type = 'none'
    form.recurrence_value = ''
    form.recurrence_end_date = ''
  } else {
    form.date = dateKey()
  }
  save(buildDatePatch())
}

const clearTime = () => {
  form.due_time = ''
  save({ due_time: null })
}

const onDueTimeChange = () => save({ due_time: form.due_time || null })
const onRemindTimeChange = () => save({ remind_time: form.remind_time || null })

const toggleFlag = () => {
  form.is_flagged = !form.is_flagged
  save({ is_flagged: form.is_flagged })
}

const onPriority = () => save({ priority: form.priority })

const onListChange = () => {
  form.section_id = null
  save({ list_id: form.list_id, section_id: null })
}

const onSectionChange = () => save({ section_id: form.section_id || null })

const onProjectChange = () => {
  save({ project_id: form.project_id ? Number(form.project_id) : null })
}

const onRecurrenceType = () => {
  if (form.recurrence_type === 'none') {
    form.recurrence_value = ''
    form.recurrence_end_date = ''
  } else if (form.recurrence_type === 'weekly') {
    const weekday = form.date ? getISODay(parseISO(form.date)) : 1
    if (!weeklyDays.value.length) weeklyDays.value = [weekday]
    form.recurrence_value = weeklyDays.value.join(',')
  } else if (form.recurrence_type === 'monthly') {
    const day = form.date ? parseISO(form.date).getDate() : 1
    form.recurrence_value = String(day)
  } else if (form.recurrence_type === 'custom') {
    form.recurrence_value = `${Math.max(1, parseInt(customCount.value, 10) || 1)}:${customUnit.value}`
  } else {
    form.recurrence_value = ''
  }
  save(buildRecurrencePatch())
}

const toggleWeekday = day => {
  const set = new Set(weeklyDays.value)
  if (set.has(day)) set.delete(day)
  else set.add(day)
  weeklyDays.value = [...set].sort((a, b) => a - b)
  form.recurrence_value = weeklyDays.value.join(',')
  save(buildRecurrencePatch())
}

const onMonthlyDayChange = event => {
  const day = Math.min(31, Math.max(1, parseInt(event.target.value, 10) || 1))
  form.recurrence_value = String(day)
  event.target.value = day
  save(buildRecurrencePatch())
}

const onCustomChange = () => {
  const count = Math.max(1, parseInt(customCount.value, 10) || 1)
  customCount.value = count
  form.recurrence_value = `${count}:${customUnit.value}`
  save(buildRecurrencePatch())
}

const onRecurrenceEnd = () => save({ recurrence_end_date: form.recurrence_end_date || null })
const onRepeatFromCompletion = () => save({ repeat_from_completion: form.repeat_from_completion })

const addTag = () => {
  const pieces = tagDraft.value
    .split(/[,，\s]+/)
    .map(tag => tag.replace(/^#/, '').trim())
    .filter(Boolean)
  tagDraft.value = ''
  if (!pieces.length) return
  const next = [...new Set([...tagList.value, ...pieces])]
  form.tags = next.join(',')
  save({ tags: form.tags })
}

const removeTag = tag => {
  form.tags = tagList.value.filter(item => item !== tag).join(',')
  save({ tags: form.tags })
}

const addAttachment = async () => {
  if (!props.reminder) return
  await store.addAttachment(props.reminder.id)
}

const openAttachment = async attachment => {
  await store.openAttachment(attachment.id)
}

const deleteAttachment = async attachment => {
  await store.deleteAttachment(attachment.id, props.reminder.id)
}

const addSubtask = async () => {
  const title = newSubtask.value.trim()
  if (!title || !props.reminder) return
  await store.createSubtask(props.reminder.id, { title, sort_order: subtasks.value.length })
  newSubtask.value = ''
}

const toggleSubtask = async subtask => {
  if (!props.reminder) return
  await store.updateSubtask(subtask.id, props.reminder.id, { is_completed: !subtask.is_completed })
}

const deleteSubtask = async subtask => {
  if (!props.reminder) return
  await store.deleteSubtask(subtask.id, props.reminder.id)
}

const deleteReminder = () => {
  if (!props.reminder) return
  if (!window.confirm(`删除「${props.reminder.title}」？可在最近删除中恢复。`)) return
  emit('delete', props.reminder)
}

const closeOnOutside = event => {
  if (Date.now() - openedAt.value < 250) return
  if (event.target.closest('.rm-info')) return
  if (dialog.value?.open && !dialog.value.contains(event.target)) emit('close')
}

const closeOnEscape = event => {
  if (event.key !== 'Escape') return
  event.preventDefault()
  emit('close')
}

watch(() => props.show, async visible => {
  if (visible) {
    openedAt.value = Date.now()
    opening.value = false
    if (openTimer) window.clearTimeout(openTimer)
    if (closeTimer) {
      window.clearTimeout(closeTimer)
      closeTimer = null
    }
    closing.value = false
    resetForm()
    if (props.reminder) {
      store.fetchAttachments(props.reminder.id)
      store.fetchSubtasks(props.reminder.id)
    }
    await nextTick()
    if (dialog.value && !dialog.value.open) {
      if (typeof dialog.value.show === 'function') dialog.value.show()
      else dialog.value.showModal()
    }
    await nextTick()
    window.requestAnimationFrame(() => {
      opening.value = true
      openTimer = window.setTimeout(() => {
        opening.value = false
        openTimer = null
      }, 220)
    })
    if (props.focusField === 'subtask') {
      await nextTick()
      subtaskInput.value?.focus()
    }
    document.addEventListener('click', closeOnOutside, true)
    document.addEventListener('keydown', closeOnEscape)
  } else {
    opening.value = false
    if (openTimer) {
      window.clearTimeout(openTimer)
      openTimer = null
    }
    document.removeEventListener('click', closeOnOutside, true)
    document.removeEventListener('keydown', closeOnEscape)
    flushAndSave()
    if (dialog.value?.open) {
      closing.value = true
      closeTimer = window.setTimeout(() => {
        if (dialog.value?.open) dialog.value.close()
        closing.value = false
        closeTimer = null
      }, 120)
    }
  }
}, { immediate: true })

watch(() => props.reminder?.id, () => {
  if (props.show) resetForm()
})

onUnmounted(() => {
  if (openTimer) window.clearTimeout(openTimer)
  if (closeTimer) window.clearTimeout(closeTimer)
})
</script>

<style scoped>
.rm-detail {
  position: fixed;
  inset: auto;
  z-index: 1200;
  margin: 0;
  padding: 0;
  max-height: min(640px, calc(100vh - 24px));
  overflow-y: auto;
  border: 1px solid var(--bm-border-default);
  border-radius: var(--bm-radius-lg);
  background: var(--bm-bg-card);
  color: var(--bm-text-primary);
  box-shadow: var(--bm-shadow-lg);
  font-family: var(--bm-font-ui);
  animation: rm-detail-in 150ms cubic-bezier(0.2, 0.9, 0.25, 1);
}

.rm-detail::before {
  content: '';
  position: absolute;
  top: var(--rm-arrow-top, 24px);
  left: -6px;
  width: 11px;
  height: 11px;
  background: var(--bm-bg-card);
  border-left: 1px solid var(--bm-border-default);
  border-bottom: 1px solid var(--bm-border-default);
  transform: rotate(45deg);
}

.rm-detail.is-left::before {
  right: -6px;
  left: auto;
  border: 0;
  border-right: 1px solid var(--bm-border-default);
  border-top: 1px solid var(--bm-border-default);
}

.rm-detail.is-closing { opacity: 0; transform: scale(0.985); transition: opacity 110ms ease, transform 110ms ease; }

.rm-detail-body { display: flex; flex-direction: column; }

.rm-detail-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 14px 4px 18px;
}

.rm-detail-title {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--bm-text-primary);
  font: inherit;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.rm-detail-close {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--bm-bg-hover);
  color: var(--bm-text-muted);
  cursor: pointer;
}

.rm-detail-close:hover { background: var(--bm-bg-active); color: var(--bm-text-primary); }

.rm-detail-notes {
  width: 100%;
  min-height: 48px;
  padding: 4px 18px 8px;
  border: 0;
  outline: none;
  resize: vertical;
  background: transparent;
  color: var(--bm-text-primary);
  font: inherit;
  font-size: 13.5px;
  line-height: 1.45;
}

.rm-detail-notes::placeholder { color: var(--bm-text-muted); }

.rm-detail-link {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 14px 8px 18px;
  padding: 5px 8px;
  border-radius: 6px;
  background: var(--bm-bg-hover);
  color: var(--bm-text-muted);
}

.rm-detail-link input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--bm-text-primary);
  font: inherit;
  font-size: 12px;
}

.rm-detail-section {
  padding: 2px 14px 6px;
  border-top: 1px solid var(--bm-border-subtle);
}

.rm-field-row {
  display: grid;
  grid-template-columns: 22px 56px minmax(0, 1fr);
  align-items: start;
  gap: 4px;
  padding: 7px 0;
  border-bottom: 1px solid var(--bm-border-subtle);
}

.rm-field-row:last-child { border-bottom: 0; }

.rm-field-icon {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  color: var(--bm-text-muted);
}

.rm-field-label {
  padding-top: 2px;
  color: var(--bm-text-secondary);
  font-size: 12.5px;
}

.rm-field-value { min-width: 0; }

.rm-quick-dates {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-bottom: 6px;
}

.rm-quick-dates button {
  padding: 3px 8px;
  border: 1px solid var(--bm-border-default);
  border-radius: 999px;
  background: var(--bm-bg-hover);
  color: var(--bm-text-secondary);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.rm-quick-dates button:hover { background: var(--bm-accent-blue); border-color: var(--bm-accent-blue); color: #fff; }

.rm-date-inputs {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 5px;
}

.rm-date-inputs input[type='date'],
.rm-date-inputs input[type='time'],
.rm-inline-field input,
.rm-inline-field select,
.rm-value-select,
.rm-number-input {
  height: 25px;
  padding: 0 6px;
  border: 1px solid var(--bm-border-default);
  border-radius: var(--bm-radius-sm);
  outline: none;
  background: var(--bm-bg-card);
  color: var(--bm-text-primary);
  font: inherit;
  font-size: 12px;
}

.rm-date-inputs input[type='date'] { flex: 1; min-width: 120px; }
.rm-date-inputs input[type='time'] { width: 92px; }

.rm-clear-time {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--bm-bg-hover);
  color: var(--bm-text-muted);
  cursor: pointer;
}

.rm-inline-field {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 5px;
  color: var(--bm-text-secondary);
  font-size: 12px;
}

.rm-inline-field span:first-child { flex: 0 0 40px; white-space: nowrap; }
.rm-muted { color: var(--bm-text-muted); }

.rm-weekdays {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 2px 0 6px;
}

.rm-weekdays label {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--bm-text-secondary);
  font-size: 11px;
}

.rm-check-line {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--bm-text-secondary);
  font-size: 11.5px;
}

.rm-add-date {
  padding: 3px 8px;
  border: 1px dashed var(--bm-border-strong);
  border-radius: var(--bm-radius-sm);
  background: transparent;
  color: var(--bm-accent-blue);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.rm-add-date:hover { border-color: var(--bm-accent-blue); background: color-mix(in srgb, var(--bm-accent-blue) 6%, transparent); }

.rm-switch {
  position: relative;
  width: 34px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: var(--bm-border-default);
  cursor: pointer;
  transition: background 130ms ease;
}

.rm-switch span {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.2);
  transition: transform 130ms ease;
}

.rm-switch.on { background: #34c759; }
.rm-switch.on span { transform: translateX(14px); }

.rm-value-select { max-width: 190px; }

.rm-tags-editor {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  min-height: 25px;
}

.rm-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 5px 2px 6px;
  border-radius: 5px;
  background: var(--bm-bg-hover);
  color: var(--bm-text-secondary);
  font-size: 11px;
}

.rm-tag button {
  display: grid;
  place-items: center;
  width: 13px;
  height: 13px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--bm-text-muted);
  cursor: pointer;
}

.rm-tag button:hover { background: var(--bm-bg-active); color: var(--bm-text-primary); }

.rm-tags-editor input {
  flex: 1;
  min-width: 80px;
  height: 23px;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--bm-text-primary);
  font: inherit;
  font-size: 12px;
}

.rm-attachments { display: flex; flex-direction: column; gap: 4px; }

.rm-attachment { display: flex; align-items: center; gap: 4px; }

.rm-attachment-name {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  padding: 2px 4px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--bm-accent-blue);
  font: inherit;
  font-size: 11.5px;
  cursor: pointer;
  text-align: left;
}

.rm-attachment-name span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rm-attachment-name small { color: var(--bm-text-tertiary); font-size: 10px; }

.rm-attachment-delete {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--bm-text-tertiary);
  cursor: pointer;
}

.rm-attachment-delete:hover { background: color-mix(in srgb, var(--bm-accent-danger) 10%, transparent); color: var(--bm-accent-danger); }

.rm-add-attachment {
  align-self: flex-start;
  padding: 2px 0;
  border: 0;
  background: transparent;
  color: var(--bm-accent-blue);
  font: inherit;
  font-size: 11.5px;
  cursor: pointer;
}

.rm-more { margin-top: 4px; }

.rm-more summary {
  cursor: pointer;
  color: var(--bm-text-muted);
  font-size: 11.5px;
  list-style: none;
}

.rm-more summary::-webkit-details-marker { display: none; }
.rm-more summary::before { content: '›'; margin-right: 4px; }

.rm-detail-section-title {
  padding: 10px 0 4px;
  color: var(--bm-text-muted);
  font-size: 11px;
  font-weight: 600;
}

.rm-subtasks-section { padding-bottom: 8px; }

.rm-detail-subtask {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 26px;
  font-size: 12.5px;
}

.rm-detail-subtask.completed span { color: var(--bm-text-tertiary); text-decoration: line-through; }

.rm-detail-sub-check {
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
}

.rm-detail-sub-check.checked { border-color: var(--bm-text-muted); background: var(--bm-text-muted); color: #fff; }

.rm-detail-subtask span { flex: 1; min-width: 0; }

.rm-detail-sub-delete {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--bm-text-tertiary);
  cursor: pointer;
  opacity: 0;
}

.rm-detail-subtask:hover .rm-detail-sub-delete { opacity: 1; }

.rm-detail-sub-add {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 2px 0;
  color: var(--bm-text-muted);
}

.rm-detail-sub-add input {
  flex: 1;
  min-width: 0;
  height: 24px;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--bm-text-primary);
  font: inherit;
  font-size: 12.5px;
}

.rm-detail-footer {
  padding: 8px 14px 12px;
  border-top: 1px solid var(--bm-border-subtle);
}

.rm-delete-reminder {
  padding: 4px 0;
  border: 0;
  background: transparent;
  color: var(--bm-accent-danger);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
}

.rm-delete-reminder:hover { text-decoration: underline; }

@keyframes rm-detail-in {
  from { opacity: 0; transform: translateY(4px) scale(0.985); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.rm-detail { transform-origin: left top; }
.rm-detail.is-left { transform-origin: right top; }
.rm-detail.is-opening { animation: rmDetailIn 180ms cubic-bezier(0.2, 0.8, 0.2, 1); }

@keyframes rmDetailIn {
  from { opacity: 0; transform: scale(0.96) translateY(4px); }
  to { opacity: 1; transform: none; }
}

@media (prefers-reduced-motion: reduce) {
  .rm-detail.is-opening { animation: none; }
}
</style>
