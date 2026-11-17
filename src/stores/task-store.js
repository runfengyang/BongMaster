import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

function serialize(data) {
  return JSON.parse(JSON.stringify(data))
}

export const useTaskStore = defineStore('tasks', () => {
  const tasks = ref([])
  const loading = ref(false)
  const error = ref(null)

  const todoTasks = computed(() => tasks.value.filter(t => t.status === '待办'))
  const inProgressTasks = computed(() => tasks.value.filter(t => t.status === '进行中'))
  const doneTasks = computed(() => tasks.value.filter(t => t.status === '已完成'))

  const fetchAllTasks = async () => {
    loading.value = true
    error.value = null
    try {
      tasks.value = await window.electronAPI.getAllTasks()
    } catch (err) {
      error.value = err.message
      console.error('[TaskStore] fetchAllTasks error:', err)
    } finally {
      loading.value = false
    }
  }

  const fetchTasksByProject = async (projectId) => {
    loading.value = true
    error.value = null
    try {
      const projectTasks = await window.electronAPI.getTasksByProjectId(projectId)
      tasks.value = tasks.value.filter(t => t.project_id !== projectId)
      tasks.value.push(...projectTasks)
      return projectTasks
    } catch (err) {
      error.value = err.message
      console.error('[TaskStore] fetchTasksByProject error:', err)
      return []
    } finally {
      loading.value = false
    }
  }

  const createTask = async (data) => {
    try {
      error.value = null
      const task = await window.electronAPI.createTask(serialize(data))
      if (task) {
        tasks.value.unshift(task)
      }
      return task
    } catch (err) {
      error.value = err.message
      console.error('[TaskStore] createTask error:', err)
      alert('创建任务失败: ' + err.message)
      return null
    }
  }

  const updateTask = async (id, data) => {
    try {
      error.value = null
      const existing = tasks.value.find(t => t.id === id)
      const wasCompleted = existing?.status === '已完成'
      const nowCompleted = data.status === '已完成'

      const task = await window.electronAPI.updateTask(id, serialize(data))
      if (!task) {
        throw new Error('更新任务失败：后端返回空结果')
      }
      const index = tasks.value.findIndex(t => t.id === id)
      if (index !== -1) {
        tasks.value[index] = task
      }

      // 如果任务新完成，记录完成历史
      if (nowCompleted && !wasCompleted && existing) {
        const createdAt = new Date(existing.created_at)
        const completedAt = new Date()
        const completionTimeMinutes = Math.round((completedAt - createdAt) / (1000 * 60))

        try {
          await window.electronAPI.recordTaskCompletion({
            taskId: id,
            projectId: existing.project_id,
            completionTimeMinutes
          })
        } catch (_) { /* non-critical */ }

        // Balatro 联动：项目任务完成发金币（静默，绝不影响主流程）
        import('../balatro/integration.js')
          .then(m => m.notifyProjectTaskCompleted({ taskId: id }))
          .catch(() => {})
      }

      return task
    } catch (err) {
      error.value = err.message
      console.error('[TaskStore] updateTask error:', err)
      alert('更新任务失败: ' + err.message)
      return null
    }
  }

  const deleteTask = async (id) => {
    try {
      error.value = null
      await window.electronAPI.deleteTask(id)
      tasks.value = tasks.value.filter(t => t.id !== id)
      return true
    } catch (err) {
      error.value = err.message
      console.error('[TaskStore] deleteTask error:', err)
      alert('删除任务失败: ' + err.message)
      return false
    }
  }

  // 撤回删除：取消 tombstone，保留原任务 id 与完成历史。
  const restoreTask = async (task) => {
    try {
      error.value = null
      const taskId = Number(task?.id)
      if (!Number.isInteger(taskId) || taskId <= 0) return false

      await window.electronAPI.restoreEntities('tasks', [taskId])
      await fetchAllTasks()
      return true
    } catch (err) {
      error.value = err.message
      console.error('[TaskStore] restoreTask error:', err)
      return false
    }
  }

  return {
    tasks,
    loading,
    error,
    todoTasks,
    inProgressTasks,
    doneTasks,
    fetchAllTasks,
    fetchTasksByProject,
    createTask,
    updateTask,
    deleteTask,
    restoreTask
  }
})
