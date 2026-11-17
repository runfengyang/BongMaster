<template>
  <transition name="undo-toast">
    <div v-if="undoStore.visible" class="undo-toast" role="status" aria-live="polite">
      <i class="fas fa-trash-can undo-toast-icon" aria-hidden="true"></i>
      <span class="undo-toast-message" :title="undoStore.message">{{ undoStore.message }}</span>
      <button
        type="button"
        class="undo-toast-action"
        :disabled="undoStore.busy"
        @click="undoStore.undo()"
      >撤回</button>
      <button
        type="button"
        class="undo-toast-close"
        aria-label="关闭"
        title="关闭"
        @click="undoStore.dismiss()"
      >
        <i class="fas fa-times"></i>
      </button>
    </div>
  </transition>
</template>

<script setup>
import { useUndoStore } from '@stores/undo-store'

const undoStore = useUndoStore()
</script>

<style scoped>
.undo-toast {
  position: fixed;
  top: calc(var(--bm-navbar-height) + 14px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 1200;
  display: flex;
  align-items: center;
  gap: var(--bm-space-sm);
  max-width: min(560px, calc(100vw - 48px));
  padding: 8px 10px 8px 14px;
  background: var(--bm-bg-card);
  border: 1px solid var(--bm-border-default);
  border-radius: 999px;
  box-shadow: var(--bm-shadow-md);
}

.undo-toast-icon {
  flex: 0 0 auto;
  color: var(--bm-text-muted);
  font-size: 0.75rem;
}

.undo-toast-message {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--bm-text-primary);
  font-size: 0.8125rem;
}

.undo-toast-action {
  flex: 0 0 auto;
  padding: 4px 12px;
  border: none;
  border-radius: 999px;
  background: color-mix(in srgb, var(--bm-accent-blue) 14%, transparent);
  color: var(--bm-accent-blue);
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color var(--bm-transition-fast);
}

.undo-toast-action:hover:not(:disabled) {
  background: color-mix(in srgb, var(--bm-accent-blue) 24%, transparent);
}

.undo-toast-action:disabled {
  opacity: 0.55;
  cursor: default;
}

.undo-toast-close {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--bm-text-muted);
  font-size: 0.6875rem;
  cursor: pointer;
}

.undo-toast-close:hover {
  background: var(--bm-bg-hover);
  color: var(--bm-text-primary);
}

.undo-toast-enter-active,
.undo-toast-leave-active {
  transition: opacity 180ms ease, transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
}

.undo-toast-enter-from,
.undo-toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-10px);
}
</style>
