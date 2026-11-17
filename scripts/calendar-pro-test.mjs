import assert from 'node:assert/strict'
import { createServer } from 'vite'

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
try {
  const {
    makeMonthGrid,
    makeSelectedDateSummary,
    getCalendarProDay,
    expandOccurrences,
    getHoliday,
    getHolidayCoverage,
    hasHolidayData
  } = await server.ssrLoadModule('/src/utils/calendar-pro.js')

  const grid = makeMonthGrid('2026-11-09', '2026-11-09', '2026-11-09')
  assert.equal(grid.length, 42)
  assert.equal(grid[0].date, '2026-10-26')
  assert.equal(grid[41].date, '2026-12-06')
  assert.equal(grid.find(day => day.date === '2026-10-26').isInDisplayedMonth, false)
  assert.equal(grid.find(day => day.date === '2026-11-01').isInDisplayedMonth, true)
  assert.equal(grid.find(day => day.date === '2026-11-09').isSelected, true)

  const lunarDay = getCalendarProDay('2026-11-09', '2026-11-09', '2026-11-09')
  assert.equal(lunarDay.dayNumber, 9)
  assert.equal(lunarDay.weekdayLabel, '周一')
  assert.equal(lunarDay.lunarText, '十月')
  assert.equal(lunarDay.subtitle, '十月')
  assert.equal(lunarDay.lunar.solarTermName, null)
  assert.equal(lunarDay.almanac.dutyName, '建')
  assert.equal(lunarDay.almanac.naYin, '屋上土')
  assert.deepEqual(lunarDay.almanac.recommends.slice(0, 3), ['祭祀', '沐浴', '馀事勿取'])

  const springFestival = getCalendarProDay('2026-02-17', '2026-02-01', '2026-11-09')
  assert.equal(springFestival.subtitle, '春节')
  assert.equal(springFestival.badge, '休')
  assert.equal(springFestival.holiday.kind, 'statutoryHoliday')

  const adjustedWorkday = getCalendarProDay('2026-10-10', '2026-10-01', '2026-11-09')
  assert.equal(adjustedWorkday.badge, '班')
  assert.equal(adjustedWorkday.holiday.kind, 'workingAdjustmentDay')

  const summary = makeSelectedDateSummary('2026-09-25', grid)
  assert.equal(summary.dateText, '9月25日')
  assert.equal(summary.weekdayText, '周五')
  assert.equal(summary.lunarText, '丙午年八月十五')
  assert.equal(summary.chips.includes('中秋节'), true)
  assert.equal(summary.chips.includes('休'), true)

  const course = {
    id: 7, title: '量化投资', kind: 'class', calendar_id: 2,
    start_date: '2026-11-02', end_date: '2026-11-02',
    start_time: '10:00', end_time: '11:30', all_day: 0,
    recurrence_type: 'weekly', recurrence_value: '1,3', recurrence_end_date: '2026-11-13'
  }
  const occurrences = expandOccurrences([course], [
    { id: 1, event_id: 7, occurrence_date: '2026-11-04', is_cancelled: 1 },
    { id: 2, event_id: 7, occurrence_date: '2026-11-09', is_cancelled: 0, start_time: '14:00', end_time: '15:30' }
  ], '2026-11-01', '2026-11-15')
  assert.deepEqual(occurrences.map(item => item.startDate), ['2026-11-02', '2026-11-09', '2026-11-11'])
  assert.equal(occurrences.find(item => item.startDate === '2026-11-09').startTime, '14:00')
  assert.equal(getHoliday('2026-01-01', 'mainland-cn')?.name, '元旦')
  assert.equal(getHoliday('2026-04-03', 'hong-kong')?.name, 'Good Friday')
  assert.equal(getHoliday('2026-02-17', 'mainland-cn')?.name, '春节')
  assert.equal(getHoliday('2026-02-17', 'us'), null)
  assert.equal(getHoliday('2026-10-01', 'us'), null)
  assert.equal(getHoliday('2026-10-10', 'hong-kong'), null)
  assert.equal(hasHolidayData('mainland-cn', 2026), true)
  assert.equal(hasHolidayData('mainland-cn', 2027), false)
  assert.deepEqual(getHolidayCoverage('mainland-cn'), { min: 2021, max: 2026 })

  const ghost = expandOccurrences([course], [
    { id: 3, event_id: 7, occurrence_date: '2026-11-16', is_cancelled: 0, title: '越界覆盖' }
  ], '2026-11-01', '2026-11-30')
  assert.equal(ghost.some(item => item.title === '越界覆盖'), false)
  const single = { ...course, recurrence_type: 'none', recurrence_end_date: null }
  const overriddenSingle = expandOccurrences([single], [
    { id: 4, event_id: 7, occurrence_date: '2026-11-02', is_cancelled: 0, title: '旧覆盖' }
  ], '2026-11-01', '2026-11-30')
  assert.equal(overriddenSingle.length, 1)
  assert.equal(overriddenSingle[0].title, '量化投资')

  const lunarEvent = {
    id: 99, title: '农历生日', start_date: '2026-09-23', end_date: '2026-09-23',
    all_day: 1, recurrence_type: 'lunarYearly', recurrence_value: '8,13', recurrence_end_date: null
  }
  const lunarOccurrences = expandOccurrences([lunarEvent], [], '2026-01-01', '2028-12-31')
  assert.deepEqual(lunarOccurrences.map(item => item.startDate), ['2026-09-23', '2027-09-13', '2028-10-01'])
  const lunarNextYear = expandOccurrences([lunarEvent], [], '2027-01-01', '2027-12-31')
  assert.deepEqual(lunarNextYear.map(item => item.startDate), ['2027-09-13'])

  console.log('Calendar Pro port tests passed')
} finally {
  await server.close()
}
