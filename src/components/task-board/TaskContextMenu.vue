<template>
  <div
    ref="menuRef"
    class="tb-context"
    :style="{ left: `${left}px`, top: `${top}px`, visibility: ready ? 'visible' : 'hidden' }"
    role="menu"
    @click.stop
    @contextmenu.prevent
  >
    <button type="button" class="tb-context-item" @click="run('detail')">
      <i class="fas fa-info-circle" aria-hidden="true"></i>
      <span>打开详情</span>
    </button>

    <button type="button" class="tb-context-item" @click="run('toggle-complete')">
      <i class="fas fa-check-circle" aria-hidden="true"></i>
      <span>{{ task?.status === '已完成' ? '标记为未完成' : '标记为完成' }}</span>
    </button>

    <div class="tb-context-divider"></div>

    <div
      class="tb-context-item has-submenu"
      :class="{ open: activeSub === 'priority' }"
      @mouseenter="openSub('priority', $event)"
    >
      <i class="fas fa-exclamation" aria-hidden="true"></i>
      <span>优先级</span>
      <div v-if="activeSub === 'priority'" class="tb-context-sub" :style="subStyle">
        <button
          v-for="option in PRIORITIES"
          :key="option"
          type="button"
          class="tb-context-item"
          :class="{ checked: task?.priority === option }"
          @click="run('priority', { priority: option })"
        >
          <span>{{ option }}</span>
          <i v-if="task?.priority === option" class="fas fa-check" aria-hidden="true"></i>
        </button>
      </div>
    </div>

    <div
      class="tb-context-item has-submenu"
      :class="{ open: activeSub === 'move' }"
      @mouseenter="openSub('move', $event)"
    >
      <i class="fas fa-exchange-alt" aria-hidden="true"></i>
      <span>移动到</span>
      <div v-if="activeSub === 'move'" class="tb-context-sub" :style="subStyle">
        <button
          v-for="option in STATUSES"
          :key="option"
          type="button"
          class="tb-context-item"
          :class="{ checked: task?.status === option }"
          @click="run('move', { status: option })"
        >
          <span>{{ option }}</span>
          <i v-if="task?.status === option" class="fas fa-check" aria-hidden="true"></i>
        </button>
      </div>
    </div>

    <div
      class="tb-context-item has-submenu"
      :class="{ open: activeSub === 'due' }"
      @mouseenter="openSub('due', $event)"
    >
      <i class="fas fa-calendar-alt" aria-hidden="true"></i>
      <span>截止日期</span>
      <div v-if="activeSub === 'due'" class="tb-context-sub" :style="subStyle">
        <button type="button" class="tb-context-item" @click="run('due-today')">今天</button>
        <button type="button" class="tb-context-item" @click="run('due-tomorrow')">明天</button>
        <button type="button" class="tb-context-item" @click="run('due-weekend')">本周末</button>
        <div class="tb-context-divider"></div>
        <button v-if="task?.due_date" type="button" class="tb-context-item" @click="run('due-clear')">清除日期</button>
      </div>
    </div>

    <div class="tb-context-divider"></div>

    <button type="button" class="tb-context-item" @click="run('duplicate')">
      <i class="fas fa-copy" aria-hidden="true"></i>
      <span>复制任务</span>
    </button>

    <button type="button" class="tb-context-item danger" @click="run('delete')">
      <i class="fas fa-trash-alt" aria-hidden="true"></i>
      <span>删除</span>
    </button>
  </div>
</template>

<script setup>
import { nextTick, onMounted, onUnmounted, ref } from 'vue'

const PRIORITIES = ['高', '中', '低']
const STATUSES = ['待办', '进行中', '已完成']

const props = defineProps({
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 },
  task: { type: Object, default: null }
})

const emit = defineEmits(['close', 'action'])

const menuRef = ref(null)
const ready = ref(false)
const left = ref(0)
const top = ref(0)
const activeSub = ref('')
const subStyle = ref({ left: '-9999px', top: '-9999px' })

const place = async () => {
  await nextTick()
  const el = menuRef.value
  if (!el) return
  const margin = 8
  const width = el.offsetWidth
  const height = el.offsetHeight
  left.value = Math.max(margin, Math.min(props.x, window.innerWidth - width - margin))
  top.value = Math.max(margin, Math.min(props.y, window.innerHeight - height - margin))
  ready.value = true
}

const openSub = async (name, event) => {
  activeSub.value = name
  subStyle.value = { left: '-9999px', top: '-9999px' }
  const item = event.currentTarget
  const anchor = item.getBoundingClientRect()
  await nextTick()
  const sub = item.querySelector('.tb-context-sub')
  const width = sub?.offsetWidth || 190
  const height = sub?.offsetHeight || 0
  const margin = 8
  let subLeft = anchor.right + 4
  if (subLeft + width > window.innerWidth - margin) {
    subLeft = Math.max(margin, anchor.left - width - 4)
  }
  let subTop = anchor.top - 5
  if (height && subTop + height > window.innerHeight - margin) {
    subTop = Math.max(margin, window.innerHeight - height - margin)
  }
  subStyle.value = { left: `${subLeft}px`, top: `${subTop}px` }
}

const closeOnOutside = event => {
  if (menuRef.value?.contains(event.target)) return
  emit('close')
}

const closeOnEscape = event => {
  if (event.key !== 'Escape') return
  event.preventDefault()
  emit('close')
}

const run = (action, payload = {}) => {
  emit('action', { action, task: props.task, ...payload })
  emit('close')
}

onMounted(() => {
  place()
  document.addEventListener('click', closeOnOutside, true)
  document.addEventListener('keydown', closeOnEscape)
})

onUnmounted(() => {
  document.removeEventListener('click', closeOnOutside, true)
  document.removeEventListener('keydown', closeOnEscape)
})
</script>

<style scoped>
.tb-context {
  position: fixed;
  z-index: 1500;
  width: 210px;
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

.tb-context-item {
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

.tb-context-item:hover,
.tb-context-item.open { background: var(--bm-accent-blue); color: #fff; }
.tb-context-item.danger { color: var(--bm-accent-danger); }
.tb-context-item.danger:hover { background: var(--bm-accent-danger); color: #fff; }
.tb-context-item.checked { font-weight: 600; }

.tb-context-item i { width: 14px; font-size: 11px; text-align: center; flex: 0 0 auto; }
.tb-context-item > span:nth-child(2) { flex: 1; min-width: 0; }

.tb-context-item.has-submenu::after {
  content: '›';
  margin-left: auto;
  color: var(--bm-text-muted);
  font-size: 14px;
  line-height: 1;
}

.tb-context-item.has-submenu:hover::after,
.tb-context-item.has-submenu.open::after { color: #fff; }

.tb-context-sub {
  position: fixed;
  z-index: 1501;
  width: 190px;
  max-height: calc(100vh - 16px);
  overflow-y: auto;
  padding: 5px;
  border: 1px solid var(--bm-border-default);
  border-radius: var(--bm-radius-md);
  background: var(--bm-bg-card);
  box-shadow: var(--bm-shadow-lg);
}

.tb-context-divider {
  height: 1px;
  margin: 4px 6px;
  background: var(--bm-border-subtle);
}
</style>
