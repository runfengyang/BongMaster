// E3 CDP 补测前置：造一个「packQueue 已有包」的远征存档并写入真机 sqlite
// 用法: node scripts/expedition-seed-pack-save.mjs
// 说明: 使用 node:sqlite（node 24 内置）；electron 停止状态下执行
import { DatabaseSync } from 'node:sqlite'
import os from 'node:os'
import path from 'node:path'
import { Expedition } from '../engine/expedition/stateMachine.js'

const DB = path.join(os.homedir(), 'Library/Application Support/bongmaster-vue/database.db')

// 造局：settles 直到 packQueue 有包（通关普通节点必给包）
const exp = new Expedition({ themeId: 'thesis', bossId: 'boss_distraction', difficulty: 1, seed: 'e3-pack-seed', wins: 0 })
exp.applyDraft({ jokerIndex: 0, cardIndices: [0, 1] })
const now = Date.now()
let guard = 0
while (!exp.packQueue.length && guard++ < 5 && exp.status === 'active') {
  exp.settleDay({
    date: `2026-01-0${guard}`,
    events: [
      { type: 'project_milestone', taskId: 'm' + guard, projectId: 'proj-a', completedAt: now },
      { type: 'day_cleared', taskId: 'dc' + guard, completedAt: now },
      { type: 'project_task', taskId: 'p' + guard, projectId: 'proj-a', priority: 'high', completedAt: now },
      { type: 'daily_task', taskId: 'd' + guard, priority: 'high', completedAt: now },
      { type: 'habit_checkin', taskId: 'h' + guard, streak: 12, completedAt: now },
    ],
  })
}
if (!exp.packQueue.length) { console.error('造档失败：5 日内无包入队'); process.exit(1) }
console.log(`造档 OK：dayIndex=${exp.dayIndex} nodeIndex=${exp.nodeIndex} packQueue=${exp.packQueue.length} (${exp.packQueue[0].kind}) status=${exp.status}`)

const db = new DatabaseSync(DB)
const put = db.prepare('INSERT INTO balatro_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
put.run('expedition:run', JSON.stringify(exp.serialize()))
put.run('expedition:report', 'null')
put.run('expedition:meta', JSON.stringify({ wins: 0, runs: 1, bestDay: exp.dayIndex }))
db.close()
console.log('已写入 balatro_state: expedition:run / report / meta')
