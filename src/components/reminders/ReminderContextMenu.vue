<template>
  <Teleport to="body">
    <Transition name="rm-menu">
      <div
        v-if="show"
        ref="menuRef"
        class="rm-context-menu"
        :style="{ left: `${position.left}px`, top: `${position.top}px` }"
        role="menu"
        @click.stop
        @contextmenu.prevent
      >
        <template v-if="type === 'reminder'">
          <button type="button" class="rm-menu-item" @click="emitAction('detail')">
            <ReminderIcon name="info" :size="15" />
            <span>详细信息</span>
          </button>
          <button type="button" class="rm-menu-item" @click="emitAction('toggle-complete')">
            <ReminderIcon :name="item?.is_completed ? 'circle-check' : 'check-circle'" :size="15" />
            <span>{{ item?.is_completed ? '标记为未完成' : '标记为完成' }}</span>
          </button>
          <button type="button" class="rm-menu-item" @click="emitAction('toggle-flag')">
            <ReminderIcon name="flag" :size="15" />
            <span>{{ item?.is_flagged ? '移除旗标' : '旗标' }}</span>
          </button>

          <div class="rm-menu-divider"></div>

          <div class="rm-menu-item has-submenu" :class="{ open: activeSub === 'priority' }" @mouseenter="openSubmenu('priority', $event)">
            <ReminderIcon name="exclamation" :size="15" />
            <span>优先级</span>
            <div v-if="activeSub === 'priority'" ref="submenuRef" class="rm-submenu" :style="submenuStyle">
              <button
                v-for="option in PRIORITY_OPTIONS"
                :key="option.value"
                type="button"
                class="rm-menu-item"
                :class="{ checked: item?.priority === option.value }"
                @click="emitAction('priority', { priority: option.value })"
              >
                <span>{{ option.label }}</span>
                <ReminderIcon v-if="item?.priority === option.value" name="check" :size="13" />
              </button>
            </div>
          </div>

          <div class="rm-menu-item has-submenu" :class="{ open: activeSub === 'date' }" @mouseenter="openSubmenu('date', $event)">
            <ReminderIcon name="calendar" :size="15" />
            <span>日期</span>
            <div v-if="activeSub === 'date'" ref="submenuRef" class="rm-submenu" :style="submenuStyle">
              <button type="button" class="rm-menu-item" @click="emitAction('date-today')">今天</button>
              <button type="button" class="rm-menu-item" @click="emitAction('date-tomorrow')">明天</button>
              <button type="button" class="rm-menu-item" @click="emitAction('date-weekend')">本周末</button>
              <div class="rm-menu-divider"></div>
              <button type="button" class="rm-menu-item" @click="emitAction('detail')">日期与时间…</button>
              <button v-if="item?.date" type="button" class="rm-menu-item" @click="emitAction('date-clear')">移除日期</button>
            </div>
          </div>

          <div class="rm-menu-item has-submenu" :class="{ open: activeSub === 'remind' }" @mouseenter="openSubmenu('remind', $event)">
            <ReminderIcon name="clock" :size="15" />
            <span>提醒我</span>
            <div v-if="activeSub === 'remind'" ref="submenuRef" class="rm-submenu" :style="submenuStyle">
              <button type="button" class="rm-menu-item" @click="emitAction('remind-later')">1 小时后</button>
              <button type="button" class="rm-menu-item" @click="emitAction('remind-tomorrow')">明天 09:00</button>
              <button type="button" class="rm-menu-item" @click="emitAction('detail')">自定义…</button>
              <button v-if="item?.remind_time" type="button" class="rm-menu-item" @click="emitAction('remind-clear')">清除提醒时间</button>
            </div>
          </div>

          <div class="rm-menu-item has-submenu" :class="{ open: activeSub === 'list' }" @mouseenter="openSubmenu('list', $event)">
            <ReminderIcon name="list" :size="15" />
            <span>移动到列表</span>
            <div v-if="activeSub === 'list'" ref="submenuRef" class="rm-submenu" :style="submenuStyle">
              <button
                v-for="list in lists"
                :key="list.id"
                type="button"
                class="rm-menu-item"
                :class="{ checked: item?.list_id === list.id }"
                @click="emitAction('move', { listId: list.id })"
              >
                <span class="rm-menu-dot" :style="{ background: colorHex(list.color) }"></span>
                <span>{{ list.name }}</span>
                <ReminderIcon v-if="item?.list_id === list.id" name="check" :size="13" />
              </button>
            </div>
          </div>

          <div v-if="itemSections.length" class="rm-menu-item has-submenu" :class="{ open: activeSub === 'section' }" @mouseenter="openSubmenu('section', $event)">
            <ReminderIcon name="list" :size="15" />
            <span>移动到分区</span>
            <div v-if="activeSub === 'section'" ref="submenuRef" class="rm-submenu" :style="submenuStyle">
              <button
                type="button"
                class="rm-menu-item"
                :class="{ checked: !item?.section_id }"
                @click="emitAction('move-section', { sectionId: null })"
              >
                <span>无分区</span>
                <ReminderIcon v-if="!item?.section_id" name="check" :size="13" />
              </button>
              <button
                v-for="section in itemSections"
                :key="section.id"
                type="button"
                class="rm-menu-item"
                :class="{ checked: item?.section_id === section.id }"
                @click="emitAction('move-section', { sectionId: section.id })"
              >
                <span>{{ section.name }}</span>
                <ReminderIcon v-if="item?.section_id === section.id" name="check" :size="13" />
              </button>
            </div>
          </div>

          <div class="rm-menu-divider"></div>

          <button type="button" class="rm-menu-item" @click="emitAction('add-subtask')">
            <ReminderIcon name="plus" :size="15" />
            <span>添加子任务</span>
          </button>
          <button type="button" class="rm-menu-item" @click="emitAction('add-attachment')">
            <ReminderIcon name="paperclip" :size="15" />
            <span>添加附件</span>
          </button>

          <template v-if="canReorder">
            <div class="rm-menu-divider"></div>
            <button type="button" class="rm-menu-item" @click="emitAction('move-up')">
              <span>上移</span>
            </button>
            <button type="button" class="rm-menu-item" @click="emitAction('move-down')">
              <span>下移</span>
            </button>
            <button type="button" class="rm-menu-item" @click="emitAction('move-top')">
              <span>移到顶部</span>
            </button>
            <button type="button" class="rm-menu-item" @click="emitAction('move-bottom')">
              <span>移到底部</span>
            </button>
          </template>

          <div class="rm-menu-divider"></div>

          <button type="button" class="rm-menu-item" @click="emitAction('duplicate')">
            <ReminderIcon name="list-plus" :size="15" />
            <span>复制</span>
          </button>
          <button type="button" class="rm-menu-item danger" @click="emitAction('delete')">
            <ReminderIcon name="trash" :size="15" />
            <span>删除</span>
          </button>
        </template>

        <template v-else-if="type === 'list'">
          <button type="button" class="rm-menu-item" @click="emitAction('edit-list')">
            <ReminderIcon name="list" :size="15" />
            <span>自定义简介和外观</span>
          </button>
          <button type="button" class="rm-menu-item" @click="emitAction('add-section')">
            <ReminderIcon name="plus" :size="15" />
            <span>新建分区</span>
          </button>
          <button type="button" class="rm-menu-item" @click="emitAction('toggle-pin')">
            <ReminderIcon name="pin" :size="15" />
            <span>{{ item?.is_pinned ? '取消置顶列表' : '置顶列表' }}</span>
          </button>
          <div class="rm-menu-divider"></div>
          <button type="button" class="rm-menu-item danger" @click="emitAction('delete-list')">
            <ReminderIcon name="trash" :size="15" />
            <span>删除列表</span>
          </button>
        </template>

        <template v-else-if="type === 'section'">
          <button type="button" class="rm-menu-item" @click="emitAction('rename-section')">
            <ReminderIcon name="note" :size="15" />
            <span>重命名分区</span>
          </button>
          <button type="button" class="rm-menu-item danger" @click="emitAction('delete-section')">
            <ReminderIcon name="trash" :size="15" />
            <span>删除分区</span>
          </button>
        </template>

        <template v-else-if="type === 'deleted'">
          <button type="button" class="rm-menu-item" @click="emitAction('restore-deleted')">
            <ReminderIcon name="repeat" :size="15" />
            <span>恢复提醒事项</span>
          </button>
          <div class="rm-menu-divider"></div>
          <button type="button" class="rm-menu-item danger" @click="emitAction('purge-deleted')">
            <ReminderIcon name="trash" :size="15" />
            <span>永久删除</span>
          </button>
        </template>

        <template v-else-if="type === 'date'">
          <button type="button" class="rm-menu-item" @click="emitAction('add-date')">
            <ReminderIcon name="plus" :size="15" />
            <span>新建提醒事项</span>
          </button>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import ReminderIcon from './ReminderIcon.vue'
import { PRIORITY_OPTIONS, colorHex } from '@utils/reminders'

const props = defineProps({
  show: { type: Boolean, default: false },
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 },
  type: { type: String, default: 'reminder' },
  item: { type: Object, default: null },
  lists: { type: Array, default: () => [] },
  sections: { type: Array, default: () => [] },
  canReorder: { type: Boolean, default: false }
})

const emit = defineEmits(['close', 'action'])
const activeSub = ref('')
const menuRef = ref(null)
const measured = ref({ width: 0, height: 0 })
const submenuRef = ref(null)
const submenuStyle = ref({ left: '-9999px', top: '-9999px' })

const openSubmenu = async (name, event) => {
  activeSub.value = name
  submenuStyle.value = { left: '-9999px', top: '-9999px' }
  const anchor = event.currentTarget.getBoundingClientRect()
  const margin = 8
  const width = 196
  let left = anchor.right + 4
  if (left + width > window.innerWidth - margin) left = Math.max(margin, anchor.left - width - 4)
  let top = anchor.top - 5
  await nextTick()
  const height = submenuRef.value?.offsetHeight || 0
  if (height && top + height > window.innerHeight - margin) {
    top = Math.max(margin, window.innerHeight - height - margin)
  }
  submenuStyle.value = { left: `${left}px`, top: `${top}px` }
}

const position = computed(() => {
  const margin = 8
  const width = measured.value.width || 224
  const height = measured.value.height
  const left = Math.max(margin, Math.min(props.x, window.innerWidth - width - margin))
  const top = height
    ? Math.max(margin, Math.min(props.y, window.innerHeight - height - margin))
    : props.y
  return { left, top }
})

const itemSections = computed(() => {
  if (!props.item?.list_id) return []
  return props.sections.filter(section => section.list_id === props.item.list_id)
})

const emitAction = (action, payload = {}) => {
  emit('action', { type: props.type, action, item: props.item, ...payload })
  emit('close')
}

const closeOnOutside = event => {
  if (event.target.closest('.rm-context-menu')) return
  emit('close')
}

const closeOnEscape = event => {
  if (event.key !== 'Escape') return
  event.preventDefault()
  emit('close')
}

watch(() => props.show, async visible => {
  if (visible) {
    activeSub.value = ''
    measured.value = { width: 0, height: 0 }
    await nextTick()
    if (menuRef.value) {
      measured.value = { width: menuRef.value.offsetWidth, height: menuRef.value.offsetHeight }
    }
    document.addEventListener('click', closeOnOutside, true)
    document.addEventListener('keydown', closeOnEscape)
  } else {
    document.removeEventListener('click', closeOnOutside, true)
    document.removeEventListener('keydown', closeOnEscape)
  }
}, { immediate: true })

onUnmounted(() => {
  document.removeEventListener('click', closeOnOutside, true)
  document.removeEventListener('keydown', closeOnEscape)
})
</script>

<style scoped>
.rm-context-menu {
  position: fixed;
  z-index: 1300;
  width: 224px;
  max-height: calc(100vh - 16px);
  overflow-y: auto;
  padding: 5px;
  border: 1px solid var(--bm-border-default);
  border-radius: var(--bm-radius-md);
  background: var(--bm-bg-card);
  color: var(--bm-text-primary);
  box-shadow: var(--bm-shadow-lg);
  font-family: var(--bm-font-family);
}

.rm-menu-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 26px;
  padding: 4px 8px;
  border: 0;
  border-radius: var(--bm-radius-sm);
  background: transparent;
  color: var(--bm-text-primary);
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
}

.rm-menu-item:hover,
.rm-menu-item.open { background: var(--bm-accent-blue); color: #fff; }
.rm-menu-item.danger { color: var(--bm-accent-danger); }
.rm-menu-item.danger:hover { background: var(--bm-accent-danger); color: #fff; }
.rm-menu-item.checked { font-weight: 600; }

.rm-menu-item > span:nth-child(2) { flex: 1; min-width: 0; }

.rm-menu-item.has-submenu::after {
  content: '›';
  margin-left: auto;
  color: var(--bm-text-muted);
  font-size: 14px;
  line-height: 1;
}

.rm-menu-item.has-submenu:hover::after,
.rm-menu-item.has-submenu.open::after { color: #fff; }

.rm-menu-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex: 0 0 auto;
}

.rm-menu-divider {
  height: 1px;
  margin: 4px 6px;
  background: var(--bm-border-subtle);
}

.rm-submenu {
  position: fixed;
  width: 196px;
  max-height: calc(100vh - 16px);
  overflow-y: auto;
  padding: 5px;
  border: 1px solid var(--bm-border-default);
  border-radius: var(--bm-radius-md);
  background: var(--bm-bg-card);
  box-shadow: var(--bm-shadow-lg);
  z-index: 1301;
}

.rm-submenu .rm-menu-item { color: var(--bm-text-primary); }
.rm-submenu .rm-menu-item:hover { background: var(--bm-accent-blue); color: #fff; }

.rm-menu-enter-active,
.rm-menu-leave-active { transition: opacity 100ms ease, transform 100ms ease; }
.rm-menu-enter-from,
.rm-menu-leave-to { opacity: 0; transform: scale(0.97); }
</style>
