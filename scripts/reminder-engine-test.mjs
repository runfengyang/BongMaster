import assert from 'node:assert/strict'
import { createServer } from 'vite'

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
try {
  const {
    buildReminderGroups,
    completionKey,
    describeRecurrence,
    formatDueDate,
    getSmartListCounts,
    humanizeDate,
    nextDueDate,
    sortReminders
  } = await server.ssrLoadModule('/src/utils/reminders.js')
  const { parseReminderInput } = await server.ssrLoadModule('/src/utils/reminder-parser.js')

  const today = '2026-11-10'
  const lists = [
    { id: 1, name: '工作', color: 'blue' },
    { id: 2, name: '生活', color: 'green' }
  ]
  const base = {
    list_id: 1,
    list_name: '工作',
    is_completed: false,
    is_flagged: false,
    priority: '无',
    sort_order: 0,
    created_at: '2026-11-01 10:00:00'
  }
  const reminders = [
    { ...base, id: 1, title: 'A 全天', date: today, due_time: null },
    { ...base, id: 2, title: 'B 上午', date: today, due_time: '09:00' },
    { ...base, id: 3, title: 'C 下午', date: today, due_time: '15:00' },
    { ...base, id: 4, title: 'D 晚上', date: today, due_time: '20:00' },
    { ...base, id: 5, title: 'E 逾期', date: '2026-11-09', due_time: '10:00' },
    { ...base, id: 6, title: 'F 明天', date: '2026-11-11', due_time: null },
    { ...base, id: 7, title: 'G 本月其他', date: '2026-11-20', due_time: null },
    { ...base, id: 8, title: 'H 无日期', date: '', due_time: null },
    { ...base, id: 9, title: 'I 已完成', date: today, is_completed: true, completed_at: '2026-11-10T04:00:00.000Z' },
    { ...base, id: 10, title: 'J 昨天完成', date: '2026-11-09', is_completed: true, completed_at: null, list_id: 2, list_name: '生活' }
  ]

  assert.equal(humanizeDate(today, today), '今天')
  assert.equal(humanizeDate('2026-11-11', today), '明天')
  assert.equal(humanizeDate('2026-11-12', today), '后天')
  assert.equal(humanizeDate('2026-11-09', today), '昨天')
  assert.equal(humanizeDate('2026-11-13', today), '11月13日 周五')
  assert.equal(humanizeDate('2027-01-05', today), '2027/1/5')
  assert.equal(formatDueDate({ date: today, due_time: '15:00' }, today), '今天 15:00')
  assert.equal(formatDueDate({ date: '', due_time: null }, today), '')

  const counts = getSmartListCounts(reminders, today)
  assert.equal(counts.today, 5)
  assert.equal(counts.all, 8)
  assert.equal(counts.completed, 2)
  assert.equal(counts.scheduled, 7)

  const todayGroups = buildReminderGroups({ view: { type: 'smart', id: 'today' }, reminders, lists, today })
  assert.deepEqual(todayGroups.map(group => group.key), ['overdue', 'allday', 'morning', 'afternoon', 'evening'])
  assert.deepEqual(todayGroups.find(group => group.key === 'overdue').items.map(item => item.id), [5])
  assert.deepEqual(todayGroups.find(group => group.key === 'afternoon').items.map(item => item.id), [3])

  const scheduledGroups = buildReminderGroups({ view: { type: 'smart', id: 'scheduled' }, reminders, lists, today })
  assert.equal(scheduledGroups[0].title, '逾期')
  assert.equal(scheduledGroups[1].title, '今天')
  assert.equal(scheduledGroups[2].title, '明天')
  assert.equal(scheduledGroups[3].title, '后天')
  assert.equal(scheduledGroups[4].title, '11月13日 周五')
  assert.equal(scheduledGroups[8].title, '11月其他时间')
  assert.equal(scheduledGroups[9].title, '12月')
  assert.equal(scheduledGroups.find(group => group.title === '11月其他时间').items[0].id, 7)

  const allGroups = buildReminderGroups({ view: { type: 'smart', id: 'all' }, reminders, lists, today })
  assert.equal(allGroups.length, 2)
  assert.equal(allGroups[0].title, '工作')
  assert.equal(allGroups[0].items.length, 8)
  assert.equal(allGroups[1].title, '生活')
  assert.equal(allGroups[1].items.length, 0)

  const completedGroups = buildReminderGroups({ view: { type: 'smart', id: 'completed' }, reminders, lists, today })
  assert.equal(completedGroups[0].title, '昨天')
  assert.equal(completedGroups[0].items[0].id, 10)
  assert.equal(completedGroups[1].title, '11月')
  assert.equal(completedGroups[1].subgroups[0].items[0].id, 9)
  assert.equal(completionKey(reminders[9]), '2026-11-09')

  const listGroups = buildReminderGroups({
    view: { type: 'list', id: 1 },
    reminders,
    lists,
    sections: [{ id: 11, list_id: 1, name: '分区 A', sort_order: 0, is_collapsed: 0 }],
    today
  })
  assert.equal(listGroups.length, 2)
  assert.equal(listGroups[0].key, 'ungrouped')
  assert.equal(listGroups[1].title, '分区 A')
  assert.ok(listGroups[1].add)

  const dueSorted = sortReminders(reminders.filter(item => item.date), 'due')
  assert.equal(dueSorted[0].date, '2026-11-09')
  const titleSorted = sortReminders(reminders, 'title')
  assert.equal(titleSorted[0].title, 'A 全天')

  const parser = parseReminderInput('明天下午3点 交报告 #论文 !!!', { now: new Date('2026-11-10T08:00:00') })
  assert.equal(parser.title, '交报告')
  assert.equal(parser.date, '2026-11-11')
  assert.equal(parser.due_time, '15:00')
  assert.equal(parser.priority, '高')
  assert.equal(parser.tags, '论文')

  const friday = parseReminderInput('周五 10:30 组会', { now: new Date('2026-11-10T08:00:00') })
  assert.equal(friday.title, '组会')
  assert.equal(friday.date, '2026-11-13')
  assert.equal(friday.due_time, '10:30')

  const explicit = parseReminderInput('11月13日 买牛奶', { now: new Date('2026-11-10T08:00:00') })
  assert.equal(explicit.title, '买牛奶')
  assert.equal(explicit.date, '2026-11-13')

  const tonight = parseReminderInput('今晚 8点 跑步', { now: new Date('2026-11-10T08:00:00') })
  assert.equal(tonight.title, '跑步')
  assert.equal(tonight.date, '2026-11-10')
  assert.equal(tonight.due_time, '20:00')

  const plain = parseReminderInput('写论文', { now: new Date('2026-11-10T08:00:00') })
  assert.equal(plain.title, '写论文')
  assert.equal(plain.date, '')
  assert.equal(plain.priority, '无')

  const priority = parseReminderInput('p1 写论文', { now: new Date('2026-11-10T08:00:00') })
  assert.equal(priority.title, '写论文')
  assert.equal(priority.priority, '高')

  assert.equal(nextDueDate({ recurrence_type: 'daily', date: today }, null, today), '2026-11-11')
  assert.equal(nextDueDate({ recurrence_type: 'weekdays', date: '2026-11-13' }, null, today), '2026-11-16')
  assert.equal(nextDueDate({ recurrence_type: 'weekly', date: today, recurrence_value: '1,3' }, null, today), '2026-11-11')
  assert.equal(nextDueDate({ recurrence_type: 'weekly', date: today, recurrence_value: '5' }, null, today), '2026-11-13')
  assert.equal(nextDueDate({ recurrence_type: 'monthly', date: '2026-01-31' }, null, today), '2026-02-28')
  assert.equal(nextDueDate({ recurrence_type: 'yearly', date: '2024-02-29' }, null, today), '2025-02-28')
  assert.equal(nextDueDate({ recurrence_type: 'custom', date: today, recurrence_value: '3:days' }, null, today), '2026-11-13')
  assert.equal(nextDueDate({ recurrence_type: 'daily', date: today, recurrence_end_date: '2026-11-10' }, null, today), null)
  assert.equal(nextDueDate({ recurrence_type: 'daily', date: today, repeat_from_completion: true }, today, today), '2026-11-11')
  assert.equal(describeRecurrence({ recurrence_type: 'weekly', recurrence_value: '1,3' }), '每周一、三')

  console.log('reminder-engine-test: ok')
} finally {
  await server.close()
}
