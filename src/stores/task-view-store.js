import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

function serialize(data) {
  return JSON.parse(JSON.stringify(data))
}

export const useTaskViewStore = defineStore('taskViews', () => {
  const views = ref([])
  const loading = ref(false)
  const error = ref(null)

  const builtInViews = computed(() => views.value.filter(v => v.is_builtin))
  const userViews = computed(() => views.value.filter(v => !v.is_builtin))

  const normalizeView = (view) => ({
    ...view,
    filters: view.filters_json || {},
    sort: view.sort_json || [],
    visibleFields: view.visible_fields_json || []
  })

  const fetchViews = async () => {
    loading.value = true
    error.value = null
    try {
      const result = await window.electronAPI.getTaskViews()
      views.value = (result || []).map(normalizeView)
    } catch (err) {
      error.value = err.message
      console.error('[TaskViewStore] fetchViews error:', err)
    } finally {
      loading.value = false
    }
  }

  const createView = async (data) => {
    try {
      error.value = null
      const payload = buildPayload(data)
      const view = await window.electronAPI.createTaskView(serialize(payload))
      if (view) {
        views.value.unshift(normalizeView(view))
      }
      return normalizeView(view)
    } catch (err) {
      error.value = err.message
      console.error('[TaskViewStore] createView error:', err)
      alert('保存视图失败: ' + err.message)
      return null
    }
  }

  const updateView = async (id, data) => {
    try {
      error.value = null
      const payload = buildPayload(data)
      const view = await window.electronAPI.updateTaskView(id, serialize(payload))
      if (view) {
        const index = views.value.findIndex(v => v.id === id)
        if (index !== -1) {
          views.value[index] = normalizeView(view)
        }
      }
      return normalizeView(view)
    } catch (err) {
      error.value = err.message
      console.error('[TaskViewStore] updateView error:', err)
      alert('更新视图失败: ' + err.message)
      return null
    }
  }

  const deleteView = async (id) => {
    try {
      error.value = null
      await window.electronAPI.deleteTaskView(id)
      views.value = views.value.filter(v => v.id !== id)
      return true
    } catch (err) {
      error.value = err.message
      console.error('[TaskViewStore] deleteView error:', err)
      alert('删除视图失败: ' + err.message)
      return false
    }
  }

  function buildPayload(data) {
    return {
      name: data.name,
      view_type: data.view_type || 'board',
      group_by: data.group_by || 'status',
      filters_json: data.filters || data.filters_json || {},
      sort_json: data.sort || data.sort_json || [],
      visible_fields_json: data.visible_fields || data.visible_fields_json || [],
      sort_order: data.sort_order ?? 0,
      is_builtin: data.is_builtin ?? false
    }
  }

  return {
    views,
    loading,
    error,
    builtInViews,
    userViews,
    fetchViews,
    createView,
    updateView,
    deleteView
  }
})
