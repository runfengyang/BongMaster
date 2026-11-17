<template>
  <section class="rm-content" aria-label="提醒事项列表">
    <header class="rm-list-header">
      <h1 class="rm-list-title" :style="{ color: viewColor }">{{ viewTitle }}</h1>
      <span class="rm-header-count" :style="{ color: viewColor }">{{ headerCount }}</span>
    </header>

    <div v-if="view.type !== 'recentlyDeleted'" class="rm-list-subheader">
      <div class="rm-completed-line">
        <span>{{ completedText }}</span>
        <template v-if="completedCount">
          <span class="rm-dot">·</span>
          <span class="rm-clear-wrap">
            <button type="button" class="rm-clear-button" @click.stop="clearMenuOpen = !clearMenuOpen">清除</button>
            <span v-if="clearMenuOpen" class="rm-clear-backdrop" @click="clearMenuOpen = false"></span>
            <span v-if="clearMenuOpen" class="rm-clear-menu">
              <button type="button" @click="clearCompletedOlder(30)">超过 1 个月</button>
              <button type="button" @click="clearCompletedOlder(183)">超过 6 个月</button>
              <button type="button" @click="clearCompletedOlder(365)">超过 1 年</button>
              <button type="button" @click="clearCompletedOlder(null)">所有完成项目</button>
            </span>
          </span>
        </template>
      </div>
      <button
        v-if="completedCount && view.id !== 'completed'"
        type="button"
        class="rm-show-completed"
        @click="store.showCompleted = !store.showCompleted"
      >
        {{ store.showCompleted ? '隐藏' : '显示' }}
      </button>
    </div>

    <div ref="scrollRef" class="rm-scroll" @click.self="clearSelection">
      <div v-if="store.loading" class="rm-loading">载入中…</div>

      <template v-else>
        <div v-if="showEmptyMessage" class="rm-empty">
          {{ emptyText }}
        </div>

        <div
          v-for="group in store.groups"
          :key="group.key"
          class="rm-group"
          :class="`rm-group-${group.kind}`"
        >
          <div v-if="group.kind === 'section' && sectionRenamingId === group.sectionId" class="rm-section-header editing">
            <input
              ref="sectionInput"
              v-model="sectionNameDraft"
              class="rm-section-input"
              type="text"
              @keydown.enter.prevent="saveSectionName(group)"
              @keydown.esc.prevent="cancelSectionName"
              @blur="saveSectionName(group)"
            >
          </div>

          <div
            v-else-if="group.title"
            class="rm-group-header"
            :class="headerClass(group)"
            :style="headerStyle(group)"
            @click="onGroupHeaderClick(group)"
            @contextmenu.prevent="onGroupContext($event, group)"
          >
            <button
              v-if="group.kind === 'section'"
              type="button"
              class="rm-section-chevron"
              :aria-label="group.collapsed ? '展开分区' : '收起分区'"
              @click.stop="toggleSection(group)"
            >
              <ReminderIcon :name="group.collapsed ? 'chevron-right' : 'chevron-down'" :size="12" :stroke-width="2" />
            </button>
            <span class="rm-group-title">{{ group.title }}</span>
            <span v-if="group.kind === 'section'" class="rm-section-count">
              {{ group.items.length }}
            </span>
            <button
              v-if="group.kind === 'section'"
              type="button"
              class="rm-section-more"
              :aria-label="`${group.title} 的分区操作`"
              @click.stop="$emit('section-menu', $event, group)"
            >
              <ReminderIcon name="ellipsis" :size="14" />
            </button>
          </div>

          <template v-if="group.kind === 'month'">
            <div v-for="subgroup in group.subgroups" :key="subgroup.key" class="rm-month-block">
              <div class="rm-day-header">{{ subgroup.title }}</div>
              <ReminderRow
                v-for="reminder in subgroup.items"
                :key="reminder.id"
                :reminder="reminder"
                :meta-mode="group.metaMode"
                :selected="isSelected(reminder.id)"
                :deleted="false"
                @select="handleSelect"
                @detail="(item, event) => $emit('open-detail', item, event)"
                @context="(event, item) => $emit('context-menu', event, item)"
              />
            </div>
          </template>

          <template v-else>
            <div v-if="!group.collapsed" class="rm-group-items">
              <draggable
                :list="group.items"
                item-key="id"
                tag="div"
                class="rm-draggable"
                :group="{ name: 'rm-reminders' }"
                :disabled="!canDrag(group)"
                :animation="160"
                :class="{ 'is-drag-enabled': canDrag(group) }"
                ghost-class="rm-row-ghost"
                @start="onDragStart"
                @end="onDragEnd"
                @change="onDragChange($event, group)"
              >
                <template #item="{ element }">
                  <ReminderRow
                    :reminder="element"
                    :meta-mode="group.metaMode"
                    :selected="isSelected(element.id)"
                    :deleted="group.kind === 'deleted'"
                    @select="handleSelect"
                    @detail="(item, event) => $emit('open-detail', item, event)"
                    @context="(event, item) => $emit('context-menu', event, item)"
                  />
                </template>
              </draggable>

              <div
                v-if="group.add && !store.searchQuery.trim()"
                class="rm-inline-add"
                :class="{ 'is-composing': activeAddKey === group.key }"
              >
                <button
                  type="button"
                  class="rm-add-circle"
                  :aria-label="activeAddKey === group.key ? '保存提醒事项' : addPlaceholder(group)"
                  @mousedown.prevent
                  @click="activeAddKey === group.key ? commitAdd(group) : openAdd(group)"
                >
                  <ReminderIcon v-if="activeAddKey !== group.key" name="plus" :size="12" :stroke-width="2" />
                </button>
                <div
                  v-if="activeAddKey === group.key"
                  class="rm-composer"
                  @focusout="onComposerFocusOut($event, group)"
                >
                  <div class="rm-compose-body">
                    <input
                      :ref="element => setAddInputRef(element, group.key)"
                      v-model="draftTitle"
                      class="rm-add-input rm-compose-title"
                      type="text"
                      :placeholder="addPlaceholder(group)"
                      @keydown.enter.prevent="commitAdd(group)"
                      @keydown.esc.prevent="cancelAdd"
                    >
                    <input
                      v-model="draftNotes"
                      class="rm-compose-note"
                      type="text"
                      placeholder="备注"
                      @keydown.enter.prevent="commitAdd(group)"
                      @keydown.esc.prevent="cancelAdd"
                    >
                    <input
                      v-model="draftTags"
                      class="rm-compose-tags"
                      type="text"
                      placeholder="添加标签"
                      @keydown.enter.prevent="commitAdd(group)"
                      @keydown.esc.prevent="cancelAdd"
                    >
                    <div class="rm-compose-toolbar">
                      <button
                        type="button"
                        class="rm-compose-pill"
                        :class="{ active: datePickerOpen || draftDate }"
                        @mousedown.prevent
                        @click="datePickerOpen = !datePickerOpen"
                      >
                        <ReminderIcon name="calendar" :size="14" />
                        <span v-if="draftDate">{{ humanizeDate(draftDate, store.today) }}<template v-if="draftDueTime"> {{ draftDueTime }}</template></span>
                        <span v-else>添加日期</span>
                      </button>
                      <button
                        type="button"
                        class="rm-compose-icon"
                        title="添加标签"
                        @mousedown.prevent
                        @click="openTagPicker($event)"
                      >
                        <ReminderIcon name="tag" :size="14" />
                      </button>
                      <button
                        type="button"
                        class="rm-compose-icon"
                        :class="{ active: draftFlagged }"
                        title="旗标"
                        @mousedown.prevent
                        @click="draftFlagged = !draftFlagged"
                      >
                        <ReminderIcon name="flag" :size="14" />
                      </button>
                      <button
                        type="button"
                        class="rm-compose-icon"
                        title="添加附件"
                        @mousedown.prevent
                        @click="pickDraftAttachment"
                      >
                        <ReminderIcon name="paperclip" :size="14" />
                      </button>
                    </div>
                    <div v-if="draftAttachments.length" class="rm-compose-attachments">
                      <span
                        v-for="(file, index) in draftAttachments"
                        :key="`${file.name}-${index}`"
                        class="rm-compose-attachment"
                      >
                        <ReminderIcon name="paperclip" :size="11" />
                        <span class="rm-compose-attachment-name">{{ file.name }}</span>
                        <button
                          type="button"
                          aria-label="移除附件"
                          @mousedown.prevent
                          @click="draftAttachments.splice(index, 1)"
                        >
                          <ReminderIcon name="close" :size="9" />
                        </button>
                      </span>
                    </div>
                    <div v-if="datePickerOpen" class="rm-compose-date">
                      <input v-model="draftDate" type="date">
                      <input v-model="draftDueTime" type="time">
                      <button type="button" @mousedown.prevent @click="draftDate = ''; draftDueTime = ''">清除</button>
                    </div>
                    <div
                      v-if="tagPickerOpen"
                      class="rm-tag-picker-backdrop"
                      @mousedown.prevent
                      @click="tagPickerOpen = false"
                    ></div>
                    <div v-if="tagPickerOpen" class="rm-tag-picker" :style="tagPickerStyle" @click.stop>
                      <input
                        v-model="tagQuery"
                        type="text"
                        placeholder="搜索或新建标签"
                        @keydown.enter.prevent="createTagFromQuery"
                      >
                      <div class="rm-tag-picker-list">
                        <button
                          v-for="tag in store.allTags"
                          :key="tag.name"
                          type="button"
                          :class="{ selected: draftTagList.includes(tag.name) }"
                          @mousedown.prevent
                          @click="toggleDraftTag(tag.name)"
                        >
                          <span>#{{ tag.name }}</span>
                          <ReminderIcon v-if="draftTagList.includes(tag.name)" name="check" :size="12" />
                        </button>
                        <div v-if="!store.allTags.length" class="rm-tag-picker-empty">还没有标签</div>
                      </div>
                      <button
                        v-if="canCreateTag"
                        type="button"
                        class="rm-tag-picker-create"
                        @mousedown.prevent
                        @click="createTagFromQuery"
                      >
                        新建 “#{{ tagQuery.trim().replace(/^#/, '') }}”
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    class="rm-compose-info"
                    title="详细信息"
                    @mousedown.prevent
                    @click="detailDraft(group, $event)"
                  >
                    <ReminderIcon name="info" :size="15" />
                  </button>
                </div>
                <button v-else type="button" class="rm-add-placeholder" @click="openAdd(group)">
                  {{ addPlaceholder(group) }}
                </button>
              </div>
            </div>
          </template>
        </div>

        <div v-if="view.type === 'list' && !store.searchQuery.trim()" class="rm-list-bottom-space"></div>
      </template>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, ref } from 'vue'
import draggable from 'vuedraggable'
import ReminderRow from './ReminderRow.vue'
import ReminderIcon from './ReminderIcon.vue'
import { useReminderStore } from '@stores/reminder-store'
import { useUndoStore } from '@stores/undo-store'
import { colorHex, humanizeDate } from '@utils/reminders'
import { parseReminderInput } from '@utils/reminder-parser'

const emit = defineEmits(['open-detail', 'context-menu', 'section-menu', 'date-menu', 'list-menu'])

const store = useReminderStore()
const undoStore = useUndoStore()
const scrollRef = ref(null)
const sectionRenamingId = ref(null)
const sectionNameDraft = ref('')
const sectionInput = ref(null)

const activeAddKey = ref('')
const draftTitle = ref('')
const draftNotes = ref('')
const draftTags = ref('')
const draftDate = ref('')
const draftDueTime = ref('')
const draftFlagged = ref(false)
const datePickerOpen = ref(false)
const tagPickerOpen = ref(false)
const tagQuery = ref('')
const tagPickerStyle = ref({})
const draftAttachments = ref([])
const clearMenuOpen = ref(false)
const addInputs = new Map()

const view = computed(() => store.selectedView)
const viewTitle = computed(() => store.viewTitle)
const viewColor = computed(() => store.viewColor)
const headerCount = computed(() => store.headerCount)
const completedCount = computed(() => store.completedCount)
const completedText = computed(() => (
  view.value.type === 'list' && store.selectedList?.kind === 'shopping'
    ? `已购买 ${completedCount.value} 项`
    : `${completedCount.value}项完成`
))

const draftTagList = computed(() => (
  draftTags.value.split(/[,，]/).map(tag => tag.trim()).filter(Boolean)
))

const canCreateTag = computed(() => {
  const name = tagQuery.value.trim().replace(/^#/, '')
  return Boolean(name)
    && !draftTagList.value.includes(name)
    && !store.allTags.some(tag => tag.name === name)
})

const resetDraft = () => {
  draftTitle.value = ''
  draftNotes.value = ''
  draftTags.value = ''
  draftDate.value = ''
  draftDueTime.value = ''
  draftFlagged.value = false
  datePickerOpen.value = false
  tagPickerOpen.value = false
  tagQuery.value = ''
  draftAttachments.value = []
}

const openTagPicker = event => {
  tagQuery.value = ''
  const rect = event.currentTarget.getBoundingClientRect()
  const width = 224
  const height = 280
  const left = Math.min(rect.left, window.innerWidth - width - 8)
  let top = rect.bottom + 6
  if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 6)
  tagPickerStyle.value = { left: `${left}px`, top: `${top}px` }
  tagPickerOpen.value = true
}

const toggleDraftTag = name => {
  const list = draftTagList.value.slice()
  const index = list.indexOf(name)
  if (index >= 0) list.splice(index, 1)
  else list.push(name)
  draftTags.value = list.join(',')
}

const createTagFromQuery = () => {
  const name = tagQuery.value.trim().replace(/^#/, '')
  if (!name) return
  if (!draftTagList.value.includes(name)) {
    draftTags.value = [...draftTagList.value, name].join(',')
  }
  tagQuery.value = ''
}

const pickDraftAttachment = async () => {
  const file = await store.pickAttachment()
  if (!file || file.cancelled) return
  draftAttachments.value.push(file)
}

const setAddInputRef = (element, key) => {
  if (element) addInputs.set(key, element)
  else addInputs.delete(key)
}

const addPlaceholder = group => {
  const listId = group.add?.listId || store.defaultListId
  const list = store.lists.find(item => item.id === listId)
  if (group.add?.date) return `${humanizeDate(group.add.date, store.today)}的新提醒事项`
  if (list && view.value.type !== 'list') return `“${list.name}”中的新提醒事项`
  return '新提醒事项'
}

const isSelected = id => store.selectedIds.includes(id)

const handleSelect = (reminder, event) => {
  if (event?.metaKey || event?.ctrlKey) {
    store.toggleSelection(reminder.id, true)
    return
  }
  if (event?.shiftKey) {
    const flat = store.groups.flatMap(group => group.kind === 'month'
      ? group.subgroups.flatMap(subgroup => subgroup.items)
      : group.items)
    const ids = flat.map(item => item.id)
    const anchor = store.selectedReminderId
    if (anchor && ids.includes(anchor)) {
      const start = ids.indexOf(anchor)
      const end = ids.indexOf(reminder.id)
      const [from, to] = start < end ? [start, end] : [end, start]
      store.setSelectedIds(ids.slice(from, to + 1))
      return
    }
  }
  store.selectReminder(reminder.id)
}

const clearSelection = () => {
  store.selectedReminderId = null
  store.selectedIds = []
}

const headerClass = group => ({
  'rm-group-header-emphasis': group.kind === 'list' || group.kind === 'month' || isEmphasisDate(group),
  'rm-group-header-section': group.kind === 'section',
  'rm-group-header-time': group.kind === 'time',
  'rm-group-header-plain': group.kind === 'plain' && Boolean(group.title)
})

const isEmphasisDate = group => {
  if (group.kind !== 'date') return false
  return group.title === '今天' || group.title.includes('其他时间') || /月$/.test(group.title)
}

const headerStyle = group => ({
  color: group.color ? colorHex(group.color) : undefined
})

const onGroupHeaderClick = group => {
  if (group.kind === 'section') return
  clearSelection()
}

const onGroupContext = (event, group) => {
  if (group.kind === 'section') {
    emit('section-menu', event, group)
  } else if (group.kind === 'list' && group.list) {
    emit('list-menu', event, group.list)
  } else if (group.date) {
    emit('date-menu', event, group)
  }
}

const toggleSection = async group => {
  const section = store.sections.find(item => item.id === group.sectionId)
  if (!section) return
  await store.updateSection(section.id, { is_collapsed: !section.is_collapsed })
}

const saveSectionName = async group => {
  const id = sectionRenamingId.value
  if (!id) return
  const name = sectionNameDraft.value.trim()
  sectionRenamingId.value = null
  if (!name) return
  await store.updateSection(id, { name })
}

const cancelSectionName = () => {
  sectionRenamingId.value = null
  sectionNameDraft.value = ''
}

const startRenameSection = group => {
  if (!group.sectionId) return
  const section = store.sections.find(item => item.id === group.sectionId)
  sectionRenamingId.value = group.sectionId
  sectionNameDraft.value = section?.name || group.title
  nextTick(() => {
    const input = Array.isArray(sectionInput.value) ? sectionInput.value[0] : sectionInput.value
    input?.focus()
    input?.select()
  })
}

const addSection = async () => {
  if (view.value.type !== 'list') return
  const section = await store.createSection(view.value.id, { name: '新建分区' })
  if (!section) return
  sectionRenamingId.value = section.id
  sectionNameDraft.value = section.name
  nextTick(() => {
    const input = Array.isArray(sectionInput.value) ? sectionInput.value[0] : sectionInput.value
    input?.focus()
    input?.select()
  })
}

const openAdd = group => {
  activeAddKey.value = group.key
  resetDraft()
  nextTick(() => addInputs.get(group.key)?.focus())
}

const openAddForCurrent = () => {
  const group = store.groups.find(item => item.add)
  if (group) openAdd(group)
}

const openAddForDate = date => {
  const group = store.groups.find(item => item.add && item.add.date === date) || store.groups.find(item => item.add)
  if (!group) return
  openAdd({ ...group, add: { ...group.add, date } })
}

const cancelAdd = () => {
  activeAddKey.value = ''
  resetDraft()
}

const normalizeTags = value => (
  String(value || '')
    .split(/[,，\s]+/)
    .map(tag => tag.replace(/^#/, '').trim())
    .filter(Boolean)
    .join(',')
)

const mergeTags = (...values) => {
  const seen = new Set()
  values.forEach(value => normalizeTags(value).split(',').filter(Boolean).forEach(tag => seen.add(tag)))
  return [...seen].join(',')
}

const commitAdd = async group => {
  const raw = draftTitle.value.trim()
  if (!raw) {
    addInputs.get(group.key)?.focus()
    return null
  }
  const parsed = parseReminderInput(raw, {
    defaultDate: group.add?.date || '',
    listId: group.add?.listId || store.defaultListId
  })
  if (!parsed.title) return null
  const created = await store.createReminder({
    title: parsed.title,
    date: draftDate.value || parsed.date || '',
    due_time: draftDueTime.value || parsed.due_time || '',
    priority: parsed.priority,
    tags: mergeTags(parsed.tags, draftTags.value),
    notes: draftNotes.value.trim(),
    list_id: parsed.list_id || store.defaultListId,
    section_id: group.sectionId || null,
    is_flagged: draftFlagged.value
  })
  if (!created) return null
  const pendingAttachments = [...draftAttachments.value]
  resetDraft()
  for (const file of pendingAttachments) {
    await store.addAttachmentFile(created.id, file)
  }
  if (pendingAttachments.length) await store.fetchAll({ silent: true })
  nextTick(() => addInputs.get(group.key)?.focus())
  return created
}

const onComposerFocusOut = (event, group) => {
  if (event.currentTarget.contains(event.relatedTarget)) return
  if (draftTitle.value.trim()) commitAdd(group)
  else cancelAdd()
}

const detailDraft = async (group, event) => {
  const anchor = event.currentTarget.getBoundingClientRect()
  const created = await commitAdd(group)
  if (!created) return
  emit('open-detail', created, { getBoundingClientRect: () => anchor })
}

const canDrag = group => (
  view.value.type === 'list'
  && group.kind !== 'completed'
  && group.kind !== 'month'
  && group.kind !== 'deleted'
  && !group.collapsed
)

const canReorderGroup = group => (
  canDrag(group)
  && view.value.type === 'list'
  && store.sortMode === 'manual'
)

const onDragStart = () => document.body.classList.add('rm-dragging')
const onDragEnd = () => document.body.classList.remove('rm-dragging')

const onDragChange = async (event, group) => {
  if (!canReorderGroup(group)) return
  if (event.added) {
    const item = event.added.element
    await store.updateReminder(item.id, { section_id: group.sectionId || null })
    await store.reorderReminders(group.items.map(row => row.id), group.sectionId || null)
  } else if (event.moved) {
    await store.reorderReminders(group.items.map(row => row.id), group.sectionId || null)
  }
}

const clearCompletedOlder = async days => {
  clearMenuOpen.value = false
  const listId = view.value.type === 'list' ? view.value.id : null
  const completedBefore = days ? new Date(Date.now() - days * 86400000).toISOString() : null
  const ids = await store.clearCompleted(listId, completedBefore)
  if (ids.length) {
    undoStore.showUndo({
      message: `已清除 ${ids.length} 项完成`,
      undo: () => store.restoreReminders(ids)
    })
  }
}

const showEmptyMessage = computed(() => {
  if (store.searchQuery.trim()) return true
  const total = store.groups.reduce((sum, group) => {
    if (group.kind === 'month') {
      return sum + group.subgroups.reduce((inner, subgroup) => inner + subgroup.items.length, 0)
    }
    return sum + group.items.length
  }, 0)
  if (total > 0) return false
  if (view.value.type === 'recentlyDeleted') return true
  if (view.value.type === 'list') return true
  return ['flagged', 'urgent', 'completed'].includes(view.value.id)
})

const emptyText = computed(() => {
  if (store.searchQuery.trim()) return '没有结果'
  if (view.value.type === 'recentlyDeleted') return '最近删除中没有提醒事项'
  return '没有提醒事项'
})

defineExpose({ addSection, startRenameSection, openAdd, openAddForCurrent, openAddForDate })
</script>

<style scoped>
.rm-content {
  display: flex;
  flex-direction: column;
  flex: 1;
  width: 100%;
  min-width: 0;
  min-height: 0;
  height: 100%;
  background: var(--bm-bg-card);
  color: var(--bm-text-primary);
  font-family: var(--bm-font-ui);
}

.rm-list-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 16px 0;
  flex: 0 0 auto;
}

.rm-list-title {
  margin: 0;
  font-size: 28px;
  line-height: 1.14;
  font-weight: 700;
  letter-spacing: -0.035em;
}

.rm-header-count {
  padding-bottom: 3px;
  font-size: 28px;
  line-height: 1;
  font-weight: 300;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
  opacity: 0.9;
}

.rm-list-subheader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 26px;
  padding: 0 16px;
  flex: 0 0 auto;
}

.rm-completed-line {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--bm-text-muted);
  font-size: 12px;
}

.rm-dot { color: var(--bm-border-strong); }

.rm-clear-button,
.rm-show-completed {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--bm-accent-blue);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.rm-clear-button:hover,
.rm-show-completed:hover { text-decoration: underline; }

.rm-clear-wrap { position: relative; display: inline-flex; }

.rm-clear-backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
}

.rm-clear-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 51;
  display: flex;
  flex-direction: column;
  min-width: 150px;
  padding: 5px;
  border: 1px solid var(--bm-border-default);
  border-radius: var(--bm-radius-md);
  background: var(--bm-bg-card);
  box-shadow: var(--bm-shadow-lg);
}

.rm-clear-menu button {
  padding: 6px 9px;
  border: 0;
  border-radius: var(--bm-radius-sm);
  background: transparent;
  color: var(--bm-text-primary);
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}

.rm-clear-menu button:hover { background: var(--bm-accent-blue); color: #fff; }

.rm-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 8px 16px;
  scrollbar-gutter: stable;
}

.rm-loading {
  padding: 60px 0;
  color: var(--bm-text-muted);
  font-size: 13px;
  text-align: center;
}

.rm-empty {
  display: grid;
  place-items: center;
  min-height: 220px;
  color: var(--bm-text-tertiary);
  font-size: 19px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.rm-group {
  position: relative;
}

.rm-group-header {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 22px;
  padding: 5px 0 3px;
  border-top: 1px solid var(--bm-border-subtle);
  color: var(--bm-text-muted);
  font-size: 11.5px;
  font-weight: 500;
}

.rm-group-header-emphasis {
  padding-top: 8px;
  padding-bottom: 4px;
  color: var(--bm-text-primary);
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.025em;
}

.rm-group-header-list {
  color: inherit;
}

.rm-group-header-section {
  padding-top: 9px;
  padding-bottom: 3px;
  color: var(--bm-text-secondary);
  font-size: 12.5px;
  font-weight: 600;
}

.rm-group-header-time {
  border-top: 1px solid var(--bm-border-subtle);
  padding-top: 6px;
  font-size: 11.5px;
  color: var(--bm-text-muted);
}

.rm-group-header-plain {
  color: inherit;
  font-size: 12.5px;
  font-weight: 600;
}

.rm-group-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rm-section-chevron,
.rm-section-more {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--bm-text-muted);
  cursor: pointer;
}

.rm-section-more {
  margin-left: auto;
  opacity: 0;
}

.rm-group-header-section:hover .rm-section-more { opacity: 1; }
.rm-section-chevron:hover,
.rm-section-more:hover { background: var(--bm-bg-hover); color: var(--bm-text-primary); }

.rm-section-count {
  color: var(--bm-text-tertiary);
  font-size: 11px;
  font-weight: 400;
}

.rm-section-header.editing {
  display: flex;
  align-items: center;
  padding: 8px 0 5px;
  border-top: 1px solid var(--bm-border-subtle);
}

.rm-section-input {
  width: min(260px, 100%);
  height: 24px;
  padding: 0 5px;
  border: 1px solid var(--bm-accent-blue);
  border-radius: var(--bm-radius-sm);
  outline: none;
  color: var(--bm-text-primary);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
}

.rm-group-items {
  display: flex;
  flex-direction: column;
}

.rm-draggable.is-drag-enabled :deep(.rm-row) {
  cursor: grab;
}

.rm-draggable.is-drag-enabled :deep(.rm-row:active) {
  cursor: grabbing;
}

.rm-draggable {
  display: flex;
  flex-direction: column;
}

.rm-row-ghost {
  opacity: 0.3;
  background: var(--bm-bg-active);
  border-radius: 8px;
}

.rm-month-block {
  display: flex;
  flex-direction: column;
}

.rm-day-header {
  padding: 10px 0 4px;
  color: var(--bm-text-muted);
  font-size: 13px;
  font-weight: 500;
}

.rm-inline-add {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 32px;
  padding: 2px 8px 2px 10px;
  border-radius: 8px;
}

.rm-inline-add.is-composing {
  align-items: flex-start;
  padding: 6px 8px 8px 10px;
}

.rm-inline-add.is-composing .rm-add-circle {
  margin-top: 5px;
  border-style: solid;
  border-color: var(--bm-border-strong);
}

.rm-composer {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding-bottom: 2px;
}

.rm-compose-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.rm-compose-title {
  flex: 0 0 auto;
  width: 100%;
  height: 28px;
  padding: 0;
  font-size: 15px;
  font-weight: 500;
}

.rm-compose-note,
.rm-compose-tags {
  width: 100%;
  height: 24px;
  padding: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--bm-text-secondary);
  font: inherit;
  font-size: 13px;
}

.rm-compose-note::placeholder,
.rm-compose-tags::placeholder { color: var(--bm-text-muted); }

.rm-compose-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 7px;
}

.rm-compose-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 11px;
  border: 0;
  border-radius: 14px;
  background: var(--bm-bg-hover);
  color: var(--bm-text-secondary);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
}

.rm-compose-pill:hover { background: var(--bm-bg-active); color: var(--bm-text-primary); }
.rm-compose-pill.active {
  color: var(--bm-accent-blue);
  background: color-mix(in srgb, var(--bm-accent-blue) 10%, transparent);
}

.rm-compose-icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--bm-bg-hover);
  color: var(--bm-text-secondary);
  cursor: pointer;
}

.rm-compose-icon:hover { background: var(--bm-bg-active); color: var(--bm-text-primary); }
.rm-compose-icon.active {
  color: var(--bm-accent-danger);
  background: color-mix(in srgb, var(--bm-accent-danger) 12%, transparent);
}

.rm-compose-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 6px;
}

.rm-compose-attachment {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 6px;
  border-radius: 6px;
  background: var(--bm-bg-hover);
  color: var(--bm-text-secondary);
  font-size: 11.5px;
}

.rm-compose-attachment-name {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rm-compose-attachment button {
  display: grid;
  place-items: center;
  width: 14px;
  height: 14px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--bm-text-muted);
  cursor: pointer;
}

.rm-compose-attachment button:hover { background: var(--bm-bg-active); color: var(--bm-text-primary); }

.rm-tag-picker-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
}

.rm-tag-picker {
  position: fixed;
  z-index: 61;
  width: 224px;
  max-height: 280px;
  overflow-y: auto;
  padding: 6px;
  border: 1px solid var(--bm-border-default);
  border-radius: 10px;
  background: var(--bm-bg-card);
  box-shadow: var(--bm-shadow-lg);
}

.rm-tag-picker input {
  width: 100%;
  height: 28px;
  padding: 0 7px;
  border: 1px solid var(--bm-border-default);
  border-radius: 6px;
  outline: none;
  background: var(--bm-bg-card);
  color: var(--bm-text-primary);
  font: inherit;
  font-size: 12px;
}

.rm-tag-picker input:focus { border-color: var(--bm-accent-blue); }

.rm-tag-picker-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 6px 0;
}

.rm-tag-picker-list button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 5px 7px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--bm-text-primary);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.rm-tag-picker-list button:hover { background: var(--bm-bg-hover); }
.rm-tag-picker-list button.selected { color: var(--bm-accent-blue); }

.rm-tag-picker-empty {
  padding: 6px 7px;
  color: var(--bm-text-muted);
  font-size: 11.5px;
}

.rm-tag-picker-create {
  width: 100%;
  padding: 6px 7px;
  border: 0;
  border-top: 1px solid var(--bm-border-subtle);
  background: transparent;
  color: var(--bm-accent-blue);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.rm-compose-date {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  padding-bottom: 2px;
}

.rm-compose-date input {
  height: 26px;
  padding: 0 6px;
  border: 1px solid var(--bm-border-default);
  border-radius: 6px;
  background: var(--bm-bg-card);
  color: var(--bm-text-primary);
  font: inherit;
  font-size: 12px;
}

.rm-compose-date button {
  border: 0;
  background: transparent;
  color: var(--bm-accent-blue);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.rm-compose-info {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  margin-top: 2px;
  padding: 0;
  border: 1px solid var(--bm-border-strong);
  border-radius: 50%;
  background: transparent;
  color: var(--bm-text-muted);
  cursor: pointer;
  flex: 0 0 auto;
}

.rm-compose-info:hover { color: var(--bm-accent-blue); border-color: var(--bm-accent-blue); }

.rm-add-circle {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 1.4px dashed var(--bm-border-strong);
  border-radius: 50%;
  background: transparent;
  color: var(--bm-text-muted);
  cursor: pointer;
  flex: 0 0 auto;
}

.rm-add-circle:hover { border-color: var(--bm-accent-blue); color: var(--bm-accent-blue); }

.rm-add-placeholder {
  flex: 1;
  min-width: 0;
  padding: 3px 0;
  border: 0;
  background: transparent;
  color: var(--bm-text-muted);
  font: inherit;
  font-size: 14px;
  text-align: left;
  cursor: text;
}

.rm-add-placeholder:hover { color: var(--bm-text-secondary); }

.rm-add-input {
  flex: 1;
  min-width: 0;
  height: 26px;
  padding: 0 3px;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--bm-text-primary);
  font: inherit;
  font-size: 15px;
}

.rm-add-input::placeholder { color: var(--bm-text-muted); }

.rm-list-bottom-space { height: 24px; }

.rm-group-header-time:first-child,
.rm-group-plain:first-child .rm-group-header {
  border-top: 0;
}

</style>
