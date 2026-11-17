import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { DatabaseService } = require('../electron/services/database-service')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-work-attendance-'))
const db = new DatabaseService(path.join(dir, 'database.db'), path.join(dir, 'uploads'))
db.initialize()

const failures = []
const check = (name, condition, detail) => {
  if (!condition) failures.push(name)
  console.log(`${condition ? 'PASS' : 'FAIL'}: ${name}${detail === undefined ? '' : ` -> ${JSON.stringify(detail)}`}`)
}

try {
  const settings = db.getWorkAttendanceSettings()
  check('默认工时设置', settings.work_start === '09:00' && settings.work_end === '18:00', settings)

  const created = db.checkInWork('2026-11-09', '2026-11-09 09:02:00')
  check('上班打卡', created.check_in_at === '2026-11-09 09:02:00', created)
  const duplicate = db.checkInWork('2026-11-09', '2026-11-09 09:30:00')
  check('同一天重复上班打卡不覆盖', duplicate.id === created.id && duplicate.check_in_at === '2026-11-09 09:02:00', duplicate)

  const closed = db.checkOutWork('2026-11-09', '2026-11-09 18:32:00')
  check('下班打卡', closed.check_out_at === '2026-11-09 18:32:00', closed)

  const range = db.getWorkAttendance('2026-11-01', '2026-11-30')
  check('按月查询', range.length === 1 && range[0].id === created.id, range)

  let checkoutError = ''
  try { db.checkOutWork('2026-11-10', '2026-11-10 18:00:00') } catch (error) { checkoutError = error.message }
  check('未上班不能下班', checkoutError.includes('请先上班打卡'), checkoutError)

  const manual = db.saveWorkAttendance({
    work_date: '2026-11-10', check_in_at: '2026-11-10 10:00:00', check_out_at: '2026-11-10 19:00:00', note: '补卡'
  })
  check('手动补卡', manual.note === '补卡' && manual.check_out_at === '2026-11-10 19:00:00', manual)
  const updated = db.saveWorkAttendance({ id: manual.id, work_date: '2026-11-10', check_in_at: '2026-11-10 10:00:00', check_out_at: '2026-11-10 18:00:00', note: '修改' })
  check('修改补卡', updated.note === '修改' && updated.check_out_at === '2026-11-10 18:00:00', updated)

  db.checkInWork('2026-11-11', '2026-11-11 09:00:00')
  const paused = db.pauseWork('2026-11-11', '2026-11-11 12:00:00')
  const pausedList = JSON.parse(paused.pauses)
  check('暂停打卡', pausedList.length === 1 && pausedList[0].start === '2026-11-11 12:00:00' && pausedList[0].end === null, pausedList)
  let pauseError = ''
  try { db.pauseWork('2026-11-11', '2026-11-11 12:10:00') } catch (error) { pauseError = error.message }
  check('重复暂停被拒绝', pauseError.includes('已在暂停中'), pauseError)
  const resumed = db.resumeWork('2026-11-11', '2026-11-11 12:40:00')
  check('恢复打卡', JSON.parse(resumed.pauses)[0].end === '2026-11-11 12:40:00', resumed.pauses)
  let resumeError = ''
  try { db.resumeWork('2026-11-11', '2026-11-11 13:00:00') } catch (error) { resumeError = error.message }
  check('未暂停时恢复被拒绝', resumeError.includes('当前未暂停'), resumeError)
  db.pauseWork('2026-11-11', '2026-11-11 18:00:00')
  const closedWithPause = db.checkOutWork('2026-11-11', '2026-11-11 18:30:00')
  const closedPauses = JSON.parse(closedWithPause.pauses)
  check('下班自动收尾暂停', closedPauses.length === 2 && closedPauses[1].end === '2026-11-11 18:30:00', closedPauses)

  const pausedManual = db.saveWorkAttendance({
    work_date: '2026-11-12', check_in_at: '2026-11-12 09:00:00', check_out_at: '2026-11-12 18:00:00',
    pauses: [{ start: '2026-11-12 12:00:00', end: '2026-11-12 12:30:00' }]
  })
  check('手动补卡保存暂停', JSON.parse(pausedManual.pauses).length === 1, pausedManual.pauses)
  let pauseValidationError = ''
  try {
    db.saveWorkAttendance({
      id: pausedManual.id, work_date: '2026-11-12', check_in_at: '2026-11-12 09:00:00', check_out_at: '2026-11-12 18:00:00',
      pauses: [{ start: '2026-11-12 13:00:00', end: '2026-11-12 12:00:00' }]
    })
  } catch (error) { pauseValidationError = error.message }
  check('暂停时间校验', pauseValidationError.includes('暂停结束时间'), pauseValidationError)
  const preserved = db.saveWorkAttendance({ id: pausedManual.id, work_date: '2026-11-12', check_in_at: '2026-11-12 09:00:00', check_out_at: '2026-11-12 18:00:00', note: '保留暂停' })
  check('未传暂停时保留原值', JSON.parse(preserved.pauses).length === 1, preserved.pauses)

  const savedSettings = db.saveWorkAttendanceSettings({ work_start: '08:30', work_end: '17:30', grace_minutes: 10, lunch_break_minutes: 60, workdays: '1,2,3,4,5' })
  check('保存工时设置', savedSettings.work_start === '08:30' && savedSettings.lunch_break_minutes === 60, savedSettings)

  check('删除打卡', db.deleteWorkAttendance(manual.id) === true && db.getWorkAttendance('2026-11-10', '2026-11-10').length === 0)
} finally {
  db.db.close()
  fs.rmSync(dir, { recursive: true, force: true })
}

console.log(failures.length ? `\n${failures.length} test(s) failed.` : '\nAll work attendance database tests passed.')
process.exit(failures.length ? 1 : 0)
