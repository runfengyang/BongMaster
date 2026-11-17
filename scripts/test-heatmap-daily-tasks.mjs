// 首页活动热力图口径回归：每天完成数 = 项目任务完成数 + 每日任务完成数。
// 用临时数据库，不碰真实库。better-sqlite3 按 Electron ABI 编译，所以用:
//   ELECTRON_RUN_AS_NODE=1 npx electron scripts/test-heatmap-daily-tasks.mjs
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import os from 'os'
import path from 'path'
import fs from 'fs'

const require = createRequire(import.meta.url)
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { DatabaseService } = require(path.join(projectRoot, 'electron/services/database-service.js'))

let failures = 0

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`FAIL: ${message}`)
    console.error(`  expected: ${JSON.stringify(expected)}`)
    console.error(`  actual:   ${JSON.stringify(actual)}`)
    failures += 1
  } else {
    console.log(`PASS: ${message}`)
  }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-heatmap-daily-'))
const db = new DatabaseService(path.join(tmpDir, 'database.db'), path.join(tmpDir, 'uploads'))
db.initialize()

// 完成日期口径与现有项目任务一致：取 completed_at 的 UTC 日（'YYYY-MM-DD'）
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)
const isoAt = (offset) => new Date(Date.now() + offset * 86400000).toISOString()
const TODAY = day(0)
const YDAY = day(-1)
const D2 = day(-2)

const asMap = (rows) =>
  Object.fromEntries([...rows].sort((a, b) => (a.completed_date < b.completed_date ? -1 : 1)).map(r => [r.completed_date, r.count]))
const heatmap = (days = 365) => db.getTaskCompletionStats(days, { includeDailyTasks: true })
const projectOnly = (days = 365) => db.getTaskCompletionStats(days)

try {
  // ===== 空结果 =====
  assertEqual(projectOnly(), [], '空库：默认口径返回空数组')
  assertEqual(heatmap(), [], '空库：热力图口径返回空数组')

  // ===== 只有每日任务时（task_completions 为空，走 tasks 兜底分支）也要计入 =====
  const dailyToday = db.createDailyTask({ title: '每日-今天', date: TODAY })
  db.toggleDailyTaskComplete(dailyToday.id, true)
  assertEqual(asMap(heatmap()), { [TODAY]: 1 }, '仅每日任务：兜底分支下仍计入当天')

  // ===== 项目任务（既有口径不变）=====
  const project = db.createProject({ name: '热力图项目' })
  const taskToday = db.createTask({ project_id: project.id, name: '项目任务-今天' })
  db.updateTask(taskToday.id, { status: '已完成', completed_at: isoAt(0) })
  const taskYDay = db.createTask({ project_id: project.id, name: '项目任务-昨天' })
  db.updateTask(taskYDay.id, { status: '已完成', completed_at: isoAt(-1) })

  // ===== 旧数据：is_completed=1 但 completed_at 为空，退回任务日期 date =====
  const legacy = db.createDailyTask({ title: '旧数据已完成', date: D2 })
  db.db.prepare('UPDATE daily_tasks SET is_completed = 1, completed_at = NULL WHERE id = ?').run(legacy.id)

  // ===== 混合日期聚合 + 同日相加 =====
  assertEqual(asMap(heatmap()), { [D2]: 1, [YDAY]: 1, [TODAY]: 2 }, '混合日期：项目任务与每日任务按天相加')
  assertEqual(
    heatmap().map(r => r.completed_date),
    [D2, YDAY, TODAY],
    '返回结果按日期升序'
  )
  assertEqual(asMap(projectOnly()), { [YDAY]: 1, [TODAY]: 1 }, '默认口径仍只统计项目任务')

  // ===== 取消完成后不计数 =====
  const cancelable = db.createDailyTask({ title: '每日-取消', date: TODAY })
  db.toggleDailyTaskComplete(cancelable.id, true)
  assertEqual(asMap(heatmap())[TODAY], 3, '取消前：已完成每日任务计入')
  db.toggleDailyTaskComplete(cancelable.id, false)
  assertEqual(asMap(heatmap())[TODAY], 2, '取消完成后：不再计数')

  // ===== 按实际完成日期，而非计划日期 =====
  const scheduledYesterday = db.createDailyTask({ title: '每日-计划昨天今天完成', date: YDAY })
  db.toggleDailyTaskComplete(scheduledYesterday.id, true)
  assertEqual(asMap(heatmap()), { [D2]: 1, [YDAY]: 1, [TODAY]: 3 }, '按 completed_at 落在实际完成日，不改动计划日计数')

  // ===== 软删除不计数 =====
  const removed = db.createDailyTask({ title: '每日-软删除', date: TODAY })
  db.toggleDailyTaskComplete(removed.id, true)
  assertEqual(asMap(heatmap())[TODAY], 4, '软删除前：计入')
  db.deleteDailyTask(removed.id)
  assertEqual(asMap(heatmap())[TODAY], 3, '软删除后：不再计数')

  // ===== 子任务不重复计 =====
  const withSubtasks = db.createDailyTask({ title: '每日-带子任务', date: TODAY })
  db.toggleDailyTaskComplete(withSubtasks.id, true)
  db.createDailySubtask(withSubtasks.id, { title: '子1', is_completed: true })
  db.createDailySubtask(withSubtasks.id, { title: '子2', is_completed: true })
  assertEqual(asMap(heatmap())[TODAY], 4, '子任务完成不额外计数（父任务只算一次）')

  // ===== 未完成记录不计数 =====
  db.createDailyTask({ title: '每日-未完成', date: TODAY })
  assertEqual(asMap(heatmap())[TODAY], 4, '未完成的每日任务不计数')

  // ===== days 窗口过滤（沿用既有边界：date('now','-N days') 含当天与第 N 天前）=====
  assertEqual(asMap(heatmap(1)), { [YDAY]: 1, [TODAY]: 4 }, '1 天窗口排除 2 天前的记录')
  assertEqual(asMap(heatmap(2)), { [D2]: 1, [YDAY]: 1, [TODAY]: 4 }, '2 天窗口覆盖 2 天前的记录')

  // 项目任务取消完成后 task_completions 残留不清（既有项目任务口径，本次不改），
  // 这里只确认两种口径的差异完全来自每日任务。
  db.updateTask(taskToday.id, { status: '待办' })
  const heat = asMap(heatmap())
  const projectDays = asMap(projectOnly())
  assertEqual(projectDays[D2], undefined, '项目任务口径没有 2 天前的记录')
  assertEqual(heat[D2], 1, '2 天前只来自每日任务（旧数据退回 date）')
  assertEqual(heat[TODAY] - projectDays[TODAY], 3, '同日完成数差 = 3 个每日任务')
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true })
}

console.log(failures ? `\n${failures} test(s) failed.` : '\nAll heatmap daily-task tests passed.')
if (failures) process.exitCode = 1
