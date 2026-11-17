<template>
  <div class="fade-in habit-view">
    <div class="habit-shell">
      <HabitList
        ref="habitListRef"
        :habits="habits"
        :selected-id="selectedHabitId"
        :checked-today-ids="checkedTodayHabitIds"
        @select="selectHabit"
        @create="openCreateModal"
        @edit="openEditModal"
        @archive="archiveHabit"
        @delete="deleteHabit"
        @reorder="reorderHabits"
      />

      <section v-if="selectedHabit" class="habit-detail" :style="{ '--hc': selectedHabit.color || '#10b981' }">
        <Transition name="habit-swap" mode="out-in">
          <div :key="selectedHabit.id" class="habit-detail-inner">
            <header class="habit-detail-head">
              <div class="habit-big-icon"><i :class="selectedHabit.icon || 'fas fa-fire'"></i></div>
              <div class="habit-titles">
                <h1>{{ selectedHabit.name }}</h1>
                <p>每天 · 已连续 {{ currentStreak }} 天 · 本月 {{ monthCheckins }} 次</p>
              </div>
              <div class="habit-head-actions">
                <button type="button" @click="openEditModal(selectedHabit)">编辑</button>
                <button type="button" @click="openSelectedMenu">更多</button>
              </div>
            </header>

            <div class="habit-main-grid">
            <div class="habit-checkin" :class="{ done: todayCheckin, pulse: checkinPulse }">
              <div class="checkin-head">
                <h2>今日打卡</h2>
                <span>{{ todayDisplay }}</span>
                <span class="checkin-status" :class="{ done: todayCheckin }">
                  <i class="fas" :class="todayCheckin ? 'fa-check' : 'fa-clock'"></i>
                  {{ todayCheckin ? `已完成 · ${levelLabel(todayCheckin.level)}` : '待打卡' }}
                </span>
              </div>

              <div class="checkin-levels" role="group" aria-label="打卡等级">
                <button
                  v-for="level in 4"
                  :key="level"
                  type="button"
                  class="checkin-level"
                  :class="{ on: (todayCheckin?.level || selectedLevel) === level }"
                  @click="chooseLevel(level)"
                >
                  <i :style="{ height: `${level * 3 + 4}px` }"></i>
                  <span>{{ levelLabel(level) }}</span>
                </button>
              </div>

              <input
                v-model="checkinNote"
                class="checkin-note"
                type="text"
                placeholder="添加备注（可选）"
                @keydown.enter.prevent="saveTodayNote"
                @blur="saveTodayNote"
              >

              <div class="checkin-foot">
                <button type="button" class="checkin-primary" :class="{ secondary: todayCheckin }" @click="toggleToday">
                  <i class="fas" :class="todayCheckin ? 'fa-undo' : 'fa-check'"></i>
                  {{ todayCheckin ? '取消今日打卡' : '完成今日打卡' }}
                </button>
                <span>点等级可直接打卡</span>
              </div>
            </div>

            <section class="habit-stats">
              <div class="habit-stat">
                <Transition name="stat-pop" mode="out-in">
                  <b :key="currentStreak">{{ currentStreak }}</b>
                </Transition>
                <span>当前连续（天）</span>
                <small>本周 {{ weekDone }}/7</small>
              </div>
              <div class="habit-stat">
                <Transition name="stat-pop" mode="out-in">
                  <b :key="longestStreak">{{ longestStreak }}</b>
                </Transition>
                <span>最长连续（天）</span>
                <small>历史记录</small>
              </div>
              <div class="habit-stat">
                <Transition name="stat-pop" mode="out-in">
                  <b :key="monthCheckins">{{ monthCheckins }}</b>
                </Transition>
                <span>本月打卡</span>
                <small>平均等级 {{ avgLevel }}</small>
              </div>
              <div class="habit-stat">
                <Transition name="stat-pop" mode="out-in">
                  <b :key="completionRate">{{ completionRate }}%</b>
                </Transition>
                <span>本年完成率</span>
                <small>本年 {{ yearCheckins }} 次</small>
              </div>
            </section>
            </div>

            <section class="habit-trend">
              <div class="habit-section-head">
                <h3>打卡趋势</h3>
                <span>近 12 个月</span>
                <div class="heatmap-legend">
                  少
                  <i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i>
                  多
                </div>
              </div>
              <div class="heatmap-wrap">
                <div class="heatmap-weekdays"><span>一</span><span></span><span>三</span><span></span><span>五</span><span></span><span>日</span></div>
                <div class="heatmap">
                  <button
                    v-for="cell in heatmapCells"
                    :key="cell.date"
                    type="button"
                    class="heatmap-cell"
                    :class="[`l${cell.level}`, { future: cell.future, today: cell.date === todayKey() }]"
                    :title="`${cell.date}${cell.level ? ` · ${levelLabel(cell.level)}` : ' · 未打卡'}`"
                    @click="openCheckinAt(cell)"
                  ></button>
                </div>
              </div>
            </section>




          </div>
        </Transition>
      </section>

      <section v-else class="habit-detail empty-detail">
        <div class="habit-empty">
          <i class="fas fa-fire"></i>
          <p>还没有习惯</p>
          <button type="button" class="checkin-primary" @click="openCreateModal">新建第一个习惯</button>
        </div>
      </section>
    </div>

    <!-- 新建 / 编辑习惯 -->
    <div class="bm-modal-overlay" :class="{ show: showModal }" @click.self="showModal = false">
      <div class="bm-modal habit-modal">
        <div class="bm-modal-header">
          <h3>{{ editingHabit ? '编辑习惯' : '新建习惯' }}</h3>
          <button type="button" class="bm-modal-close" @click="showModal = false">&times;</button>
        </div>
        <div class="bm-modal-body">
          <div class="bm-form-group">
            <label class="bm-form-label">习惯名称 *</label>
            <input v-model="habitForm.name" type="text" class="bm-form-control" placeholder="例如：每天阅读">
          </div>
          <div class="bm-form-group">
            <label class="bm-form-label">图标</label>
            <div class="icon-selector">
              <button
                v-for="icon in iconOptions"
                :key="icon"
                type="button"
                class="icon-option"
                :class="{ selected: habitForm.icon === icon }"
                @click="habitForm.icon = icon"
              >
                <i :class="icon"></i>
              </button>
            </div>
          </div>
          <div class="bm-form-group">
            <label class="bm-form-label">颜色</label>
            <div class="color-selector">
              <button
                v-for="color in colorOptions"
                :key="color"
                type="button"
                class="color-option"
                :class="{ selected: habitForm.color === color }"
                :style="{ backgroundColor: color }"
                @click="habitForm.color = color"
              ></button>
            </div>
          </div>
        </div>
        <div class="bm-modal-footer">
          <button type="button" class="bm-btn bm-btn-ghost" @click="showModal = false">取消</button>
          <button type="button" class="bm-btn bm-btn-primary" @click="saveHabit">保存</button>
        </div>
      </div>
    </div>

    <!-- 编辑 / 补卡 -->
    <div class="bm-modal-overlay" :class="{ show: showCheckinModal }" @click.self="closeCheckinModal">
      <div class="bm-modal habit-modal">
        <div class="bm-modal-header">
          <h3>{{ editingCheckin ? '编辑打卡' : '补卡' }}</h3>
          <button type="button" class="bm-modal-close" @click="closeCheckinModal">&times;</button>
        </div>
        <div class="bm-modal-body">
          <div class="bm-form-group">
            <label class="bm-form-label">日期</label>
            <input v-model="checkinForm.date" type="date" class="bm-form-control" disabled>
          </div>
          <div class="bm-form-group">
            <label class="bm-form-label">等级</label>
            <div class="checkin-levels modal-levels">
              <div
                v-for="level in 4"
                :key="level"
                class="level-option"
                :class="{ selected: checkinForm.level === level }"
                @click="checkinForm.level = level"
              >
                <div class="level-box" :style="{ backgroundColor: levelColor(level) }"></div>
                <span class="level-label">{{ levelLabel(level) }}</span>
              </div>
            </div>
          </div>
          <div class="bm-form-group">
            <label class="bm-form-label">备注</label>
            <input v-model="checkinForm.note" type="text" class="bm-form-control" placeholder="添加备注">
          </div>
        </div>
        <div class="bm-modal-footer">
          <button v-if="editingCheckin" type="button" class="bm-btn bm-btn-danger" @click="deleteCheckin">删除</button>
          <span class="habit-footer-spacer"></span>
          <button type="button" class="bm-btn bm-btn-ghost" @click="closeCheckinModal">取消</button>
          <button type="button" class="bm-btn bm-btn-primary" @click="updateCheckin">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { addDays, format } from 'date-fns'
import HabitList from '@components/HabitList.vue'
import { useUndoStore } from '@stores/undo-store'

const undoStore = useUndoStore()
const habitListRef = ref(null)

const LEVEL_LABELS = { 1: '轻量', 2: '正常', 3: '认真', 4: '超额' }
const iconOptions = [
  'fas fa-fire',
  'fas fa-book',
  'fas fa-dumbbell',
  'fas fa-running',
  'fas fa-meditation',
  'fas fa-music',
  'fas fa-code',
  'fas fa-pen',
  'fas fa-heart',
  'fas fa-star',
  'fas fa-moon',
  'fas fa-sun',
  'fas fa-leaf',
  'fas fa-coffee',
  'fas fa-glass-water'
]
const colorOptions = [
  '#10b981', '#3b82f6', '#8b5cf6', '#f97316',
  '#ec4899', '#ef4444', '#06b6d4', '#eab308'
]

const habits = ref([])
const checkins = ref([])
const selectedHabitId = ref(null)
const selectedLevel = ref(2)
const checkinNote = ref('')
const checkinPulse = ref(false)
let pulseTimer = null

const showModal = ref(false)
const showCheckinModal = ref(false)
const editingHabit = ref(null)
const editingCheckin = ref(null)

const habitForm = ref({ name: '', icon: 'fas fa-fire', color: '#10b981' })
const checkinForm = ref({ id: null, date: '', level: 2, note: '' })

const todayKey = () => format(new Date(), 'yyyy-MM-dd')
const parseLocalDate = value => {
  const [year, month, day] = String(value).split('-').map(Number)
  return new Date(year, month - 1, day)
}
const levelLabel = level => LEVEL_LABELS[level] || '未打卡'
const levelColor = level => {
  const color = selectedHabit.value?.color || '#10b981'
  const mix = [0, 24, 44, 68, 100][level] ?? 100
  return `color-mix(in srgb, ${color} ${mix}%, #ffffff)`
}

const selectedHabit = computed(() => habits.value.find(habit => habit.id === selectedHabitId.value) || null)

const todayCheckin = computed(() => {
  if (!selectedHabit.value) return null
  return checkins.value.find(item => (
    item.habit_id === selectedHabit.value.id && item.checkin_date === todayKey()
  )) || null
})

const checkedTodayHabitIds = computed(() => (
  checkins.value.filter(item => item.checkin_date === todayKey()).map(item => item.habit_id)
))

const todayDisplay = computed(() => {
  const now = new Date()
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return `${now.getMonth() + 1}月${now.getDate()}日 ${weekdays[now.getDay()]}`
})

const streakFor = habitId => {
  const dates = [...new Set(
    checkins.value.filter(item => item.habit_id === habitId).map(item => item.checkin_date)
  )].sort().reverse()
  if (!dates.length) return 0
  const today = todayKey()
  const yesterday = format(addDays(new Date(), -1), 'yyyy-MM-dd')
  if (dates[0] !== today && dates[0] !== yesterday) return 0
  const set = new Set(dates)
  let cursor = dates[0] === today ? new Date() : addDays(new Date(), -1)
  cursor.setHours(0, 0, 0, 0)
  let streak = 0
  while (set.has(format(cursor, 'yyyy-MM-dd'))) {
    streak += 1
    cursor = addDays(cursor, -1)
  }
  return streak
}

const currentStreak = computed(() => (
  selectedHabit.value ? streakFor(selectedHabit.value.id) : 0
))

const longestStreak = computed(() => {
  if (!selectedHabit.value) return 0
  const dates = [...new Set(
    checkins.value
      .filter(item => item.habit_id === selectedHabit.value.id)
      .map(item => item.checkin_date)
  )].sort()
  if (!dates.length) return 0
  let longest = 1
  let current = 1
  for (let i = 1; i < dates.length; i += 1) {
    const previous = parseLocalDate(dates[i - 1])
    const next = parseLocalDate(dates[i])
    const diff = Math.round((next - previous) / 86400000)
    if (diff === 1) {
      current += 1
      longest = Math.max(longest, current)
    } else if (diff > 1) {
      current = 1
    }
  }
  return longest
})

const monthCheckins = computed(() => {
  if (!selectedHabit.value) return 0
  const now = new Date()
  const prefix = format(now, 'yyyy-MM')
  return checkins.value.filter(item => (
    item.habit_id === selectedHabit.value.id && item.checkin_date.startsWith(prefix)
  )).length
})

const yearCheckins = computed(() => {
  if (!selectedHabit.value) return 0
  const prefix = String(new Date().getFullYear())
  return checkins.value.filter(item => (
    item.habit_id === selectedHabit.value.id && item.checkin_date.startsWith(prefix)
  )).length
})

const completionRate = computed(() => {
  if (!selectedHabit.value) return 0
  const now = new Date()
  const start = new Date(now.getFullYear(), 0, 1)
  const days = Math.floor((now - start) / 86400000) + 1
  if (days <= 0) return 0
  return Math.round((yearCheckins.value / days) * 100)
})

const avgLevel = computed(() => {
  if (!selectedHabit.value) return '0.0'
  const rows = checkins.value.filter(item => item.habit_id === selectedHabit.value.id)
  if (!rows.length) return '0.0'
  return (rows.reduce((sum, item) => sum + Number(item.level || 0), 0) / rows.length).toFixed(1)
})

const weekDone = computed(() => {
  if (!selectedHabit.value) return 0
  const dates = new Set(
    checkins.value
      .filter(item => item.habit_id === selectedHabit.value.id)
      .map(item => item.checkin_date)
  )
  let count = 0
  for (let i = 0; i < 7; i += 1) {
    if (dates.has(format(addDays(new Date(), -i), 'yyyy-MM-dd'))) count += 1
  }
  return count
})

const heatmapCells = computed(() => {
  if (!selectedHabit.value) return []
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const monday = addDays(today, -((today.getDay() + 6) % 7))
  const start = addDays(monday, -51 * 7)
  const levels = new Map(
    checkins.value
      .filter(item => item.habit_id === selectedHabit.value.id)
      .map(item => [item.checkin_date, item.level])
  )
  const cells = []
  for (let i = 0; i < 52 * 7; i += 1) {
    const date = addDays(start, i)
    const key = format(date, 'yyyy-MM-dd')
    const future = date > today
    cells.push({ date: key, level: future ? 0 : (levels.get(key) || 0), future })
  }
  return cells
})

const syncDraft = () => {
  selectedLevel.value = todayCheckin.value?.level || 2
  checkinNote.value = todayCheckin.value?.note || ''
}

const selectHabit = id => {
  if (selectedHabitId.value === id) return
  selectedHabitId.value = id
}

const pulse = () => {
  checkinPulse.value = false
  if (pulseTimer) window.clearTimeout(pulseTimer)
  requestAnimationFrame(() => {
    checkinPulse.value = true
    pulseTimer = window.setTimeout(() => {
      checkinPulse.value = false
      pulseTimer = null
    }, 680)
  })
}

const upsertLocalCheckin = checkin => {
  const index = checkins.value.findIndex(item => (
    item.id === checkin.id ||
    (item.habit_id === checkin.habit_id && item.checkin_date === checkin.checkin_date)
  ))
  if (index === -1) checkins.value.push(checkin)
  else checkins.value[index] = checkin
}

const rewardCheckin = async checkin => {
  try {
    const { notifyHabitCheckin } = await import('../balatro/integration.js')
    await notifyHabitCheckin({
      habitId: checkin.habit_id,
      date: checkin.checkin_date,
      streak: currentStreak.value
    })
  } catch { /* 游戏奖励失败不影响打卡 */ }
}

const createToday = async (level, note = checkinNote.value) => {
  if (!selectedHabit.value) return
  const created = await window.electronAPI.createHabitCheckin(JSON.parse(JSON.stringify({
    habit_id: selectedHabit.value.id,
    checkin_date: todayKey(),
    level,
    note
  })))
  if (!created) return
  upsertLocalCheckin(created)
  selectedLevel.value = level
  pulse()
  await rewardCheckin(created)
}

const updateToday = async patch => {
  if (!todayCheckin.value) return
  const updated = await window.electronAPI.updateHabitCheckin(
    todayCheckin.value.id,
    JSON.parse(JSON.stringify(patch))
  )
  if (!updated) return
  upsertLocalCheckin(updated)
  if (patch.level) selectedLevel.value = patch.level
  pulse()
}

const chooseLevel = async level => {
  const value = Number(level)
  selectedLevel.value = value
  if (todayCheckin.value) {
    if (Number(todayCheckin.value.level) === value) return
    await updateToday({ level: value })
  } else {
    await createToday(value)
  }
}

const toggleToday = async () => {
  if (!selectedHabit.value) return
  if (todayCheckin.value) {
    await window.electronAPI.deleteHabitCheckin(todayCheckin.value.id)
    checkins.value = checkins.value.filter(item => item.id !== todayCheckin.value.id)
    syncDraft()
    return
  }
  await createToday(selectedLevel.value)
}

const saveTodayNote = async () => {
  if (!todayCheckin.value) return
  const note = checkinNote.value.trim()
  if ((todayCheckin.value.note || '') === note) return
  await updateToday({ note })
}

const openCheckinEdit = checkin => {
  checkinForm.value = {
    id: checkin.id,
    date: checkin.checkin_date,
    level: checkin.level,
    note: checkin.note || ''
  }
  editingCheckin.value = checkin
  showCheckinModal.value = true
}

const openCheckinAt = cell => {
  if (!cell || cell.future || !selectedHabit.value) return
  const existing = checkins.value.find(item => (
    item.habit_id === selectedHabit.value.id && item.checkin_date === cell.date
  ))
  if (existing) {
    openCheckinEdit(existing)
    return
  }
  checkinForm.value = { id: null, date: cell.date, level: 2, note: '' }
  editingCheckin.value = null
  showCheckinModal.value = true
}

const closeCheckinModal = () => {
  showCheckinModal.value = false
  editingCheckin.value = null
  checkinForm.value = { id: null, date: '', level: 2, note: '' }
}

const updateCheckin = async () => {
  try {
    if (editingCheckin.value) {
      const updated = await window.electronAPI.updateHabitCheckin(
        editingCheckin.value.id,
        JSON.parse(JSON.stringify({ level: checkinForm.value.level, note: checkinForm.value.note }))
      )
      if (updated) upsertLocalCheckin(updated)
    } else if (selectedHabit.value) {
      const created = await window.electronAPI.createHabitCheckin(JSON.parse(JSON.stringify({
        habit_id: selectedHabit.value.id,
        checkin_date: checkinForm.value.date,
        level: checkinForm.value.level,
        note: checkinForm.value.note
      })))
      if (created) {
        upsertLocalCheckin(created)
        await rewardCheckin(created)
      }
    }
    const editedToday = checkinForm.value.date === todayKey()
    closeCheckinModal()
    if (editedToday) syncDraft()
  } catch (err) {
    console.error('保存打卡失败:', err)
    alert('保存失败: ' + err.message)
  }
}

const deleteCheckin = async () => {
  if (!editingCheckin.value) return
  try {
    const wasToday = editingCheckin.value.checkin_date === todayKey()
    await window.electronAPI.deleteHabitCheckin(editingCheckin.value.id)
    checkins.value = checkins.value.filter(item => item.id !== editingCheckin.value.id)
    closeCheckinModal()
    if (wasToday) syncDraft()
  } catch (err) {
    console.error('删除打卡失败:', err)
    alert('删除失败: ' + err.message)
  }
}

const openCreateModal = () => {
  editingHabit.value = null
  habitForm.value = { name: '', icon: 'fas fa-fire', color: '#10b981' }
  showModal.value = true
}

const openEditModal = habit => {
  editingHabit.value = habit
  habitForm.value = {
    name: habit.name,
    icon: habit.icon || 'fas fa-fire',
    color: habit.color || '#10b981'
  }
  showModal.value = true
}

const openSelectedMenu = event => {
  if (!selectedHabit.value) return
  habitListRef.value?.openMenu(selectedHabit.value, event)
}

const saveHabit = async () => {
  const name = habitForm.value.name.trim()
  if (!name) return
  try {
    const data = JSON.parse(JSON.stringify({ ...habitForm.value, name }))
    if (editingHabit.value) {
      const updated = await window.electronAPI.updateHabit(editingHabit.value.id, data)
      const index = habits.value.findIndex(item => item.id === editingHabit.value.id)
      if (index !== -1) habits.value[index] = { ...habits.value[index], ...(updated || data) }
    } else {
      const created = await window.electronAPI.createHabit(data)
      if (created) {
        habits.value.push(created)
        selectedHabitId.value = created.id
      }
    }
    showModal.value = false
  } catch (err) {
    console.error('保存习惯失败:', err)
    alert('保存失败: ' + err.message)
  }
}

const selectNearestHabit = removedId => {
  if (selectedHabitId.value !== removedId) return
  const next = habits.value[0]
  selectedHabitId.value = next ? next.id : null
}

const archiveHabit = async id => {
  const habit = habits.value.find(item => item.id === id)
  if (!habit) return
  try {
    await window.electronAPI.updateHabit(id, { is_archived: true })
    habits.value = habits.value.filter(item => item.id !== id)
    selectNearestHabit(id)
    undoStore.showUndo({
      message: `已归档「${habit.name}」`,
      undo: async () => {
        await window.electronAPI.updateHabit(id, { is_archived: false })
        await loadHabits()
        selectedHabitId.value = id
      }
    })
  } catch (err) {
    console.error('归档习惯失败:', err)
    alert('归档失败: ' + err.message)
  }
}

const deleteHabit = async id => {
  const habit = habits.value.find(item => item.id === id)
  if (!habit) return
  if (!confirm(`确定要删除习惯「${habit.name}」吗？\n所有打卡记录也会一起删除。`)) return
  try {
    await window.electronAPI.deleteHabit(id)
    habits.value = habits.value.filter(item => item.id !== id)
    checkins.value = checkins.value.filter(item => item.habit_id !== id)
    selectNearestHabit(id)
  } catch (err) {
    console.error('删除习惯失败:', err)
    alert('删除失败: ' + err.message)
  }
}

const reorderHabits = async updated => {
  try {
    await Promise.all(updated.map(habit => (
      window.electronAPI.updateHabit(habit.id, { sort_order: habit.sort_order })
    )))
    habits.value = updated
  } catch (err) {
    console.error('重新排序失败:', err)
  }
}

const loadHabits = async () => {
  try {
    const data = await window.electronAPI.getAllHabits()
    habits.value = (data || []).filter(habit => !habit.is_archived)
    if (!habits.value.length) {
      selectedHabitId.value = null
      return
    }
    if (!habits.value.some(habit => habit.id === selectedHabitId.value)) {
      selectedHabitId.value = habits.value[0].id
    }
  } catch (err) {
    console.error('加载习惯失败:', err)
  }
}

const loadCheckins = async () => {
  try {
    checkins.value = (await window.electronAPI.getAllCheckins()) || []
  } catch (err) {
    console.error('加载打卡记录失败:', err)
  }
}

watch(selectedHabitId, () => {
  nextTick(syncDraft)
})

onMounted(async () => {
  await Promise.all([loadHabits(), loadCheckins()])
  await nextTick()
  syncDraft()
})

onUnmounted(() => {
  if (pulseTimer) window.clearTimeout(pulseTimer)
})
</script>

<style scoped>
.habit-view {
  height: calc(100vh - var(--bm-navbar-height));
  padding: 10px 14px 12px;
  font-family: var(--bm-font-family);
}

.habit-shell {
  display: flex;
  align-items: stretch;
  gap: 10px;
  width: 100%;
  max-width: 1180px;
  height: 100%;
  margin: 0 auto;
  min-height: 0;
}

.habit-detail {
  flex: 1;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow-y: auto;
  padding: 12px 14px 14px;
  border: 1px solid var(--bm-border-default);
  border-radius: var(--bm-radius-lg);
  background: var(--bm-bg-card);
  box-shadow: var(--bm-shadow-sm);
}

.habit-detail-inner { min-height: 100%; }

.habit-main-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
  gap: 10px;
  margin-bottom: 10px;
  align-items: stretch;
}

.habit-detail-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.habit-big-icon {
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: color-mix(in srgb, var(--hc) 12%, transparent);
  color: var(--hc);
  font-size: 17px;
  transition: background 180ms ease;
}

.habit-titles { min-width: 0; }
.habit-titles h1 {
  margin: 0 0 2px;
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.03em;
}
.habit-titles p { margin: 0; color: var(--bm-text-muted); font-size: 10.5px; }

.habit-head-actions { margin-left: auto; display: flex; gap: 4px; }
.habit-head-actions button {
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--bm-border-default);
  border-radius: 7px;
  background: var(--bm-bg-card);
  color: var(--bm-text-secondary);
  font: inherit;
  font-size: 11.5px;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}
.habit-head-actions button:hover {
  border-color: var(--bm-border-strong);
  background: var(--bm-bg-hover);
  color: var(--bm-text-primary);
}

.habit-checkin {
  position: relative;
  padding: 11px 13px;
  border: 1px solid var(--bm-border-subtle);
  border-radius: 10px;
  background: var(--bm-bg-sidebar);
  transition: border-color 180ms ease, background 180ms ease;
}

.habit-checkin.done { border-color: color-mix(in srgb, var(--hc) 28%, var(--bm-border-subtle)); }

.habit-checkin.pulse::after {
  content: '';
  position: absolute;
  inset: -1px;
  border-radius: 11px;
  pointer-events: none;
  animation: checkinRing 680ms cubic-bezier(0.22, 1, 0.36, 1);
}

@keyframes checkinRing {
  0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--hc) 34%, transparent); }
  100% { box-shadow: 0 0 0 14px transparent; }
}

.checkin-head { display: flex; align-items: baseline; gap: 7px; margin-bottom: 8px; }
.checkin-head h2 { margin: 0; font-size: 13px; font-weight: 700; }
.checkin-head > span { color: var(--bm-text-muted); font-size: 10.5px; }

.checkin-status {
  margin-left: auto;
  height: 22px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 9px;
  border-radius: 11px;
  background: var(--bm-bg-hover);
  color: var(--bm-text-muted);
  font-size: 10.5px;
  transition: background 180ms ease, color 180ms ease, transform 180ms ease;
}
.checkin-status.done {
  background: color-mix(in srgb, var(--hc) 13%, transparent);
  color: var(--hc);
  animation: statusPop 260ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes statusPop {
  0% { transform: scale(0.9); opacity: 0.4; }
  100% { transform: scale(1); opacity: 1; }
}

.checkin-levels {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  margin-bottom: 8px;
}

.checkin-level {
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid var(--bm-border-default);
  border-radius: 9px;
  background: var(--bm-bg-card);
  color: var(--bm-text-muted);
  font: inherit;
  font-size: 10.5px;
  cursor: pointer;
  transition: border-color 140ms ease, background 140ms ease, color 140ms ease, transform 100ms ease;
}
.checkin-level i {
  display: block;
  width: 8px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--hc) 26%, transparent);
  transition: background 140ms ease, height 140ms ease;
}
.checkin-level:hover {
  border-color: color-mix(in srgb, var(--hc) 40%, var(--bm-border-default));
  color: var(--bm-text-primary);
  transform: translateY(-1px);
}
.checkin-level:active { transform: scale(0.97); }
.checkin-level.on {
  border-color: var(--hc);
  background: color-mix(in srgb, var(--hc) 8%, var(--bm-bg-card));
  color: var(--bm-text-primary);
  font-weight: 600;
}
.checkin-level.on i { background: var(--hc); }

.checkin-note {
  width: 100%;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--bm-border-default);
  border-radius: 8px;
  outline: none;
  background: var(--bm-bg-card);
  color: var(--bm-text-primary);
  font: inherit;
  font-size: 11.5px;
  margin-bottom: 8px;
  transition: border-color 140ms ease, box-shadow 140ms ease;
}
.checkin-note:focus {
  border-color: color-mix(in srgb, var(--hc) 50%, var(--bm-border-default));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--hc) 10%, transparent);
}
.checkin-note::placeholder { color: var(--bm-text-muted); }

.checkin-foot { display: flex; align-items: center; gap: 10px; }
.checkin-foot > span { color: var(--bm-text-muted); font-size: 10.5px; }

.checkin-primary {
  height: 30px;
  padding: 0 14px;
  border: 0;
  border-radius: 8px;
  background: var(--bm-accent-blue);
  color: #fff;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: transform 120ms ease, filter 120ms ease, background 160ms ease, color 160ms ease;
}
.checkin-primary:hover { filter: brightness(0.97); transform: translateY(-1px); }
.checkin-primary:active { transform: scale(0.98); }
.checkin-primary.secondary {
  border: 1px solid var(--bm-border-default);
  background: var(--bm-bg-card);
  color: var(--bm-text-secondary);
}
.checkin-primary.secondary:hover {
  border-color: var(--bm-border-strong);
  background: var(--bm-bg-hover);
  color: var(--bm-text-primary);
  filter: none;
}

.habit-trend {
  padding: 11px 13px;
  border: 1px solid var(--bm-border-subtle);
  border-radius: 10px;
}

.habit-section-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
.habit-section-head h3 { margin: 0; font-size: 13.5px; font-weight: 700; }
.habit-section-head span { color: var(--bm-text-muted); font-size: 10.5px; }

.heatmap-legend {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--bm-text-muted);
  font-size: 10px;
}
.heatmap-legend i {
  width: 9px;
  height: 9px;
  border-radius: 2px;
  display: block;
  background: var(--bm-bg-hover);
  transition: background 180ms ease;
}
.heatmap-legend i.l1 { background: color-mix(in srgb, var(--hc) 26%, transparent); }
.heatmap-legend i.l2 { background: color-mix(in srgb, var(--hc) 46%, transparent); }
.heatmap-legend i.l3 { background: color-mix(in srgb, var(--hc) 70%, transparent); }
.heatmap-legend i.l4 { background: var(--hc); }

.heatmap-wrap { display: flex; gap: 6px; align-items: flex-start; justify-content: center; overflow-x: auto; padding-bottom: 2px; }
.heatmap-weekdays {
  display: grid;
  grid-template-rows: repeat(7, 14px);
  gap: 2px;
  width: 12px;
  padding-top: 0;
  color: var(--bm-text-tertiary);
  font-size: 9px;
  line-height: 14px;
  text-align: center;
}
.heatmap {
  flex: 0 0 auto;
  display: grid;
  grid-template-rows: repeat(7, 14px);
  grid-auto-flow: column;
  grid-auto-columns: 14px;
  gap: 2px;
  overflow: visible;
}
.heatmap-cell {
  width: 14px;
  height: 14px;
  padding: 0;
  border: 0;
  border-radius: 2.5px;
  background: var(--bm-bg-hover);
  cursor: pointer;
  transition: background 180ms ease, transform 120ms ease, box-shadow 120ms ease;
}
.heatmap-cell:hover {
  transform: scale(1.28);
  box-shadow: 0 0 0 1px var(--bm-bg-card), 0 0 0 2px color-mix(in srgb, var(--hc) 40%, transparent);
}
.heatmap-cell.l1 { background: color-mix(in srgb, var(--hc) 26%, transparent); }
.heatmap-cell.l2 { background: color-mix(in srgb, var(--hc) 46%, transparent); }
.heatmap-cell.l3 { background: color-mix(in srgb, var(--hc) 70%, transparent); }
.heatmap-cell.l4 { background: var(--hc); }
.heatmap-cell.future { background: transparent; border: 1px dashed var(--bm-border-subtle); cursor: default; }
.heatmap-cell.future:hover { transform: none; box-shadow: none; }
.heatmap-cell.today { box-shadow: 0 0 0 1.5px var(--bm-bg-card), 0 0 0 2.5px color-mix(in srgb, var(--hc) 55%, transparent); }

.habit-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.habit-stat {
  padding: 9px 10px;
  border: 1px solid var(--bm-border-subtle);
  border-radius: 9px;
  background: var(--bm-bg-card);
}
.habit-stat b {
  display: block;
  font-size: 21px;
  font-weight: 300;
  line-height: 1.1;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
}
.habit-stat span { display: block; margin-top: 1px; color: var(--bm-text-muted); font-size: 10px; }
.habit-stat small { display: block; margin-top: 2px; color: var(--bm-text-tertiary); font-size: 9.5px; }

.stat-pop-enter-active,
.stat-pop-leave-active { transition: opacity 160ms ease, transform 160ms ease; }
.stat-pop-enter-from { opacity: 0; transform: translateY(5px) scale(0.96); }
.stat-pop-leave-to { opacity: 0; transform: translateY(-4px) scale(0.98); }

.habit-swap-enter-active { transition: opacity 180ms ease, transform 180ms ease; }
.habit-swap-leave-active { transition: opacity 110ms ease; }
.habit-swap-enter-from { opacity: 0; transform: translateY(6px); }
.habit-swap-leave-to { opacity: 0; }

.habit-detail.empty-detail { display: grid; place-items: center; }
.habit-empty { text-align: center; color: var(--bm-text-muted); }
.habit-empty > i { font-size: 28px; color: var(--bm-text-tertiary); margin-bottom: 10px; }
.habit-empty p { margin: 0 0 14px; font-size: 13px; }

.habit-modal { width: min(480px, calc(100vw - 40px)); }
.habit-footer-spacer { flex: 1; }

.icon-selector { display: flex; flex-wrap: wrap; gap: 6px; }
.icon-option {
  width: 34px;
  height: 34px;
  border: 1px solid var(--bm-border-default);
  border-radius: 8px;
  background: var(--bm-bg-card);
  color: var(--bm-text-secondary);
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease, transform 120ms ease;
}
.icon-option:hover { background: var(--bm-bg-hover); transform: translateY(-1px); }
.icon-option.selected {
  border-color: var(--bm-accent-blue);
  background: color-mix(in srgb, var(--bm-accent-blue) 10%, var(--bm-bg-card));
  color: var(--bm-accent-blue);
}

.color-selector { display: flex; flex-wrap: wrap; gap: 8px; }
.color-option {
  width: 24px;
  height: 24px;
  border: 2px solid transparent;
  border-radius: 50%;
  cursor: pointer;
  transition: transform 120ms ease, box-shadow 120ms ease;
}
.color-option:hover { transform: scale(1.1); }
.color-option.selected { box-shadow: 0 0 0 2px var(--bm-bg-card), 0 0 0 3.5px var(--bm-text-primary); }

.modal-levels { display: flex; gap: 8px; flex-wrap: wrap; }
.level-option {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border: 1px solid var(--bm-border-default);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 120ms ease, background 120ms ease;
}
.level-option.selected { border-color: var(--bm-accent-blue); background: color-mix(in srgb, var(--bm-accent-blue) 8%, var(--bm-bg-card)); }
.level-box { width: 10px; height: 10px; border-radius: 3px; }
.level-label { color: var(--bm-text-secondary); font-size: 11.5px; }

@media (max-width: 1000px) {
  .habit-main-grid { grid-template-columns: 1fr; }
}

@media (prefers-reduced-motion: reduce) {
  .habit-swap-enter-active,
  .habit-swap-leave-active,
  .stat-pop-enter-active,
  .stat-pop-leave-active,
  .habit-checkin.pulse::after,
  .checkin-status.done { transition: none; animation: none; }
}
</style>
