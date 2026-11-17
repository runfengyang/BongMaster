<template>
  <dialog
    ref="dialog"
    class="work-drawer"
    :class="{ 'is-open': open }"
    aria-labelledby="work-drawer-title"
    @close="$emit('close')"
    @click="onBackdrop"
  >
    <div ref="panel" class="work-drawer-panel" tabindex="-1">
      <header class="work-drawer-header">
        <div>
          <h2 id="work-drawer-title">本月打卡</h2>
          <p>实际工时、迟到早退与补卡</p>
        </div>
        <div class="work-month-nav">
          <button type="button" aria-label="上个月" @click="changeMonth(-1)">‹</button>
          <strong>{{ monthLabel }}</strong>
          <button type="button" aria-label="下个月" @click="changeMonth(1)">›</button>
        </div>
        <button type="button" class="work-drawer-close" aria-label="关闭" @click="$emit('close')">×</button>
      </header>

      <div class="work-drawer-body">
        <div class="work-summary">
          <div><strong>{{ store.monthSummary.days }}</strong><span>出勤</span></div>
          <div><strong>{{ formatWorkHours(store.monthSummary.totalMinutes) }}</strong><span>总工时</span></div>
          <div><strong>{{ formatWorkHours(store.monthSummary.averageMinutes) }}</strong><span>日均</span></div>
          <div><strong>{{ formatWorkHours(store.monthSummary.overtimeMinutes) }}</strong><span>加班</span></div>
          <div><strong>{{ store.monthSummary.lateCount }} / {{ store.monthSummary.earlyCount }}</strong><span>迟到 / 早退</span></div>
        </div>

        <div class="work-heatmap">
          <div class="work-heatmap-weekdays">
            <span v-for="day in weekdays" :key="day.value">{{ day.short }}</span>
          </div>
          <div class="work-heatmap-grid">
            <button
              v-for="day in calendarDays"
              :key="day.key"
              type="button"
              class="work-heatmap-day"
              :class="{
                'is-outside': !day.inMonth,
                'is-today': day.key === todayKey,
                'is-selected': day.key === selectedDate,
                'is-open': attendanceFor(day.key)?.isOpen,
                'is-empty': !attendanceFor(day.key)?.isComplete
              }"
              :style="{ backgroundColor: heatColor(day.key) }"
              :title="heatTitle(day.key)"
              @click="selectDay(day.key)"
            >
              <span class="work-heatmap-number">{{ day.day }}</span>
              <span v-if="attendanceFor(day.key)?.isComplete" class="work-heatmap-hours">{{ formatWorkHours(attendanceFor(day.key).workedMinutes).replace('h', '') }}</span>
              <i v-if="attendanceFor(day.key)?.isOpen" class="work-heatmap-dot" aria-hidden="true"></i>
            </button>
          </div>
          <div class="work-heatmap-legend">
            <span>少</span>
            <i v-for="color in legendColors" :key="color" :style="{ background: color }"></i>
            <span>多</span>
            <em>红色圆点 = 未下班</em>
          </div>
        </div>

        <section v-if="editorVisible" class="work-editor">
          <div class="work-editor-head">
            <strong>{{ selectedDateLabel }}</strong>
            <button type="button" class="work-link" @click="editorVisible = false">收起</button>
          </div>
          <div class="work-editor-grid">
            <label>上班<input v-model="editor.checkIn" type="datetime-local"></label>
            <label>下班<input v-model="editor.checkOut" type="datetime-local"></label>
          </div>
          <div class="work-editor-pauses">
            <div v-for="(pause, index) in editor.pauses" :key="index" class="work-pause-row">
              <input v-model="pause.start" type="datetime-local" aria-label="暂停开始">
              <input v-model="pause.end" type="datetime-local" aria-label="暂停结束">
              <button type="button" class="work-pause-remove" aria-label="删除暂停" @click="removePause(index)">×</button>
            </div>
            <button type="button" class="work-link work-pause-add" @click="addPause">添加暂停</button>
          </div>
          <label class="work-editor-note">备注<input v-model="editor.note" placeholder="可选"></label>
          <p v-if="editorError" class="work-editor-error">{{ editorError }}</p>
          <div class="work-editor-actions">
            <button v-if="editor.id" type="button" class="work-danger" @click="removeRecord">删除</button>
            <span></span>
            <button type="button" class="work-secondary" @click="editorVisible = false">取消</button>
            <button type="button" class="work-primary" @click="saveRecord">保存</button>
          </div>
        </section>

        <section class="work-records">
          <div class="work-records-head">
            <strong>每日记录</strong>
            <span>{{ store.loading ? '读取中…' : `${store.monthRecords.length} 天` }}</span>
          </div>
          <button
            v-for="row in sortedRecords"
            :key="row.id"
            type="button"
            class="work-record-row"
            @click="selectDay(row.work_date)"
          >
            <span class="work-record-date">{{ recordDateLabel(row.work_date) }}</span>
            <span class="work-record-times">{{ formatClock(row.check_in_at) }} – {{ formatClock(row.check_out_at) }}</span>
            <span class="work-record-duration">{{ recordDuration(row) }}</span>
            <span class="work-record-badges">
              <em v-if="attendanceFor(row.work_date)?.isOpen" class="is-open">未下班</em>
              <em v-if="attendanceFor(row.work_date)?.isPaused" class="is-pause">暂停中</em>
              <em v-if="attendanceFor(row.work_date)?.lateMinutes > 0" class="is-late">迟到</em>
              <em v-if="attendanceFor(row.work_date)?.earlyMinutes > 0" class="is-early">早退</em>
              <em v-if="attendanceFor(row.work_date)?.overtimeMinutes > 0" class="is-overtime">加班</em>
            </span>
          </button>
          <p v-if="!store.monthRecords.length" class="work-records-empty">本月还没有打卡记录</p>
        </section>

        <details ref="settingsRef" class="work-settings" :open="settingsOpen" @toggle="settingsOpen = $event.target.open">
          <summary>工时设置</summary>
          <div class="work-settings-grid">
            <label>上班时间<input v-model="settingsForm.work_start" type="time"></label>
            <label>下班时间<input v-model="settingsForm.work_end" type="time"></label>
            <label>迟到宽限（分钟）<input v-model.number="settingsForm.grace_minutes" type="number" min="0" max="120"></label>
          </div>
          <div class="work-settings-workdays">
            <label v-for="day in weekdays" :key="day.value">
              <input v-model="settingsForm.workdayValues" type="checkbox" :value="day.value"> {{ day.short }}
            </label>
          </div>
          <div class="work-settings-actions">
            <button type="button" class="work-secondary" @click="saveSettings">保存设置</button>
          </div>
        </details>
      </div>
    </div>
  </dialog>
</template>

<script setup>
import { computed, nextTick, onUnmounted, reactive, ref, watch } from 'vue'
import { addMonths, format, parseISO } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { useWorkAttendanceStore } from '@stores/work-attendance-store'
import {
  attendanceForRow,
  buildMonthCalendar,
  formatClock,
  formatWorkClock,
  formatWorkHours,
  fromDateTimeLocal,
  parsePauses,
  toDateTimeLocal,
  workHeatColor
} from '@utils/work-attendance.js'

const props = defineProps({ show: { type: Boolean, default: false }, openSettings: { type: Boolean, default: false } })
const emit = defineEmits(['close'])
const store = useWorkAttendanceStore()
const dialog = ref(null)
const settingsRef = ref(null)
const settingsOpen = ref(false)
const panel = ref(null)
const open = ref(false)
let closeTimer = null
const selectedDate = ref('')
const editorVisible = ref(false)
const editorError = ref('')
const editor = reactive({ id: null, checkIn: '', checkOut: '', note: '', pauses: [] })
const settingsForm = reactive({ work_start: '09:00', work_end: '18:00', grace_minutes: 5, workdayValues: [1, 2, 3, 4, 5] })
const todayKey = format(new Date(), 'yyyy-MM-dd')
const weekdays = [
  { value: 1, short: '一' }, { value: 2, short: '二' }, { value: 3, short: '三' },
  { value: 4, short: '四' }, { value: 5, short: '五' }, { value: 6, short: '六' }, { value: 7, short: '日' }
]
const monthLabel = computed(() => format(parseISO(`${store.monthDate.slice(0, 7)}-01T12:00:00`), 'yyyy年M月'))
const calendarDays = computed(() => buildMonthCalendar(store.monthDate))
const recordsByDate = computed(() => new Map(store.monthRecords.map(row => [row.work_date, row])))
const sortedRecords = computed(() => [...store.monthRecords].sort((a, b) => b.work_date.localeCompare(a.work_date)))
const selectedDateLabel = computed(() => selectedDate.value ? format(parseISO(selectedDate.value), 'M月d日 EEEE', { locale: zhCN }) : '')
const legendColors = ['#f2f2f7', '#e8f1fb', '#cfe3f8', '#a9cdf2', '#6aa9e8', '#2f7fd1']

const attendanceFor = key => {
  const row = recordsByDate.value.get(key)
  return row ? attendanceForRow(row, store.settings) : null
}
const heatColor = key => {
  const attendance = attendanceFor(key)
  return workHeatColor(attendance?.isComplete ? attendance.workedMinutes : null, store.settings)
}
const heatTitle = key => {
  const attendance = attendanceFor(key)
  if (!attendance) return `${key} · 无记录`
  if (attendance.isOpen) return `${key} · ${formatClock(attendance.check_in_at)} 上班 · 未下班`
  return `${key} · ${formatWorkClock(attendance.workedSeconds)}`
}
const recordDateLabel = key => format(parseISO(key), 'M月d日 EEE', { locale: zhCN })
const recordDuration = row => {
  const attendance = attendanceForRow(row, store.settings)
  return attendance?.isComplete ? formatWorkClock(attendance.workedSeconds) : '未下班'
}

const syncSettingsForm = () => {
  settingsForm.work_start = store.settings.work_start || '09:00'
  settingsForm.work_end = store.settings.work_end || '18:00'
  settingsForm.grace_minutes = Number(store.settings.grace_minutes) || 0
  settingsForm.workdayValues = String(store.settings.workdays || '1,2,3,4,5').split(',').map(Number).filter(Boolean)
}
const selectDay = key => {
  selectedDate.value = key
  const row = recordsByDate.value.get(key)
  editor.id = row?.id || null
  editor.checkIn = row?.check_in_at ? toDateTimeLocal(row.check_in_at) : `${key}T${store.settings.work_start || '09:00'}`
  editor.checkOut = row?.check_out_at ? toDateTimeLocal(row.check_out_at) : `${key}T${store.settings.work_end || '18:00'}`
  editor.note = row?.note || ''
  editor.pauses = parsePauses(row?.pauses).map(item => ({
    start: toDateTimeLocal(item.start),
    end: toDateTimeLocal(item.end)
  }))
  editorError.value = ''
  editorVisible.value = true
}
const addPause = () => {
  editor.pauses.push({ start: '', end: '' })
}
const removePause = index => {
  editor.pauses.splice(index, 1)
}
const saveRecord = async () => {
  editorError.value = ''
  const checkIn = fromDateTimeLocal(editor.checkIn)
  const checkOut = fromDateTimeLocal(editor.checkOut)
  if (!checkIn) {
    editorError.value = '请填写上班时间'
    return
  }
  if (checkOut && checkOut <= checkIn) {
    editorError.value = '下班时间必须晚于上班时间'
    return
  }
  const pauses = []
  for (const pause of editor.pauses) {
    const start = fromDateTimeLocal(pause.start)
    if (!start) continue
    const end = fromDateTimeLocal(pause.end)
    if (end && end <= start) {
      editorError.value = '暂停结束时间必须晚于开始时间'
      return
    }
    if (start < checkIn) {
      editorError.value = '暂停开始时间必须晚于上班时间'
      return
    }
    if (checkOut && end && end > checkOut) {
      editorError.value = '暂停时间必须在下班之前'
      return
    }
    pauses.push({ start, end })
  }
  const result = await store.saveRecord({
    id: editor.id || undefined,
    work_date: selectedDate.value,
    check_in_at: checkIn,
    check_out_at: checkOut,
    pauses,
    note: editor.note || ''
  })
  if (!result) {
    editorError.value = store.error || '保存失败'
    return
  }
  editor.id = result.id
  editorVisible.value = false
}
const removeRecord = async () => {
  if (!editor.id) return
  if (!window.confirm('删除这条打卡记录？')) return
  const ok = await store.deleteRecord(editor.id)
  if (ok) {
    editorVisible.value = false
    selectedDate.value = ''
  }
}
const saveSettings = async () => {
  const days = settingsForm.workdayValues.length ? settingsForm.workdayValues.join(',') : '1,2,3,4,5'
  await store.saveSettings({
    work_start: settingsForm.work_start,
    work_end: settingsForm.work_end,
    grace_minutes: settingsForm.grace_minutes,
    workdays: days
  })
}
const changeMonth = async delta => {
  const target = format(addMonths(parseISO(`${store.monthDate.slice(0, 7)}-01T12:00:00`), delta), 'yyyy-MM-01')
  await store.loadMonth(target)
  selectedDate.value = ''
  editorVisible.value = false
}
const onBackdrop = event => {
  if (event.target === dialog.value) emit('close')
}
watch(() => props.show, async visible => {
  if (visible) {
    if (closeTimer) {
      window.clearTimeout(closeTimer)
      closeTimer = null
    }
    syncSettingsForm()
    settingsOpen.value = Boolean(props.openSettings)
    await store.loadMonth(format(new Date(), 'yyyy-MM-01'))
    await nextTick()
    if (dialog.value && !dialog.value.open) dialog.value.showModal()
    panel.value?.focus()
    requestAnimationFrame(() => { open.value = true })
    if (settingsOpen.value) {
      window.setTimeout(() => settingsRef.value?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 260)
    }
  } else {
    open.value = false
    if (dialog.value?.open) {
      closeTimer = window.setTimeout(() => {
        dialog.value?.close()
        closeTimer = null
      }, 220)
    }
  }
})
onUnmounted(() => { if (closeTimer) window.clearTimeout(closeTimer) })
</script>

<style scoped>
.work-drawer { position: fixed; inset: 0 0 0 auto; right: -540px; width: min(500px, calc(100vw - 32px)); height: 100vh; max-height: none; margin: 0; padding: 0; border: 0; border-left: 1px solid rgb(0 0 0 / 0.12); border-radius: 14px 0 0 14px; background: #fff; color: #1d1d1f; box-shadow: -18px 0 50px rgb(0 0 0 / 0.16); transition: right 220ms cubic-bezier(0.2, 0.8, 0.2, 1); font-family: var(--bm-font-ui); }
.work-drawer.is-open { right: 0; }
.work-drawer::backdrop { background: rgb(0 0 0 / 0.18); backdrop-filter: blur(1.5px); }
.work-drawer-panel { display: flex; flex-direction: column; height: 100%; min-height: 0; outline: none; }
.work-drawer-header { display: flex; align-items: flex-start; gap: 12px; padding: 16px 16px 12px; border-bottom: 1px solid #e8e8ed; }
.work-drawer-header h2 { margin: 0; font-size: 19px; font-weight: 650; }
.work-drawer-header p { margin: 3px 0 0; color: #8e8e93; font-size: 11.5px; }
.work-month-nav { display: flex; align-items: center; gap: 3px; margin-left: auto; margin-top: 2px; }
.work-month-nav button { width: 24px; height: 24px; border: 0; border-radius: 5px; background: transparent; color: #6e6e73; font-size: 16px; cursor: pointer; }
.work-month-nav button:hover { background: #f2f2f7; }
.work-month-nav strong { min-width: 82px; text-align: center; font-size: 12px; font-weight: 600; }
.work-drawer-close { width: 26px; height: 26px; flex: 0 0 26px; border: 0; border-radius: 50%; background: transparent; color: #8e8e93; font-size: 17px; cursor: pointer; }
.work-drawer-close:hover { background: #f2f2f7; color: #1d1d1f; }
.work-drawer-body { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 14px 22px; display: grid; align-content: start; gap: 12px; background: #fbfbfd; }
.work-summary { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; padding: 10px; border: 1px solid #ececf1; border-radius: 10px; background: #f7f7f9; }
.work-summary div { display: grid; gap: 1px; min-width: 0; }
.work-summary strong { font-size: 15px; font-variant-numeric: tabular-nums; }
.work-summary span { color: #8e8e93; font-size: 9.5px; }
.work-heatmap { padding: 10px; border: 1px solid #ececf1; border-radius: 10px; background: #f7f7f9; }
.work-heatmap-weekdays { display: grid; grid-template-columns: repeat(7, 1fr); padding-bottom: 4px; color: #a1a1a6; font-size: 9.5px; text-align: center; }
.work-heatmap-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; }
.work-heatmap-day { position: relative; min-height: 42px; padding: 4px; border: 1px solid transparent; border-radius: 6px; color: #1d1d1f; font: inherit; text-align: left; cursor: pointer; display: flex; flex-direction: column; align-items: flex-start; gap: 1px; }
.work-heatmap-day:hover { border-color: color-mix(in srgb, #007aff 40%, transparent); }
.work-heatmap-day.is-outside { opacity: 0.4; }
.work-heatmap-day.is-today { box-shadow: inset 0 0 0 1.5px #d92d20; }
.work-heatmap-day.is-selected { border-color: #007aff; box-shadow: inset 0 0 0 1px #007aff; }
.work-heatmap-day.is-open { background-image: repeating-linear-gradient(135deg, rgba(217, 45, 32, 0.08) 0 4px, transparent 4px 8px); }
.work-heatmap-number { font-size: 10.5px; font-weight: 600; font-variant-numeric: tabular-nums; }
.work-heatmap-hours { font-size: 9px; font-variant-numeric: tabular-nums; opacity: 0.8; }
.work-heatmap-dot { position: absolute; right: 4px; bottom: 4px; width: 5px; height: 5px; border-radius: 50%; background: #d92d20; }
.work-heatmap-legend { display: flex; align-items: center; justify-content: flex-end; gap: 3px; padding-top: 6px; color: #a1a1a6; font-size: 9px; }
.work-heatmap-legend i { width: 10px; height: 10px; border-radius: 2px; }
.work-heatmap-legend em { margin-left: 7px; font-style: normal; }
.work-link, .work-secondary, .work-primary, .work-danger { font: inherit; cursor: pointer; }
.work-link { padding: 0; border: 0; background: transparent; color: #007aff; font-size: 11px; }
.work-editor { display: grid; gap: 8px; padding: 10px; border: 1px solid #d8e5f5; border-radius: 10px; background: #f5f9ff; }
.work-editor-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.work-editor-head strong { font-size: 13px; }
.work-editor-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.work-editor label, .work-settings-grid label { display: grid; gap: 3px; color: #6e6e73; font-size: 10.5px; }
.work-editor input, .work-settings-grid input { min-height: 30px; padding: 3px 6px; border: 1px solid #d1d1d6; border-radius: 6px; background: #fff; color: #1d1d1f; font: inherit; font-size: 12px; }
.work-editor-note { display: grid; gap: 3px; color: #6e6e73; font-size: 10.5px; }
.work-editor-pauses { display: grid; gap: 5px; }
.work-pause-row { display: grid; grid-template-columns: 1fr 1fr 24px; gap: 5px; align-items: center; }
.work-pause-row input { min-height: 30px; padding: 3px 6px; border: 1px solid #d1d1d6; border-radius: 6px; background: #fff; color: #1d1d1f; font: inherit; font-size: 12px; }
.work-pause-remove { width: 24px; height: 24px; border: 0; border-radius: 50%; background: transparent; color: #8e8e93; font-size: 15px; cursor: pointer; }
.work-pause-remove:hover { background: #e8e8ed; color: #d92d20; }
.work-pause-add { justify-self: start; }
.work-editor-error { margin: 0; color: #d92d20; font-size: 10.5px; }
.work-editor-actions { display: grid; grid-template-columns: 1fr auto auto; gap: 6px; padding-top: 2px; }
.work-editor-actions .work-secondary, .work-editor-actions .work-primary, .work-danger { min-height: 29px; padding: 0 11px; border-radius: 6px; font-size: 12px; }
.work-danger { border: 0; background: transparent; color: #d92d20; justify-self: start; }
.work-secondary { border: 1px solid #d1d1d6; background: #fff; color: #1d1d1f; }
.work-primary { border: 1px solid #007aff; background: #007aff; color: #fff; }
.work-records { display: grid; gap: 4px; }
.work-records-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.work-records-head strong { font-size: 12px; }
.work-records-head span { color: #a1a1a6; font-size: 10px; }
.work-record-row { display: grid; grid-template-columns: 100px 104px 58px 1fr; align-items: center; gap: 6px; min-height: 34px; padding: 4px 7px; border: 1px solid #ececf1; border-radius: 7px; background: #fff; color: #1d1d1f; font: inherit; font-size: 11px; text-align: left; cursor: pointer; }
.work-record-row:hover { border-color: #cfe0f4; background: #f8fbff; }
.work-record-date { font-weight: 600; }
.work-record-times, .work-record-duration { color: #6e6e73; font-variant-numeric: tabular-nums; }
.work-record-badges { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 3px; }
.work-record-badges em { padding: 1px 4px; border-radius: 4px; font-size: 9px; font-style: normal; }
.work-record-badges .is-open, .work-record-badges .is-late, .work-record-badges .is-early { background: rgba(217, 45, 32, 0.08); color: #b3261e; }
.work-record-badges .is-pause { background: rgba(100, 116, 139, 0.1); color: #64748b; }
.work-record-badges .is-overtime { background: rgba(226, 134, 20, 0.1); color: #a65f08; }
.work-records-empty { margin: 8px 0; color: #a1a1a6; font-size: 11px; text-align: center; }
.work-settings { padding: 9px 10px; border: 1px solid #ececf1; border-radius: 9px; background: #f7f7f9; }
.work-settings summary { color: #6e6e73; font-size: 11px; font-weight: 600; cursor: pointer; }
.work-settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; padding-top: 8px; }
.work-settings-workdays { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px 0; color: #1d1d1f; font-size: 11px; }
.work-settings-workdays label { display: flex; align-items: center; gap: 3px; }
.work-settings-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.work-settings .work-secondary { min-height: 29px; padding: 0 10px; border-radius: 6px; font-size: 11px; }
</style>
