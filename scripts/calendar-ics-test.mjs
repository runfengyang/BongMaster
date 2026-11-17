import assert from 'node:assert/strict'
import ICAL from 'ical.js'
import { LunarDay } from 'tyme4ts'
import { buildIcsExport, buildIcsFromOccurrences } from '../src/utils/calendar-ics.js'
import { expandOccurrences } from '../src/utils/calendar-recurrence.js'

const NOW = new Date('2026-11-13T00:00:00Z')
const calendars = [
  { id: 1, name: '日程', color: '#3b82f6' },
  { id: 2, name: '课程', color: '#8b5cf6' }
]

const base = {
  calendar_id: 1,
  title: '周会',
  kind: 'event',
  start_date: '2026-11-09',
  end_date: '2026-11-09',
  start_time: '09:00',
  end_time: '10:00',
  all_day: 0,
  location: '会议室',
  notes: '讨论议程',
  recurrence_type: 'weekly',
  recurrence_value: '1,3',
  recurrence_end_date: '2026-12-31',
  reminder_done: 0,
  created_at: '2026-11-01 10:00:00',
  updated_at: '2026-11-02 11:00:00'
}

const events = [
  { ...base, id: 1 },
  {
    ...base, id: 2, title: '全天培训', start_date: '2026-11-13', end_date: '2026-11-15',
    start_time: null, end_time: null, all_day: 1, recurrence_type: 'none', recurrence_value: '', recurrence_end_date: null
  },
  {
    ...base, id: 3, title: '工作日站会', start_date: '2026-11-09', end_date: '2026-11-09',
    start_time: '08:30', end_time: '08:45', recurrence_type: 'weekdays', recurrence_value: '', recurrence_end_date: null
  },
  {
    ...base, id: 4, title: '月度复盘', start_date: '2026-11-30', end_date: '2026-11-30',
    start_time: '16:00', end_time: '17:00', recurrence_type: 'monthly', recurrence_value: '', recurrence_end_date: null
  },
  {
    ...base, id: 5, title: '年度总结', start_date: '2026-12-31', end_date: '2026-12-31',
    start_time: '15:00', end_time: '16:00', recurrence_type: 'yearly', recurrence_value: '', recurrence_end_date: null
  },
  {
    ...base, id: 6, calendar_id: 2, title: '课程', start_date: '2026-11-10', end_date: '2026-11-10',
    start_time: '14:00', end_time: '15:00', recurrence_type: 'none', recurrence_value: '', recurrence_end_date: null
  },
  {
    ...base, id: 7, title: '交材料', kind: 'reminder', start_date: '2026-11-20', end_date: '2026-11-20',
    start_time: null, end_time: null, all_day: 1, recurrence_type: 'none', recurrence_value: '', recurrence_end_date: null,
    reminder_done: 1
  },
  {
    ...base, id: 8, title: '中秋', start_date: '2026-01-01', end_date: '2026-01-01',
    start_time: null, end_time: null, all_day: 1, recurrence_type: 'lunarYearly', recurrence_value: '8,15', recurrence_end_date: null
  }
]

const overrides = [
  {
    id: 1, event_id: 1, occurrence_date: '2026-11-16', is_cancelled: 1,
    calendar_id: null, title: null, kind: null, start_date: null, end_date: null,
    start_time: null, end_time: null, all_day: null, location: null, notes: null,
    created_at: '2026-11-03 10:00:00', updated_at: '2026-11-03 10:00:00'
  },
  {
    id: 2, event_id: 1, occurrence_date: '2026-11-18', is_cancelled: 0,
    calendar_id: 1, title: '改期周会', kind: 'event', start_date: '2026-11-19', end_date: '2026-11-19',
    start_time: '14:00', end_time: '15:00', all_day: 0, location: '线上', notes: '改到周四',
    created_at: '2026-11-04 10:00:00', updated_at: '2026-11-04 10:00:00'
  }
]

const build = (options = {}) => buildIcsExport({ calendars, events, overrides, now: NOW, ...options })
const parse = content => new ICAL.Component(ICAL.parse(content))
const findByUid = (root, uid) => root.getAllSubcomponents('vevent').find(component => component.getFirstPropertyValue('uid') === uid)

let result = build({ scope: 'all' })
assert.ok(result.content.includes('BEGIN:VCALENDAR\r\n'))
assert.ok(result.content.includes('VERSION:2.0'))
assert.ok(result.content.includes('METHOD:PUBLISH'))
assert.ok(result.content.includes('X-WR-CALNAME:BongMaster'))
assert.strictEqual(result.stats.skipped, 0)

const root = parse(result.content)
assert.ok(root.getAllSubcomponents('vevent').length >= 5)
assert.ok(root.getAllSubcomponents('vtodo').length >= 1)

const weekly = findByUid(root, 'bongmaster-event-1@bongmaster.local')
assert.ok(weekly)
assert.ok(weekly.getFirstPropertyValue('rrule').toString().includes('FREQ=WEEKLY'))
assert.ok(weekly.getFirstPropertyValue('rrule').toString().includes('BYDAY=MO,WE'))
assert.ok(weekly.getFirstPropertyValue('rrule').toString().includes('UNTIL='))
assert.strictEqual(weekly.getFirstPropertyValue('summary'), '周会')
assert.strictEqual(weekly.getFirstPropertyValue('location'), '会议室')
assert.strictEqual(weekly.getFirstPropertyValue('description'), '讨论议程')
const weeklyStart = weekly.getFirstPropertyValue('dtstart').toJSDate()
assert.strictEqual(weeklyStart.getTime(), new Date(2026, 10, 9, 9, 0, 0).getTime(), 'timed event must round-trip to the same instant')
const weeklyEnd = weekly.getFirstPropertyValue('dtend').toJSDate()
assert.strictEqual(weeklyEnd.getTime(), new Date(2026, 10, 9, 10, 0, 0).getTime())

const exdates = weekly.getAllProperties('exdate')
assert.strictEqual(exdates.length, 1)
assert.strictEqual(exdates[0].getFirstValue().toJSDate().getTime(), new Date(2026, 10, 16, 9, 0, 0).getTime())

const moved = [...root.getAllSubcomponents('vevent')].find(component => component.getFirstPropertyValue('summary') === '改期周会')
assert.ok(moved)
assert.strictEqual(moved.getFirstPropertyValue('uid'), 'bongmaster-event-1@bongmaster.local')
assert.ok(moved.getFirstPropertyValue('recurrence-id'))
assert.strictEqual(moved.getFirstPropertyValue('recurrence-id').toJSDate().getTime(), new Date(2026, 10, 18, 9, 0, 0).getTime())
assert.strictEqual(moved.getFirstPropertyValue('dtstart').toJSDate().getTime(), new Date(2026, 10, 19, 14, 0, 0).getTime())

const allDay = findByUid(root, 'bongmaster-event-2@bongmaster.local')
assert.ok(allDay)
assert.ok(allDay.getFirstProperty('dtstart').getFirstValue().isDate)
assert.strictEqual(allDay.getFirstPropertyValue('dtstart').toString(), '2026-11-13')
assert.strictEqual(allDay.getFirstPropertyValue('dtend').toString(), '2026-11-16', 'all-day DTEND must be exclusive')

const weekdays = findByUid(root, 'bongmaster-event-3@bongmaster.local')
assert.ok(weekdays.getFirstPropertyValue('rrule').toString().includes('BYDAY=MO,TU,WE,TH,FR'))
const monthly = findByUid(root, 'bongmaster-event-4@bongmaster.local')
assert.ok(monthly.getFirstPropertyValue('rrule').toString().includes('FREQ=MONTHLY'))
const yearly = findByUid(root, 'bongmaster-event-5@bongmaster.local')
assert.ok(yearly.getFirstPropertyValue('rrule').toString().includes('FREQ=YEARLY'))

const reminder = root.getAllSubcomponents('vtodo').find(component => component.getFirstPropertyValue('summary') === '交材料')
assert.ok(reminder)
assert.strictEqual(reminder.getFirstPropertyValue('status'), 'COMPLETED')
assert.strictEqual(reminder.getFirstPropertyValue('due').toString(), '2026-11-20')
assert.ok(!reminder.getFirstProperty('dtend'), 'VTODO must use DUE, not DTEND')

const lunar = result.content.match(/DTSTART;VALUE=DATE:20260925/g)
const lunarExpected = LunarDay.fromYmd(2026, 8, 15).getSolarDay()
assert.strictEqual(lunarExpected.getYear(), 2026)
const lunarKey = `${lunarExpected.getYear()}-${String(lunarExpected.getMonth()).padStart(2, '0')}-${String(lunarExpected.getDay()).padStart(2, '0')}`
assert.ok(lunar, `lunar occurrence ${lunarKey} should be expanded`)
assert.ok(result.content.includes(`DTSTART;VALUE=DATE:${lunarKey.replaceAll('-', '')}`))

const filtered = build({ scope: 'all', calendarIds: new Set([2]) })
assert.ok(!filtered.content.includes('SUMMARY:周会'))
assert.ok(filtered.content.includes('SUMMARY:课程'))
assert.ok(!filtered.content.includes('SUMMARY:交材料'))

const noReminders = build({ scope: 'all', includeReminders: false })
assert.ok(!noReminders.content.includes('BEGIN:VTODO'))
assert.strictEqual(noReminders.stats.reminders, 0)

const october = build({ scope: 'month', range: { startDate: '2026-10-01', endDate: '2026-10-31' } })
assert.strictEqual(october.stats.occurrences, 0, 'empty month should export nothing')
assert.ok(october.content.includes('BEGIN:VCALENDAR'))
assert.ok(october.content.includes('END:VCALENDAR'))

const week = build({ scope: 'range', range: { startDate: '2026-11-09', endDate: '2026-11-15' }, expandRecurring: true })
assert.ok(week.stats.expanded)
assert.ok(week.content.includes('DTSTART:') && !week.content.includes('RRULE:'))
assert.ok(week.content.includes('SUMMARY:全天培训'))
assert.ok(week.content.includes('SUMMARY:周会'))
const weekParsed = parse(week.content)
assert.ok(weekParsed.getAllSubcomponents('vevent').length >= 5)

const seriesWeek = build({ scope: 'range', range: { startDate: '2026-11-09', endDate: '2026-11-15' }, expandRecurring: false })
assert.ok(seriesWeek.content.includes('RRULE:FREQ=WEEKLY'))

const occurrence = build({ scope: 'event', eventId: 1, occurrenceDate: '2026-11-09', expandRecurring: true })
const occurrenceRoot = parse(occurrence.content)
assert.strictEqual(occurrenceRoot.getAllSubcomponents('vevent').length, 1)
assert.ok(!occurrence.content.includes('RRULE:'))
assert.ok(occurrence.content.includes('SUMMARY:周会'))
assert.strictEqual(occurrenceRoot.getFirstSubcomponent('vevent').getFirstPropertyValue('dtstart').toJSDate().getTime(), new Date(2026, 10, 9, 9, 0, 0).getTime())

const singleSeries = build({ scope: 'event', eventId: 1, expandRecurring: false })
assert.ok(singleSeries.content.includes('RRULE:FREQ=WEEKLY'))
assert.ok(singleSeries.content.includes('EXDATE:'))
assert.ok(singleSeries.content.includes('RECURRENCE-ID:'))

const stableA = build({ scope: 'all' })
const stableB = build({ scope: 'all' })
assert.strictEqual(stableA.content, stableB.content, 'same input and timestamp must produce identical output')

const longTitle = '这是一个非常长的中文日程标题用来验证折行不会切断多字节字符'.repeat(4)
const longEvent = {
  ...base, id: 99, title: longTitle, recurrence_type: 'none', recurrence_value: '', recurrence_end_date: null,
  start_date: '2026-11-13', end_date: '2026-11-13', all_day: 1, start_time: null, end_time: null
}
const longContent = buildIcsExport({ calendars, events: [longEvent], overrides: [], scope: 'all', now: NOW }).content
for (const line of longContent.split('\r\n')) {
  assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `line exceeds 75 bytes: ${line}`)
}
assert.ok(!/(^|[^\r])\n/.test(longContent), 'all line endings must be CRLF')
assert.ok(longContent.includes('\r\n'))

const parsedAll = parse(result.content)
assert.strictEqual(parsedAll.getAllSubcomponents('vevent').length, result.stats.occurrences)
assert.strictEqual(parsedAll.getAllSubcomponents('vtodo').length, result.stats.reminders)

const selectedOccurrences = expandOccurrences([events[0]], overrides, '2026-11-09', '2026-11-15')
assert.strictEqual(selectedOccurrences.length, 2)
const selected = buildIcsFromOccurrences({ calendars, items: selectedOccurrences, now: NOW })
assert.strictEqual(selected.stats.occurrences, 2)
assert.strictEqual(selected.stats.reminders, 0)
assert.strictEqual(selected.stats.skipped, 0)
const selectedRoot = parse(selected.content)
const selectedEvents = selectedRoot.getAllSubcomponents('vevent')
assert.strictEqual(selectedEvents.length, 2)
assert.ok(!selected.content.includes('RRULE:'))
assert.strictEqual(new Set(selectedEvents.map(event => event.getFirstPropertyValue('uid'))).size, 2)
assert.ok(selectedEvents.every(event => event.getFirstPropertyValue('summary') === '周会'))

const reminderOccurrence = expandOccurrences([events[6]], [], '2026-11-20', '2026-11-20')
const reminderOnly = buildIcsFromOccurrences({ calendars, items: reminderOccurrence, now: NOW })
assert.strictEqual(reminderOnly.stats.reminders, 1)
assert.strictEqual(reminderOnly.stats.occurrences, 0)
assert.ok(reminderOnly.content.includes('BEGIN:VTODO'))
assert.ok(reminderOnly.content.includes('STATUS:COMPLETED'))

const withUnsupported = buildIcsFromOccurrences({
  calendars,
  items: [
    ...selectedOccurrences,
    { sourceType: 'task', title: '项目任务' },
    { sourceType: 'reminder', title: '提醒清单' }
  ],
  now: NOW
})
assert.strictEqual(withUnsupported.stats.occurrences, 2)
assert.strictEqual(withUnsupported.stats.skipped, 2)
assert.ok(!withUnsupported.content.includes('项目任务'))
assert.ok(!withUnsupported.content.includes('提醒清单'))

const deduped = buildIcsFromOccurrences({ calendars, items: [selectedOccurrences[0], selectedOccurrences[0]], now: NOW })
assert.strictEqual(deduped.stats.occurrences, 1)

console.log('Calendar ICS tests passed')
