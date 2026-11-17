import { ref, onUnmounted } from 'vue'

/**
 * Composable for debounced autosave with stale response guards.
 */
export function useAutosaveNote(options) {
  const {
    getSnapshot,
    saveSnapshot,
    delay = 900,
    onStateChange,
    onSaved,
    onError
  } = options

  const state = ref('idle') // idle, dirty, saving, saved, error
  let saveSeq = 0
  let latestAppliedSeq = 0
  let saveTimer = null
  let activeSavePromise = null

  function setState(newState) {
    if (state.value === newState) return
    state.value = newState
    onStateChange?.(newState)
  }

  function isDirty() {
    return state.value === 'dirty' || state.value === 'error'
  }

  function isSaving() {
    return state.value === 'saving'
  }

  function cancelTimer() {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
  }

  function scheduleSave() {
    cancelTimer()
    setState('dirty')
    saveTimer = setTimeout(() => {
      runSave()
    }, delay)
  }

  function markDirty() {
    scheduleSave()
  }

  async function runSave(providedSnapshot) {
    cancelTimer()
    const seq = ++saveSeq
    const snapshot = providedSnapshot || getSnapshot()

    if (!snapshot.noteId) {
      // Cannot save without a note id; remain dirty.
      setState('dirty')
      return { stale: false, saved: false }
    }

    setState('saving')

    try {
      activeSavePromise = saveSnapshot(snapshot)
      const result = await activeSavePromise
      activeSavePromise = null

      if (seq < saveSeq) {
        // A newer save was requested while this one was in flight.
        return { stale: true }
      }

      if (!result) {
        setState('error')
        onError?.(new Error('保存返回空结果'), snapshot)
        return { stale: false, saved: false }
      }

      latestAppliedSeq = seq

      // Only mark saved if editor still holds the same snapshot.
      const current = getSnapshot()
      if (current.noteId !== snapshot.noteId) {
        // The editor switched to another note while this save was in flight. The
        // snapshot is done and must not schedule another save, which would write
        // the new note from unrelated editor state.
        if (state.value === 'saving') {
          setState('idle')
        }
        return { stale: false, saved: true }
      }
      if (
        current.content === snapshot.content &&
        current.title === snapshot.title
      ) {
        setState('saved')
        onSaved?.(result, snapshot)
        // Quietly return to idle after 2 seconds.
        setTimeout(() => {
          if (state.value === 'saved') {
            setState('idle')
          }
        }, 2000)
      } else {
        // Content changed during save; remain dirty so the latest content will be saved.
        setState('dirty')
        scheduleSave()
      }

      return { stale: false, saved: true }
    } catch (error) {
      activeSavePromise = null
      if (seq < saveSeq) {
        return { stale: true }
      }
      setState('error')
      onError?.(error, snapshot)
      return { stale: false, saved: false }
    }
  }

  // `providedSnapshot` lets a caller persist a snapshot captured before the
  // editor moved on (e.g. switching notes) instead of the live editor state.
  async function flushSave(providedSnapshot) {
    cancelTimer()
    if (state.value === 'saving' && activeSavePromise) {
      await activeSavePromise
    }
    if (providedSnapshot) {
      return runSave(providedSnapshot)
    }
    if (isDirty()) {
      return runSave()
    }
    return { stale: false, saved: false }
  }

  function cancelSave() {
    cancelTimer()
    if (state.value === 'dirty') {
      setState('idle')
    }
  }

  function canAcceptExternalUpdate() {
    return state.value === 'idle' || state.value === 'saved'
  }

  onUnmounted(() => {
    cancelTimer()
    // We intentionally do not await flushSave here to avoid blocking unmount,
    // but callers should flush before switching routes or deleting notes.
  })

  return {
    state,
    markDirty,
    scheduleSave,
    flushSave,
    cancelSave,
    isDirty,
    isSaving,
    canAcceptExternalUpdate
  }
}
