import { createRequire } from 'module'
import fs from 'fs'
import os from 'os'
import path from 'path'
import assert from 'assert'

const require = createRequire(import.meta.url)
const { DatabaseService } = require('../electron/services/database-service.js')

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-focus-reset-'))
const service = new DatabaseService(path.join(tmpDir, 'test.db'), path.join(tmpDir, 'uploads'))
service.initialize()

try {
  const today = new Date().toISOString().slice(0, 10)
  const taskA = service.createDailyTask({ title: '任务A', date: today, is_pinned: true })
  const taskB = service.createDailyTask({ title: '任务B', date: today })
  const sub = service.createDailySubtask(taskA.id, { title: '子任务S', is_pinned: true })
  assert.strictEqual(service.getDailyTaskById(taskA.id).is_pinned, 1)
  assert.strictEqual(service.getDailySubtaskById(sub.id).is_pinned, 1)

  // 首次运行（无重置记录）：应清空所有标记
  assert.strictEqual(service.resetDailyFocusIfNewDay(), true)
  assert.strictEqual(service.getDailyTaskById(taskA.id).is_pinned, 0)
  assert.strictEqual(service.getDailySubtaskById(sub.id).is_pinned, 0)
  assert.strictEqual(service.getDailyTaskById(taskB.id).is_pinned, 0)

  // 当天重新标记后，不应被重复清空
  service.updateDailyTask(taskA.id, { is_pinned: true })
  service.updateDailySubtask(sub.id, { is_pinned: true })
  assert.strictEqual(service.getDailyTaskById(taskA.id).is_pinned, 1)
  assert.strictEqual(service.getDailySubtaskById(sub.id).is_pinned, 1)
  assert.strictEqual(service.resetDailyFocusIfNewDay(), false)
  assert.strictEqual(service.getDailyTaskById(taskA.id).is_pinned, 1)
  assert.strictEqual(service.getDailySubtaskById(sub.id).is_pinned, 1)

  // 模拟跨天：重置日期改为昨天后，应再次清空
  service.db.prepare("UPDATE app_meta SET value = '2000-01-01' WHERE key = 'daily_focus_reset_date'").run()
  assert.strictEqual(service.resetDailyFocusIfNewDay(), true)
  assert.strictEqual(service.getDailyTaskById(taskA.id).is_pinned, 0)
  assert.strictEqual(service.getDailySubtaskById(sub.id).is_pinned, 0)

  // 子任务部分字段更新不影响其他字段
  service.updateDailySubtask(sub.id, { is_pinned: true })
  const after = service.getDailySubtaskById(sub.id)
  assert.strictEqual(after.title, '子任务S')
  assert.strictEqual(after.is_pinned, 1)

  const noEstimate = service.createDailyTask({ title: '无预计时长', date: today, estimated_minutes: 45 })
  assert.strictEqual(noEstimate.estimated_minutes, 0)
  service.db.prepare('UPDATE daily_tasks SET estimated_minutes = 60 WHERE id = ?').run(noEstimate.id)
  assert.strictEqual(service.updateDailyTask(noEstimate.id, { title: '已修改', estimated_minutes: 99 }).estimated_minutes, 60)

  const rule = service.createDailyTaskRepeatRule({
    title: '重复任务无预计时长', repeat_type: 'daily', start_date: today, estimated_minutes: 45
  })
  assert.strictEqual(rule.estimated_minutes, 0)
  service.db.prepare('UPDATE daily_task_repeat_rules SET estimated_minutes = 90 WHERE id = ?').run(rule.id)
  assert.strictEqual(service.updateDailyTaskRepeatRule(rule.id, { title: '已修改重复任务', estimated_minutes: 99 }).estimated_minutes, 90)
  service.generateDailyTasksForDate(today)
  const generated = service.getDailyTasksByDate(today).find(task => task.repeat_rule_id === rule.id)
  assert.ok(generated)
  assert.strictEqual(generated.estimated_minutes, 0)

  console.log('All daily-focus and estimate-removal tests passed')
} finally {
  service.db.close()
  fs.rmSync(tmpDir, { recursive: true, force: true })
}
