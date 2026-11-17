// 删除撤回（真实 SQLite）：delete -> restoreEntities 之后 id 与关联必须原样回来。
//
// 需要 Electron 的 Node ABI（better-sqlite3 是按 Electron 编译的），所以用:
//   ELECTRON_RUN_AS_NODE=1 npx electron scripts/test-delete-undo-db.mjs
// 在纯 node 下运行会因 NODE_MODULE_VERSION 不匹配而失败。
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-delete-undo-'))
const db = new DatabaseService(path.join(tmpDir, 'database.db'), path.join(tmpDir, 'uploads'))
db.initialize()

try {
  // ===== 每日任务：deleteDailyTask 连带子任务，撤回要一起回来 =====
  const daily = db.createDailyTask({ title: '每日 A', date: '2026-10-01' })
  const sub1 = db.createDailySubtask(daily.id, { title: '子 1' })
  const sub2 = db.createDailySubtask(daily.id, { title: '子 2' })

  db.deleteDailyTask(daily.id)
  assertEqual(db.getDailyTasksByDate('2026-10-01').length, 0, '删除后每日任务查不到')
  assertEqual(db.getDailySubtasks(daily.id).length, 0, '删除后子任务查不到')

  db.restoreEntities('daily_tasks', [daily.id])
  db.restoreEntities('daily_task_subtasks', [sub1.id, sub2.id])
  const restoredDaily = db.getDailyTasksByDate('2026-10-01')
  assertEqual(restoredDaily.map(t => t.id), [daily.id], '撤回后每日任务用回原 id')
  assertEqual(db.getDailySubtasks(daily.id).map(s => s.id), [sub1.id, sub2.id], '撤回后子任务原样回来')

  // ===== 便签：本体 + 项目关联 =====
  const noteProject = db.createProject({ name: '便签所在项目' })
  const note = db.createDesktopNote({ title: '便签', content: 'hello', project_ids: [noteProject.id] })
  assertEqual(db.getDesktopNotesByProject(noteProject.id).map(n => n.id), [note.id], '便签已关联到项目')

  db.deleteDesktopNote(note.id)
  assertEqual(db.getDesktopNotesByProject(noteProject.id).length, 0, '删除后便签不在项目里')

  db.restoreEntities('desktop_notes', [note.id])
  db.restoreNoteProjectLink(note.id, noteProject.id)
  assertEqual(
    db.getDesktopNotesByProject(noteProject.id).map(n => n.id),
    [note.id],
    '撤回后便签与项目关联都回来'
  )

  // ===== 项目：级联删除任务/附件/便签关联，撤回要层层恢复 =====
  const project = db.createProject({ name: '级联项目' })
  const taskA = db.createTask({ project_id: project.id, name: '任务 A' })
  const taskB = db.createTask({ project_id: project.id, name: '任务 B', status: '已完成' })
  const linkedNote = db.createDesktopNote({ title: '项目便签', content: '', project_ids: [project.id] })
  db.uploadDocument(project.id, { name: 'a.txt', size: 3, data: [1, 2, 3] })
  const beforeDelete = db.getProjectById(project.id)
  const undoSnapshot = {
    id: project.id,
    taskIds: beforeDelete.tasks.map(t => t.id),
    documentIds: beforeDelete.documents.map(d => d.id),
    noteIds: beforeDelete.notes.map(n => n.id)
  }
  assertEqual(undoSnapshot.taskIds.sort(), [taskA.id, taskB.id].sort(), '删除前拿到全部任务 id')
  assertEqual(undoSnapshot.documentIds.length, 1, '删除前拿到全部附件 id')
  assertEqual(undoSnapshot.noteIds, [linkedNote.id], '删除前拿到全部便签 id')

  db.deleteProject(project.id)
  assertEqual(db.getProjectById(project.id), null, '删除后项目查不到')
  assertEqual(db.getTasksByProjectId(project.id).length, 0, '删除后项目任务查不到')
  assertEqual(db.getDesktopNotesByProject(project.id).length, 0, '删除后项目便签查不到')

  db.restoreEntities('projects', [project.id])
  db.restoreEntities('tasks', undoSnapshot.taskIds)
  db.restoreEntities('project_documents', undoSnapshot.documentIds)
  for (const noteId of undoSnapshot.noteIds) db.restoreNoteProjectLink(noteId, project.id)

  const afterUndo = db.getProjectById(project.id)
  assertEqual(afterUndo?.id, project.id, '撤回后项目用回原 id')
  assertEqual(
    afterUndo.tasks.map(t => t.id).sort(),
    [taskA.id, taskB.id].sort(),
    '撤回后项目任务用回原 id'
  )
  assertEqual(
    afterUndo.tasks.find(t => t.id === taskB.id)?.status,
    '已完成',
    '撤回后任务完成状态保留'
  )
  assertEqual(afterUndo.documents.map(d => d.id), undoSnapshot.documentIds, '撤回后附件用回原 id')
  assertEqual(
    db.downloadDocument(undoSnapshot.documentIds[0])?.file_size,
    3,
    '撤回后附件内容仍可下载'
  )
  assertEqual(
    db.getDesktopNotesByProject(project.id).map(n => n.id),
    [linkedNote.id],
    '撤回后便签关联恢复'
  )

  // ===== 白名单：不接受任意表名 =====
  let rejected = false
  try {
    db.restoreEntities('sync_changes', [1])
  } catch {
    rejected = true
  }
  assertEqual(rejected, true, '非白名单表被拒绝')

  // ===== 重复撤回不报错 =====
  assertEqual(db.restoreEntities('tasks', [taskA.id]), { restored: 0 }, '已存在的行重复撤回是 no-op')
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true })
}

console.log(failures ? `\n${failures} test(s) failed.` : '\nAll delete-undo DB tests passed.')
if (failures) process.exitCode = 1
