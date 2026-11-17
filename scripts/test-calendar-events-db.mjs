import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import os from 'os'
import path from 'path'
import fs from 'fs'

const require = createRequire(import.meta.url)
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { DatabaseService } = require(path.join(projectRoot, 'electron/services/database-service.js'))

let failures = 0
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail === undefined ? '' : ` -> ${JSON.stringify(detail)}`}`)
  if (!ok) failures++
}
const equal = (name, actual, expected) => check(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected })
const throws = (name, fn) => {
  try { fn(); check(name, false, '没有抛错') } catch { check(name, true) }
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-calendar-db-'))
const newService = name => {
  const dir = path.join(tmpRoot, name)
  fs.mkdirSync(dir, { recursive: true })
  const service = new DatabaseService(path.join(dir, 'database.db'), path.join(dir, 'uploads'))
  service.initialize()
  return service
}

const db = newService('main')
const calendars = db.getCalendarCalendars()
equal('迁移：播种日程和课程分类', calendars.map(item => item.name), ['日程', '课程', '提醒事项'])
const eventCalendar = calendars.find(item => item.name === '日程')
const classCalendar = calendars.find(item => item.name === '课程')

const course = db.createCalendarEvent({
  calendar_id: classCalendar.id,
  title: '量化投资',
  kind: 'class',
  start_date: '2026-11-09',
  end_date: '2026-11-09',
  start_time: '10:00',
  end_time: '11:30',
  location: 'A201',
  recurrence_type: 'weekly',
  recurrence_value: '1,3,5',
  recurrence_end_date: '2026-11-20'
})
check('创建：固定课程返回 ID 和规范字段', Number.isInteger(course.id) && course.kind === 'class' && course.all_day === 0, course)

const single = db.createCalendarEvent({
  calendar_id: eventCalendar.id,
  title: '组会',
  start_date: '2026-11-10',
  end_date: '2026-11-10',
  all_day: true,
  notes: '线上会议'
})
check('创建：全天日程清空时分', single.all_day === 1 && single.start_time === null && single.end_time === null, single)

const reminderCalendar = calendars.find(item => item.name === '提醒事项')
const reminder = db.createCalendarEvent({
  calendar_id: reminderCalendar.id,
  title: '交材料',
  kind: 'reminder',
  start_date: '2026-11-11',
  start_time: '10:00',
  end_time: '11:00',
  all_day: false
})
check('提醒事项：强制全天并清空时间', reminder.kind === 'reminder' && reminder.all_day === 1 && reminder.start_time === null && reminder.end_time === null && reminder.end_date === reminder.start_date, reminder)
db.createCalendarEvent({ calendar_id: eventCalendar.id, title: '区间外', start_date: '2026-10-01' })

const range = db.getCalendarData('2026-11-09', '2026-11-20')
equal('区间：返回可能落入范围的重复课程', range.events.some(item => item.id === course.id), true)
equal('区间：返回单日日程', range.events.some(item => item.id === single.id), true)
equal('区间：排除区间外日程', range.events.some(item => item.title === '区间外'), false)
equal('区间：同时返回分类', range.calendars.length, 3)
equal('搜索：匹配课程标题', db.searchCalendarEvents('量化').map(item => item.id), [course.id])
equal('搜索：匹配备注', db.searchCalendarEvents('线上').map(item => item.id), [single.id])
equal('搜索：无结果', db.searchCalendarEvents('不存在'), [])

throws('校验：拒绝空标题', () => db.createCalendarEvent({ calendar_id: eventCalendar.id, title: ' ', start_date: '2026-11-10' }))
throws('校验：拒绝非法日期', () => db.createCalendarEvent({ calendar_id: eventCalendar.id, title: 'x', start_date: '2026-02-30' }))
throws('校验：拒绝同日结束早于开始', () => db.createCalendarEvent({ calendar_id: eventCalendar.id, title: 'x', start_date: '2026-11-10', start_time: '11:00', end_time: '10:00' }))
throws('校验：每周重复至少选择一天', () => db.createCalendarEvent({ calendar_id: classCalendar.id, title: 'x', start_date: '2026-11-10', recurrence_type: 'weekly', recurrence_value: '' }))
throws('校验：拒绝不存在的分类', () => db.createCalendarEvent({ calendar_id: 999999, title: 'x', start_date: '2026-11-10' }))

const custom = db.createCalendar({ name: '临时分类', color: '#ef4444' })
const customEvent = db.createCalendarEvent({ calendar_id: custom.id, title: '需要保留', start_date: '2026-11-12' })
db.deleteCalendar(custom.id)
equal('分类删除：事件迁移到默认日程', db.getCalendarEventById(customEvent.id).calendar_id, eventCalendar.id)
throws('分类删除：拒绝删除内置分类', () => db.deleteCalendar(eventCalendar.id))

db.updateCalendarEvent(course.id, { title: '量化投资（调课）', start_time: '14:00', end_time: '15:30' }, { occurrenceDate: '2026-11-11', scope: 'this' })
const singleOverride = db.db.prepare('SELECT * FROM calendar_event_overrides WHERE event_id = ? AND occurrence_date = ?').get(course.id, '2026-11-11')
equal('仅此次：写入单次时间覆盖', singleOverride?.start_time, '14:00')
equal('仅此次：原系列标题不被修改', db.getCalendarEventById(course.id).title, '量化投资')

db.updateCalendarEvent(course.id, { title: '量化投资（后半学期）' }, { occurrenceDate: '2026-11-16', scope: 'future' })
equal('未来：旧系列在上一日截止', db.getCalendarEventById(course.id).recurrence_end_date, '2026-11-15')
const futureCourse = db.db.prepare('SELECT * FROM calendar_events WHERE title = ?').get('量化投资（后半学期）')
equal('未来：新系列从选中日期开始', futureCourse?.start_date, '2026-11-16')
equal('未来：新系列保留每周规则', futureCourse?.recurrence_value, '1,3,5')

const futureEdit = db.createCalendarEvent({ calendar_id: classCalendar.id, title: '未来编辑课', start_date: '2026-11-02', recurrence_type: 'weekly', recurrence_value: '1,3', recurrence_end_date: '2026-11-30' })
db.updateCalendarEvent(futureEdit.id, { title: '未来编辑课（单次）' }, { occurrenceDate: '2026-11-18', scope: 'this' })
const futureEditResult = db.updateCalendarEvent(futureEdit.id, { title: '未来编辑课（后半）' }, { occurrenceDate: '2026-11-16', scope: 'future' })
const migratedOverride = db.db.prepare('SELECT * FROM calendar_event_overrides WHERE occurrence_date = ?').get('2026-11-18')
equal('未来编辑：未来例外迁移到新系列', migratedOverride?.event_id, futureEditResult.id)
equal('未来编辑：旧系列不再持有未来例外', db.db.prepare('SELECT COUNT(*) AS n FROM calendar_event_overrides WHERE event_id = ? AND occurrence_date >= ?').get(futureEdit.id, '2026-11-16').n, 0)
db.updateCalendarEvent(futureEditResult.id, { recurrence_type: 'none', recurrence_value: '', recurrence_end_date: null }, { scope: 'all' })
equal('改为不重复：清理历史例外', db.db.prepare('SELECT COUNT(*) AS n FROM calendar_event_overrides WHERE event_id = ?').get(futureEditResult.id).n, 0)

const cancelled = db.deleteCalendarEvent(futureCourse.id, { occurrenceDate: '2026-11-18', scope: 'this' })
equal('单次删除：系列仍存在', !!db.getCalendarEventById(futureCourse.id), true)
equal('单次删除：写入取消例外', db.db.prepare('SELECT is_cancelled FROM calendar_event_overrides WHERE event_id = ? AND occurrence_date = ?').get(futureCourse.id, '2026-11-18')?.is_cancelled, 1)
db.restoreCalendarEvents(cancelled)
equal('单次删除撤回：取消例外移除', db.db.prepare('SELECT * FROM calendar_event_overrides WHERE event_id = ? AND occurrence_date = ?').get(futureCourse.id, '2026-11-18'), undefined)

const seminar = db.createCalendarEvent({ calendar_id: classCalendar.id, title: '研讨课', start_date: '2026-11-03', recurrence_type: 'weekly', recurrence_value: '2', recurrence_end_date: '2026-11-30' })
const futureDeleted = db.deleteCalendarEvent(seminar.id, { occurrenceDate: '2026-11-17', scope: 'future' })
equal('未来删除：截断旧系列', db.getCalendarEventById(seminar.id).recurrence_end_date, '2026-11-16')
db.restoreCalendarEvents(futureDeleted)
equal('未来删除撤回：恢复截止日期', db.getCalendarEventById(seminar.id).recurrence_end_date, '2026-11-30')

const allDeleted = db.deleteCalendarEvent(course.id, { scope: 'all' })
equal('全部删除：事件不可见', db.getCalendarEventById(course.id), undefined)
equal('全部删除：例外级联删除', db.db.prepare('SELECT * FROM calendar_event_overrides WHERE event_id = ?').all(course.id).length, 0)
db.restoreCalendarEvents(allDeleted)
equal('全部删除撤回：恢复原 ID', db.getCalendarEventById(course.id)?.id, course.id)
equal('全部删除撤回：恢复单次例外', db.db.prepare('SELECT * FROM calendar_event_overrides WHERE event_id = ?').all(course.id).length, 1)
throws('重复编辑：缺少原日期时拒绝', () => db.updateCalendarEvent(seminar.id, { title: 'x' }, { scope: 'this' }))
throws('未来删除：缺少原日期时拒绝且不误删系列', () => db.deleteCalendarEvent(seminar.id, { scope: 'future' }))
const cancelAdjusted = db.deleteCalendarEvent(course.id, { occurrenceDate: '2026-11-11', scope: 'this' })
db.restoreCalendarEvents(cancelAdjusted)
equal('单次取消撤回：保留此前调课内容', db.db.prepare('SELECT start_time FROM calendar_event_overrides WHERE event_id = ? AND occurrence_date = ?').get(course.id, '2026-11-11')?.start_time, '14:00')
const movedOutside = db.createCalendarEvent({ calendar_id: classCalendar.id, title: '移到下个月', start_date: '2026-11-01', recurrence_type: 'daily', recurrence_end_date: '2026-11-05' })
db.updateCalendarEvent(movedOutside.id, { start_date: '2026-12-01', end_date: '2026-12-01' }, { occurrenceDate: '2026-11-03', scope: 'this' })
const movedRange = db.getCalendarData('2026-12-01', '2026-12-01')
equal('区间：原系列已截止但被移入的课程仍返回', movedRange.events.some(item => item.id === movedOutside.id), true)

throws('内置分类：禁止重命名', () => db.updateCalendar(eventCalendar.id, { name: '改名日程' }))
const shifted = db.createCalendarEvent({ calendar_id: classCalendar.id, title: '整体平移课', start_date: '2026-11-02', recurrence_type: 'weekly', recurrence_value: '1,3', recurrence_end_date: '2026-11-30' })
db.updateCalendarEvent(shifted.id, { start_time: '15:00', end_time: '16:00' }, { occurrenceDate: '2026-11-04', scope: 'this' })
db.updateCalendarEvent(shifted.id, { move_delta_days: 1 }, { scope: 'all' })
const shiftedAfter = db.getCalendarEventById(shifted.id)
equal('整体平移：开始日期同步后移一天', shiftedAfter.start_date, '2026-11-03')
equal('整体平移：每周星期同步为周二周四', shiftedAfter.recurrence_value, '2,4')
equal('整体平移：重复截止日同步后移', shiftedAfter.recurrence_end_date, '2026-12-01')
equal('整体平移：单次例外日期同步后移', db.db.prepare('SELECT occurrence_date FROM calendar_event_overrides WHERE event_id = ?').get(shifted.id)?.occurrence_date, '2026-11-05')

const futureShift = db.createCalendarEvent({ calendar_id: classCalendar.id, title: '未来平移课', start_date: '2026-11-02', recurrence_type: 'weekly', recurrence_value: '1,3', recurrence_end_date: '2026-11-30' })
db.updateCalendarEvent(futureShift.id, { title: '未来单次调课' }, { occurrenceDate: '2026-11-11', scope: 'this' })
const futureMoved = db.updateCalendarEvent(futureShift.id, { move_delta_days: 1 }, { occurrenceDate: '2026-11-09', scope: 'future' })
equal('未来平移：旧系列在选中日前结束', db.getCalendarEventById(futureShift.id).recurrence_end_date, '2026-11-08')
equal('未来平移：新系列从目标日期开始', futureMoved.start_date, '2026-11-10')
equal('未来平移：新系列同步星期与截止日', [futureMoved.recurrence_value, futureMoved.recurrence_end_date], ['2,4', '2026-12-01'])
const futureOverride = db.db.prepare('SELECT * FROM calendar_event_overrides WHERE event_id = ?').get(futureMoved.id)
equal('未来平移：未来例外迁移并同步日期', [futureOverride?.occurrence_date, futureOverride?.title], ['2026-11-12', '未来单次调课'])

db.db.close()
const reopened = new DatabaseService(path.join(tmpRoot, 'main', 'database.db'), path.join(tmpRoot, 'main', 'uploads'))
reopened.initialize()
equal('迁移：重复初始化不重复播种', reopened.getCalendarCalendars().length, 3)
reopened.db.close()

const source = newService('merge-source')
const sourceCalendar = source.createCalendar({ name: '导入课程分类', color: '#0ea5e9' })
const sourceEvent = source.createCalendarEvent({ calendar_id: sourceCalendar.id, title: '导入固定课', start_date: '2026-11-02', recurrence_type: 'weekly', recurrence_value: '1' })
source.updateCalendarEvent(sourceEvent.id, { title: '导入固定课（单次）' }, { occurrenceDate: '2026-11-09', scope: 'this' })
source.db.pragma('wal_checkpoint(TRUNCATE)')
const sourcePath = source.dbPath
source.db.close()

const target = newService('merge-target')
target.createCalendar({ name: '占位分类' })
target.createCalendarEvent({ title: '目标原有日程', start_date: '2026-11-01' })
const imported = await target.importData(sourcePath, 'merge')
equal('合并导入：执行成功', imported.success, true)
const importedEvent = target.db.prepare('SELECT * FROM calendar_events WHERE title = ?').get('导入固定课')
const importedCalendar = target.db.prepare('SELECT * FROM calendar_calendars WHERE name = ?').get('导入课程分类')
equal('合并导入：分类已写入', !!importedCalendar, true)
equal('合并导入：事件使用新分类 ID', importedEvent?.calendar_id, importedCalendar?.id)
check('合并导入：事件未沿用源 ID', importedEvent?.id !== undefined && importedEvent.id !== sourceEvent.id, { source: sourceEvent.id, imported: importedEvent?.id })
const importedOverride = target.db.prepare('SELECT * FROM calendar_event_overrides WHERE occurrence_date = ?').get('2026-11-09')
equal('合并导入：单次例外使用新事件 ID', importedOverride?.event_id, importedEvent?.id)
equal('合并导入：单次例外标题保留', importedOverride?.title, '导入固定课（单次）')
const lunarBirthday = target.createCalendarEvent({
  title: '农历生日', kind: 'reminder', start_date: '2026-09-23', end_date: '2026-09-23',
  all_day: 1, recurrence_type: 'lunarYearly', recurrence_value: '8,13'
})
equal('农历重复：类型保存', lunarBirthday.recurrence_type, 'lunarYearly')
equal('农历重复：值保存', lunarBirthday.recurrence_value, '8,13')

target.saveMacSyncRecords([
  { local_key: '1:2026-11-12', mac_uid: 'UID-1', last_local_updated: '1000', last_mac_updated: '2000' }
])
const macRecords = target.getMacSyncRecords()
equal('macOS 同步记录：写入', macRecords.length, 1)
equal('macOS 同步记录：UID', macRecords[0]?.mac_uid, 'UID-1')
target.deleteMacSyncRecords(['1:2026-11-12'])
equal('macOS 同步记录：删除', target.getMacSyncRecords().length, 0)

target.db.close()

console.log(failures ? `\n${failures} test(s) failed.` : '\nAll calendar database tests passed.')
process.exit(failures ? 1 : 0)
