import { createRouter, createWebHashHistory } from 'vue-router'
import DashboardView from '@views/DashboardView.vue'
import ProjectWorkspaceView from '@views/ProjectWorkspaceView.vue'
import TaskBoardView from '@views/TaskBoardView.vue'
import CalendarView from '@views/CalendarView.vue'
import RemindersView from '@views/RemindersView.vue'
import EntertainmentPlaceholder from '@views/EntertainmentPlaceholder.vue'
import NotepadView from '@views/NotepadView.vue'
import HabitView from '@views/HabitView.vue'

const routes = [
  { path: '/', name: 'Dashboard', component: DashboardView },
  { path: '/projects/:id?', name: 'Projects', component: ProjectWorkspaceView, props: true },
  { path: '/calendar', name: 'Calendar', component: CalendarView },
  { path: '/tasks', name: 'Tasks', component: TaskBoardView },
  { path: '/reminders', name: 'Reminders', component: RemindersView },
  { path: '/daily-tasks', redirect: '/reminders' },
  { path: '/habits', name: 'Habits', component: HabitView },
  { path: '/entertainment', name: 'Entertainment', component: EntertainmentPlaceholder },
  { path: '/cards', redirect: '/' },
  { path: '/notepad', name: 'Notepad', component: NotepadView }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
