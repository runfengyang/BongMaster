<template>
  <Teleport to="body">
    <Transition name="cp-menu">
      <div
        v-if="show"
        ref="menu"
        class="cp-context-menu"
        role="menu"
        :style="{ left: `${left}px`, top: `${top}px` }"
        @mousedown.stop
        @click.stop
      >
        <template v-if="!item">
          <button type="button" role="menuitem" @click="$emit('new-event')">新建日程</button>
          <button type="button" role="menuitem" @click="$emit('new-reminder')">新建提醒事项</button>
          <button type="button" role="menuitem" :disabled="!hasClipboard" @click="$emit('paste')">粘贴日程</button>
        </template>
        <template v-else-if="isTask">
          <button type="button" role="menuitem" @click="$emit('edit')">编辑任务</button>
        </template>
        <template v-else-if="isReminder">
          <button type="button" role="menuitem" @click="$emit('open-reminder')">在提醒事项中打开</button>
          <button type="button" role="menuitem" @click="$emit('toggle-reminder-done')">
            {{ item.reminder?.is_completed ? '标记为未完成' : '标记为已完成' }}
          </button>
          <div class="cp-menu-divider"></div>
          <button type="button" role="menuitem" class="danger" @click="$emit('delete-reminder')">删除提醒事项</button>
        </template>
        <template v-else>
          <button type="button" role="menuitem" @click="$emit('edit')">显示简介</button>
          <div class="cp-menu-submenu" @mouseleave="submenu = ''">
            <button type="button" class="cp-submenu-trigger" role="menuitem" aria-haspopup="menu" :disabled="!calendars.length" @mouseenter="submenu = 'calendar'" @click="submenu = submenu === 'calendar' ? '' : 'calendar'">
              日历 <span class="cp-chevron" aria-hidden="true">›</span>
            </button>
            <div v-if="submenu === 'calendar'" class="cp-submenu" :class="{ 'is-flipped': flipSubmenu }" role="menu">
              <button v-for="calendar in calendars" :key="calendar.id" type="button" role="menuitem" @click="$emit('change-calendar', calendar.id)">
                <span class="cp-submenu-dot" :style="{ background: calendar.color }"></span>{{ calendar.name }}
              </button>
            </div>
          </div>
          <div class="cp-menu-divider"></div>
          <button v-if="item.kind === 'reminder'" type="button" role="menuitem" @click="$emit('toggle-reminder')">{{ item.reminder_done ? '标记为未完成' : '标记为已完成' }}</button>
          <button v-if="item.recurrence_type !== 'none'" type="button" role="menuitem" class="danger" @click="$emit('delete-occurrence')">删除此次日程</button>
          <button type="button" role="menuitem" class="danger" @click="$emit('delete-event')">删除</button>
          <button type="button" role="menuitem" @click="$emit('cut')">剪切</button>
          <button type="button" role="menuitem" @click="$emit('copy')">拷贝</button>
          <button type="button" role="menuitem" :disabled="!hasClipboard" @click="$emit('paste')">粘贴</button>
          <button type="button" role="menuitem" @click="$emit('duplicate')">复制</button>
          <div class="cp-menu-divider"></div>
          <button type="button" role="menuitem" @click="$emit('share')">{{ selectionCount > 1 ? `分享所选 ${selectionCount} 个日程…` : '分享…' }}</button>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps({
  show: { type: Boolean, default: false },
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 },
  item: { type: Object, default: null },
  calendars: { type: Array, default: () => [] },
  hasClipboard: { type: Boolean, default: false },
  selectionCount: { type: Number, default: 1 }
})
const emit = defineEmits(['close', 'new-event', 'new-reminder', 'paste', 'edit', 'share', 'copy', 'cut', 'duplicate', 'change-calendar', 'toggle-reminder', 'delete-event', 'delete-occurrence', 'open-reminder', 'toggle-reminder-done', 'delete-reminder'])
const menu = ref(null)
const submenu = ref('')
const isTask = computed(() => props.item?.sourceType === 'task')
const isReminder = computed(() => props.item?.sourceType === 'reminder')
const left = computed(() => Math.max(8, Math.min(props.x, window.innerWidth - 200)))
const menuHeight = computed(() => {
  if (!props.item) return 100
  if (props.item.sourceType === 'task') return 40
  if (props.item.sourceType === 'reminder') return 100
  return 310
})
const top = computed(() => Math.max(8, Math.min(props.y, window.innerHeight - menuHeight.value)))
const flipSubmenu = computed(() => props.x > window.innerWidth - 430)

const onDocumentMouseDown = event => {
  if (props.show && menu.value && !menu.value.contains(event.target)) emit('close')
}
const onKeydown = event => {
  if (props.show && event.key === 'Escape') emit('close')
}
watch(() => props.show, visible => {
  if (visible) {
    submenu.value = ''
    document.addEventListener('mousedown', onDocumentMouseDown, true)
    document.addEventListener('keydown', onKeydown)
  } else {
    document.removeEventListener('mousedown', onDocumentMouseDown, true)
    document.removeEventListener('keydown', onKeydown)
  }
})
onMounted(() => {
  if (props.show) {
    document.addEventListener('mousedown', onDocumentMouseDown, true)
    document.addEventListener('keydown', onKeydown)
  }
})
onUnmounted(() => {
  document.removeEventListener('mousedown', onDocumentMouseDown, true)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<style scoped>
.cp-context-menu { position: fixed; z-index: 1200; width: max-content; min-width: 0; max-width: min(280px, calc(100vw - 16px)); display: flex; flex-direction: column; padding: 4px; border: 1px solid rgb(0 0 0 / 0.12); border-radius: 8px; background: rgb(255 255 255 / 0.96); box-shadow: 0 12px 34px rgb(0 0 0 / 0.18), 0 2px 8px rgb(0 0 0 / 0.08); backdrop-filter: blur(18px); font-family: var(--bm-font-ui); transform-origin: top left; }
.cp-menu-enter-active, .cp-menu-leave-active { transition: opacity 120ms ease, transform 120ms ease; }
.cp-menu-enter-from, .cp-menu-leave-to { opacity: 0; transform: scale(0.96) translateY(-3px); }
.cp-context-menu button { width: 100%; min-height: 28px; padding: 0 9px; border: 0; border-radius: 5px; background: transparent; color: #1d1d1f; font-size: 13px; font-weight: 400; text-align: left; white-space: nowrap; cursor: pointer; }
.cp-context-menu button:hover:not(:disabled) { background: #007aff; color: #fff; }
.cp-context-menu button:disabled { color: #b0b0b5; opacity: 1; cursor: default; }
.cp-context-menu button.danger { color: #ff3b30; }
.cp-context-menu button.danger:hover:not(:disabled) { background: #ff3b30; color: #fff; }
.cp-menu-divider { height: 1px; margin: 3px 5px; background: #e5e5ea; }
.cp-menu-submenu { position: relative; }
.cp-submenu-trigger { display: flex; align-items: center; justify-content: space-between; }
.cp-chevron { margin-left: 14px; color: #8e8e93; font-size: 15px; line-height: 1; }
.cp-submenu-trigger:hover .cp-chevron { color: #fff; }
.cp-submenu { position: absolute; left: calc(100% + 4px); top: -4px; z-index: 1210; width: max-content; min-width: 0; max-width: 220px; padding: 4px; border: 1px solid rgb(0 0 0 / 0.12); border-radius: 8px; background: rgb(255 255 255 / 0.97); box-shadow: 0 12px 34px rgb(0 0 0 / 0.18), 0 2px 8px rgb(0 0 0 / 0.08); backdrop-filter: blur(18px); }
.cp-submenu.is-flipped { left: auto; right: calc(100% + 4px); }
.cp-submenu button { display: flex; align-items: center; gap: 7px; }
.cp-submenu-dot { width: 8px; height: 8px; flex: 0 0 8px; border-radius: 50%; }
</style>
