import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  parseLocalMs,
  planReminderListSync,
  planReminderItemSync
} = require('../electron/services/reminder-mac-sync-service.js')

assert.equal(parseLocalMs('2026-11-12 08:00:00'), Date.parse('2026-11-12T08:00:00Z'))
assert.equal(parseLocalMs('2026-11-12T08:00:00.000Z'), Date.parse('2026-11-12T08:00:00.000Z'))
assert.equal(parseLocalMs(''), 0)
assert.equal(parseLocalMs(null), 0)

// ===== 列表对齐 =====

let listPlan = planReminderListSync({
  localLists: [{ id: 1, name: '工作' }],
  macLists: [],
  mappings: []
})
assert.equal(listPlan.macListCreates.length, 1)
assert.equal(listPlan.macListCreates[0].name, '工作')

listPlan = planReminderListSync({
  localLists: [],
  macLists: [{ id: 'm1', name: '生活' }],
  mappings: []
})
assert.equal(listPlan.bindings.length, 0)
assert.equal(listPlan.macListCreates.length, 0)

listPlan = planReminderListSync({
  localLists: [{ id: 1, name: '工作' }],
  macLists: [{ id: 'm1', name: '工作' }],
  mappings: []
})
assert.equal(listPlan.macListCreates.length, 0)
assert.equal(listPlan.bindings[0].macListId, 'm1')

listPlan = planReminderListSync({
  localLists: [{ id: 1, name: '项目' }],
  macLists: [{ id: 'm1', name: '工作' }],
  mappings: [{ local_list_id: 1, mac_list_id: 'm1', local_name: '工作', mac_name: '工作' }]
})
assert.equal(listPlan.macListRenames.length, 1)
assert.equal(listPlan.macListRenames[0].name, '项目')

listPlan = planReminderListSync({
  localLists: [{ id: 1, name: '工作' }],
  macLists: [{ id: 'm2', name: '工作' }],
  mappings: [{ local_list_id: 1, mac_list_id: 'm1', local_name: '工作', mac_name: '工作' }]
})
assert.equal(listPlan.macListCreates.length, 0)
assert.equal(listPlan.bindings[0].macListId, 'm2')
assert.equal(listPlan.resetLocalListIds.length, 1)
assert.equal(listPlan.resetLocalListIds[0], 1)

listPlan = planReminderListSync({
  localLists: [{ id: 2, name: '生活' }],
  macLists: [{ id: 'm1', name: '生活' }],
  mappings: [{ local_list_id: 9, mac_list_id: 'm9', local_name: '旧列表', mac_name: '旧列表' }]
})
assert.equal(listPlan.bindings[0].localListId, 2)
assert.equal(listPlan.bindings[0].macListId, 'm1')

listPlan = planReminderListSync({
  localLists: [{ id: 1, name: '工作' }],
  macLists: [{ id: 'm1', name: '采购清单' }],
  mappings: []
})
assert.equal(listPlan.bindings.length, 0)
assert.equal(listPlan.macListCreates.length, 1)
assert.equal(listPlan.macListCreates[0].name, '工作')

// ===== 提醒对齐 =====

const local = (id, updatedMs, overrides = {}) => ({
  id,
  title: `本地${id}`,
  notes: '',
  date: '2026-11-12',
  due_time: '10:00',
  remind_time: null,
  is_completed: 0,
  is_flagged: 0,
  priority: '无',
  list_id: 1,
  list_name: '工作',
  updatedMs,
  ...overrides
})

const macReminder = (id, modifiedMs, overrides = {}) => ({
  id,
  listId: 'm1',
  listName: 'BongMaster · 工作',
  name: `本地1`,
  body: '',
  completed: false,
  completionDate: null,
  dueKind: 1,
  dueDate: '2026-11-12',
  dueTime: '10:00',
  remindDate: null,
  remindTime: null,
  priority: 0,
  flagged: false,
  modifiedMs,
  ...overrides
})

const listIdByMacListId = { m1: 1 }
const plan = data => planReminderItemSync({ listIdByMacListId, ...data })

let itemPlan = plan({ localItems: [local(1, 2000)], macReminders: [], records: [] })
assert.equal(itemPlan.macCreates.length, 1)
assert.equal(itemPlan.macCreates[0].listName, '工作')
assert.equal(itemPlan.macCreates[0].payload.title, '本地1')

itemPlan = plan({ localItems: [local(1, 2000, { is_completed: 1 })], macReminders: [], records: [] })
assert.equal(itemPlan.macCreates.length, 0)

itemPlan = plan({ localItems: [], macReminders: [macReminder('r1', 2000, { name: 'macOS 任务' })], records: [] })
assert.equal(itemPlan.localCreates.length, 1)
assert.equal(itemPlan.localCreates[0].payload.list_id, 1)
assert.equal(itemPlan.localCreates[0].payload.title, 'macOS 任务')

itemPlan = plan({ localItems: [], macReminders: [macReminder('r1', 2000, { name: '旧完成项', completed: true })], records: [] })
assert.equal(itemPlan.localCreates.length, 0)

itemPlan = plan({
  localItems: [local(1, 2000, { title: '本地1' })],
  macReminders: [macReminder('r1', 2000)],
  records: []
})
assert.equal(itemPlan.macCreates.length, 1)
assert.equal(itemPlan.localCreates.length, 1)
assert.equal(itemPlan.pairs.length, 0)

const record = { local_id: 1, mac_id: 'r1', last_local_updated: '1000', last_mac_updated: '1000' }

itemPlan = plan({
  localItems: [local(1, 3000, { title: '本地1' })],
  macReminders: [macReminder('r1', 2000)],
  records: [record]
})
assert.equal(itemPlan.macUpdates.length, 1)
assert.equal(itemPlan.localUpdates.length, 0)
assert.equal(itemPlan.pairs.length, 1)

itemPlan = plan({
  localItems: [local(1, 2000, { title: '本地1' })],
  macReminders: [macReminder('r1', 3000)],
  records: [record]
})
assert.equal(itemPlan.localUpdates.length, 1)
assert.equal(itemPlan.localUpdates[0].payload.title, '本地1')

itemPlan = plan({
  localItems: [local(1, 4000, { title: '本地1' })],
  macReminders: [macReminder('r1', 3000)],
  records: [{ ...record, last_local_updated: '1000', last_mac_updated: '1000' }]
})
assert.equal(itemPlan.macUpdates.length, 1)
assert.equal(itemPlan.localUpdates.length, 0)

itemPlan = plan({
  localItems: [local(1, 2000, { title: '本地1' })],
  macReminders: [macReminder('r1', 2000)],
  records: [{ ...record, last_local_updated: '2000', last_mac_updated: '2000' }]
})
assert.equal(itemPlan.macUpdates.length, 0)
assert.equal(itemPlan.localUpdates.length, 0)
assert.equal(itemPlan.pairs.length, 1)

itemPlan = plan({
  localItems: [],
  deletedLocalIds: [1],
  macReminders: [macReminder('r1', 2000)],
  records: [record]
})
assert.equal(itemPlan.macDeletes.length, 1)
assert.equal(itemPlan.localCreates.length, 0)

itemPlan = plan({
  localItems: [local(1, 2000, { title: '本地1' })],
  macReminders: [],
  records: [{ ...record, last_local_updated: '2000', last_mac_updated: '2000' }]
})
assert.equal(itemPlan.localDeletes.length, 1)
assert.equal(itemPlan.macCreates.length, 0)

itemPlan = plan({
  localItems: [local(1, 2000, { title: '本地1' })],
  macReminders: [],
  records: [{ ...record, last_local_updated: '2000', last_mac_updated: '2000' }],
  completedMacIds: ['r1']
})
assert.equal(itemPlan.localCompletes.length, 1)
assert.equal(itemPlan.localDeletes.length, 0)
assert.equal(itemPlan.macCreates.length, 0)

itemPlan = plan({
  localItems: [local(1, 2000, { title: '本地1', is_completed: 1 })],
  macReminders: [],
  records: [{ ...record, last_local_updated: '2000', last_mac_updated: '2000' }],
  completedMacIds: ['r1']
})
assert.equal(itemPlan.localCompletes.length, 0)
assert.equal(itemPlan.localDeletes.length, 0)

itemPlan = plan({
  localItems: [local(1, 3000, { title: '本地1' })],
  macReminders: [],
  records: [{ ...record, last_local_updated: '2000', last_mac_updated: '2000' }]
})
assert.equal(itemPlan.macCreates.length, 1)
assert.equal(itemPlan.localDeletes.length, 0)

itemPlan = plan({
  localItems: [local(1, 3000, { title: '本地1', is_completed: 1 })],
  macReminders: [],
  records: [{ ...record, last_local_updated: '2000', last_mac_updated: '2000' }]
})
assert.equal(itemPlan.macCreates.length, 0)
assert.equal(itemPlan.localDeletes.length, 0)

itemPlan = plan({
  localItems: [local(1, 2000, { title: '本地1' })],
  macReminders: [macReminder('r1', 4000, { name: 'macOS 新位置', listId: 'm2' })],
  records: [{ ...record, last_local_updated: '1000', last_mac_updated: '1000' }],
  listIdByMacListId: { m1: 1, m2: 2 }
})
assert.equal(itemPlan.localUpdates.length, 1)
assert.equal(itemPlan.localUpdates[0].payload.list_id, 2)

itemPlan = plan({
  localItems: [local(1, 4000, { title: '本地1' })],
  macReminders: [macReminder('r1', 3000, { name: 'macOS 新位置', listId: 'm2' })],
  records: [{ ...record, last_local_updated: '1000', last_mac_updated: '1000' }],
  listIdByMacListId: { m1: 1, m2: 2 }
})
assert.equal(itemPlan.macDeletes.length, 1)
assert.equal(itemPlan.macCreates.length, 1)

itemPlan = plan({
  localItems: [local(1, 2000, { title: '本地1' })],
  macReminders: [macReminder('r1', 2000, { name: '本地1' })],
  records: [{ ...record, last_local_updated: '2000', last_mac_updated: '2000' }]
})
assert.equal(itemPlan.macUpdates.length, 0)
assert.equal(itemPlan.localUpdates.length, 0)
assert.equal(itemPlan.pairs.length, 1)

console.log('reminder-mac-sync-test: ok')
