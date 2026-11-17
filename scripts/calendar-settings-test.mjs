import assert from 'node:assert/strict'
import { createServer } from 'vite'

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
try {
  const { createPinia, setActivePinia } = await server.ssrLoadModule('pinia')
  setActivePinia(createPinia())
  const { useCalendarProSettings } = await server.ssrLoadModule('/src/stores/calendar-pro-settings.js')
  const store = useCalendarProSettings()
  assert.equal(store.settings.weatherLocations.length, 1)
  assert.equal(store.settings.weatherLocation.name, '北京')

  const shanghai = store.addWeatherLocation({ id: 1, name: '上海', latitude: 31.2304, longitude: 121.4737 })
  assert.equal(store.settings.weatherLocations.length, 2)
  assert.equal(store.settings.weatherLocationId, '1')
  assert.equal(store.settings.weatherLocation.name, '上海')

  const duplicate = store.addWeatherLocation({ id: 1, name: '上海', latitude: 31.2304, longitude: 121.4737 })
  assert.equal(duplicate.id, '1')
  assert.equal(store.settings.weatherLocations.length, 2)

  store.addWeatherLocation({ id: 2, name: '深圳', latitude: 22.5431, longitude: 114.0579 })
  assert.equal(store.settings.weatherLocations.length, 3)
  assert.equal(store.settings.weatherLocation.name, '深圳')

  assert.equal(store.removeWeatherLocation('2'), true)
  assert.equal(store.settings.weatherLocation.name, store.settings.weatherLocations[0].name)
  assert.equal(store.settings.weatherLocations.length, 2)

  store.removeWeatherLocation('1')
  assert.equal(store.removeWeatherLocation(store.settings.weatherLocations[0].id), false)
  assert.equal(store.settings.weatherLocations.length, 1)

  store.selectWeatherLocation('beijing')
  assert.equal(store.settings.weatherLocation.name, '北京')

  console.log('Calendar settings tests passed')
} finally {
  await server.close()
}
