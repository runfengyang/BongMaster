import { format, parseISO, startOfWeek } from 'date-fns'

export function getDashboardAnalytics(tasks, projects, completionTrend, today) {
  const activeProjectIds = new Set(
    (projects || []).filter(project => project.status === '未开始' || project.status === '进行中').map(project => project.id)
  )
  const projectTasks = (tasks || []).filter(task => activeProjectIds.has(task.project_id))
  const activeTasks = projectTasks.filter(task => task.status !== '已完成')
  const trend = completionTrend || []
  const weekStart = format(startOfWeek(parseISO(today), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const count = (items, field, label) => ({ label, value: items.filter(item => item[field] === label).length })

  return {
    metrics: {
      activeProjects: activeProjectIds.size,
      activeTasks: activeTasks.length,
      overdueTasks: activeTasks.filter(task => task.due_date && task.due_date < today).length,
      dueToday: activeTasks.filter(task => task.due_date === today).length,
      weekCompleted: trend
        .filter(day => day.date >= weekStart && day.date <= today)
        .reduce((sum, day) => sum + (Number(day.count) || 0), 0),
      totalCompleted: trend.reduce((sum, day) => sum + (Number(day.count) || 0), 0)
    },
    statusDistribution: ['待办', '进行中', '已完成'].map(label => count(projectTasks, 'status', label)),
    priorityDistribution: ['高', '中', '低'].map(label => count(activeTasks, 'priority', label))
  }
}
