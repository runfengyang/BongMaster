// Balatro 收藏模式金币经济：主进程 / MCP 进程侧奖励发放器
// 背景（§19 金币 bug 根因）：MCP 工具路径（create_habit_checkin / checkin_today /
//   update_daily_task_status / update_daily_task / update_task）由 mcp-server 进程直接
//   写库，绕过渲染进程 habit-store / task-store 的 integration.js 挂接点，金币从未发放。
//   本模块在 MCP 处理器成功后做 balatro_state 'main' 的读-改-写，与渲染端
//   store.grantProductivityReward 语义对齐（金币 + 计数 + 每 10 次小丑包 + 连打 7 天天体包）。
// 数值常量与 src/balatro/data/economy.js GOLD_REWARDS / store.js 发放节奏保持同步（改动需双侧同步）。
// 依赖仅 dbService 的 getBalatroState/saveBalatroState 两个方法（better-sqlite3 与
//   node:sqlite DatabaseSync 均兼容），所有异常由调用方兜底，绝不打断业务主流程。

const GOLD_REWARDS = {
  checkin: 2,       // 习惯打卡
  task: 3,          // 每日任务完成
  project_task: 5,  // 项目任务完成
}
const PACK_EVERY = 10              // 每 10 次生产力事件送 1 个小丑包
const STREAK_DAYS = 7              // 连续打卡 7 天送天体包（一次性）
const BUFFOON_PACK = 'pack_buffoon_normal'
const CELESTIAL_PACK = 'pack_celestial_normal'

function emptyState() {
  return {
    version: 1,
    savedAt: null,
    run: null,
    collection: { discovered: [], ownedCards: [], newIds: [] },
    settings: { volume: 0.5, muted: false, animations: true },
    productivity: { count: 0, pendingMoney: 0, pendingPacks: [], streak: 0 },
    economy: { gold: 0, packsOpened: 0 },
  }
}

// 从 dbService 读当前 balatro_state 'main'（损坏/缺字段时按骨架兜底，字段只增不减）
function readState(dbService) {
  const raw = dbService.getBalatroState('main')
  if (!raw) return emptyState()
  try {
    const s = JSON.parse(raw)
    const base = emptyState()
    return {
      ...base, ...s,
      collection: { ...base.collection, ...(s.collection || {}) },
      settings: { ...base.settings, ...(s.settings || {}) },
      productivity: { ...base.productivity, ...(s.productivity || {}) },
      economy: { ...base.economy, ...(s.economy || {}) },
    }
  } catch {
    return emptyState()
  }
}

// 计算某习惯截至 checkinDate 的连续打卡天数（含当日；与渲染端 habit-store 逻辑一致）
function computeStreak(dbService, habitId, checkinDate) {
  try {
    const rows = dbService.getHabitCheckins(habitId)
    const dates = new Set((rows || []).map(r => r.checkin_date))
    const day = new Date(checkinDate + 'T00:00:00')
    const key = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    let streak = 0
    while (dates.has(key(day))) { streak += 1; day.setDate(day.getDate() - 1) }
    return streak
  } catch {
    return 0
  }
}

// 发放一次生产力奖励（MCP/主进程侧）。返回 { gold, count, packs } 或 null（未知来源）。
// dbService 只需实现 getBalatroState(key)/saveBalatroState(value, key)。
function grantBalatroReward(dbService, source, opts = {}) {
  const gold = GOLD_REWARDS[source] || 0
  if (gold <= 0) return null
  const state = readState(dbService)
  state.economy.gold = Math.max(0, Math.floor(Number(state.economy.gold) || 0)) + gold
  state.productivity.count = (Math.floor(Number(state.productivity.count) || 0)) + 1
  if (!Array.isArray(state.productivity.pendingPacks)) state.productivity.pendingPacks = []
  const packs = []
  if (state.productivity.count % PACK_EVERY === 0) {
    state.productivity.pendingPacks.push(BUFFOON_PACK)
    packs.push(BUFFOON_PACK)
  }
  const streak = source === 'checkin'
    ? (opts.streak ?? (opts.habitId && opts.date ? computeStreak(dbService, opts.habitId, opts.date) : 0))
    : 0
  if (source === 'checkin' && streak >= STREAK_DAYS && !state.productivity.streakRewardClaimed) {
    state.productivity.pendingPacks.push(CELESTIAL_PACK)
    state.productivity.streakRewardClaimed = true
    packs.push(CELESTIAL_PACK)
  }
  state.savedAt = new Date().toISOString()
  dbService.saveBalatroState(JSON.stringify(state), 'main')
  return { gold, count: state.productivity.count, packs }
}

module.exports = { grantBalatroReward, computeStreak, GOLD_REWARDS, PACK_EVERY, STREAK_DAYS }
