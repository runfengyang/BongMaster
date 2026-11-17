import assert from 'node:assert/strict'
import { createServer } from 'vite'

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
try {
  const { getDashboardAnalytics } = await server.ssrLoadModule('/src/utils/dashboard-analytics.js')
  const projects = [
    { id: 1, name: '活跃一', status: '进行中' },
    { id: 2, name: '活跃二', status: '未开始' },
    { id: 3, name: '已暂停', status: '已暂停' }
  ]
  const tasks = [
    { id: 1, project_id: 1, name: '昨日逾期', status: '待办', priority: '高', due_date: '2026-11-08' },
    { id: 2, project_id: 1, name: '今日进行', status: '进行中', priority: '中', due_date: '2026-11-09' },
    { id: 3, project_id: 1, name: '今日完成', status: '已完成', priority: '低', due_date: '2026-11-09' },
    { id: 4, project_id: 1, name: '无日期', status: '待办', priority: '高', due_date: null },
    { id: 5, project_id: 2, name: '明日待办', status: '待办', priority: '低', due_date: '2026-11-10' },
    { id: 6, project_id: 3, name: '暂停项目逾期', status: '待办', priority: '高', due_date: '2026-11-08' }
  ]
  const trend = [1, 0, 2, 0, 3, 0, 4].map((count, index) => ({ date: `2026-11-${String(index + 3).padStart(2, '0')}`, count }))
  const result = getDashboardAnalytics(tasks, projects, trend, '2026-11-09')
  assert.deepEqual(result.metrics, {
    activeProjects: 2,
    activeTasks: 4,
    overdueTasks: 1,
    dueToday: 1,
    weekCompleted: 4,
    totalCompleted: 10
  })
  assert.deepEqual(result.statusDistribution, [
    { label: '待办', value: 3 },
    { label: '进行中', value: 1 },
    { label: '已完成', value: 1 }
  ])
  assert.deepEqual(result.priorityDistribution, [
    { label: '高', value: 2 },
    { label: '中', value: 1 },
    { label: '低', value: 1 }
  ])

  const empty = getDashboardAnalytics([], [], [], '2026-11-09')
  assert.deepEqual(empty.metrics, { activeProjects: 0, activeTasks: 0, overdueTasks: 0, dueToday: 0, weekCompleted: 0, totalCompleted: 0 })
  assert.deepEqual(empty.statusDistribution.map(item => item.value), [0, 0, 0])
  assert.deepEqual(empty.priorityDistribution.map(item => item.value), [0, 0, 0])
  console.log('Dashboard analytics tests passed')
} finally {
  await server.close()
}
