import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

function serialize(data) {
  return JSON.parse(JSON.stringify(data))
}

export const useProjectStore = defineStore('projects', () => {
  const projects = ref([])
  const currentProject = ref(null)
  const loading = ref(false)
  const error = ref(null)

  const inProgressProjects = computed(() =>
    projects.value.filter(p => p.status === '进行中')
  )

  const fetchProjects = async () => {
    loading.value = true
    error.value = null
    try {
      projects.value = await window.electronAPI.getAllProjects()
    } catch (err) {
      error.value = err.message
      console.error('[ProjectStore] fetchProjects error:', err)
    } finally {
      loading.value = false
    }
  }

  const fetchProjectById = async (id) => {
    loading.value = true
    error.value = null
    try {
      currentProject.value = await window.electronAPI.getProjectById(id)
      return currentProject.value
    } catch (err) {
      error.value = err.message
      console.error('[ProjectStore] fetchProjectById error:', err)
      return null
    } finally {
      loading.value = false
    }
  }

  const createProject = async (data) => {
    try {
      error.value = null
      const project = await window.electronAPI.createProject(serialize(data))
      if (project) {
        projects.value.unshift(project)
      }
      return project
    } catch (err) {
      error.value = err.message
      console.error('[ProjectStore] createProject error:', err)
      alert('创建项目失败: ' + err.message)
      return null
    }
  }

  const updateProject = async (id, data) => {
    try {
      error.value = null
      const project = await window.electronAPI.updateProject(id, serialize(data))
      if (!project) {
        throw new Error('更新项目失败：后端返回空结果')
      }
      const index = projects.value.findIndex(p => p.id === id)
      if (index !== -1) {
        projects.value[index] = project
      }
      if (currentProject.value?.id === id) {
        currentProject.value = project
      }
      return project
    } catch (err) {
      error.value = err.message
      console.error('[ProjectStore] updateProject error:', err)
      alert('更新项目失败: ' + err.message)
      return null
    }
  }

  const deleteProject = async (id) => {
    try {
      error.value = null
      await window.electronAPI.deleteProject(id)
      projects.value = projects.value.filter(p => p.id !== id)
      if (currentProject.value?.id === id) {
        currentProject.value = null
      }
      return true
    } catch (err) {
      error.value = err.message
      console.error('[ProjectStore] deleteProject error:', err)
      alert('删除项目失败: ' + err.message)
      return false
    }
  }

  // 撤回删除：deleteProject 会级联 tombstone 任务、附件、便签关联，
  // 因此按“项目 → 任务/附件 → 便签关联”的顺序逐层取消 tombstone。
  const restoreProject = async (snapshot) => {
    try {
      error.value = null
      const projectId = Number(snapshot?.id)
      if (!Number.isInteger(projectId) || projectId <= 0) return false

      await window.electronAPI.restoreEntities('projects', [projectId])
      const taskIds = snapshot.taskIds || []
      const documentIds = snapshot.documentIds || []
      if (taskIds.length) await window.electronAPI.restoreEntities('tasks', taskIds)
      if (documentIds.length) await window.electronAPI.restoreEntities('project_documents', documentIds)
      for (const noteId of snapshot.noteIds || []) {
        await window.electronAPI.restoreNoteProjectLink(Number(noteId), projectId)
      }
      await fetchProjects()
      return true
    } catch (err) {
      error.value = err.message
      console.error('[ProjectStore] restoreProject error:', err)
      return false
    }
  }

  return {
    projects,
    currentProject,
    loading,
    error,
    inProgressProjects,
    fetchProjects,
    fetchProjectById,
    createProject,
    updateProject,
    deleteProject,
    restoreProject
  }
})
