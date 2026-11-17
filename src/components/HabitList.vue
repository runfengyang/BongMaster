<template>
  <aside class="habit-side" aria-label="习惯列表">
    <header class="habit-side-head">
      <div class="habit-side-title">
        <h1 class="bm-tab-title">习惯</h1>
        <span>{{ habits.length }} 个 · 今日 {{ checkedTodayIds.length }}</span>
      </div>
      <button type="button" class="habit-side-add" title="新建习惯" @click="$emit('create')">＋</button>
    </header>

    <div class="habit-side-scroll">
      <div class="habit-side-group">今天</div>
      <draggable
        v-model="sortedHabits"
        item-key="id"
        handle=".habit-row"
        :animation="160"
        ghost-class="habit-ghost"
        class="habit-rows"
        @end="onDragEnd"
      >
        <template #item="{ element: habit }">
          <button
            type="button"
            class="habit-row"
            :class="{ active: selectedId === habit.id }"
            :style="{ '--hc': habit.color || '#10b981' }"
            @click="$emit('select', habit.id)"
            @contextmenu.prevent="openMenu(habit, $event)"
          >
            <span class="habit-row-icon"><i :class="habit.icon || 'fas fa-fire'"></i></span>
            <span class="habit-row-name">{{ habit.name }}</span>
            <span class="habit-row-state" :class="{ done: isCheckedToday(habit.id) }">
              <i class="fas fa-check" v-if="isCheckedToday(habit.id)"></i>
            </span>
          </button>
        </template>
      </draggable>

      <button type="button" class="habit-side-new" @click="$emit('create')">
        <span class="habit-new-dot">＋</span>新建习惯
      </button>
    </div>

    <footer class="habit-side-foot">拖动排序 · 右键编辑 / 归档</footer>

    <Teleport to="body">
      <Transition name="habit-menu">
        <div v-if="menu.show" class="habit-menu-layer" @click.self="closeMenu">
          <div class="habit-menu" :style="{ left: `${menu.left}px`, top: `${menu.top}px` }" role="menu">
            <button type="button" @click="menuAction('edit')">
              <i class="fas fa-pen"></i>编辑习惯
            </button>
            <button type="button" @click="menuAction('archive')">
              <i class="fas fa-box-archive"></i>归档
            </button>
            <button type="button" class="danger" @click="menuAction('delete')">
              <i class="fas fa-trash"></i>删除
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </aside>
</template>

<script setup>
import { computed, onUnmounted, reactive } from 'vue'
import draggable from 'vuedraggable'

const props = defineProps({
  habits: { type: Array, default: () => [] },
  selectedId: { type: Number, default: null },
  checkedTodayIds: { type: Array, default: () => [] }
})

const emit = defineEmits(['select', 'create', 'edit', 'archive', 'delete', 'reorder'])

const sortedHabits = computed({
  get: () => [...props.habits].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)),
  set: value => {
    emit('reorder', value.map((habit, index) => ({ ...habit, sort_order: index })))
  }
})

const isCheckedToday = id => props.checkedTodayIds.includes(id)

const onDragEnd = () => {}
const menu = reactive({ show: false, left: 0, top: 0, habit: null })

const openMenu = (habit, event) => {
  const width = 170
  const height = 126
  menu.habit = habit
  menu.left = Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8))
  menu.top = Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8))
  menu.show = true
  document.addEventListener('keydown', closeOnEscape)
}

const closeMenu = () => {
  menu.show = false
  menu.habit = null
  document.removeEventListener('keydown', closeOnEscape)
}

const closeOnEscape = event => {
  if (event.key === 'Escape') closeMenu()
}

const menuAction = action => {
  const habit = menu.habit
  closeMenu()
  if (!habit) return
  if (action === 'edit') emit('edit', habit)
  else if (action === 'archive') emit('archive', habit.id)
  else if (action === 'delete') emit('delete', habit.id)
}

defineExpose({ openMenu })

onUnmounted(() => {
  document.removeEventListener('keydown', closeOnEscape)
})
</script>

<style scoped>
.habit-side {
  display: flex;
  flex-direction: column;
  width: 236px;
  flex: 0 0 236px;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--bm-border-default);
  border-radius: var(--bm-radius-lg);
  background: var(--bm-bg-card);
  box-shadow: var(--bm-shadow-sm);
}

.habit-side-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 44px;
  padding: 0 11px;
  border-bottom: 1px solid var(--bm-border-subtle);
}

.habit-side-title { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.habit-side-title h1 { margin: 0; }
.habit-side-title span { color: var(--bm-text-muted); font-size: 10.5px; white-space: nowrap; }

.habit-side-add {
  margin-left: auto;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: var(--bm-bg-hover);
  color: var(--bm-text-secondary);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease, transform 120ms ease;
}
.habit-side-add:hover { background: var(--bm-bg-active); color: var(--bm-text-primary); }
.habit-side-add:active { transform: scale(0.94); }

.habit-side-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px;
}

.habit-side-group {
  margin: 6px 7px 3px;
  color: var(--bm-text-muted);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.habit-rows { display: flex; flex-direction: column; gap: 1px; }

.habit-row {
  position: relative;
  width: 100%;
  height: 40px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 7px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--bm-text-primary);
  font: inherit;
  text-align: left;
  cursor: grab;
  transition: background 140ms ease, transform 140ms ease;
}
.habit-row:hover { background: var(--bm-bg-hover); }
.habit-row:active { cursor: grabbing; }
.habit-row.active { background: var(--bm-bg-active); }
.habit-row.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 12px;
  bottom: 12px;
  width: 3px;
  border-radius: 0 2px 2px 0;
  background: var(--hc);
  animation: habitBarIn 180ms ease both;
}

@keyframes habitBarIn {
  from { transform: scaleY(0.2); opacity: 0; }
  to { transform: scaleY(1); opacity: 1; }
}

.habit-row-icon {
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 7px;
  background: color-mix(in srgb, var(--hc) 12%, transparent);
  color: var(--hc);
  font-size: 12px;
}

.habit-row-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  font-weight: 500;
}

.habit-row-state {
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border: 1.4px solid var(--bm-border-strong);
  border-radius: 50%;
  color: #fff;
  font-size: 8px;
  transition: background 160ms ease, border-color 160ms ease, transform 160ms ease;
}
.habit-row-state.done {
  background: var(--hc);
  border-color: var(--hc);
  animation: habitCheckPop 220ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes habitCheckPop {
  0% { transform: scale(0.7); }
  60% { transform: scale(1.12); }
  100% { transform: scale(1); }
}

.habit-side-new {
  width: 100%;
  height: 34px;
  display: flex;
  align-items: center;
  gap: 9px;
  margin-top: 4px;
  padding: 0 8px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--bm-text-muted);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: text;
  transition: background 140ms ease, color 140ms ease;
}
.habit-side-new:hover { background: var(--bm-bg-hover); color: var(--bm-text-secondary); }
.habit-new-dot {
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border: 1.4px dashed var(--bm-border-strong);
  border-radius: 50%;
  font-size: 11px;
}

.habit-side-foot {
  flex: 0 0 auto;
  padding: 8px 10px;
  border-top: 1px solid var(--bm-border-subtle);
  color: var(--bm-text-tertiary);
  font-size: 10px;
}

.habit-ghost { opacity: 0.3; background: var(--bm-bg-active); border-radius: 9px; }

.habit-menu-layer { position: fixed; inset: 0; z-index: 1300; }
.habit-menu {
  position: absolute;
  width: 170px;
  padding: 5px;
  border: 1px solid var(--bm-border-default);
  border-radius: var(--bm-radius-md);
  background: var(--bm-bg-card);
  box-shadow: var(--bm-shadow-lg);
}
.habit-menu button {
  width: 100%;
  height: 30px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 9px;
  border: 0;
  border-radius: var(--bm-radius-sm);
  background: transparent;
  color: var(--bm-text-primary);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.habit-menu button i { width: 14px; color: var(--bm-text-muted); font-size: 11px; }
.habit-menu button:hover { background: var(--bm-accent-blue); color: #fff; }
.habit-menu button:hover i { color: #fff; }
.habit-menu button.danger { color: var(--bm-accent-danger); }
.habit-menu button.danger:hover { background: var(--bm-accent-danger); color: #fff; }
.habit-menu button.danger i { color: inherit; }

.habit-menu-enter-active,
.habit-menu-leave-active { transition: opacity 120ms ease, transform 120ms ease; }
.habit-menu-enter-from,
.habit-menu-leave-to { opacity: 0; transform: translateY(-3px) scale(0.98); }

@media (prefers-reduced-motion: reduce) {
  .habit-row,
  .habit-row-state,
  .habit-row.active::before,
  .habit-menu-enter-active,
  .habit-menu-leave-active { transition: none; animation: none; }
}
</style>
