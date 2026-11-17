// 预览编辑器撤回/重做：历史栈语义 + markdown 偏移 -> DOM 文本偏移 的还原。
// 运行: node scripts/test-markdown-undo.mjs
import { createUndoHistory } from '../src/utils/undo-history.js'
import { domOffsetForMarkdownOffset } from '../src/utils/markdown-editor.js'

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

const snapshot = (markdown, start = markdown.length, end = start) => ({ markdown, caret: { start, end } })

// 撤回：回到 push 进去的那一版，并把当前版本交给重做栈。
{
  const history = createUndoHistory(10)
  history.push(snapshot('a'))
  history.push(snapshot('ab'))
  assertEqual(history.canUndo(), true, 'push 之后可以撤回')

  const back = history.undo(snapshot('abc'))
  assertEqual(back.markdown, 'ab', '撤回回到上一版内容')
  assertEqual(history.canRedo(), true, '撤回之后可以重做')

  const forward = history.redo(snapshot('ab'))
  assertEqual(forward.markdown, 'abc', '重做回到撤回前的内容')
  assertEqual(history.canRedo(), false, '重做栈已弹空')
}

// 新的编辑作废重做。
{
  const history = createUndoHistory(10)
  history.push(snapshot('a'))
  history.undo(snapshot('b'))
  assertEqual(history.canRedo(), true, '撤回后可以重做')
  history.push(snapshot('c'))
  assertEqual(history.canRedo(), false, '新编辑后重做作废')
}

// 空栈不能撤回/重做。
{
  const history = createUndoHistory(10)
  assertEqual(history.undo(snapshot('a')), null, '空历史撤回返回 null')
  assertEqual(history.redo(snapshot('a')), null, '空历史重做返回 null')
  assertEqual(history.peek(), null, '空历史 peek 为 null')
}

// 栈深度有上限，只保留最近 limit 条。
{
  const history = createUndoHistory(3)
  for (const value of ['a', 'b', 'c', 'd']) history.push(snapshot(value))
  assertEqual(history.peek().markdown, 'd', '栈顶是最新快照')
  assertEqual(history.undo(snapshot('e')).markdown, 'd', '撤回第一条是最近的 d')
  assertEqual(history.undo(snapshot('d')).markdown, 'c', '继续撤回得到 c')
  assertEqual(history.undo(snapshot('c')).markdown, 'b', '最旧的 a 已被丢弃')
  assertEqual(history.undo(snapshot('b')), null, '只保留 limit 条')
}

// reset 清空两个栈（换便签时调用）。
{
  const history = createUndoHistory(10)
  history.push(snapshot('a'))
  history.undo(snapshot('b'))
  history.reset()
  assertEqual(history.canUndo(), false, 'reset 清空撤回栈')
  assertEqual(history.canRedo(), false, 'reset 清空重做栈')
}

// 光标还原：把 markdown 偏移换算回渲染后的文本偏移。
{
  // '这是**粗体**' -> map: markdown 下标 -> DOM 文本下标，语法标记指向同一个 DOM 位置。
  const map = [0, 1, 2, 2, 2, 3, 4, 5, 5, 5]
  assertEqual(domOffsetForMarkdownOffset(map, 0), 0, '开头偏移')
  assertEqual(domOffsetForMarkdownOffset(map, 3), 2, '跳过 ** 前缀落在文本上')
  assertEqual(domOffsetForMarkdownOffset(map, 5), 3, '下划线标记位置取到文本起点')
  assertEqual(domOffsetForMarkdownOffset(map, 10), 6, '尾部偏移落在文本末尾之后')
  assertEqual(domOffsetForMarkdownOffset(map, 999), 6, '越界偏移被夹到末尾')
  assertEqual(domOffsetForMarkdownOffset([], 3), 0, '空 map 返回 0')
}

console.log(failures ? `\n${failures} test(s) failed.` : '\nAll markdown undo tests passed.')
if (failures) process.exitCode = 1
