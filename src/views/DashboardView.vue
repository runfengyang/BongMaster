<template>
  <div class="fade-in bm-page dashboard-page">
    <!-- Page Header -->
    <div class="bm-page-header">
      <h1>项目仪表板</h1>
    </div>

    <div class="bm-section">
      <WorkClockCard @open-records="openWorkRecords" @open-settings="openWorkSettings" />
    </div>

    <div class="bm-stat-grid">
      <div v-for="metric in metricCards" :key="metric.label" class="bm-stat-card" :class="metric.tone">
        <div class="bm-stat-content">
          <div>
            <div class="bm-stat-value">{{ metric.value }}</div>
            <div class="bm-stat-label">{{ metric.label }}</div>
            <small class="bm-stat-hint">{{ metric.hint }}</small>
          </div>
          <div class="bm-stat-icon"><i :class="metric.icon" aria-hidden="true"></i></div>
        </div>
      </div>
    </div>

    <!-- Charts Section -->
    <div class="bm-section">
      <div class="bm-grid bm-grid-2">
        <!-- Active Projects Ranking -->
        <div class="bm-card active-projects-card">
          <div class="bm-card-header">
            <h3>最近活跃项目</h3>
            <span class="active-range">近 7 天</span>
          </div>
          <div class="bm-card-body">
            <div v-if="activeProjectsRank.length === 0" class="bm-empty">
              <i class="fas fa-chart-bar bm-empty-icon"></i>
              <p>近7天暂无项目活动</p>
            </div>
            <div v-else class="bm-rank-list">
              <div
                v-for="(proj, index) in activeProjectsRank"
                :key="proj.id"
                class="bm-rank-item"
              >
                <div class="bm-rank-main">
                  <div class="bm-rank-top">
                    <span class="bm-rank-number">{{ index + 1 }}</span>
                    <router-link :to="`/projects/${proj.id}`" class="bm-rank-name">
                      {{ proj.name }}
                    </router-link>
                    <span v-if="proj.recentCompletions > 0" class="bm-rank-badge">
                      +{{ proj.recentCompletions }}
                    </span>
                  </div>
                  <div class="bm-rank-progress">
                    <div class="bm-progress-bar">
                      <div
                        class="bm-progress-fill"
                        :style="{ width: `${proj.progress}%` }"
                      ></div>
                    </div>
                  </div>
                </div>
                <div class="bm-rank-meta">
                  <template v-if="proj.taskTotal > 0">{{ proj.taskCompleted }}/{{ proj.taskTotal }}</template>
                  <template v-else>每日 {{ proj.dailyCompleted }}/{{ proj.dailyTotal }}</template>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Right Column: Heatmap -->
        <div>
          <div class="bm-card">
            <div class="bm-card-body">
              <Heatmap :data="analyticsStore.heatmapData" :days="180" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <WorkAttendanceDrawer :show="workDrawerVisible" :open-settings="workDrawerSettings" @close="closeWorkDrawer" />
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useProjectStore } from '@stores/project-store'
import { useTaskStore } from '@stores/task-store'
import { useAnalyticsStore } from '@stores/analytics-store'
import Heatmap from '@components/charts/Heatmap.vue'
import WorkClockCard from '@components/work/WorkClockCard.vue'
import WorkAttendanceDrawer from '@components/work/WorkAttendanceDrawer.vue'
import { getDashboardAnalytics } from '@utils/dashboard-analytics.js'
import { format, parseISO, subDays } from 'date-fns'

const projectStore = useProjectStore()
const taskStore = useTaskStore()
const analyticsStore = useAnalyticsStore()
const workDrawerVisible = ref(false)
const workDrawerSettings = ref(false)
const openWorkRecords = () => { workDrawerSettings.value = false; workDrawerVisible.value = true }
const openWorkSettings = () => { workDrawerSettings.value = true; workDrawerVisible.value = true }
const closeWorkDrawer = () => { workDrawerVisible.value = false; workDrawerSettings.value = false }

const dashboardAnalytics = computed(() => getDashboardAnalytics(
  taskStore.tasks,
  projectStore.projects,
  analyticsStore.completionTrend,
  format(new Date(), 'yyyy-MM-dd')
))
const metricCards = computed(() => {
  const metrics = dashboardAnalytics.value.metrics
  return [
    { label: '活跃项目', value: metrics.activeProjects, hint: '未开始 / 进行中', icon: 'fas fa-folder', tone: '' },
    { label: '活跃任务', value: metrics.activeTasks, hint: '活跃项目内未完成', icon: 'fas fa-tasks', tone: 'success' },
    { label: '逾期任务', value: metrics.overdueTasks, hint: '截止日早于今天', icon: 'fas fa-exclamation-circle', tone: 'danger' },
    { label: '今日截止', value: metrics.dueToday, hint: '截止日等于今天', icon: 'fas fa-calendar-day', tone: 'warning' },
    { label: '本周完成', value: metrics.weekCompleted, hint: '周一至今', icon: 'fas fa-chart-line', tone: 'success' },
    { label: '30天完成', value: metrics.totalCompleted, hint: '项目任务完成记录', icon: 'fas fa-check-circle', tone: 'info' }
  ]
})

// Active projects ranking
const ACTIVE_PROJECT_STATUSES = ['未开始', '进行中']

const activeProjectsRank = computed(() => {
  const sevenDaysAgo = subDays(new Date(), 7)
  const stats = {}

  const ensure = (pid, name) => {
    if (!stats[pid]) {
      stats[pid] = {
        id: pid,
        name,
        taskTotal: 0,
        taskCompleted: 0,
        dailyTotal: 0,
        dailyCompleted: 0,
        recentCompletions: 0,
        lastActivity: null
      }
    }
    return stats[pid]
  }

  const touch = (entry, isoString) => {
    if (!isoString) return
    try {
      const at = parseISO(isoString)
      if (!entry.lastActivity || at > entry.lastActivity) entry.lastActivity = at
    } catch {}
  }

  // 项目任务
  for (const task of taskStore.tasks) {
    const pid = task.project_id
    const project = projectStore.projects.find(p => p.id === pid)
    if (!project || !ACTIVE_PROJECT_STATUSES.includes(project.status)) continue
    const entry = ensure(pid, project.name)
    entry.taskTotal++
    if (task.status === '已完成') {
      entry.taskCompleted++
      try {
        const updated = parseISO(task.updated_at)
        if (updated >= sevenDaysAgo) entry.recentCompletions++
      } catch {}
    }
    touch(entry, task.updated_at)
  }

  // 关联每日任务：完成/总数并入进度，近7日完成合并，更新时间参与活跃排序
  for (const project of projectStore.projects) {
    if (!ACTIVE_PROJECT_STATUSES.includes(project.status)) continue
    const dailyTotal = Number(project.daily_task_count) || 0
    if (dailyTotal === 0 && !stats[project.id]) continue
    const entry = ensure(project.id, project.name)
    entry.dailyTotal += dailyTotal
    entry.dailyCompleted += Number(project.daily_completed_count) || 0
    entry.recentCompletions += Number(project.daily_recent_completed_count) || 0
    touch(entry, project.daily_last_updated_at)
    touch(entry, project.updated_at)
  }

  return Object.values(stats)
    .filter(p => p.taskTotal + p.dailyTotal > 0)
    .map(p => ({
      ...p,
      progress: p.taskTotal > 0
        ? Math.round((p.taskCompleted / p.taskTotal) * 100)
        : Math.round((p.dailyCompleted / p.dailyTotal) * 100)
    }))
    .sort((a, b) => {
      if (b.recentCompletions !== a.recentCompletions) return b.recentCompletions - a.recentCompletions
      const at = a.lastActivity ? a.lastActivity.getTime() : 0
      const bt = b.lastActivity ? b.lastActivity.getTime() : 0
      return bt - at
    })
    .slice(0, 5)
})

onMounted(async () => {
  await Promise.all([
    projectStore.fetchProjects(),
    taskStore.fetchAllTasks(),
    analyticsStore.fetchAllStats()
  ])
})
</script>

<style scoped>
@import '../styles/bongmaster.css';

/* Stat Cards */
.bm-stat-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: var(--bm-space-lg);
  margin-bottom: var(--bm-space-2xl);
}

@media (max-width: 1100px) {
  .bm-stat-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

@media (max-width: 560px) {
  .bm-stat-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

.bm-stat-card {
  position: relative;
  overflow: hidden;
  background: var(--bm-bg-card);
  border: 1px solid var(--bm-border-default);
  border-radius: var(--bm-radius-md);
  padding: var(--bm-space-lg);
  transition: all var(--bm-transition-fast);
}

.bm-stat-card:hover {
  background: var(--bm-bg-hover);
  box-shadow: 3px 3px 0 rgba(55, 53, 47, 0.08);
  animation: dashboardCardHop 360ms steps(4, end);
  transform: translate(-1px, -2px);
}

.bm-stat-card::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(rgba(46, 170, 220, 0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(46, 170, 220, 0.032) 1px, transparent 1px);
  background-size: 8px 8px;
  opacity: 0.42;
  animation: dashboardPixelDrift 7200ms steps(8, end) infinite;
}

.bm-stat-card.success::before {
  background:
    linear-gradient(rgba(15, 123, 108, 0.045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(15, 123, 108, 0.035) 1px, transparent 1px);
  background-size: 8px 8px;
}

.bm-stat-card.info::before {
  background:
    linear-gradient(rgba(245, 197, 24, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(46, 170, 220, 0.032) 1px, transparent 1px);
  background-size: 8px 8px;
}

.bm-stat-content {
  position: relative;
  z-index: 1;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.bm-stat-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--bm-text-primary);
  line-height: 1.2;
  margin-bottom: var(--bm-space-xs);
}

.bm-stat-label {
  font-size: 0.875rem;
  color: var(--bm-text-secondary);
  font-weight: 500;
}

.bm-stat-hint {
  display: block;
  margin-top: 3px;
  color: var(--bm-text-muted);
  font-size: 0.6875rem;
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bm-stat-icon {
  position: relative;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bm-bg-hover);
  border-radius: var(--bm-radius-md);
  font-size: 1rem;
  color: var(--bm-accent-blue);
}

.bm-stat-icon::after {
  content: '';
  position: absolute;
  right: 7px;
  bottom: 7px;
  width: 5px;
  height: 5px;
  background: currentColor;
  opacity: 0.65;
  animation: dashboardIconBlink 1500ms steps(2, end) infinite;
}

.bm-stat-card.success .bm-stat-icon {
  color: var(--bm-accent-teal);
}

.bm-stat-card.info .bm-stat-icon {
  color: var(--bm-accent-blue);
}

.bm-stat-card.danger .bm-stat-icon {
  color: var(--bm-accent-red);
}

/* Rank List */
.active-projects-card {
  border-color: #e5e5ea;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.03);
}

.active-projects-card .bm-card-header {
  border-bottom: 0;
  padding-bottom: 0;
}

.active-projects-card .bm-card-header h3 {
  font-size: 15px;
  font-weight: 600;
}

.active-range {
  color: #9a9389;
  font-size: 10.5px;
}

.bm-rank-list {
  display: flex;
  flex-direction: column;
}

.bm-rank-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 4px;
  border-bottom: 1px solid #f2eee7;
}

.bm-rank-item:last-child {
  border-bottom: none;
}

.bm-rank-item::after {
  content: none;
}

.bm-rank-main {
  flex: 1;
  min-width: 0;
}

.bm-rank-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.bm-rank-number {
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  display: grid;
  place-items: center;
  background: #f4f1ea;
  border-radius: 50%;
  font-size: 10.5px;
  font-weight: 600;
  color: #6f6a62;
}

.bm-rank-item:first-child .bm-rank-number {
  background: #eef1f6;
  color: #5e7094;
}

.bm-rank-name {
  font-size: 13px;
  font-weight: 600;
  color: #2d2822;
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bm-rank-name:hover {
  color: #5e7094;
}

.bm-rank-badge {
  font-size: 10px;
  font-weight: 600;
  background: rgba(94, 112, 148, 0.10);
  color: #5e7094;
  padding: 1px 5px;
  border-radius: 5px;
}

.bm-rank-progress {
  display: flex;
  align-items: center;
  gap: 8px;
}

.bm-progress-bar {
  flex: 1;
  height: 3px;
  background: #f1ede6;
  border-radius: 999px;
  overflow: hidden;
}

.bm-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #93a3bd, #6d82a8);
  border-radius: 999px;
  transition: width 0.3s ease;
  animation: none;
}

.bm-rank-meta {
  font-size: 11px;
  color: #9a9389;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

/* Efficiency Cards */
.bm-efficiency-card {
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  gap: var(--bm-space-md);
  padding: var(--bm-space-md);
  background: var(--bm-bg-card);
  border: 1px solid var(--bm-border-default);
  border-radius: var(--bm-radius-md);
  transition: all var(--bm-transition-fast);
}

.bm-efficiency-card:hover {
  background: var(--bm-bg-hover);
  transform: translateY(-1px);
}

.bm-efficiency-card::after {
  content: '';
  position: absolute;
  inset: auto 12px 8px 12px;
  height: 2px;
  pointer-events: none;
  background:
    repeating-linear-gradient(
      90deg,
      color-mix(in srgb, var(--bm-accent-blue) 36%, transparent) 0 7px,
      transparent 7px 11px
    );
  opacity: 0.28;
}

.bm-efficiency-icon {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bm-bg-hover);
  border-radius: var(--bm-radius-sm);
  font-size: 1rem;
  color: var(--bm-accent-blue);
  flex-shrink: 0;
}

.bm-efficiency-icon.accent {
  background: var(--bm-bg-hover);
  color: var(--bm-accent-orange);
}

.bm-efficiency-content {
  flex: 1;
  min-width: 0;
}

.bm-efficiency-content h6 {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--bm-text-muted);
  margin: 0 0 var(--bm-space-xs) 0;
  text-transform: none;
  letter-spacing: 0;
}

.bm-efficiency-value {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--bm-text-primary);
}

.dashboard-analytics-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.8fr) minmax(300px, 1fr);
  gap: var(--bm-space-lg);
}

.trend-card { grid-row: span 2; }
.priority-distribution { display: grid; gap: 16px; min-height: 96px; align-content: center; }
.priority-row { display: grid; grid-template-columns: 64px 1fr 24px; align-items: center; gap: 10px; font-size: 12px; }
.priority-label { color: var(--bm-text-secondary); }
.priority-track { height: 8px; overflow: hidden; border-radius: 4px; background: var(--bm-bg-hover); }
.priority-fill { height: 100%; border-radius: inherit; transition: width 200ms ease; }
.priority-fill.priority-高 { background: var(--bm-accent-red); }
.priority-fill.priority-中 { background: var(--bm-accent-orange); }
.priority-fill.priority-低 { background: var(--bm-accent-teal); }
.priority-row strong { text-align: right; font-variant-numeric: tabular-nums; }
.priority-empty { color: var(--bm-text-muted); text-align: center; padding: 24px 0; }
.chart-data-details { margin-top: 12px; color: var(--bm-text-secondary); font-size: 12px; }
.chart-data-details table { width: 100%; margin-top: 8px; border-collapse: collapse; }
.chart-data-details th, .chart-data-details td { padding: 5px; border-bottom: 1px solid var(--bm-border-subtle); text-align: left; }

/* Section spacing */
.bm-section {
  margin-bottom: var(--bm-space-2xl);
}

@keyframes dashboardCardHop {
  0% { transform: translate(0, 0); }
  35% { transform: translate(-1px, -4px); }
  70% { transform: translate(-1px, -2px); }
  100% { transform: translate(-1px, -2px); }
}

@keyframes dashboardPixelDrift {
  0% { background-position: 0 0, 0 0; }
  100% { background-position: 32px 24px, 32px 24px; }
}

@keyframes dashboardIconBlink {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 0.8; }
}

@keyframes dashboardLineSweep {
  0% { transform: translateX(-8px); }
  100% { transform: translateX(12px); }
}

@keyframes dashboardProgressMarch {
  0% { background-position: 0 0; }
  100% { background-position: 24px 0; }
}

@media (max-width: 1000px) {
  .dashboard-analytics-grid { grid-template-columns: 1fr; }
  .trend-card { grid-row: auto; }
}

@media (prefers-reduced-motion: reduce) {
  .priority-fill { transition: none; }
}
</style>
