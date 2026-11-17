<template>
  <Teleport to="body">
    <Transition name="rm-pop">
      <div v-if="show" class="rm-options" :style="style" @click.stop>
        <div class="rm-options-label">排序方式</div>
        <button
          v-for="option in SORT_OPTIONS"
          :key="option.value"
          type="button"
          class="rm-option-item"
          @click="$emit('update:sortMode', option.value)"
        >
          <span>{{ option.label }}</span>
          <ReminderIcon v-if="sortMode === option.value" name="check" :size="13" :stroke-width="2.4" />
        </button>

        <div class="rm-options-divider"></div>

        <button type="button" class="rm-option-item" @click="$emit('update:groupByTime', !groupByTime)">
          <span>根据时间分组</span>
          <span class="rm-option-check" :class="{ on: groupByTime }">
            <ReminderIcon v-if="groupByTime" name="check" :size="10" :stroke-width="3" />
          </span>
        </button>
        <button type="button" class="rm-option-item" @click="$emit('update:showCompleted', !showCompleted)">
          <span>显示完成项目</span>
          <span class="rm-option-check" :class="{ on: showCompleted }">
            <ReminderIcon v-if="showCompleted" name="check" :size="10" :stroke-width="3" />
          </span>
        </button>
        <button type="button" class="rm-option-item" @click="$emit('toggle-subtasks')">
          <span>{{ subtasksExpanded ? '隐藏所有子任务' : '显示所有子任务' }}</span>
        </button>

        <div class="rm-options-divider"></div>

        <button type="button" class="rm-option-item" @click="$emit('toggle-sidebar')">
          <span>隐藏边栏</span>
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { computed } from 'vue'
import ReminderIcon from './ReminderIcon.vue'

const props = defineProps({
  show: { type: Boolean, default: false },
  anchor: { type: Object, default: null },
  sortMode: { type: String, default: 'manual' },
  groupByTime: { type: Boolean, default: true },
  showCompleted: { type: Boolean, default: false },
  subtasksExpanded: { type: Boolean, default: false }
})

defineEmits(['update:sortMode', 'update:groupByTime', 'update:showCompleted', 'toggle-subtasks', 'toggle-sidebar'])

const SORT_OPTIONS = [
  { value: 'manual', label: '手动' },
  { value: 'due', label: '截止日期' },
  { value: 'created', label: '创建日期' },
  { value: 'priority', label: '优先级' },
  { value: 'title', label: '标题' }
]

const style = computed(() => {
  const width = 220
  const anchor = props.anchor
  let left = anchor ? anchor.right - width : window.innerWidth - width - 24
  left = Math.max(12, Math.min(left, window.innerWidth - width - 12))
  const top = anchor ? anchor.bottom + 6 : 70
  return { left: `${left}px`, top: `${top}px` }
})
</script>

<style scoped>
.rm-options {
  position: fixed;
  z-index: 1250;
  width: 220px;
  padding: 5px;
  border: 1px solid rgb(0 0 0 / 0.12);
  border-radius: 10px;
  background: rgb(255 255 255 / 0.98);
  color: #1d1d1f;
  box-shadow: 0 16px 42px rgb(0 0 0 / 0.2), 0 2px 8px rgb(0 0 0 / 0.06);
  backdrop-filter: blur(18px);
  font-family: var(--bm-font-ui);
}

.rm-options-label {
  padding: 5px 8px 3px;
  color: #8e8e93;
  font-size: 10.5px;
  font-weight: 600;
}

.rm-option-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 26px;
  padding: 4px 8px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: #1d1d1f;
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
}

.rm-option-item:hover { background: #007aff; color: #fff; }
.rm-option-check {
  display: grid;
  place-items: center;
  width: 15px;
  height: 15px;
  border: 1px solid #c7c7cc;
  border-radius: 4px;
  color: #fff;
}
.rm-option-check.on { border-color: #007aff; background: #007aff; }
.rm-option-item:hover .rm-option-check { border-color: #fff; }

.rm-options-divider {
  height: 1px;
  margin: 4px 6px;
  background: rgb(60 60 67 / 0.12);
}

.rm-pop-enter-active,
.rm-pop-leave-active { transition: opacity 100ms ease, transform 100ms ease; }
.rm-pop-enter-from,
.rm-pop-leave-to { opacity: 0; transform: translateY(-3px) scale(0.98); }
</style>
