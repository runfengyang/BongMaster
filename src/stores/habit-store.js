import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

function serialize(data) {
  return JSON.parse(JSON.stringify(data))
}

export const useHabitStore = defineStore('habits', () => {
  // State
  const habits = ref([])
  const checkins = ref([])
  const loading = ref(false)
  const error = ref(null)
  const selectedHabitId = ref(null)

  // Getters
  const activeHabits = computed(() =>
    habits.value.filter(h => !h.is_archived)
  )

  const archivedHabits = computed(() =>
    habits.value.filter(h => h.is_archived)
  )

  const getCheckinsByHabit = computed(() => (habitId) => {
    return checkins.value.filter(c => c.habit_id === habitId)
  })

  const getCheckinsByDateRange = computed(() => (startDate, endDate) => {
    return checkins.value.filter(c => {
      const date = c.checkin_date
      return date >= startDate && date <= endDate
    })
  })

  const selectedHabit = computed(() => {
    return habits.value.find(h => h.id === selectedHabitId.value) || null
  })

  const upsertLocalCheckin = (checkin) => {
    const index = checkins.value.findIndex(c =>
      c.id === checkin.id ||
      (c.habit_id === checkin.habit_id && c.checkin_date === checkin.checkin_date)
    )
    if (index === -1) {
      checkins.value.unshift(checkin)
    } else {
      checkins.value[index] = checkin
    }
  }

  // Actions - Habits
  const fetchHabits = async () => {
    loading.value = true
    error.value = null
    try {
      habits.value = await window.electronAPI.getAllHabits()
    } catch (err) {
      error.value = err.message
      console.error('[HabitStore] fetchHabits error:', err)
    } finally {
      loading.value = false
    }
  }

  const createHabit = async (data) => {
    try {
      error.value = null
      const habit = await window.electronAPI.createHabit(serialize(data))
      if (habit) {
        habits.value.unshift(habit)
      }
      return habit
    } catch (err) {
      error.value = err.message
      console.error('[HabitStore] createHabit error:', err)
      alert('创建习惯失败: ' + err.message)
      return null
    }
  }

  const updateHabit = async (id, data) => {
    try {
      error.value = null
      const habit = await window.electronAPI.updateHabit(id, serialize(data))
      if (!habit) {
        throw new Error('更新习惯失败：后端返回空结果')
      }
      const index = habits.value.findIndex(h => h.id === id)
      if (index !== -1) {
        habits.value[index] = habit
      }
      return habit
    } catch (err) {
      error.value = err.message
      console.error('[HabitStore] updateHabit error:', err)
      alert('更新习惯失败: ' + err.message)
      return null
    }
  }

  const deleteHabit = async (id) => {
    try {
      error.value = null
      await window.electronAPI.deleteHabit(id)
      habits.value = habits.value.filter(h => h.id !== id)
      checkins.value = checkins.value.filter(c => c.habit_id !== id)
      return true
    } catch (err) {
      error.value = err.message
      console.error('[HabitStore] deleteHabit error:', err)
      alert('删除习惯失败: ' + err.message)
      return false
    }
  }

  const archiveHabit = async (id, isArchived) => {
    try {
      error.value = null
      const habit = await window.electronAPI.archiveHabit(id, isArchived)
      if (!habit) {
        throw new Error('归档习惯失败：后端返回空结果')
      }
      const index = habits.value.findIndex(h => h.id === id)
      if (index !== -1) {
        habits.value[index] = habit
      }
      return habit
    } catch (err) {
      error.value = err.message
      console.error('[HabitStore] archiveHabit error:', err)
      alert('归档习惯失败: ' + err.message)
      return null
    }
  }

  const selectHabit = (id) => {
    selectedHabitId.value = id
  }

  // Actions - Checkins
  const fetchCheckins = async (startDate, endDate) => {
    loading.value = true
    error.value = null
    try {
      checkins.value = await window.electronAPI.getAllCheckins(startDate, endDate)
    } catch (err) {
      error.value = err.message
      console.error('[HabitStore] fetchCheckins error:', err)
    } finally {
      loading.value = false
    }
  }

  const fetchCheckinsByHabit = async (habitId, startDate, endDate) => {
    try {
      const habitCheckins = await window.electronAPI.getHabitCheckins(habitId, startDate, endDate)
      // Merge with existing checkins, replacing old ones for this habit
      checkins.value = checkins.value.filter(c => c.habit_id !== habitId)
      checkins.value.push(...habitCheckins)
      return habitCheckins
    } catch (err) {
      console.error('[HabitStore] fetchCheckinsByHabit error:', err)
      return []
    }
  }

  const createCheckin = async (data) => {
    try {
      error.value = null
      const checkin = await window.electronAPI.createHabitCheckin(serialize(data))
      if (checkin) {
        upsertLocalCheckin(checkin)
        // Balatro 联动（§7）：打卡成功发放游戏奖励，连续 7 天里程碑送天体包（静默，不影响打卡）
        import('../balatro/integration.js').then(m => {
          let streak = 0
          try {
            const dates = new Set(
              checkins.value.filter(c => c.habit_id === checkin.habit_id).map(c => c.checkin_date))
            const day = new Date(checkin.checkin_date + 'T00:00:00')
            const key = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
            while (dates.has(key(day))) { streak += 1; day.setDate(day.getDate() - 1) }
          } catch { streak = 0 }
          m.notifyHabitCheckin({ habitId: checkin.habit_id, date: checkin.checkin_date, streak })
        }).catch(() => {})
      }
      return checkin
    } catch (err) {
      error.value = err.message
      console.error('[HabitStore] createCheckin error:', err)
      alert('创建打卡失败: ' + err.message)
      return null
    }
  }

  const updateCheckin = async (id, data) => {
    try {
      error.value = null
      const checkin = await window.electronAPI.updateHabitCheckin(id, serialize(data))
      if (!checkin) {
        throw new Error('更新打卡失败：后端返回空结果')
      }
      const index = checkins.value.findIndex(c => c.id === id)
      if (index !== -1) {
        checkins.value[index] = checkin
      }
      return checkin
    } catch (err) {
      error.value = err.message
      console.error('[HabitStore] updateCheckin error:', err)
      alert('更新打卡失败: ' + err.message)
      return null
    }
  }

  const deleteCheckin = async (id) => {
    try {
      error.value = null
      await window.electronAPI.deleteHabitCheckin(id)
      checkins.value = checkins.value.filter(c => c.id !== id)
      return true
    } catch (err) {
      error.value = err.message
      console.error('[HabitStore] deleteCheckin error:', err)
      alert('删除打卡失败: ' + err.message)
      return false
    }
  }

  const getCheckinByDate = async (habitId, date) => {
    try {
      return await window.electronAPI.getCheckinByDate(habitId, date)
    } catch (err) {
      console.error('[HabitStore] getCheckinByDate error:', err)
      return null
    }
  }

  // Toggle checkin (create if not exists, delete if exists)
  const toggleCheckin = async (habitId, date, level = 1) => {
    try {
      const existing = await getCheckinByDate(habitId, date)
      if (existing) {
        return await deleteCheckin(existing.id)
      } else {
        return await createCheckin({
          habit_id: habitId,
          checkin_date: date,
          level: level
        })
      }
    } catch (err) {
      console.error('[HabitStore] toggleCheckin error:', err)
      return null
    }
  }

  return {
    // State
    habits,
    checkins,
    loading,
    error,
    selectedHabitId,
    // Getters
    activeHabits,
    archivedHabits,
    getCheckinsByHabit,
    getCheckinsByDateRange,
    selectedHabit,
    // Actions - Habits
    fetchHabits,
    createHabit,
    updateHabit,
    deleteHabit,
    archiveHabit,
    selectHabit,
    // Actions - Checkins
    fetchCheckins,
    fetchCheckinsByHabit,
    createCheckin,
    updateCheckin,
    deleteCheckin,
    getCheckinByDate,
    toggleCheckin
  }
})
