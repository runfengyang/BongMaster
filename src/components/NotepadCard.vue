<template>
  <div
    class="notepad-card"
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false"
    @dblclick="handleDoubleClick"
  >
    <!-- Corner marks decoration -->
    <div class="corner-marks">
      <svg class="corner-mark top-left" viewBox="0 0 8 8">
        <path d="M0,8 L0,0 L8,0" fill="none" stroke="currentColor" stroke-width="0.8" stroke-linecap="round" />
      </svg>
      <svg class="corner-mark top-right" viewBox="0 0 8 8">
        <path d="M0,0 L8,0 L8,8" fill="none" stroke="currentColor" stroke-width="0.8" stroke-linecap="round" />
      </svg>
      <svg class="corner-mark bottom-left" viewBox="0 0 8 8">
        <path d="M0,0 L0,8 L8,8" fill="none" stroke="currentColor" stroke-width="0.8" stroke-linecap="round" />
      </svg>
      <svg class="corner-mark bottom-right" viewBox="0 0 8 8">
        <path d="M8,0 L8,8 L0,8" fill="none" stroke="currentColor" stroke-width="0.8" stroke-linecap="round" />
      </svg>
    </div>

    <!-- Toolbar (hover only) -->
    <div class="notepad-toolbar" :class="{ visible: isHovered }">
      <button
        class="toolbar-btn"
        :class="{ active: note.is_pinned }"
        @click="togglePin"
        title="置顶/取消置顶"
      >
        <i class="fas fa-thumbtack"></i>
      </button>
      <button
        class="toolbar-btn"
        @click="handleEdit"
        title="编辑"
      >
        <i class="fas fa-edit"></i>
      </button>
      <button
        class="toolbar-btn delete"
        @click="handleDelete"
        title="删除"
      >
        <i class="fas fa-trash"></i>
      </button>
    </div>

    <!-- Content -->
    <div class="notepad-content">
      <div v-if="note.title" class="notepad-title">
        {{ note.title }}
      </div>
      <div v-if="note.content" class="notepad-body">{{ previewText }}</div>
      <div v-else class="notepad-empty">
        空白便签
      </div>
    </div>

    <!-- Pin indicator -->
    <div v-if="note.is_pinned" class="pin-indicator">
      <i class="fas fa-thumbtack"></i>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useNotepadStore } from '@stores/notepad-store'
import { extractPreview } from '@utils/markdown.js'

const props = defineProps({
  note: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['edit', 'delete'])

const isHovered = ref(false)
const notepadStore = useNotepadStore()

// Plain text preview extracted from markdown content
const previewText = computed(() => {
  if (!props.note.content) return ''
  return extractPreview(props.note.content, 120)
})

const togglePin = () => {
  notepadStore.togglePin(props.note.id)
}

const handleEdit = () => {
  emit('edit', props.note)
}

const handleDelete = () => {
  emit('delete', props.note)
}

const handleDoubleClick = () => {
  emit('edit', props.note)
}
</script>

<style scoped>
.notepad-card {
  position: relative;
  border-radius: 12px;
  box-shadow: 0 1px 8px rgba(26, 26, 24, 0.06);
  transition:
    box-shadow 180ms ease,
    transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
  overflow: hidden;
  cursor: default;
  user-select: none;
}

.notepad-card:hover {
  box-shadow: 0 6px 24px rgba(26, 26, 24, 0.1);
  animation: notepadCardHop 320ms steps(3, end);
  transform: translate(-1px, -2px);
}

.notepad-card::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(rgba(0, 0, 0, 0.026) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0, 0, 0, 0.02) 1px, transparent 1px);
  background-size: 7px 7px;
  opacity: 0.34;
}

.notepad-card::after {
  content: '';
  position: absolute;
  right: 14px;
  bottom: 10px;
  left: 14px;
  height: 1px;
  pointer-events: none;
  background:
    linear-gradient(
      90deg,
      transparent,
      rgba(26, 26, 24, 0.24),
      transparent
    );
  opacity: 0;
  transform: translateX(-10px);
}

.notepad-card:hover::after {
  opacity: 1;
  animation: noteCardSweep 820ms steps(6, end);
}

/* Corner marks decoration */
.corner-marks {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1;
}

.corner-mark {
  position: absolute;
  width: 8px;
  height: 8px;
  color: rgba(0, 0, 0, 0.2);
}

.corner-mark.top-left {
  top: 6px;
  left: 6px;
}

.corner-mark.top-right {
  top: 6px;
  right: 6px;
}

.corner-mark.bottom-left {
  bottom: 6px;
  left: 6px;
}

.corner-mark.bottom-right {
  bottom: 6px;
  right: 6px;
}

/* Toolbar */
.notepad-toolbar {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s ease;
  z-index: 10;
}

.notepad-toolbar.visible {
  opacity: 1;
}

.toolbar-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.9);
  border: none;
  border-radius: 6px;
  color: #666;
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.15s ease;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.toolbar-btn:hover {
  background: white;
  color: #333;
  transform: scale(1.05);
}

.toolbar-btn.active {
  color: #2d5a3d;
}

.toolbar-btn.delete:hover {
  color: #dc2626;
}

/* Content */
.notepad-content {
  position: relative;
  z-index: 2;
  padding: 16px;
  padding-top: 24px;
  height: 100%;
  overflow: hidden;
}

.notepad-title {
  font-size: 0.9375rem;
  font-weight: 600;
  margin-bottom: 8px;
  line-height: 1.4;
  color: inherit;
}

.notepad-body {
  font-size: 0.875rem;
  line-height: 1.6;
  color: inherit;
  opacity: 0.85;
  white-space: normal;
  word-break: break-word;
}

.notepad-empty {
  font-size: 0.875rem;
  color: inherit;
  opacity: 0.4;
  text-align: center;
  padding: 24px 0;
}

/* Pin indicator */
.pin-indicator {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 3;
  font-size: 0.625rem;
  color: inherit;
  opacity: 0.4;
  animation: noteCardPinBlink 1600ms steps(2, end) infinite;
}

@keyframes notepadCardHop {
  0% { transform: translate(0, 0); }
  45% { transform: translate(-1px, -4px); }
  100% { transform: translate(-1px, -2px); }
}

@keyframes noteCardSweep {
  0% { opacity: 0; transform: translateX(-10px); }
  52% { opacity: 1; }
  100% { opacity: 0; transform: translateX(10px); }
}

@keyframes noteCardPinBlink {
  0%, 100% { opacity: 0.36; }
  50% { opacity: 0.72; }
}
</style>
