import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * 全局“已删除 · 撤回”胶囊提示。
 *
 * 挂在 App.vue 上，状态放在 Pinia 里，所以切换路由/页面不会把最后一次删除的
 * 撤回入口弄丢。同一时间只保留一条（新的删除替换旧的）。
 */
export const useUndoStore = defineStore('undo', () => {
  const message = ref('')
  const visible = ref(false)
  const busy = ref(false)
  let undoAction = null
  let timer = null

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  const dismiss = () => {
    clearTimer()
    visible.value = false
    undoAction = null
  }

  const showUndo = ({ message: text = '已删除', undo = null, duration = 5000 } = {}) => {
    clearTimer()
    message.value = text
    undoAction = typeof undo === 'function' ? undo : null
    visible.value = true
    if (duration > 0) {
      timer = setTimeout(() => {
        if (visible.value) dismiss()
      }, duration)
    }
  }

  const undo = async () => {
    const action = undoAction
    if (!action || busy.value) return
    busy.value = true
    // 先收起提示：撤回要取消定时器，否则 5 秒到点会再 dismiss 一次。
    clearTimer()
    visible.value = false
    undoAction = null
    try {
      await action()
    } catch (err) {
      console.error('[UndoStore] undo failed:', err)
    } finally {
      busy.value = false
    }
  }

  return { message, visible, busy, showUndo, dismiss, undo }
})
