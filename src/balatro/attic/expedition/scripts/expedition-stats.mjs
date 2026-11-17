#!/usr/bin/env node
// 远征模式数值标定脚本（契约 §5.4 / Phase E1）
// 分析近 90 天真实数据，输出「普通一天」的行动牌画像：
//   日均完成任务数 / 构成比 / 项目分布（同日同项目集中度）/ rank·suit 分布 /
//   日牌型出现率（同花日/对子日/散牌日）/ 裸装日伤害估算
// 最后输出建议的 balance.js 数值（Boss HP、最低伤害线等）。
//
// 用法：node scripts/expedition-stats.mjs [--db /path/to/database.db] [--days 90] [--json]
// 只读打开数据库，绝不写入；DB 不存在/为空时优雅降级，用内置假设值输出。

import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

import { buildActionCards, dayStartMs } from '../engine/expedition/actionCards.js'
import { evaluate } from '../../../engine/evaluate.js'
import { handScore } from '../../../data/hands.js'
import { cardChips } from '../../../engine/deck.js'
import {
  NODE_HP, NODE_MIN_DAMAGE, FALLBACK_DAY_ASSUMPTION,
} from '../engine/expedition/balance.js'
import { EXPEDITION_BOSSES } from '../data/expedition/bosses.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// ================= 参数 =================
const args = process.argv.slice(2)
const argOf = (name, dflt) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : dflt
}
const DAYS = parseInt(argOf('days', '90'), 10)
const AS_JSON = args.includes('--json')

// ================= DB 定位（只读） =================
// 候选：package.json 的 name / productName / build.productName（Electron 打包名）
// 多个候选同时存在时，只读打开挑选数据最新（max(completed_date)）的一个
function resolveDbPath() {
  const explicit = argOf('db', null)
  if (explicit) return explicit
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const appDir = join(homedir(), 'Library', 'Application Support')
  const names = [pkg.name, pkg.productName, pkg.build?.productName].filter(Boolean)
  const candidates = [...new Set(names)].map(n => join(appDir, n, 'database.db')).filter(existsSync)
  if (!candidates.length) return join(appDir, names[0] || 'unknown', 'database.db')
  if (candidates.length === 1) return candidates[0]
  let best = candidates[0], bestDate = ''
  for (const p of candidates) {
    try {
      const db = new DatabaseSync(p, { readOnly: true })
      const row = db.prepare('SELECT MAX(completed_date) d FROM task_completions').get()
      db.close()
      if ((row?.d || '') > bestDate) { bestDate = row.d; best = p }
    } catch { /* 结构不符时跳过该候选 */ }
  }
  return best
}

// ================= 数据采集（近 N 天 → 每日行动事件） =================
function tableExists(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)
}
function columnExists(db, table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col)
}
const dateStr = d => d.toISOString().slice(0, 10)

function collectEvents(db, sinceDate) {
  const byDay = new Map() // date → events[]
  const push = (date, ev) => {
    if (!date) return
    if (!byDay.has(date)) byDay.set(date, [])
    byDay.get(date).push(ev)
  }
  const has = t => tableExists(db, t)

  // ---- 项目任务完成（task_completions ⋈ tasks） ----
  if (has('task_completions') && has('tasks')) {
    const rows = db.prepare(`
      SELECT c.task_id, c.project_id, c.completed_date,
             t.priority, t.created_at
      FROM task_completions c JOIN tasks t ON t.id = c.task_id
      WHERE c.completed_date >= ?`).all(sinceDate)
    for (const r of rows) {
      push(r.completed_date, {
        type: 'project_task', taskId: r.task_id, projectId: r.project_id,
        priority: r.priority, createdAt: r.created_at,
        completedAt: `${r.completed_date}T12:00:00`,
      })
    }
  }

  // ---- 每日任务完成（daily_tasks） ----
  if (has('daily_tasks')) {
    const hasPriority = columnExists(db, 'daily_tasks', 'priority')
    const hasCompletedAt = columnExists(db, 'daily_tasks', 'completed_at')
    const rows = db.prepare(
      `SELECT * FROM daily_tasks WHERE is_completed = 1 AND date >= ?`).all(sinceDate)
    // 清空判定：同日全部 daily_tasks 是否完成
    const allByDate = new Map()
    for (const r of db.prepare('SELECT date, is_completed FROM daily_tasks WHERE date >= ?').all(sinceDate)) {
      const s = allByDate.get(r.date) || { total: 0, done: 0 }
      s.total += 1; s.done += r.is_completed ? 1 : 0
      allByDate.set(r.date, s)
    }
    for (const r of rows) {
      push(r.date, {
        type: 'daily_task', taskId: r.id, projectId: null,
        priority: hasPriority ? r.priority : '中',
        createdAt: r.created_at,
        completedAt: (hasCompletedAt && r.completed_at) || `${r.date}T18:00:00`,
      })
    }
    for (const [date, s] of allByDate) {
      if (s.total >= 2 && s.done === s.total) {
        push(date, { type: 'day_cleared', taskId: `clear_${date}`, completedAt: `${date}T23:00:00` })
      }
    }
  }

  // ---- 习惯打卡（habit_checkins，含 streak 计算；旧库可能无此表） ----
  if (has('habit_checkins')) {
    const all = db.prepare('SELECT habit_id, checkin_date FROM habit_checkins ORDER BY checkin_date').all()
    const byHabit = new Map()
    for (const r of all) {
      if (!byHabit.has(r.habit_id)) byHabit.set(r.habit_id, new Set())
      byHabit.get(r.habit_id).add(r.checkin_date)
    }
    const streakOf = (habitId, date) => {
      const days = byHabit.get(habitId)
      let streak = 0
      const d = new Date(`${date}T00:00:00`)
      while (days.has(dateStr(d))) { streak += 1; d.setDate(d.getDate() - 1) }
      return streak
    }
    for (const r of all) {
      if (r.checkin_date < sinceDate) continue
      push(r.checkin_date, {
        type: 'habit_checkin', taskId: r.habit_id, streak: streakOf(r.habit_id, r.checkin_date),
        completedAt: `${r.checkin_date}T08:00:00`,
      })
    }
  }
  return byDay
}

// ================= 降级：内置假设日 =================
function fallbackDays() {
  const A = FALLBACK_DAY_ASSUMPTION
  const mkDay = date => {
    const evs = []
    for (let i = 0; i < A.projectTasksSameProject; i++) {
      evs.push({ type: 'project_task', taskId: `pa_${i}`, projectId: 'assumed_project_a', priority: '中', createdAt: '2000-01-01', completedAt: `${date}T1${i}:00:00` })
    }
    for (let i = 0; i < A.projectTasksOtherProject; i++) {
      evs.push({ type: 'project_task', taskId: `pb_${i}`, projectId: 'assumed_project_b', priority: '中', createdAt: '2000-01-01', completedAt: `${date}T15:00:00` })
    }
    for (let i = 0; i < A.dailyTasks; i++) {
      evs.push({ type: 'daily_task', taskId: `d_${i}`, priority: '中', createdAt: '2000-01-01', completedAt: `${date}T16:0${i}:00` })
    }
    for (let i = 0; i < A.habitCheckins; i++) {
      evs.push({ type: 'habit_checkin', taskId: `h_${i}`, streak: 3, completedAt: `${date}T08:00:00` })
    }
    return evs
  }
  const m = new Map()
  for (let i = 0; i < 20; i++) m.set(`assumed_day_${i}`, mkDay('2026-07-01'))
  return m
}

// ================= 画像计算 =================
const median = arr => {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const round5 = n => Math.max(5, Math.round(n / 5) * 5)
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—')

// 裸装日伤害（无小丑/Boss 修正）：牌型基础 + 计分牌点数，Lv.1
function nakedDamage(scoringCards) {
  if (!scoringCards.length) return { handType: 'none', damage: 0 }
  const hand = evaluate(scoringCards, {})
  const { chips, mult } = handScore(hand.handType, 1)
  const cardSum = scoringCards.filter(c => hand.scoringIds.includes(c.id))
    .reduce((s, c) => s + cardChips(c), 0)
  return { handType: hand.handType, damage: Math.round((chips + cardSum) * mult) }
}

function profile(byDay) {
  const days = []
  for (const [date, events] of [...byDay.entries()].sort()) {
    const { cards, scoringCards } = buildActionCards(events, { date: date.startsWith('assumed') ? '2026-07-01' : date })
    if (!cards.length) continue
    const suits = new Set(scoringCards.map(c => c.suit))
    const projects = new Set(scoringCards.filter(c => c.projectId != null).map(c => c.projectId))
    const bySuit = {}
    for (const c of scoringCards) bySuit[c.suit] = (bySuit[c.suit] || 0) + 1
    const maxSuitShare = scoringCards.length ? Math.max(...Object.values(bySuit)) / scoringCards.length : 0
    const comp = { project_task: 0, daily_task: 0, habit_checkin: 0, day_cleared: 0, project_milestone: 0 }
    for (const c of cards) comp[c.source] = (comp[c.source] || 0) + 1
    const { handType, damage } = nakedDamage(scoringCards)
    days.push({ date, events: cards.length, scoring: scoringCards.length, suits: suits.size, projects: projects.size, maxSuitShare, comp, cards: scoringCards, handType, damage })
  }
  return days
}

// ================= 输出 =================
function report(days, { degraded, dbPath, sinceDate }) {
  const activeDays = days.length
  const avgScoring = days.reduce((s, d) => s + d.scoring, 0) / (activeDays || 1)
  const compSum = { project_task: 0, daily_task: 0, habit_checkin: 0, day_cleared: 0, project_milestone: 0 }
  let compTotal = 0
  for (const d of days) for (const k of Object.keys(compSum)) { compSum[k] += d.comp[k] || 0; compTotal += d.comp[k] || 0 }
  const rankDist = {}, suitDist = {}, handDist = {}
  for (const d of days) {
    for (const c of d.cards) {
      rankDist[c.rank] = (rankDist[c.rank] || 0) + 1
      suitDist[c.suit] = (suitDist[c.suit] || 0) + 1
    }
    handDist[d.handType] = (handDist[d.handType] || 0) + 1
  }
  const avgProjects = days.reduce((s, d) => s + d.projects, 0) / (activeDays || 1)
  const avgConcentration = days.reduce((s, d) => s + d.maxSuitShare, 0) / (activeDays || 1)

  const focused = days.filter(d => d.suits === 1 && d.scoring >= 2)
  const scattered = days.filter(d => d.suits >= 3)
  const flushDays = days.filter(d => ['flush', 'straight_flush', 'flush_house', 'flush_five'].includes(d.handType))
  const pairDays = days.filter(d => ['pair', 'two_pair'].includes(d.handType))
  const highDays = days.filter(d => d.handType === 'high_card')

  const D_focus = median(focused.map(d => d.damage)) || median(days.map(d => d.damage))
  const D_scatter = median(scattered.map(d => d.damage)) || median(highDays.map(d => d.damage)) || D_focus * 0.45

  // ---- 标定（契约 §5.4：专注日 ≈ Boss HP 20%，散乱日 ≈ 12%） ----
  // BUILD_FACTOR：1-2 张小丑的轻构筑对裸装伤害的中位乘区（经验假设 3×）。
  // 整条轨道 HP ≈ 5 × D_focus × BUILD_FACTOR（5 个构筑专注日刚好打通）
  const BUILD_FACTOR = 3
  const D_all = median(days.map(d => d.damage))
  const track = round5(5 * D_focus * BUILD_FACTOR)
  const diffMult = [1, 1.3, 1.6]
  const sug = {
    bossHp: diffMult.map(m => round5(track * 0.58 * m)),
    nodeHp: {
      normal: diffMult.map(m => round5(track * 0.10 * m)),
      elite: diffMult.map(m => round5(track * 0.16 * m)),
      shop: diffMult.map(m => round5(track * 0.06 * m)),
    },
    // 压力线：高于裸奔中位日（散乱裸奔会失败），低于构筑日（合理构筑从容通过）
    bossMinDamage: round5(Math.min(Math.max(D_all * 2.2, 10), D_focus * BUILD_FACTOR)),
    buildFactor: BUILD_FACTOR,
  }
  sug.nodeMinDamage = {
    normal: round5(sug.bossMinDamage * 0.65),
    elite: round5(sug.bossMinDamage * 0.9),
    shop: 0,
  }

  const out = {
    meta: { degraded, dbPath, sinceDate, windowDays: DAYS, activeDays },
    portrait: {
      avgScoringCardsPerDay: +avgScoring.toFixed(2),
      composition: Object.fromEntries(Object.entries(compSum).map(([k, v]) => [k, { count: v, share: +(compTotal ? v / compTotal : 0).toFixed(3) }])),
      avgDistinctProjectsPerDay: +avgProjects.toFixed(2),
      avgSameProjectConcentration: +avgConcentration.toFixed(3),
      rankDist, suitDist, handDist,
      dayTypeRates: {
        flushDay: +(flushDays.length / (activeDays || 1)).toFixed(3),
        pairDay: +(pairDays.length / (activeDays || 1)).toFixed(3),
        highCardDay: +(highDays.length / (activeDays || 1)).toFixed(3),
        focusedDay: +(focused.length / (activeDays || 1)).toFixed(3),
        scatteredDay: +(scattered.length / (activeDays || 1)).toFixed(3),
      },
      damage: {
        focusedDayMedian: D_focus, scatteredDayMedian: D_scatter,
        allDayMedian: median(days.map(d => d.damage)),
      },
    },
    suggestedBalance: sug,
    currentBalance: {
      bossHp: EXPEDITION_BOSSES[0].hp, bossMinDamage: EXPEDITION_BOSSES[0].minDamagePerDay,
      nodeHp: NODE_HP, nodeMinDamage: NODE_MIN_DAMAGE,
    },
  }

  if (AS_JSON) { console.log(JSON.stringify(out, null, 2)); return out }

  const SUIT_GLYPH = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' }
  console.log('============================================================')
  console.log(' 远征模式数值标定 · 行动牌画像（契约 §5.4）')
  console.log('============================================================')
  if (degraded) {
    console.log(`⚠ 数据库不可用或近 ${DAYS} 天无数据 —— 使用内置假设值降级输出`)
    console.log(`  （尝试路径：${dbPath}）`)
  } else {
    console.log(`数据库：${dbPath}（只读）`)
    console.log(`窗口：${sinceDate} 起 ${DAYS} 天；活跃日 ${activeDays} 天`)
  }
  console.log('\n-- 「普通一天」画像 --')
  console.log(`日均计分行动牌：${out.portrait.avgScoringCardsPerDay} 张`)
  console.log('构成比：' + Object.entries(out.portrait.composition)
    .filter(([, v]) => v.count > 0)
    .map(([k, v]) => `${k} ${(v.share * 100).toFixed(1)}%`).join(' / ') || '（无）')
  console.log(`日均涉及项目：${out.portrait.avgDistinctProjectsPerDay} 个；同日同项目集中度：${(out.portrait.avgSameProjectConcentration * 100).toFixed(1)}%`)
  console.log('rank 分布：' + Object.entries(rankDist).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r === '14' ? 'A' : r === '12' ? 'Q' : r}×${n}`).join(' '))
  console.log('suit 分布：' + Object.entries(suitDist).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${SUIT_GLYPH[s]}×${n}`).join(' '))
  console.log('\n-- 日牌型出现率 --')
  for (const [h, n] of Object.entries(handDist).sort((a, b) => b[1] - a[1])) console.log(`  ${h}: ${n} 天（${pct(n, activeDays)}）`)
  console.log(`同花日 ${pct(flushDays.length, activeDays)}｜对子日 ${pct(pairDays.length, activeDays)}｜散牌日 ${pct(highDays.length, activeDays)}`)
  console.log(`专注日（单一花色）${pct(focused.length, activeDays)}｜散乱日（≥3 花色）${pct(scattered.length, activeDays)}`)
  console.log('\n-- 裸装日伤害估算 --')
  console.log(`专注日中位伤害：${D_focus}｜散乱日中位伤害：${D_scatter}｜全体中位：${out.portrait.damage.allDayMedian}`)
  console.log('\n-- 数值标定 --')
  console.log('（§16 老虎机模型后，本脚本画像仅作 MC 输入；标定结论以 scripts/expedition-monte-carlo.mjs 为准）')
  console.log(`当前 balance.js：节点最低线 normal ${NODE_MIN_DAMAGE.normal} / elite ${NODE_MIN_DAMAGE.elite} / shop ${NODE_MIN_DAMAGE.shop}`)
  console.log(`当前节点 HP：normal [${NODE_HP.normal.join(', ')}] / elite [${NODE_HP.elite.join(', ')}] / shop [${NODE_HP.shop.join(', ')}]`)
  return out
}

// ================= main =================
function main() {
  const dbPath = resolveDbPath()
  const since = new Date()
  since.setDate(since.getDate() - DAYS)
  const sinceDate = dateStr(since)

  let byDay = null
  let degraded = false
  if (!existsSync(dbPath)) {
    degraded = true
  } else {
    try {
      const db = new DatabaseSync(dbPath, { readOnly: true })
      byDay = collectEvents(db, sinceDate)
      db.close()
      const total = [...byDay.values()].reduce((s, e) => s + e.length, 0)
      if (total === 0) degraded = true
    } catch (err) {
      console.error(`⚠ 数据库读取失败（${err.message}），降级为内置假设值`)
      degraded = true
    }
  }
  if (degraded) byDay = fallbackDays()

  const days = profile(byDay)
  report(days, { degraded, dbPath, sinceDate })
}

main()
