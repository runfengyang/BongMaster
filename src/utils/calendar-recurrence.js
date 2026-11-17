import { addDays, format, getISODay, isValid, parseISO } from 'date-fns'
import { LunarDay } from 'tyme4ts'

export const toDateKey = date => format(date, 'yyyy-MM-dd')
export const fromDateKey = value => parseISO(`${value}T12:00:00`)

const shiftDateKey = (date, days) => toDateKey(addDays(fromDateKey(date), days))
const validDateKey = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && isValid(parseISO(value))
const daysBetween = (start, end) => Math.round((fromDateKey(end) - fromDateKey(start)) / 86400000)

function matchesRecurrence(event, date, day) {
  switch (event.recurrence_type) {
    case 'daily': return true
    case 'weekdays': return getISODay(day) <= 5
    case 'weekly': return String(event.recurrence_value || '').split(',').map(Number).includes(getISODay(day))
    case 'monthly': return day.getDate() === fromDateKey(event.start_date).getDate()
    case 'yearly': {
      const start = fromDateKey(event.start_date)
      return day.getMonth() === start.getMonth() && day.getDate() === start.getDate()
    }
    default: return false
  }
}

export function makeOccurrence(event, occurrenceDate, override = null) {
  if (override?.is_cancelled) return null
  const duration = Math.max(0, daysBetween(event.start_date, event.end_date))
  const base = event.recurrence_type === 'none'
    ? event
    : { ...event, start_date: occurrenceDate, end_date: shiftDateKey(occurrenceDate, duration) }
  const value = key => override?.[key] ?? base[key]
  const startDate = value('start_date')
  return {
    ...event,
    id: event.id,
    eventId: event.id,
    overrideId: override?.id || null,
    occurrenceDate,
    occurrenceKey: `${event.id}:${occurrenceDate}`,
    calendar_id: value('calendar_id'),
    title: value('title'),
    kind: value('kind'),
    startDate,
    endDate: value('end_date') || startDate,
    startTime: value('start_time'),
    endTime: value('end_time'),
    allDay: Boolean(value('all_day')),
    location: value('location') || '',
    notes: value('notes') || '',
    updatedAt: [event.updated_at, override?.updated_at].filter(Boolean).sort().pop() || '',
    isOverride: Boolean(override),
    sourceType: 'event'
  }
}

export function expandOccurrences(events, overrides, rangeStart, rangeEnd) {
  if (!validDateKey(rangeStart) || !validDateKey(rangeEnd) || rangeEnd < rangeStart) return []
  const overrideMap = new Map((overrides || []).map(item => [`${item.event_id}:${item.occurrence_date}`, item]))
  const eventMap = new Map((events || []).map(event => [event.id, event]))
  const occurrences = []
  const seen = new Set()
  const push = (event, occurrenceDate, override) => {
    const key = `${event.id}:${occurrenceDate}`
    if (seen.has(key)) return
    seen.add(key)
    const occurrence = makeOccurrence(event, occurrenceDate, override)
    if (occurrence && occurrence.startDate <= rangeEnd && occurrence.endDate >= rangeStart) occurrences.push(occurrence)
  }
  for (const event of events || []) {
    const duration = Math.max(0, daysBetween(event.start_date, event.end_date))
    if (event.recurrence_type === 'none') {
      push(event, event.start_date, null)
      continue
    }
    if (event.recurrence_type === 'lunarYearly') {
      const [lunarMonth, lunarDay] = String(event.recurrence_value || '').split(',').map(Number)
      if (!Number.isInteger(lunarMonth) || !Number.isInteger(lunarDay)) continue
      const fromYear = Number(rangeStart.slice(0, 4)) - 1
      const toYear = Number(rangeEnd.slice(0, 4)) + 1
      for (let year = fromYear; year <= toYear; year += 1) {
        let solar
        try {
          solar = LunarDay.fromYmd(year, lunarMonth, lunarDay).getSolarDay()
        } catch {
          continue
        }
        const date = `${solar.getYear()}-${String(solar.getMonth()).padStart(2, '0')}-${String(solar.getDay()).padStart(2, '0')}`
        if (date < event.start_date) continue
        if (event.recurrence_end_date && date > event.recurrence_end_date) continue
        push(event, date, overrideMap.get(`${event.id}:${date}`))
      }
      continue
    }
    const first = event.start_date > shiftDateKey(rangeStart, -duration) ? event.start_date : shiftDateKey(rangeStart, -duration)
    const last = (event.recurrence_end_date || rangeEnd) < rangeEnd ? (event.recurrence_end_date || rangeEnd) : rangeEnd
    for (let date = first; date <= last; date = shiftDateKey(date, 1)) {
      const day = fromDateKey(date)
      if (matchesRecurrence(event, date, day)) push(event, date, overrideMap.get(`${event.id}:${date}`))
    }
  }
  for (const override of overrides || []) {
    const event = eventMap.get(override.event_id)
    if (!event || event.recurrence_type === 'none') continue
    if (event.recurrence_end_date && override.occurrence_date > event.recurrence_end_date) continue
    push(event, override.occurrence_date, override)
  }
  return occurrences.sort((a, b) =>
    a.startDate.localeCompare(b.startDate) ||
    Number(b.allDay) - Number(a.allDay) ||
    String(a.startTime || '').localeCompare(String(b.startTime || '')) ||
    a.title.localeCompare(b.title, 'zh-CN') ||
    a.eventId - b.eventId
  )
}
