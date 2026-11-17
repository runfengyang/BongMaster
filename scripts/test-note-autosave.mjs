// 便签自动保存：切换便签时必须保存"切走前捕获的快照"，且保存回来后不能把新便签当成旧便签重新排定保存。
// 运行: node scripts/test-note-autosave.mjs
import { useAutosaveNote } from '../src/composables/useAutosaveNote.js'

let failures = 0

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    console.error(`FAIL: ${message}`)
    console.error(`  expected: ${JSON.stringify(expected)}`)
    console.error(`  actual:   ${JSON.stringify(actual)}`)
    failures += 1
  } else {
    console.log(`PASS: ${message}`)
  }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

function createAutosave(options) {
  // 组件外调用会触发一次无关的 Vue 生命周期警告。
  const originalWarn = console.warn
  console.warn = () => {}
  try {
    return useAutosaveNote(options)
  } finally {
    console.warn = originalWarn
  }
}

// 切换便签：先捕获旧便签快照，再切到新便签，最后用快照 flush。
{
  let live = { noteId: 1, title: 'A', content: 'a' }
  const saved = []
  const autosave = createAutosave({
    getSnapshot: () => ({ ...live }),
    saveSnapshot: async (snapshot) => {
      saved.push(snapshot)
      return { ...snapshot }
    },
    delay: 20
  })

  autosave.markDirty()
  const captured = { ...live }
  live = { noteId: 2, title: 'B', content: 'b' }

  await autosave.flushSave(captured)
  assertEqual(saved.length, 1, 'flushSave(快照) 只保存一次')
  assertEqual(saved[0]?.noteId, 1, 'flushSave(快照) 保存的是切走前的便签')
  assertEqual(saved[0]?.content, 'a', 'flushSave(快照) 用的是捕获的内容')
  assertEqual(autosave.state.value, 'idle', '切换便签后保存状态回到 idle')

  await sleep(80)
  assertEqual(saved.length, 1, '保存回来后不会为当前便签重新排定保存')
  assertEqual(autosave.state.value, 'idle', '没有残留的保存状态')
}

// 常规 flush（无参数）仍然保存编辑器当前内容。
{
  let live = { noteId: 5, title: 'C', content: 'c' }
  const saved = []
  const autosave = createAutosave({
    getSnapshot: () => ({ ...live }),
    saveSnapshot: async (snapshot) => {
      saved.push(snapshot)
      return { ...snapshot }
    },
    delay: 20
  })

  autosave.markDirty()
  await autosave.flushSave()
  assertEqual(saved.length, 1, 'flushSave() 保存脏内容')
  assertEqual(saved[0]?.noteId, 5, 'flushSave() 保存当前便签')
  assertEqual(autosave.state.value, 'saved', '保存成功后状态为 saved')

  await sleep(80)
  assertEqual(saved.length, 1, '内容未变化时不会重复保存')
}

if (failures > 0) {
  console.error(`\n${failures} 个断言失败`)
  process.exitCode = 1
} else {
  console.log('\nAll note autosave tests passed.')
}
