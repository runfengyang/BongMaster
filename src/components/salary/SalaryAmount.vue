<template>
  <span class="salary-amount">
    <span class="salary-currency">{{ currencySymbol }}</span>
    <span ref="numberEl" class="salary-number">{{ displayText }}</span>
  </span>
</template>

<script setup>
import { computed, onUnmounted, ref, watch } from 'vue'

const props = defineProps({
  value: { type: Number, default: 0 },
  currency: { type: String, default: 'CNY' }
})
const emit = defineEmits(['delta'])

const numberEl = ref(null)
const displayText = ref('')
let displayed = Number(props.value) || 0
let frame = null
let lastChipValue = displayed

const formatter = computed(() => {
  const currency = props.currency || 'CNY'
  try {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
  } catch {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency: 'CNY',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
  }
})

const partsFor = value => formatter.value.formatToParts(value)
const currencySymbol = computed(() => partsFor(props.value).find(part => part.type === 'currency')?.value || '¥')
const numberText = value => partsFor(value)
  .filter(part => part.type !== 'currency')
  .map(part => part.value)
  .join('')

const render = value => {
  displayText.value = numberText(value)
}

render(displayed)

const animateTo = value => {
  if (frame) window.cancelAnimationFrame(frame)
  const from = displayed
  const to = value
  const duration = Math.abs(to - from) >= 1 ? 720 : 460
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    displayed = to
    render(to)
    return
  }
  const startedAt = performance.now()
  const step = now => {
    const progress = Math.min(1, (now - startedAt) / duration)
    const eased = 1 - Math.pow(1 - progress, 3)
    displayed = from + (to - from) * eased
    render(displayed)
    if (progress < 1) {
      frame = window.requestAnimationFrame(step)
    } else {
      displayed = to
      render(to)
      frame = null
    }
  }
  frame = window.requestAnimationFrame(step)
}

watch(() => props.value, value => {
  if (!Number.isFinite(value)) return
  if (value > lastChipValue && value - lastChipValue >= 0.25 && value - lastChipValue <= 20) {
    emit('delta', value - lastChipValue)
    lastChipValue = value
  } else if (value < lastChipValue) {
    lastChipValue = value
  }
  animateTo(value)
})

onUnmounted(() => {
  if (frame) window.cancelAnimationFrame(frame)
})
</script>

<style scoped>
.salary-amount {
  display: inline-flex;
  align-items: baseline;
  gap: 3px;
  min-width: 0;
  color: var(--bm-text-primary);
  font-family: var(--bm-font-display);
  font-size: 18px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}

.salary-currency {
  color: var(--bm-accent-blue);
  font-size: 0.58em;
  font-weight: 600;
}

.salary-number {
  display: inline-block;
  min-width: 0;
  white-space: nowrap;
}
</style>
