// 每日任务历史统计口径回归：7 天分母、30 天边界、SQLite UTC 文本 / ISO Z / 带 offset
// 时间解析、本地跨午夜分桶、无效/缺失/倒置时间、零样本 null、软删除与子任务排除、
// 未来完成日期与未来计划日期、date 有效性校验。
// 用临时数据库，不碰真实库。better-sqlite3 按 Electron ABI 编译，所以用:
//   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/daily-task-history-test.mjs
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import os from 'os'
import path from 'path'
import fs from 'fs'

const require = createRequire(import.meta.url)
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { DatabaseService } = require(path.join(projectRoot, 'electron/services/database-service.js'))

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

function assertClose(actual, expected, message, tolerance = 1e-6) {
  if (typeof actual !== 'number' || Math.abs(actual - expected) > tolerance) {
    console.error(`FAIL: ${message}`)
    console.error(`  expected: ${expected} (±${tolerance})`)
    console.error(`  actual:   ${actual}`)
    failures += 1
  } else {
    console.log(`PASS: ${message}`)
  }
}

function section(name) {
  console.log(`\n== ${name} ==`)
}

// ===== 时间工具：一律按本地墙钟构造，避免测试自身依赖时区偏移方向 =====
const pad = (n) => String(n).padStart(2, '0')
const localYmd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const at = (dayOffset, hour, minute = 0, second = 0) => {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hour, minute, second, 0)
}
const hoursBefore = (d, hours) => new Date(d.getTime() - hours * 3600 * 1000)
// SQLite CURRENT_TIMESTAMP 的形态：UTC 无时区文本
const sqliteUtc = (d) => d.toISOString().slice(0, 19).replace('T', ' ')
const isoZ = (d) => d.toISOString()
// 带本地 offset 的 ISO 文本，与 d 表示同一时刻
const isoOffset = (d) => {
  const offset = -d.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  return `${localYmd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.000${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

const TODAY = localYmd(new Date())

// ===== 临时库 =====
const tmpDirs = []
const openDbs = []

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-daily-history-'))
  tmpDirs.push(dir)
  const dbPath = path.join(dir, 'database.db')
  // 先建空文件：initialize() 会尝试从旧版 BongMaster 目录拷贝数据库，空文件让它跳过
  fs.writeFileSync(dbPath, '')
  const svc = new DatabaseService(dbPath, path.join(dir, 'uploads'))
  svc.initialize()
  openDbs.push(svc)
  return svc
}

function insertTask(svc, row) {
  return svc.db.prepare(`
    INSERT INTO daily_tasks (title, date, is_completed, completed_at, created_at, updated_at, deleted_at)
    VALUES (@title, @date, @isCompleted, @completedAt, @createdAt, @createdAt, @deletedAt)
  `).run({
    title: row.title || 'task',
    date: row.date || TODAY,
    isCompleted: row.isCompleted ? 1 : 0,
    completedAt: row.completedAt ?? null,
    createdAt: row.createdAt ?? null,
    deletedAt: row.deletedAt ?? null
  }).lastInsertRowid
}

try {
  // ===== 空库 + date 校验 =====
  section('空库与 date 校验')
  {
    const svc = freshDb()
    assertEqual(
      svc.getDailyTaskHistoryStats(TODAY),
      { todayCompleted: 0, weeklyDailyAverage: 0, averageCompletionDays: null, overdueCount: 0, completionSampleCount: 0 },
      '空库：计数全零，平均完成时长为 null'
    )
    for (const bad of ['', '2026-1-1', '2026-13-01', '2026-02-30', '2026-11-04T00:00:00Z', 'abcd-ef-gh', null, undefined, 20261104]) {
      let threw = false
      try {
        svc.getDailyTaskHistoryStats(bad)
      } catch {
        threw = true
      }
      assertEqual(threw, true, `非法 date 抛错: ${String(bad)}`)
    }
    assertEqual(svc.getDailyTaskHistoryStats('2024-02-29').todayCompleted, 0, '闰日 2024-02-29 视为合法')
  }

  // ===== 7 天分母 / 30 天边界 / 排除规则 =====
  section('7 天分母 / 30 天边界 / 排除规则')
  {
    const svc = freshDb()
    const d0 = at(0, 0, 5)
    const d6 = at(-6, 23, 0)
    const d7 = at(-7, 23, 0)
    const d29 = at(-29, 12, 0)
    const d30 = at(-30, 12, 0)
    const tomorrow10 = at(1, 10)

    // 每条有效完成都是「完成前 1 小时创建」
    insertTask(svc, { title: '今天完成', date: localYmd(d0), isCompleted: true, createdAt: sqliteUtc(hoursBefore(d0, 1)), completedAt: isoZ(d0) })
    insertTask(svc, { title: '窗口第 7 天', date: localYmd(d6), isCompleted: true, createdAt: sqliteUtc(hoursBefore(d6, 1)), completedAt: isoZ(d6) })
    insertTask(svc, { title: '窗口外第 8 天', date: localYmd(d7), isCompleted: true, createdAt: sqliteUtc(hoursBefore(d7, 1)), completedAt: sqliteUtc(d7) })
    insertTask(svc, { title: '30 天边界', date: localYmd(d29), isCompleted: true, createdAt: sqliteUtc(hoursBefore(d29, 1)), completedAt: isoOffset(d29) })
    insertTask(svc, { title: '30 天外', date: localYmd(d30), isCompleted: true, createdAt: sqliteUtc(hoursBefore(d30, 1)), completedAt: isoZ(d30) })
    insertTask(svc, { title: '软删除', date: localYmd(d0), isCompleted: true, createdAt: sqliteUtc(hoursBefore(d0, 1)), completedAt: isoZ(d0), deletedAt: isoZ(d0) })
    insertTask(svc, { title: '未完成残留完成时间', date: localYmd(d0), isCompleted: false, createdAt: sqliteUtc(hoursBefore(d0, 1)), completedAt: isoZ(d0) })
    insertTask(svc, { title: '未来完成日期', date: localYmd(tomorrow10), isCompleted: true, createdAt: sqliteUtc(hoursBefore(tomorrow10, 1)), completedAt: isoZ(tomorrow10) })
    insertTask(svc, { title: '非法完成时间', date: localYmd(d0), isCompleted: true, createdAt: sqliteUtc(hoursBefore(d0, 1)), completedAt: 'garbage' })

    const stats = svc.getDailyTaskHistoryStats(TODAY)
    assertEqual(stats.todayCompleted, 1, 'todayCompleted：只算今天完成、未软删、仍标记完成的主任务')
    assertClose(stats.weeklyDailyAverage * 7, 2, '7 天窗口含 TODAY-6、不含 TODAY-7，分母固定 7')
    assertEqual(stats.completionSampleCount, 4, '30 天窗口含 TODAY-29、不含 TODAY-30')
    assertClose(stats.averageCompletionDays, 1 / 24, '4 条样本都是 1 小时 → 平均 1/24 天')

    const tomorrow = localYmd(tomorrow10)
    assertEqual(svc.getDailyTaskHistoryStats(tomorrow).todayCompleted, 0, '完成日期晚于今天的行不计入任何统计')

    const farFuture = localYmd(at(10, 0))
    const futureStats = svc.getDailyTaskHistoryStats(farFuture)
    assertEqual(futureStats.todayCompleted, 0, '选中未来日期时未来的完成时间仍被排除')
    assertClose(futureStats.weeklyDailyAverage, 0, '选中未来日期时 7 天窗口为空')

    assertEqual(svc.getDailyTaskHistoryStats(localYmd(d30)).todayCompleted, 1, '选中 TODAY-30 时该天完成数正常')
  }

  // ===== 时间格式与本地跨午夜 =====
  section('UTC 无时区 / ISO Z / offset / 本地跨午夜')
  {
    const svc = freshDb()
    const early = at(-2, 0, 30) // 本地凌晨 00:30，正偏移时区下 UTC 日期是前一天
    const late = at(-3, 23, 30) // 本地深夜 23:30，负偏移时区下 UTC 日期是后一天
    const noon = at(-4, 12, 0)

    assertEqual(new Date(isoOffset(early)).getTime(), early.getTime(), 'offset ISO 文本与本地时刻等价')

    const cases = [
      { title: '本地凌晨 ISO Z', instant: early, completedAt: isoZ(early) },
      { title: '本地深夜 offset', instant: late, completedAt: isoOffset(late) },
      { title: 'UTC 文本完成时间', instant: noon, completedAt: sqliteUtc(noon) }
    ]
    for (const c of cases) {
      insertTask(svc, { title: c.title, date: localYmd(c.instant), isCompleted: true, createdAt: sqliteUtc(hoursBefore(c.instant, 2)), completedAt: c.completedAt })
    }

    assertClose(svc.getDailyTaskHistoryStats(TODAY).weeklyDailyAverage * 7, 3, '三种时间格式都落在 7 天窗口内')

    const expectedFor = (day) => cases.filter((c) => localYmd(c.instant) === day).length
    for (const c of cases) {
      const localDay = localYmd(c.instant)
      const utcDay = c.instant.toISOString().slice(0, 10)
      assertEqual(
        svc.getDailyTaskHistoryStats(localDay).todayCompleted,
        expectedFor(localDay),
        `按完成时刻的本地日期分桶: 本地 ${localDay} / UTC ${utcDay}`
      )
      if (utcDay !== localDay) {
        assertEqual(
          svc.getDailyTaskHistoryStats(utcDay).todayCompleted,
          expectedFor(utcDay),
          `跨午夜不按 UTC 日期归属: 本地 ${localDay} 的行不在 ${utcDay} 计数`
        )
      }
    }
  }

  // ===== 完成时长样本 =====
  section('完成时长样本：缺失 / 非法 / 倒置')
  {
    const svc = freshDb()
    const c1 = at(-1, 12, 0)
    const c2 = at(-2, 12, 0)
    const c3 = at(-3, 12, 0)
    const c4 = at(-4, 12, 0)
    const c5 = at(-5, 12, 0)
    const c6 = at(-6, 12, 0)

    insertTask(svc, { title: '整 1 天', date: localYmd(c1), isCompleted: true, createdAt: sqliteUtc(hoursBefore(c1, 24)), completedAt: isoZ(c1) })
    insertTask(svc, { title: '半 天', date: localYmd(c2), isCompleted: true, createdAt: sqliteUtc(hoursBefore(c2, 12)), completedAt: isoOffset(c2) })
    insertTask(svc, { title: '缺创建时间', date: localYmd(c3), isCompleted: true, createdAt: null, completedAt: isoZ(c3) })
    insertTask(svc, { title: '非法创建时间', date: localYmd(c4), isCompleted: true, createdAt: 'not-a-timestamp', completedAt: isoZ(c4) })
    insertTask(svc, { title: '完成早于创建', date: localYmd(c5), isCompleted: true, createdAt: sqliteUtc(at(-5, 13, 0)), completedAt: isoZ(c5) })
    insertTask(svc, { title: '非法完成时间', date: localYmd(c6), isCompleted: true, createdAt: sqliteUtc(hoursBefore(c6, 1)), completedAt: 'garbage' })

    const stats = svc.getDailyTaskHistoryStats(TODAY)
    assertEqual(stats.completionSampleCount, 2, '只有 2 条时间合法且间隔 >= 0 的样本')
    assertClose(stats.averageCompletionDays, 0.75, '平均 (1 + 0.5) / 2 = 0.75 天')
    assertClose(stats.weeklyDailyAverage * 7, 5, '完成时间合法即计入 7 天完成数（缺创建时间也算）')
  }

  // ===== 零样本 =====
  section('零有效样本')
  {
    const svc = freshDb()
    const d = at(-1, 12, 0)
    insertTask(svc, { title: '只有非法创建时间', date: localYmd(d), isCompleted: true, createdAt: null, completedAt: isoZ(d) })
    const stats = svc.getDailyTaskHistoryStats(TODAY)
    assertEqual(stats.completionSampleCount, 0, '没有可解析的创建/完成时间对 → 样本数 0')
    assertEqual(stats.averageCompletionDays, null, '零样本时平均完成时长为 null（不是 0）')
    assertEqual(stats.todayCompleted, 0, '仅缺创建时间的任务不影响完成计数口径以外的字段')
    assertClose(stats.weeklyDailyAverage * 7, 1, '缺创建时间但完成时间合法的任务仍算完成')
  }

  // ===== 积压 =====
  section('积压统计：超过 7 天仍未完成、计划日期不晚于选中日')
  {
    const svc = freshDb()
    const planDay = localYmd(at(-3, 9))
    const boundary = at(-7, 0, 0) // 选中日 00:00 往前 7 天

    insertTask(svc, { title: '8 天前创建', date: planDay, createdAt: sqliteUtc(at(-8, 9)), isCompleted: false })
    insertTask(svc, { title: '恰好 7 天（不严格早于）', date: planDay, createdAt: sqliteUtc(boundary), isCompleted: false })
    insertTask(svc, { title: '7 天差 1 秒', date: planDay, createdAt: sqliteUtc(new Date(boundary.getTime() - 1000)), isCompleted: false })
    insertTask(svc, { title: '新任务', date: planDay, createdAt: sqliteUtc(at(-2, 9)), isCompleted: false })
    insertTask(svc, { title: '未来计划日期', date: localYmd(at(2, 9)), createdAt: sqliteUtc(at(-9, 9)), isCompleted: false })
    insertTask(svc, { title: '已完成', date: planDay, isCompleted: true, createdAt: sqliteUtc(at(-10, 9)), completedAt: isoZ(at(-1, 9)) })
    insertTask(svc, { title: '未完成残留完成时间', date: planDay, isCompleted: false, createdAt: sqliteUtc(at(-10, 9)), completedAt: isoZ(at(-1, 9)) })
    insertTask(svc, { title: '软删除', date: planDay, isCompleted: false, createdAt: sqliteUtc(at(-10, 9)), deletedAt: isoZ(at(-1, 9)) })
    insertTask(svc, { title: '创建时间非法', date: planDay, isCompleted: false, createdAt: 'garbage' })

    assertEqual(svc.getDailyTaskHistoryStats(TODAY).overdueCount, 2, '只算严格超过 7 天的未完成主任务（含 7 天差 1 秒，不含恰好 7 天）')
    assertEqual(svc.getDailyTaskHistoryStats(localYmd(at(1, 9))).overdueCount, 3, '阈值随选中日移动（TODAY-7 相对选中日已超过 7 天），计划日 TODAY+2 仍不算积压')
    assertEqual(svc.getDailyTaskHistoryStats(localYmd(at(-4, 9))).overdueCount, 0, '选中日早于任务计划日期时不算积压')
  }

  // ===== 子任务不重复 =====
  section('子任务不重复计数')
  {
    const svc = freshDb()
    const t = at(0, 9, 0)
    const id = insertTask(svc, { title: '主任务', date: localYmd(t), isCompleted: true, createdAt: sqliteUtc(hoursBefore(t, 1)), completedAt: isoZ(t) })
    svc.db.prepare("INSERT INTO daily_task_subtasks (daily_task_id, title, is_completed) VALUES (?, ?, 1)").run(id, '子 1')
    svc.db.prepare("INSERT INTO daily_task_subtasks (daily_task_id, title, is_completed) VALUES (?, ?, 1)").run(id, '子 2')

    const stats = svc.getDailyTaskHistoryStats(TODAY)
    assertEqual(stats.todayCompleted, 1, '两个已完成子任务不额外计入今天完成数')
    assertClose(stats.weeklyDailyAverage, 1 / 7, '7 天日均按主任务 1 条 / 7')
    assertEqual(stats.completionSampleCount, 1, '子任务不额外产生完成时长样本')
  }
} finally {
  for (const svc of openDbs) {
    try {
      svc.db.close()
    } catch {
      // 已关闭的库忽略
    }
  }
  for (const dir of tmpDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // 清理失败不影响结果
    }
  }
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
