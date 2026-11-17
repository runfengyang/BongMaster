<template>
  <dialog ref="dialog" class="cp-weather-dialog" closedby="any" aria-labelledby="cp-weather-title" @close="$emit('close')">
    <header class="dialog-header">
      <div>
        <h2 id="cp-weather-title">{{ location.name }} 天气</h2>
        <p>Open-Meteo · 逐日预报</p>
      </div>
      <button type="button" class="dialog-close" aria-label="关闭" @click="dialog?.close()"><i class="fas fa-times" aria-hidden="true"></i></button>
    </header>
    <div class="weather-body">
      <div v-if="loading" class="weather-state">天气读取中…</div>
      <div v-else-if="error" class="weather-state">{{ error }}</div>
      <template v-else-if="weather">
        <div class="weather-current">
          <i :class="weather.current.icon" aria-hidden="true"></i>
          <strong>{{ weather.current.temperature }}°</strong>
          <div><span>{{ weather.current.description }}</span><small>体感 {{ weather.current.apparent }}° · 湿度 {{ weather.current.humidity }}% · 风速 {{ weather.current.windSpeed }} km/h</small></div>
        </div>
        <div class="weather-days">
          <div v-for="day in weather.days" :key="day.date" class="weather-day">
            <span>{{ format(parseISO(day.date), 'M月d日') }}</span>
            <i :class="day.icon" aria-hidden="true"></i>
            <strong>{{ day.high }}° / {{ day.low }}°</strong>
            <small>{{ day.description }}</small>
            <em v-if="day.precipitationProbability !== null">降水 {{ day.precipitationProbability }}%</em>
          </div>
        </div>
      </template>
    </div>
  </dialog>
</template>

<script setup>
import { nextTick, ref, watch } from 'vue'
import { format, parseISO } from 'date-fns'
import { fetchWeatherForecast } from '../../services/calendar-weather.js'

const props = defineProps({
  show: { type: Boolean, default: false },
  location: { type: Object, required: true }
})
defineEmits(['close'])
const dialog = ref(null)
const weather = ref(null)
const loading = ref(false)
const error = ref('')
let request = 0
const load = async () => {
  const current = ++request
  loading.value = true
  error.value = ''
  try {
    const result = await fetchWeatherForecast(props.location)
    if (current === request) weather.value = result
  } catch (err) {
    if (current === request) error.value = err.message
  } finally {
    if (current === request) loading.value = false
  }
}
watch(() => props.show, async visible => {
  if (visible) {
    load()
    await nextTick()
    if (dialog.value && !dialog.value.open) dialog.value.showModal()
  } else if (dialog.value?.open) dialog.value.close()
})
watch(() => props.location?.id, () => { if (props.show) load() })
</script>

<style scoped>
.cp-weather-dialog { width: min(640px, calc(100vw - 32px)); max-height: calc(100vh - 56px); padding: 0; border: 1px solid var(--bm-border-default); border-radius: 14px; background: var(--bm-bg-card); color: var(--bm-text-primary); box-shadow: var(--bm-shadow-lg); }
.cp-weather-dialog::backdrop { background: rgb(0 0 0 / 0.26); backdrop-filter: blur(3px); }
.dialog-header { display: flex; align-items: flex-start; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--bm-border-subtle); }
.dialog-header h2 { margin: 0 0 3px; font-size: 18px; }
.dialog-header p { margin: 0; color: var(--bm-text-muted); font-size: 10px; }
.dialog-close { width: 30px; height: 30px; border: 0; border-radius: 50%; background: transparent; color: var(--bm-text-secondary); cursor: pointer; }
.weather-body { padding: 16px 20px 20px; overflow-y: auto; max-height: calc(100vh - 150px); }
.weather-state { padding: 40px; text-align: center; color: var(--bm-text-muted); font-size: 12px; }
.weather-current { display: flex; align-items: center; gap: 12px; padding: 14px; border-radius: 10px; background: linear-gradient(135deg, rgba(39, 112, 204, 0.09), rgba(217, 154, 18, 0.07)); }
.weather-current > i { font-size: 28px; color: #2e70b7; }
.weather-current strong { font-size: 30px; }
.weather-current div { display: grid; gap: 2px; }
.weather-current span { font-size: 12px; font-weight: 600; }
.weather-current small { color: var(--bm-text-secondary); font-size: 10px; }
.weather-days { display: grid; gap: 6px; margin-top: 12px; }
.weather-day { display: grid; grid-template-columns: 60px 24px 80px 1fr auto; align-items: center; gap: 8px; padding: 8px 6px; border-bottom: 1px solid var(--bm-border-subtle); font-size: 11px; }
.weather-day i { color: #2e70b7; }
.weather-day strong { font-variant-numeric: tabular-nums; }
.weather-day small { color: var(--bm-text-secondary); }
.weather-day em { color: #245f9e; font-style: normal; font-size: 10px; }
button:focus-visible { outline: 2px solid var(--bm-accent-blue); outline-offset: 2px; }
</style>
