import { defineStore } from 'pinia'
import { computed, reactive, watch } from 'vue'

const STORAGE_KEY = 'bongmaster-calendar-pro-settings'
const normalizeLocation = city => {
  const latitude = Number(city?.latitude)
  const longitude = Number(city?.longitude)
  const name = city?.name || city?.displayName
  if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  return { id: String(city.id ?? `${latitude},${longitude}`), name, latitude, longitude, showInStrip: city?.showInStrip !== false }
}

export const useCalendarProSettings = defineStore('calendarProSettings', () => {
  const defaultLocations = [{ id: 'beijing', name: '北京', latitude: 39.9042, longitude: 116.4074, showInStrip: true }]
  const defaults = {
    region: 'mainland-cn',
    weekStart: 'monday',
    showLunar: true,
    lunarStyle: 'day',
    showHolidays: true,
    highlightWeekends: true,
    showTasks: true,
    showReminders: true,
    showWeather: true,
    showAlmanac: true,
    weatherLocations: defaultLocations,
    weatherLocationId: 'beijing',
    weatherLocation: { ...defaultLocations[0] }
  }
  let saved = {}
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') } catch {}
  const savedLocations = Array.isArray(saved.weatherLocations)
    ? saved.weatherLocations.map(normalizeLocation).filter(Boolean)
    : []
  const locations = savedLocations.length
    ? savedLocations
    : [normalizeLocation(saved.weatherLocation) || { ...defaultLocations[0] }]
  let visibleCount = 0
  locations.forEach((item, index) => {
    if (index === 0) {
      item.showInStrip = true
      visibleCount = 1
    } else if (item.showInStrip !== false) {
      if (visibleCount >= 3) item.showInStrip = false
      else visibleCount += 1
    }
  })
  const activeId = locations.some(item => item.id === String(saved.weatherLocationId))
    ? String(saved.weatherLocationId)
    : locations[0].id
  const active = locations.find(item => item.id === activeId) || locations[0]
  const settings = reactive({
    ...defaults,
    ...saved,
    weatherLocations: locations,
    weatherLocationId: activeId,
    weatherLocation: { name: active.name, latitude: active.latitude, longitude: active.longitude }
  })

  watch(settings, value => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)) } catch {}
  }, { deep: true })

  const syncActive = () => {
    const location = settings.weatherLocations.find(item => item.id === settings.weatherLocationId) || settings.weatherLocations[0]
    if (!location) return
    settings.weatherLocation = { name: location.name, latitude: location.latitude, longitude: location.longitude }
  }
  watch(() => settings.weatherLocationId, syncActive)

  const addWeatherLocation = city => {
    const location = normalizeLocation(city)
    if (!location) return null
    const existing = settings.weatherLocations.find(item =>
      item.id === location.id ||
      (item.latitude === location.latitude && item.longitude === location.longitude)
    )
    if (existing) {
      settings.weatherLocationId = existing.id
      syncActive()
      return existing
    }
    const visible = settings.weatherLocations.filter((item, index) => index === 0 || item.showInStrip !== false)
    if (visible.length >= 3) {
      const removable = [...visible].reverse().find(item => item.id !== settings.weatherLocations[0]?.id)
      if (removable) removable.showInStrip = false
    }
    location.showInStrip = true
    settings.weatherLocations.push(location)
    settings.weatherLocationId = location.id
    syncActive()
    return location
  }

  const removeWeatherLocation = id => {
    if (settings.weatherLocations.length <= 1) return false
    const index = settings.weatherLocations.findIndex(item => item.id === id)
    if (index < 0) return false
    settings.weatherLocations.splice(index, 1)
    if (settings.weatherLocations[0]) settings.weatherLocations[0].showInStrip = true
    if (settings.weatherLocationId === id) settings.weatherLocationId = settings.weatherLocations[0].id
    syncActive()
    return true
  }

  const selectWeatherLocation = id => {
    if (!settings.weatherLocations.some(item => item.id === id)) return
    settings.weatherLocationId = id
    syncActive()
  }

  const moveWeatherLocation = (from, to) => {
    const list = settings.weatherLocations
    const source = Number(from)
    const target = Number(to)
    if (!Number.isInteger(source) || !Number.isInteger(target) || source < 0 || target < 0) return false
    if (source >= list.length || target >= list.length || source === target) return false
    const [item] = list.splice(source, 1)
    list.splice(target, 0, item)
    if (list[0]) list[0].showInStrip = true
    return true
  }

  const toggleWeatherLocation = id => {
    const list = settings.weatherLocations
    const index = list.findIndex(item => item.id === id)
    if (index <= 0) return false
    const item = list[index]
    if (item.showInStrip !== false) {
      item.showInStrip = false
      return true
    }
    const visible = list.filter((entry, entryIndex) => entryIndex === 0 || entry.showInStrip !== false)
    if (visible.length >= 3) {
      const removable = [...visible].reverse().find(entry => entry.id !== list[0].id)
      if (removable) removable.showInStrip = false
    }
    item.showInStrip = true
    return true
  }

  const visibleWeatherLocations = computed(() => {
    const list = settings.weatherLocations || []
    return list.filter((item, index) => (index === 0 || item.showInStrip !== false)).slice(0, 3)
  })

  const update = patch => Object.assign(settings, patch)
  const reset = () => Object.assign(settings, {
    ...defaults,
    weatherLocations: defaultLocations.map(item => ({ ...item })),
    weatherLocation: { ...defaultLocations[0] }
  })

  return { settings, visibleWeatherLocations, update, reset, addWeatherLocation, removeWeatherLocation, selectWeatherLocation, moveWeatherLocation, toggleWeatherLocation }
})
