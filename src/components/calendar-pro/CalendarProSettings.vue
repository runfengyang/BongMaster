<template>
  <dialog
    ref="dialog"
    class="cp-settings-dialog"
    :class="{ 'is-open': drawerOpen }"
    aria-labelledby="cp-settings-title"
    @close="$emit('close')"
    @click="onBackdropClick"
  >
    <div ref="panel" class="settings-panel" tabindex="-1">
      <header class="settings-header">
        <div>
          <h2 id="cp-settings-title">日历设置</h2>
          <p>显示、天气与标签</p>
        </div>
        <button type="button" class="settings-close" aria-label="关闭" @click="$emit('close')"><i class="fas fa-times" aria-hidden="true"></i></button>
      </header>

      <div class="settings-body">
        <section class="settings-card">
          <h3>显示</h3>
          <label class="settings-row"><span>地区节假日</span><select v-model="settings.region"><option v-for="region in regions" :key="region.id" :value="region.id">{{ region.label }}</option></select></label>
          <p class="settings-hint">已收录年份：{{ coverageText }}</p>
          <label class="settings-row"><span>每周起始</span><select v-model="settings.weekStart"><option value="monday">周一</option><option value="sunday">周日</option></select></label>
          <label class="settings-row"><span>农历格式</span><select v-model="settings.lunarStyle"><option value="day">按日</option><option value="monthDay">月日</option><option value="full">年月日</option></select></label>
          <label class="settings-check"><input v-model="settings.showLunar" type="checkbox"> 显示农历与节气</label>
          <label class="settings-check"><input v-model="settings.showHolidays" type="checkbox"> 显示节假日与调休</label>
          <label class="settings-check"><input v-model="settings.highlightWeekends" type="checkbox"> 周末使用强调色</label>
          <label class="settings-check"><input v-model="settings.showTasks" type="checkbox"> 在日历中显示项目任务</label>
          <label class="settings-check"><input v-model="settings.showReminders" type="checkbox"> 在日历中显示提醒事项</label>
        </section>

        <section class="settings-card">
          <h3>信息条</h3>
          <label class="settings-check"><input v-model="settings.showWeather" type="checkbox"> 天气</label>
          <label class="settings-check"><input v-model="settings.showAlmanac" type="checkbox"> 老黄历</label>
        </section>

        <section class="settings-card">
          <h3>天气城市 <small>最多展示三个；拖动排序，第一个必展示</small></h3>
          <div class="weather-locations">
            <div
              v-for="(location, index) in settings.weatherLocations"
              :key="location.id"
              class="weather-location"
              :class="{ active: location.id === settings.weatherLocationId }"
              @dragover.prevent
              @drop.prevent="dropLocation(index)"
            >
              <span class="weather-drag" draggable="true" title="拖动排序" @dragstart="startDrag(index, $event)" @dragend="endDrag">⠿</span>
              <button type="button" class="weather-location-select" @click="selectLocation(location.id)">
                <span class="weather-location-name">{{ location.name }}</span>
                <span v-if="location.id === settings.weatherLocationId" class="weather-location-active">当前</span>
              </button>
              <button
                type="button"
                class="weather-visibility"
                :class="{ 'is-off': location.showInStrip === false }"
                :disabled="index === 0"
                :title="index === 0 ? '第一个城市必须展示' : (location.showInStrip === false ? '点击展示' : '点击隐藏')"
                @click="toggleLocation(location.id)"
              >{{ index === 0 || location.showInStrip !== false ? '展示' : '不展示' }}</button>
              <button v-if="settings.weatherLocations.length > 1" type="button" class="weather-location-remove" aria-label="删除地点" @click="removeLocation(location.id)">
                <i class="fas fa-times" aria-hidden="true"></i>
              </button>
            </div>
          </div>
          <form class="city-search" @submit.prevent="searchCity">
            <input v-model="cityQuery" aria-label="搜索天气城市" placeholder="搜索并添加城市，例如 上海">
            <button type="submit" :disabled="citySearching">{{ citySearching ? '搜索中…' : '添加' }}</button>
          </form>
          <div v-if="cityResults.length" class="city-results">
            <button v-for="city in cityResults" :key="city.id" type="button" @click="chooseCity(city)">{{ city.displayName }}</button>
          </div>
          <div v-if="cityError" class="city-error">{{ cityError }}</div>
        </section>

        <section class="settings-card">
          <h3>日历标签 <small>右键管理颜色</small></h3>
          <div
            v-for="calendar in calendarStore.calendars"
            :key="calendar.id"
            class="settings-calendar-row"
            @contextmenu.prevent="openCategoryMenu(calendar, $event)"
          >
            <input type="checkbox" :checked="Boolean(calendar.is_visible)" :aria-label="`显示${calendar.name}`" @change="toggleCalendar(calendar)">
            <button type="button" class="settings-calendar-color" :style="{ background: calendar.color }" :aria-label="`${calendar.name}颜色`" @click="openCategoryMenu(calendar, $event)"></button>
            <input
              class="settings-calendar-name"
              :value="calendar.name"
              :readonly="isBuiltin(calendar)"
              :aria-label="`${calendar.name}名称`"
              @change="renameCalendar(calendar, $event.target.value)"
            >
            <button v-if="!isBuiltin(calendar)" type="button" class="settings-calendar-delete" :aria-label="`删除${calendar.name}`" @click="removeCategory(calendar)">
              <i class="fas fa-trash" aria-hidden="true"></i>
            </button>
          </div>
          <form class="settings-add-calendar" @submit.prevent="addCategory">
            <input v-model="newCategoryName" aria-label="新标签名称" placeholder="新标签名称" required>
            <input v-model="newCategoryColor" type="color" aria-label="新标签颜色">
            <button type="submit">添加标签</button>
          </form>
        </section>
      </div>

      <footer class="settings-footer">
        <button type="button" class="reset" @click="reset">恢复默认</button>
        <button type="button" class="done" @click="$emit('close')">完成</button>
      </footer>
    </div>

    <Transition name="cp-menu">
      <div
        v-if="categoryMenu.show"
        class="settings-category-menu"
        :style="{ left: `${categoryMenu.x}px`, top: `${categoryMenu.y}px` }"
        @mousedown.stop
        @click.stop
      >
        <strong>{{ categoryMenu.calendar?.name }}</strong>
        <div class="settings-color-swatches">
          <button v-for="color in palette" :key="color" type="button" :style="{ background: color }" :aria-label="color" @click="setCategoryColor(color)"></button>
          <label class="settings-custom-color">自定义<input type="color" :value="categoryMenu.calendar?.color" @input="setCategoryColor($event.target.value)"></label>
        </div>
        <button type="button" @click="toggleCategoryMenuVisibility">{{ categoryMenu.calendar?.is_visible ? '隐藏标签' : '显示标签' }}</button>
        <button type="button" class="danger" :disabled="!categoryMenu.calendar || isBuiltin(categoryMenu.calendar)" @click="removeCategoryMenu">删除标签</button>
      </div>
    </Transition>
  </dialog>
</template>

<script setup>
import { computed, nextTick, onUnmounted, reactive, ref, watch } from 'vue'
import { useCalendarProSettings } from '@stores/calendar-pro-settings'
import { useCalendarStore } from '@stores/calendar-store'
import { HOLIDAY_REGIONS, getHolidayCoverage } from '@utils/calendar-pro.js'
import { searchWeatherCities } from '../../services/calendar-weather.js'

const props = defineProps({ show: { type: Boolean, default: false } })
const emit = defineEmits(['close'])
const settingsStore = useCalendarProSettings()
const calendarStore = useCalendarStore()
const settings = settingsStore.settings
const regions = HOLIDAY_REGIONS
const coverageText = computed(() => {
  const coverage = getHolidayCoverage(settings.region)
  return coverage ? `${coverage.min}–${coverage.max}` : '无'
})
const dialog = ref(null)
const panel = ref(null)
const drawerOpen = ref(false)
let closeTimer = null
const cityQuery = ref('')
const cityResults = ref([])
const cityError = ref('')
const citySearching = ref(false)
watch(() => props.show, async visible => {
  if (visible) {
    if (closeTimer) {
      window.clearTimeout(closeTimer)
      closeTimer = null
    }
    await nextTick()
    if (dialog.value && !dialog.value.open) dialog.value.showModal()
    panel.value?.focus()
    requestAnimationFrame(() => { drawerOpen.value = true })
  } else {
    drawerOpen.value = false
    if (dialog.value?.open) {
      closeTimer = window.setTimeout(() => {
        dialog.value?.close()
        closeTimer = null
      }, 220)
    }
  }
})
onUnmounted(() => { if (closeTimer) window.clearTimeout(closeTimer) })
const onBackdropClick = event => {
  if (event.target === dialog.value) emit('close')
}
const searchCity = async () => {
  citySearching.value = true
  cityError.value = ''
  try {
    cityResults.value = await searchWeatherCities(cityQuery.value)
    if (!cityResults.value.length) cityError.value = '没有找到匹配城市'
  } catch (err) {
    cityError.value = err.message
  } finally { citySearching.value = false }
}
const chooseCity = city => {
  if (!settingsStore.addWeatherLocation(city)) return
  cityResults.value = []
  cityQuery.value = ''
}
const selectLocation = id => settingsStore.selectWeatherLocation(id)
const removeLocation = id => settingsStore.removeWeatherLocation(id)
const toggleLocation = id => settingsStore.toggleWeatherLocation(id)
const dragIndex = ref(null)
const startDrag = (index, event) => {
  dragIndex.value = index
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', String(index))
}
const dropLocation = index => {
  if (dragIndex.value === null) return
  settingsStore.moveWeatherLocation(dragIndex.value, index)
  dragIndex.value = null
}
const endDrag = () => { dragIndex.value = null }
const toggleCalendar = calendar => calendarStore.saveCalendar({ id: calendar.id, is_visible: !calendar.is_visible })
const palette = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#007aff', '#af52de', '#a2845e']
const builtinCategories = ['日程', '课程', '提醒事项']
const isBuiltin = calendar => builtinCategories.includes(calendar?.name)
const newCategoryName = ref('')
const newCategoryColor = ref('#3b82f6')
const categoryMenu = reactive({ show: false, x: 0, y: 0, calendar: null })
const openCategoryMenu = (calendar, event) => {
  categoryMenu.calendar = calendar
  categoryMenu.x = Math.max(8, Math.min(event.clientX, window.innerWidth - 236))
  categoryMenu.y = Math.max(8, Math.min(event.clientY, window.innerHeight - 190))
  categoryMenu.show = true
}
const closeCategoryMenu = () => { categoryMenu.show = false }
const setCategoryColor = color => {
  const calendar = categoryMenu.calendar
  if (!calendar || !/^#[0-9a-f]{6}$/i.test(color)) return
  calendarStore.saveCalendar({ id: calendar.id, color })
  closeCategoryMenu()
}
const toggleCategoryMenuVisibility = () => {
  const calendar = categoryMenu.calendar
  if (calendar) calendarStore.saveCalendar({ id: calendar.id, is_visible: !calendar.is_visible })
  closeCategoryMenu()
}
const removeCategory = calendar => {
  if (!calendar || isBuiltin(calendar)) return
  if (!window.confirm(`删除标签「${calendar.name}」？其中的日程会移到“日程”。`)) return
  calendarStore.removeCalendar(calendar.id)
}
const removeCategoryMenu = () => {
  const calendar = categoryMenu.calendar
  closeCategoryMenu()
  if (calendar) removeCategory(calendar)
}
const renameCalendar = (calendar, value) => {
  const name = String(value || '').trim()
  if (!name || name === calendar.name || isBuiltin(calendar)) return
  calendarStore.saveCalendar({ id: calendar.id, name })
}
const addCategory = () => {
  const name = newCategoryName.value.trim()
  if (!name) return
  calendarStore.saveCalendar({ name, color: newCategoryColor.value })
  newCategoryName.value = ''
  newCategoryColor.value = '#3b82f6'
}
const onCategoryMenuOutside = event => {
  if (categoryMenu.show && !event.target.closest('.settings-category-menu')) closeCategoryMenu()
}
watch(() => categoryMenu.show, visible => {
  if (visible) document.addEventListener('mousedown', onCategoryMenuOutside, true)
  else document.removeEventListener('mousedown', onCategoryMenuOutside, true)
})
onUnmounted(() => document.removeEventListener('mousedown', onCategoryMenuOutside, true))
const reset = () => settingsStore.reset()
</script>

<style scoped>
.cp-settings-dialog { position: fixed; inset: 0 auto 0 0; left: -430px; width: min(392px, calc(100vw - 40px)); height: 100vh; max-height: none; margin: 0; padding: 0; border: 0; border-right: 1px solid rgb(0 0 0 / 0.12); border-radius: 0 14px 14px 0; background: #fff; color: #1d1d1f; box-shadow: 18px 0 50px rgb(0 0 0 / 0.16); transition: left 220ms cubic-bezier(0.2, 0.8, 0.2, 1); font-family: var(--bm-font-ui); }
.cp-settings-dialog.is-open { left: 0; }
.cp-settings-dialog::backdrop { background: rgb(0 0 0 / 0.18); backdrop-filter: blur(1.5px); }
.settings-panel { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.settings-panel:focus { outline: none; }
.settings-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px 18px 12px; border-bottom: 1px solid #e8e8ed; }
.settings-header h2 { margin: 0; font-size: 19px; font-weight: 650; letter-spacing: -0.01em; }
.settings-header p { margin: 3px 0 0; color: #8e8e93; font-size: 11.5px; }
.settings-close { width: 28px; height: 28px; flex: 0 0 28px; border: 0; border-radius: 50%; background: transparent; color: #8e8e93; font-size: 12px; cursor: pointer; }
.settings-close:hover { background: #f2f2f7; color: #1d1d1f; }
.settings-body { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 14px 16px; display: grid; gap: 10px; background: #fbfbfd; }
.settings-card { display: grid; gap: 9px; padding: 12px; border: 1px solid #ececf1; border-radius: 10px; background: #f7f7f9; }
.settings-card h3 { margin: 0 0 1px; color: #6e6e73; font-size: 12px; font-weight: 600; letter-spacing: 0.01em; }
.settings-card h3 small { margin-left: 6px; color: #a1a1a6; font-size: 10.5px; font-weight: 400; }
.settings-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: #1d1d1f; font-size: 13px; }
.settings-row select { min-width: 140px; }
.settings-row select, .city-search input, .city-search button, .settings-add-calendar input:not([type="color"]) { min-height: 30px; padding: 4px 7px; border: 1px solid #d1d1d6; border-radius: 6px; background: #fff; color: #1d1d1f; font: inherit; font-size: 12.5px; }
.settings-row select:focus, .city-search input:focus, .settings-add-calendar input:focus { outline: 2px solid color-mix(in srgb, #007aff 40%, transparent); outline-offset: 0; border-color: #007aff; }
.settings-hint { margin: -2px 0 0; color: #a1a1a6; font-size: 10.5px; }
.settings-check { display: flex; align-items: center; gap: 7px; color: #1d1d1f; font-size: 13px; }
.settings-check input, .settings-calendar-row input[type="checkbox"] { width: 14px; height: 14px; accent-color: #007aff; }
.settings-calendar-row { display: flex; align-items: center; gap: 7px; min-height: 30px; padding: 2px 4px; border-radius: 6px; }
.settings-calendar-row:hover { background: #ececf1; }
.settings-calendar-color { width: 14px; height: 14px; flex: 0 0 14px; padding: 0; border: 0; border-radius: 50%; cursor: pointer; }
.settings-calendar-name { min-width: 0; flex: 1; border: 0; background: transparent; color: #1d1d1f; font: inherit; font-size: 13px; }
.settings-calendar-name[readonly] { cursor: default; }
.settings-calendar-name:focus { outline: 2px solid color-mix(in srgb, #007aff 40%, transparent); outline-offset: 2px; border-radius: 4px; }
.settings-calendar-delete { width: 24px; height: 24px; border: 0; border-radius: 5px; background: transparent; color: #a1a1a6; cursor: pointer; }
.settings-calendar-delete:hover { color: #ff3b30; background: #fff; }
.settings-add-calendar { display: flex; align-items: center; gap: 5px; margin-top: 3px; }
.settings-add-calendar input:not([type="color"]) { flex: 1; }
.settings-add-calendar input[type="color"] { width: 26px; height: 26px; padding: 0; border: 0; border-radius: 50%; background: transparent; }
.settings-add-calendar button { min-height: 30px; padding: 0 10px; border: 1px solid #d1d1d6; border-radius: 6px; background: #fff; color: #007aff; font: inherit; font-size: 12px; cursor: pointer; }
.settings-add-calendar button:hover { background: #007aff; border-color: #007aff; color: #fff; }
.weather-locations { display: grid; gap: 4px; }
.weather-location { display: flex; align-items: center; gap: 4px; }
.weather-drag { width: 16px; flex: 0 0 16px; color: #b0b0b5; font-size: 13px; text-align: center; cursor: grab; user-select: none; }
.weather-drag:active { cursor: grabbing; }
.weather-location-select { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 6px; min-height: 30px; padding: 4px 8px; border: 1px solid #e1e1e6; border-radius: 6px; background: #fff; color: #1d1d1f; font: inherit; font-size: 12.5px; text-align: left; cursor: pointer; }
.weather-location.active .weather-location-select { border-color: color-mix(in srgb, #007aff 40%, #e1e1e6); background: color-mix(in srgb, #007aff 4%, #fff); }
.weather-location-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.weather-location-active { color: #8e8e93; font-size: 10px; flex: 0 0 auto; }
.weather-visibility { min-width: 46px; min-height: 26px; padding: 0 4px; border: 0; border-radius: 5px; background: transparent; color: #007aff; font: inherit; font-size: 11.5px; cursor: pointer; }
.weather-visibility:hover:not(:disabled) { background: color-mix(in srgb, #007aff 8%, #fff); }
.weather-visibility.is-off { color: #a1a1a6; }
.weather-visibility:disabled { color: #007aff; cursor: default; }
.weather-location-remove { width: 26px; height: 26px; border: 0; border-radius: 5px; background: transparent; color: #a1a1a6; cursor: pointer; }
.weather-location-remove:hover { color: #ff3b30; background: #fff; }
.city-search { display: flex; gap: 6px; }
.city-search input { flex: 1; }
.city-search button { min-width: 52px; cursor: pointer; }
.city-search button:disabled { opacity: 0.6; cursor: default; }
.city-results { display: grid; gap: 3px; }
.city-results button { min-height: 28px; padding: 4px 8px; border: 0; border-radius: 5px; background: #fff; color: #1d1d1f; font: inherit; font-size: 12px; text-align: left; cursor: pointer; }
.city-results button:hover { background: #007aff; color: #fff; }
.city-error { color: #ff3b30; font-size: 11px; }
.settings-footer { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-top: 1px solid #e8e8ed; background: #fff; }
.settings-footer button { min-height: 32px; padding: 0 14px; border-radius: 7px; font: inherit; font-size: 13px; cursor: pointer; }
.reset { border: 0; background: transparent; color: #8e8e93; }
.reset:hover { color: #1d1d1f; }
.done { border: 1px solid #007aff; background: #007aff; color: #fff; }
.done:hover { background: #0a6fdb; }
.settings-category-menu { position: fixed; z-index: 1400; width: max-content; min-width: 160px; max-width: 240px; padding: 5px; border: 1px solid rgb(0 0 0 / 0.12); border-radius: 10px; background: rgb(255 255 255 / 0.97); box-shadow: 0 12px 34px rgb(0 0 0 / 0.18), 0 2px 8px rgb(0 0 0 / 0.08); backdrop-filter: blur(18px); display: grid; gap: 4px; font-family: var(--bm-font-ui); transform-origin: top left; }
.settings-category-menu strong { padding: 2px 6px 3px; color: #1d1d1f; font-size: 11.5px; font-weight: 600; }
.settings-color-swatches { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 2px 5px 5px; }
.settings-color-swatches button { width: 16px; height: 16px; padding: 0; border: 0; border-radius: 50%; cursor: pointer; box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.08); }
.settings-custom-color { display: flex; align-items: center; gap: 4px; color: #6e6e73; font-size: 12px; }
.settings-custom-color input { width: 22px; height: 22px; padding: 0; border: 0; background: transparent; }
.settings-category-menu > button { min-height: 29px; padding: 0 9px; border: 0; border-radius: 5px; background: transparent; color: #1d1d1f; font-size: 13px; font-weight: 400; text-align: left; white-space: nowrap; cursor: pointer; }
.settings-category-menu > button:hover:not(:disabled) { background: #007aff; color: #fff; }
.settings-category-menu > button.danger { color: #ff3b30; }
.settings-category-menu > button:disabled { color: #b0b0b5; cursor: default; }
.settings-category-menu > button.danger:hover:not(:disabled) { background: #ff3b30; color: #fff; }
.cp-menu-enter-active, .cp-menu-leave-active { transition: opacity 120ms ease, transform 120ms ease; }
.cp-menu-enter-from, .cp-menu-leave-to { opacity: 0; transform: scale(0.96) translateY(-3px); }
button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--bm-accent-blue); outline-offset: 2px; }
</style>
