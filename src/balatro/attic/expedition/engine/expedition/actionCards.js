// 行动事件 → 行动牌（契约 §5.1）
// 每个有效行动事件生成一张行动牌 { rank, suit, source, taskId }：
//   习惯打卡 4（streak≥7 → 6）｜每日任务 5（高优先级 7）｜项目任务 8（高优先级 10）
//   清空当日全部每日任务 Q｜项目完成/里程碑 A
// 花色 = 项目归属：project_id 哈希 → ♠♥♣♦；无项目行动固定 ♦
// 防刷三规则（红线，在本层强制执行）：
//   1. 当日新建当日完成 → rank 减半（向下取整，最低 2）
//   2. 完成→撤销→再完成 → 只计首次
//   3. 每日最多 5 张计分（第 6 张起只记录不计分）

import { makeCard } from '../../../../engine/deck.js'
import { hashSeed } from '../../../../engine/rng.js'
import {
  RANK_RULES, HIGH_PRIORITY_LABELS, ANTI_ABUSE,
  SUITS, DEFAULT_SUIT, MAX_SCORING_CARDS_PER_DAY,
} from './balance.js'

// 行动事件输入形状（integration 挂接点 payload，契约 §7）：
// { type: 'habit_checkin'|'daily_task'|'project_task'|'day_cleared'|'project_milestone',
//   taskId, projectId, priority, streak, createdAt, completedAt }
// createdAt / completedAt 接受 ms 时间戳或 Date 或可解析字符串

function toMs(v) {
  if (v == null) return null
  if (typeof v === 'number') return v
  if (v instanceof Date) return v.getTime()
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? null : t
}

// 某日 00:00 的本地时间戳；date 为 'YYYY-MM-DD' 或 Date 或 ms
export function dayStartMs(date) {
  if (typeof date === 'string') return new Date(`${date.slice(0, 10)}T00:00:00`).getTime()
  const d = new Date(toMs(date))
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// 项目归属 → 花色（确定性哈希）；无项目 → 固定 ♦
export function projectSuit(projectId) {
  if (projectId == null || projectId === '') return DEFAULT_SUIT
  return SUITS[hashSeed(String(projectId)) % SUITS.length]
}

function isHighPriority(priority) {
  return HIGH_PRIORITY_LABELS.includes(priority)
}

// 单事件 → rank（含防刷规则 1：当日新建当日完成减半）
export function rankForEvent(ev, dayStart) {
  let rank = null
  switch (ev.type) {
    case 'habit_checkin':
      rank = (ev.streak ?? 0) >= RANK_RULES.habitCheckin.streakMin
        ? RANK_RULES.habitCheckin.streakRank : RANK_RULES.habitCheckin.base
      break
    case 'daily_task':
      rank = isHighPriority(ev.priority) ? RANK_RULES.dailyTask.highPriority : RANK_RULES.dailyTask.base
      break
    case 'project_task':
      rank = isHighPriority(ev.priority) ? RANK_RULES.projectTask.highPriority : RANK_RULES.projectTask.base
      break
    case 'day_cleared':
      rank = RANK_RULES.dayCleared
      break
    case 'project_milestone':
      rank = RANK_RULES.projectMilestone
      break
    default:
      return null
  }
  // 防刷 1：当日 00:00 后新建且当日完成的任务 → rank 减半（向下取整，最低 2）
  // 仅任务类事件适用；打卡/清空/里程碑是派生成就，不适用
  if ((ev.type === 'daily_task' || ev.type === 'project_task') && ev.createdAt != null) {
    const created = toMs(ev.createdAt)
    if (created != null && created >= dayStart) {
      rank = Math.max(ANTI_ABUSE.sameDayCreateFloor, Math.floor(rank / ANTI_ABUSE.sameDayCreateDivisor))
    }
  }
  return rank
}

// 单事件 → 行动牌（复用 makeCard 牌形，附远征语义字段）
export function actionCardFor(ev, dayStart) {
  const rank = rankForEvent(ev, dayStart)
  if (rank == null) return null
  const suit = ev.type === 'project_task' ? projectSuit(ev.projectId) : DEFAULT_SUIT
  const card = makeCard(rank, suit)
  card.source = ev.type
  card.taskId = ev.taskId ?? null
  card.projectId = ev.projectId ?? null
  card.completedAt = toMs(ev.completedAt) ?? 0
  return card
}

// 一日事件流 → 行动牌组（含防刷规则 2、3）
// maxScoring：每日计分上限（默认 5；阵容被动可修正，如耍把戏 +1 / 特技演员 -2）
// 返回 { cards, scoringCards }；cards 按完成时间升序，scores=false 的只记录不计分
export function buildActionCards(events, { date, maxScoring = MAX_SCORING_CARDS_PER_DAY } = {}) {
  const dayStart = dayStartMs(date ?? new Date())
  // 防刷 2：完成→撤销→再完成只计首次 → 同一 (type, taskId) 保留最早 completedAt
  const firstByKey = new Map()
  for (const ev of events || []) {
    if (!ev || !ev.type) continue
    const key = `${ev.type}:${ev.taskId ?? ev.projectId ?? 'x'}`
    const at = toMs(ev.completedAt) ?? Number.MAX_SAFE_INTEGER
    const prev = firstByKey.get(key)
    if (!prev || at < (toMs(prev.completedAt) ?? Number.MAX_SAFE_INTEGER)) firstByKey.set(key, ev)
  }
  const ordered = [...firstByKey.values()]
    .map(ev => actionCardFor(ev, dayStart))
    .filter(Boolean)
    .sort((a, b) => a.completedAt - b.completedAt)
  // 防刷 3：每日最多 N 张计分
  ordered.forEach((c, i) => { c.scores = i < maxScoring })
  return { cards: ordered, scoringCards: ordered.filter(c => c.scores) }
}
