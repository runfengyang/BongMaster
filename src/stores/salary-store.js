import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { validateSalarySettings } from '@utils/salary-calculator'

export const SALARY_STORAGE_KEY = 'bongmaster-salary'
export const SALARY_PERIODS = ['day', 'week', 'month']
export const SALARY_CURRENCIES = [
  { value: 'CNY', label: '人民币 CNY' },
  { value: 'USD', label: '美元 USD' },
  { value: 'EUR', label: '欧元 EUR' },
  { value: 'HKD', label: '港币 HKD' }
]

const STORAGE_ERROR = '本地存储不可用：设置只在本次会话生效，重启后会丢失。'

function sanitizeSettings(raw) {
  if (!raw || typeof raw !== 'object' || validateSalarySettings(raw)) return null
  return { amount: raw.amount, currency: raw.currency }
}

function loadState() {
  const state = { visible: true, privateMode: false, period: 'day', settings: null, storageError: '' }
  let raw = null
  try {
    raw = localStorage.getItem(SALARY_STORAGE_KEY)
  } catch {
    return { ...state, storageError: STORAGE_ERROR }
  }
  if (!raw) return state
  try {
    const payload = JSON.parse(raw)
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return state
    return {
      visible: typeof payload.visible === 'boolean' ? payload.visible : true,
      privateMode: payload.private === true,
      period: SALARY_PERIODS.includes(payload.period) ? payload.period : 'day',
      settings: sanitizeSettings(payload.settings),
      storageError: ''
    }
  } catch {
    return state
  }
}

export const useSalaryStore = defineStore('salary', () => {
  const initial = loadState()
  const visible = ref(initial.visible)
  const privateMode = ref(initial.privateMode)
  const period = ref(initial.period)
  const settings = ref(initial.settings)
  const storageError = ref(initial.storageError)
  const hasSettings = computed(() => settings.value !== null)

  function persist() {
    try {
      localStorage.setItem(SALARY_STORAGE_KEY, JSON.stringify({
        visible: visible.value,
        private: privateMode.value,
        period: period.value,
        settings: settings.value
      }))
      if (storageError.value) storageError.value = ''
    } catch {
      storageError.value = STORAGE_ERROR
    }
  }

  watch([visible, privateMode, period, settings], persist, { flush: 'sync' })

  function setVisible(next) {
    visible.value = Boolean(next)
  }
  function setPrivate(next) {
    privateMode.value = Boolean(next)
  }
  function setPeriod(next) {
    if (SALARY_PERIODS.includes(next)) period.value = next
  }
  function cyclePeriod() {
    const index = SALARY_PERIODS.indexOf(period.value)
    period.value = SALARY_PERIODS[(index + 1) % SALARY_PERIODS.length]
  }
  function setSettings(next) {
    const error = validateSalarySettings(next)
    if (error) return error
    settings.value = { amount: next.amount, currency: next.currency }
    return null
  }
  function clearStorageError() {
    storageError.value = ''
  }

  return {
    visible, privateMode, period, settings, storageError, hasSettings,
    setVisible, setPrivate, setPeriod, cyclePeriod, setSettings, clearStorageError
  }
})
