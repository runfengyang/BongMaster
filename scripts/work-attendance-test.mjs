import assert from 'node:assert/strict'
import {
  attendanceForRow,
  buildMonthCalendar,
  buildWorkSummary,
  buildWorkTrend,
  defaultWorkSettings,
  elapsedWorkSeconds,
  formatWorkClock,
  formatWorkDuration,
  standardDayMinutes,
  workHeatColor
} from '../src/utils/work-attendance.js'

const settings = { ...defaultWorkSettings, lunch_break_minutes: 60, grace_minutes: 5 }
const row = (date, checkIn, checkOut, pauses) => ({
  work_date: date,
  check_in_at: checkIn,
  check_out_at: checkOut,
  pauses: JSON.stringify(pauses || [])
})
const stamp = value => new Date(value.replace(' ', 'T'))

assert.equal(standardDayMinutes(settings), 540)
assert.equal(formatWorkDuration(510), '8小时30分')
assert.equal(formatWorkDuration(510, true), '8h30m')
assert.equal(formatWorkClock(3661), '1:01:01')
assert.equal(formatWorkClock(60), '0:01:00')
assert.equal(formatWorkClock(null), '--')

const normal = attendanceForRow(row('2026-11-09', '2026-11-09 09:02:00', '2026-11-09 18:32:00'), settings)
assert.equal(normal.workedMinutes, 570)
assert.equal(normal.lateMinutes, 0)
assert.equal(normal.earlyMinutes, 0)
assert.equal(normal.overtimeMinutes, 32)
assert.equal(normal.isWorkday, true)

const legacy = attendanceForRow({ work_date: '2026-11-16', check_in_at: '2026-11-16 09:00:00', check_out_at: '2026-11-16 18:00:00' }, settings)
assert.equal(legacy.workedMinutes, 540)
assert.deepEqual(legacy.pauses, [])
assert.equal(legacy.isPaused, false)

const late = attendanceForRow(row('2026-11-10', '2026-11-10 09:10:00', '2026-11-10 17:30:00'), settings)
assert.equal(late.lateMinutes, 5)
assert.equal(late.earlyMinutes, 25)

const overnight = attendanceForRow(row('2026-11-11', '2026-11-11 22:00:00', '2026-11-12 02:00:00'), settings)
assert.equal(overnight.workedMinutes, 240)
assert.equal(overnight.overtimeMinutes, 480)

const open = attendanceForRow(row('2026-11-12', '2026-11-12 09:00:00', null), settings)
assert.equal(open.isComplete, false)
assert.equal(open.workedMinutes, null)
assert.equal(open.isOpen, true)

const paused = attendanceForRow(row('2026-11-13', '2026-11-13 09:00:00', '2026-11-13 18:00:00', [
  { start: '2026-11-13 12:00:00', end: '2026-11-13 13:00:00' }
]), settings)
assert.equal(paused.pausedSeconds, 3600)
assert.equal(paused.pausedMinutes, 60)
assert.equal(paused.workedSeconds, 480 * 60)
assert.equal(paused.workedMinutes, 480)
assert.equal(paused.isPaused, false)
assert.equal(paused.pauses[0].seconds, 3600)
assert.equal(paused.pauses[0].minutes, 60)

const shortPause = attendanceForRow(row('2026-11-17', '2026-11-17 09:00:00', '2026-11-17 09:10:00', [
  { start: '2026-11-17 09:02:00', end: '2026-11-17 09:03:30' }
]), settings)
assert.equal(shortPause.pausedSeconds, 90)
assert.equal(shortPause.workedSeconds, 510)

const openPaused = attendanceForRow(row('2026-11-14', '2026-11-14 09:00:00', null, [
  { start: '2026-11-14 12:00:00', end: null }
]), settings)
assert.equal(openPaused.isPaused, true)
assert.equal(openPaused.workedMinutes, null)
assert.equal(elapsedWorkSeconds(openPaused, stamp('2026-11-14 12:30:00')), 180 * 60)
assert.equal(elapsedWorkSeconds(openPaused, stamp('2026-11-14 13:00:00')), 180 * 60)

const resumed = attendanceForRow(row('2026-11-14', '2026-11-14 09:00:00', null, [
  { start: '2026-11-14 12:00:00', end: '2026-11-14 13:00:00' }
]), settings)
assert.equal(elapsedWorkSeconds(resumed, stamp('2026-11-14 13:30:00')), 210 * 60)

const pauseOvertime = attendanceForRow(row('2026-11-15', '2026-11-15 09:00:00', '2026-11-15 19:30:00', [
  { start: '2026-11-15 18:00:00', end: '2026-11-15 19:00:00' }
]), settings)
assert.equal(pauseOvertime.workedSeconds, 570 * 60)
assert.equal(pauseOvertime.workedMinutes, 570)
assert.equal(pauseOvertime.overtimeMinutes, 30)

const summary = buildWorkSummary([
  row('2026-11-09', '2026-11-09 09:00:00', '2026-11-09 18:00:00'),
  row('2026-11-10', '2026-11-10 09:10:00', '2026-11-10 17:30:00'),
  row('2026-11-12', '2026-11-12 09:00:00', null),
  row('2026-10-31', '2026-10-31 09:00:00', '2026-10-31 18:00:00')
], settings, '2026-11-01')
assert.equal(summary.days, 2)
assert.equal(summary.openDays, 1)
assert.equal(summary.lateCount, 1)
assert.equal(summary.earlyCount, 1)
assert.equal(summary.totalMinutes, 540 + 500)
assert.equal(summary.averageMinutes, 520)

const trend = buildWorkTrend([
  row('2026-11-09', '2026-11-09 09:00:00', '2026-11-09 18:00:00')
], settings, '2026-11-09', 14)
assert.equal(trend.items.length, 14)
assert.equal(trend.items.at(-1).date, '2026-11-09')
assert.equal(trend.items.at(-1).minutes, 540)
assert.equal(trend.standardMinutes, 540)

assert.equal(buildMonthCalendar('2026-11-01').length, 42)
assert.equal(workHeatColor(0), '#f2f2f7')
assert.notEqual(workHeatColor(540, settings), '#f2f2f7')

console.log('Work attendance tests passed')
