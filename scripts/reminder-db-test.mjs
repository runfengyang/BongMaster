import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { DatabaseService } = require('../electron/services/database-service.js')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bongmaster-reminder-test-'))
const dbPath = path.join(dir, 'database.db')
const uploadsDir = path.join(dir, 'uploads')
fs.mkdirSync(uploadsDir, { recursive: true })

const legacy = new Database(dbPath)
legacy.exec(`
  CREATE TABLE daily_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    date DATE NOT NULL,
    is_completed BOOLEAN DEFAULT 0,
    priority TEXT DEFAULT '中',
    estimated_minutes INTEGER DEFAULT 0,
    time_spent_seconds INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    is_pinned BOOLEAN DEFAULT 0,
    tags TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    completed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    project_id INTEGER
  );
  INSERT INTO daily_tasks (title, date, is_completed, priority, is_pinned, notes) VALUES
    ('旧任务一', '2026-11-10', 0, '中', 1, '保留备注'),
    ('旧任务二', '2026-11-10', 0, '高', 0, ''),
    ('旧任务三', '2026-11-09', 1, '中', 0, '');
  UPDATE daily_tasks SET completed_at = '2026-11-09T12:00:00.000Z' WHERE title = '旧任务三';
`)
legacy.close()

const svc = new DatabaseService(dbPath, uploadsDir)
svc.initialize()

const lists = svc.getReminderLists()
assert.equal(lists.length, 1)
assert.equal(lists[0].name, '提醒事项')
assert.equal(lists[0].open_count, 2)

const all = svc.getAllReminders()
assert.equal(all.length, 3)
assert.equal(all.every(reminder => reminder.list_id === lists[0].id), true)
assert.equal(all.filter(reminder => reminder.priority === '无').length, 2)
assert.equal(all.find(reminder => reminder.title === '旧任务一').is_flagged, 1)
assert.equal(svc.getDailyTasksByDate('2026-11-10').length, 2)

const list = svc.createReminderList({ name: '测试列表', color: 'purple', icon: '📚', icon_type: 'emoji' })
assert.equal(list.name, '测试列表')
const section = svc.createReminderSection(list.id, { name: '分区 A' })
assert.equal(section.list_id, list.id)

const reminder = svc.createReminder({
  title: '测试提醒',
  list_id: list.id,
  section_id: section.id,
  date: '2026-11-10',
  due_time: '09:00',
  priority: '高',
  is_flagged: 1,
  tags: '工作,重要',
  notes: '备注',
  url: 'https://example.test'
})
assert.equal(reminder.list_name, '测试列表')
assert.equal(reminder.section_name, '分区 A')
assert.equal(reminder.is_flagged, 1)

const updated = svc.updateReminder(reminder.id, { title: '测试提醒改', due_time: '10:30', is_flagged: 0 })
assert.equal(updated.title, '测试提醒改')
assert.equal(updated.due_time, '10:30')
assert.equal(updated.url, 'https://example.test')
assert.equal(updated.is_flagged, 0)

const noteAttachment = svc.addReminderAttachment(reminder.id, {
  name: 'note.txt',
  buffer: Buffer.from('hello attachment'),
  mime_type: 'text/plain'
})
assert.equal(noteAttachment.original_filename, 'note.txt')
assert.ok(noteAttachment.file_size > 0)
assert.ok(fs.existsSync(svc.getReminderAttachmentPath(noteAttachment)))
assert.equal(svc.getReminderAttachments(reminder.id).length, 1)
svc.deleteReminderAttachment(noteAttachment.id)
assert.equal(svc.getReminderAttachments(reminder.id).length, 0)

const recurring = svc.createReminder({
  title: '每日例会',
  list_id: list.id,
  date: '2026-11-10',
  due_time: '09:00',
  recurrence_type: 'daily'
})
const completed = svc.toggleReminderComplete(recurring.id, true)
assert.equal(completed.reminder.is_completed, 1)
assert.equal(completed.next.date, '2026-11-11')
assert.equal(completed.next.recurrence_source_id, recurring.id)
const completedAgain = svc.toggleReminderComplete(recurring.id, true)
assert.equal(completedAgain.next, null, '重复完成不应生成第二条')

const attachment = svc.addReminderAttachment(reminder.id, {
  name: '说明.txt',
  buffer: Buffer.from('hello'),
  mime_type: 'text/plain'
})
assert.equal(attachment.original_filename, '说明.txt')
assert.equal(fs.existsSync(svc.getReminderAttachmentPath(attachment)), true)
assert.equal(svc.getReminderAttachments(reminder.id).length, 1)
svc.deleteReminderAttachment(attachment.id)
assert.equal(fs.existsSync(svc.getReminderAttachmentPath(attachment)), false)

svc.deleteReminder(reminder.id)
assert.ok(!svc.getReminderById(reminder.id))
assert.ok(svc.getRecentlyDeletedReminders().some(item => item.id === reminder.id))
svc.restoreReminders([reminder.id])
assert.ok(svc.getReminderById(reminder.id))

const oldCompleted = svc.createReminder({ title: '早先完成', date: '2026-01-01', is_completed: 1 })
svc.db.prepare('UPDATE daily_tasks SET completed_at = ? WHERE id = ?').run(
  new Date(Date.now() - 60 * 86400000).toISOString(),
  oldCompleted.id
)
const cutoff = new Date(Date.now() - 30 * 86400000).toISOString()
const aged = svc.clearCompletedReminders(null, cutoff)
assert.ok(aged.ids.includes(oldCompleted.id))
assert.ok(!aged.ids.includes(recurring.id))

const cleared = svc.clearCompletedReminders(list.id)
assert.ok(cleared.ids.includes(recurring.id))
assert.ok(!cleared.ids.includes(reminder.id))

const mcpTask = svc.createDailyTask({ title: 'MCP 任务', date: '2026-11-10', priority: '低' })
assert.equal(mcpTask.list_id, lists[0].id)
assert.equal(svc.getDailyTasksByDate('2026-11-10').some(task => task.title === 'MCP 任务'), true)
const stats = svc.getDailyTaskHistoryStats('2026-11-10')
assert.equal(typeof stats.todayCompleted, 'number')

assert.equal(svc._nextReminderDate({ recurrence_type: 'weekly', date: '2026-11-10', recurrence_value: '1,3' }), '2026-11-11')
assert.equal(svc._nextReminderDate({ recurrence_type: 'weekly', date: '2026-11-10', recurrence_value: '5' }), '2026-11-13')
assert.equal(svc._nextReminderDate({ recurrence_type: 'monthly', date: '2026-01-31' }), '2026-02-28')
assert.equal(svc._nextReminderDate({ recurrence_type: 'yearly', date: '2024-02-29' }), '2025-02-28')
assert.equal(svc._nextReminderDate({ recurrence_type: 'custom', date: '2026-11-10', recurrence_value: '3:days' }), '2026-11-13')

const due = svc.createReminder({
  title: '通知测试',
  date: '2026-11-10',
  due_time: '10:05',
  remind_time: '10:05'
})
const dueList = svc.getDueRemindersForNotification(new Date('2026-11-10T10:06:00'))
assert.ok(dueList.some(item => item.id === due.id))
svc.markReminderNotified(due.id)
const dueAgain = svc.getDueRemindersForNotification(new Date('2026-11-10T10:06:00'))
assert.ok(!dueAgain.some(item => item.id === due.id))

svc.purgeReminder(recurring.id)
assert.ok(!svc.getReminderById(recurring.id))

const duplicate = svc.duplicateReminder(reminder.id)
assert.equal(duplicate.title, '测试提醒改')
assert.equal(duplicate.is_completed, 0)
svc.purgeReminder(duplicate.id)

console.log('reminder-db-test: ok')
