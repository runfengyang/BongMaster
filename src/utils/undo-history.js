/**
 * 编辑历史栈（内容编辑器的撤回/重做）。
 *
 * 约定：每次**改动之前**调用 push 记录改动前的快照；undo/redo 时把当前快照
 * 交给对方栈，这样两个方向都能来回走。push 会清空重做栈（新的编辑作废重做）。
 *
 * 纯数据结构，不碰 DOM，方便单测。
 */
export function createUndoHistory(limit = 60) {
  const past = []
  const future = []

  return {
    canUndo() {
      return past.length > 0
    },
    canRedo() {
      return future.length > 0
    },
    // 栈顶快照（不改动栈），调用方用它去重。
    peek() {
      return past.length ? past[past.length - 1] : null
    },
    push(snapshot) {
      if (snapshot === undefined || snapshot === null) return
      past.push(snapshot)
      if (limit > 0 && past.length > limit) past.shift()
      future.length = 0
    },
    undo(current) {
      if (!past.length) return null
      const previous = past.pop()
      if (current !== undefined && current !== null) future.push(current)
      return previous
    },
    redo(current) {
      if (!future.length) return null
      const next = future.pop()
      if (current !== undefined && current !== null) past.push(current)
      return next
    },
    reset() {
      past.length = 0
      future.length = 0
    }
  }
}
