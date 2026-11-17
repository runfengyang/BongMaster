import assert from 'node:assert/strict'
import { planMacSync } from '../src/utils/calendar-mac-sync.js'

const local = (id, updatedAtMs, overrides = {}) => ({
  eventId: id,
  occurrenceDate: '2026-11-12',
  startDate: '2026-11-12',
  endDate: '2026-11-12',
  startTime: '10:00',
  endTime: '11:00',
  allDay: false,
  title: `本地${id}`,
  location: '',
  notes: '',
  recurrence_type: 'none',
  updatedAtMs,
  ...overrides
})
const mac = (uid, stampMs, overrides = {}) => ({
  uid,
  stamp: '2026-11-09 20:00:00',
  stampMs,
  title: `macOS ${uid}`,
  startDate: '2026-11-12',
  endDate: '2026-11-12',
  startTime: '10:00',
  endTime: '11:00',
  allDay: false,
  description: '',
  location: '',
  ...overrides
})
const plan = data => planMacSync({ startDate: '2026-11-01', endDate: '2026-11-30', ...data })

let result = plan({ localItems: [local(1, 2000)], macEvents: [], records: [] })
assert.equal(result.macCreates.length, 1)
assert.equal(result.macCreates[0].payload.marker, 'bm:1:2026-11-12')

result = plan({ localItems: [], macEvents: [mac('u1', 2000)], records: [] })
assert.equal(result.localCreates.length, 1)
assert.equal(result.localCreates[0].payload.title, 'macOS u1')

result = plan({ localItems: [local(1, 3000)], macEvents: [mac('u1', 2000, { description: '[bm:1:2026-11-12]' })], records: [] })
assert.equal(result.macUpdates.length, 1)

result = plan({ localItems: [local(1, 1000)], macEvents: [mac('u1', 2000, { description: '[bm:1:2026-11-12]', title: '本地1' })], records: [] })
assert.equal(result.localUpdates.length, 1)

const record = { local_key: '1:2026-11-12', mac_uid: 'u1', last_local_updated: '2000', last_mac_updated: '2000' }
result = plan({ localItems: [local(1, 2000)], macEvents: [mac('u1', 2000, { title: '本地1' })], records: [record] })
assert.equal(result.macUpdates.length, 0)
assert.equal(result.localUpdates.length, 0)

result = plan({ localItems: [local(1, 2000)], macEvents: [], records: [record] })
assert.equal(result.localDeletes.length, 1)

result = plan({ localItems: [], macEvents: [mac('u1', 2000)], records: [record] })
assert.equal(result.macDeletes.length, 1)

result = plan({ localItems: [], macEvents: [mac('u1', 2000, { description: '[bm:9:2026-11-12]' })], records: [] })
assert.equal(result.macDeletes.length, 1)

result = plan({ localItems: [local(1, 5000)], macEvents: [mac('u1', 4000, { description: '[bm:1:2026-11-12]' })], records: [record] })
assert.equal(result.macUpdates.length, 1)

result = plan({ localItems: [local(1, 3000)], macEvents: [mac('u1', 4000, { description: '[bm:1:2026-11-12]' })], records: [record] })
assert.equal(result.localUpdates.length, 1)

result = plan({
  localItems: [local(1, 3000, { macCalendar: 'BongMaster · 课程' })],
  macEvents: [mac('u1', 2000, { description: '[bm:1:2026-11-12]', calendarName: 'BongMaster' })],
  records: []
})
assert.equal(result.macDeletes.length, 1)
assert.equal(result.macCreates.length, 1)
assert.equal(result.macCreates[0].payload.calendarName, 'BongMaster · 课程')
assert.equal(result.macUpdates.length, 0)

result = plan({
  localItems: [local(1, 1000, { macCalendar: 'BongMaster · 课程' })],
  macEvents: [mac('u1', 2000, { description: '[bm:1:2026-11-12]', calendarName: 'BongMaster' })],
  records: []
})
assert.equal(result.macDeletes.length, 1)
assert.equal(result.macCreates.length, 1)
assert.equal(result.localUpdates.length, 1)

console.log('Calendar macOS sync tests passed')
