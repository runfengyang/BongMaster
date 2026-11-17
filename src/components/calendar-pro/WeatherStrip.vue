<template>
  <div class="cp-info-strip cp-weather-strip" role="group" aria-label="天气">
    <button
      v-for="city in visibleLocations"
      :key="city.id"
      type="button"
      class="cp-weather-city"
      :aria-label="`${city.name}天气，点击查看详情`"
      @click="$emit('details', city)"
    >
      <span class="cp-weather-icon"><i :class="stateFor(city.id).weather?.icon || 'fas fa-cloud-sun'" aria-hidden="true"></i></span>
      <span v-if="stateFor(city.id).loading" class="cp-weather-loading">读取中…</span>
      <span v-else-if="stateFor(city.id).error" class="cp-weather-error">暂不可用</span>
      <template v-else-if="stateFor(city.id).weather">
        <strong>{{ stateFor(city.id).weather.temperature }}°</strong>
        <span class="cp-weather-name">{{ city.name }}</span>
      </template>
      <span v-else class="cp-weather-name">{{ city.name }}</span>
    </button>
  </div>
</template>

<script setup>
import { computed, reactive, watch } from 'vue'
import { fetchWeather } from '../../services/calendar-weather.js'

const props = defineProps({
  locations: { type: Array, default: () => [] },
  date: { type: String, required: true }
})
defineEmits(['details'])
const states = reactive({})
const requests = new Map()
const visibleLocations = computed(() => (props.locations || []).slice(0, 3))
const stateFor = id => states[id] || {}

const loadCity = async city => {
  const token = (requests.get(city.id) || 0) + 1
  requests.set(city.id, token)
  states[city.id] = { ...states[city.id], loading: true, error: '' }
  try {
    const result = await fetchWeather(city, props.date)
    if (requests.get(city.id) === token) states[city.id] = { weather: result, loading: false, error: '' }
  } catch (err) {
    if (requests.get(city.id) === token) states[city.id] = { ...states[city.id], loading: false, error: err.message || '天气暂不可用' }
  }
}
watch(
  () => [visibleLocations.value.map(city => city.id).join(','), props.date],
  () => { for (const city of visibleLocations.value) loadCity(city) },
  { immediate: true }
)
</script>

<style scoped>
.cp-info-strip { display: flex; align-items: center; gap: 7px; min-width: 0; padding: 4px 7px; border: 1px solid var(--cp-mac-border, var(--bm-border-subtle)); border-radius: 8px; background: #f5f5f7; }
.cp-weather-strip { padding: 0; overflow: hidden; }
.cp-weather-city { flex: 1 1 0; min-width: 0; display: flex; align-items: center; gap: 5px; padding: 4px 7px; border: 0; border-left: 1px solid var(--bm-border-subtle); background: transparent; color: var(--bm-text-primary); text-align: left; cursor: pointer; }
.cp-weather-city:first-child { border-left: 0; }
.cp-weather-city:hover { background: rgba(39, 112, 204, 0.06); }
.cp-weather-icon { width: 18px; height: 18px; flex: 0 0 auto; display: grid; place-items: center; border-radius: 5px; background: rgba(39, 112, 204, 0.09); color: #2e70b7; font-size: 10px; }
.cp-weather-city strong { flex: 0 0 auto; font-size: 13px; font-variant-numeric: tabular-nums; }
.cp-weather-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--bm-text-secondary); font-size: 11px; }
.cp-weather-loading, .cp-weather-error { color: var(--bm-text-muted); font-size: 10px; }
</style>
