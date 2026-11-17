import assert from 'node:assert/strict'
import { DEFAULT_SALARY_SETTINGS, calculateDaySalary, calculateSalarySnapshot, countMonthlyWorkdays, validateSalarySettings } from '../src/utils/salary-calculator.js'

const salary = { ...DEFAULT_SALARY_SETTINGS, amount: 21000, currency: 'CNY' }
const work = { work_start: '09:00', work_end: '18:00', workdays: '1,2,3,4,5', lunch_break_minutes: 0 }
const at = (day, time) => new Date(`2026-11-${String(day).padStart(2, '0')}T${time}:00`)
const row = (day, start, end = null, pauses = []) => ({
  work_date: `2026-11-${String(day).padStart(2, '0')}`,
  check_in_at: start ? `2026-11-${String(day).padStart(2, '0')} ${start}:00` : null,
  check_out_at: end ? `2026-11-${String(day).padStart(2, '0')} ${end}:00` : null,
  pauses
})
const day = (record, time = '20:00', config = work) => calculateDaySalary(record, salary, config, new Date(`${record.work_date}T${time}:00`))

assert.deepEqual(Object.keys(DEFAULT_SALARY_SETTINGS).sort(), ['amount', 'currency'])
assert.equal(validateSalarySettings(salary), null)
assert.equal(validateSalarySettings({ amount: 21000, currency: 'CNY', workStart: 'bad', breakEnabled: true }), null)
assert.equal(countMonthlyWorkdays(work, at(9, '12:00')), 21)
assert.equal(countMonthlyWorkdays({ ...work, workdays: '1,2,3,4,5,6,7' }, at(9, '12:00')), 30)
assert.equal(day(row(9, '09:00', '18:00')).earned, 1000)
assert.equal(day(row(9, '09:00', '18:00')).standardSeconds, 9 * 3600)
assert.equal(day(row(9, '09:00', '18:00'), '20:00', { ...work, lunch_break_minutes: 60 }).earned, 1000)
assert.ok(Math.abs(day(row(9, '09:30', '18:00')).earned - 1000 * 8.5 / 9) < 1e-10)
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`)
near(day(row(9, '09:00', '20:00')).earned, 1000 * 13 / 9)
near(day(row(9, '08:00', '18:00')).earned, 1000 * 11 / 9)
assert.equal(day(row(9, '09:00', '20:00')).regularEarned, 1000)
near(day(row(9, '09:00', '20:00')).overtimeEarned, 1000 * 4 / 9)
assert.equal(day(row(8, '09:00', '18:00')).earned, 2000)
near(day(row(9, '09:00'), '10:00').earned, 1000 / 9)
near(day(row(9, '09:00'), '20:00').earned, 1000 * 13 / 9)
near(day(row(9, '09:00', null, [{ start: '2026-11-09 12:00:00', end: null }]), '12:30').earned, 1000 / 3)
near(day(row(9, '09:00', '19:00', [{ start: '2026-11-09 12:00:00', end: '2026-11-09 13:00:00' }])).earned, 10000 / 9)
assert.equal(day(row(9, '12:00'), '10:00').earned, 0)
assert.equal(day(row(9, null)).earned, 0)
near(calculateDaySalary({ ...row(9, '09:00'), work_date: '2026-11-09', check_in_at: '2026-11-09 22:00:00', check_out_at: '2026-11-10 02:00:00' }, salary, work, at(10, '20:00')).earned, 8000 / 9)

const snapshot = calculateSalarySnapshot(salary, work, [row(6, '09:00', '18:00'), row(9, '09:00', '20:00')], at(9, '20:00'))
near(snapshot.earned, 1000 * 13 / 9)
near(snapshot.weeklyEarned, 1000 * 13 / 9)
near(snapshot.monthlyEarned, 1000 + 1000 * 13 / 9)
assert.equal(snapshot.regularEarned, 1000)
near(snapshot.overtimeEarned, 1000 * 4 / 9)
const overnight = row(2, '09:00', '18:00')
overnight.check_in_at = '2026-11-02 22:00:00'
overnight.check_out_at = '2026-11-03 02:00:00'
near(calculateSalarySnapshot(salary, work, [overnight], at(3, '20:00')).monthlyEarned, 8000 / 9)
assert.equal(snapshot.workedSeconds, 11 * 3600)
assert.equal(snapshot.perSecond, 1000 / 32400)
assert.equal(snapshot.status, 'after')
assert.equal(calculateSalarySnapshot(salary, work, [row(9, '09:00')], at(9, '10:00')).status, 'working')
assert.equal(calculateSalarySnapshot(salary, work, [], at(9, '10:00')).earned, 0)
assert.equal(calculateSalarySnapshot(salary, work, [], at(9, '10:00')).isWorkday, true)
const crossMonth = calculateSalarySnapshot(salary, { ...work, workdays: '1,7' }, [
  { work_date: '2026-10-26', check_in_at: '2026-10-26 09:00:00', check_out_at: '2026-10-26 18:00:00' },
  row(1, '09:00', '18:00')
], at(1, '18:00'))
near(crossMonth.weeklyEarned, 21000 / 8 + 21000 / 10)

for (const change of [{ amount: 0 }, { amount: -1 }, { amount: Infinity }, { amount: '21000' }, { amount: 1e13 }, { currency: 'BAD' }]) {
  assert.equal(typeof validateSalarySettings({ ...salary, ...change }), 'string')
  assert.throws(() => calculateDaySalary(row(9, '09:00', '18:00'), { ...salary, ...change }, work, at(9, '20:00')))
}
assert.equal(typeof validateSalarySettings(null), 'string')
assert.throws(() => calculateDaySalary(row(9, '09:00'), salary, work, new Date(NaN)))
console.log('Salary calculator: attendance-driven normal pay, overtime, pauses, day/week/month totals, and validation passed')
