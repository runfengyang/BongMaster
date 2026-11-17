<template>
  <dialog ref="dialog" class="cp-composer" :class="{ 'is-left': placement === 'left', 'no-arrow': placement === 'center', 'is-closing': closing }" :style="[popoverStyle, { '--cp-composer-color': selectedCalendar?.color || '#3b82f6' }]" aria-labelledby="cp-composer-title" @close="$emit('close')">
    <form @submit.prevent="submit">
      <header class="cp-composer-header">
        <div class="cp-kind-switch" role="tablist" aria-label="类型">
          <button type="button" :aria-pressed="form.kind !== 'reminder'" @click="setKind('event')">日程</button>
          <button type="button" :aria-pressed="form.kind === 'reminder'" @click="setKind('reminder')">提醒事项</button>
        </div>
        <h2 id="cp-composer-title" class="sr-only">{{ form.kind === 'reminder' ? '提醒事项' : '日程' }}</h2>
      </header>
      <div class="cp-composer-body">
        <div class="cp-composer-fields">
        <input v-model="form.title" required autofocus class="cp-title-input" :placeholder="form.kind === 'reminder' ? '新建提醒事项' : '新建日程'">

        <div class="cp-schedule-list">
          <div v-if="form.kind !== 'reminder'" class="cp-schedule-row">
            <span class="cp-schedule-label">全天：</span>
            <label class="cp-schedule-check"><input v-model="form.all_day" type="checkbox"> <span>全天</span></label>
          </div>
          <div class="cp-schedule-row">
            <span class="cp-schedule-label">{{ form.recurrence_type !== 'none' ? '日期：' : '开始时间：' }}</span>
            <span class="cp-schedule-value">
              <button type="button" class="cp-picker-trigger" @click="openDatePicker('start', $event)">{{ formatDateValue(form.start_date) }}</button>
              <button v-if="form.kind !== 'reminder' && !form.all_day" type="button" class="cp-picker-trigger cp-picker-time-trigger" @click="openTimePicker('start', $event)">{{ form.start_time }}</button>
            </span>
          </div>
          <div v-if="form.kind !== 'reminder' && form.recurrence_type === 'none'" class="cp-schedule-row">
            <span class="cp-schedule-label">结束时间：</span>
            <span class="cp-schedule-value">
              <button type="button" class="cp-picker-trigger" @click="openDatePicker('end', $event)">{{ formatDateValue(form.end_date) }}</button>
              <button v-if="!form.all_day" type="button" class="cp-picker-trigger cp-picker-time-trigger" @click="openTimePicker('end', $event)">{{ form.end_time }}</button>
            </span>
          </div>
          <div class="cp-schedule-row">
            <span class="cp-schedule-label">重复：</span>
            <select v-model="form.recurrence_type" class="cp-schedule-select">
              <option value="none">永不</option>
              <option value="daily">每天</option>
              <option value="weekdays">工作日</option>
              <option value="weekly">每周</option>
              <option value="monthly">每月</option>
              <option value="yearly">每年</option>
              <option value="lunarYearly">每年（农历）</option>
            </select>
          </div>
          <div v-if="form.recurrence_type === 'lunarYearly'" class="cp-schedule-row">
            <span class="cp-schedule-label">农历：</span>
            <span class="cp-lunar-value">
              <select v-model.number="lunarMonth" aria-label="农历月份" @change="onLunarChange">
                <option v-for="(label, index) in lunarMonths" :key="index" :value="index + 1">{{ label }}</option>
              </select>
              <select v-model.number="lunarDay" aria-label="农历日期" @change="onLunarChange">
                <option v-for="(label, index) in lunarDays" :key="index" :value="index + 1">{{ label }}</option>
              </select>
            </span>
          </div>
          <input v-model="form.start_date" class="cp-native-input" type="date" required>
          <input v-if="form.kind !== 'reminder' && form.recurrence_type === 'none'" v-model="form.end_date" class="cp-native-input" type="date" :min="form.start_date" required>
          <input v-if="form.kind !== 'reminder' && !form.all_day" v-model="form.start_time" class="cp-native-input" type="time" required>
          <input v-if="form.kind !== 'reminder' && !form.all_day && form.recurrence_type === 'none'" v-model="form.end_time" class="cp-native-input" type="time" required>
        </div>

        <fieldset v-if="form.recurrence_type === 'weekly'" class="cp-weekdays">
          <legend class="sr-only">重复星期</legend>
          <label v-for="day in weekdays" :key="day.value"><input v-model="weeklyDays" type="checkbox" :value="day.value" @change="weeklyManual = true"> {{ day.short }}</label>
        </fieldset>
        <p v-if="recurrenceHint" class="cp-recurrence-hint">{{ recurrenceHint }}</p>

        <label class="cp-calendar-field">
          <span class="cp-calendar-dot" :style="{ background: selectedCalendar?.color || '#3b82f6' }"></span>
          <select v-model="form.calendar_id" aria-label="日历标签">
            <option v-for="calendar in calendars" :key="calendar.id" :value="calendar.id">{{ calendar.name }}</option>
          </select>
        </label>

        <button v-if="meetingLink" type="button" class="cp-join-meeting" @click="openMeeting">
          <i class="fas fa-video" aria-hidden="true"></i> 加入会议
        </button>

        <button type="button" class="cp-more-toggle" :aria-expanded="showMore" @click="showMore = !showMore">
          {{ showMore ? '收起选项' : '更多选项' }}
          <i class="fas" :class="showMore ? 'fa-chevron-up' : 'fa-chevron-down'" aria-hidden="true"></i>
        </button>

        <div v-if="showMore" class="cp-more-body">
          <label v-if="form.recurrence_type !== 'none'" class="cp-field">
            <span>重复截止</span>
            <input v-model="form.recurrence_end_date" type="date" :min="form.start_date">
          </label>
          <label class="cp-field">
            <span>地点</span>
            <input v-model="form.location" placeholder="教室、会议室或链接">
          </label>
          <label class="cp-field">
            <span>备注</span>
            <textarea v-model="form.notes" rows="2" placeholder="补充说明"></textarea>
          </label>
          <label v-if="isRecurring" class="cp-field">
            <span>修改范围</span>
            <select v-model="scope">
              <option value="this">仅此次</option>
              <option value="future">此次及未来</option>
              <option value="all">整个系列</option>
            </select>
          </label>
        </div>
        </div>
      </div>
      <footer class="cp-composer-footer">
        <button v-if="form.id" type="button" class="cp-delete" @click="remove">删除</button>
        <span></span>
        <button type="button" class="cp-secondary" @click="$emit('close')">取消</button>
        <button type="submit" class="cp-primary">保存</button>
      </footer>
    </form>

    <Teleport to="body">
      <Transition name="cp-picker-fade">
        <div
        v-if="picker"
        class="cp-picker-popover"
        :class="{ 'is-time': picker.type === 'time', 'is-right': picker.side === 'right', 'is-left': picker.side === 'left' }"
        :style="{ left: `${picker.left}px`, top: `${picker.top}px`, '--picker-arrow': `${picker.arrow}px` }"
        @mousedown.stop
        @click.stop
      >
        <template v-if="picker.type === 'date'">
          <div class="cp-picker-month">
            <button type="button" class="cp-picker-nav" aria-label="上个月" @click="shiftPickerMonth(-1)"><i class="fas fa-chevron-left" aria-hidden="true"></i></button>
            <strong>{{ pickerMonthLabel }}</strong>
            <button type="button" class="cp-picker-nav" aria-label="下个月" @click="shiftPickerMonth(1)"><i class="fas fa-chevron-right" aria-hidden="true"></i></button>
          </div>
          <div class="cp-picker-weekdays"><span v-for="day in pickerWeekdays" :key="day">{{ day }}</span></div>
          <div class="cp-picker-days">
            <button v-for="day in pickerDays" :key="day.key" type="button" class="cp-picker-day" :class="{ 'is-outside': day.outside, 'is-today': day.today, 'is-selected': day.selected }" @click="choosePickerDate(day.key)">{{ day.day }}</button>
          </div>
        </template>
        <template v-else>
          <button v-for="option in pickerTimeOptions" :key="option.value" type="button" class="cp-picker-time" :class="{ 'is-selected': option.selected }" @click="choosePickerTime(option.value)">{{ option.label }}</button>
        </template>
        </div>
      </Transition>
    </Teleport>
  </dialog>
</template>

<script setup>
import { computed, nextTick, onUnmounted, reactive, ref, watch } from 'vue'
import { addDays, addMonths, format, getDay, getISODay, parseISO, startOfMonth } from 'date-fns'
import { getLunarInfo, meetingLinkFor, solarDateForLunar } from '@utils/calendar-pro.js'

const props = defineProps({
  show: { type: Boolean, default: false },
  event: { type: Object, default: null },
  defaults: { type: Object, default: () => ({}) },
  anchor: { type: Object, default: null },
  calendars: { type: Array, default: () => [] }
})
const emit = defineEmits(['close', 'save', 'delete', 'preview'])
const dialog = ref(null)
const closing = ref(false)
const showMore = ref(false)
let closeTimer = null
let openedAt = 0
const scope = ref('this')
const weeklyManual = ref(false)
const weeklyDays = ref([1])
const POPOVER_WIDTH = 344
const weekdays = [
  { value: 1, short: '一' }, { value: 2, short: '二' }, { value: 3, short: '三' },
  { value: 4, short: '四' }, { value: 5, short: '五' }, { value: 6, short: '六' }, { value: 7, short: '日' }
]
const lunarMonths = ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月']
const lunarDays = ['初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十', '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十', '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十']
const lunarMonth = ref(8)
const lunarDay = ref(13)
const lunarManual = ref(false)
const syncingLunarDate = ref(false)
const syncLunarFromStart = () => {
  try {
    const info = getLunarInfo(form.start_date)
    if (info?.monthNumber && info?.dayNumber) {
      lunarMonth.value = info.monthNumber
      lunarDay.value = info.dayNumber
    }
  } catch {}
}
const onLunarChange = () => {
  lunarManual.value = true
  const startYear = Number(String(form.start_date || todayKey).slice(0, 4))
  const solar = solarDateForLunar(startYear, lunarMonth.value, lunarDay.value)
    || solarDateForLunar(startYear + 1, lunarMonth.value, lunarDay.value)
  if (!solar) return
  syncingLunarDate.value = true
  form.start_date = solar
  form.end_date = solar
  nextTick(() => { syncingLunarDate.value = false })
}
const todayKey = format(new Date(), 'yyyy-MM-dd')
const picker = ref(null)
const pickerMonth = ref(`${todayKey.slice(0, 7)}-01`)
const pickerWeekdays = ['日', '一', '二', '三', '四', '五', '六']
const pickerMonthLabel = computed(() => pickerMonth.value ? format(parseISO(pickerMonth.value), 'yyyy年M月') : '')
const formatDateValue = key => {
  try { return format(parseISO(key), 'yyyy/MM/dd') } catch { return '选择日期' }
}
const parseTimeValue = value => {
  const [hour, minute] = String(value || '00:00').split(':').map(Number)
  return (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0)
}
const timeLabel = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
const durationLabel = minutes => minutes < 60 ? `${minutes}分钟` : `${minutes / 60}小时`
const pickerDays = computed(() => {
  if (!picker.value || picker.value.type !== 'date') return []
  const monthStart = startOfMonth(parseISO(pickerMonth.value))
  const gridStart = addDays(monthStart, -getDay(monthStart))
  const selectedKey = form[`${picker.value.target}_date`]
  return Array.from({ length: 42 }, (_, index) => {
    const date = addDays(gridStart, index)
    const key = format(date, 'yyyy-MM-dd')
    return {
      key,
      day: date.getDate(),
      outside: date.getMonth() !== monthStart.getMonth(),
      today: key === todayKey,
      selected: key === selectedKey
    }
  })
})
const pickerTimeOptions = computed(() => {
  if (!picker.value || picker.value.type !== 'time') return []
  if (picker.value.target === 'start') {
    return Array.from({ length: 48 }, (_, index) => {
      const value = timeLabel(index * 30)
      return { value, label: value, selected: form.start_time === value }
    })
  }
  const start = parseTimeValue(form.start_time)
  const options = []
  for (let delta = 30; delta <= 360; delta += 30) {
    const total = start + delta
    if (total >= 1440) break
    const value = timeLabel(total)
    options.push({ value, label: `${value}  ${durationLabel(delta)}`, selected: form.end_time === value })
  }
  return options
})
const onPickerOutside = event => {
  if (event.target.closest('.cp-picker-popover') || event.target.closest('.cp-picker-trigger')) return
  closePicker()
}
const closePicker = () => {
  picker.value = null
  document.removeEventListener('mousedown', onPickerOutside, true)
}
const positionPicker = (rect, width, height) => {
  const composer = dialog.value?.getBoundingClientRect()
  let left = (composer?.right ?? rect.right) + 8
  let side = 'right'
  if (left + width > window.innerWidth - 8) {
    left = (composer?.left ?? rect.left) - width - 8
    side = 'left'
  }
  left = Math.max(8, left)
  const top = Math.max(8, Math.min(rect.top - 4, window.innerHeight - height - 8))
  const arrow = Math.max(16, Math.min(rect.top - top + rect.height / 2 - 5, height - 24))
  return { left, top, side, arrow }
}
const openDatePicker = (target, event) => {
  const rect = event.currentTarget.getBoundingClientRect()
  const position = positionPicker(rect, 236, 258)
  picker.value = { type: 'date', target, ...position }
  pickerMonth.value = `${(form[`${target}_date`] || form.start_date || todayKey).slice(0, 7)}-01`
  document.removeEventListener('mousedown', onPickerOutside, true)
  document.addEventListener('mousedown', onPickerOutside, true)
}
const openTimePicker = (target, event) => {
  const rect = event.currentTarget.getBoundingClientRect()
  const position = positionPicker(rect, 184, 280)
  picker.value = { type: 'time', target, ...position }
  document.removeEventListener('mousedown', onPickerOutside, true)
  document.addEventListener('mousedown', onPickerOutside, true)
  nextTick(() => {
    const popover = document.querySelector('.cp-picker-popover.is-time')
    const selected = popover?.querySelector('.cp-picker-time.is-selected')
    if (popover && selected) popover.scrollTop = selected.offsetTop - popover.clientHeight / 2
  })
}
const shiftPickerMonth = delta => {
  pickerMonth.value = format(addMonths(parseISO(pickerMonth.value), delta), 'yyyy-MM-01')
}
const choosePickerDate = key => {
  if (!picker.value) return
  const target = picker.value.target
  if (target === 'start') {
    form.start_date = key
    if (form.end_date < key) form.end_date = key
    if (form.recurrence_type !== 'none') form.end_date = key
  } else {
    form.end_date = key < form.start_date ? form.start_date : key
  }
  closePicker()
}
const choosePickerTime = value => {
  if (!picker.value) return
  const target = picker.value.target
  if (target === 'start') {
    form.start_time = value
    if (form.start_date === form.end_date && form.end_time <= value) {
      const next = parseTimeValue(value) + 60
      if (next < 1440) form.end_time = timeLabel(next)
    }
  } else {
    form.end_time = value
  }
  closePicker()
}

const form = reactive({
  id: null, title: '', kind: 'event', calendar_id: null,
  start_date: '', end_date: '', start_time: '09:00', end_time: '10:00', all_day: false,
  recurrence_type: 'none', recurrence_value: '', recurrence_end_date: '', location: '', notes: ''
})
const placement = computed(() => {
  const anchor = props.anchor
  if (!anchor) return 'center'
  const width = Math.min(POPOVER_WIDTH, window.innerWidth - 24)
  return anchor.right + 10 + width <= window.innerWidth ? 'right' : 'left'
})
const popoverStyle = computed(() => {
  const anchor = props.anchor
  const width = Math.min(POPOVER_WIDTH, window.innerWidth - 24)
  if (!anchor) return { left: `calc(50% - ${width / 2}px)`, top: '12vh', width: `${width}px` }
  const height = Math.min(560, window.innerHeight - 24)
  let left = placement.value === 'right' ? anchor.right + 10 : anchor.left - width - 10
  left = Math.max(12, Math.min(left, window.innerWidth - width - 12))
  let top = anchor.top ?? 12
  if (top + height > window.innerHeight - 12) top = Math.max(12, window.innerHeight - height - 12)
  const anchorY = anchor.y ?? (anchor.top + (anchor.height || 0) / 2)
  const arrowTop = Math.max(12, Math.min(anchorY - top - 6, 340))
  return { left: `${left}px`, top: `${top}px`, width: `${width}px`, '--arrow-top': `${arrowTop}px` }
})
const isRecurring = computed(() => form.id && form.recurrence_type !== 'none')
const selectedCalendar = computed(() => props.calendars.find(calendar => calendar.id === form.calendar_id) || null)
const setKind = kind => {
  if (kind === form.kind) return
  form.kind = kind
  if (kind === 'reminder') {
    form.all_day = true
    const target = props.calendars.find(calendar => calendar.name === '提醒事项')
    if (!form.id && target) form.calendar_id = target.id
  } else {
    form.all_day = false
    if (!form.id) {
      const target = props.calendars.find(calendar => calendar.name === '日程')
      if (target) form.calendar_id = target.id
    }
  }
}
const recurrenceHint = computed(() => {
  if (form.recurrence_type === 'none') return ''
  const time = form.all_day ? '全天' : `${form.start_time}–${form.end_time}`
  const until = form.recurrence_end_date ? `，至 ${form.recurrence_end_date}` : ''
  if (form.recurrence_type === 'lunarYearly') {
    const monthLabel = lunarMonths[(lunarMonth.value || 1) - 1] || ''
    const dayLabel = lunarDays[(lunarDay.value || 1) - 1] || ''
    return `每年农历${monthLabel}${dayLabel} ${time} 重复${until}（单日）`
  }
  if (form.recurrence_type === 'weekly') {
    const labels = [...weeklyDays.value].sort((a, b) => a - b)
      .map(day => weekdays.find(item => item.value === day)?.short)
      .filter(Boolean)
      .join('、')
    if (!labels) return '请选择重复星期'
    const missing = form.start_date
      ? !weeklyDays.value.includes(getISODay(new Date(`${form.start_date}T12:00:00`)))
      : false
    return `每周${labels} ${time} 重复${until}（单日）${missing ? '；开始日期不在所选星期内' : ''}`
  }
  const labels = { daily: '每天', weekdays: '工作日', monthly: '每月同日', yearly: '每年同日' }
  return `${labels[form.recurrence_type] || ''} ${time} 重复${until}（单日）`.trim()
})
const meetingLink = computed(() => meetingLinkFor(form))
const openMeeting = async () => {
  if (!meetingLink.value) return
  try { await window.electronAPI.openExternal(meetingLink.value) } catch (err) { alert(err.message) }
}

const reset = () => {
  const item = props.event
  const fallbackDate = props.defaults.date || format(new Date(), 'yyyy-MM-dd')
  const kind = item?.kind || props.defaults.kind || 'event'
  const startDate = item?.startDate || item?.start_date || fallbackDate
  const defaultCalendarName = kind === 'reminder' ? '提醒事项' : kind === 'class' ? '课程' : '日程'
  const defaultCalendar = props.calendars.find(calendar => calendar.name === defaultCalendarName)
    || props.calendars.find(calendar => calendar.name === '日程')
    || props.calendars[0]
  const recurring = item?.recurrence_type && item.recurrence_type !== 'none'
  const endDate = kind === 'reminder' || recurring
    ? startDate
    : (props.defaults.endDate || item?.endDate || item?.end_date || startDate)
  Object.assign(form, {
    id: item?.id && item.sourceType !== 'task' ? item.id : null,
    title: item?.title || '',
    kind,
    calendar_id: item?.calendar_id || defaultCalendar?.id || null,
    start_date: startDate,
    end_date: endDate,
    start_time: item?.startTime || item?.start_time || props.defaults.time || '09:00',
    end_time: item?.endTime || item?.end_time || props.defaults.endTime || '10:00',
    all_day: kind === 'reminder' ? true : Boolean(item?.allDay ?? item?.all_day ?? props.defaults.allDay ?? false),
    recurrence_type: item?.recurrence_type || 'none',
    recurrence_value: item?.recurrence_value || '',
    recurrence_end_date: item?.recurrence_end_date || '',
    location: item?.location || '',
    notes: item?.notes || ''
  })
  weeklyDays.value = item?.recurrence_type === 'weekly'
    ? String(item.recurrence_value || '').split(',').map(Number).filter(Boolean)
    : [getISODay(new Date(`${startDate}T12:00:00`))]
  if (!weeklyDays.value.length) weeklyDays.value = [1]
  weeklyManual.value = item?.recurrence_type === 'weekly'
  if (item?.recurrence_type === 'lunarYearly') {
    const [month, day] = String(item.recurrence_value || '').split(',').map(Number)
    if (month >= 1 && month <= 12 && day >= 1 && day <= 30) {
      lunarMonth.value = month
      lunarDay.value = day
    }
    lunarManual.value = true
  } else {
    lunarManual.value = false
    syncLunarFromStart()
  }
  showMore.value = Boolean(item?.location || item?.notes || (recurring && item?.recurrence_end_date))
  scope.value = 'this'
}
watch(() => form.recurrence_type, value => {
  if (value === 'weekly' && !weeklyManual.value) {
    weeklyDays.value = [getISODay(new Date(`${form.start_date}T12:00:00`))]
  }
  if (value === 'lunarYearly' && !lunarManual.value) syncLunarFromStart()
})
watch(() => form.start_date, value => {
  if (!value || syncingLunarDate.value) return
  if (form.recurrence_type === 'weekly' && !weeklyManual.value) {
    weeklyDays.value = [getISODay(new Date(`${value}T12:00:00`))]
  }
  if (form.recurrence_type === 'lunarYearly') {
    lunarManual.value = false
    syncLunarFromStart()
  }
})
watch(scope, value => {
  if (!isRecurring.value) return
  const occurrenceStart = props.event?.occurrenceDate || props.event?.startDate
  if (value === 'all') {
    if (props.event?.start_date) form.start_date = props.event.start_date
  } else if (occurrenceStart) {
    form.start_date = occurrenceStart
  }
  form.end_date = form.start_date
})
watch(() => [form.title, form.start_date, form.end_date, form.kind, form.calendar_id, form.all_day, form.recurrence_type], () => {
  if (!props.show || form.id) return
  const color = props.calendars.find(calendar => calendar.id === form.calendar_id)?.color || '#3b82f6'
  emit('preview', {
    title: form.title || (form.kind === 'reminder' ? '新建提醒事项' : '新建日程'),
    startDate: form.start_date,
    endDate: form.kind === 'reminder' || form.recurrence_type !== 'none' ? form.start_date : form.end_date,
    kind: form.kind,
    color
  })
})
const closeOnOutside = event => {
  if (Date.now() - openedAt < 300) return
  if (event.target.closest('.cp-picker-popover')) return
  if (dialog.value?.open && !dialog.value.contains(event.target)) emit('close')
}
const closeOnEscape = event => {
  if (event.key !== 'Escape') return
  event.preventDefault()
  if (picker.value) closePicker()
  else emit('close')
}
watch(() => props.show, async visible => {
  if (visible) {
    openedAt = Date.now()
    if (closeTimer) {
      window.clearTimeout(closeTimer)
      closeTimer = null
    }
    closing.value = false
    reset()
    await nextTick()
    if (dialog.value && !dialog.value.open) {
      if (typeof dialog.value.show === 'function') dialog.value.show()
      else dialog.value.showModal()
      dialog.value.querySelector('input[autofocus]')?.focus()
    }
    document.addEventListener('click', closeOnOutside, true)
    document.addEventListener('keydown', closeOnEscape)
  } else {
    document.removeEventListener('click', closeOnOutside, true)
    document.removeEventListener('keydown', closeOnEscape)
    closePicker()
    if (dialog.value?.open) {
      closing.value = true
      closeTimer = window.setTimeout(() => {
        if (dialog.value?.open) dialog.value.close()
        closing.value = false
        closeTimer = null
      }, 140)
    }
  }
})
onUnmounted(() => {
  if (closeTimer) window.clearTimeout(closeTimer)
  document.removeEventListener('click', closeOnOutside, true)
  document.removeEventListener('keydown', closeOnEscape)
  document.removeEventListener('mousedown', onPickerOutside, true)
})
const submit = () => {
  const isReminder = form.kind === 'reminder'
  const payload = {
    ...form,
    all_day: isReminder ? 1 : (form.all_day ? 1 : 0),
    start_time: isReminder ? null : form.start_time,
    end_time: isReminder ? null : form.end_time,
    end_date: isReminder || form.recurrence_type !== 'none' ? form.start_date : form.end_date,
    recurrence_value: form.recurrence_type === 'lunarYearly'
      ? `${lunarMonth.value},${lunarDay.value}`
      : weeklyDays.value.join(','),
    recurrence_end_date: form.recurrence_end_date || null
  }
  const options = isRecurring.value
    ? { scope: scope.value, occurrenceDate: props.event?.occurrenceDate || props.event?.startDate }
    : {}
  emit('save', payload, options)
}
const remove = () => {
  const options = isRecurring.value
    ? { scope: scope.value, occurrenceDate: props.event?.occurrenceDate || props.event?.startDate }
    : { scope: 'all' }
  emit('delete', form.id, options)
}
</script>

<style scoped>
.cp-composer { position: fixed; inset: auto; z-index: 1100; width: min(344px, calc(100vw - 24px)); max-height: min(560px, calc(100vh - 24px)); margin: 0; padding: 0; border: 1px solid rgb(0 0 0 / 0.1); border-radius: 16px; background: #f4f4f6; color: #1d1d1f; box-shadow: 0 20px 54px rgb(0 0 0 / 0.22), 0 2px 8px rgb(0 0 0 / 0.06); overscroll-behavior: contain; font-family: var(--bm-font-ui); transform-origin: left var(--arrow-top, 24px); will-change: transform, opacity; animation: cp-pop-in 160ms cubic-bezier(0.2, 0.9, 0.25, 1); }
.cp-composer.is-left { transform-origin: right var(--arrow-top, 24px); }
.cp-composer.is-closing { animation: cp-pop-out 120ms cubic-bezier(0.4, 0, 1, 0.6) forwards; pointer-events: none; }
.cp-composer::before { content: ''; position: absolute; top: var(--arrow-top, 24px); left: -7px; width: 12px; height: 12px; background: #f4f4f6; border-left: 1px solid rgb(0 0 0 / 0.13); border-bottom: 1px solid rgb(0 0 0 / 0.13); transform: rotate(45deg); }
.cp-composer.is-left::before { left: auto; right: -7px; border-left: 0; border-bottom: 0; border-right: 1px solid rgb(0 0 0 / 0.13); border-top: 1px solid rgb(0 0 0 / 0.13); }
.cp-composer.no-arrow::before { display: none; }
.cp-composer::backdrop { background: transparent; backdrop-filter: none; }
.cp-composer form { display: flex; flex-direction: column; max-height: min(560px, calc(100vh - 24px)); }
@keyframes cp-pop-in {
  from { opacity: 0; transform: scale(0.9); }
  to { opacity: 1; transform: scale(1); }
}
@keyframes cp-pop-out {
  from { opacity: 1; transform: scale(1); }
  to { opacity: 0; transform: scale(0.92); }
}
.cp-composer-header { padding: 10px 14px 0; }
.cp-composer-header h2 { margin: 0; font-size: 14px; font-weight: 600; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.cp-kind-switch { display: flex; width: 100%; gap: 2px; padding: 2px; border-radius: 8px; background: #e3e3e7; }
.cp-kind-switch button { flex: 1; min-height: 28px; padding: 0 8px; border: 0; border-radius: 6px; background: transparent; color: #3a3a3c; font-size: 13px; cursor: pointer; }
.cp-kind-switch button[aria-pressed="true"] { background: #fff; box-shadow: 0 1px 2px rgb(0 0 0 / 0.14); font-weight: 600; }
.cp-title-input { width: 100%; padding: 9px 10px; border: 0; border-radius: 8px; background: #e9e9ec; color: #1d1d1f; font: inherit; font-size: 18px; font-weight: 600; }
.cp-title-input::placeholder { color: #8e8e93; font-weight: 500; }
.cp-title-input:focus { outline: none; }
.cp-icon-button { width: 26px; height: 26px; flex: 0 0 26px; border: 0; border-radius: 50%; background: transparent; color: #8e8e93; font-size: 12px; cursor: pointer; }
.cp-icon-button:hover { background: #f2f2f7; color: #1d1d1f; }
.cp-composer-body { overflow-y: auto; padding: 10px 14px 0; display: grid; gap: 10px; }
.cp-composer-fields { display: grid; gap: 10px; padding-left: 10px; border-left: 3px solid var(--cp-composer-color, #3b82f6); }
.cp-schedule-list { display: grid; gap: 2px; padding: 8px 10px; border-radius: 8px; background: #e9e9ec; }
.cp-schedule-row { display: flex; align-items: center; gap: 8px; min-height: 27px; }
.cp-schedule-label { width: 68px; flex: 0 0 68px; text-align: right; color: #6e6e73; font-size: 13px; }
.cp-schedule-value { flex: 1; min-width: 0; display: flex; align-items: center; gap: 7px; }
.cp-schedule-check { display: flex; align-items: center; gap: 6px; color: #1d1d1f; font-size: 13px; }
.cp-schedule-check input { width: 14px; height: 14px; accent-color: #007aff; }
.cp-picker-trigger { padding: 2px 4px; border: 0; border-radius: 5px; background: transparent; color: #1d1d1f; font: inherit; font-size: 13.5px; font-variant-numeric: tabular-nums; cursor: pointer; }
.cp-picker-trigger:hover { background: rgb(0 0 0 / 0.06); }
.cp-schedule-select { min-height: 26px; padding: 0 4px; border: 0; border-radius: 5px; background: transparent; color: #1d1d1f; font: inherit; font-size: 13.5px; cursor: pointer; }
.cp-lunar-value { display: flex; align-items: center; gap: 6px; }
.cp-lunar-value select { min-height: 26px; padding: 0 5px; border: 1px solid #d1d1d6; border-radius: 5px; background: #fff; color: #1d1d1f; font: inherit; font-size: 12.5px; cursor: pointer; }
.cp-native-input { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.cp-picker-popover { position: fixed; z-index: 1200; padding: 8px; border: 1px solid rgb(0 0 0 / 0.12); border-radius: 10px; background: rgb(250 250 252 / 0.98); color: #1d1d1f; box-shadow: 0 14px 40px rgb(0 0 0 / 0.2), 0 2px 8px rgb(0 0 0 / 0.06); backdrop-filter: blur(18px); font-family: var(--bm-font-ui); }
.cp-picker-popover.is-time { width: 184px; max-height: 280px; overflow-y: auto; padding: 4px; }
.cp-picker-popover.is-right::before { content: ''; position: absolute; left: -6px; top: var(--picker-arrow, 24px); width: 10px; height: 10px; background: #fafafc; border-left: 1px solid rgb(0 0 0 / 0.12); border-bottom: 1px solid rgb(0 0 0 / 0.12); transform: rotate(45deg); }
.cp-picker-popover.is-left::before { content: ''; position: absolute; right: -6px; top: var(--picker-arrow, 24px); width: 10px; height: 10px; background: #fafafc; border-right: 1px solid rgb(0 0 0 / 0.12); border-top: 1px solid rgb(0 0 0 / 0.12); transform: rotate(45deg); }
.cp-picker-popover.is-time::before { display: none; }
.cp-picker-month { display: flex; align-items: center; justify-content: space-between; padding: 1px 2px 7px; }
.cp-picker-month strong { font-size: 13px; font-weight: 600; }
.cp-picker-nav { width: 24px; height: 24px; border: 0; border-radius: 5px; background: transparent; color: #6e6e73; font-size: 10px; cursor: pointer; }
.cp-picker-nav:hover { background: #e9e9ec; color: #1d1d1f; }
.cp-picker-weekdays { display: grid; grid-template-columns: repeat(7, 30px); padding-bottom: 2px; color: #a1a1a6; font-size: 10px; text-align: center; }
.cp-picker-days { display: grid; grid-template-columns: repeat(7, 30px); gap: 1px; }
.cp-picker-day { width: 30px; height: 28px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: #1d1d1f; font: inherit; font-size: 11.5px; font-variant-numeric: tabular-nums; cursor: pointer; }
.cp-picker-day:hover { background: #e9e9ec; }
.cp-picker-day.is-outside { color: #b0b0b5; }
.cp-picker-day.is-today { color: #ff3b30; font-weight: 700; }
.cp-picker-day.is-selected { background: #007aff; color: #fff; font-weight: 600; }
.cp-picker-time { display: block; width: 100%; min-height: 28px; padding: 0 9px; border: 0; border-radius: 5px; background: transparent; color: #1d1d1f; font: inherit; font-size: 12.5px; font-variant-numeric: tabular-nums; text-align: left; white-space: nowrap; cursor: pointer; }
.cp-picker-time:hover { background: #e9e9ec; }
.cp-picker-time.is-selected { background: #007aff; color: #fff; }
.cp-picker-fade-enter-active, .cp-picker-fade-leave-active { transition: opacity 120ms ease, transform 120ms ease; }
.cp-picker-fade-enter-from, .cp-picker-fade-leave-to { opacity: 0; transform: scale(0.97); }
.cp-weekdays { margin: 0; padding: 0; border: 0; display: flex; flex-wrap: wrap; gap: 8px; }
.cp-weekdays label { display: flex; align-items: center; gap: 3px; color: #1d1d1f; font-size: 13px; }
.cp-weekdays input { accent-color: #007aff; }
.cp-recurrence-hint { margin: 0; color: #8e8e93; font-size: 11px; }
.cp-calendar-field { display: flex; align-items: center; gap: 8px; min-height: 34px; padding: 0 9px; border: 0; border-radius: 8px; background: #e9e9ec; }
.cp-calendar-field select { flex: 1; min-height: 31px; border: 0; background: transparent; color: #1d1d1f; font: inherit; font-size: 13.5px; }
.cp-calendar-dot { width: 9px; height: 9px; flex: 0 0 9px; border-radius: 50%; }
.cp-join-meeting { justify-self: start; min-height: 28px; padding: 0 10px; border: 1px solid rgba(39, 112, 204, 0.2); border-radius: 6px; background: rgba(39, 112, 204, 0.07); color: #245f9e; font-size: 11.5px; cursor: pointer; }
.cp-more-toggle { display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: 34px; padding: 0 9px; border: 0; border-radius: 8px; background: #e9e9ec; color: #6e6e73; font: inherit; font-size: 13px; cursor: pointer; }
.cp-more-toggle i { font-size: 9px; }
.cp-more-body { display: grid; gap: 8px; padding: 9px; border-radius: 8px; background: #ececef; }
.cp-field { display: grid; gap: 4px; min-width: 0; }
.cp-field > span { color: #6e6e73; font-size: 11.5px; }
.cp-field input, .cp-field select, .cp-field textarea { width: 100%; min-height: 31px; padding: 4px 7px; border: 1px solid #d1d1d6; border-radius: 6px; background: #fff; color: #1d1d1f; font: inherit; font-size: 13px; }
.cp-field input:focus, .cp-field select:focus, .cp-field textarea:focus { outline: 2px solid color-mix(in srgb, #007aff 40%, transparent); outline-offset: 0; border-color: #007aff; }
.cp-field textarea { resize: vertical; }
.cp-composer-footer { display: grid; grid-template-columns: 1fr auto auto auto; gap: 7px; padding: 10px 14px 12px; }
.cp-composer-footer button { min-height: 31px; padding: 0 14px; border-radius: 7px; font-size: 13.5px; cursor: pointer; }
.cp-primary { border: 1px solid #007aff; background: #007aff; color: #fff; }
.cp-primary:hover { background: #0a6fdb; }
.cp-secondary { border: 1px solid #d1d1d6; background: rgb(255 255 255 / 0.7); color: #1d1d1f; }
.cp-delete { justify-self: start; border: 0; background: transparent; color: #ff3b30; padding-left: 0 !important; text-align: left; }
input:focus-visible, select:focus-visible, textarea:focus-visible, button:focus-visible { outline: 2px solid var(--bm-accent-blue); outline-offset: 2px; }
@media (max-width: 520px) { .cp-composer-footer { grid-template-columns: 1fr 1fr 1fr; } .cp-composer-footer > span { display: none; } }
</style>
