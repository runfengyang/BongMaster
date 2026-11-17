const { v4: uuidv4 } = require('uuid')

const SYNC_DEVICE_NAME = 'BongMaster Desktop'
const SYNC_DEVICE_PLATFORM = 'electron'
const SYNC_POLL_INTERVAL_MS = 30000
const SYNC_DEBOUNCE_MS = 1000

// Dependency order for applying remote changes. Parents must arrive before children.
const ENTITY_ORDER = [
  'categories',
  'projects',
  'tasks',
  'task_views',
  'daily_task_repeat_rules',
  'daily_tasks',
  'daily_task_subtasks',
  'habits',
  'habit_checkins',
  'desktop_notes',
  'note_project_links',
  'project_documents'
]

class SyncService {
  constructor(dbService, syncServerUrl) {
    this.dbService = dbService
    this.syncServerUrl = (syncServerUrl || '').replace(/\/+$/, '')
    this.deviceId = null
    this._registered = false
    this._pushDebounceTimer = null
    this._intervalHandle = null
  }

  async init() {
    this.deviceId = this.dbService._getDeviceId()
    this.dbService.setSyncChangeCallback(() => this.debouncedPush())
    await this.registerDevice()
    this.startSyncLoop()
  }

  async registerDevice() {
    if (this._registered) return true
    try {
      const res = await fetch(`${this.syncServerUrl}/sync/register-device`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: this.deviceId,
          name: SYNC_DEVICE_NAME,
          platform: SYNC_DEVICE_PLATFORM,
          public_key: null
        })
      })
      if (res.ok || res.status === 409) {
        this._registered = true
        return true
      }
      console.error('[SyncService] register-device failed:', res.status)
      return false
    } catch (err) {
      console.error('[SyncService] register-device offline:', err.message)
      return false
    }
  }

  debouncedPush(delay = SYNC_DEBOUNCE_MS) {
    if (this._pushDebounceTimer) {
      clearTimeout(this._pushDebounceTimer)
    }
    this._pushDebounceTimer = setTimeout(() => {
      this.pushPendingChanges().catch(err => {
        console.error('[SyncService] debounced push error:', err.message)
      })
    }, delay)
  }

  startSyncLoop() {
    if (this._intervalHandle) return
    this._intervalHandle = setInterval(() => {
      this.syncRound().catch(err => {
        console.error('[SyncService] sync round error:', err.message)
      })
    }, SYNC_POLL_INTERVAL_MS)
    this.syncRound().catch(err => {
      console.error('[SyncService] initial sync round error:', err.message)
    })
  }

  async syncRound() {
    if (!this._registered) {
      await this.registerDevice()
    }
    await this.pushPendingChanges()
    await this.pullAndApplyChanges()
  }

  async pushPendingChanges() {
    if (!this._registered) return
    const changes = this.dbService.getSyncChangesPending(100)
    if (!changes || changes.length === 0) return { pushed: 0 }
    const localChangeMap = new Map(changes.map(c => [c.change_id, c]))
    const body = {
      device_id: this.deviceId,
      changes: changes.map(c => ({
        change_id: c.change_id,
        entity_table: c.entity_table,
        entity_uuid: c.entity_uuid,
        operation: c.operation,
        payload_json: c.payload_json,
        base_version: c.base_version,
        local_version: c.local_version,
        created_at: c.created_at,
        device_id: c.device_id
      }))
    }
    try {
      const res = await fetch(`${this.syncServerUrl}/sync/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      if (!res.ok) {
        console.error('[SyncService] push failed:', res.status)
        return { pushed: 0, error: `HTTP ${res.status}` }
      }
      const data = await res.json()
      const accepted = data.accepted || []
      const skipped = data.skipped || []
      const conflicts = data.conflicts || []
      const acceptedIds = [...accepted.map(a => a.change_id), ...skipped.map(s => s.change_id)]
      if (acceptedIds.length > 0) {
        this.dbService.markSyncChangesAccepted(acceptedIds)
      }
      if (conflicts.length > 0) {
        const conflictChangeIds = []
        for (const conflict of conflicts) {
          const localChange = conflict.change_id ? localChangeMap.get(conflict.change_id) : null
          const localPayload = (localChange && localChange.payload_json)
            ? JSON.parse(localChange.payload_json)
            : {}
          this.dbService.recordSyncConflict(
            conflict.entity_table || localChange?.entity_table,
            conflict.entity_uuid || localChange?.entity_uuid,
            localPayload,
            conflict.remote_payload || conflict.payload || {}
          )
          if (conflict.change_id) conflictChangeIds.push(conflict.change_id)
        }
        this.dbService.markSyncChangesConflict(conflictChangeIds)
      }
      return { pushed: acceptedIds.length }
    } catch (err) {
      console.error('[SyncService] push offline:', err.message)
      return { pushed: 0, error: err.message }
    }
  }

  async pullAndApplyChanges() {
    if (!this._registered) return
    const cursor = this.dbService.getSyncCursor('global') || '0'
    const body = { device_id: this.deviceId, cursor, limit: 100 }
    try {
      const res = await fetch(`${this.syncServerUrl}/sync/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      if (!res.ok) {
        console.error('[SyncService] pull failed:', res.status)
        return { pulled: 0, error: `HTTP ${res.status}` }
      }
      const data = await res.json()
      const changes = data.changes || []
      const ordered = this._orderChanges(changes)
      const deferred = []
      let maxCursor = cursor
      for (const change of ordered) {
        const result = this.applyRemoteChange(change)
        if (result && result.deferred) {
          deferred.push(change)
        } else if (change.server_change_id) {
          maxCursor = this._maxCursor(maxCursor, String(change.server_change_id))
        }
      }
      // Retry deferred changes once after their parents have been applied
      for (const change of deferred) {
        const result = this.applyRemoteChange(change)
        if (!result || result.deferred) {
          console.warn('[SyncService] deferred change still unapplied:', change.entity_table, change.entity_uuid)
        } else if (change.server_change_id) {
          maxCursor = this._maxCursor(maxCursor, String(change.server_change_id))
        }
      }
      const nextCursor = String(data.cursor ?? data.next_cursor ?? maxCursor)
      this.dbService.setSyncCursor('global', nextCursor)
      return { pulled: changes.length }
    } catch (err) {
      console.error('[SyncService] pull offline:', err.message)
      return { pulled: 0, error: err.message }
    }
  }

  applyRemoteChange(change) {
    if (!change) return { success: false, error: 'empty change' }
    try {
      const payload = change.payload_json && typeof change.payload_json === 'string'
        ? JSON.parse(change.payload_json)
        : change.payload_json
      return this.dbService.applyRemoteChange(
        change.entity_table,
        change.entity_uuid,
        change.operation,
        payload,
        change.server_version,
        change.last_modified_at
      )
    } catch (err) {
      console.error('[SyncService] applyRemoteChange error:', err.message, change)
      return { success: false, error: err.message }
    }
  }

  _maxCursor(a, b) {
    const na = Number(a)
    const nb = Number(b)
    if (Number.isNaN(na)) return b
    if (Number.isNaN(nb)) return a
    return String(Math.max(na, nb))
  }

  _orderChanges(changes) {
    const index = (table) => {
      const i = ENTITY_ORDER.indexOf(table)
      return i === -1 ? 999 : i
    }
    return [...changes].sort((a, b) => index(a.entity_table) - index(b.entity_table))
  }

  stop() {
    if (this._pushDebounceTimer) clearTimeout(this._pushDebounceTimer)
    if (this._intervalHandle) clearInterval(this._intervalHandle)
  }
}

function initSyncService(dbService, syncServerUrl) {
  if (!syncServerUrl) {
    console.log('[SyncService] No sync server URL configured, skipping sync')
    return null
  }
  const service = new SyncService(dbService, syncServerUrl)
  service.init().catch(err => {
    console.error('[SyncService] init failed:', err.message)
  })
  return service
}

module.exports = { SyncService, initSyncService }
