<template>
  <div class="salary-bar" role="group" aria-label="实时收入">
    <button
      ref="openButtonRef"
      type="button"
      class="salary-bar-open"
      :aria-label="openAriaLabel"
      :aria-expanded="panelOpen"
      :title="openTitle"
      commandfor="salary-panel"
      command="toggle-popover"
    >
      <span v-if="!salaryStore.hasSettings" class="salary-bar-empty">设置收入</span>
      <span v-else-if="salaryStore.privateMode" class="salary-bar-masked">{{ maskedText }}</span>
      <span v-else-if="calcError" class="salary-bar-empty">—</span>
      <span v-else class="salary-bar-amount">
        <span class="salary-bar-label">{{ periodLabel }}收入</span>
        <SalaryAmount :value="periodAmount" :currency="salaryStore.settings?.currency" @delta="onSalaryDelta" />
      </span>
    </button>

    <Transition name="salary-delta">
      <span v-if="salaryDelta > 0" :key="salaryDeltaKey" class="salary-bar-delta">+{{ formatMoney(salaryDelta) }}</span>
    </Transition>

    <button
      v-if="salaryStore.hasSettings"
      type="button"
      class="salary-bar-toggle"
      :title="toggleTitle"
      :aria-label="toggleTitle"
      @click="salaryStore.cyclePeriod()"
    >
      <span aria-hidden="true">↻</span>
    </button>

    <button
      type="button"
      class="salary-bar-hide"
      title="隐藏收入条"
      aria-label="隐藏收入条"
      @click="hideBar"
    >
      <span aria-hidden="true">×</span>
    </button>
  </div>

  <Teleport to="body">
    <div
      id="salary-panel"
      ref="panelRef"
      class="salary-panel"
      popover="auto"
      role="region"
      aria-label="收入设置"
      tabindex="-1"
      @toggle="onPanelToggle"
    >
      <div class="salary-panel-head">
        <h2 class="salary-panel-title">收入</h2>
        <button
          type="button"
          class="salary-panel-close"
          title="关闭"
          aria-label="关闭收入面板"
          @click="closePanel"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>

      <p v-if="salaryStore.storageError" class="salary-alert" role="status">
        {{ salaryStore.storageError }}
      </p>

      <template v-if="salaryStore.hasSettings">
        <dl class="salary-summary">
          <div class="salary-summary-item">
            <dt>{{ periodLabel }}收入估算</dt>
            <dd class="salary-mono">{{ salaryStore.privateMode ? '••••' : formatMoney(periodAmount) }}</dd>
          </div>
          <div class="salary-summary-item">
            <dt>每秒收入</dt>
            <dd class="salary-mono">{{ salaryStore.privateMode ? '••••' : formatMoney(snapshot.perSecond) }}</dd>
          </div>
          <div class="salary-summary-item">
            <dt>工作状态</dt>
            <dd>{{ statusLabel }}</dd>
          </div>
        </dl>

        <SalaryCharts
          class="salary-charts-panel"
          :daily="chartDaily"
          :currency="salaryStore.settings?.currency"
          :private-mode="salaryStore.privateMode"
        />

        <p v-if="salaryStore.privateMode" class="salary-hint">隐私模式已开启，金额已隐藏。</p>
      </template>

      <p v-else class="salary-hint">还未设置收入，填写下面的信息后收入条会实时显示。</p>

      <label class="salary-check">
        <input
          type="checkbox"
          :checked="salaryStore.privateMode"
          @change="onPrivateChange"
        />
        <span>隐私模式（隐藏金额）</span>
      </label>

      <button
        type="button"
        class="salary-edit-toggle"
        :aria-expanded="editOpen"
        @click="toggleEdit"
      >
        {{ editOpen ? '收起设置' : '编辑设置' }}
      </button>

      <form
        v-if="editOpen"
        id="salary-form"
        class="salary-form"
        novalidate
        @submit.prevent="save"
      >
        <div class="salary-form-row">
          <label class="salary-field">
            <span class="salary-field-label">月薪</span>
            <input
              v-model.number="draft.amount"
              class="bm-form-control salary-mono"
              type="number"
              inputmode="decimal"
              min="0"
              step="0.01"
              required
            />
          </label>

          <label class="salary-field">
            <span class="salary-field-label">币种</span>
            <select v-model="draft.currency" class="bm-form-control">
              <option v-for="item in SALARY_CURRENCIES" :key="item.value" :value="item.value">
                {{ item.label }}
              </option>
            </select>
          </label>
        </div>

        <p v-if="formError" class="salary-alert salary-alert-strong" role="alert">{{ formError }}</p>

        <div class="salary-form-actions">
          <button type="button" class="bm-btn bm-btn-ghost" @click="cancelEdit">取消</button>
          <button type="submit" class="bm-btn bm-btn-primary">保存</button>
        </div>
      </form>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { DEFAULT_SALARY_SETTINGS, calculateSalarySnapshot } from '@utils/salary-calculator'
import { buildSalaryDaily } from '@utils/salary-chart-data.js'
import { SALARY_CURRENCIES, SALARY_PERIODS, useSalaryStore } from '@stores/salary-store'
import { useWorkAttendanceStore } from '@stores/work-attendance-store'
import SalaryCharts from '@components/salary/SalaryCharts.vue'
import SalaryAmount from '@components/salary/SalaryAmount.vue'

const STATUS_LABELS = {
  off: '未打卡',
  working: '工作中',
  break: '已暂停',
  after: '已完成'
}

const PERIOD_LABELS = {
  day: '本日',
  week: '本周',
  month: '本月'
}

const PERIOD_AMOUNT_KEYS = {
  day: 'earned',
  week: 'weeklyEarned',
  month: 'monthlyEarned'
}

const EMPTY_SNAPSHOT = {
  earned: 0,
  weeklyEarned: 0,
  monthlyEarned: 0,
  regularEarned: 0,
  overtimeEarned: 0,
  workedSeconds: 0,
  perSecond: 0,
  isWorkday: false,
  status: 'off'
}

const salaryStore = useSalaryStore()
const workStore = useWorkAttendanceStore()
const panelRef = ref(null)
const openButtonRef = ref(null)
const panelOpen = ref(false)
const salaryDelta = ref(0)
const salaryDeltaKey = ref(0)
let salaryDeltaTimer = null
const snapshot = ref({ ...EMPTY_SNAPSHOT })
const chartDaily = ref([])
const calcError = ref('')
const formError = ref('')
const editOpen = ref(false)
const draft = ref(createDraft())

let ticker = null
let dashboardTask = null
let lastDashboardAt = 0

const statusLabel = computed(() => STATUS_LABELS[snapshot.value.status] || '—')

const periodLabel = computed(() => PERIOD_LABELS[salaryStore.period] || PERIOD_LABELS.day)

const nextPeriodLabel = computed(() => {
  const index = SALARY_PERIODS.indexOf(salaryStore.period)
  return PERIOD_LABELS[SALARY_PERIODS[(index + 1) % SALARY_PERIODS.length]]
})

const periodAmount = computed(() => {
  const key = PERIOD_AMOUNT_KEYS[salaryStore.period] || 'earned'
  return snapshot.value[key] ?? 0
})



const maskedText = computed(() => `${periodLabel.value}收入 ••••`)

const openAriaLabel = computed(() => {
  if (!salaryStore.hasSettings) return '设置收入'
  if (!salaryStore.privateMode) return null
  return `${periodLabel.value}收入已隐藏，打开收入面板`
})

const openTitle = computed(() => {
  if (!salaryStore.hasSettings) return '设置收入'
  if (salaryStore.period === 'day') return '查看收入（本日）'
  return `查看收入（${periodLabel.value}截至现在）`
})

const toggleTitle = computed(() => `切换收入周期：当前${periodLabel.value}，下一项${nextPeriodLabel.value}`)

const moneyFormatter = computed(() => {
  const currency = salaryStore.settings?.currency || 'CNY'
  try {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
  } catch (error) {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency: 'CNY',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
  }
})

function formatMoney(value) {
  if (!Number.isFinite(value)) return '—'
  return moneyFormatter.value.format(value)
}

function createDraft() {
  const base = salaryStore.settings || DEFAULT_SALARY_SETTINGS
  return { amount: base.amount, currency: base.currency }
}

function refreshSnapshot() {
  const settings = salaryStore.settings
  if (!settings) {
    snapshot.value = { ...EMPTY_SNAPSHOT }
    chartDaily.value = []
    calcError.value = ''
    return
  }

  const now = new Date()
  try {
    snapshot.value = calculateSalarySnapshot(settings, workStore.settings, workStore.records, now)
    chartDaily.value = buildSalaryDaily(workStore.records, settings, workStore.settings, now)
    calcError.value = ''
  } catch (error) {
    calcError.value = '收入计算失败，请检查设置。'
    chartDaily.value = []
  }
}

function startTicker() {
  stopTicker()
  ticker = window.setInterval(refreshSnapshot, 1000)
}

function stopTicker() {
  if (ticker !== null) {
    window.clearInterval(ticker)
    ticker = null
  }
}

function handleVisibilityChange() {
  if (document.hidden) return
  refreshSnapshot()
  syncDashboard()
}

function handleWindowFocus() {
  refreshSnapshot()
  syncDashboard()
}

function loadDashboardData() {
  if (dashboardTask) return dashboardTask
  dashboardTask = workStore.loadDashboard()
    .catch(() => {})
    .finally(() => {
      lastDashboardAt = Date.now()
      dashboardTask = null
    })
  return dashboardTask
}

function syncDashboard() {
  if (Date.now() - lastDashboardAt < 30000) return
  loadDashboardData().then(refreshSnapshot)
}

function closePanel() {
  const panel = panelRef.value
  if (panel?.matches(':popover-open')) panel.hidePopover()
}

function hideBar() {
  closePanel()
  salaryStore.setVisible(false)
}

function onPanelToggle(event) {
  const panel = event.target
  panelOpen.value = event.newState === 'open'

  if (event.newState === 'open') {
    draft.value = createDraft()
    formError.value = ''
    editOpen.value = !salaryStore.hasSettings && !salaryStore.privateMode
    refreshSnapshot()
    syncDashboard()
    nextTick(() => panel.focus({ preventScroll: true }))
    return
  }

  const active = document.activeElement
  if (!active || active === document.body || panel.contains(active)) {
    openButtonRef.value?.focus({ preventScroll: true })
  }
}

function toggleEdit() {
  if (editOpen.value) {
    draft.value = createDraft()
    formError.value = ''
    editOpen.value = false
    return
  }
  draft.value = createDraft()
  formError.value = ''
  editOpen.value = true
}

function onPrivateChange(event) {
  salaryStore.setPrivate(event.target.checked)
  if (event.target.checked) {
    editOpen.value = false
    formError.value = ''
  }
}

function cancelEdit() {
  draft.value = createDraft()
  formError.value = ''
  editOpen.value = false
}

function save() {
  const amount = Number(draft.value.amount)

  if (draft.value.amount === '' || draft.value.amount === null || !Number.isFinite(amount) || amount <= 0) {
    formError.value = '请输入大于 0 的月薪金额。'
    return
  }
  const error = salaryStore.setSettings({ amount, currency: draft.value.currency })
  if (error) {
    formError.value = error
    return
  }

  formError.value = ''
  editOpen.value = false
  refreshSnapshot()
}

watch(() => salaryStore.settings, refreshSnapshot, { deep: true })
watch(() => workStore.records, refreshSnapshot, { deep: true })
watch(() => workStore.settings, refreshSnapshot, { deep: true })

const onSalaryDelta = delta => {
  if (!Number.isFinite(delta) || delta <= 0) return
  salaryDelta.value = delta
  salaryDeltaKey.value += 1
  if (salaryDeltaTimer) window.clearTimeout(salaryDeltaTimer)
  salaryDeltaTimer = window.setTimeout(() => {
    salaryDelta.value = 0
    salaryDeltaTimer = null
  }, 1100)
}

onMounted(async () => {
  refreshSnapshot()
  startTicker()
  document.addEventListener('visibilitychange', handleVisibilityChange)
  window.addEventListener('focus', handleWindowFocus)
  await loadDashboardData()
  refreshSnapshot()
})

onUnmounted(() => {
  stopTicker()
  if (salaryDeltaTimer) window.clearTimeout(salaryDeltaTimer)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  window.removeEventListener('focus', handleWindowFocus)
})
</script>

<style scoped>
.salary-bar {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: auto;
  min-width: 174px;
  max-width: 260px;
  height: 28px;
  overflow: visible;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--bm-radius-md);
}

.salary-bar-open {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 16px;
  overflow: hidden;
  background: transparent;
  border: 0;
  border-radius: var(--bm-radius-md);
  color: var(--bm-text-primary);
  font-family: var(--bm-font-mono);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  text-align: center;
  white-space: nowrap;
  cursor: pointer;
  transition: background var(--bm-transition-fast);
}

.salary-bar-open:hover {
  background: var(--bm-bg-active);
}

.salary-bar-open:focus-visible,
.salary-bar-toggle:focus-visible,
.salary-bar-hide:focus-visible,
.salary-panel-close:focus-visible,
.salary-edit-toggle:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--bm-accent-blue) 54%, transparent);
  outline-offset: -2px;
}

.salary-bar-amount {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: baseline;
  gap: 5px;
  min-width: 0;
}

.salary-bar-label {
  color: var(--bm-text-secondary);
  font-family: var(--bm-font-ui);
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
}

.salary-bar-delta {
  position: absolute;
  top: -8px;
  left: 14px;
  z-index: 3;
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--bm-accent-teal) 10%, var(--bm-bg-card));
  color: var(--bm-accent-teal);
  font-family: var(--bm-font-mono);
  font-size: 9px;
  font-weight: 600;
  line-height: 1.5;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 2px 6px rgba(47, 45, 42, 0.06);
}

.salary-delta-enter-active,
.salary-delta-leave-active {
  transition: opacity 180ms ease, transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.salary-delta-enter-from {
  opacity: 0;
  transform: translateY(5px) scale(0.9);
}

.salary-delta-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(1);
}

.salary-bar-masked {
  letter-spacing: 2px;
  color: var(--bm-text-secondary);
}

.salary-bar-empty {
  color: var(--bm-text-secondary);
  font-family: var(--bm-font-family);
  font-size: 0.75rem;
}

.salary-bar-toggle,
.salary-bar-hide {
  position: absolute;
  top: 50%;
  z-index: 2;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: transparent;
  border: 0;
  border-radius: var(--bm-radius-sm);
  color: var(--bm-text-tertiary);
  font-family: var(--bm-font-mono);
  font-size: 0.8125rem;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transform: translateY(-50%);
  transition: opacity var(--bm-transition-fast), background var(--bm-transition-fast), color var(--bm-transition-fast);
}

.salary-bar-toggle {
  left: 2px;
}

.salary-bar-hide {
  right: 2px;
  font-size: 0.9375rem;
}

.salary-bar:hover .salary-bar-toggle,
.salary-bar:hover .salary-bar-hide,
.salary-bar:focus-within .salary-bar-toggle,
.salary-bar:focus-within .salary-bar-hide {
  opacity: 1;
  pointer-events: auto;
}

.salary-bar-toggle:hover,
.salary-bar-hide:hover {
  background: var(--bm-bg-active);
  color: var(--bm-text-primary);
}

@media (hover: none) {
  .salary-bar-toggle,
  .salary-bar-hide {
    opacity: 1;
    pointer-events: auto;
  }
}

.salary-panel {
  position: fixed;
  inset: auto;
  top: calc(var(--bm-navbar-height) + 8px);
  right: 24px;
  width: min(336px, calc(100vw - 24px));
  height: auto;
  max-height: calc(100dvh - var(--bm-navbar-height) - 24px);
  overflow: auto;
  margin: 0;
  padding: var(--bm-space-lg);
  background: var(--bm-bg-card);
  color: var(--bm-text-primary);
  border: 1px solid var(--bm-border-default);
  border-radius: var(--bm-radius-md);
  box-shadow: var(--bm-shadow-md);
  font-family: var(--bm-font-family);
  font-size: 0.875rem;
  z-index: 1100;
}

.salary-panel:focus,
.salary-panel:focus-visible {
  outline: none;
}

.salary-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--bm-space-sm);
  margin-bottom: var(--bm-space-md);
}

.salary-panel-title {
  font-family: var(--bm-font-heading);
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--bm-text-primary);
}

.salary-panel-close {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 0;
  border-radius: var(--bm-radius-sm);
  color: var(--bm-text-muted);
  font-size: 0.9375rem;
  line-height: 1;
  cursor: pointer;
  transition: background var(--bm-transition-fast), color var(--bm-transition-fast);
}

.salary-panel-close:hover {
  background: var(--bm-bg-hover);
  color: var(--bm-text-primary);
}

.salary-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--bm-space-sm);
  margin-bottom: var(--bm-space-sm);
  padding: 10px 12px;
  border: 1px solid var(--bm-border-subtle);
  border-radius: var(--bm-radius-md);
}

.salary-summary-item dt {
  margin-bottom: 2px;
  color: var(--bm-text-muted);
  font-size: 0.6875rem;
}

.salary-summary-item dd {
  margin: 0;
  overflow: hidden;
  color: var(--bm-text-primary);
  font-size: 0.8125rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.salary-mono {
  font-family: var(--bm-font-mono);
  font-variant-numeric: tabular-nums;
}

.salary-charts-panel {
  display: block;
  margin: 16px 0 14px;
}

.salary-hint {
  margin-bottom: var(--bm-space-md);
  color: var(--bm-text-muted);
  font-size: 0.75rem;
  line-height: 1.5;
}

.salary-alert {
  margin-bottom: var(--bm-space-md);
  padding: 8px 10px;
  background: color-mix(in srgb, var(--bm-accent-orange) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--bm-accent-orange) 34%, transparent);
  border-radius: var(--bm-radius-sm);
  color: var(--bm-text-secondary);
  font-size: 0.75rem;
  line-height: 1.5;
}

.salary-alert-strong {
  color: var(--bm-accent-red);
  border-color: color-mix(in srgb, var(--bm-accent-red) 38%, transparent);
  background: color-mix(in srgb, var(--bm-accent-red) 8%, transparent);
}

.salary-check {
  display: flex;
  align-items: center;
  gap: var(--bm-space-sm);
  margin-bottom: var(--bm-space-md);
  color: var(--bm-text-secondary);
  font-size: 0.8125rem;
  cursor: pointer;
}

.salary-check input {
  width: 14px;
  height: 14px;
  accent-color: var(--bm-accent-blue);
  cursor: pointer;
}

.salary-edit-toggle {
  width: 100%;
  padding: var(--bm-space-sm) var(--bm-space-md);
  margin-bottom: var(--bm-space-md);
  background: transparent;
  border: 1px solid var(--bm-border-default);
  border-radius: var(--bm-radius-md);
  color: var(--bm-text-secondary);
  font-family: var(--bm-font-family);
  font-size: 0.8125rem;
  text-align: left;
  cursor: pointer;
  transition: all var(--bm-transition-fast);
}

.salary-edit-toggle:hover {
  background: var(--bm-bg-hover);
  color: var(--bm-text-primary);
}

.salary-form-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--bm-space-sm);
}

.salary-field {
  display: block;
  min-width: 0;
  margin-bottom: var(--bm-space-md);
}

.salary-field-label {
  display: block;
  margin-bottom: 4px;
  color: var(--bm-text-muted);
  font-size: 0.75rem;
  font-weight: 500;
  padding: 0;
}

.salary-form-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--bm-space-sm);
}
</style>
