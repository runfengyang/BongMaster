import { expandOccurrences, makeOccurrence } from './calendar-recurrence.js'

const DAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']

const pad = value => String(value).padStart(2, '0')
const compactDate = value => String(value || '').replace(/-/g, '')
const addDaysToKey = (key, days) => {
  const [year, month, day] = String(key).split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
const validTime = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''))

const toUtcStamp = (dateKey, time = '00:00', seconds = 0) => {
  if (!validDate(dateKey) || !validTime(time)) return null
  const [year, month, day] = dateKey.split('-').map(Number)
  const [hour, minute] = String(time).split(':').map(Number)
  const date = new Date(year, month - 1, day, hour, minute, seconds)
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
}

const currentStamp = now => {
  const date = now instanceof Date ? now : new Date(now || Date.now())
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
}

const sqliteStamp = value => {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(value || ''))
  return match ? `${match[1]}${match[2]}${match[3]}T${match[4]}${match[5]}${match[6]}Z` : null
}

const escapeText = value => String(value ?? '')
  .replace(/\\/g, '\\\\')
  .replace(/;/g, '\\;')
  .replace(/,/g, '\\,')
  .replace(/\r\n|\r|\n/g, '\\n')

const foldLine = line => {
  const encoder = new TextEncoder()
  const limit = 75
  const segments = []
  let current = ''
  let bytes = 0
  for (const char of line) {
    const size = encoder.encode(char).length
    if (bytes + size > limit) {
      segments.push(current)
      current = ` ${char}`
      bytes = 1 + size
    } else {
      current += char
      bytes += size
    }
  }
  segments.push(current)
  return segments.join('\r\n')
}

const buildRrule = event => {
  const frequencies = {
    daily: 'DAILY',
    weekdays: 'WEEKLY',
    weekly: 'WEEKLY',
    monthly: 'MONTHLY',
    yearly: 'YEARLY'
  }
  const frequency = frequencies[event.recurrence_type]
  if (!frequency) return null
  const parts = [`FREQ=${frequency}`]
  if (event.recurrence_type === 'weekdays') {
    parts.push('BYDAY=MO,TU,WE,TH,FR')
  } else if (event.recurrence_type === 'weekly') {
    const days = String(event.recurrence_value || '')
      .split(',')
      .map(Number)
      .filter(day => Number.isInteger(day) && day >= 1 && day <= 7)
    if (!days.length) return null
    parts.push(`BYDAY=${days.map(day => DAY_CODES[day - 1]).join(',')}`)
  }
  if (event.recurrence_end_date) {
    const until = event.all_day
      ? compactDate(event.recurrence_end_date)
      : toUtcStamp(event.recurrence_end_date, '23:59', 59)
    if (until) parts.push(`UNTIL=${until}`)
  }
  return parts.join(';')
}

const exdateLine = (event, dateKey) => {
  if (event.all_day) return `EXDATE;VALUE=DATE:${compactDate(dateKey)}`
  const stamp = toUtcStamp(dateKey, event.start_time || '00:00')
  return stamp ? `EXDATE:${stamp}` : null
}

const recurrenceIdLine = (event, dateKey) => {
  if (event.all_day) return `RECURRENCE-ID;VALUE=DATE:${compactDate(dateKey)}`
  const stamp = toUtcStamp(dateKey, event.start_time || '00:00')
  return stamp ? `RECURRENCE-ID:${stamp}` : null
}

const dateLines = (item, skipped, type) => {
  if (type === 'VTODO') {
    if (item.allDay) {
      if (!validDate(item.startDate)) {
        skipped.value += 1
        return null
      }
      return [`DUE;VALUE=DATE:${compactDate(item.startDate)}`]
    }
    const due = toUtcStamp(item.startDate, item.startTime || '09:00')
    if (!due) {
      skipped.value += 1
      return null
    }
    return [`DUE:${due}`]
  }
  if (item.allDay) {
    if (!validDate(item.startDate) || !validDate(item.endDate)) {
      skipped.value += 1
      return null
    }
    return [
      `DTSTART;VALUE=DATE:${compactDate(item.startDate)}`,
      `DTEND;VALUE=DATE:${compactDate(addDaysToKey(item.endDate, 1))}`
    ]
  }
  const startTime = item.startTime || '09:00'
  const endTime = item.endTime || startTime
  const start = toUtcStamp(item.startDate, startTime)
  const end = toUtcStamp(item.endDate, endTime)
  if (!start || !end) {
    skipped.value += 1
    return null
  }
  return [`DTSTART:${start}`, `DTEND:${end}`]
}

const componentLines = ({ type, uid, now, created, updated, item, calendarName, rrule, exdates, recurrenceId, skipped }) => {
  const dates = dateLines(item, skipped, type)
  if (!dates) return null
  const lines = [`BEGIN:${type}`, `UID:${uid}`, `DTSTAMP:${now}`]
  const createdStamp = sqliteStamp(created)
  const updatedStamp = sqliteStamp(updated)
  if (createdStamp) lines.push(`CREATED:${createdStamp}`)
  if (updatedStamp) lines.push(`LAST-MODIFIED:${updatedStamp}`)
  lines.push(`SUMMARY:${escapeText(item.title)}`)
  lines.push(...dates)
  if (rrule) lines.push(`RRULE:${rrule}`)
  if (recurrenceId) lines.push(recurrenceId)
  for (const exdate of exdates || []) {
    if (exdate) lines.push(exdate)
  }
  if (item.location) lines.push(`LOCATION:${escapeText(item.location)}`)
  if (item.notes) lines.push(`DESCRIPTION:${escapeText(item.notes)}`)
  if (calendarName) lines.push(`CATEGORIES:${escapeText(calendarName)}`)
  if (type === 'VTODO') {
    lines.push(`STATUS:${item.reminder_done || item.reminderDone ? 'COMPLETED' : 'NEEDS-ACTION'}`)
  } else {
    lines.push('STATUS:CONFIRMED')
  }
  lines.push(`END:${type}`)
  return lines
}

const fromOccurrence = item => ({
  calendarId: item.calendar_id,
  title: item.title,
  kind: item.kind,
  startDate: item.startDate,
  endDate: item.endDate,
  startTime: item.startTime,
  endTime: item.endTime,
  allDay: Boolean(item.allDay),
  location: item.location,
  notes: item.notes,
  reminderDone: Boolean(item.reminder_done),
  created: item.created_at,
  updated: item.updated_at,
  updatedAt: item.updatedAt || item.updated_at
})

const fromEvent = event => ({
  calendarId: event.calendar_id,
  title: event.title,
  kind: event.kind,
  startDate: event.start_date,
  endDate: event.end_date,
  startTime: event.start_time,
  endTime: event.end_time,
  allDay: Boolean(event.all_day),
  location: event.location,
  notes: event.notes,
  reminderDone: Boolean(event.reminder_done),
  created: event.created_at,
  updated: event.updated_at
})

const overlapsRange = (event, range) => {
  if (!range) return true
  const end = event.recurrence_type === 'none'
    ? event.end_date
    : (event.recurrence_end_date || '9999-12-31')
  return event.start_date <= range.endDate && end >= range.startDate
}

export function buildIcsExport({
  calendars = [],
  events = [],
  overrides = [],
  scope = 'month',
  range = null,
  eventId = null,
  occurrenceDate = null,
  calendarIds = null,
  expandRecurring = true,
  includeReminders = true,
  now = new Date()
} = {}) {
  const skipped = { value: 0 }
  const stamp = currentStamp(now)
  const calendarMap = new Map((calendars || []).map(calendar => [calendar.id, calendar]))
  const idFilter = calendarIds && calendarIds.size ? new Set(calendarIds) : null
  const allowed = event => {
    if (!event) return false
    if (idFilter && !idFilter.has(event.calendar_id)) return false
    if (!includeReminders && event.kind === 'reminder') return false
    return true
  }
  const calendarName = event => calendarMap.get(event.calendar_id)?.name || ''

  let selected = (events || []).filter(allowed)
  if (scope === 'event') {
    selected = selected.filter(event => Number(event.id) === Number(eventId))
  } else if (scope === 'month' || scope === 'range') {
    if (!range || !validDate(range.startDate) || !validDate(range.endDate) || range.endDate < range.startDate) {
      return {
        content: buildDocument([]),
        stats: { sourceEvents: 0, occurrences: 0, reminders: 0, skipped: 0, expanded: false }
      }
    }
    selected = selected.filter(event => overlapsRange(event, range))
  } else if (scope !== 'all') {
    return {
      content: buildDocument([]),
      stats: { sourceEvents: 0, occurrences: 0, reminders: 0, skipped: 0, expanded: false }
    }
  }

  const lines = []
  let occurrenceCount = 0
  let reminderCount = 0
  let sourceEvents = 0
  const expanded = scope !== 'all' && expandRecurring

  const pushComponent = (componentLinesResult, isReminder) => {
    if (!componentLinesResult) return
    lines.push(...componentLinesResult)
    if (isReminder) reminderCount += 1
    else occurrenceCount += 1
  }

  const pushExpanded = (event, items) => {
    const uidBase = `bongmaster-event-${event.id}`
    for (const item of items) {
      const data = fromOccurrence(item)
      if (!allowed({ ...event, calendar_id: data.calendarId })) continue
      pushComponent(
        componentLines({
          type: data.kind === 'reminder' ? 'VTODO' : 'VEVENT',
          uid: `${uidBase}-${compactDate(item.occurrenceDate)}@bongmaster.local`,
          now: stamp,
          created: data.created,
          updated: data.updated,
          item: data,
          calendarName: calendarName({ ...event, calendar_id: data.calendarId }),
          skipped
        }),
        data.kind === 'reminder'
      )
    }
  }

  const pushSeries = event => {
    const data = fromEvent(event)
    if (!validDate(data.startDate) || !validDate(data.endDate)) {
      skipped.value += 1
      return
    }
    const type = data.kind === 'reminder' ? 'VTODO' : 'VEVENT'
    const eventOverrides = (overrides || []).filter(override => Number(override.event_id) === Number(event.id))
    const cancelled = eventOverrides.filter(override => override.is_cancelled).map(override => override.occurrence_date)
    const modified = eventOverrides.filter(override => !override.is_cancelled)
    const rrule = buildRrule(event)
    const uid = `bongmaster-event-${event.id}@bongmaster.local`
    pushComponent(
      componentLines({
        type,
        uid,
        now: stamp,
        created: data.created,
        updated: data.updated,
        item: data,
        calendarName: calendarName(event),
        rrule,
        exdates: cancelled.map(date => exdateLine(event, date)),
        skipped
      }),
      type === 'VTODO'
    )
    for (const override of modified) {
      const occurrence = makeOccurrence(event, override.occurrence_date, override)
      if (!occurrence) continue
      const merged = fromOccurrence({
        ...occurrence,
        calendar_id: occurrence.calendar_id,
        reminder_done: event.reminder_done
      })
      if (!allowed({ ...event, calendar_id: merged.calendarId })) continue
      pushComponent(
        componentLines({
          type,
          uid,
          now: stamp,
          created: data.created,
          updated: merged.updatedAt || data.updated,
          item: merged,
          calendarName: calendarName({ ...event, calendar_id: merged.calendarId }),
          recurrenceId: recurrenceIdLine(event, override.occurrence_date),
          skipped
        }),
        type === 'VTODO'
      )
    }
  }

  if (scope === 'event' && expandRecurring) {
    const event = selected[0]
    if (event) {
      sourceEvents = 1
      const start = occurrenceDate || event.start_date
      const rangeForKey = { startDate: start, endDate: start }
      const items = expandOccurrences([event], overrides, rangeForKey.startDate, rangeForKey.endDate)
      pushExpanded(event, items)
    }
  } else if (expanded) {
    sourceEvents = selected.length
    const selectedMap = new Map(selected.map(event => [Number(event.id), event]))
    const items = expandOccurrences(selected, overrides, range.startDate, range.endDate)
    for (const item of items) {
      const event = selectedMap.get(Number(item.eventId))
      if (!event) continue
      const data = fromOccurrence(item)
      if (!allowed({ ...event, calendar_id: data.calendarId })) continue
      pushComponent(
        componentLines({
          type: data.kind === 'reminder' ? 'VTODO' : 'VEVENT',
          uid: `bongmaster-event-${event.id}-${compactDate(item.occurrenceDate)}@bongmaster.local`,
          now: stamp,
          created: data.created,
          updated: data.updated,
          item: data,
          calendarName: calendarName({ ...event, calendar_id: data.calendarId }),
          skipped
        }),
        data.kind === 'reminder'
      )
    }
  } else {
    sourceEvents = selected.length
    for (const event of selected) {
      if (event.recurrence_type === 'lunarYearly') {
        const start = event.start_date
        const horizon = event.recurrence_end_date || `${Number(String(start).slice(0, 4)) + 20}-12-31`
        const items = expandOccurrences([event], overrides, start, horizon).slice(0, 100)
        pushExpanded(event, items)
        continue
      }
      pushSeries(event)
    }
  }

  return {
    content: buildDocument(lines),
    stats: {
      sourceEvents,
      occurrences: occurrenceCount,
      reminders: reminderCount,
      skipped: skipped.value,
      expanded
    }
  }
}

export function buildIcsFromOccurrences({ calendars = [], items = [], now = new Date() } = {}) {
  const stamp = currentStamp(now)
  const skipped = { value: 0 }
  const calendarMap = new Map((calendars || []).map(calendar => [calendar.id, calendar]))
  const lines = []
  const seen = new Set()
  let occurrences = 0
  let reminderCount = 0
  for (const item of items || []) {
    if (!item || (item.sourceType && item.sourceType !== 'event')) {
      skipped.value += 1
      continue
    }
    const key = `${item.eventId || item.id}:${item.occurrenceDate || item.startDate}`
    if (seen.has(key)) continue
    seen.add(key)
    const data = fromOccurrence(item)
    const type = data.kind === 'reminder' ? 'VTODO' : 'VEVENT'
    const eventId = item.eventId || item.id
    const uid = `bongmaster-event-${eventId}-${compactDate(item.occurrenceDate || data.startDate)}@bongmaster.local`
    const component = componentLines({
      type,
      uid,
      now: stamp,
      created: data.created,
      updated: data.updated,
      item: data,
      calendarName: calendarMap.get(data.calendarId)?.name || '',
      skipped
    })
    if (!component) continue
    lines.push(...component)
    if (type === 'VTODO') reminderCount += 1
    else occurrences += 1
  }
  return {
    content: buildDocument(lines),
    stats: { occurrences, reminders: reminderCount, skipped: skipped.value }
  }
}

function buildDocument (lines) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const header = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BongMaster//Calendar Export//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:BongMaster'
  ]
  if (timezone) header.push(`X-WR-TIMEZONE:${timezone}`)
  const all = [...header, ...lines, 'END:VCALENDAR']
  return all.map(foldLine).join('\r\n') + '\r\n'
}
