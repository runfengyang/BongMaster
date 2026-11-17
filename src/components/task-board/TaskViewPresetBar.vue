<template>
  <div class="task-preset-bar">
    <div class="preset-group">
      <button
        v-for="preset in presets"
        :key="preset.key"
        class="bm-btn preset-btn"
        :class="{ 'bm-btn-secondary': activePresetKey === preset.key && !activeSavedViewId }"
        @click="$emit('select-preset', preset.key)"
      >
        {{ preset.label }}
      </button>
      <button
        v-if="activePresetKey || activeSavedViewId"
        class="bm-btn bm-btn-ghost preset-clear"
        @click="$emit('clear-preset')"
        aria-label="清除预设"
      >
        <i class="fas fa-times" aria-hidden="true"></i>
      </button>
    </div>

    <div v-if="savedViews.length" class="preset-divider"></div>

    <div v-if="savedViews.length" class="preset-group saved-views">
      <button
        v-for="view in savedViews"
        :key="view.id"
        class="bm-btn preset-btn saved-view-btn"
        :class="{ 'bm-btn-secondary': activeSavedViewId === view.id }"
        @click="$emit('select-saved-view', view)"
      >
        <i class="fas fa-bookmark" aria-hidden="true"></i>
        {{ view.name }}
      </button>
    </div>
  </div>
</template>

<script setup>
defineProps({
  presets: {
    type: Array,
    required: true
  },
  activePresetKey: {
    type: String,
    default: null
  },
  savedViews: {
    type: Array,
    default: () => []
  },
  activeSavedViewId: {
    type: [Number, String],
    default: null
  }
})

defineEmits(['select-preset', 'clear-preset', 'select-saved-view', 'delete-saved-view'])
</script>

<style scoped>
.task-preset-bar {
  display: flex;
  align-items: center;
  gap: var(--bm-space-md);
  flex-wrap: wrap;
  margin-bottom: var(--bm-space-lg);
  padding-bottom: var(--bm-space-md);
  border-bottom: 1px solid var(--bm-border-subtle);
}

.preset-group {
  display: flex;
  align-items: center;
  gap: var(--bm-space-sm);
  flex-wrap: wrap;
}

.preset-btn {
  font-size: 0.8125rem;
}

.saved-view-btn {
  color: var(--bm-text-secondary);
}

.saved-view-btn i {
  font-size: 0.6875rem;
}

.preset-clear {
  width: 32px;
  height: 32px;
  padding: 0;
  justify-content: center;
}

.preset-divider {
  width: 1px;
  height: 20px;
  background: var(--bm-border-default);
}

@media (max-width: 576px) {
  .task-preset-bar {
    overflow-x: auto;
    flex-wrap: nowrap;
    padding-bottom: var(--bm-space-sm);
  }

  .preset-group {
    flex-wrap: nowrap;
  }

  .preset-divider {
    flex-shrink: 0;
  }
}
</style>
