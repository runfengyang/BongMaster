<template>
  <div class="multi-select" ref="wrapperRef" v-click-outside="close">
    <button
      type="button"
      class="multi-select-trigger"
      :class="{ 'is-open': isOpen, 'has-selection': selectedValues.length > 0 }"
      @click="toggle"
    >
      <span class="multi-select-label">{{ displayLabel }}</span>
      <i class="fas fa-chevron-down multi-select-chevron" aria-hidden="true"></i>
    </button>

    <transition name="multi-select-dropdown">
      <div v-if="isOpen" class="multi-select-dropdown">
        <label
          v-for="option in normalizedOptions"
          :key="option.value"
          class="multi-select-option"
          :class="{ 'is-selected': isSelected(option.value) }"
        >
          <input
            type="checkbox"
            :checked="isSelected(option.value)"
            @change="toggleValue(option.value)"
          >
          <span class="option-label">{{ option.label }}</span>
        </label>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  modelValue: {
    type: Array,
    default: () => []
  },
  options: {
    type: Array,
    default: () => []
  },
  placeholder: {
    type: String,
    default: '请选择'
  }
})

const emit = defineEmits(['update:modelValue'])

const isOpen = ref(false)
const wrapperRef = ref(null)

const normalizedOptions = computed(() =>
  props.options.map((o) => (typeof o === 'string' ? { label: o, value: o } : o))
)

const selectedValues = computed(() => props.modelValue || [])

const displayLabel = computed(() => {
  if (selectedValues.value.length === 0) return props.placeholder
  if (selectedValues.value.length === 1) {
    const option = normalizedOptions.value.find((o) => o.value === selectedValues.value[0])
    return option ? option.label : props.placeholder
  }
  return `已选 ${selectedValues.value.length} 项`
})

const isSelected = (value) => selectedValues.value.includes(value)

const toggle = () => {
  isOpen.value = !isOpen.value
}

const close = () => {
  isOpen.value = false
}

const toggleValue = (value) => {
  const current = [...selectedValues.value]
  const index = current.indexOf(value)
  if (index > -1) {
    current.splice(index, 1)
  } else {
    current.push(value)
  }
  emit('update:modelValue', current)
}

const vClickOutside = {
  mounted(el, binding) {
    el._clickOutside = (event) => {
      if (!(el === event.target || el.contains(event.target))) {
        binding.value()
      }
    }
    document.addEventListener('click', el._clickOutside, true)
  },
  unmounted(el) {
    document.removeEventListener('click', el._clickOutside, true)
  }
}
</script>

<style scoped>
.multi-select {
  position: relative;
  display: inline-block;
  min-width: 140px;
}

.multi-select-trigger {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--bm-space-sm);
  padding: 8px 12px;
  background: var(--bm-bg-card);
  border: 1px solid var(--bm-border-default);
  border-radius: var(--bm-radius-md);
  font-size: 0.875rem;
  color: var(--bm-text-primary);
  cursor: pointer;
  transition: border-color var(--bm-transition-fast), box-shadow var(--bm-transition-fast);
  white-space: nowrap;
}

.multi-select-trigger:hover {
  border-color: var(--bm-border-strong);
}

.multi-select-trigger.is-open {
  border-color: var(--bm-accent-blue);
  box-shadow: 0 0 0 2px rgba(46, 170, 220, 0.12);
}

.multi-select-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.multi-select-chevron {
  font-size: 0.75rem;
  color: var(--bm-text-muted);
  flex-shrink: 0;
}

.multi-select-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 100;
  min-width: 100%;
  max-width: 260px;
  max-height: 280px;
  overflow-y: auto;
  background: var(--bm-bg-card);
  border: 1px solid var(--bm-border-default);
  border-radius: var(--bm-radius-md);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.08);
  padding: var(--bm-space-xs);
}

.multi-select-dropdown-enter-active,
.multi-select-dropdown-leave-active {
  transition:
    opacity 120ms ease,
    transform 160ms cubic-bezier(0.22, 1, 0.36, 1);
}

.multi-select-dropdown-enter-from,
.multi-select-dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.multi-select-option {
  display: flex;
  align-items: center;
  gap: var(--bm-space-sm);
  padding: 7px 9px;
  border-radius: var(--bm-radius-sm);
  cursor: pointer;
  font-size: 0.875rem;
  color: var(--bm-text-primary);
  white-space: nowrap;
  transition: background var(--bm-transition-fast);
}

.multi-select-option:hover {
  background: var(--bm-bg-hover);
}

.multi-select-option input[type="checkbox"] {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  accent-color: var(--bm-accent-blue);
}

.option-label {
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
