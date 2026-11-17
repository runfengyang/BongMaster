const Database = require('better-sqlite3')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { v4: uuidv4, v5: uuidv5 } = require('uuid')
const SYNC_UUID_NAMESPACE = 'DA7E25A2-8A3F-43D3-93E0-725F92AFD087'
const SYNC_DEVICE_NAME = 'BongMaster Desktop'
const SYNC_DEVICE_PLATFORM = 'electron'
const archiver = require('archiver')
const extractZip = require('extract-zip')
const { parseISO, isValid, getISODay, getDate, isWeekend } = require('date-fns')

// 路径安全工具：校验 filePath 是否严格位于 baseDir 内部
function isPathInside(filePath, baseDir) {
  const resolvedFile = path.resolve(filePath)
  const resolvedBase = path.resolve(baseDir)
  return resolvedFile === resolvedBase || resolvedFile.startsWith(resolvedBase + path.sep)
}

// 净化文件名，防止路径遍历
function sanitizeFilename(name) {
  return path.basename(String(name || '')).replace(/[\\/]/g, '_')
}

// 便签正文哈希：patchDesktopNote 的乐观并发校验用（非加密用途，仅比对内容是否被改过）
function hashNoteContent(content) {
  return crypto.createHash('sha256').update(String(content ?? ''), 'utf8').digest('hex')
}

// 统计 find 在 text 中不重叠出现的次数（与 split 的切分口径一致）
function countOccurrences(text, find) {
  let count = 0
  let index = text.indexOf(find)
  while (index !== -1) {
    count += 1
    index = text.indexOf(find, index + find.length)
  }
  return count
}

// 只替换第 occurrence 次（从 1 开始）出现，其余出现保持原样
function replaceNthOccurrence(text, find, occurrence, replace) {
  let index = -1
  let from = 0
  for (let i = 0; i < occurrence; i += 1) {
    index = text.indexOf(find, from)
    from = index + find.length
  }
  return text.slice(0, index) + replace + text.slice(index + find.length)
}

// restoreEntities 允许的表白名单（表名会拼进 SQL，必须白名单）。
const RESTORABLE_TABLES = new Set([
  'projects',
  'tasks',
  'daily_tasks',
  'daily_task_subtasks',
  'project_documents',
  'desktop_notes'
])

// 新关联每日任务/重复规则时允许的项目状态
const ACTIVE_PROJECT_STATUSES = ['未开始', '进行中']

class DatabaseService {
  constructor(dbPath, uploadsDir) {
    this.dbPath = dbPath
    this.uploadsDir = uploadsDir
    this.imagesDir = path.join(path.dirname(uploadsDir), 'images')
    this.importInProgress = false
  }

  initialize() {
    this.migrateFromOldApp()
    this.db = new Database(this.dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.runMigrations()
  }

  migrateFromOldApp() {
    try {
      const oldDataDir = path.join(require('os').homedir(), 'Library/Application Support/BongMaster')
      const oldDbPath = path.join(oldDataDir, 'database.db')
      const oldUploadsDir = path.join(oldDataDir, 'uploads')

      if (!fs.existsSync(this.dbPath) && fs.existsSync(oldDbPath)) {
        console.error('[Migration] Found old BongMaster data, migrating...')
        fs.copyFileSync(oldDbPath, this.dbPath)

        if (fs.existsSync(oldUploadsDir)) {
          fs.cpSync(oldUploadsDir, this.uploadsDir, { recursive: true })
        }

        console.error('[Migration] Migration completed successfully')
      }
    } catch (err) {
      console.error('[Migration] Migration failed:', err)
    }
  }

  _tempPath(basePath, label) {
    return `${basePath}.${label}.${process.pid}.${Date.now()}.${uuidv4()}`
  }

  _removePath(targetPath) {
    if (targetPath && fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { recursive: true, force: true })
    }
  }

  _renameReplacing(sourcePath, targetPath) {
    if (!sourcePath || !fs.existsSync(sourcePath)) return
    this._removePath(targetPath)
    fs.renameSync(sourcePath, targetPath)
  }

  async _extractZipSafe(inputPath, extractDir) {
    await extractZip(inputPath, {
      dir: extractDir,
      onEntry: (entry) => {
        const targetPath = path.resolve(extractDir, entry.fileName)
        if (!isPathInside(targetPath, extractDir)) {
          throw new Error('备份文件包含非法路径，导入已中止')
        }
      }
    })
  }

  _findFileInDir(baseDir, filename) {
    if (!baseDir || !filename || !fs.existsSync(baseDir)) return null
    const targetName = sanitizeFilename(filename)
    const stack = [baseDir]
    while (stack.length > 0) {
      const current = stack.pop()
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const entryPath = path.join(current, entry.name)
        if (!isPathInside(entryPath, baseDir)) continue
        if (entry.isDirectory()) {
          stack.push(entryPath)
        } else if (entry.name === targetName) {
          return entryPath
        }
      }
    }
    return null
  }

  _copyImportedFile(sourcePath, sourceBaseDir, projectId, filename) {
    if (!sourcePath || !fs.existsSync(sourcePath)) return sanitizeFilename(filename)
    if (!isPathInside(sourcePath, sourceBaseDir)) {
      throw new Error('备份附件路径非法，导入已中止')
    }
    const dir = this._ensureUploadDir(projectId)
    const ext = path.extname(filename)
    const base = path.basename(filename, ext)
    let destName = sanitizeFilename(filename)
    let destPath = path.join(dir, destName)
    while (fs.existsSync(destPath)) {
      destName = `${base}_${uuidv4()}${ext}`
      destPath = path.join(dir, destName)
    }
    if (!isPathInside(destPath, this.uploadsDir)) {
      throw new Error('目标附件路径非法，导入已中止')
    }
    fs.copyFileSync(sourcePath, destPath)
    return destName
  }

  ensureColumn(tableName, columnName, definition) {
    const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all()
    if (!columns.some(col => col.name === columnName)) {
      this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`)
    }
  }

  runMigrations() {
    // 项目表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT '未开始',
        priority TEXT DEFAULT '中',
        start_date DATE,
        due_date DATE,
        is_ongoing BOOLEAN DEFAULT 0,
        overview TEXT,
        progress TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // 迁移：添加 is_ongoing 列到已存在的表
    try {
      this.db.exec(`ALTER TABLE projects ADD COLUMN is_ongoing BOOLEAN DEFAULT 0`)
    } catch (err) {
      // 列已存在时会报错，忽略错误
      if (!err.message.includes('duplicate column')) {
        console.warn('[DatabaseService] Migration warning:', err.message)
      }
    }

    // 任务表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        estimated_minutes INTEGER DEFAULT 0,
        time_spent_minutes INTEGER DEFAULT 0,
        status TEXT DEFAULT '待办',
        priority TEXT DEFAULT '中',
        assignee TEXT,
        due_date DATE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )
    `)
    this.ensureColumn('tasks', 'estimated_minutes', 'INTEGER DEFAULT 0')
    this.ensureColumn('tasks', 'time_spent_minutes', 'INTEGER DEFAULT 0')
    this.ensureColumn('tasks', 'description', "TEXT DEFAULT ''")
    this.ensureColumn('tasks', 'tags', "TEXT DEFAULT ''")
    this.ensureColumn('tasks', 'sort_order', 'INTEGER DEFAULT 0')
    this.ensureColumn('tasks', 'is_archived', 'BOOLEAN DEFAULT 0')
    this.ensureColumn('tasks', 'completed_at', 'DATETIME')

    // 每日任务表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS daily_tasks (
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // 兼容旧数据库：逐个添加缺失列
    this.ensureColumn('daily_tasks', 'tags', "TEXT DEFAULT ''")
    this.ensureColumn('daily_tasks', 'notes', "TEXT DEFAULT ''")
    this.ensureColumn('daily_tasks', 'completed_at', 'DATETIME')
    this.ensureColumn('daily_tasks', 'updated_at', 'DATETIME')
    this.ensureColumn('daily_tasks', 'repeat_rule_id', 'INTEGER')
    // 关联项目（可空）：不建外键，项目是软删除，物理删除时才该级联
    this.ensureColumn('daily_tasks', 'project_id', 'INTEGER')
    this.db.prepare(`
      UPDATE daily_tasks
      SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
      WHERE updated_at IS NULL
    `).run()

    // 每日任务子任务表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS daily_task_subtasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        daily_task_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        is_completed BOOLEAN DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (daily_task_id) REFERENCES daily_tasks(id) ON DELETE CASCADE
      )
    `)

    // 每日任务重复规则表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS daily_task_repeat_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        priority TEXT DEFAULT '中',
        estimated_minutes INTEGER DEFAULT 0,
        tags TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        repeat_type TEXT NOT NULL,
        repeat_value TEXT DEFAULT '',
        start_date DATE NOT NULL,
        end_date DATE,
        is_active BOOLEAN DEFAULT 1,
        wait_for_completion BOOLEAN DEFAULT 0,
        skip_overdue BOOLEAN DEFAULT 1,
        repeat_from_completion BOOLEAN DEFAULT 0,
        last_generated_date DATE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)

    this.ensureColumn('daily_task_repeat_rules', 'wait_for_completion', 'BOOLEAN DEFAULT 0')
    this.ensureColumn('daily_task_repeat_rules', 'skip_overdue', 'BOOLEAN DEFAULT 1')
    this.ensureColumn('daily_task_repeat_rules', 'repeat_from_completion', 'BOOLEAN DEFAULT 0')
    this.ensureColumn('daily_task_repeat_rules', 'project_id', 'INTEGER')

    // 项目附件表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS project_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        filename TEXT NOT NULL,
        original_filename TEXT NOT NULL,
        file_size INTEGER DEFAULT 0,
        mime_type TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )
    `)

    // 任务完成历史记录（用于趋势图和热力图）
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_completions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL,
        project_id INTEGER NOT NULL,
        completed_date DATE NOT NULL,
        completion_time_minutes INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )
    `)

    // 习惯表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS habits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        color TEXT DEFAULT '#10b981',
        icon TEXT DEFAULT 'fa-fire',
        sort_order INTEGER DEFAULT 0,
        is_archived BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // 习惯打卡表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS habit_checkins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        habit_id INTEGER NOT NULL,
        checkin_date DATE NOT NULL,
        level INTEGER DEFAULT 1,
        note TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE,
        UNIQUE(habit_id, checkin_date)
      )
    `)

    // 桌面便签表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS desktop_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        content TEXT NOT NULL,
        width INTEGER DEFAULT 250,
        height INTEGER DEFAULT 200,
        pos_x INTEGER DEFAULT 0,
        pos_y INTEGER DEFAULT 0,
        is_pinned BOOLEAN DEFAULT 0,
        is_minimized BOOLEAN DEFAULT 0,
        is_archived BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
    this.ensureColumn('desktop_notes', 'is_archived', 'BOOLEAN DEFAULT 0')

    // 迁移：添加 category 列到 desktop_notes 表
    try {
      this.db.exec(`ALTER TABLE desktop_notes ADD COLUMN category TEXT DEFAULT ''`)
    } catch (err) {
      // 列已存在时会报错，忽略错误
      if (!err.message.includes('duplicate column')) {
        console.warn('[DatabaseService] Migration warning:', err.message)
      }
    }

    // 分类表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // Apple Notes 同步映射
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS apple_note_links (
        note_id INTEGER PRIMARY KEY,
        apple_note_id TEXT NOT NULL,
        apple_note_title TEXT,
        last_synced_at DATETIME,
        last_synced_hash TEXT,
        last_synced_apple_hash TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (note_id) REFERENCES desktop_notes(id) ON DELETE CASCADE
      )
    `)

    // 便签与项目的多对多关联
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS note_project_links (
        note_id INTEGER NOT NULL,
        project_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (note_id, project_id),
        FOREIGN KEY (note_id) REFERENCES desktop_notes(id) ON DELETE CASCADE,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )
    `)

    // 任务表扩展列（Phase 4）

    // 任务保存视图（Phase 4）
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_views (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        view_type TEXT DEFAULT 'board',
        group_by TEXT DEFAULT 'status',
        filters_json TEXT DEFAULT '{}',
        sort_json TEXT DEFAULT '[]',
        visible_fields_json TEXT DEFAULT '[]',
        sort_order INTEGER DEFAULT 0,
        is_builtin BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // Balatro 游戏存档（key-value，主键 'main'）
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS balatro_state (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `)

    // 迁移：将现有的已完成任务导入到 task_completions 表
    this._migrateCompletedTasks()
    // 增量同步：添加 sync metadata、系统表、UUID backfill（Worker 6）
    this._initializeSyncMetadata()
  }

  // 迁移现有的已完成任务到完成记录表
  _migrateCompletedTasks() {
    try {
      // 检查是否已经有记录
      const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM task_completions')
      const { count } = countStmt.get()

      if (count === 0) {
        console.error('[Migration] Migrating completed tasks to task_completions...')

        // 获取所有已完成的任务
        const tasksStmt = this.db.prepare(`
          SELECT id, project_id, updated_at
          FROM tasks
          WHERE status = '已完成'
        `)
        const completedTasks = tasksStmt.all()

        const migrate = this.db.transaction((tasks) => {
          let migratedCount = 0
          for (const task of tasks) {
            const result = this._recordTaskCompletionForDate(
              task.id,
              task.project_id,
              task.updated_at || new Date().toISOString(),
              null
            )
            if (result.changes > 0) migratedCount++
          }
          return migratedCount
        })
        const migratedCount = migrate(completedTasks)

        console.error(`[Migration] Migrated ${migratedCount} completed tasks`)
      }
    } catch (err) {
      console.error('[Migration] Failed to migrate completed tasks:', err.message)
    }
  }

  // ===== Sync 元数据与变更日志（增量，不影响 IPC 契约）=====

  _initializeSyncMetadata() {
    try {
      this._ensureSyncMetadataColumns()
      this._createSyncSystemTables()
      this._getDeviceId()
      this._backfillUUIDs()
      this._markExistingRowsDirty()
    } catch (err) {
      console.error('[Sync] Failed to initialize sync metadata:', err)
    }
  }

  _ensureSyncMetadataColumns() {
    const syncTables = [
      'projects', 'tasks', 'daily_tasks', 'daily_task_subtasks',
      'daily_task_repeat_rules', 'project_documents', 'habits',
      'habit_checkins', 'desktop_notes', 'note_project_links',
      'categories', 'task_views'
    ]
    for (const table of syncTables) {
      this.ensureColumn(table, 'uuid', 'TEXT')
      this.ensureColumn(table, 'created_device_id', 'TEXT')
      this.ensureColumn(table, 'updated_device_id', 'TEXT')
      this.ensureColumn(table, 'sync_version', 'INTEGER DEFAULT 1')
      this.ensureColumn(table, 'last_modified_at', 'TEXT')
      this.ensureColumn(table, 'deleted_at', 'TEXT')
      this.ensureColumn(table, 'sync_state', "TEXT DEFAULT 'clean'")
      try {
        this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${table}_uuid ON ${table}(uuid)`)
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_deleted_state ON ${table}(deleted_at, sync_state)`)
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_modified ON ${table}(last_modified_at)`)
      } catch (err) {
        console.warn(`[Sync] Index warning for ${table}:`, err.message)
      }
    }
  }

  _createSyncSystemTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        change_id TEXT UNIQUE NOT NULL,
        entity_table TEXT NOT NULL,
        entity_uuid TEXT NOT NULL,
        operation TEXT NOT NULL,
        payload_json TEXT,
        base_version INTEGER,
        local_version INTEGER NOT NULL,
        device_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        synced_at TEXT,
        status TEXT DEFAULT 'pending'
      )
    `)
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_sync_changes_pending ON sync_changes(status, entity_table, entity_uuid)`)
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_sync_changes_created ON sync_changes(created_at)`)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_cursors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT UNIQUE NOT NULL,
        cursor TEXT,
        updated_at TEXT NOT NULL
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_conflicts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_table TEXT NOT NULL,
        entity_uuid TEXT NOT NULL,
        local_payload_json TEXT NOT NULL,
        remote_payload_json TEXT NOT NULL,
        resolution TEXT,
        merged_payload_json TEXT,
        created_at TEXT NOT NULL,
        resolved_at TEXT
      )
    `)
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_sync_conflicts_entity ON sync_conflicts(entity_table, entity_uuid, resolution)`)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_devices (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        platform TEXT NOT NULL,
        public_key TEXT,
        last_seen_at TEXT,
        created_at TEXT NOT NULL
      )
    `)
  }

  _getDeviceId() {
    if (this._deviceId) return this._deviceId
    const existing = this.db.prepare("SELECT id FROM sync_devices WHERE platform = 'electron' LIMIT 1").get()
    if (existing) {
      this._deviceId = existing.id
      return this._deviceId
    }
    const id = uuidv4()
    const now = new Date().toISOString()
    this.db.prepare(`
      INSERT INTO sync_devices (id, name, platform, public_key, last_seen_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, SYNC_DEVICE_NAME, SYNC_DEVICE_PLATFORM, null, now, now)
    this._deviceId = id
    return id
  }

  setSyncChangeCallback(callback) {
    this._syncChangeCallback = callback
  }

  _backfillUUIDs() {
    const deviceId = this._getDeviceId()
    const tables = [
      'projects', 'tasks', 'daily_tasks', 'daily_task_subtasks',
      'daily_task_repeat_rules', 'project_documents', 'habits',
      'habit_checkins', 'desktop_notes', 'categories', 'task_views'
    ]
    const backfill = this.db.transaction((tableList) => {
      for (const table of tableList) {
        const rows = this.db.prepare(`SELECT id FROM ${table} WHERE uuid IS NULL`).all()
        for (const row of rows) {
          const uuid = uuidv5(`${table}:${row.id}`, SYNC_UUID_NAMESPACE)
          this.db.prepare(`UPDATE ${table} SET uuid = ?, created_device_id = COALESCE(created_device_id, ?), updated_device_id = COALESCE(updated_device_id, ?) WHERE id = ?`).run(uuid, deviceId, deviceId, row.id)
        }
      }
      // Link table uses composite key
      const links = this.db.prepare('SELECT note_id, project_id FROM note_project_links WHERE uuid IS NULL').all()
      for (const link of links) {
        const uuid = uuidv5(`note_project_links:${link.note_id}:${link.project_id}`, SYNC_UUID_NAMESPACE)
        this.db.prepare('UPDATE note_project_links SET uuid = ?, created_device_id = COALESCE(created_device_id, ?), updated_device_id = COALESCE(updated_device_id, ?) WHERE note_id = ? AND project_id = ?').run(uuid, deviceId, deviceId, link.note_id, link.project_id)
      }
    })
    backfill(tables)
  }

  _markExistingRowsDirty() {
    const deviceId = this._getDeviceId()
    const tables = [
      'projects', 'tasks', 'daily_tasks', 'daily_task_subtasks',
      'daily_task_repeat_rules', 'project_documents', 'habits',
      'habit_checkins', 'desktop_notes', 'note_project_links',
      'categories', 'task_views'
    ]
    const mark = this.db.transaction((tableList) => {
      for (const table of tableList) {
        this.db.prepare(`UPDATE ${table} SET sync_state = 'dirty', sync_version = COALESCE(sync_version, 1), updated_device_id = COALESCE(updated_device_id, ?) WHERE sync_state = 'clean' OR sync_state IS NULL`).run(deviceId)
      }
    })
    mark(tables)
  }

  _getUUIDById(tableName, id) {
    const row = this.db.prepare(`SELECT uuid FROM ${tableName} WHERE id = ?`).get(id)
    return row ? row.uuid : null
  }

  _getIdByUUID(tableName, uuid) {
    const row = this.db.prepare(`SELECT id FROM ${tableName} WHERE uuid = ? AND deleted_at IS NULL LIMIT 1`).get(uuid)
    return row ? row.id : null
  }

  _getNoteProjectLinkIdsByUUID(uuid) {
    const row = this.db.prepare('SELECT note_id, project_id FROM note_project_links WHERE uuid = ? LIMIT 1').get(uuid)
    return row ? { note_id: row.note_id, project_id: row.project_id } : null
  }

  _getEntityById(tableName, id) {
    return this.db.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(id)
  }

  _ensureUUID(tableName, id) {
    const existing = this._getUUIDById(tableName, id)
    if (existing) return existing
    const uuid = uuidv4()
    const deviceId = this._getDeviceId()
    this.db.prepare(`UPDATE ${tableName} SET uuid = ?, created_device_id = COALESCE(created_device_id, ?), updated_device_id = ? WHERE id = ?`).run(uuid, deviceId, deviceId, id)
    return uuid
  }

  _finishCreate(tableName, id) {
    const deviceId = this._getDeviceId()
    const uuid = this._ensureUUID(tableName, id)
    const now = new Date().toISOString()
    this.db.prepare(`
      UPDATE ${tableName}
      SET sync_version = 1, sync_state = 'dirty', created_device_id = COALESCE(created_device_id, ?), updated_device_id = ?, last_modified_at = ?
      WHERE id = ?
    `).run(deviceId, deviceId, now, id)
    const row = this._getEntityById(tableName, id)
    const payload = this._buildUpsertPayload(tableName, row)
    return this._recordSyncChange(tableName, id, 'UPSERT', payload, 0, 1)
  }

  _finishUpdate(tableName, id) {
    const existing = this.db.prepare(`SELECT sync_version, sync_state FROM ${tableName} WHERE id = ?`).get(id)
    if (!existing) return null
    const baseVersion = existing.sync_version || 1
    const localVersion = baseVersion + 1
    const deviceId = this._getDeviceId()
    const now = new Date().toISOString()
    this.db.prepare(`
      UPDATE ${tableName}
      SET sync_version = ?, sync_state = 'dirty', updated_device_id = ?, last_modified_at = ?
      WHERE id = ?
    `).run(localVersion, deviceId, now, id)
    const row = this._getEntityById(tableName, id)
    const payload = this._buildUpsertPayload(tableName, row)
    return this._recordSyncChange(tableName, id, 'UPSERT', payload, baseVersion, localVersion)
  }

  _tombstoneEntity(tableName, id) {
    const deviceId = this._getDeviceId()
    const row = this.db.prepare(`SELECT sync_version, sync_state FROM ${tableName} WHERE id = ?`).get(id)
    if (!row) return null
    const baseVersion = row.sync_version || 1
    const localVersion = baseVersion + 1
    const now = new Date().toISOString()
    this.db.prepare(`
      UPDATE ${tableName}
      SET deleted_at = ?, sync_state = 'deleted', sync_version = ?, updated_device_id = ?, last_modified_at = ?
      WHERE id = ?
    `).run(now, localVersion, deviceId, now, id)
    return { baseVersion, localVersion }
  }

  _recordSyncChange(tableName, entityId, operation, payload, baseVersion, localVersion, entityUUID = null) {
    const uuid = entityUUID || this._getUUIDById(tableName, entityId)
    if (!uuid) return null
    const deviceId = this._getDeviceId()
    const now = new Date().toISOString()
    const changeId = uuidv4()
    this.db.prepare(`
      INSERT INTO sync_changes (change_id, entity_table, entity_uuid, operation, payload_json, base_version, local_version, device_id, created_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(changeId, tableName, uuid, operation, payload ? JSON.stringify(payload) : null, baseVersion, localVersion, deviceId, now)
    if (this._syncChangeCallback) {
      try {
        this._syncChangeCallback()
      } catch (err) {
        console.error('[Sync] change callback error:', err)
      }
    }
    return changeId
  }

  _recordDeleteSyncChange(tableName, entityId, entityUUID = null) {
    const dirty = this._tombstoneEntity(tableName, entityId)
    if (!dirty) return null
    return this._recordSyncChange(tableName, entityId, 'DELETE', null, dirty.baseVersion, dirty.localVersion, entityUUID)
  }

  _buildUpsertPayload(tableName, row) {
    const payload = { ...row }
    delete payload.id
    switch (tableName) {
      case 'tasks':
        payload.project_uuid = this._getUUIDById('projects', row.project_id)
        break
      case 'daily_tasks':
        if (row.repeat_rule_id) {
          payload.repeat_rule_uuid = this._getUUIDById('daily_task_repeat_rules', row.repeat_rule_id)
        }
        break
      case 'daily_task_subtasks':
        payload.daily_task_uuid = this._getUUIDById('daily_tasks', row.daily_task_id)
        break
      case 'project_documents':
        payload.project_uuid = this._getUUIDById('projects', row.project_id)
        break
      case 'habit_checkins':
        payload.habit_uuid = this._getUUIDById('habits', row.habit_id)
        break
      case 'note_project_links':
        payload.note_uuid = this._getUUIDById('desktop_notes', row.note_id)
        payload.project_uuid = this._getUUIDById('projects', row.project_id)
        break
    }
    return payload
  }

  _getNoteProjectLinkUUID(noteId, projectId) {
    const row = this.db.prepare('SELECT uuid FROM note_project_links WHERE note_id = ? AND project_id = ?').get(noteId, projectId)
    return row ? row.uuid : null
  }

  _finishCreateNoteProjectLink(noteId, projectId) {
    const uuid = this._ensureNoteProjectLinkUUID(noteId, projectId)
    const deviceId = this._getDeviceId()
    const now = new Date().toISOString()
    this.db.prepare(`
      UPDATE note_project_links
      SET sync_version = 1, sync_state = 'dirty', created_device_id = COALESCE(created_device_id, ?), updated_device_id = ?, last_modified_at = ?, deleted_at = NULL
      WHERE note_id = ? AND project_id = ?
    `).run(deviceId, deviceId, now, noteId, projectId)
    const row = this.db.prepare('SELECT * FROM note_project_links WHERE note_id = ? AND project_id = ?').get(noteId, projectId)
    const payload = this._buildUpsertPayload('note_project_links', row)
    return this._recordSyncChange('note_project_links', null, 'UPSERT', payload, 0, 1, uuid)
  }

  _ensureNoteProjectLinkUUID(noteId, projectId) {
    const existing = this._getNoteProjectLinkUUID(noteId, projectId)
    if (existing) return existing
    const uuid = uuidv4()
    const deviceId = this._getDeviceId()
    this.db.prepare(`
      UPDATE note_project_links
      SET uuid = ?, created_device_id = COALESCE(created_device_id, ?), updated_device_id = ?
      WHERE note_id = ? AND project_id = ?
    `).run(uuid, deviceId, deviceId, noteId, projectId)
    return uuid
  }

  _recordDeleteNoteProjectLink(noteId, projectId) {
    const uuid = this._getNoteProjectLinkUUID(noteId, projectId)
    const deviceId = this._getDeviceId()
    const now = new Date().toISOString()
    this.db.prepare(`
      UPDATE note_project_links
      SET deleted_at = ?, sync_state = 'deleted', sync_version = COALESCE(sync_version, 1) + 1, updated_device_id = ?, last_modified_at = ?
      WHERE note_id = ? AND project_id = ?
    `).run(now, deviceId, now, noteId, projectId)
    const row = this.db.prepare('SELECT sync_version FROM note_project_links WHERE note_id = ? AND project_id = ?').get(noteId, projectId)
    const localVersion = row ? row.sync_version : 1
    const baseVersion = localVersion - 1
    return this._recordSyncChange('note_project_links', null, 'DELETE', null, baseVersion, localVersion, uuid)
  }

  applyRemoteChange(entityTable, entityUUID, operation, payload, serverVersion, lastModifiedAt) {
    const tableName = entityTable
    if (operation === 'DELETE') {
      return this._applyRemoteDelete(tableName, entityUUID, serverVersion, lastModifiedAt)
    }
    return this._applyRemoteUpsert(tableName, entityUUID, payload, serverVersion, lastModifiedAt)
  }

  _applyRemoteUpsert(tableName, entityUUID, payload, serverVersion, lastModifiedAt) {
    const deviceId = this._getDeviceId()
    const now = new Date().toISOString()
    const fields = this._getPayloadFieldsForUpsert(tableName, payload)

    // note_project_links has a composite primary key, so it needs special handling
    if (tableName === 'note_project_links') {
      const linkIds = this._getNoteProjectLinkIdsByUUID(entityUUID)
      const note_id = linkIds ? linkIds.note_id : (fields.note_id || null)
      const project_id = linkIds ? linkIds.project_id : (fields.project_id || null)
      if (note_id == null || project_id == null) {
        return { success: false, deferred: true }
      }
      const row = this.db.prepare('SELECT * FROM note_project_links WHERE note_id = ? AND project_id = ?').get(note_id, project_id)
      const createdAt = fields.created_at || (row ? row.created_at : now) || now
      if (row) {
        this.db.prepare('UPDATE note_project_links SET created_at = ? WHERE note_id = ? AND project_id = ?').run(createdAt, note_id, project_id)
      } else {
        this.db.prepare('INSERT INTO note_project_links (note_id, project_id, created_at) VALUES (?, ?, ?)').run(note_id, project_id, createdAt)
      }
      this.db.prepare(`
        UPDATE note_project_links
        SET uuid = ?, sync_state = 'clean', sync_version = ?, updated_device_id = ?, last_modified_at = ?, deleted_at = NULL
        WHERE note_id = ? AND project_id = ?
      `).run(entityUUID, serverVersion, deviceId, lastModifiedAt || now, note_id, project_id)
      return { success: true }
    }

    const localId = this._getIdByUUID(tableName, entityUUID)
    const keys = Object.keys(fields)

    if (localId) {
      const sets = keys.map(key => `${key} = ?`).join(', ')
      const values = [...Object.values(fields), localId]
      this.db.prepare(`UPDATE ${tableName} SET ${sets} WHERE id = ?`).run(...values)
    } else {
      const placeholders = keys.map(() => '?').join(',')
      this.db.prepare(`INSERT INTO ${tableName} (${keys.join(',')}) VALUES (${placeholders})`).run(...Object.values(fields))
    }

    const id = localId || this._getIdByUUID(tableName, entityUUID)
    this.db.prepare(`
      UPDATE ${tableName}
      SET uuid = ?, sync_state = 'clean', sync_version = ?, updated_device_id = ?, last_modified_at = ?
      WHERE id = ?
    `).run(entityUUID, serverVersion, deviceId, lastModifiedAt || now, id)

    if (tableName === 'tasks') {
      const task = this._getEntityById('tasks', id)
      this._deriveTaskCompletionOnRemoteTask(id, task.project_id, task.status, task.completed_at)
    }
    return { success: true }
  }

  _getPayloadFieldsForUpsert(tableName, payload) {
    const fields = { ...payload }
    delete fields.uuid
    delete fields.id
    switch (tableName) {
      case 'tasks':
        if (fields.project_uuid) {
          fields.project_id = this._getIdByUUID('projects', fields.project_uuid)
          delete fields.project_uuid
        }
        break
      case 'daily_tasks':
        if (fields.repeat_rule_uuid) {
          fields.repeat_rule_id = this._getIdByUUID('daily_task_repeat_rules', fields.repeat_rule_uuid)
          delete fields.repeat_rule_uuid
        }
        break
      case 'daily_task_subtasks':
        if (fields.daily_task_uuid) {
          fields.daily_task_id = this._getIdByUUID('daily_tasks', fields.daily_task_uuid)
          delete fields.daily_task_uuid
        }
        break
      case 'project_documents':
        if (fields.project_uuid) {
          fields.project_id = this._getIdByUUID('projects', fields.project_uuid)
          delete fields.project_uuid
        }
        break
      case 'habit_checkins':
        if (fields.habit_uuid) {
          fields.habit_id = this._getIdByUUID('habits', fields.habit_uuid)
          delete fields.habit_uuid
        }
        break
      case 'note_project_links':
        if (fields.note_uuid && fields.project_uuid) {
          fields.note_id = this._getIdByUUID('desktop_notes', fields.note_uuid)
          fields.project_id = this._getIdByUUID('projects', fields.project_uuid)
          delete fields.note_uuid
          delete fields.project_uuid
        }
        break
    }
    return fields
  }

  _applyRemoteDelete(tableName, entityUUID, serverVersion, lastModifiedAt) {
    const deviceId = this._getDeviceId()
    const now = new Date().toISOString()

    // note_project_links has a composite primary key
    if (tableName === 'note_project_links') {
      const linkIds = this._getNoteProjectLinkIdsByUUID(entityUUID)
      if (!linkIds) return { success: true, noop: true }
      this.db.prepare(`
        UPDATE note_project_links
        SET deleted_at = ?, sync_state = 'deleted', sync_version = ?, updated_device_id = ?, last_modified_at = ?
        WHERE note_id = ? AND project_id = ?
      `).run(now, serverVersion, deviceId, lastModifiedAt || now, linkIds.note_id, linkIds.project_id)
      return { success: true }
    }

    const localId = this._getIdByUUID(tableName, entityUUID)
    if (!localId) return { success: true, noop: true }
    this.db.prepare(`
      UPDATE ${tableName}
      SET deleted_at = ?, sync_state = 'deleted', sync_version = ?, updated_device_id = ?, last_modified_at = ?
      WHERE id = ?
    `).run(now, serverVersion, deviceId, lastModifiedAt || now, localId)
    return { success: true }
  }

  _deriveTaskCompletionOnRemoteTask(taskId, projectId, status, completedAt) {
    if (status === '已完成') {
      this._recordTaskCompletionForDate(taskId, projectId, completedAt || new Date().toISOString(), null)
    } else {
      this.db.prepare(`
        DELETE FROM task_completions WHERE task_id = ? AND completed_date = ?
      `).run(taskId, (completedAt || new Date().toISOString()).slice(0, 10))
    }
  }

  getSyncChangesPending(limit = 100) {
    const stmt = this.db.prepare(`
      SELECT * FROM sync_changes
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT ?
    `)
    return stmt.all(limit)
  }

  markSyncChangesAccepted(changeIds) {
    const now = new Date().toISOString()
    const stmt = this.db.prepare(`
      UPDATE sync_changes SET status = 'accepted', synced_at = ? WHERE change_id = ?
    `)
    const tx = this.db.transaction((ids) => {
      for (const id of ids) stmt.run(now, id)
    })
    tx(changeIds)
  }

  markSyncChangesConflict(changeIds) {
    const stmt = this.db.prepare(`
      UPDATE sync_changes SET status = 'conflict' WHERE change_id = ?
    `)
    const tx = this.db.transaction((ids) => {
      for (const id of ids) stmt.run(id)
    })
    tx(changeIds)
  }

  getSyncCursor(scope) {
    const row = this.db.prepare('SELECT cursor FROM sync_cursors WHERE scope = ?').get(scope)
    return row ? row.cursor : null
  }

  setSyncCursor(scope, cursor) {
    const now = new Date().toISOString()
    const existing = this.db.prepare('SELECT id FROM sync_cursors WHERE scope = ?').get(scope)
    if (existing) {
      this.db.prepare('UPDATE sync_cursors SET cursor = ?, updated_at = ? WHERE scope = ?').run(cursor, now, scope)
    } else {
      this.db.prepare('INSERT INTO sync_cursors (scope, cursor, updated_at) VALUES (?, ?, ?)').run(scope, cursor, now)
    }
  }

  recordSyncConflict(entityTable, entityUUID, localPayload, remotePayload) {
    const now = new Date().toISOString()
    this.db.prepare(`
      INSERT INTO sync_conflicts (entity_table, entity_uuid, local_payload_json, remote_payload_json, resolution, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `).run(entityTable, entityUUID, JSON.stringify(localPayload), JSON.stringify(remotePayload), now)
  }

  getSyncConflicts() {
    return this.db.prepare('SELECT * FROM sync_conflicts WHERE resolution = ? ORDER BY created_at DESC').all('pending')
  }

  resolveSyncConflict(conflictId, resolution, mergedPayload) {
    const now = new Date().toISOString()
    this.db.prepare(`
      UPDATE sync_conflicts
      SET resolution = ?, merged_payload_json = ?, resolved_at = ?
      WHERE id = ?
    `).run(resolution, mergedPayload ? JSON.stringify(mergedPayload) : null, now, conflictId)
  }

  // ===== 删除撤回（取消 tombstone）=====
  //
  // 删除是软删除（写 deleted_at + 同步墓碑），行本身仍在库里，子行（子任务、
  // 附件、便签关联）也一并被标记。撤回就是把 deleted_at 清掉，因此能原样恢复
  // id 与全部关联；用 create 重新插入只会产生新 id 并把关联全部丢掉。

  restoreEntities(tableName, ids = []) {
    if (!RESTORABLE_TABLES.has(tableName)) {
      throw new Error(`不支持撤回的表: ${tableName}`)
    }
    const normalizedIds = [...new Set(
      (Array.isArray(ids) ? ids : [ids])
        .map(id => Number(id))
        .filter(id => Number.isInteger(id) && id > 0)
    )]
    if (normalizedIds.length === 0) return { restored: 0 }

    const stmt = this.db.prepare(`UPDATE ${tableName} SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL`)
    const restore = this.db.transaction((list) => {
      const changed = []
      for (const id of list) {
        if (stmt.run(id).changes > 0) changed.push(id)
      }
      return changed
    })
    const changedIds = restore(normalizedIds)
    // 只给真正恢复了的行打脏标记，重复撤回不会产生多余的同步变更。
    for (const id of changedIds) this._finishUpdate(tableName, id)
    return { restored: changedIds.length }
  }

  restoreNoteProjectLink(noteId, projectId) {
    const note = Number(noteId)
    const project = Number(projectId)
    if (!Number.isInteger(note) || !Number.isInteger(project)) return { success: false }
    const row = this.db.prepare('SELECT note_id FROM note_project_links WHERE note_id = ? AND project_id = ?').get(note, project)
    if (!row) return { success: false }
    this._finishCreateNoteProjectLink(note, project)
    return { success: true }
  }

  // ===== 项目操作 =====

  getAllProjects() {
    const stmt = this.db.prepare(`
      SELECT p.*, COUNT(t.id) as task_count
      FROM projects p
      LEFT JOIN tasks t ON p.id = t.project_id AND t.deleted_at IS NULL
      WHERE p.deleted_at IS NULL
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `)
    const projects = stmt.all()

    // 关联每日任务统计单独聚合，避免与 tasks 的 JOIN 产生笛卡尔积
    const dailyStmt = this.db.prepare(`
      SELECT
        project_id,
        COUNT(*) as daily_task_count,
        SUM(CASE WHEN is_completed = 1 THEN 1 ELSE 0 END) as daily_completed_count,
        SUM(CASE WHEN is_completed = 1 AND date(COALESCE(completed_at, date)) >= date('now', '-7 days')
                 THEN 1 ELSE 0 END) as daily_recent_completed_count,
        MAX(updated_at) as daily_last_updated_at
      FROM daily_tasks
      WHERE project_id IS NOT NULL AND deleted_at IS NULL
      GROUP BY project_id
    `)
    const dailyByProject = new Map(dailyStmt.all().map(row => [row.project_id, row]))

    for (const project of projects) {
      const daily = dailyByProject.get(project.id)
      project.daily_task_count = daily ? daily.daily_task_count : 0
      project.daily_completed_count = daily ? daily.daily_completed_count : 0
      project.daily_recent_completed_count = daily ? daily.daily_recent_completed_count : 0
      project.daily_last_updated_at = daily ? daily.daily_last_updated_at : null
    }

    return projects
  }

  getProjectById(id) {
    const projectStmt = this.db.prepare('SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL')
    const project = projectStmt.get(id)
    if (!project) return null

    const tasksStmt = this.db.prepare('SELECT * FROM tasks WHERE project_id = ? AND deleted_at IS NULL ORDER BY created_at DESC')
    project.tasks = tasksStmt.all(id)

    const docsStmt = this.db.prepare('SELECT * FROM project_documents WHERE project_id = ? AND deleted_at IS NULL ORDER BY created_at DESC')
    project.documents = docsStmt.all(id)

    project.notes = this.getDesktopNotesByProject(id)

    return project
  }

  createProject(data) {
    const stmt = this.db.prepare(`
      INSERT INTO projects (name, description, status, priority, start_date, due_date, is_ongoing, overview, progress)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const result = stmt.run(
      data.name,
      data.description || '',
      data.status || '未开始',
      data.priority || '中',
      data.start_date || null,
      data.due_date || null,
      data.is_ongoing ? 1 : 0,
      data.overview || '',
      data.progress || ''
    )
    this._finishCreate('projects', result.lastInsertRowid)
    return this.getProjectById(result.lastInsertRowid)
  }

  updateProject(id, data) {
    const existing = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id)
    if (!existing) return null

    const stmt = this.db.prepare(`
      UPDATE projects SET
        name = ?, description = ?, status = ?, priority = ?,
        start_date = ?, due_date = ?, is_ongoing = ?, overview = ?, progress = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    stmt.run(
      data.name ?? existing.name,
      data.description ?? existing.description ?? '',
      data.status ?? existing.status ?? '未开始',
      data.priority ?? existing.priority ?? '中',
      data.start_date ?? existing.start_date ?? null,
      data.due_date ?? existing.due_date ?? null,
      data.is_ongoing !== undefined ? (data.is_ongoing ? 1 : 0) : existing.is_ongoing ?? 0,
      data.overview ?? existing.overview ?? '',
      data.progress ?? existing.progress ?? '',
      id
    )
    this._finishUpdate('projects', id)
    return this.getProjectById(id)
  }

  deleteProject(id) {
    const project = this.db.prepare('SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL').get(id)
    if (!project) return { changes: 0 }

    const projectName = project.name
    const docs = this.db.prepare('SELECT * FROM project_documents WHERE project_id = ? AND deleted_at IS NULL').all(id)
    const tasks = this.db.prepare('SELECT * FROM tasks WHERE project_id = ? AND deleted_at IS NULL').all(id)
    const links = this.db.prepare('SELECT * FROM note_project_links WHERE project_id = ? AND deleted_at IS NULL').all(id)

    // Tombstone children first
    for (const task of tasks) this._recordDeleteSyncChange('tasks', task.id)
    for (const doc of docs) this._recordDeleteSyncChange('project_documents', doc.id)
    for (const link of links) this._recordDeleteNoteProjectLink(link.note_id, link.project_id)

    // Tombstone project
    this._recordDeleteSyncChange('projects', id)

    // Do NOT physically delete files; server ack tombstone will trigger cleanup
    return { changes: 1, projectName }
  }

  // ===== 任务操作 =====

  getAllTasks() {
    const stmt = this.db.prepare(`
      SELECT t.*, p.name as project_name
      FROM tasks t
      JOIN projects p ON t.project_id = p.id
      WHERE t.deleted_at IS NULL AND p.deleted_at IS NULL
      ORDER BY t.created_at DESC
    `)
    return stmt.all()
  }

  getTasksByProjectId(projectId) {
    const stmt = this.db.prepare('SELECT * FROM tasks WHERE project_id = ? AND deleted_at IS NULL ORDER BY created_at DESC')
    return stmt.all(projectId)
  }

  createTask(data) {
    const isCompleted = data.status === '已完成'
    const create = this.db.transaction(() => {
      const completedAt = isCompleted ? new Date().toISOString() : null
      const stmt = this.db.prepare(`
        INSERT INTO tasks (
          project_id, name, estimated_minutes, time_spent_minutes,
          status, priority, assignee, due_date,
          description, tags, sort_order, is_archived, completed_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const result = stmt.run(
        data.project_id,
        data.name,
        Number(data.estimated_minutes) || 0,
        Number(data.time_spent_minutes) || 0,
        data.status || '待办',
        data.priority || '中',
        data.assignee || '',
        data.due_date || null,
        data.description || '',
        Array.isArray(data.tags) ? data.tags.join(',') : (data.tags || ''),
        data.sort_order || 0,
        data.is_archived ? 1 : 0,
        completedAt
      )
      if (isCompleted) {
        this._recordTaskCompletionForDate(result.lastInsertRowid, data.project_id, completedAt, null)
      }
      return result.lastInsertRowid
    })
    const taskId = create()
    this._finishCreate('tasks', taskId)
    return this.getTaskById(taskId)
  }

  getTaskById(id) {
    const stmt = this.db.prepare(`
      SELECT t.*, p.name as project_name
      FROM tasks t
      JOIN projects p ON t.project_id = p.id
      WHERE t.id = ? AND t.deleted_at IS NULL AND p.deleted_at IS NULL
    `)
    return stmt.get(id)
  }

  updateTask(id, data) {
    const existing = this.getTaskById(id)
    if (!existing) return null

    const newStatus = data.status ?? existing.status ?? '待办'
    const wasCompleted = existing.status === '已完成'
    const nowCompleted = newStatus === '已完成'

    let completedAt = existing.completed_at
    if (nowCompleted && !wasCompleted) {
      completedAt = new Date().toISOString()
    } else if (!nowCompleted && wasCompleted) {
      completedAt = null
    }
    if (data.completed_at !== undefined) {
      completedAt = data.completed_at
    }

    const update = this.db.transaction(() => {
      const stmt = this.db.prepare(`
        UPDATE tasks SET
          name = ?, estimated_minutes = ?, time_spent_minutes = ?,
          status = ?, priority = ?, assignee = ?, due_date = ?,
          description = ?, tags = ?, sort_order = ?, is_archived = ?, completed_at = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      stmt.run(
        data.name ?? existing.name,
        data.estimated_minutes !== undefined ? (Number(data.estimated_minutes) || 0) : (existing.estimated_minutes ?? 0),
        data.time_spent_minutes !== undefined ? (Number(data.time_spent_minutes) || 0) : (existing.time_spent_minutes ?? 0),
        newStatus,
        data.priority ?? existing.priority ?? '中',
        data.assignee ?? existing.assignee ?? '',
        data.due_date ?? existing.due_date ?? null,
        data.description ?? existing.description ?? '',
        data.tags !== undefined
          ? (Array.isArray(data.tags) ? data.tags.join(',') : data.tags)
          : existing.tags || '',
        data.sort_order ?? existing.sort_order ?? 0,
        data.is_archived !== undefined ? (data.is_archived ? 1 : 0) : existing.is_archived ?? 0,
        completedAt,
        id
      )
      if (nowCompleted && !wasCompleted) {
        const createdAt = new Date(existing.created_at)
        const doneAt = new Date(completedAt)
        const completionTimeMinutes = Number.isNaN(createdAt.getTime())
          ? null
          : Math.max(0, Math.round((doneAt - createdAt) / (1000 * 60)))
        this._recordTaskCompletionForDate(id, existing.project_id, completedAt, completionTimeMinutes)
      }
    })
    update()
    this._finishUpdate('tasks', id)
    return this.getTaskById(id)
  }

  deleteTask(id) {
    return this._recordDeleteSyncChange('tasks', id)
  }

  // ===== 任务视图操作 =====

  getTaskViews() {
    const stmt = this.db.prepare(`
      SELECT * FROM task_views WHERE deleted_at IS NULL ORDER BY sort_order ASC, updated_at DESC
    `)
    return stmt.all().map(row => this._parseTaskView(row))
  }

  createTaskView(data) {
    const stmt = this.db.prepare(`
      INSERT INTO task_views (
        name, view_type, group_by, filters_json, sort_json,
        visible_fields_json, sort_order, is_builtin
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const result = stmt.run(
      data.name,
      data.view_type || 'board',
      data.group_by || 'status',
      this._stringifyJson(data.filters_json),
      this._stringifyJson(data.sort_json),
      this._stringifyJson(data.visible_fields_json),
      data.sort_order || 0,
      data.is_builtin ? 1 : 0
    )
    this._finishCreate('task_views', result.lastInsertRowid)
    return this.getTaskViewById(result.lastInsertRowid)
  }

  getTaskViewById(id) {
    const stmt = this.db.prepare('SELECT * FROM task_views WHERE id = ? AND deleted_at IS NULL')
    const row = stmt.get(id)
    return row ? this._parseTaskView(row) : null
  }

  updateTaskView(id, data) {
    const existing = this.getTaskViewById(id)
    if (!existing) return null

    const stmt = this.db.prepare(`
      UPDATE task_views SET
        name = ?, view_type = ?, group_by = ?, filters_json = ?,
        sort_json = ?, visible_fields_json = ?, sort_order = ?,
        is_builtin = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    stmt.run(
      data.name ?? existing.name,
      data.view_type ?? existing.view_type,
      data.group_by ?? existing.group_by,
      data.filters_json !== undefined ? this._stringifyJson(data.filters_json) : existing.filters_json,
      data.sort_json !== undefined ? this._stringifyJson(data.sort_json) : existing.sort_json,
      data.visible_fields_json !== undefined ? this._stringifyJson(data.visible_fields_json) : existing.visible_fields_json,
      data.sort_order ?? existing.sort_order,
      data.is_builtin !== undefined ? (data.is_builtin ? 1 : 0) : existing.is_builtin,
      id
    )
    this._finishUpdate('task_views', id)
    return this.getTaskViewById(id)
  }

  deleteTaskView(id) {
    return this._recordDeleteSyncChange('task_views', id)
  }

  _stringifyJson(value) {
    if (value === undefined || value === null) return '{}'
    if (typeof value === 'string') return value
    return JSON.stringify(value)
  }

  _parseTaskView(row) {
    return {
      ...row,
      filters_json: this._parseJson(row.filters_json, {}),
      sort_json: this._parseJson(row.sort_json, []),
      visible_fields_json: this._parseJson(row.visible_fields_json, [])
    }
  }

  _parseJson(value, defaultValue) {
    if (value === undefined || value === null || value === '') return defaultValue
    if (typeof value !== 'string') return value
    try {
      return JSON.parse(value)
    } catch {
      return defaultValue
    }
  }

  // ===== 任务完成统计操作 =====

  _recordTaskCompletionForDate(taskId, projectId, completedAt = new Date().toISOString(), completionTimeMinutes = null) {
    const completedDate = String(completedAt || '').slice(0, 10) || new Date().toISOString().slice(0, 10)
    const existing = this.db.prepare(`
      SELECT id FROM task_completions WHERE task_id = ? AND completed_date = ?
    `).get(taskId, completedDate)
    if (existing) {
      return { changes: 0, lastInsertRowid: existing.id }
    }
    const stmt = this.db.prepare(`
      INSERT INTO task_completions (task_id, project_id, completed_date, completion_time_minutes)
      VALUES (?, ?, ?, ?)
    `)
    return stmt.run(taskId, projectId, completedDate, completionTimeMinutes)
  }

  recordTaskCompletion(taskId, projectId, completionTimeMinutes = null) {
    return this._recordTaskCompletionForDate(taskId, projectId, new Date().toISOString(), completionTimeMinutes)
  }

  getTaskCompletionsByDateRange(startDate, endDate) {
    const stmt = this.db.prepare(`
      SELECT * FROM task_completions
      WHERE completed_date >= ? AND completed_date <= ?
      ORDER BY completed_date DESC
    `)
    return stmt.all(startDate, endDate)
  }

  getTaskCompletionStats(days = 30, options = {}) {
    const safeDays = Math.max(1, Math.min(Number.isInteger(days) ? days : parseInt(days, 10) || 30, 3650))
    const modifier = `-${safeDays} days`

    // 首先尝试从 task_completions 表获取
    const stmt = this.db.prepare(`
      SELECT completed_date, COUNT(*) as count
      FROM task_completions
      WHERE completed_date >= date('now', ?)
      GROUP BY completed_date
      ORDER BY completed_date
    `)
    let results = stmt.all(modifier)

    // 如果没有数据，尝试从 tasks 表的 updated_at 推断
    if (results.length === 0) {
      const fallbackStmt = this.db.prepare(`
        SELECT date(updated_at) as completed_date, COUNT(*) as count
        FROM tasks
        WHERE status = '已完成' AND updated_at >= datetime('now', ?)
        GROUP BY date(updated_at)
        ORDER BY completed_date
      `)
      results = fallbackStmt.all(modifier)
    }

    // 热力图口径：叠加每日任务完成数（每日任务不写入 task_completions）
    // 取完成日期优先 completed_at（旧数据缺失时退回任务日期 date），只算未软删除且已完成的父任务，子任务不重复计
    if (!options || !options.includeDailyTasks) {
      return results
    }

    const dailyStmt = this.db.prepare(`
      SELECT date(COALESCE(completed_at, date)) as completed_date, COUNT(*) as count
      FROM daily_tasks
      WHERE is_completed = 1 AND deleted_at IS NULL
        AND date(COALESCE(completed_at, date)) >= date('now', ?)
      GROUP BY completed_date
    `)

    const merged = new Map(results.map(row => [row.completed_date, row.count]))
    for (const row of dailyStmt.all(modifier)) {
      merged.set(row.completed_date, (merged.get(row.completed_date) || 0) + row.count)
    }

    return [...merged.entries()]
      .map(([completed_date, count]) => ({ completed_date, count }))
      .sort((a, b) => (a.completed_date < b.completed_date ? -1 : a.completed_date > b.completed_date ? 1 : 0))
  }

  getAverageCompletionTime(projectId = null) {
    // 首先尝试从 task_completions 表获取（包含准确的数据）
    let result
    if (projectId) {
      const stmt = this.db.prepare(`
        SELECT AVG(completion_time_minutes) as avg_minutes
        FROM task_completions
        WHERE project_id = ? AND completion_time_minutes IS NOT NULL
      `)
      result = stmt.get(projectId)
    } else {
      const stmt = this.db.prepare(`
        SELECT AVG(completion_time_minutes) as avg_minutes
        FROM task_completions
        WHERE completion_time_minutes IS NOT NULL
      `)
      result = stmt.get()
    }

    // 如果有数据，直接返回
    if (result && result.avg_minutes != null) {
      return result.avg_minutes
    }

    // 否则，从 tasks 表计算（使用 created_at 和 updated_at 的差值）
    if (projectId) {
      const fallbackStmt = this.db.prepare(`
        SELECT AVG((julianday(updated_at) - julianday(created_at)) * 24 * 60) as avg_minutes
        FROM tasks
        WHERE project_id = ? AND status = '已完成'
      `)
      const fallbackResult = fallbackStmt.get(projectId)
      return fallbackResult?.avg_minutes || 0
    } else {
      const fallbackStmt = this.db.prepare(`
        SELECT AVG((julianday(updated_at) - julianday(created_at)) * 24 * 60) as avg_minutes
        FROM tasks
        WHERE status = '已完成'
      `)
      const fallbackResult = fallbackStmt.get()
      return fallbackResult?.avg_minutes || 0
    }
  }

  getBusiestDays(days = 30) {
    const safeDays = Math.max(1, Math.min(Number.isInteger(days) ? days : parseInt(days, 10) || 30, 3650))
    const modifier = `-${safeDays} days`

    // 首先尝试从 task_completions 表获取
    const stmt = this.db.prepare(`
      SELECT completed_date, COUNT(*) as count
      FROM task_completions
      WHERE completed_date >= date('now', ?)
      GROUP BY completed_date
      ORDER BY count DESC
      LIMIT 5
    `)
    const results = stmt.all(modifier)

    // 如果没有数据，尝试从 tasks 表的 updated_at 推断
    if (results.length === 0) {
      const fallbackStmt = this.db.prepare(`
        SELECT date(updated_at) as completed_date, COUNT(*) as count
        FROM tasks
        WHERE status = '已完成' AND updated_at >= datetime('now', ?)
        GROUP BY date(updated_at)
        ORDER BY count DESC
        LIMIT 5
      `)
      return fallbackStmt.all(modifier)
    }

    return results
  }

  // ===== 习惯操作 =====

  getAllHabits() {
    const stmt = this.db.prepare(`
      SELECT h.*, COUNT(hc.id) as checkin_count
      FROM habits h
      LEFT JOIN habit_checkins hc ON h.id = hc.habit_id AND hc.deleted_at IS NULL
      WHERE h.is_archived = 0 AND h.deleted_at IS NULL
      GROUP BY h.id
      ORDER BY h.sort_order ASC, h.created_at DESC
    `)
    const habits = stmt.all()
    return habits.map(h => ({ ...h }))
  }

  getArchivedHabits() {
    const stmt = this.db.prepare(`
      SELECT h.*, COUNT(hc.id) as checkin_count
      FROM habits h
      LEFT JOIN habit_checkins hc ON h.id = hc.habit_id AND hc.deleted_at IS NULL
      WHERE h.is_archived = 1 AND h.deleted_at IS NULL
      GROUP BY h.id
      ORDER BY h.sort_order ASC, h.created_at DESC
    `)
    const habits = stmt.all()
    return habits.map(h => ({ ...h }))
  }

  getHabitById(id) {
    const stmt = this.db.prepare('SELECT * FROM habits WHERE id = ? AND deleted_at IS NULL')
    const habit = stmt.get(id)
    return habit ? { ...habit } : null
  }

  createHabit(data) {
    const stmt = this.db.prepare(`
      INSERT INTO habits (name, color, icon, sort_order)
      VALUES (?, ?, ?, ?)
    `)
    const result = stmt.run(
      data.name,
      data.color || '#10b981',
      data.icon || 'fa-fire',
      data.sort_order || 0
    )
    this._finishCreate('habits', result.lastInsertRowid)
    return this.getHabitById(result.lastInsertRowid)
  }

  updateHabit(id, data) {
    const existing = this.getHabitById(id)
    if (!existing) return null

    const stmt = this.db.prepare(`
      UPDATE habits SET
        name = ?,
        color = ?,
        icon = ?,
        sort_order = ?,
        is_archived = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    stmt.run(
      data.name ?? existing.name,
      data.color ?? existing.color ?? '#10b981',
      data.icon ?? existing.icon ?? 'fa-fire',
      data.sort_order ?? existing.sort_order ?? 0,
      data.is_archived !== undefined ? (data.is_archived ? 1 : 0) : existing.is_archived,
      id
    )
    this._finishUpdate('habits', id)
    return this.getHabitById(id)
  }

  deleteHabit(id) {
    const checkins = this.db.prepare('SELECT * FROM habit_checkins WHERE habit_id = ? AND deleted_at IS NULL').all(id)
    for (const checkin of checkins) {
      this._recordDeleteSyncChange('habit_checkins', checkin.id)
    }
    return this._recordDeleteSyncChange('habits', id)
  }

  archiveHabit(id, isArchived) {
    const stmt = this.db.prepare(`
      UPDATE habits SET is_archived = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `)
    stmt.run(isArchived ? 1 : 0, id)
    this._finishUpdate('habits', id)
    return this.getHabitById(id)
  }

  updateHabitSortOrder(id, sortOrder) {
    const stmt = this.db.prepare(`
      UPDATE habits SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `)
    stmt.run(sortOrder, id)
    this._finishUpdate('habits', id)
    return this.getHabitById(id)
  }

  // ===== 习惯打卡操作 =====

  getHabitCheckins(habitId, startDate, endDate) {
    let sql = `
      SELECT hc.*, h.name as habit_name, h.color as habit_color
      FROM habit_checkins hc
      JOIN habits h ON hc.habit_id = h.id AND h.deleted_at IS NULL
      WHERE hc.habit_id = ? AND hc.deleted_at IS NULL
    `
    const params = [habitId]

    if (startDate) {
      sql += ' AND hc.checkin_date >= ?'
      params.push(startDate)
    }
    if (endDate) {
      sql += ' AND hc.checkin_date <= ?'
      params.push(endDate)
    }

    sql += ' ORDER BY hc.checkin_date DESC'

    const stmt = this.db.prepare(sql)
    const checkins = stmt.all(...params)
    return checkins.map(c => ({ ...c }))
  }

  getAllCheckins(startDate, endDate) {
    let sql = `
      SELECT hc.*, h.name as habit_name, h.color as habit_color
      FROM habit_checkins hc
      JOIN habits h ON hc.habit_id = h.id AND h.deleted_at IS NULL
      WHERE hc.deleted_at IS NULL
    `
    const params = []

    if (startDate) {
      sql += ' AND hc.checkin_date >= ?'
      params.push(startDate)
    }
    if (endDate) {
      sql += ' AND hc.checkin_date <= ?'
      params.push(endDate)
    }

    sql += ' ORDER BY hc.checkin_date DESC'

    const stmt = this.db.prepare(sql)
    const checkins = stmt.all(...params)
    return checkins.map(c => ({ ...c }))
  }

  getCheckinByDate(habitId, date) {
    const stmt = this.db.prepare(`
      SELECT hc.*, h.name as habit_name, h.color as habit_color
      FROM habit_checkins hc
      JOIN habits h ON hc.habit_id = h.id AND h.deleted_at IS NULL
      WHERE hc.habit_id = ? AND hc.deleted_at IS NULL AND hc.checkin_date = ?
    `)
    const checkin = stmt.get(habitId, date)
    return checkin ? { ...checkin } : null
  }

  createHabitCheckin(data) {
    const existing = this.db.prepare(`
      SELECT id
      FROM habit_checkins
      WHERE habit_id = ? AND checkin_date = ?
    `).get(data.habit_id, data.checkin_date)

    if (existing) {
      this.db.prepare(`
        UPDATE habit_checkins SET
          level = ?,
          note = ?,
          deleted_at = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        data.level ?? 1,
        data.note ?? '',
        existing.id
      )
      this._finishUpdate('habit_checkins', existing.id)
      return this.getHabitCheckinById(existing.id)
    }

    const stmt = this.db.prepare(`
      INSERT INTO habit_checkins (habit_id, checkin_date, level, note)
      VALUES (?, ?, ?, ?)
    `)
    const result = stmt.run(
      data.habit_id,
      data.checkin_date,
      data.level ?? 1,
      data.note ?? ''
    )
    this._finishCreate('habit_checkins', result.lastInsertRowid)
    return this.getHabitCheckinById(result.lastInsertRowid)
  }

  getHabitCheckinById(id) {
    const stmt = this.db.prepare(`
      SELECT hc.*, h.name as habit_name, h.color as habit_color
      FROM habit_checkins hc
      JOIN habits h ON hc.habit_id = h.id AND h.deleted_at IS NULL
      WHERE hc.id = ? AND hc.deleted_at IS NULL
    `)
    const checkin = stmt.get(id)
    return checkin ? { ...checkin } : null
  }

  updateHabitCheckin(id, data) {
    const existing = this.getHabitCheckinById(id)
    if (!existing) return null

    const stmt = this.db.prepare(`
      UPDATE habit_checkins SET
        level = ?,
        note = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    stmt.run(
      data.level ?? existing.level ?? 1,
      data.note ?? existing.note ?? '',
      id
    )
    this._finishUpdate('habit_checkins', id)
    return this.getHabitCheckinById(id)
  }

  deleteHabitCheckin(id) {
    return this._recordDeleteSyncChange('habit_checkins', id)
  }

  // ===== 桌面便签操作 =====

  getNoteProjects(noteId) {
    const stmt = this.db.prepare(`
      SELECT p.id, p.name, p.status, p.priority
      FROM note_project_links npl
      JOIN projects p ON p.id = npl.project_id AND p.deleted_at IS NULL
      WHERE npl.note_id = ? AND npl.deleted_at IS NULL
      ORDER BY p.updated_at DESC, p.name ASC
    `)
    return stmt.all(noteId).map(project => ({ ...project }))
  }

  _attachNoteProjects(note) {
    if (!note) return null
    const linkedProjects = this.getNoteProjects(note.id)
    return {
      ...note,
      content_hash: hashNoteContent(note.content),
      project_ids: linkedProjects.map(project => project.id),
      linked_projects: linkedProjects
    }
  }

  _normalizeProjectIds(projectIds) {
    if (!Array.isArray(projectIds)) return []
    return [...new Set(projectIds.map(id => Number(id)).filter(id => Number.isInteger(id) && id > 0))]
  }

  setDesktopNoteProjects(noteId, projectIds = []) {
    const note = this.db.prepare('SELECT id FROM desktop_notes WHERE id = ? AND deleted_at IS NULL').get(noteId)
    if (!note) return null

    const normalizedIds = this._normalizeProjectIds(projectIds)
    const currentLinks = this.db.prepare('SELECT project_id FROM note_project_links WHERE note_id = ? AND deleted_at IS NULL').all(noteId)
    const currentProjectIds = currentLinks.map(link => link.project_id)
    const addedIds = normalizedIds.filter(pid => !currentProjectIds.includes(pid))
    const removedIds = currentProjectIds.filter(pid => !normalizedIds.includes(pid))

    for (const pid of removedIds) {
      this._recordDeleteNoteProjectLink(noteId, pid)
    }
    for (const pid of addedIds) {
      const existing = this.db.prepare('SELECT 1 FROM note_project_links WHERE note_id = ? AND project_id = ?').get(noteId, pid)
      if (!existing) {
        this.db.prepare('INSERT INTO note_project_links (note_id, project_id, created_at) VALUES (?, ?, ?)').run(noteId, pid, new Date().toISOString())
      }
      this._finishCreateNoteProjectLink(noteId, pid)
    }

    return this.getDesktopNoteById(noteId)
  }

  getDesktopNotesByProject(projectId) {
    const stmt = this.db.prepare(`
      SELECT
        dn.*,
        anl.apple_note_id,
        anl.apple_note_title,
        anl.last_synced_at AS apple_note_last_synced_at,
        anl.last_synced_hash AS apple_note_last_synced_hash,
        anl.last_synced_apple_hash AS apple_note_last_synced_apple_hash
      FROM desktop_notes dn
      JOIN note_project_links npl ON npl.note_id = dn.id AND npl.deleted_at IS NULL
      LEFT JOIN apple_note_links anl ON anl.note_id = dn.id
      WHERE npl.project_id = ? AND COALESCE(dn.is_archived, 0) = 0 AND dn.deleted_at IS NULL
      ORDER BY dn.is_pinned DESC, dn.updated_at DESC
    `)
    return stmt.all(projectId).map(note => this._attachNoteProjects(note))
  }

  getDesktopNotes(category = null, options = {}) {
    if (category && typeof category === 'object') {
      options = category
      category = null
    }
    const includeArchived = Boolean(options.includeArchived)

    let sql = `
      SELECT
        dn.*,
        anl.apple_note_id,
        anl.apple_note_title,
        anl.last_synced_at AS apple_note_last_synced_at,
        anl.last_synced_hash AS apple_note_last_synced_hash,
        anl.last_synced_apple_hash AS apple_note_last_synced_apple_hash
      FROM desktop_notes dn
      LEFT JOIN apple_note_links anl ON anl.note_id = dn.id
      WHERE dn.deleted_at IS NULL
    `
    const params = []

    if (!includeArchived) {
      sql += ' AND COALESCE(dn.is_archived, 0) = 0'
    }

    if (category !== null && category !== undefined) {
      sql += ' AND dn.category = ?'
      params.push(category)
    }

    sql += ' ORDER BY dn.is_pinned DESC, dn.updated_at DESC'

    const stmt = this.db.prepare(sql)
    const notes = stmt.all(...params)
    // 返回纯对象数组，避免 better-sqlite3 返回的对象有不可序列化的属性
    return notes.map(note => this._attachNoteProjects(note))
  }

  getDesktopNoteById(id) {
    const stmt = this.db.prepare(`
      SELECT
        dn.*,
        anl.apple_note_id,
        anl.apple_note_title,
        anl.last_synced_at AS apple_note_last_synced_at,
        anl.last_synced_hash AS apple_note_last_synced_hash,
        anl.last_synced_apple_hash AS apple_note_last_synced_apple_hash
      FROM desktop_notes dn
      LEFT JOIN apple_note_links anl ON anl.note_id = dn.id
      WHERE dn.id = ? AND dn.deleted_at IS NULL
    `)
    const note = stmt.get(id)
    // 返回纯对象
    return this._attachNoteProjects(note)
  }

  createDesktopNote(data) {
    const stmt = this.db.prepare(`
      INSERT INTO desktop_notes (title, content, width, height, pos_x, pos_y, is_pinned, is_minimized, is_archived, category)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const result = stmt.run(
      data.title || '',
      data.content,
      data.width || 250,
      data.height || 200,
      data.pos_x || 0,
      data.pos_y || 0,
      data.is_pinned ? 1 : 0,
      data.is_minimized ? 1 : 0,
      data.is_archived ? 1 : 0,
      data.category || ''
    )
    if (data.project_ids !== undefined) {
      this.setDesktopNoteProjects(result.lastInsertRowid, data.project_ids)
    }
    this._finishCreate('desktop_notes', result.lastInsertRowid)
    return this.getDesktopNoteById(result.lastInsertRowid)
  }

  updateDesktopNote(id, data) {
    const existing = this.getDesktopNoteById(id)
    if (!existing) return null

    const stmt = this.db.prepare(`
      UPDATE desktop_notes SET
        title = ?,
        content = ?,
        width = ?,
        height = ?,
        pos_x = ?,
        pos_y = ?,
        is_pinned = ?,
        is_minimized = ?,
        is_archived = ?,
        category = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    stmt.run(
      data.title ?? existing.title ?? '',
      data.content ?? existing.content ?? '',
      data.width ?? existing.width ?? 250,
      data.height ?? existing.height ?? 200,
      data.pos_x ?? existing.pos_x ?? 0,
      data.pos_y ?? existing.pos_y ?? 0,
      data.is_pinned !== undefined ? (data.is_pinned ? 1 : 0) : existing.is_pinned,
      data.is_minimized !== undefined ? (data.is_minimized ? 1 : 0) : existing.is_minimized,
      data.is_archived !== undefined ? (data.is_archived ? 1 : 0) : existing.is_archived,
      data.category ?? existing.category ?? '',
      id
    )
    if (data.project_ids !== undefined) {
      this.setDesktopNoteProjects(id, data.project_ids)
    }
    this._finishUpdate('desktop_notes', id)
    return this.getDesktopNoteById(id)
  }

  // 局部替换便签正文：只改命中片段，正文其余部分与别的字段保持原样。
  // 默认要求 find 在正文中恰好出现一次；occurrence（从 1 开始）或 replace_all 用于消歧。
  // 读取、校验、写入在同一个事务里完成，避免 read-then-write 覆盖并发修改。
  patchDesktopNote(id, options = {}) {
    const find = options.find
    const replace = options.replace ?? ''
    const occurrence = options.occurrence ?? undefined
    const replaceAll = options.replace_all === true
    const expectedHash = options.expected_content_hash ?? undefined
    const expectedUpdatedAt = options.expected_updated_at ?? undefined

    if (typeof find !== 'string' || find.length === 0) {
      throw new Error('find 不能为空')
    }
    if (typeof replace !== 'string') {
      throw new Error('replace 必须是字符串')
    }
    if (occurrence !== undefined && (!Number.isInteger(occurrence) || occurrence < 1)) {
      throw new Error('occurrence 必须是从 1 开始的整数')
    }
    if (occurrence !== undefined && replaceAll) {
      throw new Error('occurrence 与 replace_all 互斥，只能指定一个')
    }
    if (expectedHash !== undefined && typeof expectedHash !== 'string') {
      throw new Error('expected_content_hash 必须是字符串')
    }
    if (expectedUpdatedAt !== undefined && typeof expectedUpdatedAt !== 'string') {
      throw new Error('expected_updated_at 必须是字符串')
    }

    const patch = this.db.transaction(() => {
      const row = this.db.prepare(
        'SELECT content, updated_at FROM desktop_notes WHERE id = ? AND deleted_at IS NULL'
      ).get(id)
      if (!row) throw new Error(`便签ID ${id} 不存在`)

      const content = row.content ?? ''
      if (expectedHash !== undefined && hashNoteContent(content) !== expectedHash) {
        throw new Error('便签正文已被其他修改更新（内容哈希不匹配），请重新读取后再替换')
      }
      if (expectedUpdatedAt !== undefined && row.updated_at !== expectedUpdatedAt) {
        throw new Error(`便签已被其他修改更新（当前更新时间: ${row.updated_at}），请重新读取后再替换`)
      }

      const occurrences = countOccurrences(content, find)
      if (occurrences === 0) {
        throw new Error('未在便签正文中找到 find 指定的文本')
      }
      if (occurrence === undefined && !replaceAll && occurrences > 1) {
        throw new Error(`find 在便签正文中出现 ${occurrences} 次，请提供更长的上下文、指定 occurrence 或 replace_all`)
      }
      if (occurrence !== undefined && occurrence > occurrences) {
        throw new Error(`find 在便签正文中只出现 ${occurrences} 次，无法替换第 ${occurrence} 次`)
      }

      let replaced = occurrences
      let updated
      if (replaceAll) {
        updated = content.split(find).join(replace)
      } else if (occurrence !== undefined) {
        updated = replaceNthOccurrence(content, find, occurrence, replace)
        replaced = 1
      } else {
        updated = content.split(find).join(replace)
        replaced = 1
      }

      this.db.prepare('UPDATE desktop_notes SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(updated, id)
      this._finishUpdate('desktop_notes', id)
      return replaced
    })

    const replaced = patch()
    return { note_id: id, replaced, note: this.getDesktopNoteById(id) }
  }

  archiveDesktopNote(id, isArchived) {
    const stmt = this.db.prepare(`
      UPDATE desktop_notes
      SET is_archived = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    stmt.run(isArchived ? 1 : 0, id)
    this._finishUpdate('desktop_notes', id)
    return this.getDesktopNoteById(id)
  }

  archiveDesktopNotes(ids = [], isArchived) {
    const normalizedIds = [...new Set(
      (Array.isArray(ids) ? ids : [])
        .map(id => Number(id))
        .filter(id => Number.isInteger(id) && id > 0)
    )]
    if (normalizedIds.length === 0) {
      return { success: true, count: 0 }
    }

    const update = this.db.transaction((noteIds) => {
      const stmt = this.db.prepare(`
        UPDATE desktop_notes
        SET is_archived = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      noteIds.forEach(noteId => stmt.run(isArchived ? 1 : 0, noteId))
    })
    update(normalizedIds)
    for (const noteId of normalizedIds) this._finishUpdate('desktop_notes', noteId)
    return { success: true, count: normalizedIds.length }
  }

  deleteDesktopNote(id) {
    const links = this.db.prepare('SELECT * FROM note_project_links WHERE note_id = ? AND deleted_at IS NULL').all(id)
    for (const link of links) {
      this._recordDeleteNoteProjectLink(link.note_id, link.project_id)
    }
    this.db.prepare('DELETE FROM apple_note_links WHERE note_id = ?').run(id)
    return this._recordDeleteSyncChange('desktop_notes', id)
  }

  getAppleNoteLink(noteId) {
    const stmt = this.db.prepare('SELECT * FROM apple_note_links WHERE note_id = ?')
    const link = stmt.get(noteId)
    return link ? { ...link } : null
  }

  upsertAppleNoteLink(noteId, data) {
    const stmt = this.db.prepare(`
      INSERT INTO apple_note_links (
        note_id,
        apple_note_id,
        apple_note_title,
        last_synced_at,
        last_synced_hash,
        last_synced_apple_hash,
        updated_at
      )
      VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(note_id) DO UPDATE SET
        apple_note_id = excluded.apple_note_id,
        apple_note_title = excluded.apple_note_title,
        last_synced_at = CURRENT_TIMESTAMP,
        last_synced_hash = excluded.last_synced_hash,
        last_synced_apple_hash = excluded.last_synced_apple_hash,
        updated_at = CURRENT_TIMESTAMP
    `)
    stmt.run(
      noteId,
      data.apple_note_id,
      data.apple_note_title || '',
      data.last_synced_hash || '',
      data.last_synced_apple_hash || ''
    )
    return this.getAppleNoteLink(noteId)
  }

  deleteAppleNoteLink(noteId) {
    const stmt = this.db.prepare('DELETE FROM apple_note_links WHERE note_id = ?')
    return stmt.run(noteId)
  }

  // ===== 分类操作 =====

  getAllCategories() {
    const stmt = this.db.prepare(`
      SELECT * FROM categories
      WHERE deleted_at IS NULL
      ORDER BY name ASC
    `)
    const categories = stmt.all()
    return categories.map(cat => ({ ...cat }))
  }

  createCategory(name) {
    const stmt = this.db.prepare(`
      INSERT INTO categories (name)
      VALUES (?)
    `)
    try {
      const result = stmt.run(name)
      this._finishCreate('categories', result.lastInsertRowid)
      return { success: true, id: result.lastInsertRowid, name }
    } catch (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        return { success: false, error: 'Category already exists' }
      }
      throw err
    }
  }

  deleteCategory(name) {
    const category = this.db.prepare('SELECT * FROM categories WHERE name = ? AND deleted_at IS NULL').get(name)
    if (!category) return { changes: 0 }

    this._recordDeleteSyncChange('categories', category.id)

    const notes = this.db.prepare('SELECT id FROM desktop_notes WHERE category = ? AND deleted_at IS NULL').all(name)
    const stmt = this.db.prepare(`
      UPDATE desktop_notes SET category = '', updated_at = CURRENT_TIMESTAMP WHERE category = ? AND deleted_at IS NULL
    `)
    stmt.run(name)
    for (const note of notes) {
      this._finishUpdate('desktop_notes', note.id)
    }

    return { changes: 1 }
  }

  updateNoteCategory(noteId, category) {
    const stmt = this.db.prepare(`
      UPDATE desktop_notes SET
        category = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    const result = stmt.run(category, noteId)
    this._finishUpdate('desktop_notes', noteId)
    return result
  }

  // ===== 每日任务操作 =====

  // 关联项目校验：只允许未开始/进行中的未删除项目；null 表示解除关联。
  // 编辑既有任务时若 project_id 未变化则跳过校验，避免项目被暂停/软删后编辑失败。
  _validateDailyTaskProject(projectId) {
    const project = this.db.prepare(
      'SELECT id, name, status FROM projects WHERE id = ? AND deleted_at IS NULL'
    ).get(projectId)
    if (!project) {
      throw new Error(`关联项目 ${projectId} 不存在或已删除`)
    }
    if (!ACTIVE_PROJECT_STATUSES.includes(project.status)) {
      throw new Error(`项目「${project.name}」状态为${project.status}，只能关联未开始或进行中的项目`)
    }
    return project.id
  }

  _resolveDailyTaskProjectId(value) {
    if (value === undefined || value === null || value === '') return null
    const id = Number(value)
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error(`关联项目 ID 非法: ${value}`)
    }
    return this._validateDailyTaskProject(id)
  }

  // 重复任务继承：项目仍存在（含已暂停/已完成）就原样继承；已软删/不存在则解除。
  _inheritDailyTaskProjectId(projectId) {
    if (!projectId) return null
    const row = this.db.prepare('SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL').get(projectId)
    return row ? row.id : null
  }

  getRecentlyCompletedDailyTasks(limit = 50) {
    const stmt = this.db.prepare(`
      SELECT dt.*, p.name as project_name
      FROM daily_tasks dt
      LEFT JOIN projects p ON dt.project_id = p.id AND p.deleted_at IS NULL
      WHERE dt.is_completed = 1 AND dt.deleted_at IS NULL
      ORDER BY dt.completed_at DESC, dt.updated_at DESC
      LIMIT ?
    `)
    return stmt.all(limit)
  }

  getDailyTasksByDate(date) {
    const stmt = this.db.prepare(`
      SELECT dt.*, p.name as project_name
      FROM daily_tasks dt
      LEFT JOIN projects p ON dt.project_id = p.id AND p.deleted_at IS NULL
      WHERE dt.date = ? AND dt.deleted_at IS NULL
      ORDER BY
        dt.is_completed ASC,
        dt.is_pinned DESC,
        dt.sort_order ASC,
        CASE dt.priority
          WHEN '高' THEN 0
          WHEN '中' THEN 1
          WHEN '低' THEN 2
          ELSE 1
        END ASC,
        dt.created_at DESC
    `)
    return stmt.all(date)
  }

  createDailyTask(data, options = {}) {
    const stmt = this.db.prepare(`
      INSERT INTO daily_tasks (
        title, date, is_completed, priority, estimated_minutes,
        time_spent_seconds, sort_order, is_pinned, tags, notes, completed_at,
        repeat_rule_id, project_id, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `)
    const result = stmt.run(
      data.title,
      data.date,
      data.is_completed ? 1 : 0,
      data.priority || '中',
      Math.max(0, Number(data.estimated_minutes) || 0),
      Math.max(0, Number(data.time_spent_seconds) || 0),
      Number(data.sort_order) || 0,
      data.is_pinned ? 1 : 0,
      data.tags || '',
      data.notes || '',
      data.is_completed ? new Date().toISOString() : null,
      data.repeat_rule_id || null,
      options.inheritProject
        ? this._inheritDailyTaskProjectId(data.project_id)
        : this._resolveDailyTaskProjectId(data.project_id)
    )
    this._finishCreate('daily_tasks', result.lastInsertRowid)
    return this.getDailyTaskById(result.lastInsertRowid)
  }

  getDailyTaskById(id) {
    const stmt = this.db.prepare(`
      SELECT dt.*, p.name as project_name
      FROM daily_tasks dt
      LEFT JOIN projects p ON dt.project_id = p.id AND p.deleted_at IS NULL
      WHERE dt.id = ? AND dt.deleted_at IS NULL
    `)
    return stmt.get(id)
  }

  updateDailyTask(id, data) {
    const existing = this.getDailyTaskById(id)
    if (!existing) return null

    let projectId = existing.project_id ?? null
    if (data.project_id !== undefined) {
      if (data.project_id === null || data.project_id === '') {
        projectId = null
      } else {
        const requested = Number(data.project_id)
        if (!Number.isInteger(requested) || requested <= 0) {
          throw new Error(`关联项目 ID 非法: ${data.project_id}`)
        }
        // 值未变 → 保留（项目可能已暂停/软删，编辑其他字段不该失败）
        projectId = requested === existing.project_id
          ? existing.project_id
          : this._validateDailyTaskProject(requested)
      }
    }

    const stmt = this.db.prepare(`
      UPDATE daily_tasks SET
        title = ?,
        date = ?,
        is_completed = ?,
        priority = ?,
        estimated_minutes = ?,
        time_spent_seconds = ?,
        sort_order = ?,
        is_pinned = ?,
        tags = ?,
        notes = ?,
        completed_at = ?,
        repeat_rule_id = ?,
        project_id = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)

    const newCompleted = data.is_completed !== undefined ? data.is_completed : existing.is_completed
    stmt.run(
      data.title ?? existing.title,
      data.date ?? existing.date,
      newCompleted ? 1 : 0,
      data.priority ?? existing.priority ?? '中',
      Math.max(0, Number(data.estimated_minutes ?? existing.estimated_minutes) || 0),
      Math.max(0, Number(data.time_spent_seconds ?? existing.time_spent_seconds) || 0),
      Number(data.sort_order ?? existing.sort_order) || 0,
      data.is_pinned !== undefined ? (data.is_pinned ? 1 : 0) : existing.is_pinned,
      data.tags ?? existing.tags ?? '',
      data.notes ?? existing.notes ?? '',
      newCompleted ? (existing.completed_at || new Date().toISOString()) : null,
      data.repeat_rule_id !== undefined ? data.repeat_rule_id : existing.repeat_rule_id,
      projectId,
      id
    )
    this._finishUpdate('daily_tasks', id)
    return this.getDailyTaskById(id)
  }

  toggleDailyTaskComplete(id, isCompleted) {
    const stmt = this.db.prepare(`
      UPDATE daily_tasks SET
        is_completed = ?,
        completed_at = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    stmt.run(isCompleted ? 1 : 0, isCompleted ? new Date().toISOString() : null, id)
    this._finishUpdate('daily_tasks', id)
    return this.getDailyTaskById(id)
  }

  deleteDailyTask(id) {
    const subtasks = this.db.prepare('SELECT * FROM daily_task_subtasks WHERE daily_task_id = ? AND deleted_at IS NULL').all(id)
    for (const subtask of subtasks) {
      this._recordDeleteSyncChange('daily_task_subtasks', subtask.id)
    }
    return this._recordDeleteSyncChange('daily_tasks', id)
  }

  reorderDailyTasks(orderedIds) {
    const stmt = this.db.prepare(`
      UPDATE daily_tasks
      SET sort_order = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    const tx = this.db.transaction((ids) => {
      ids.forEach((id, index) => stmt.run(index, id))
    })
    tx(orderedIds)
    for (const id of orderedIds) this._finishUpdate('daily_tasks', id)
    return { success: true }
  }

  moveDailyTasksToDate(ids, date) {
    const stmt = this.db.prepare(`
      UPDATE daily_tasks
      SET date = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    const tx = this.db.transaction((taskIds) => {
      taskIds.forEach(id => stmt.run(date, id))
    })
    tx(ids)
    for (const id of ids) this._finishUpdate('daily_tasks', id)
    return { success: true }
  }

  recordDailyTaskTimeSpent(id, seconds) {
    const safeSeconds = Math.max(0, Number(seconds) || 0)
    const stmt = this.db.prepare(`
      UPDATE daily_tasks
      SET time_spent_seconds = COALESCE(time_spent_seconds, 0) + ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    stmt.run(safeSeconds, id)
    this._finishUpdate('daily_tasks', id)
    return this.getDailyTaskById(id)
  }

  // ===== 每日任务子任务操作 =====

  getDailySubtasksByTaskIds(taskIds) {
    if (!Array.isArray(taskIds) || taskIds.length === 0) return []
    const placeholders = taskIds.map(() => '?').join(',')
    const stmt = this.db.prepare(`
      SELECT * FROM daily_task_subtasks
      WHERE deleted_at IS NULL AND daily_task_id IN (${placeholders})
      ORDER BY sort_order ASC, created_at ASC
    `)
    return stmt.all(...taskIds)
  }

  getDailySubtasks(taskId) {
    const stmt = this.db.prepare(`
      SELECT * FROM daily_task_subtasks
      WHERE daily_task_id = ? AND deleted_at IS NULL
      ORDER BY sort_order ASC, created_at ASC
    `)
    return stmt.all(taskId)
  }

  createDailySubtask(taskId, data) {
    const stmt = this.db.prepare(`
      INSERT INTO daily_task_subtasks (daily_task_id, title, is_completed, sort_order, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `)
    const result = stmt.run(
      taskId,
      data.title,
      data.is_completed ? 1 : 0,
      Number(data.sort_order) || 0
    )
    this._finishCreate('daily_task_subtasks', result.lastInsertRowid)
    return this.getDailySubtaskById(result.lastInsertRowid)
  }

  getDailySubtaskById(id) {
    const stmt = this.db.prepare('SELECT * FROM daily_task_subtasks WHERE id = ? AND deleted_at IS NULL')
    return stmt.get(id)
  }

  updateDailySubtask(id, data) {
    const existing = this.getDailySubtaskById(id)
    if (!existing) return null
    const stmt = this.db.prepare(`
      UPDATE daily_task_subtasks SET
        title = ?,
        is_completed = ?,
        sort_order = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    stmt.run(
      data.title ?? existing.title,
      data.is_completed !== undefined ? (data.is_completed ? 1 : 0) : existing.is_completed,
      Number(data.sort_order ?? existing.sort_order) || 0,
      id
    )
    this._finishUpdate('daily_task_subtasks', id)
    return this.getDailySubtaskById(id)
  }

  deleteDailySubtask(id) {
    return this._recordDeleteSyncChange('daily_task_subtasks', id)
  }

  reorderDailySubtasks(taskId, orderedIds) {
    const stmt = this.db.prepare(`
      UPDATE daily_task_subtasks
      SET sort_order = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    const tx = this.db.transaction((ids) => {
      ids.forEach((id, index) => stmt.run(index, id))
    })
    tx(orderedIds)
    for (const id of orderedIds) this._finishUpdate('daily_task_subtasks', id)
    return { success: true }
  }

  // ===== 每日任务重复规则操作 =====

  getDailyTaskRepeatRules() {
    const stmt = this.db.prepare(`
      SELECT r.*, p.name as project_name
      FROM daily_task_repeat_rules r
      LEFT JOIN projects p ON r.project_id = p.id AND p.deleted_at IS NULL
      WHERE r.deleted_at IS NULL
      ORDER BY r.is_active DESC, r.created_at DESC
    `)
    return stmt.all()
  }

  getDailyTaskRepeatRuleById(id) {
    const stmt = this.db.prepare(`
      SELECT r.*, p.name as project_name
      FROM daily_task_repeat_rules r
      LEFT JOIN projects p ON r.project_id = p.id AND p.deleted_at IS NULL
      WHERE r.id = ? AND r.deleted_at IS NULL
    `)
    return stmt.get(id)
  }

  createDailyTaskRepeatRule(data) {
    const stmt = this.db.prepare(`
      INSERT INTO daily_task_repeat_rules (
        title, priority, estimated_minutes, tags, notes, repeat_type,
        repeat_value, start_date, end_date, is_active,
        wait_for_completion, skip_overdue, repeat_from_completion, project_id, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `)
    const result = stmt.run(
      data.title,
      data.priority || '中',
      Math.max(0, Number(data.estimated_minutes) || 0),
      data.tags || '',
      data.notes || '',
      data.repeat_type,
      data.repeat_value || '',
      data.start_date,
      data.end_date || null,
      data.is_active !== undefined ? (data.is_active ? 1 : 0) : 1,
      data.wait_for_completion ? 1 : 0,
      data.skip_overdue !== undefined ? (data.skip_overdue ? 1 : 0) : 1,
      data.repeat_from_completion ? 1 : 0,
      this._resolveDailyTaskProjectId(data.project_id)
    )
    this._finishCreate('daily_task_repeat_rules', result.lastInsertRowid)
    return this.getDailyTaskRepeatRuleById(result.lastInsertRowid)
  }

  updateDailyTaskRepeatRule(id, data) {
    const existing = this.getDailyTaskRepeatRuleById(id)
    if (!existing) return null

    let projectId = existing.project_id ?? null
    if (data.project_id !== undefined) {
      if (data.project_id === null || data.project_id === '') {
        projectId = null
      } else {
        const requested = Number(data.project_id)
        if (!Number.isInteger(requested) || requested <= 0) {
          throw new Error(`关联项目 ID 非法: ${data.project_id}`)
        }
        projectId = requested === existing.project_id
          ? existing.project_id
          : this._validateDailyTaskProject(requested)
      }
    }

    const stmt = this.db.prepare(`
      UPDATE daily_task_repeat_rules SET
        title = ?,
        priority = ?,
        estimated_minutes = ?,
        tags = ?,
        notes = ?,
        repeat_type = ?,
        repeat_value = ?,
        start_date = ?,
        end_date = ?,
        is_active = ?,
        wait_for_completion = ?,
        skip_overdue = ?,
        repeat_from_completion = ?,
        project_id = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    stmt.run(
      data.title ?? existing.title,
      data.priority ?? existing.priority ?? '中',
      Math.max(0, Number(data.estimated_minutes ?? existing.estimated_minutes) || 0),
      data.tags ?? existing.tags ?? '',
      data.notes ?? existing.notes ?? '',
      data.repeat_type ?? existing.repeat_type,
      data.repeat_value ?? existing.repeat_value ?? '',
      data.start_date ?? existing.start_date,
      data.end_date !== undefined ? data.end_date : existing.end_date,
      data.is_active !== undefined ? (data.is_active ? 1 : 0) : existing.is_active,
      data.wait_for_completion !== undefined ? (data.wait_for_completion ? 1 : 0) : existing.wait_for_completion,
      data.skip_overdue !== undefined ? (data.skip_overdue ? 1 : 0) : existing.skip_overdue,
      data.repeat_from_completion !== undefined ? (data.repeat_from_completion ? 1 : 0) : existing.repeat_from_completion,
      projectId,
      id
    )
    this._finishUpdate('daily_task_repeat_rules', id)
    return this.getDailyTaskRepeatRuleById(id)
  }

  deleteDailyTaskRepeatRule(id) {
    return this._recordDeleteSyncChange('daily_task_repeat_rules', id)
  }

  _dateMatchesRepeatRule(rule, dateStr) {
    const day = parseISO(dateStr)
    if (!isValid(day)) return false

    switch (rule.repeat_type) {
      case 'daily':
        return true
      case 'weekdays':
        return !isWeekend(day)
      case 'weekly': {
        const weekdays = String(rule.repeat_value || '')
          .split(/[,，]/)
          .map(s => parseInt(s.trim(), 10))
          .filter(n => Number.isInteger(n) && n >= 1 && n <= 7)
        return weekdays.includes(getISODay(day))
      }
      case 'monthly': {
        const monthDays = String(rule.repeat_value || '')
          .split(/[,，]/)
          .map(s => parseInt(s.trim(), 10))
          .filter(n => Number.isInteger(n) && n >= 1 && n <= 31)
        return monthDays.includes(getDate(day))
      }
      case 'monthly_nth_weekday': {
        const parts = String(rule.repeat_value || '').split('-')
        if (parts.length !== 2) return false
        const weekOfMonth = parseInt(parts[0], 10)
        const targetWeekday = parseInt(parts[1], 10)
        if (!Number.isInteger(weekOfMonth) || !Number.isInteger(targetWeekday)) return false
        if (targetWeekday < 0 || targetWeekday > 6) return false
        if (day.getDay() !== targetWeekday) return false
        if (weekOfMonth === -1) {
          const nextWeek = new Date(day)
          nextWeek.setDate(day.getDate() + 7)
          return nextWeek.getMonth() !== day.getMonth()
        }
        const occurrence = Math.ceil(day.getDate() / 7)
        return occurrence === weekOfMonth
      }
      case 'monthly_last_day': {
        const lastDay = new Date(day.getFullYear(), day.getMonth() + 1, 0).getDate()
        return day.getDate() === lastDay
      }
      case 'yearly': {
        const parts = String(rule.repeat_value || '').split('-')
        if (parts.length !== 2) return false
        const m = parseInt(parts[0], 10)
        const d = parseInt(parts[1], 10)
        return day.getMonth() + 1 === m && day.getDate() === d
      }
      default:
        return false
    }
  }

  _todayStr() {
    const now = new Date()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    return `${now.getFullYear()}-${month}-${day}`
  }

  generateDailyTasksForDate(date) {
    const rules = this.getDailyTaskRepeatRules().filter(r => r.is_active)
    const stmt = this.db.prepare(`
      SELECT id FROM daily_tasks WHERE repeat_rule_id = ? AND date = ?
    `)
    const createdIds = []
    for (const rule of rules) {
      if (rule.start_date > date) continue
      if (rule.end_date && rule.end_date < date) continue
      // skip_overdue: skip dates that are in the past
      if (rule.skip_overdue && date < this._todayStr()) continue
      if (!this._dateMatchesRepeatRule(rule, date)) continue
      // wait_for_completion: don't create next until current is done
      if (rule.wait_for_completion) {
        const latestTask = this.db.prepare(
          'SELECT id, is_completed FROM daily_tasks WHERE repeat_rule_id = ? ORDER BY date DESC LIMIT 1'
        ).get(rule.id)
        if (latestTask && !latestTask.is_completed) continue
      }
      const existing = stmt.get(rule.id, date)
      if (!existing) {
        const task = this.createDailyTask({
          title: rule.title,
          date,
          priority: rule.priority,
          estimated_minutes: rule.estimated_minutes,
          tags: rule.tags,
          notes: rule.notes,
          repeat_rule_id: rule.id,
          project_id: rule.project_id
        }, { inheritProject: true })
        if (task) createdIds.push(task.id)
      }
    }
    return { success: true, createdIds }
  }

  // ===== 附件操作 =====

  getDocumentsByProjectId(projectId) {
    const stmt = this.db.prepare('SELECT * FROM project_documents WHERE project_id = ? AND deleted_at IS NULL ORDER BY created_at DESC')
    return stmt.all(projectId)
  }

  _getProjectName(projectId) {
    try {
      const row = this.db.prepare('SELECT name FROM projects WHERE id = ?').get(projectId)
      return row ? row.name : null
    } catch (err) {
      return null
    }
  }

  _getUploadDir(projectId, projectName = null) {
    return path.join(this.uploadsDir, `project_${projectId}`)
  }

  _ensureUploadDir(projectId) {
    const projectName = this._getProjectName(projectId)
    const dir = this._getUploadDir(projectId, projectName)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    return dir
  }

  _getDocumentPath(doc) {
    const filename = sanitizeFilename(doc.filename)

    // Current path: uploads/project_{projectId}/{filename}
    const currentPath = path.join(this._getUploadDir(doc.project_id), filename)
    if (isPathInside(currentPath, this.uploadsDir) && fs.existsSync(currentPath)) {
      return currentPath
    }

    // Fallback 1: previous named path uploads/{sanitizedName}_{projectId}/{filename}
    const projectName = this._getProjectName(doc.project_id)
    if (projectName) {
      const sanitized = projectName.replace(/[^a-zA-Z0-9一-龥_-]/g, '_').substring(0, 50)
      const oldNamedPath = path.join(this.uploadsDir, `${sanitized}_${doc.project_id}`, filename)
      if (isPathInside(oldNamedPath, this.uploadsDir) && fs.existsSync(oldNamedPath)) {
        return oldNamedPath
      }
    }

    // Fallback 2: old per-project path uploads/{projectId}/{filename}
    const oldProjectPath = path.join(this.uploadsDir, String(doc.project_id), filename)
    if (isPathInside(oldProjectPath, this.uploadsDir) && fs.existsSync(oldProjectPath)) {
      return oldProjectPath
    }
    // Fallback 3: old flat path uploads/{filename}
    const oldFlatPath = path.join(this.uploadsDir, filename)
    if (isPathInside(oldFlatPath, this.uploadsDir) && fs.existsSync(oldFlatPath)) {
      return oldFlatPath
    }
    // Fallback 4: project was renamed after using the old named directory.
    const foundPath = this._findFileInDir(this.uploadsDir, filename)
    if (foundPath) return foundPath
    return currentPath
  }

  uploadDocument(projectId, fileData) {
    const safeName = sanitizeFilename(fileData.name)
    const filename = `${uuidv4()}_${safeName || 'file'}`
    const dir = this._ensureUploadDir(projectId)
    const filePath = path.join(dir, filename)

    if (!isPathInside(filePath, this.uploadsDir)) {
      throw new Error('非法文件路径')
    }

    fs.writeFileSync(filePath, Buffer.from(fileData.data))

    const stmt = this.db.prepare(`
      INSERT INTO project_documents (project_id, filename, original_filename, file_size, mime_type)
      VALUES (?, ?, ?, ?, ?)
    `)
    const result = stmt.run(projectId, filename, fileData.name, fileData.size, fileData.type)
    this._finishCreate('project_documents', result.lastInsertRowid)
    return this.getDocumentById(result.lastInsertRowid)
  }

  getDocumentById(id) {
    const stmt = this.db.prepare('SELECT * FROM project_documents WHERE id = ? AND deleted_at IS NULL')
    return stmt.get(id)
  }

  createDocument(data) {
    const stmt = this.db.prepare(`
      INSERT INTO project_documents (project_id, filename, original_filename, file_size, mime_type)
      VALUES (?, ?, ?, ?, ?)
    `)
    const result = stmt.run(
      data.project_id,
      data.filename,
      data.original_filename,
      data.file_size || 0,
      data.mime_type || ''
    )
    this._finishCreate('project_documents', result.lastInsertRowid)
    return this.getDocumentById(result.lastInsertRowid)
  }

  updateDocument(documentId, data) {
    const doc = this.getDocumentById(documentId)
    if (!doc) return null

    let fileSize = doc.file_size || 0
    if (data.data_base64 !== undefined) {
      const filePath = this._getDocumentPath(doc)
      if (!isPathInside(filePath, this.uploadsDir)) {
        throw new Error('非法文件路径')
      }
      const buffer = Buffer.from(data.data_base64, 'base64')
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, buffer)
      fileSize = buffer.length
    }

    const stmt = this.db.prepare(`
      UPDATE project_documents
      SET original_filename = ?, file_size = ?, mime_type = ?
      WHERE id = ?
    `)
    stmt.run(
      data.original_filename !== undefined ? data.original_filename : doc.original_filename,
      data.data_base64 !== undefined ? fileSize : (data.file_size !== undefined ? data.file_size : fileSize),
      data.mime_type !== undefined ? data.mime_type : doc.mime_type,
      documentId
    )
    this._finishUpdate('project_documents', documentId)
    return this.getDocumentById(documentId)
  }

  downloadDocument(documentId) {
    const doc = this.getDocumentById(documentId)
    if (!doc) return null

    const filePath = this._getDocumentPath(doc)
    if (!isPathInside(filePath, this.uploadsDir) || !fs.existsSync(filePath)) return null

    const data = fs.readFileSync(filePath)
    return {
      ...doc,
      data: Array.from(data)
    }
  }

  deleteDocument(documentId) {
    return this._recordDeleteSyncChange('project_documents', documentId)
  }

  // ===== Balatro 游戏存档 =====
  getBalatroState(key = 'main') {
    const row = this.db.prepare('SELECT value FROM balatro_state WHERE key = ?').get(key)
    return row ? row.value : null
  }

  saveBalatroState(value, key = 'main') {
    this.db.prepare(`
      INSERT INTO balatro_state (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, typeof value === 'string' ? value : JSON.stringify(value))
    return true
  }

  // ===== 数据导入/导出 =====

  exportData(outputPath) {
    return new Promise((resolve, reject) => {
      // Force WAL checkpoint so all data is written to the main DB file
      try {
        this.db.pragma('wal_checkpoint(TRUNCATE)')
      } catch (err) {
        console.warn('[DatabaseService] WAL checkpoint failed:', err)
      }

      // Create a temp copy to avoid file-locking issues with the open DB
      const tempDb = `${this.dbPath}.export.tmp`
      try {
        fs.copyFileSync(this.dbPath, tempDb)
      } catch (err) {
        return reject(new Error(`无法复制数据库文件: ${err.message}`))
      }

      const output = fs.createWriteStream(outputPath)
      const archive = archiver('zip', { zlib: { level: 9 } })

      output.on('close', () => {
        try { fs.unlinkSync(tempDb) } catch {}
        resolve({ success: true, size: archive.pointer() })
      })

      archive.on('error', (err) => {
        try { fs.unlinkSync(tempDb) } catch {}
        reject(err)
      })

      output.on('error', (err) => {
        try { fs.unlinkSync(tempDb) } catch {}
        reject(err)
      })

      archive.pipe(output)
      archive.file(tempDb, { name: 'database.db' })

      if (fs.existsSync(this.uploadsDir)) {
        archive.directory(this.uploadsDir, 'uploads')
      }
      if (fs.existsSync(this.imagesDir)) {
        archive.directory(this.imagesDir, 'images')
      }

      archive.finalize()
    })
  }

  async importData(inputPath, mode = 'replace') {
    if (mode === 'merge') {
      return this._mergeImport(inputPath)
    }
    return this._replaceImport(inputPath)
  }

  async _replaceImport(inputPath) {
    if (this.importInProgress) {
      return { success: false, error: '已有导入任务正在进行' }
    }

    this.importInProgress = true
    const extractDir = inputPath.endsWith('.zip')
      ? this._tempPath(path.join(path.dirname(inputPath), 'import_extract'), 'tmp')
      : null
    const preparedDb = this._tempPath(this.dbPath, 'import')
    const preparedUploads = this._tempPath(this.uploadsDir, 'import')
    const preparedImages = this._tempPath(this.imagesDir, 'import')
    let backupDb = null
    let backupUploads = null
    let backupImages = null
    let shouldReplaceUploads = false
    let shouldReplaceImages = false

    try {
      let importedDb
      if (inputPath.endsWith('.zip')) {
        fs.mkdirSync(extractDir, { recursive: true })
        await this._extractZipSafe(inputPath, extractDir)
        importedDb = path.join(extractDir, 'database.db')

        const importedUploads = path.join(extractDir, 'uploads')
        if (fs.existsSync(importedUploads)) {
          fs.cpSync(importedUploads, preparedUploads, { recursive: true })
          shouldReplaceUploads = true
        }

        const importedImages = path.join(extractDir, 'images')
        if (fs.existsSync(importedImages)) {
          fs.cpSync(importedImages, preparedImages, { recursive: true })
          shouldReplaceImages = true
        }
      } else {
        importedDb = inputPath
      }

      if (!importedDb || !fs.existsSync(importedDb)) {
        throw new Error('导入文件中没有找到数据库')
      }

      const verifyDb = new Database(importedDb, { readonly: true })
      verifyDb.prepare("SELECT name FROM sqlite_master WHERE type='table' LIMIT 1").get()
      verifyDb.close()
      fs.copyFileSync(importedDb, preparedDb)

      if (this.db) {
        this.db.close()
        this.db = null
      }

      backupDb = fs.existsSync(this.dbPath) ? this._tempPath(this.dbPath, 'backup') : null
      backupUploads = fs.existsSync(this.uploadsDir) ? this._tempPath(this.uploadsDir, 'backup') : null
      backupImages = fs.existsSync(this.imagesDir) ? this._tempPath(this.imagesDir, 'backup') : null

      if (backupDb) fs.copyFileSync(this.dbPath, backupDb)
      if (backupUploads) fs.cpSync(this.uploadsDir, backupUploads, { recursive: true })
      if (backupImages) fs.cpSync(this.imagesDir, backupImages, { recursive: true })

      this._removePath(`${this.dbPath}-wal`)
      this._removePath(`${this.dbPath}-shm`)
      this._renameReplacing(preparedDb, this.dbPath)
      if (shouldReplaceUploads) this._renameReplacing(preparedUploads, this.uploadsDir)
      if (shouldReplaceImages) this._renameReplacing(preparedImages, this.imagesDir)

      this.initialize()

      // Verify imported data
      const projectCount = this.db.prepare('SELECT COUNT(*) as count FROM projects').get().count
      const docCount = this.db.prepare('SELECT COUNT(*) as count FROM project_documents').get().count
      console.error(`[DatabaseService] Import verified: ${projectCount} projects, ${docCount} documents`)

      return { success: true, projectCount, docCount }
    } catch (err) {
      if (!this.db) {
        try {
          if (backupDb && fs.existsSync(backupDb)) this._renameReplacing(backupDb, this.dbPath)
          if (backupUploads && fs.existsSync(backupUploads)) this._renameReplacing(backupUploads, this.uploadsDir)
          if (backupImages && fs.existsSync(backupImages)) this._renameReplacing(backupImages, this.imagesDir)
          if (fs.existsSync(this.dbPath)) this.initialize()
        } catch (recoverErr) {
          return { success: false, error: `${err.message}; 恢复失败: ${recoverErr.message}` }
        }
      }
      return { success: false, error: err.message }
    } finally {
      this.importInProgress = false
      this._removePath(extractDir)
      this._removePath(preparedDb)
      this._removePath(preparedUploads)
      this._removePath(preparedImages)
    }
  }

  async _mergeImport(inputPath) {
    if (this.importInProgress) {
      return { success: false, error: '已有导入任务正在进行' }
    }

    this.importInProgress = true
    const extractDir = path.join(path.dirname(inputPath), `merge_extract_${Date.now()}`)
    fs.mkdirSync(extractDir, { recursive: true })

    try {
      let tempDbPath
      let tempUploadsDir

      if (inputPath.endsWith('.zip')) {
        await this._extractZipSafe(inputPath, extractDir)
        tempDbPath = path.join(extractDir, 'database.db')
        tempUploadsDir = path.join(extractDir, 'uploads')
      } else {
        tempDbPath = path.join(extractDir, 'imported.db')
        fs.copyFileSync(inputPath, tempDbPath)
        tempUploadsDir = null
      }

      if (!fs.existsSync(tempDbPath)) {
        throw new Error('导入文件中没有找到数据库')
      }

      const tempDb = new Database(tempDbPath, { readonly: true })
      let transactionStarted = false

      try {
        this.db.exec('BEGIN IMMEDIATE')
        transactionStarted = true

        const backupProjects = tempDb.prepare('SELECT * FROM projects').all()
        const backupTasks = tempDb.prepare('SELECT * FROM tasks').all()
        const backupDocs = tempDb.prepare('SELECT * FROM project_documents').all()
        const backupDailyTasks = tempDb.prepare('SELECT * FROM daily_tasks').all()

        const getBackupTable = (tableName) => {
          const table = tempDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(tableName)
          if (!table) return []
          return tempDb.prepare(`SELECT * FROM ${tableName}`).all()
        }

        const backupHabits = getBackupTable('habits')
        const backupHabitCheckins = getBackupTable('habit_checkins')
        const backupDesktopNotes = getBackupTable('desktop_notes')
        const backupCategories = getBackupTable('categories')
        const backupAppleNoteLinks = getBackupTable('apple_note_links')
        const backupNoteProjectLinks = getBackupTable('note_project_links')
        const backupTaskCompletions = getBackupTable('task_completions')
        const backupDailyTaskSubtasks = getBackupTable('daily_task_subtasks')
        const backupDailyTaskRepeatRules = getBackupTable('daily_task_repeat_rules')
        const backupTaskViews = getBackupTable('task_views')

        const projectIdMap = {}
        const taskIdMap = {}
        const dailyTaskIdMap = {}
        const habitIdMap = {}
        const noteIdMap = {}

        for (const bp of backupProjects) {
          const existing = this.db.prepare('SELECT * FROM projects WHERE name = ?').get(bp.name)
          let projectId

          if (!existing) {
            const result = this.db.prepare(`
              INSERT INTO projects (name, description, status, priority, start_date, due_date, overview, progress, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              bp.name,
              bp.description || '',
              bp.status || '未开始',
              bp.priority || '中',
              bp.start_date || null,
              bp.due_date || null,
              bp.overview || '',
              bp.progress || '',
              bp.created_at || new Date().toISOString(),
              bp.updated_at || new Date().toISOString()
            )
            projectId = result.lastInsertRowid
          } else {
            this.db.prepare(`
              UPDATE projects SET
                description = COALESCE(?, description),
                status = COALESCE(?, status),
                priority = COALESCE(?, priority),
                start_date = COALESCE(?, start_date),
                due_date = COALESCE(?, due_date),
                overview = COALESCE(?, overview),
                progress = COALESCE(?, progress),
                updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `).run(
              bp.description,
              bp.status,
              bp.priority,
              bp.start_date,
              bp.due_date,
              bp.overview,
              bp.progress,
              existing.id
            )
            projectId = existing.id
          }

          projectIdMap[bp.id] = projectId

          // Merge tasks
          const projectTasks = backupTasks.filter(t => t.project_id === bp.id)
          for (const bt of projectTasks) {
            const existingTask = this.db.prepare('SELECT * FROM tasks WHERE project_id = ? AND name = ?').get(projectId, bt.name)
            let taskId
            if (!existingTask) {
              const isCompleted = bt.status === '已完成'
              const taskResult = this.db.prepare(`
                INSERT INTO tasks (
                  project_id, name, status, priority, assignee, due_date,
                  description, tags, sort_order, is_archived, completed_at,
                  created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).run(
                projectId,
                bt.name,
                bt.status || '待办',
                bt.priority || '中',
                bt.assignee || '',
                bt.due_date || null,
                bt.description || '',
                bt.tags || '',
                bt.sort_order || 0,
                bt.is_archived ? 1 : 0,
                bt.completed_at || (isCompleted ? (bt.updated_at || new Date().toISOString()) : null),
                bt.created_at || new Date().toISOString(),
                bt.updated_at || new Date().toISOString()
              )
              taskId = taskResult.lastInsertRowid
            } else {
              taskId = existingTask.id
            }
            taskIdMap[bt.id] = taskId
          }

          // Merge documents
          const projectDocs = backupDocs.filter(d => d.project_id === bp.id)
          for (const bd of projectDocs) {
            const existingDoc = this.db.prepare('SELECT * FROM project_documents WHERE project_id = ? AND original_filename = ?').get(projectId, bd.original_filename)
            if (!existingDoc) {
              let newFilename = sanitizeFilename(bd.filename)
              if (tempUploadsDir) {
                const sourcePath = this._findFileInDir(tempUploadsDir, newFilename)
                if (sourcePath) {
                  newFilename = this._copyImportedFile(sourcePath, tempUploadsDir, projectId, newFilename)
                }
              }

              this.db.prepare(`
                INSERT INTO project_documents (project_id, filename, original_filename, file_size, mime_type, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
              `).run(
                projectId,
                newFilename,
                bd.original_filename,
                bd.file_size || 0,
                bd.mime_type || '',
                bd.created_at || new Date().toISOString()
              )
            }
          }
        }

        // Merge daily tasks
        for (const bdt of backupDailyTasks) {
          const existingDt = this.db.prepare('SELECT * FROM daily_tasks WHERE title = ? AND date = ?').get(bdt.title, bdt.date)
          if (!existingDt) {
            // 关联项目按导入后的项目 id 映射；找不到映射说明项目不在本次导入中，解除而不是串到别的项目
            const mappedProjectId = bdt.project_id ? (projectIdMap[bdt.project_id] || null) : null
            const dailyTaskResult = this.db.prepare(`
              INSERT INTO daily_tasks (
                title, date, is_completed, priority, estimated_minutes,
                time_spent_seconds, sort_order, is_pinned, tags, notes, completed_at,
                repeat_rule_id, project_id, created_at, updated_at
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              bdt.title,
              bdt.date,
              bdt.is_completed || 0,
              bdt.priority || '中',
              bdt.estimated_minutes || 0,
              bdt.time_spent_seconds || 0,
              bdt.sort_order || 0,
              bdt.is_pinned || 0,
              bdt.tags || '',
              bdt.notes || '',
              bdt.completed_at || null,
              bdt.repeat_rule_id || null,
              mappedProjectId,
              bdt.created_at || new Date().toISOString(),
              bdt.updated_at || bdt.created_at || new Date().toISOString()
            )
            dailyTaskIdMap[bdt.id] = dailyTaskResult.lastInsertRowid
          } else {
            dailyTaskIdMap[bdt.id] = existingDt.id
          }
        }

        // Merge daily task subtasks
        for (const bds of backupDailyTaskSubtasks) {
          const newDailyTaskId = dailyTaskIdMap[bds.daily_task_id]
          if (!newDailyTaskId) continue
          const existingSubtask = this.db.prepare(`
            SELECT id FROM daily_task_subtasks WHERE daily_task_id = ? AND title = ?
          `).get(newDailyTaskId, bds.title)
          if (!existingSubtask) {
            this.db.prepare(`
              INSERT INTO daily_task_subtasks (
                daily_task_id, title, is_completed, sort_order, created_at, updated_at
              )
              VALUES (?, ?, ?, ?, ?, ?)
            `).run(
              newDailyTaskId,
              bds.title || '',
              bds.is_completed || 0,
              bds.sort_order || 0,
              bds.created_at || new Date().toISOString(),
              bds.updated_at || bds.created_at || new Date().toISOString()
            )
          }
        }

        // Merge daily task repeat rules
        for (const brr of backupDailyTaskRepeatRules) {
          const existingRr = this.db.prepare(`
            SELECT * FROM daily_task_repeat_rules
            WHERE title = ? AND repeat_type = ? AND repeat_value = ?
          `).get(brr.title || '', brr.repeat_type || '', brr.repeat_value || '')
          if (!existingRr) {
            const mappedProjectId = brr.project_id ? (projectIdMap[brr.project_id] || null) : null
            this.db.prepare(`
              INSERT INTO daily_task_repeat_rules (
                title, priority, estimated_minutes, tags, notes, repeat_type,
                repeat_value, start_date, end_date, is_active,
                wait_for_completion, skip_overdue, repeat_from_completion, project_id,
                created_at, updated_at
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              brr.title || '',
              brr.priority || '中',
              brr.estimated_minutes || 0,
              brr.tags || '',
              brr.notes || '',
              brr.repeat_type || 'daily',
              brr.repeat_value || '',
              brr.start_date || new Date().toISOString(),
              brr.end_date || null,
              brr.is_active !== undefined ? brr.is_active : 1,
              brr.wait_for_completion !== undefined ? (brr.wait_for_completion ? 1 : 0) : 0,
              brr.skip_overdue !== undefined ? (brr.skip_overdue ? 1 : 0) : 1,
              brr.repeat_from_completion !== undefined ? (brr.repeat_from_completion ? 1 : 0) : 0,
              mappedProjectId,
              brr.created_at || new Date().toISOString(),
              brr.updated_at || brr.created_at || new Date().toISOString()
            )
          }
        }

        // Merge habits
        for (const bh of backupHabits) {
          const existingHabit = this.db.prepare('SELECT * FROM habits WHERE name = ?').get(bh.name)
          let habitId
          if (!existingHabit) {
            const habitResult = this.db.prepare(`
              INSERT INTO habits (name, color, icon, sort_order, is_archived, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
              bh.name,
              bh.color || '#10b981',
              bh.icon || 'fa-fire',
              bh.sort_order || 0,
              bh.is_archived || 0,
              bh.created_at || new Date().toISOString(),
              bh.updated_at || new Date().toISOString()
            )
            habitId = habitResult.lastInsertRowid
          } else {
            this.db.prepare(`
              UPDATE habits SET
                color = COALESCE(?, color),
                icon = COALESCE(?, icon),
                sort_order = COALESCE(?, sort_order),
                is_archived = COALESCE(?, is_archived),
                updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `).run(
              bh.color,
              bh.icon,
              bh.sort_order,
              bh.is_archived,
              existingHabit.id
            )
            habitId = existingHabit.id
          }
          habitIdMap[bh.id] = habitId
        }

        // Merge habit checkins
        for (const bhc of backupHabitCheckins) {
          const newHabitId = habitIdMap[bhc.habit_id]
          if (!newHabitId) continue
          const existingCheckin = this.db.prepare('SELECT * FROM habit_checkins WHERE habit_id = ? AND checkin_date = ?').get(newHabitId, bhc.checkin_date)
          if (!existingCheckin) {
            this.db.prepare(`
              INSERT INTO habit_checkins (habit_id, checkin_date, level, note, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)
            `).run(
              newHabitId,
              bhc.checkin_date,
              bhc.level || 1,
              bhc.note || '',
              bhc.created_at || new Date().toISOString(),
              bhc.updated_at || new Date().toISOString()
            )
          }
        }

        // Merge desktop notes
        for (const bdn of backupDesktopNotes) {
          const existingNote = this.db.prepare(
            'SELECT * FROM desktop_notes WHERE title = ? AND content = ?'
          ).get(bdn.title || '', bdn.content)

          let noteId
          if (!existingNote) {
            const noteResult = this.db.prepare(`
              INSERT INTO desktop_notes (title, content, width, height, pos_x, pos_y, is_pinned, is_minimized, is_archived, category, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              bdn.title || '',
              bdn.content || '',
              bdn.width || 250,
              bdn.height || 200,
              bdn.pos_x || 0,
              bdn.pos_y || 0,
              bdn.is_pinned || 0,
              bdn.is_minimized || 0,
              bdn.is_archived || 0,
              bdn.category || '',
              bdn.created_at || new Date().toISOString(),
              bdn.updated_at || new Date().toISOString()
            )
            noteId = noteResult.lastInsertRowid
          } else {
            this.db.prepare(`
              UPDATE desktop_notes SET
                width = COALESCE(?, width),
                height = COALESCE(?, height),
                pos_x = COALESCE(?, pos_x),
                pos_y = COALESCE(?, pos_y),
                is_pinned = COALESCE(?, is_pinned),
                is_minimized = COALESCE(?, is_minimized),
                is_archived = COALESCE(?, is_archived),
                category = COALESCE(?, category),
                updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `).run(
              bdn.width,
              bdn.height,
              bdn.pos_x,
              bdn.pos_y,
              bdn.is_pinned,
              bdn.is_minimized,
              bdn.is_archived,
              bdn.category,
              existingNote.id
            )
            noteId = existingNote.id
          }
          noteIdMap[bdn.id] = noteId
        }

        // Merge Apple note links
        for (const banl of backupAppleNoteLinks) {
          const newNoteId = noteIdMap[banl.note_id]
          if (!newNoteId) continue

          const existingLink = this.db.prepare('SELECT * FROM apple_note_links WHERE note_id = ?').get(newNoteId)
          if (!existingLink) {
            this.db.prepare(`
              INSERT INTO apple_note_links (
                note_id, apple_note_id, apple_note_title, last_synced_at, last_synced_hash, last_synced_apple_hash, created_at, updated_at
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              newNoteId,
              banl.apple_note_id,
              banl.apple_note_title || '',
              banl.last_synced_at || null,
              banl.last_synced_hash || '',
              banl.last_synced_apple_hash || '',
              banl.created_at || new Date().toISOString(),
              banl.updated_at || new Date().toISOString()
            )
          }
        }

        // Merge note-project links
        for (const bnpl of backupNoteProjectLinks) {
          const newNoteId = noteIdMap[bnpl.note_id]
          const newProjectId = projectIdMap[bnpl.project_id]
          if (!newNoteId || !newProjectId) continue

          this.db.prepare(`
            INSERT OR IGNORE INTO note_project_links (note_id, project_id, created_at)
            VALUES (?, ?, ?)
          `).run(
            newNoteId,
            newProjectId,
            bnpl.created_at || new Date().toISOString()
          )
        }

        // Merge categories
        for (const bc of backupCategories) {
          this.db.prepare(`
            INSERT OR IGNORE INTO categories (name, created_at)
            VALUES (?, ?)
          `).run(
            bc.name,
            bc.created_at || new Date().toISOString()
          )
        }

        // Merge task board views
        for (const btv of backupTaskViews) {
          const existingView = this.db.prepare(`
            SELECT id FROM task_views WHERE name = ? AND view_type = ?
          `).get(btv.name, btv.view_type || 'board')
          if (!existingView) {
            this.db.prepare(`
              INSERT INTO task_views (
                name, view_type, group_by, filters_json, sort_json,
                visible_fields_json, sort_order, is_builtin, created_at, updated_at
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              btv.name,
              btv.view_type || 'board',
              btv.group_by || 'status',
              btv.filters_json || '{}',
              btv.sort_json || '[]',
              btv.visible_fields_json || '[]',
              btv.sort_order || 0,
              btv.is_builtin ? 1 : 0,
              btv.created_at || new Date().toISOString(),
              btv.updated_at || btv.created_at || new Date().toISOString()
            )
          }
        }

        // Merge task completions
        for (const btc of backupTaskCompletions) {
          const newTaskId = taskIdMap[btc.task_id]
          const newProjectId = projectIdMap[btc.project_id]
          if (!newTaskId || !newProjectId) continue
          const existingCompletion = this.db.prepare('SELECT * FROM task_completions WHERE task_id = ? AND completed_date = ?').get(newTaskId, btc.completed_date)
          if (!existingCompletion) {
            this.db.prepare(`
              INSERT INTO task_completions (task_id, project_id, completed_date, completion_time_minutes, created_at)
              VALUES (?, ?, ?, ?, ?)
            `).run(
              newTaskId,
              newProjectId,
              btc.completed_date,
              btc.completion_time_minutes || null,
              btc.created_at || new Date().toISOString()
            )
          }
        }

        const projectCount = this.db.prepare('SELECT COUNT(*) as count FROM projects').get().count
        const docCount = this.db.prepare('SELECT COUNT(*) as count FROM project_documents').get().count
        const habitCount = this.db.prepare('SELECT COUNT(*) as count FROM habits').get().count
        const noteCount = this.db.prepare('SELECT COUNT(*) as count FROM desktop_notes').get().count
        const categoryCount = this.db.prepare('SELECT COUNT(*) as count FROM categories').get().count
        const noteLinkCount = this.db.prepare('SELECT COUNT(*) as count FROM note_project_links').get().count
        const completionCount = this.db.prepare('SELECT COUNT(*) as count FROM task_completions').get().count

        const result = {
          success: true,
          projectCount,
          docCount,
          habitCount,
          noteCount,
          categoryCount,
          noteLinkCount,
          completionCount
        }
        this.db.exec('COMMIT')
        transactionStarted = false
        return result
      } catch (err) {
        if (transactionStarted) {
          this.db.exec('ROLLBACK')
        }
        throw err
      } finally {
        tempDb.close()
      }
    } finally {
      this.importInProgress = false
      if (fs.existsSync(extractDir)) {
        fs.rmSync(extractDir, { recursive: true })
      }
    }
  }
}

module.exports = { DatabaseService }
