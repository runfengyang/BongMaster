// 删除撤回（前端接线）：调用顺序、表名、id 透传。
// 删除本身是软删除，撤回必须走 restoreEntities 而不是 create —— 用 create 会换新
// id 并把子任务/附件/便签关联全部丢掉。
// 运行: node scripts/test-delete-undo.mjs
import { createPinia, setActivePinia } from 'pinia'

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

const calls = []
const windowStub = {
  electronAPI: {
    restoreEntities: (tableName, ids) => { calls.push(['restoreEntities', tableName, ids]); return { restored: ids.length } },
    restoreNoteProjectLink: (noteId, projectId) => { calls.push(['restoreNoteProjectLink', noteId, projectId]); return { success: true } },
    getDesktopNotes: () => { calls.push(['getDesktopNotes']); return [] },
    generateDailyTasksForDate: (date) => { calls.push(['generateDailyTasksForDate', date]); return { success: true, createdIds: [] } },
    getDailyTasksByDate: (date) => { calls.push(['getDailyTasksByDate', date]); return [] },
    getDailySubtasksByTaskIds: () => [],
    getDailyTaskHistoryStats: () => ({ todayCompleted: 0, weeklyDailyAverage: 0, averageCompletionDays: null, overdueCount: 0, completionSampleCount: 0 }),
    getAllProjects: () => { calls.push(['getAllProjects']); return [] },
    alert: () => {}
  }
}
globalThis.window = windowStub
globalThis.alert = () => {}

setActivePinia(createPinia())
const { useNotepadStore } = await import('../src/stores/notepad-store.js')
const { useDailyTaskStore } = await import('../src/stores/daily-task-store.js')
const { useProjectStore } = await import('../src/stores/project-store.js')
const { useUndoStore } = await import('../src/stores/undo-store.js')

// 便签：恢复便签本体 + 每条项目关联。
{
  calls.length = 0
  const store = useNotepadStore()
  const ok = await store.restoreDeletedNote({ id: 7, title: 'A', project_ids: [3, 9] })
  assertEqual(ok, true, 'restoreDeletedNote 成功')
  assertEqual(calls, [
    ['restoreEntities', 'desktop_notes', [7]],
    ['restoreNoteProjectLink', 7, 3],
    ['restoreNoteProjectLink', 7, 9],
    ['getDesktopNotes']
  ], '便签撤回按“本体 -> 项目关联 -> 刷新”顺序调用')
}

// 便签：没有项目关联时只恢复本体。
{
  calls.length = 0
  const store = useNotepadStore()
  await store.restoreDeletedNote({ id: 8, title: 'B', project_ids: [] })
  assertEqual(calls, [
    ['restoreEntities', 'desktop_notes', [8]],
    ['getDesktopNotes']
  ], '无关联便签不调用 restoreNoteProjectLink')
}

// 每日任务：任务本体 + 被连带删除的子任务。
{
  calls.length = 0
  const store = useDailyTaskStore()
  const ok = await store.restoreDailyTask({ id: 12, date: '2026-10-01' }, [101, 102])
  assertEqual(ok, true, 'restoreDailyTask 成功')
  const today = new Date().toLocaleDateString('sv-SE') // yyyy-MM-dd，本地时区
  assertEqual(calls, [
    ['restoreEntities', 'daily_tasks', [12]],
    ['restoreEntities', 'daily_task_subtasks', [101, 102]],
    ['generateDailyTasksForDate', today],
    ['getDailyTasksByDate', today]
  ], '每日任务撤回同时恢复子任务')
}

// 项目：级联删除的任务/附件/便签关联都要按顺序恢复。
{
  calls.length = 0
  const store = useProjectStore()
  const ok = await store.restoreProject({
    id: 5,
    name: 'P',
    taskIds: [21, 22],
    documentIds: [31],
    noteIds: [41]
  })
  assertEqual(ok, true, 'restoreProject 成功')
  assertEqual(calls, [
    ['restoreEntities', 'projects', [5]],
    ['restoreEntities', 'tasks', [21, 22]],
    ['restoreEntities', 'project_documents', [31]],
    ['restoreNoteProjectLink', 41, 5],
    ['getAllProjects']
  ], '项目撤回按“项目 -> 任务/附件 -> 便签关联”恢复')
}

// 非法 id 不触发任何 IPC。
{
  calls.length = 0
  const store = useProjectStore()
  const ok = await store.restoreProject({ id: null })
  assertEqual(ok, false, '缺少 id 时撤回失败')
  assertEqual(calls, [], '缺少 id 时不发 IPC')
}

// 撤回胶囊：显示、5 秒自动消失、撤回后收起并执行动作。
{
  const undoStore = useUndoStore()
  let undone = 0
  undoStore.showUndo({ message: '已删除 X', undo: () => { undone += 1 }, duration: 20 })
  assertEqual(undoStore.visible, true, 'showUndo 显示提示')
  assertEqual(undoStore.message, '已删除 X', 'showUndo 写入文案')

  await new Promise(resolve => setTimeout(resolve, 40))
  assertEqual(undoStore.visible, false, '到期自动消失')
  assertEqual(undone, 0, '到期消失不触发撤回')

  undoStore.showUndo({ message: '已删除 Y', undo: () => { undone += 1 }, duration: 0 })
  await undoStore.undo()
  assertEqual(undone, 1, '点击撤回执行动作')
  assertEqual(undoStore.visible, false, '撤回后收起提示')

  undoStore.showUndo({ message: '已删除 Z', duration: 0 })
  await undoStore.undo()
  assertEqual(undoStore.visible, true, '没有撤回动作时按钮不会收起提示（按钮本身禁用）')
  undoStore.dismiss()
  assertEqual(undoStore.visible, false, 'dismiss 关闭提示')

  // 新的删除替换旧的撤回目标。
  undoStore.showUndo({ message: '第一次', duration: 0 })
  undoStore.showUndo({ message: '第二次', duration: 0 })
  assertEqual(undoStore.message, '第二次', '新的删除替换旧提示')
  undoStore.dismiss()
}

console.log(failures ? `\n${failures} test(s) failed.` : '\nAll delete-undo tests passed.')
if (failures) process.exitCode = 1
