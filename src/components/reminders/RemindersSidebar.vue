<template>
  <aside class="rm-sidebar" aria-label="提醒事项边栏">
    <div class="rm-smart-grid">
      <button
        v-for="item in SMART_LISTS"
        :key="item.id"
        type="button"
        class="rm-smart-tile"
        :class="{ selected: isSmartSelected(item.id) }"
        :style="{ background: item.color }"
        @click="$emit('select', { type: 'smart', id: item.id })"
      >
        <span class="rm-tile-icon"><ReminderIcon :name="item.icon" :size="16" :stroke-width="1.9" /></span>
        <span v-if="item.id !== 'completed'" class="rm-tile-count">{{ counts[item.id] ?? 0 }}</span>
        <span class="rm-tile-name">{{ item.name }}</span>
      </button>
    </div>

    <div class="rm-side-heading">我的列表</div>

    <draggable
      v-model="draftLists"
      item-key="id"
      tag="div"
      class="rm-lists"
      :animation="180"
      ghost-class="rm-list-ghost"
      :group="{ name: 'rm-lists', pull: true, put: ['rm-lists', 'rm-reminders'] }"
      @start="onListDragStart"
      @end="onListDragEnd"
      @change="event => event.added && onListAdd(event)"
    >
      <template #item="{ element: list }">
        <div
          class="rm-list-row"
          :data-list-id="list.id"
          :class="{ selected: isListSelected(list.id) }"
          role="button"
          tabindex="0"
          :title="`拖动提醒事项到「${list.name}」可移动到该列表`"
          @click="$emit('select', { type: 'list', id: list.id })"
          @keydown.enter.prevent="$emit('select', { type: 'list', id: list.id })"
          @contextmenu.prevent="$emit('list-menu', $event, list)"
        >
          <span class="rm-list-badge" :style="{ background: colorHex(list.color) }">
            <span v-if="list.icon_type === 'emoji'" class="rm-list-emoji">{{ list.icon }}</span>
            <i v-else-if="isFaIcon(list.icon)" :class="list.icon" class="rm-list-fa"></i>
            <ReminderIcon v-else :name="list.icon || 'list'" :size="15" :stroke-width="2" />
          </span>
          <span class="rm-list-name" :title="list.name">{{ list.name }}</span>
          <span v-if="list.is_pinned" class="rm-list-pin" title="置顶列表">
            <ReminderIcon name="pin" :size="12" />
          </span>
          <span v-if="isListSelected(list.id)" class="rm-list-caret" aria-hidden="true">▶</span>
          <span class="rm-list-count">{{ listCounts[list.id] ?? 0 }}</span>
          <button
            type="button"
            class="rm-list-more"
            :aria-label="`${list.name} 的操作`"
            @click.stop="$emit('list-menu', $event, list)"
          >
            <ReminderIcon name="ellipsis" :size="15" />
          </button>
        </div>
      </template>
    </draggable>

    <button v-if="!lists.length" type="button" class="rm-add-first-list" @click="$emit('add-list')">
      <ReminderIcon name="plus" :size="14" />
      添加列表
    </button>

    <div class="rm-side-spacer"></div>

    <div v-if="tags.length" class="rm-tags">
      <div class="rm-side-heading">标签</div>
      <div class="rm-tag-chips">
        <button
          type="button"
          class="rm-tag-chip"
          :class="{ selected: !selectedTag }"
          @click="$emit('select-tag', '')"
        >
          所有标签
        </button>
        <button
          v-for="tag in tags"
          :key="tag.name"
          type="button"
          class="rm-tag-chip"
          :class="{ selected: selectedTag === tag.name }"
          @click="$emit('select-tag', tag.name)"
        >
          #{{ tag.name }}
        </button>
      </div>
    </div>

    <div class="rm-side-divider"></div>

    <button
      type="button"
      class="rm-recent-row"
      :class="{ selected: selectedView.type === 'recentlyDeleted' }"
      @click="$emit('select', { type: 'recentlyDeleted', id: 'recentlyDeleted' })"
    >
      <span class="rm-recent-icon"><ReminderIcon name="trash" :size="15" /></span>
      <span class="rm-recent-name">最近删除</span>
      <span class="rm-list-count">{{ recentlyDeletedCount }}</span>
    </button>
  </aside>
</template>

<script setup>
import { nextTick, ref, watch } from 'vue'
import draggable from 'vuedraggable'
import ReminderIcon from './ReminderIcon.vue'
import { SMART_LISTS, colorHex } from '@utils/reminders'

const props = defineProps({
  lists: { type: Array, default: () => [] },
  counts: { type: Object, default: () => ({}) },
  listCounts: { type: Object, default: () => ({}) },
  selectedView: { type: Object, required: true },
  recentlyDeletedCount: { type: Number, default: 0 },
  tags: { type: Array, default: () => [] },
  selectedTag: { type: String, default: '' }
})

const emit = defineEmits(['select', 'add-list', 'list-menu', 'reorder-lists', 'move-reminder', 'select-tag'])

const isFaIcon = icon => /^fa-[a-z]+ fa-/.test(icon || '')

const draftLists = ref([...props.lists])
watch(() => props.lists, value => {
  if (document.body.classList.contains('rm-dragging')) return
  draftLists.value = [...value]
}, { deep: true, immediate: true })

const onListAdd = event => {
  const reminder = event.added?.element
  if (!reminder || !('list_id' in reminder)) return
  let targetId = null
  const pointerY = event.originalEvent?.clientY
  if (event.to && Number.isFinite(pointerY)) {
    let nearest = Infinity
    event.to.querySelectorAll('[data-list-id]').forEach(row => {
      const rect = row.getBoundingClientRect()
      const distance = Math.abs(rect.top + rect.height / 2 - pointerY)
      if (distance < nearest) {
        nearest = distance
        targetId = Number(row.dataset.listId)
      }
    })
  }
  if (!targetId) {
    const items = draftLists.value
    const index = event.added.newIndex
    const adjacent = items[index] === reminder ? (index > 0 ? index - 1 : index + 1) : index
    targetId = items[adjacent]?.id || null
  }
  if (targetId) emit('move-reminder', { reminderId: reminder.id, listId: targetId })
  nextTick(() => { draftLists.value = [...props.lists] })
}

const isSmartSelected = id => props.selectedView.type === 'smart' && props.selectedView.id === id
const isListSelected = id => props.selectedView.type === 'list' && props.selectedView.id === id

const onListDragStart = () => document.body.classList.add('rm-dragging')
const onListDragEnd = () => {
  document.body.classList.remove('rm-dragging')
  onDragEnd()
}

const onDragEnd = () => {
  const known = new Set(props.lists.map(list => list.id))
  const ordered = draftLists.value.map(list => list.id).filter(id => known.has(id))
  if (ordered.join(',') !== props.lists.map(list => list.id).join(',')) {
    emit('reorder-lists', ordered)
  }
}
</script>

<style scoped>
.rm-sidebar {
  display: flex;
  flex-direction: column;
  min-width: 0;
  height: 100%;
  padding: 10px 12px 12px;
  background: var(--bm-bg-sidebar);
  border-right: 1px solid var(--bm-border-subtle);
  overflow-y: auto;
  font-family: var(--bm-font-ui);
}

.rm-smart-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 7px;
}

.rm-smart-tile {
  position: relative;
  height: 50px;
  padding: 7px 9px;
  border: 0;
  border-radius: 9px;
  color: #fff;
  text-align: left;
  cursor: pointer;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.22), inset 0 0 0 1px rgb(255 255 255 / 0.12);
  transition: transform 120ms ease, box-shadow 120ms ease, filter 120ms ease;
}

.rm-smart-tile:hover { filter: brightness(1.03); }
.rm-smart-tile:active { transform: scale(0.985); }
.rm-smart-tile.selected {
  box-shadow: 0 0 0 2px var(--bm-accent-blue), inset 0 0 0 1px rgb(255 255 255 / 0.28);
}

.rm-tile-icon {
  position: absolute;
  top: 6px;
  left: 9px;
  opacity: 0.96;
}

.rm-tile-count {
  position: absolute;
  top: 5px;
  right: 9px;
  font-size: 12.5px;
  font-weight: 700;
  letter-spacing: -0.02em;
  opacity: 0.96;
}

.rm-tile-name {
  position: absolute;
  bottom: 5px;
  left: 9px;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.rm-side-heading {
  margin: 12px 8px 4px;
  color: var(--bm-text-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.rm-lists {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.rm-list-drop {
  min-width: 0;
}

.rm-list-drop-hidden {
  display: none;
}

.rm-list-drop-ghost {
  opacity: 0.4;
}

:global(body.rm-dragging),
:global(body.rm-dragging *) {
  cursor: grabbing !important;
}

.rm-list-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 30px;
  padding: 3px 8px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--bm-text-primary);
  text-align: left;
  cursor: grab;
  outline: none;
}

.rm-list-row:active { cursor: grabbing; }

.rm-list-row:hover { background: var(--bm-bg-hover); }
.rm-list-row.selected { background: var(--bm-bg-active); }
.rm-list-row:focus-visible { box-shadow: 0 0 0 2px var(--bm-accent-blue); }

.rm-list-ghost { opacity: 0.35; }

.rm-list-badge {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  color: #fff;
  flex: 0 0 auto;
}

.rm-list-emoji {
  font-size: 12px;
  line-height: 1;
}

.rm-list-fa {
  font-size: 12px;
  line-height: 1;
  color: #fff;
}

.rm-list-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13.5px;
  letter-spacing: -0.01em;
}

.rm-list-pin {
  color: var(--bm-text-muted);
  flex: 0 0 auto;
}

.rm-list-caret {
  color: var(--bm-accent-blue);
  font-size: 8px;
  line-height: 1;
  flex: 0 0 auto;
}

.rm-list-count {
  min-width: 14px;
  color: var(--bm-text-muted);
  font-size: 12px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  flex: 0 0 auto;
}

.rm-list-more {
  position: absolute;
  right: 6px;
  display: none;
  place-items: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: var(--bm-bg-card);
  color: var(--bm-text-secondary);
  cursor: pointer;
}

.rm-list-more:hover { background: var(--bm-bg-card); color: var(--bm-text-primary); }
.rm-list-row:hover .rm-list-more { display: grid; }
.rm-list-row:hover .rm-list-count { visibility: hidden; }

.rm-add-first-list {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  margin: 6px 4px;
  padding: 6px 8px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--bm-accent-blue);
  font-size: 13px;
  cursor: pointer;
}

.rm-add-first-list:hover { background: var(--bm-bg-hover); }

.rm-side-spacer {
  flex: 1 1 auto;
  min-height: 12px;
}

.rm-tags {
  flex: 0 0 auto;
  padding: 0 2px;
}

.rm-tag-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 6px 4px;
}

.rm-tag-chip {
  height: 26px;
  padding: 0 11px;
  border: 0;
  border-radius: 13px;
  background: var(--bm-bg-hover);
  color: var(--bm-text-secondary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}

.rm-tag-chip:hover { background: var(--bm-bg-active); color: var(--bm-text-primary); }
.rm-tag-chip.selected { background: var(--bm-accent-blue); color: #fff; }

.rm-side-divider {
  height: 1px;
  margin: 10px 6px 8px;
  background: var(--bm-border-default);
}

.rm-recent-row {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 35px;
  padding: 4px 8px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--bm-text-primary);
  cursor: pointer;
  text-align: left;
}

.rm-recent-row:hover { background: var(--bm-bg-hover); }
.rm-recent-row.selected { background: var(--bm-bg-active); }

.rm-recent-icon {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  color: var(--bm-text-muted);
}

.rm-recent-name {
  flex: 1;
  font-size: 13.5px;
}
</style>
