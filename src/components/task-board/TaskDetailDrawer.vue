<template>
  <div class="task-detail-layer" :class="`is-${variant}`">
    <transition v-if="variant === 'drawer'" name="drawer-fade">
      <div
        v-if="show"
        class="drawer-overlay"
        @click.self="handleOverlayClick"
      ></div>
    </transition>

    <transition :name="variant === 'panel' ? 'panel-slide' : 'drawer-slide'">
      <aside
        v-if="show"
        class="task-detail-drawer"
        :class="{ 'is-panel': variant === 'panel' }"
        :role="variant === 'panel' ? 'complementary' : 'dialog'"
        :aria-modal="variant === 'panel' ? undefined : 'true'"
        aria-labelledby="drawer-title"
      >
        <div class="drawer-header">
          <h2 id="drawer-title" class="drawer-title">{{ isEdit ? '编辑任务' : '新建任务' }}</h2>
          <button
            class="bm-btn bm-btn-icon drawer-close"
            aria-label="关闭"
            @click="close"
          >
            <i class="fas fa-times" aria-hidden="true"></i>
          </button>
        </div>

        <div class="drawer-body">
          <div class="drawer-section drawer-fields">
            <div class="drawer-field">
              <label class="drawer-label" for="task-name">任务名称</label>
              <input
                id="task-name"
                ref="titleInput"
                type="text"
                class="bm-form-control"
                v-model="form.name"
                placeholder="输入任务名称"
                @keydown.esc="handleEsc"
              >
            </div>
            <div class="drawer-field">
              <label class="drawer-label">所属项目</label>
              <select class="bm-form-control" v-model="form.project_id" @keydown.esc="handleEsc">
                <option value="">选择项目</option>
                <option v-for="project in projects" :key="project.id" :value="project.id">
                  {{ project.name }}
                </option>
              </select>
            </div>

            <div class="drawer-field-row">
              <div class="drawer-field">
                <label class="drawer-label">状态</label>
                <select class="bm-form-control" v-model="form.status" @keydown.esc="handleEsc">
                  <option value="待办">待办</option>
                  <option value="进行中">进行中</option>
                  <option value="已完成">已完成</option>
                </select>
              </div>
              <div class="drawer-field">
                <label class="drawer-label">优先级</label>
                <select class="bm-form-control" v-model="form.priority" @keydown.esc="handleEsc">
                  <option value="高">高</option>
                  <option value="中">中</option>
                  <option value="低">低</option>
                </select>
              </div>
            </div>

            <div class="drawer-field-row">
              <div class="drawer-field">
                <label class="drawer-label">负责人</label>
                <input
                  type="text"
                  class="bm-form-control"
                  v-model="form.assignee"
                  placeholder="负责人"
                  @keydown.esc="handleEsc"
                >
              </div>
              <div class="drawer-field">
                <label class="drawer-label">截止日期</label>
                <input
                  type="date"
                  class="bm-form-control"
                  v-model="form.due_date"
                  @keydown.esc="handleEsc"
                >
              </div>
            </div>

            <div class="drawer-field-row">
              <div class="drawer-field">
                <label class="drawer-label">预计时长</label>
                <input
                  type="text"
                  class="bm-form-control"
                  v-model="form.estimatedInput"
                  placeholder="45m / 1h30m"
                  @keydown.esc="handleEsc"
                >
              </div>
              <div class="drawer-field">
                <label class="drawer-label">已耗时</label>
                <input
                  type="text"
                  class="bm-form-control"
                  v-model="form.spentInput"
                  placeholder="分钟数"
                  @keydown.esc="handleEsc"
                >
              </div>
            </div>
          </div>

          <div class="drawer-section drawer-notes">
            <label class="drawer-label">描述</label>
            <textarea
              class="bm-form-control drawer-textarea"
              v-model="form.description"
              placeholder="任务上下文、关联笔记、下一步行动..."
              rows="6"
              @keydown.esc="handleEsc"
            ></textarea>
          </div>

          <div class="drawer-section drawer-tags">
            <label class="drawer-label">标签</label>
            <input
              type="text"
              class="bm-form-control"
              v-model="form.tags"
              placeholder="用逗号分隔，例如：论文，写作，返修"
              @keydown.esc="handleEsc"
            >
          </div>
        </div>

        <div class="drawer-footer">
          <div class="drawer-footer-left">
            <button
              v-if="isEdit"
              type="button"
              class="bm-btn bm-btn-danger"
              :disabled="saving"
              @click="confirmDelete"
            >
              <i class="fas fa-trash" aria-hidden="true"></i>
              删除
            </button>
          </div>
          <div class="drawer-footer-right">
            <button
              type="button"
              class="bm-btn bm-btn-ghost"
              :disabled="saving"
              @click="close"
            >
              取消
            </button>
            <button
              type="button"
              class="bm-btn bm-btn-primary"
              :disabled="saving"
              @click="save"
            >
              <span v-if="saving">保存中...</span>
              <span v-else>{{ isEdit ? '保存' : '创建' }}</span>
            </button>
          </div>
        </div>
      </aside>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'

const parseDurationText = (s) => {
  if (!s) return 0
  const t = String(s).trim()
  const hm = t.match(/^(\d+)[hH时](\d+)[mM分]?$/)
  if (hm) return parseInt(hm[1]) * 60 + parseInt(hm[2])
  const h = t.match(/^(\d+)[hH时]$/)
  if (h) return parseInt(h[1]) * 60
  const m = t.match(/^(\d+)[mM分]?$/)
  if (m) return parseInt(m[1])
  return parseInt(t, 10)
}

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  task: {
    type: Object,
    default: null
  },
  projects: {
    type: Array,
    default: () => []
  },
  defaults: {
    type: Object,
    default: () => ({})
  },
  mode: {
    type: String,
    default: 'edit' // 'create' | 'edit'
  },
  variant: {
    type: String,
    default: 'drawer' // 'drawer' | 'panel'
  }
})

const emit = defineEmits(['close', 'save', 'delete'])

const emptyForm = () => ({
  name: '',
  project_id: '',
  status: '待办',
  priority: '中',
  assignee: '',
  due_date: '',
  estimatedInput: '',
  spentInput: '',
  description: '',
  tags: ''
})

const form = ref(emptyForm())
const original = ref(emptyForm())
const saving = ref(false)
const titleInput = ref(null)

const isEdit = computed(() => props.mode === 'edit' && props.task)
const isDirty = computed(() => {
  return JSON.stringify(form.value) !== JSON.stringify(original.value)
})
const resetForm = () => {
  const base = isEdit.value
    ? {
        ...props.task,
        description: props.task.description || '',
        tags: props.task.tags || ''
      }
    : { ...emptyForm(), ...props.defaults }
  form.value = JSON.parse(JSON.stringify(base))
  original.value = JSON.parse(JSON.stringify(base))
}

watch(() => [props.show, props.task, props.mode, props.defaults], () => {
  if (props.show) {
    resetForm()
    nextTick(() => {
      titleInput.value?.focus()
    })
  }
}, { immediate: true })

const close = () => {
  if (saving.value) return
  emit('close')
}

const save = () => {
  if (saving.value) return
  if (!form.value.name.trim()) {
    alert('请输入任务名称')
    titleInput.value?.focus()
    return
  }
  if (!form.value.project_id) {
    alert('请选择所属项目')
    return
  }
  saving.value = true
  try {
    const payload = { ...form.value }
    // Parse duration inputs
    const estMin = parseDurationText(form.value.estimatedInput)
    const spentMin = parseInt(form.value.spentInput, 10)
    payload.estimated_minutes = Number.isFinite(estMin) ? estMin : 0
    payload.time_spent_minutes = Number.isFinite(spentMin) ? spentMin : 0
    emit('save', payload, () => { saving.value = false })
  } catch (error) {
    saving.value = false
    throw error
  }
}

const confirmDelete = () => {
  if (!props.task) return
  emit('delete', props.task.id)
}

const handleEsc = () => {
  if (isDirty.value) return
  close()
}

const handleOverlayClick = () => {
  if (isDirty.value) return
  close()
}

// Global Esc listener
const onKeydown = (e) => {
  if (e.key === 'Escape' && props.show) {
    handleEsc()
  }
}

watch(() => props.show, (val) => {
  if (val) {
    document.addEventListener('keydown', onKeydown)
  } else {
    document.removeEventListener('keydown', onKeydown)
  }
})
</script>

<style scoped>
.drawer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(55, 53, 47, 0.35);
  z-index: 2100;
}

.task-detail-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 100%;
  max-width: 520px;
  background: var(--bm-bg-card);
  border-left: 1px solid var(--bm-border-default);
  box-shadow: var(--bm-shadow-md);
  z-index: 2200;
  display: flex;
  flex-direction: column;
}

.task-detail-layer.is-panel {
  display: flex;
  flex: 0 0 380px;
  min-height: 0;
  min-width: 0;
}

.task-detail-drawer.is-panel {
  position: relative;
  top: auto;
  right: auto;
  bottom: auto;
  width: 100%;
  max-width: none;
  height: 100%;
  z-index: 1;
  box-shadow: none;
}

.drawer-header {
  display: flex;
  align-items: center;
  gap: var(--bm-space-md);
  padding: var(--bm-space-lg);
  border-bottom: 1px solid var(--bm-border-subtle);
}

.drawer-title {
  flex: 1;
  font-size: 1.25rem;
  font-weight: 600;
  font-family: var(--bm-font-heading);
  color: var(--bm-text-primary);
  margin: 0;
}

.drawer-close {
  flex-shrink: 0;
}

.drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: var(--bm-space-lg);
}

.drawer-section {
  margin-bottom: var(--bm-space-xl);
}

.drawer-fields {
  display: flex;
  flex-direction: column;
  gap: var(--bm-space-md);
}

.drawer-field-row {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--bm-space-md);
}

.drawer-field {
  display: flex;
  flex-direction: column;
  gap: var(--bm-space-xs);
}

.drawer-label {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--bm-text-secondary);
}

.drawer-textarea {
  resize: vertical;
  min-height: 120px;
  font-family: var(--bm-font-family);
  line-height: 1.6;
}

.drawer-hint {
  font-size: 0.75rem;
  color: var(--bm-text-muted);
  margin-top: var(--bm-space-sm);
}

.drawer-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--bm-space-md);
  padding: var(--bm-space-md) var(--bm-space-lg);
  border-top: 1px solid var(--bm-border-subtle);
  background: var(--bm-bg-hover);
}

.drawer-footer-right {
  display: flex;
  gap: var(--bm-space-sm);
}

/* Transitions */
.drawer-fade-enter-active,
.drawer-fade-leave-active {
  transition: opacity var(--bm-transition-fast);
}

.drawer-fade-enter-from,
.drawer-fade-leave-to {
  opacity: 0;
}

.drawer-slide-enter-active,
.drawer-slide-leave-active {
  transition: transform var(--bm-transition-fast);
}

.drawer-slide-enter-from,
.drawer-slide-leave-to {
  transform: translateX(100%);
}

.panel-slide-enter-active,
.panel-slide-leave-active {
  transition: opacity 140ms ease;
}

.panel-slide-enter-from,
.panel-slide-leave-to {
  opacity: 0;
}

@media (max-width: 1180px) {
  .task-detail-layer.is-panel { flex-basis: 340px; }
}

@media (max-width: 980px) {
  .task-detail-layer.is-panel {
    position: absolute;
    inset: 0;
    z-index: 10;
    flex-basis: auto;
  }

  .task-detail-drawer.is-panel { border-left: 0; }
}

@media (max-width: 576px) {
  .task-detail-drawer {
    max-width: none;
    border-left: none;
  }

  .drawer-field-row {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .drawer-fade-enter-active,
  .drawer-fade-leave-active,
  .drawer-slide-enter-active,
  .drawer-slide-leave-active,
  .panel-slide-enter-active,
  .panel-slide-leave-active {
    transition: none;
  }
}
</style>
