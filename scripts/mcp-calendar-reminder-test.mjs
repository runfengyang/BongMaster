import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { DatabaseService } = require('../electron/services/database-service.js')
const { McpServerService } = require('../electron/services/mcp-server.js')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bongmaster-mcp-test-'))
const uploads = path.join(dir, 'uploads')
fs.mkdirSync(uploads, { recursive: true })
const db = new DatabaseService(path.join(dir, 'database.db'), uploads)
db.initialize()
const mcp = new McpServerService(db)
const call = (name, args = {}) => mcp.executeTool(name, args)

const requiredTools = [
  'create_calendar_label', 'update_calendar_label', 'delete_calendar_label',
  'get_calendar_event', 'search_calendar_events',
  'list_reminder_lists', 'create_reminder_list', 'update_reminder_list', 'delete_reminder_list',
  'reorder_reminder_lists', 'list_reminder_sections', 'create_reminder_section',
  'update_reminder_section', 'delete_reminder_section', 'restore_reminder_section',
  'list_reminders', 'get_reminder', 'create_reminder', 'update_reminder', 'complete_reminder',
  'delete_reminder', 'restore_reminder', 'purge_reminder', 'list_recently_deleted_reminders',
  'move_reminders', 'duplicate_reminder', 'clear_completed_reminders', 'reorder_reminders',
  'list_reminder_attachments', 'add_reminder_attachment', 'delete_reminder_attachment'
]
const allToolNames = mcp.getTools().map(tool => tool.name)
const toolNames = new Set(allToolNames)
assert.equal(toolNames.size, allToolNames.length, 'duplicate MCP tool names')
for (const name of requiredTools) assert.ok(toolNames.has(name), `missing MCP tool: ${name}`)
for (const tool of mcp.getTools()) assert.ok(tool.inputSchema, `missing inputSchema: ${tool.name}`)

// ===== 提醒事项 =====
let list = await call('create_reminder_list', { name: 'MCP 工作', color: 'blue' })
const listId = Number(/ID: (\d+)/.exec(list)[1])
assert.ok(listId > 0)

let section = await call('create_reminder_section', { list_id: listId, name: '本周' })
const sectionId = Number(/ID: (\d+)/.exec(section)[1])
assert.ok(sectionId > 0)

let created = await call('create_reminder', {
  title: 'MCP 测试提醒',
  list_id: listId,
  section_id: sectionId,
  date: '2026-12-01',
  due_time: '09:30',
  priority: '高',
  is_flagged: true,
  tags: '测试,自动化',
  notes: '由测试创建',
  url: 'https://example.com',
  recurrence_type: 'daily'
})
const reminderId = Number(/ID: (\d+)/.exec(created)[1])
assert.ok(reminderId > 0)

let listed = await call('list_reminders', { list_id: listId, query: 'MCP 测试' })
assert.ok(listed.includes('MCP 测试提醒'))
assert.ok(listed.includes('列表:MCP 工作'))

let detail = await call('get_reminder', { reminder_id: reminderId })
assert.ok(detail.includes('优先级: 高'))
assert.ok(detail.includes('旗标: 是'))
assert.ok(detail.includes('分区: 本周'))
assert.ok(detail.includes('重复: daily'))

let updated = await call('update_reminder', { reminder_id: reminderId, priority: '低', notes: '已更新' })
assert.ok(updated.includes('成功更新提醒'))
detail = await call('get_reminder', { reminder_id: reminderId })
assert.ok(detail.includes('优先级: 低'))
assert.ok(detail.includes('备注: 已更新'))

let completed = await call('complete_reminder', { reminder_id: reminderId })
assert.ok(completed.includes('已标记为已完成'))
assert.ok(completed.includes('已生成下一次提醒'))

let deleted = await call('delete_reminder', { reminder_id: reminderId })
assert.ok(deleted.includes('最近删除'))
let recentlyDeleted = await call('list_recently_deleted_reminders')
assert.ok(recentlyDeleted.includes('MCP 测试提醒'))
let restored = await call('restore_reminder', { reminder_id: reminderId })
assert.ok(restored.includes('成功恢复'))

let duplicated = await call('duplicate_reminder', { reminder_id: reminderId })
assert.ok(duplicated.includes('成功复制提醒'))

let moved = await call('move_reminders', { reminder_ids: [reminderId], list_id: listId })
assert.ok(moved.includes('成功移动'))

// 分区删除 + 恢复
let sectionDeleted = await call('delete_reminder_section', { section_id: sectionId })
assert.ok(sectionDeleted.includes('回到未分区'))
let sectionRestored = await call('restore_reminder_section', { section_id: sectionId, reminder_ids: [reminderId] })
assert.ok(sectionRestored.includes('成功恢复分区'))
detail = await call('get_reminder', { reminder_id: reminderId })
assert.ok(detail.includes('分区: 本周'))

// 附件
const attachmentPath = path.join(dir, 'note.txt')
fs.writeFileSync(attachmentPath, 'hello')
let attachment = await call('add_reminder_attachment', { reminder_id: reminderId, file_path: attachmentPath })
const attachmentId = Number(/ID: (\d+)/.exec(attachment)[1])
let attachments = await call('list_reminder_attachments', { reminder_id: reminderId })
assert.ok(attachments.includes('note.txt'))
let attachmentDeleted = await call('delete_reminder_attachment', { attachment_id: attachmentId })
assert.ok(attachmentDeleted.includes('成功删除附件'))

// ===== 日历 =====
let label = await call('create_calendar_label', { name: 'MCP 测试标签', color: '#123456' })
const calendarId = Number(/ID: (\d+)/.exec(label)[1])
assert.ok(calendarId > 0)
let labelUpdated = await call('update_calendar_label', { calendar_id: calendarId, name: 'MCP 测试标签2' })
assert.ok(labelUpdated.includes('MCP 测试标签2'))

let event = await call('create_calendar_event', {
  title: 'MCP 测试日程',
  start_date: '2026-12-02',
  end_date: '2026-12-02',
  start_time: '14:00',
  end_time: '15:00',
  calendar: 'MCP 测试标签2',
  location: '会议室',
  notes: 'MCP 备注'
})
const eventId = Number(/ID: (\d+)/.exec(event)[1])
assert.ok(eventId > 0)

let eventDetail = await call('get_calendar_event', { event_id: eventId })
assert.ok(eventDetail.includes('MCP 测试日程'))
assert.ok(eventDetail.includes('标签: MCP 测试标签2'))
let search = await call('search_calendar_events', { query: 'MCP 测试' })
assert.ok(search.includes('MCP 测试日程'))

let eventUpdated = await call('update_calendar_event', { event_id: eventId, notes: '已修改' })
assert.ok(eventUpdated.includes('成功更新日程'))
eventDetail = await call('get_calendar_event', { event_id: eventId })
assert.ok(eventDetail.includes('已修改'))

let eventDeleted = await call('delete_calendar_event', { event_id: eventId })
assert.ok(eventDeleted.includes('成功删除日程'))
let labelDeleted = await call('delete_calendar_label', { calendar_id: calendarId })
assert.ok(labelDeleted.includes('成功删除日历标签'))

fs.rmSync(dir, { recursive: true, force: true })
console.log('mcp-calendar-reminder-test: ok')
