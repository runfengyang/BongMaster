<template>
  <section class="bm-card work-clock-card">
    <div class="work-clock-main">
      <div class="work-clock-left">
        <div class="work-clock-head">
          <h3>今日打卡</h3>
          <span class="work-status" :class="statusClass">{{ statusText }}</span>
          <button type="button" class="work-settings-button" aria-label="工时设置" title="工时设置" @click="$emit('open-settings')"><i class="fas fa-gear" aria-hidden="true"></i></button>
          <button type="button" class="work-link" @click="$emit('open-records')">查看本月</button>
        </div>
        <div class="work-clock-hero">
          <div class="work-clock-time">{{ clockLabel }}</div>
          <div class="work-clock-actions">
            <button v-if="!hasCheckIn" type="button" class="work-action work-action-primary" @click="handleCheckIn">上班打卡</button>
            <template v-else-if="!hasCheckOut">
              <button
                type="button"
                class="work-action work-action-icon"
                :class="{ 'is-paused': isPaused }"
                :title="isPaused ? '恢复计时' : '暂停计时'"
                :aria-label="isPaused ? '恢复计时' : '暂停计时'"
                @click="togglePause"
              ><i class="fas" :class="isPaused ? 'fa-play' : 'fa-pause'" aria-hidden="true"></i></button>
              <button type="button" class="work-action work-action-primary" @click="handleCheckOut">下班打卡</button>
            </template>
            <button v-else type="button" class="work-action work-action-secondary" @click="$emit('open-records')">修改今日</button>
          </div>
        </div>
        <div class="work-clock-date">{{ dateLabel }}</div>

        <div class="work-clock-facts">
          <div><span>上班</span><strong>{{ inLabel }}</strong></div>
          <div><span>下班</span><strong>{{ outLabel }}</strong></div>
          <div><span>工时</span><strong>{{ durationLabel }}</strong></div>
        </div>
        <div class="work-clock-standard">
          标准 {{ store.settings.work_start }}–{{ store.settings.work_end }} · {{ workdayLabel }}
        </div>

        <div class="work-habits">
          <div class="work-habits-head">
            <strong>今日习惯</strong>
            <span>{{ checkedHabitCount }}/{{ todayHabits.length }}</span>
            <router-link to="/habits" class="work-habits-all">全部</router-link>
          </div>
          <div v-if="todayHabits.length" class="work-habit-grid">
            <button
              v-for="habit in visibleHabits"
              :key="habit.id"
              type="button"
              class="work-habit"
              :class="{ 'is-done': isHabitChecked(habit.id) }"
              :title="`${habit.name} · ${isHabitChecked(habit.id) ? '今日已打卡' : '今日未打卡'}`"
              @click="toggleHabit(habit)"
            >
              <span class="work-habit-icon" :style="{ background: habit.color || '#4f66a8' }"><i :class="habit.icon || 'fas fa-circle'" aria-hidden="true"></i></span>
              <span class="work-habit-name">{{ habit.name }}</span>
              <i class="fas work-habit-check" :class="isHabitChecked(habit.id) ? 'fa-check-circle' : 'fa-circle'" aria-hidden="true"></i>
            </button>
          </div>
          <p v-else class="work-habits-empty">还没有习惯</p>
        </div>
        <p v-if="store.error" class="work-clock-error">{{ store.error }}</p>
      </div>

      <div class="work-clock-right">
        <div class="work-trend-head">
          <div class="work-trend-title">
            <strong>{{ trendMode === 'time' ? '近 30 天打卡时间' : '近 30 天实际工时' }}</strong>
            <span v-if="trendMode === 'hours'">日均 {{ averageLabel }}</span>
            <template v-else>
              <span>{{ timeAverageLabel }}</span>
              <span class="work-time-legend"><i class="in"></i>上班 <i class="out"></i>下班</span>
              <span class="work-time-legend"><i class="dash"></i>5 日均线</span>
            </template>
          </div>
          <div class="work-trend-switch">
            <button type="button" :class="{ on: trendMode === 'time' }" @click="trendMode = 'time'">时间</button>
            <button type="button" :class="{ on: trendMode === 'hours' }" @click="trendMode = 'hours'">工时</button>
          </div>
        </div>
        <Transition name="work-chart" mode="out-in">
          <WorkTimeTrend v-if="trendMode === 'time'" key="time" :trend="store.trend" :settings="store.settings" />
          <WorkHoursTrend v-else key="hours" :trend="store.trend" />
        </Transition>
      </div>
    </div>

    <div class="work-clock-bottom">
      <div class="work-clock-stats">
        <span><strong>{{ store.summary.days }}</strong> 出勤</span>
        <span><strong>{{ totalLabel }}</strong> 总工时</span>
        <span><strong>{{ averageLabel }}</strong> 日均</span>
        <span><strong>{{ overtimeLabel }}</strong> 加班</span>
        <span><strong>{{ lateEarlyLabel }}</strong> 迟到 / 早退</span>
        <span><strong>{{ leisureLabel }}</strong> 娱乐</span>
      </div>
      <div class="work-clock-extra">
        <span v-if="weather" class="work-weather"><i :class="weather.icon" aria-hidden="true"></i>{{ weatherLocation?.name }} {{ weather.temperature }}° {{ weather.description }}</span>
        <span v-if="almanacSummary" class="work-almanac" :title="almanacSummary">{{ almanacSummary }}</span>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { useWorkAttendanceStore } from '@stores/work-attendance-store'
import { useCalendarProSettings } from '@stores/calendar-pro-settings'
import { useHabitStore } from '@stores/habit-store'
import { elapsedWorkSeconds, formatWorkClock, formatWorkHours } from '@utils/work-attendance.js'
import WorkHoursTrend from './WorkHoursTrend.vue'
import WorkTimeTrend from './WorkTimeTrend.vue'
import { getCalendarProDay } from '@utils/calendar-pro.js'
import { fetchWeather } from '../../services/calendar-weather.js'

defineEmits(['open-records', 'open-settings'])
const store = useWorkAttendanceStore()
const calendarSettings = useCalendarProSettings()
const habitStore = useHabitStore()
const now = ref(new Date())
const TREND_MODE_KEY = 'bongmaster:work-trend-mode'
const readTrendMode = () => {
  try {
    return localStorage.getItem(TREND_MODE_KEY) === 'hours' ? 'hours' : 'time'
  } catch {
    return 'time'
  }
}
const trendMode = ref(readTrendMode())
watch(trendMode, value => {
  try { localStorage.setItem(TREND_MODE_KEY, value) } catch { /* 本地偏好失败不影响页面 */ }
})
const weather = ref(null)
let timer = null
let weatherRequest = 0
const weatherLocation = computed(() => calendarSettings.visibleWeatherLocations?.[0] || null)
const todayHabits = computed(() => habitStore.activeHabits)
const visibleHabits = computed(() => todayHabits.value.slice(0, 6))
const checkedHabitCount = computed(() => todayHabits.value.filter(habit => isHabitChecked(habit.id)).length)
const isHabitChecked = habitId => habitStore.checkins.some(item => item.habit_id === habitId && item.checkin_date === store.today)
const leisureSeconds = ref(0)
const leisureLabel = computed(() => {
  const seconds = leisureSeconds.value
  const hours = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  if (!hours && !mins) return '0分'
  return hours ? `${hours}h${mins ? String(mins).padStart(2, '0') : ''}` : `${mins}分`
})
const readLeisure = () => {
  try {
    const raw = localStorage.getItem(`bongmaster:entertainment-usage:${store.today}`)
    const value = Number(raw)
    leisureSeconds.value = Number.isFinite(value) && value > 0 ? Math.min(value, 86400) : 0
  } catch {
    leisureSeconds.value = 0
  }
}
const almanacSummary = computed(() => {
  try {
    const day = getCalendarProDay(store.today, store.today, store.today, store.today, calendarSettings.settings.region)
    const recommends = (day.almanac?.recommends || []).slice(0, 3)
    const avoids = (day.almanac?.avoids || []).slice(0, 3)
    const parts = []
    if (recommends.length) parts.push(`宜 ${recommends.join(' · ')}`)
    if (avoids.length) parts.push(`忌 ${avoids.join(' · ')}`)
    return parts.join('　')
  } catch {
    return ''
  }
})
const loadWeather = async () => {
  const location = weatherLocation.value
  if (!location) { weather.value = null; return }
  const request = ++weatherRequest
  try {
    const result = await fetchWeather(location, store.today)
    if (request === weatherRequest) weather.value = result
  } catch {
    if (request === weatherRequest) weather.value = null
  }
}

const clockLabel = computed(() => format(now.value, 'HH:mm:ss'))
const dateLabel = computed(() => format(now.value, 'M月d日 EEEE', { locale: zhCN }))
const hasCheckIn = computed(() => Boolean(store.activeRecord?.check_in_at))
const hasCheckOut = computed(() => Boolean(store.activeRecord?.check_out_at))
const isPaused = computed(() => Boolean(store.activeAttendance?.isPaused))
const isYesterdayOpen = computed(() => Boolean(store.openRecord && store.openRecord.work_date !== store.today))
const statusText = computed(() => !hasCheckIn.value ? '未打卡' : hasCheckOut.value ? '已完成' : isPaused.value ? '已暂停' : isYesterdayOpen.value ? '昨日未下班' : '已上班')
const statusClass = computed(() => !hasCheckIn.value ? 'is-empty' : hasCheckOut.value ? 'is-done' : 'is-working')
const inLabel = computed(() => store.activeAttendance?.checkInTime || '--')
const outLabel = computed(() => store.activeAttendance?.checkOutTime || '--')
const durationLabel = computed(() => {
  if (!hasCheckIn.value) return '--'
  return formatWorkClock(elapsedWorkSeconds(store.activeAttendance, now.value))
})
const workdayLabel = computed(() => {
  const days = String(store.settings.workdays || '1,2,3,4,5').split(',').map(Number)
  if (days.join(',') === '1,2,3,4,5') return '周一至周五'
  const names = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '日' }
  return days.map(day => `周${names[day] || ''}`).join('、')
})
const averageLabel = computed(() => formatWorkHours(store.summary.averageMinutes))
const parseClockMinutes = value => {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/)
  if (!match) return null
  const minutes = Number(match[1]) * 60 + Number(match[2])
  return Number.isFinite(minutes) ? minutes : null
}
const averageClock = key => {
  const values = (store.trend.items || [])
    .map(item => parseClockMinutes(item[key]))
    .filter(value => value !== null)
  if (!values.length) return '--:--'
  const minutes = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}
const timeAverageLabel = computed(() => (
  `平均 ${averageClock('checkInTime')} / ${averageClock('checkOutTime')}`
))
const totalLabel = computed(() => formatWorkHours(store.summary.totalMinutes))
const overtimeLabel = computed(() => formatWorkHours(store.summary.overtimeMinutes))
const lateEarlyLabel = computed(() => `${store.summary.lateCount} / ${store.summary.earlyCount}`)

const handleCheckIn = async () => {
  await store.checkIn()
}
const handleCheckOut = async () => {
  await store.checkOut()
}
const togglePause = async () => {
  if (isPaused.value) await store.resume()
  else await store.pause()
}
const loadHabits = async () => {
  await habitStore.fetchHabits()
  await habitStore.fetchCheckins(store.today, store.today)
}
const toggleHabit = async habit => {
  await habitStore.toggleCheckin(habit.id, store.today, 1)
}

watch([weatherLocation, () => store.today], () => { loadWeather() })
watch(() => store.today, () => { habitStore.fetchCheckins(store.today, store.today); readLeisure() })
onMounted(() => {
  store.loadDashboard()
  loadHabits()
  loadWeather()
  readLeisure()
  window.addEventListener('focus', readLeisure)
  timer = window.setInterval(() => {
    now.value = new Date()
    if (format(now.value, 'yyyy-MM-dd') !== store.today) store.loadDashboard()
  }, 1000)
})
onUnmounted(() => { if (timer) window.clearInterval(timer); window.removeEventListener('focus', readLeisure) })
</script>

<style scoped>
.work-clock-card { padding: 16px 18px; display: grid; gap: 12px; border-color: #e8e2d8; border-radius: 12px; background: #fff; box-shadow: 0 1px 2px rgb(0 0 0 / 0.03); font-family: var(--bm-font-ui); }
.work-clock-card.work-clock-card:hover { transform: none; border-color: #e8e2d8; box-shadow: 0 1px 2px rgb(0 0 0 / 0.03); }
.work-clock-card.work-clock-card:hover::before { opacity: 0; transform: translateX(-18%); }
.work-clock-main { display: grid; grid-template-columns: minmax(260px, 0.85fr) minmax(340px, 1.15fr); gap: 18px; }
.work-clock-left { min-width: 0; padding-right: 18px; border-right: 1px solid #e8e2d8; display: flex; flex-direction: column; }
.work-clock-head { display: flex; align-items: center; gap: 9px; min-height: 24px; }
.work-clock-head h3 { margin: 0; font-size: 15px; font-weight: 600; }
.work-status { padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; }
.work-status.is-empty { background: #f2eee8; color: #6f6a62; }
.work-status.is-working { background: #f6efe4; color: #9a6f3f; }
.work-status.is-done { background: #eef4ee; color: #5c7d5f; }
.work-link { margin-left: auto; padding: 0; border: 0; background: transparent; color: #4f66a8; font-size: 11px; cursor: pointer; }
.work-settings-button { width: 22px; height: 22px; flex: 0 0 22px; display: grid; place-items: center; padding: 0; border: 1px solid #e8e2d8; border-radius: 50%; background: #f7f4ee; color: #9a9389; font-size: 10px; cursor: pointer; }
.work-settings-button:hover { background: #f1ede6; color: #2d2822; }
.work-clock-hero { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
.work-clock-time { font-size: 34px; font-weight: 600; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; line-height: 1.1; }
.work-clock-date { margin-top: 2px; color: #9a9389; font-size: 12px; }
.work-clock-facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin-top: 12px; }
.work-clock-facts div { min-width: 0; padding: 6px 8px; border-radius: 8px; background: #f7f4ee; display: grid; gap: 1px; }
.work-clock-facts span { color: #9a9389; font-size: 10px; }
.work-clock-facts strong { color: #2d2822; font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
.work-clock-standard { margin-top: 5px; color: #a9a29a; font-size: 11px; }
.work-clock-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; padding-top: 2px; }
.work-action { min-height: 34px; padding: 0 16px; border-radius: 8px; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.work-action-icon { width: 34px; min-width: 34px; padding: 0; display: grid; place-items: center; border: 1px solid #e8e2d8; border-radius: 50%; background: #f4f1ea; color: #2d2822; font-size: 12px; }
.work-action-icon:hover { background: #ece7df; }
.work-action-icon.is-paused { border-color: #7a9a7d; background: #eef4ee; color: #5c7d5f; }
.work-action-primary { border: 1px solid #4f66a8; background: #4f66a8; color: #fff; }
.work-action-primary:hover { background: #435a99; }
.work-action-secondary { border: 1px solid #e8e2d8; background: #f4f1ea; color: #2d2822; }
.work-action-secondary:hover { background: #ece7df; }

.work-clock-error { margin: 8px 0 0; color: var(--bm-accent-red); font-size: 11px; }
.work-clock-right { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.work-trend-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.work-trend-title { display: flex; align-items: baseline; gap: 8px; min-width: 0; overflow: hidden; }
.work-trend-head strong { font-size: 12px; white-space: nowrap; }
.work-trend-head span { color: #9a9389; font-size: 10px; white-space: nowrap; }
.work-time-legend { display: inline-flex; align-items: center; gap: 3px; }
.work-time-legend i { width: 5px; height: 5px; border-radius: 50%; display: block; }
.work-time-legend i.in { background: #4364c9; }
.work-time-legend i.out { background: #c97b5a; }
.work-time-legend i.dash { width: 10px; height: 0; border-top: 1.5px dashed #7c8bab; border-radius: 0; background: none; }
.work-trend-switch { margin-left: auto; display: flex; flex: 0 0 auto; padding: 2px; border-radius: 6px; background: #f4f1ea; }
.work-trend-switch button { padding: 2px 7px; border: 0; border-radius: 4px; background: transparent; color: #9a9389; font: inherit; font-size: 10px; line-height: 1.4; cursor: pointer; transition: background 120ms ease, color 120ms ease; }
.work-trend-switch button:hover { color: #2d2822; }
.work-trend-switch button.on { background: #fff; color: #2d2822; font-weight: 600; box-shadow: 0 1px 2px rgb(0 0 0 / 0.08); }
.work-chart-enter-active,
.work-chart-leave-active { transition: opacity 120ms ease, transform 120ms ease; }
.work-chart-enter-from { opacity: 0; transform: translateY(3px); }
.work-chart-leave-to { opacity: 0; }
.work-habits { min-width: 0; margin-top: 10px; padding-top: 8px; border-top: 1px solid #f1ede6; }
.work-habits-head { display: flex; align-items: baseline; gap: 6px; }
.work-habits-head strong { font-size: 11.5px; font-weight: 600; }
.work-habits-head span { color: #9a9389; font-size: 10px; }
.work-habits-all { margin-left: auto; color: #4f66a8; font-size: 10px; text-decoration: none; }
.work-habit-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 3px; padding-top: 5px; }
.work-habit { display: flex; align-items: center; gap: 5px; min-width: 0; min-height: 25px; padding: 2px 5px; border: 1px solid #f1ede6; border-radius: 6px; background: #fbf8f2; color: #2d2822; font: inherit; font-size: 10.5px; text-align: left; cursor: pointer; }
.work-habit:hover { border-color: #e4e7ef; background: #f6f7fb; }
.work-habit.is-done { background: #eef4ee; border-color: #dce8dd; }
.work-habit-icon { filter: saturate(.78); width: 15px; height: 15px; flex: 0 0 15px; display: grid; place-items: center; border-radius: 5px; color: #fff; font-size: 8px; }
.work-habit-name { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.work-habit-check { flex: 0 0 auto; color: #c5bfb5; font-size: 11px; }
.work-habit.is-done .work-habit-check { color: #7a9a7d; }
.work-habits-empty { margin: 5px 0 0; color: #a9a29a; font-size: 10px; }
.work-clock-bottom { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding-top: 9px; border-top: 1px solid #e8e2d8; }
.work-clock-stats { display: flex; flex-wrap: wrap; gap: 6px 14px; }
.work-clock-stats span { color: #9a9389; font-size: 10.5px; }
.work-clock-stats strong { color: #2d2822; font-size: 12.5px; font-weight: 600; font-variant-numeric: tabular-nums; margin-right: 1px; }
.work-clock-extra { margin-left: auto; display: flex; align-items: center; gap: 14px; min-width: 0; max-width: 100%; color: #9a9389; font-size: 10.5px; }
.work-weather { flex: 0 0 auto; color: #6f6a62; white-space: nowrap; }
.work-weather i { margin-right: 4px; color: #4f66a8; }
.work-almanac { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 900px) {
  .work-clock-main { grid-template-columns: 1fr; }
  .work-clock-left { padding-right: 0; padding-bottom: 12px; border-right: 0; border-bottom: 1px solid var(--bm-border-subtle); }
}
</style>
