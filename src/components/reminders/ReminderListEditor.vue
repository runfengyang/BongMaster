<template>
  <Teleport to="body">
    <dialog ref="dialog" class="rm-list-editor" @close="$emit('close')" @cancel.prevent="$emit('close')">
      <form class="rm-list-editor-body" @submit.prevent="save">
        <header class="rm-list-editor-header">
          <h2>{{ editorTitle }}</h2>
        </header>

        <div class="rm-list-editor-row">
          <label class="rm-list-editor-label" for="rm-list-name">名称：</label>
          <input
            id="rm-list-name"
            ref="nameInput"
            v-model="form.name"
            class="rm-list-name-input"
            type="text"
            maxlength="40"
            @keydown.enter.prevent="save"
          >
        </div>

        <div class="rm-list-appearance">
          <div class="rm-appearance-block">
            <span class="rm-list-editor-label">颜色：</span>
            <div class="rm-color-grid">
              <button
                v-for="color in REMINDER_COLORS"
                :key="color.key"
                type="button"
                class="rm-color-swatch"
                :class="{ selected: form.color === color.key }"
                :style="{ background: color.hex }"
                :aria-label="color.label"
                :aria-pressed="form.color === color.key"
                @click="form.color = color.key"
              >
                <ReminderIcon v-if="form.color === color.key" name="check" :size="11" :stroke-width="3" />
              </button>
            </div>
          </div>

          <div class="rm-appearance-block rm-icon-block">
            <span class="rm-list-editor-label">图标：</span>
            <div class="rm-icon-choices">
              <button
                type="button"
                class="rm-icon-choice"
                :class="{ selected: form.icon_type === 'emoji' }"
                :style="{ background: colorHex(form.color) }"
                aria-label="表情图标"
                @click="openIconPicker('emoji', $event)"
              >
                <span class="rm-icon-emoji">{{ form.icon_type === 'emoji' ? form.icon : '😊' }}</span>
              </button>
              <button
                type="button"
                class="rm-icon-choice"
                :class="{ selected: form.icon_type === 'list' }"
                :style="{ background: colorHex(form.color) }"
                aria-label="符号图标"
                @click="openIconPicker('list', $event)"
              >
                <i v-if="form.icon_type === 'list' && isFaIcon(form.icon)" :class="form.icon" class="rm-icon-fa"></i>
                <ReminderIcon
                  v-else
                  :name="form.icon_type === 'list' ? (form.icon || 'list') : 'list'"
                  :size="20"
                  :stroke-width="2"
                />
              </button>
            </div>
          </div>
        </div>

        <div v-if="pickerOpen" class="rm-icon-picker-backdrop" @click="pickerOpen = false"></div>
        <div v-if="pickerOpen" class="rm-icon-picker" :style="pickerStyle" @click.stop>
          <div class="rm-icon-picker-tabs">
            <button type="button" :class="{ active: pickerMode === 'list' }" @click="pickerMode = 'list'">图标</button>
            <button type="button" :class="{ active: pickerMode === 'emoji' }" @click="pickerMode = 'emoji'">表情</button>
          </div>
          <div v-if="pickerMode === 'list'" class="rm-symbol-grid">
            <button
              type="button"
              class="rm-symbol"
              :class="{ selected: form.icon_type === 'list' && !isFaIcon(form.icon) }"
              aria-label="列表符号"
              @click="selectSymbol('list')"
            >
              <ReminderIcon name="list" :size="18" :stroke-width="1.8" />
            </button>
            <button
              v-for="icon in SYMBOLS"
              :key="icon"
              type="button"
              class="rm-symbol"
              :class="{ selected: form.icon_type === 'list' && form.icon === icon }"
              :aria-label="icon"
              @click="selectSymbol(icon)"
            >
              <i :class="icon"></i>
            </button>
          </div>
          <div v-else class="rm-emoji-grid">
            <button
              v-for="emoji in EMOJIS"
              :key="emoji"
              type="button"
              class="rm-emoji"
              :class="{ selected: form.icon_type === 'emoji' && form.icon === emoji }"
              @click="selectEmoji(emoji)"
            >
              {{ emoji }}
            </button>
          </div>
        </div>

        <div class="rm-list-editor-divider"></div>

        <footer class="rm-list-editor-footer">
          <button v-if="isEdit" type="button" class="rm-list-delete" @click="$emit('delete', list)">删除列表</button>
          <span class="rm-footer-spacer"></span>
          <button type="button" class="bm-btn bm-btn-ghost" @click="$emit('close')">取消</button>
          <button type="submit" class="bm-btn bm-btn-primary" :disabled="!form.name.trim()">好</button>
        </footer>
      </form>
    </dialog>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue'
import ReminderIcon from './ReminderIcon.vue'
import { REMINDER_COLORS, colorHex } from '@utils/reminders'

const props = defineProps({
  show: { type: Boolean, default: false },
  list: { type: Object, default: null }
})

const emit = defineEmits(['close', 'save', 'delete'])

const EMOJIS = [
  '📚', '📝', '💼', '🏠', '🛒', '🍎', '💡', '🎯',
  '❤️', '⭐️', '✈️', '🎵', '🎬', '🏃', '🧘', '💊',
  '🐶', '🐱', '🌱', '☕️', '🍽️', '🧹', '🎁', '📞',
  '💻', '🔬', '🧪', '📊', '📅', '✏️', '🔧', '🎨',
  '🏦', '🚗', '🎓', '🏥', '🏋️', '🛍️', '🧾', '🔑',
  '🔔', '📌', '📎', '🗂️', '📦', '🧺', '🍳', '🌙',
  '☀️', '🌧️', '⚽️', '🏀', '🎾', '🚌', '🚲', '⛵️',
  '💬', '🧠', '💎', '🔥'
]

const SYMBOLS = [
  'fa-solid fa-list-ul', 'fa-solid fa-bookmark', 'fa-solid fa-key', 'fa-solid fa-gift',
  'fa-solid fa-cake-candles', 'fa-solid fa-graduation-cap', 'fa-solid fa-baby', 'fa-solid fa-book',
  'fa-solid fa-book-open', 'fa-solid fa-wallet', 'fa-solid fa-credit-card', 'fa-solid fa-briefcase',
  'fa-solid fa-camera', 'fa-solid fa-headphones', 'fa-solid fa-person-running', 'fa-solid fa-utensils',
  'fa-solid fa-wine-glass', 'fa-solid fa-dumbbell', 'fa-solid fa-stethoscope', 'fa-solid fa-chair',
  'fa-solid fa-house', 'fa-solid fa-building', 'fa-solid fa-landmark', 'fa-solid fa-tent',
  'fa-solid fa-tv', 'fa-solid fa-music', 'fa-solid fa-laptop', 'fa-solid fa-gamepad',
  'fa-solid fa-paw', 'fa-solid fa-fish', 'fa-solid fa-basket-shopping', 'fa-solid fa-cart-shopping',
  'fa-solid fa-bag-shopping', 'fa-solid fa-box', 'fa-solid fa-futbol', 'fa-solid fa-basketball',
  'fa-solid fa-baseball', 'fa-solid fa-football', 'fa-solid fa-bus', 'fa-solid fa-car',
  'fa-solid fa-plane', 'fa-solid fa-sailboat', 'fa-solid fa-bicycle', 'fa-solid fa-sun',
  'fa-solid fa-moon', 'fa-solid fa-droplet', 'fa-solid fa-snowflake', 'fa-solid fa-fire',
  'fa-solid fa-scissors', 'fa-solid fa-lightbulb', 'fa-solid fa-comment', 'fa-solid fa-star',
  'fa-solid fa-heart', 'fa-solid fa-circle', 'fa-solid fa-square', 'fa-solid fa-bolt',
  'fa-solid fa-leaf', 'fa-solid fa-cloud', 'fa-solid fa-umbrella', 'fa-solid fa-anchor',
  'fa-solid fa-compass', 'fa-solid fa-map', 'fa-solid fa-location-dot', 'fa-solid fa-globe',
  'fa-solid fa-phone', 'fa-solid fa-envelope', 'fa-solid fa-bullhorn', 'fa-solid fa-gear',
  'fa-solid fa-wrench', 'fa-solid fa-palette', 'fa-solid fa-pen', 'fa-solid fa-flask',
  'fa-solid fa-microscope', 'fa-solid fa-calculator', 'fa-solid fa-chart-line', 'fa-solid fa-coins'
]

const isFaIcon = icon => /^fa-[a-z]+ fa-/.test(icon || '')

const dialog = ref(null)
const nameInput = ref(null)
const pickerOpen = ref(false)
const pickerMode = ref('list')
const pickerStyle = ref({})
const form = reactive({
  name: '',
  color: 'blue',
  icon: 'list',
  icon_type: 'list'
})

const isEdit = computed(() => Boolean(props.list?.id))
const editorTitle = computed(() => (
  isEdit.value ? `“${form.name || '列表'}”简介` : '新建列表'
))

const reset = () => {
  const list = props.list
  form.name = list?.name || '新建列表'
  form.color = list?.color || 'blue'
  form.icon = list?.icon || 'list'
  form.icon_type = list?.icon_type === 'emoji' ? 'emoji' : 'list'
  pickerOpen.value = false
}

const openIconPicker = (mode, event) => {
  pickerMode.value = mode
  const rect = event.currentTarget.getBoundingClientRect()
  const width = 376
  const height = 430
  let left = rect.right + 12
  if (left + width > window.innerWidth - 12) left = Math.max(12, rect.left - width - 12)
  let top = rect.top - 12
  if (top + height > window.innerHeight - 12) top = Math.max(12, window.innerHeight - height - 12)
  pickerStyle.value = { left: `${left}px`, top: `${top}px` }
  pickerOpen.value = true
}

const selectSymbol = icon => {
  form.icon_type = 'list'
  form.icon = icon
  pickerOpen.value = false
}

const selectEmoji = emoji => {
  form.icon_type = 'emoji'
  form.icon = emoji
  pickerOpen.value = false
}

const save = () => {
  const name = form.name.trim()
  if (!name) return
  emit('save', {
    id: props.list?.id || null,
    name,
    color: form.color,
    icon: form.icon,
    icon_type: form.icon_type
  })
}

watch(() => props.show, async visible => {
  if (visible) {
    reset()
    await nextTick()
    if (dialog.value && !dialog.value.open) dialog.value.showModal()
    await nextTick()
    nameInput.value?.focus()
    nameInput.value?.select()
  } else if (dialog.value?.open) {
    dialog.value.close()
  }
}, { immediate: true })
</script>

<style scoped>
.rm-list-editor {
  position: fixed;
  inset: 0;
  width: min(500px, calc(100vw - 32px));
  max-height: calc(100vh - 32px);
  margin: auto;
  padding: 0;
  overflow-y: auto;
  border: 1px solid var(--bm-border-default);
  border-radius: var(--bm-radius-lg);
  background: var(--bm-bg-card);
  color: var(--bm-text-primary);
  box-shadow: var(--bm-shadow-lg);
  font-family: var(--bm-font-ui);
}

.rm-list-editor::backdrop {
  background: rgb(0 0 0 / 0.18);
}

.rm-list-editor-body { display: flex; flex-direction: column; }

.rm-list-editor-header {
  padding: 16px 20px 6px;
}

.rm-list-editor-header h2 {
  margin: 0;
  font-size: 14.5px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.rm-list-editor-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 20px;
}

.rm-list-editor-label {
  flex: 0 0 auto;
  color: var(--bm-text-secondary);
  font-size: 12.5px;
}

.rm-list-name-input {
  flex: 1;
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--bm-border-default);
  border-radius: var(--bm-radius-sm);
  outline: none;
  background: var(--bm-bg-card);
  color: var(--bm-text-primary);
  font: inherit;
  font-size: 13px;
}

.rm-list-name-input:focus { border-color: var(--bm-accent-blue); box-shadow: 0 0 0 3px color-mix(in srgb, var(--bm-accent-blue) 14%, transparent); }

.rm-list-appearance {
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 18px;
  padding: 10px 20px 6px;
}

.rm-appearance-block {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.rm-color-grid {
  display: grid;
  grid-template-columns: repeat(6, 20px);
  gap: 8px;
  padding-top: 1px;
}

.rm-color-swatch {
  display: grid;
  place-items: center;
  width: 19px;
  height: 19px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: #fff;
  cursor: pointer;
  box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.08);
}

.rm-color-swatch.selected {
  box-shadow: 0 0 0 2px var(--bm-bg-card), 0 0 0 3.5px var(--bm-accent-blue);
}

.rm-icon-choices {
  display: flex;
  gap: 8px;
}

.rm-icon-choice {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: #fff;
  cursor: pointer;
  box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.08);
}

.rm-icon-choice.selected {
  box-shadow: 0 0 0 2px var(--bm-bg-card), 0 0 0 3.5px var(--bm-accent-blue);
}

.rm-icon-emoji { font-size: 19px; line-height: 1; }
.rm-icon-fa { font-size: 16px; line-height: 1; color: #fff; }

.rm-icon-picker-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
}

.rm-icon-picker {
  position: fixed;
  z-index: 21;
  width: 376px;
  max-height: 430px;
  overflow-y: auto;
  padding: 8px;
  border: 1px solid var(--bm-border-default);
  border-radius: 12px;
  background: var(--bm-bg-card);
  box-shadow: var(--bm-shadow-lg);
}

.rm-icon-picker-tabs {
  display: flex;
  gap: 4px;
  padding: 2px 2px 8px;
}

.rm-icon-picker-tabs button {
  height: 26px;
  padding: 0 11px;
  border: 0;
  border-radius: 13px;
  background: var(--bm-bg-hover);
  color: var(--bm-text-secondary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.rm-icon-picker-tabs button.active {
  background: var(--bm-accent-blue);
  color: #fff;
}

.rm-symbol-grid {
  display: grid;
  grid-template-columns: repeat(9, 1fr);
  gap: 4px;
}

.rm-symbol {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--bm-text-primary);
  font-size: 14px;
  cursor: pointer;
}

.rm-symbol:hover { background: var(--bm-bg-hover); }
.rm-symbol.selected {
  background: var(--bm-bg-active);
  box-shadow: inset 0 0 0 1.5px var(--bm-accent-blue);
  color: var(--bm-accent-blue);
}

.rm-emoji-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 3px;
}

.rm-emoji {
  display: grid;
  place-items: center;
  height: 38px;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  font-size: 18px;
  cursor: pointer;
}

.rm-emoji:hover { background: var(--bm-bg-hover); }
.rm-emoji.selected { background: color-mix(in srgb, var(--bm-accent-blue) 10%, var(--bm-bg-card)); box-shadow: inset 0 0 0 1px var(--bm-accent-blue); }

.rm-list-editor-divider {
  height: 1px;
  margin: 6px 20px;
  background: var(--bm-border-subtle);
}

.rm-list-editor-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px 16px;
}

.rm-footer-spacer { flex: 1; }

.rm-list-delete {
  padding: 4px 0;
  border: 0;
  background: transparent;
  color: var(--bm-accent-danger);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.rm-list-delete:hover { text-decoration: underline; }

</style>
