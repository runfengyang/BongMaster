<template>
  <div class="pm-editor">
    <div class="pm-toolbar" aria-label="Markdown 格式">
      <button
        v-for="item in COMMANDS"
        :key="item.command"
        type="button"
        class="pm-btn"
        :title="item.title"
        @mousedown.prevent
        @click="run(item.command)"
      >
        <i v-if="item.icon" :class="item.icon" aria-hidden="true"></i>
        <span v-else>{{ item.label }}</span>
      </button>
      <span class="pm-sep"></span>
      <button type="button" class="pm-btn" title="插入日期" @mousedown.prevent @click="insertStamp">
        <i class="fas fa-clock" aria-hidden="true"></i>
      </button>
    </div>
    <textarea
      ref="textareaRef"
      class="pm-textarea"
      :value="modelValue"
      :placeholder="placeholder"
      :style="{ minHeight: `${minHeight}px` }"
      spellcheck="true"
      @input="$emit('update:modelValue', $event.target.value)"
    ></textarea>
  </div>
</template>

<script setup>
import { nextTick, onMounted, ref } from 'vue'
import { applyMarkdownCommandToValue } from '@composables/useMarkdownCommands.js'

const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: '用 Markdown 记录内容...' },
  minHeight: { type: Number, default: 160 }
})

const emit = defineEmits(['update:modelValue'])
const textareaRef = ref(null)

const COMMANDS = [
  { command: 'heading2', label: 'H2', title: '二级标题' },
  { command: 'bold', icon: 'fas fa-bold', title: '加粗' },
  { command: 'italic', icon: 'fas fa-italic', title: '斜体' },
  { command: 'strikethrough', icon: 'fas fa-strikethrough', title: '删除线' },
  { command: 'bulletList', icon: 'fas fa-list-ul', title: '无序列表' },
  { command: 'orderedList', icon: 'fas fa-list-ol', title: '有序列表' },
  { command: 'quote', icon: 'fas fa-quote-right', title: '引用' },
  { command: 'link', icon: 'fas fa-link', title: '链接' },
  { command: 'table', icon: 'fas fa-table', title: '表格' }
]

const focus = () => textareaRef.value?.focus()

const run = command => {
  const textarea = textareaRef.value
  if (!textarea) return
  const start = textarea.selectionStart ?? props.modelValue.length
  const end = textarea.selectionEnd ?? start
  const result = applyMarkdownCommandToValue(props.modelValue, start, end, command)
  emit('update:modelValue', result.value)
  nextTick(() => {
    textarea.focus()
    textarea.setSelectionRange(result.selectionStart, result.selectionEnd)
  })
}

const insertStamp = () => {
  const textarea = textareaRef.value
  if (!textarea) return
  const start = textarea.selectionStart ?? props.modelValue.length
  const end = textarea.selectionEnd ?? start
  const now = new Date()
  const stamp = `\n\n## ${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}\n\n`
  const value = props.modelValue.slice(0, start) + stamp + props.modelValue.slice(end)
  emit('update:modelValue', value)
  nextTick(() => {
    textarea.focus()
    textarea.setSelectionRange(start + stamp.length, start + stamp.length)
  })
}

onMounted(() => {
  nextTick(() => focus())
})
</script>

<style scoped>
.pm-editor { display: flex; flex-direction: column; gap: 6px; }

.pm-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
  padding: 3px 4px;
  border: 1px solid var(--bm-border-subtle);
  border-radius: 7px;
  background: var(--bm-bg-sidebar);
}

.pm-btn {
  display: grid;
  place-items: center;
  min-width: 26px;
  height: 25px;
  padding: 0 6px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--bm-text-secondary);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.pm-btn:hover { background: var(--bm-bg-hover); color: var(--bm-text-primary); }
.pm-btn .fas { font-size: 11px; }
.pm-sep { width: 1px; height: 15px; margin: 0 3px; background: var(--bm-border-subtle); }

.pm-textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--bm-border-default);
  border-radius: 8px;
  outline: none;
  background: var(--bm-bg-card);
  color: var(--bm-text-primary);
  font: inherit;
  font-size: 12.5px;
  line-height: 1.7;
  resize: vertical;
}

.pm-textarea:focus {
  border-color: var(--bm-accent-blue);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--bm-accent-blue) 12%, transparent);
}
</style>
