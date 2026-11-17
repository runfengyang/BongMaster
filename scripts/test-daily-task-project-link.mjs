// 每日任务关联活跃项目（临时数据库，不碰真实库）。
// better-sqlite3 按 Electron ABI 编译，所以用:
//   ELECTRON_RUN_AS_NODE=1 npx electron scripts/test-daily-task-project-link.mjs
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import os from 'os'
import path from 'path'
import fs from 'fs'

const require = createRequire(import.meta.url)
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { DatabaseService } = require(path.join(projectRoot, 'electron/services/database-service.js'))
const Database = require(path.join(projectRoot, 'node_modules/better-sqlite3'))

let failures = 0

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`FAIL: ${message}`)
    console.error(`  expected: ${JSON.stringify(expected)}`)
    console.error(`  actual:   ${JSON.stringify(actual)}`)
    failures += 1
  } else {
    console.log(`PASS: ${message}`)
  }
}

function assertThrows(fn, message) {
  try {
    fn()
    console.error(`FAIL: ${message} (没有抛错)`)
    failures += 1
  } catch {
    console.log(`PASS: ${message}`)
  }
}

const today = () => new Date().toISOString().slice(0, 10)
const isoAt = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString()

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-daily-project-'))
const newService = (name) => {
  const dir = path.join(tmpRoot, name)
  fs.mkdirSync(dir, { recursive: true })
  const db = new DatabaseService(path.join(dir, 'database.db'), path.join(dir, 'uploads'))
  db.initialize()
  return db
}

// 1. 迁移：旧库（没有 project_id 列）打开后自动补列
{
  const legacyDir = path.join(tmpRoot, 'legacy')
  fs.mkdirSync(legacyDir, { recursive: true })
  const legacyPath = path.join(legacyDir, 'database.db')
  const raw = new Database(legacyPath)
  raw.exec(`CREATE TABLE daily_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    date DATE NOT NULL,
    is_completed BOOLEAN DEFAULT 0,
    priority TEXT DEFAULT '中',
    estimated_minutes INTEGER DEFAULT 0,
    time_spent_seconds INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    is_pinned BOOLEAN DEFAULT 0,
    tags TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    completed_at DATETIME,
    repeat_rule_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`)
  raw.exec(`CREATE TABLE daily_task_repeat_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, priority TEXT DEFAULT '中',
    estimated_minutes INTEGER DEFAULT 0, tags TEXT DEFAULT '', notes TEXT DEFAULT '',
    repeat_type TEXT NOT NULL, repeat_value TEXT DEFAULT '', start_date DATE NOT NULL,
    end_date DATE, is_active BOOLEAN DEFAULT 1, wait_for_completion BOOLEAN DEFAULT 0,
    skip_overdue BOOLEAN DEFAULT 1, repeat_from_completion BOOLEAN DEFAULT 0,
    last_generated_date DATE, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`)
  raw.prepare("INSERT INTO daily_tasks (title, date) VALUES ('旧任务', ?)").run(today())
  raw.prepare("INSERT INTO daily_task_repeat_rules (title, repeat_type, start_date) VALUES ('旧规则', 'daily', ?)").run(today())
  raw.close()

  const db = new DatabaseService(legacyPath, path.join(legacyDir, 'uploads'))
  db.initialize()
  const dtCols = db.db.prepare('PRAGMA table_info(daily_tasks)').all().map(c => c.name)
  const rrCols = db.db.prepare('PRAGMA table_info(daily_task_repeat_rules)').all().map(c => c.name)
  assertEqual(dtCols.includes('project_id'), true, '迁移：daily_tasks 补上 project_id 列')
  assertEqual(rrCols.includes('project_id'), true, '迁移：daily_task_repeat_rules 补上 project_id 列')
  assertEqual(db.getDailyTasksByDate(today())[0].project_id, null, '迁移：旧每日任务 project_id 为 null')
}

const db = newService('main')
const active = db.createProject({ name: '活跃项目', status: '进行中' })
const notStarted = db.createProject({ name: '未开始项目', status: '未开始' })
const paused = db.createProject({ name: '已暂停项目', status: '已暂停' })
const done = db.createProject({ name: '已完成项目', status: '已完成' })

// 2. 创建：仅允许活跃项目（未开始/进行中）
{
  const t = db.createDailyTask({ title: '关联活跃', date: today(), project_id: active.id })
  assertEqual(t.project_id, active.id, '创建：可关联进行中项目')
  assertEqual(t.project_name, '活跃项目', '创建：返回项目名')

  const t2 = db.createDailyTask({ title: '关联未开始', date: today(), project_id: notStarted.id })
  assertEqual(t2.project_id, notStarted.id, '创建：可关联未开始项目')

  const plain = db.createDailyTask({ title: '无项目', date: today() })
  assertEqual(plain.project_id, null, '创建：不传 project_id 时为 null')

  assertThrows(() => db.createDailyTask({ title: 'x', date: today(), project_id: paused.id }), '创建：拒绝已暂停项目')
  assertThrows(() => db.createDailyTask({ title: 'x', date: today(), project_id: done.id }), '创建：拒绝已完成项目')
  assertThrows(() => db.createDailyTask({ title: 'x', date: today(), project_id: 999999 }), '创建：拒绝不存在的项目')
  assertThrows(() => db.createDailyTask({ title: 'x', date: today(), project_id: 'abc' }), '创建：拒绝非法 project_id')
}

// 3. 更新：不传保持、null 解除、换项目、既有非活跃关联保留
{
  const t = db.createDailyTask({ title: '待编辑', date: today(), project_id: active.id })

  const kept = db.updateDailyTask(t.id, { title: '改了标题' })
  assertEqual(kept.project_id, active.id, '更新：不传 project_id 保持原关联')

  const switched = db.updateDailyTask(t.id, { project_id: notStarted.id })
  assertEqual(switched.project_id, notStarted.id, '更新：可换到另一个活跃项目')

  assertThrows(() => db.updateDailyTask(t.id, { project_id: paused.id }), '更新：拒绝新的非活跃关联')
  assertEqual(db.getDailyTaskById(t.id).project_id, notStarted.id, '更新：非法关联失败后原关联不变')

  const cleared = db.updateDailyTask(t.id, { project_id: null })
  assertEqual(cleared.project_id, null, '更新：显式 null 解除关联')

  // 项目转为已暂停后：既有值不变可继续编辑，其它字段可改
  const pausedProject = db.createProject({ name: '将被暂停', status: '进行中' })
  const t2 = db.createDailyTask({ title: '关联后暂停', date: today(), project_id: pausedProject.id })
  db.updateProject(pausedProject.id, { status: '已暂停' })
  const edited = db.updateDailyTask(t2.id, { project_id: pausedProject.id, notes: '改备注' })
  assertEqual(edited.project_id, pausedProject.id, '更新：项目转为已暂停后既有值未变仍保留')
  assertEqual(edited.notes, '改备注', '更新：非活跃项目的既有任务仍可编辑')
  assertEqual(edited.project_name, '将被暂停', '更新：项目名仍可显示')

  // 项目软删后：编辑其它字段不失败
  db.deleteProject(pausedProject.id)
  const afterDelete = db.updateDailyTask(t2.id, { project_id: pausedProject.id, notes: '软删后编辑' })
  assertEqual(afterDelete.project_id, pausedProject.id, '软删：编辑不失败且关联值保留')
  assertEqual(afterDelete.project_name, null, '软删：项目名不再显示')

  // 撤回项目后关联恢复可见
  db.restoreEntities('projects', [pausedProject.id])
  assertEqual(db.getDailyTaskById(t2.id).project_name, '将被暂停', '撤回项目：关联恢复可见')
}

// 4. 完成 / 取消完成不影响关联
{
  const t = db.createDailyTask({ title: '完成测试', date: today(), project_id: active.id })
  const completed = db.toggleDailyTaskComplete(t.id, true)
  assertEqual(completed.project_id, active.id, '完成：关联保留')
  const uncompleted = db.toggleDailyTaskComplete(t.id, false)
  assertEqual(uncompleted.project_id, active.id, '取消完成：关联保留')
}

// 5. 顺延 / 删除撤回 保留关联
{
  const t = db.createDailyTask({ title: '顺延测试', date: today(), project_id: active.id })
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  db.moveDailyTasksToDate([t.id], tomorrow)
  assertEqual(db.getDailyTaskById(t.id).project_id, active.id, '顺延：project_id 保留')

  db.deleteDailyTask(t.id)
  assertEqual(db.getDailyTaskById(t.id), undefined, '删除：任务不可见')
  db.restoreEntities('daily_tasks', [t.id])
  assertEqual(db.getDailyTaskById(t.id).project_id, active.id, '撤回删除：project_id 保留')
}

// 6. 重复规则：创建/更新/生成继承
{
  const rule = db.createDailyTaskRepeatRule({ title: '重复关联', repeat_type: 'daily', start_date: today(), project_id: active.id })
  assertEqual(rule.project_id, active.id, '重复规则：可关联项目')
  assertEqual(rule.project_name, '活跃项目', '重复规则：返回项目名')

  db.generateDailyTasksForDate(today())
  const generated = db.getDailyTasksByDate(today()).find(t => t.title === '重复关联')
  assertEqual(generated.project_id, active.id, '重复生成：继承规则的项目')

  const switched = db.updateDailyTaskRepeatRule(rule.id, { project_id: notStarted.id })
  assertEqual(switched.project_id, notStarted.id, '重复规则更新：可换项目')
  const keptRule = db.updateDailyTaskRepeatRule(rule.id, { priority: '高' })
  assertEqual(keptRule.project_id, notStarted.id, '重复规则更新：不传保持')
  const clearedRule = db.updateDailyTaskRepeatRule(rule.id, { project_id: null })
  assertEqual(clearedRule.project_id, null, '重复规则更新：null 解除')

  // 规则项目被暂停：生成任务仍继承（不静默取消）
  const pausedProject = db.createProject({ name: '规则暂停项目', status: '进行中' })
  const rule2 = db.createDailyTaskRepeatRule({ title: '暂停继承', repeat_type: 'daily', start_date: today(), project_id: pausedProject.id })
  db.updateProject(pausedProject.id, { status: '已暂停' })
  db.generateDailyTasksForDate(today())
  const inherited = db.getDailyTasksByDate(today()).find(t => t.title === '暂停继承')
  assertEqual(inherited.project_id, pausedProject.id, '重复生成：规则项目已暂停仍继承')

  // 规则项目被软删：生成任务解除关联而不是指向已删项目
  db.deleteProject(pausedProject.id)
  db.db.prepare('DELETE FROM daily_tasks WHERE title = ?').run('暂停继承')
  db.generateDailyTasksForDate(today())
  const unlinked = db.getDailyTasksByDate(today()).find(t => t.title === '暂停继承')
  assertEqual(unlinked.project_id, null, '重复生成：规则项目已软删则解除关联')
  assertEqual(db.getDailyTaskRepeatRuleById(rule2.id).project_id, pausedProject.id, '重复生成：规则本身不改动')
}

// 7. 首页聚合：项目任务 + 关联每日任务
{
  const p = db.createProject({ name: '聚合项目', status: '进行中' })
  db.createTask({ project_id: p.id, name: '项目任务1', status: '待办' })
  db.createTask({ project_id: p.id, name: '项目任务2', status: '已完成' })
  db.createDailyTask({ title: '每日1', date: today(), project_id: p.id, is_completed: true })
  db.createDailyTask({ title: '每日2', date: today(), project_id: p.id })
  const old = db.createDailyTask({ title: '每日3', date: today(), project_id: p.id, is_completed: true })
  db.db.prepare('UPDATE daily_tasks SET completed_at = ? WHERE id = ?').run(isoAt(-30), old.id)
  db.createDailyTask({ title: '无项目每日', date: today(), is_completed: true })

  const row = db.getAllProjects().find(proj => proj.id === p.id)
  assertEqual(row.task_count, 2, '聚合：项目任务数不受每日任务 JOIN 影响（无笛卡尔积）')
  assertEqual(row.daily_task_count, 3, '聚合：关联每日任务总数')
  assertEqual(row.daily_completed_count, 2, '聚合：关联每日任务完成数')
  assertEqual(row.daily_recent_completed_count, 1, '聚合：近7日完成数只算窗口内')
  assertEqual(row.daily_last_updated_at != null, true, '聚合：最近更新时间非空')

  const fresh = db.createProject({ name: '空项目', status: '进行中' })
  db.createDailyTask({ title: '空项目每日', date: today(), project_id: fresh.id })
  const freshRow = db.getAllProjects().find(proj => proj.id === fresh.id)
  assertEqual(freshRow.daily_task_count, 1, '聚合：未关联项目的每日任务不计入任何项目')
}

// 8. 导入合并：project_id 按映射恢复；映射不到则解除
{
  const source = newService('source')
  const sourceProject = source.createProject({ name: '共享项目', status: '进行中' })
  source.createDailyTask({ title: '导入每日1', date: '2026-01-05', project_id: sourceProject.id })
  const orphanProject = source.createProject({ name: '只存在于备份', status: '进行中' })
  source.createDailyTask({ title: '导入每日2', date: '2026-01-06', project_id: orphanProject.id })
  source.createDailyTaskRepeatRule({ title: '导入规则', repeat_type: 'daily', start_date: '2026-01-01', project_id: sourceProject.id })
  source.db.pragma('wal_checkpoint(TRUNCATE)')
  const sourcePath = source.dbPath
  source.db.close()

  const target = newService('target')
  // 先占一个 id，保证目标库里同名项目的 id 与备份库不同
  target.createProject({ name: '占位项目', status: '进行中' })
  const targetProject = target.createProject({ name: '共享项目', status: '进行中' })

  const result = await target.importData(sourcePath, 'merge')
  assertEqual(result.success, true, '导入：合并成功')

  const imported1 = target.db.prepare('SELECT * FROM daily_tasks WHERE title = ?').get('导入每日1')
  assertEqual(imported1.project_id, targetProject.id, '导入：按名称合并后的项目 id 映射（不是旧库 id）')
  assertEqual(imported1.project_id !== sourceProject.id, true, '导入：不直接套用旧库 id')

  const imported2 = target.db.prepare('SELECT * FROM daily_tasks WHERE title = ?').get('导入每日2')
  const orphanRow = target.db.prepare('SELECT * FROM projects WHERE name = ?').get('只存在于备份')
  assertEqual(orphanRow != null, true, '导入：备份中的项目也会被合并进来')
  assertEqual(imported2.project_id, orphanRow.id, '导入：新项目按新 id 关联')

  const importedRule = target.db.prepare('SELECT * FROM daily_task_repeat_rules WHERE title = ?').get('导入规则')
  assertEqual(importedRule.project_id, targetProject.id, '导入：重复规则同样映射项目 id')

  // 备份项目在本次导入中缺失（改名后旧 id 找不到映射）→ 解除
  const source2 = newService('source2')
  const p2 = source2.createProject({ name: '将被删除的项目', status: '进行中' })
  source2.createDailyTask({ title: '孤儿每日', date: '2026-02-01', project_id: p2.id })
  source2.db.pragma('wal_checkpoint(TRUNCATE)')
  // 抹掉备份里的项目行，模拟项目不在本次导入范围
  source2.db.prepare('DELETE FROM projects WHERE id = ?').run(p2.id)
  const source2Path = source2.dbPath
  source2.db.close()

  const target2 = newService('target2')
  await target2.importData(source2Path, 'merge')
  const orphanDaily = target2.db.prepare('SELECT * FROM daily_tasks WHERE title = ?').get('孤儿每日')
  assertEqual(orphanDaily.project_id, null, '导入：找不到项目映射时解除关联（不串项目）')
}

console.log(failures === 0 ? '\nAll daily-task project-link tests passed.' : `\n${failures} test(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
