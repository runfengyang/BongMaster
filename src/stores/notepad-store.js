import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

function serialize(data) {
  return JSON.parse(JSON.stringify(data))
}

function toBoolean(value) {
  return value === true || value === 1 || value === '1'
}

function normalizeNote(note) {
  if (!note) return note
  return {
    ...note,
    is_pinned: toBoolean(note.is_pinned),
    is_minimized: toBoolean(note.is_minimized),
    is_archived: toBoolean(note.is_archived)
  }
}

export const useNotepadStore = defineStore('notepad', () => {
  // State
  const notes = ref([])
  const categories = ref([])
  const currentCategory = ref(null)
  const loading = ref(false)
  const error = ref(null)

  // Getters
  const sortedNotes = computed(() => {
    // Pinned notes first, then by updatedAt descending
    return [...notes.value].sort((a, b) => {
      if (a.is_pinned === b.is_pinned) {
        return new Date(b.updated_at) - new Date(a.updated_at)
      }
      return a.is_pinned ? -1 : 1
    })
  })

  const unarchivedNotes = computed(() => sortedNotes.value.filter(n => !toBoolean(n.is_archived)))
  const archivedNotes = computed(() => sortedNotes.value.filter(n => toBoolean(n.is_archived)))
  const pinnedNotes = computed(() => unarchivedNotes.value.filter(n => n.is_pinned))
  const unpinnedNotes = computed(() => unarchivedNotes.value.filter(n => !n.is_pinned))
  const activeNotes = computed(() => notes.value.filter(n => !n.is_minimized && !toBoolean(n.is_archived)))
  const minimizedNotes = computed(() => notes.value.filter(n => n.is_minimized && !toBoolean(n.is_archived)))

  // Grouped notes by category
  const groupedNotes = computed(() => {
    const grouped = {}
    // Initialize with all categories (including empty ones)
    categories.value.forEach(cat => {
      grouped[cat.name] = []
    })
    // Group notes by category
    unarchivedNotes.value.forEach(note => {
      const cat = note.category || '未分类'
      if (!grouped[cat]) {
        grouped[cat] = []
      }
      grouped[cat].push(note)
    })
    return grouped
  })

  // Filtered notes by current category
  const filteredNotes = computed(() => {
    if (!currentCategory.value) {
      return unarchivedNotes.value
    }
    return unarchivedNotes.value.filter(n => n.category === currentCategory.value)
  })

  // Actions
  const fetchNotes = async (options = {}) => {
    loading.value = true
    error.value = null
    try {
      const includeArchived = options.includeArchived !== false
      const result = await window.electronAPI.getDesktopNotes({ includeArchived })
      notes.value = Array.isArray(result) ? result.map(normalizeNote) : []
    } catch (err) {
      error.value = err.message
      console.error('[NotepadStore] fetchNotes error:', err)
    } finally {
      loading.value = false
    }
  }

  const fetchCategories = async () => {
    loading.value = true
    error.value = null
    try {
      categories.value = await window.electronAPI.getCategories()
    } catch (err) {
      error.value = err.message
      console.error('[NotepadStore] fetchCategories error:', err)
    } finally {
      loading.value = false
    }
  }

  const createCategory = async (name) => {
    try {
      error.value = null
      const result = await window.electronAPI.createCategory(name)
      if (result && result.success) {
        await fetchCategories()
        return result
      }
      return result
    } catch (err) {
      error.value = err.message
      console.error('[NotepadStore] createCategory error:', err)
      alert('创建分类失败: ' + err.message)
      return null
    }
  }

  const deleteCategory = async (name) => {
    try {
      error.value = null
      await window.electronAPI.deleteCategory(name)
      categories.value = categories.value.filter(c => c.name !== name)
      // Reset current category if deleted
      if (currentCategory.value === name) {
        currentCategory.value = null
      }
      return true
    } catch (err) {
      error.value = err.message
      console.error('[NotepadStore] deleteCategory error:', err)
      alert('删除分类失败: ' + err.message)
      return false
    }
  }

  const setCurrentCategory = (category) => {
    currentCategory.value = category
  }

  const createNote = async (data = {}) => {
    try {
      error.value = null
      const noteData = {
        title: data.title || '',
        content: data.content || '',
        category: data.category || null,
        width: data.width || 260,
        height: data.height || 300,
        pos_x: data.pos_x || 0,
        pos_y: data.pos_y || 0,
        is_pinned: data.is_pinned || false,
        is_minimized: data.is_minimized || false,
        is_archived: data.is_archived || false,
        project_ids: Array.isArray(data.project_ids) ? data.project_ids : []
      }
      // 确保传递的是纯对象
      const cleanData = JSON.parse(JSON.stringify(noteData))
      const note = await window.electronAPI.createDesktopNote(cleanData)
      if (note) {
        notes.value.unshift(normalizeNote(note))
      }
      return normalizeNote(note)
    } catch (err) {
      error.value = err.message
      console.error('[NotepadStore] createNote error:', err)
      alert('创建便签失败: ' + err.message)
      return null
    }
  }

  const updateNote = async (id, data) => {
    try {
      error.value = null
      // 确保传递的是纯对象
      const cleanData = JSON.parse(JSON.stringify(data))
      const note = normalizeNote(await window.electronAPI.updateDesktopNote(id, cleanData))
      if (!note) {
        throw new Error('更新便签失败：后端返回空结果')
      }
      const index = notes.value.findIndex(n => n.id === id)
      if (index !== -1) {
        notes.value[index] = note
      }
      return note
    } catch (err) {
      error.value = err.message
      console.error('[NotepadStore] updateNote error:', err)
      alert('更新便签失败: ' + err.message)
      return null
    }
  }

  const deleteNote = async (id) => {
    try {
      error.value = null
      await window.electronAPI.deleteDesktopNote(id)
      notes.value = notes.value.filter(n => n.id !== id)
      return true
    } catch (err) {
      error.value = err.message
      console.error('[NotepadStore] deleteNote error:', err)
      alert('删除便签失败: ' + err.message)
      return false
    }
  }

  // 撤回删除：删除是软删除，取消 tombstone 即可连同项目关联一起恢复。
  // （注意与下面的 restoreNote 区分：那个是取消最小化。）
  const restoreDeletedNote = async (note) => {
    try {
      error.value = null
      const noteId = Number(note?.id)
      if (!Number.isInteger(noteId) || noteId <= 0) return false

      await window.electronAPI.restoreEntities('desktop_notes', [noteId])
      for (const projectId of note.project_ids || []) {
        await window.electronAPI.restoreNoteProjectLink(noteId, Number(projectId))
      }
      await fetchNotes()
      return true
    } catch (err) {
      error.value = err.message
      console.error('[NotepadStore] restoreDeletedNote error:', err)
      return false
    }
  }

  const archiveNote = async (id, isArchived = true) => {
    try {
      error.value = null
      const note = normalizeNote(await window.electronAPI.archiveDesktopNote(id, isArchived))
      if (!note) {
        throw new Error(isArchived ? '归档便签失败：后端返回空结果' : '恢复便签失败：后端返回空结果')
      }
      note.is_archived = Boolean(isArchived)
      const index = notes.value.findIndex(n => n.id === id)
      if (index !== -1) {
        notes.value[index] = note
      }
      return note
    } catch (err) {
      error.value = err.message
      console.error('[NotepadStore] archiveNote error:', err)
      alert((isArchived ? '归档便签失败: ' : '恢复便签失败: ') + err.message)
      return null
    }
  }

  const archiveNotes = async (ids = [], isArchived = true) => {
    try {
      error.value = null
      const cleanIds = Array.isArray(ids)
        ? [...new Set(ids.map(id => Number(id)).filter(id => Number.isInteger(id) && id > 0))]
        : []
      if (cleanIds.length === 0) return { success: true, count: 0 }

      const result = await window.electronAPI.archiveDesktopNotes(cleanIds, isArchived)
      if (!result?.success) {
        throw new Error(isArchived ? '批量归档失败' : '批量恢复失败')
      }
      notes.value = notes.value.map(note =>
        cleanIds.includes(Number(note.id))
          ? normalizeNote({ ...note, is_archived: Boolean(isArchived) })
          : note
      )
      await fetchNotes()
      return result
    } catch (err) {
      error.value = err.message
      console.error('[NotepadStore] archiveNotes error:', err)
      alert((isArchived ? '批量归档便签失败: ' : '批量恢复便签失败: ') + err.message)
      return null
    }
  }

  const setNoteProjects = async (id, projectIds = []) => {
    try {
      error.value = null
      const cleanIds = Array.isArray(projectIds)
        ? projectIds.map(pid => Number(pid)).filter(pid => Number.isInteger(pid) && pid > 0)
        : []
      const note = normalizeNote(await window.electronAPI.setDesktopNoteProjects(id, cleanIds))
      if (!note) {
        throw new Error('更新便签关联项目失败：后端返回空结果')
      }
      const index = notes.value.findIndex(n => n.id === id)
      if (index !== -1) {
        notes.value[index] = note
      }
      return note
    } catch (err) {
      error.value = err.message
      console.error('[NotepadStore] setNoteProjects error:', err)
      alert('更新便签关联项目失败: ' + err.message)
      return null
    }
  }

  const fetchNotesByProject = async (projectId) => {
    try {
      error.value = null
      const result = await window.electronAPI.getDesktopNotesByProject(projectId)
      return Array.isArray(result) ? result.map(normalizeNote) : []
    } catch (err) {
      error.value = err.message
      console.error('[NotepadStore] fetchNotesByProject error:', err)
      return []
    }
  }

  const syncToAppleNotes = async (id, options = {}) => {
    try {
      error.value = null
      const result = await window.electronAPI.syncDesktopNoteToAppleNotes(id, options)
      if (result?.success && result.note) {
        result.note = normalizeNote(result.note)
        const index = notes.value.findIndex(n => n.id === id)
        if (index !== -1) {
          notes.value[index] = result.note
        }
      }
      return result
    } catch (err) {
      error.value = err.message
      console.error('[NotepadStore] syncToAppleNotes error:', err)
      return { success: false, status: 'error', error: err.message }
    }
  }

  const togglePin = async (id) => {
    const note = notes.value.find(n => n.id === id)
    if (!note) return null
    return await updateNote(id, { is_pinned: !note.is_pinned })
  }

  const toggleMinimize = async (id) => {
    const note = notes.value.find(n => n.id === id)
    if (!note) return null
    return await updateNote(id, { is_minimized: !note.is_minimized })
  }

  const getNoteById = (id) => {
    return notes.value.find(n => n.id === id) || null
  }

  // Convenience methods
  const pinNote = async (id) => {
    return await updateNote(id, { is_pinned: true })
  }

  const unpinNote = async (id) => {
    return await updateNote(id, { is_pinned: false })
  }

  const minimizeNote = async (id) => {
    return await updateNote(id, { is_minimized: true })
  }

  const restoreNote = async (id) => {
    return await updateNote(id, { is_minimized: false })
  }

  const moveNote = async (id, posX, posY) => {
    return await updateNote(id, { pos_x: posX, pos_y: posY })
  }

  const resizeNote = async (id, width, height) => {
    return await updateNote(id, { width, height })
  }

  const setNoteCategory = async (id, category) => {
    return await updateNote(id, { category })
  }

  return {
    // State
    notes,
    categories,
    currentCategory,
    loading,
    error,
    // Getters
    sortedNotes,
    unarchivedNotes,
    archivedNotes,
    pinnedNotes,
    unpinnedNotes,
    activeNotes,
    minimizedNotes,
    groupedNotes,
    filteredNotes,
    // Actions
    fetchNotes,
    fetchCategories,
    createCategory,
    deleteCategory,
    setCurrentCategory,
    createNote,
    updateNote,
    deleteNote,
    restoreDeletedNote,
    archiveNote,
    archiveNotes,
    setNoteProjects,
    fetchNotesByProject,
    syncToAppleNotes,
    togglePin,
    toggleMinimize,
    getNoteById,
    pinNote,
    unpinNote,
    minimizeNote,
    restoreNote,
    moveNote,
    resizeNote,
    setNoteCategory
  }
})
