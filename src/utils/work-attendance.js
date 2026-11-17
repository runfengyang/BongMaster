import { addDays, eachDayOfInterval, format, getISODay, parseISO, startOfMonth, startOfWeek, endOfMonth } from 'date-fns'

export const defaultWorkSettings = {
  work_start: '09:00',
  work_end: '18:00',
  workdays: '1,2,3,4,5',
  grace_minutes: 5,
  lunch_break_minutes: 0
}

export const toStamp = date => format(date, 'yyyy-MM-dd HH:mm:ss')
export const toDateTimeLocal = value => value ? value.replace(' ', 'T').slice(0, 16) : ''
export const fromDateTimeLocal = value => value ? `${value.replace('T', ' ')}:00`.slice(0, 19) : null
export const formatClock = value => value ? String(value).slice(11, 16) : '--'

const parseStamp = value => {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(value || ''))
  if (!match) return null
  const [, year, month, day, hour, minute, second] = match
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))
  return Number.isNaN(date.getTime()) ? null : date
}

const minutes = value => Math.max(0, Math.round(value / 60000))
const seconds = value => Math.max(0, Math.floor(value / 1000))

const stampPattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/

export const parsePauses = value => {
  let list = value
  if (typeof list === 'string') {
    try { list = JSON.parse(list) } catch { list = [] }
  }
  if (!Array.isArray(list)) return []
  return list
    .map(item => ({
      start: stampPattern.test(String(item?.start || '')) ? item.start : '',
      end: stampPattern.test(String(item?.end || '')) ? item.end : ''
    }))
    .filter(item => item.start)
    .sort((a, b) => a.start.localeCompare(b.start))
}

const pauseSpans = pauses => parsePauses(pauses)
  .map(item => ({ start: parseStamp(item.start), end: item.end ? parseStamp(item.end) : null }))
  .filter(item => item.start)

const overlapMilliseconds = (spans, from, to) => {
  if (!from || !to || to <= from) return 0
  return spans.reduce((sum, span) => {
    const start = span.start > from ? span.start : from
    const stop = span.end && span.end < to ? span.end : to
    return stop > start ? sum + (stop - start) : sum
  }, 0)
}

const overlapSeconds = (spans, from, to) => seconds(overlapMilliseconds(spans, from, to))

export const standardDayMinutes = settings => {
  const start = parseStamp(`${format(new Date(), 'yyyy-MM-dd')} ${settings.work_start || '09:00'}:00`)
  const end = parseStamp(`${format(new Date(), 'yyyy-MM-dd')} ${settings.work_end || '18:00'}:00`)
  if (!start || !end) return 480
  const span = end > start ? minutes(end - start) : minutes(end.getTime() + 86400000 - start.getTime())
  return Math.max(0, span)
}

export const isWorkday = (dateKey, settings) => {
  const workdays = String(settings.workdays || '1,2,3,4,5').split(',').map(Number)
  return workdays.includes(getISODay(parseISO(dateKey)))
}

export function attendanceForRow(row, settings = defaultWorkSettings) {
  if (!row) return null
  const checkIn = parseStamp(row.check_in_at)
  const checkOut = parseStamp(row.check_out_at)
  const workday = isWorkday(row.work_date, settings)
  const start = parseStamp(`${row.work_date} ${settings.work_start || '09:00'}:00`)
  let end = parseStamp(`${row.work_date} ${settings.work_end || '18:00'}:00`)
  if (start && end && end <= start) end = new Date(end.getTime() + 86400000)
  const grace = Number(settings.grace_minutes) || 0
  const isComplete = Boolean(checkIn && checkOut)
  const pauses = parsePauses(row.pauses)
  const rawSpans = pauseSpans(pauses)
  const spans = rawSpans.map(span => ({
    ...span,
    end: span.end || (isComplete && checkOut > span.start ? checkOut : null)
  }))
  const pausedMilliseconds = spans.reduce((sum, span) => sum + (span.end && span.end > span.start ? span.end - span.start : 0), 0)
  const pausedSeconds = seconds(pausedMilliseconds)
  const isPaused = Boolean(checkIn && !checkOut && rawSpans.some(span => !span.end))
  const workedSeconds = isComplete ? Math.max(0, seconds(checkOut - checkIn) - pausedSeconds) : null
  const workedMinutes = workedSeconds == null ? null : Math.round(workedSeconds / 60)
  const lateMinutes = workday && checkIn && start
    ? Math.max(0, minutes(checkIn - start) - grace)
    : 0
  const earlyMinutes = workday && checkOut && end
    ? Math.max(0, minutes(end - checkOut) - grace)
    : 0
  const overtimeMinutes = checkOut && end
    ? Math.round(Math.max(0, seconds(checkOut - end) - overlapSeconds(spans, end, checkOut)) / 60)
    : 0
  return {
    ...row,
    checkIn,
    checkOut,
    pauses: pauses.map(item => {
      const pauseStart = parseStamp(item.start)
      const pauseEnd = item.end ? parseStamp(item.end) : null
      const pauseSeconds = pauseEnd && pauseEnd > pauseStart ? seconds(pauseEnd - pauseStart) : null
      return { ...item, seconds: pauseSeconds, minutes: pauseSeconds == null ? null : Math.round(pauseSeconds / 60) }
    }),
    pausedSeconds,
    pausedMinutes: Math.round(pausedSeconds / 60),
    isPaused,
    isComplete,
    isOpen: Boolean(checkIn && !checkOut),
    isWorkday: workday,
    workedSeconds,
    workedMinutes,
    lateMinutes,
    earlyMinutes,
    overtimeMinutes,
    standardMinutes: standardDayMinutes(settings),
    checkInTime: formatClock(row.check_in_at),
    checkOutTime: formatClock(row.check_out_at)
  }
}

export function elapsedWorkSeconds(attendance, now = new Date()) {
  if (!attendance?.checkIn) return null
  const end = attendance.checkOut && attendance.checkOut < now ? attendance.checkOut : now
  if (end <= attendance.checkIn) return 0
  const spans = pauseSpans(attendance.pauses)
  return Math.max(0, seconds(end - attendance.checkIn) - overlapSeconds(spans, attendance.checkIn, end))
}

export function buildWorkSummary(records = [], settings = defaultWorkSettings, monthDate = format(new Date(), 'yyyy-MM-dd')) {
  const start = format(startOfMonth(parseISO(monthDate)), 'yyyy-MM-dd')
  const end = format(endOfMonth(parseISO(monthDate)), 'yyyy-MM-dd')
  const rows = records
    .filter(row => row.work_date >= start && row.work_date <= end)
    .map(row => attendanceForRow(row, settings))
  const completed = rows.filter(row => row.isComplete)
  const totalMinutes = completed.reduce((sum, row) => sum + (row.workedMinutes || 0), 0)
  return {
    days: completed.length,
    workdayDays: completed.filter(row => row.isWorkday).length,
    openDays: rows.filter(row => row.isOpen).length,
    totalMinutes,
    averageMinutes: completed.length ? Math.round(totalMinutes / completed.length) : 0,
    overtimeMinutes: completed.reduce((sum, row) => sum + row.overtimeMinutes, 0),
    lateCount: completed.filter(row => row.lateMinutes > 0).length,
    earlyCount: completed.filter(row => row.earlyMinutes > 0).length,
    records: rows
  }
}

export function visibleTrendItems(trend = {}) {
  return (trend.items || []).filter(item => item.isWorkday || item.checkInTime || item.checkOutTime)
}

export function buildWorkTrend(records = [], settings = defaultWorkSettings, endDate = format(new Date(), 'yyyy-MM-dd'), days = 14) {
  const end = parseISO(endDate)
  const start = addDays(end, -(days - 1))
  const byDate = new Map(records.map(row => [row.work_date, row]))
  const standard = standardDayMinutes(settings)
  const items = eachDayOfInterval({ start, end }).map(date => {
    const dateKey = format(date, 'yyyy-MM-dd')
    const row = byDate.get(dateKey)
    const attendance = attendanceForRow(row, settings)
    return {
      date: dateKey,
      label: format(date, 'M/d'),
      monthDay: format(date, 'M月d日'),
      weekday: getISODay(date),
      minutes: attendance?.isComplete ? attendance.workedMinutes : 0,
      open: Boolean(attendance?.isOpen),
      hasRecord: Boolean(row),
      isToday: dateKey === endDate,
      isWorkday: isWorkday(dateKey, settings),
      checkInTime: attendance?.checkInTime || '',
      checkOutTime: attendance?.checkOutTime || '',
      lateMinutes: attendance?.lateMinutes || 0,
      earlyMinutes: attendance?.earlyMinutes || 0,
      overtimeMinutes: attendance?.overtimeMinutes || 0
    }
  })
  return {
    items,
    standardMinutes: standard,
    maxMinutes: Math.max(60, standard, ...items.map(item => item.minutes)),
    averageMinutes: (() => {
      const complete = items.filter(item => item.minutes > 0)
      return complete.length ? Math.round(complete.reduce((sum, item) => sum + item.minutes, 0) / complete.length) : 0
    })()
  }
}

export function buildMonthCalendar(monthDate) {
  const monthStart = startOfMonth(parseISO(monthDate))
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 })
  return Array.from({ length: 42 }, (_, index) => {
    const date = addDays(gridStart, index)
    const key = format(date, 'yyyy-MM-dd')
    return {
      key,
      day: date.getDate(),
      inMonth: date.getMonth() === monthStart.getMonth(),
      weekday: getISODay(date)
    }
  })
}

export function workHeatColor(minutesValue, settings = defaultWorkSettings) {
  if (minutesValue == null) return '#f2f2f7'
  const standard = standardDayMinutes(settings)
  if (minutesValue <= 0) return '#f2f2f7'
  if (minutesValue < 240) return '#e8f1fb'
  if (minutesValue < 360) return '#cfe3f8'
  if (minutesValue < standard) return '#a9cdf2'
  if (minutesValue <= standard + 60) return '#6aa9e8'
  return '#2f7fd1'
}

export function formatWorkDuration(value, compact = false) {
  if (value == null || !Number.isFinite(value)) return '--'
  const total = Math.max(0, Math.round(value))
  const hours = Math.floor(total / 60)
  const mins = total % 60
  if (compact) return mins ? `${hours}h${String(mins).padStart(2, '0')}m` : `${hours}h`
  if (!hours) return `${mins}分`
  return mins ? `${hours}小时${mins}分` : `${hours}小时`
}

export function formatWorkClock(value) {
  if (value == null || !Number.isFinite(value)) return '--'
  const total = Math.max(0, Math.floor(value))
  const hours = Math.floor(total / 3600)
  const mins = Math.floor((total % 3600) / 60)
  const secs = total % 60
  return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

export function formatWorkHours(value) {
  if (value == null || !Number.isFinite(value)) return '--'
  return `${(value / 60).toFixed(1)}h`
}
