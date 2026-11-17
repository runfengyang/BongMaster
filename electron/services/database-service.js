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
const { parseISO, isValid, getISODay, getDate, isWeekend, addDays, addMonths, addYears, format } = require('date-fns')

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

// 打卡暂停区间：「[{ start, end }]」，end 为 null 表示正在暂停。存 JSON 列，只参与整行读取与前端计算。
const WORK_STAMP_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/

function parseWorkPauses(value) {
  let list = value
  if (typeof list === 'string') {
    try { list = JSON.parse(list) } catch { list = [] }
  }
  if (!Array.isArray(list)) return []
  return list
    .map(item => ({
      start: WORK_STAMP_PATTERN.test(String(item?.start || '')) ? item.start : null,
      end: item?.end && WORK_STAMP_PATTERN.test(String(item.end)) ? item.end : null
    }))
    .filter(item => item.start)
    .sort((a, b) => a.start.localeCompare(b.start))
}

function normalizeWorkPauses(value) {
  const list = Array.isArray(value) ? value : []
  return list
    .map(item => ({ start: String(item?.start || ''), end: String(item?.end || '') }))
    .map(item => {
      if (!WORK_STAMP_PATTERN.test(item.start)) throw new Error('暂停时间无效')
      if (item.end && !WORK_STAMP_PATTERN.test(item.end)) throw new Error('暂停时间无效')
      if (item.end && item.end <= item.start) throw new Error('暂停结束时间必须晚于开始时间')
      return { start: item.start, end: item.end || null }
    })
    .sort((a, b) => a.start.localeCompare(b.start))
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
    this.ensureColumn('projects', 'overview', 'TEXT')
    this.ensureColumn('projects', 'progress', 'TEXT')

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
    this.ensureColumn('daily_tasks', 'is_pinned', 'BOOLEAN DEFAULT 0')
    this.ensureColumn('daily_tasks', 'is_completed', 'BOOLEAN DEFAULT 0')
    this.ensureColumn('daily_tasks', 'priority', "TEXT DEFAULT '中'")
    this.ensureColumn('daily_tasks', 'created_at', 'DATETIME')
    this.ensureColumn('daily_tasks', 'estimated_minutes', 'INTEGER DEFAULT 0')
    this.ensureColumn('daily_tasks', 'time_spent_seconds', 'INTEGER DEFAULT 0')
    this.ensureColumn('daily_tasks', 'sort_order', 'INTEGER DEFAULT 0')
    this.ensureColumn('daily_tasks', 'completed_at', 'DATETIME')
    this.ensureColumn('daily_tasks', 'updated_at', 'DATETIME')
    this.ensureColumn('daily_tasks', 'repeat_rule_id', 'INTEGER')
    // 关联项目（可空）：不建外键，项目是软删除，物理删除时才该级联
    this.ensureColumn('daily_tasks', 'project_id', 'INTEGER')

    // 提醒事项扩展字段（列表/分区/时间/旗标/链接/重复/通知）
    this.ensureColumn('daily_tasks', 'list_id', 'INTEGER')
    this.ensureColumn('daily_tasks', 'section_id', 'INTEGER')
    this.ensureColumn('daily_tasks', 'due_time', 'TEXT')
    this.ensureColumn('daily_tasks', 'is_flagged', 'BOOLEAN DEFAULT 0')
    this.ensureColumn('daily_tasks', 'url', "TEXT DEFAULT ''")
    this.ensureColumn('daily_tasks', 'remind_time', 'TEXT')
    this.ensureColumn('daily_tasks', 'reminded_at', 'DATETIME')
    this.ensureColumn('daily_tasks', 'recurrence_type', "TEXT DEFAULT 'none'")
    this.ensureColumn('daily_tasks', 'recurrence_value', "TEXT DEFAULT ''")
    this.ensureColumn('daily_tasks', 'recurrence_end_date', 'DATE')
    this.ensureColumn('daily_tasks', 'repeat_from_completion', 'BOOLEAN DEFAULT 0')
    this.ensureColumn('daily_tasks', 'recurrence_source_id', 'INTEGER')
    // 旧库可能还没有 deleted_at（同步元数据在 runMigrations 末尾才补），索引先用它。
    this.ensureColumn('daily_tasks', 'deleted_at', 'DATETIME')

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
        is_pinned BOOLEAN DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (daily_task_id) REFERENCES daily_tasks(id) ON DELETE CASCADE
      )
    `)
    this.ensureColumn('daily_task_subtasks', 'is_pinned', 'BOOLEAN DEFAULT 0')

    // 应用级元数据（如"今日必做"的每日重置日期）
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `)

    // 提醒事项：列表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reminder_lists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        color TEXT DEFAULT 'blue',
        icon TEXT DEFAULT 'list',
        icon_type TEXT DEFAULT 'list',
        kind TEXT DEFAULT 'standard',
        sort_order INTEGER DEFAULT 0,
        is_pinned BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted_at DATETIME
      )
    `)
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_reminder_lists_order ON reminder_lists(deleted_at, is_pinned, sort_order)')

    // 提醒事项：分区
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reminder_sections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        list_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        is_collapsed BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted_at DATETIME
      )
    `)
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_reminder_sections_list ON reminder_sections(list_id, deleted_at, sort_order)')

    // 提醒事项：附件
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reminder_attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        daily_task_id INTEGER NOT NULL,
        filename TEXT NOT NULL,
        original_filename TEXT NOT NULL,
        file_size INTEGER DEFAULT 0,
        mime_type TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted_at DATETIME
      )
    `)
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_reminder_attachments_task ON reminder_attachments(daily_task_id, deleted_at)')

    // 提醒事项查询索引
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_daily_tasks_list ON daily_tasks(list_id, deleted_at, is_completed);
      CREATE INDEX IF NOT EXISTS idx_daily_tasks_due ON daily_tasks(date, due_time, deleted_at);
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
    this.ensureColumn('desktop_notes', 'is_pinned', 'BOOLEAN DEFAULT 0')
    this.ensureColumn('desktop_notes', 'is_minimized', 'BOOLEAN DEFAULT 0')
    this.ensureColumn('desktop_notes', 'width', 'INTEGER DEFAULT 250')
    this.ensureColumn('desktop_notes', 'height', 'INTEGER DEFAULT 200')
    this.ensureColumn('desktop_notes', 'pos_x', 'INTEGER DEFAULT 0')
    this.ensureColumn('desktop_notes', 'pos_y', 'INTEGER DEFAULT 0')

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

    // 本地日历（不接入遗留同步元数据）
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS calendar_calendars (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        color TEXT NOT NULL DEFAULT '#3b82f6',
        is_visible BOOLEAN DEFAULT 1,
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS calendar_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        calendar_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        kind TEXT DEFAULT 'event',
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        start_time TEXT,
        end_time TEXT,
        all_day BOOLEAN DEFAULT 0,
        location TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        recurrence_type TEXT DEFAULT 'none',
        recurrence_value TEXT DEFAULT '',
        recurrence_end_date DATE,
        reminder_done INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (calendar_id) REFERENCES calendar_calendars(id) ON DELETE RESTRICT
      )
    `)
    if (!this.db.prepare('PRAGMA table_info(calendar_events)').all().some(column => column.name === 'reminder_done')) {
      this.db.exec('ALTER TABLE calendar_events ADD COLUMN reminder_done INTEGER DEFAULT 0')
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS calendar_event_overrides (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        occurrence_date DATE NOT NULL,
        is_cancelled BOOLEAN DEFAULT 0,
        calendar_id INTEGER,
        title TEXT,
        kind TEXT,
        start_date DATE,
        end_date DATE,
        start_time TEXT,
        end_time TEXT,
        all_day BOOLEAN,
        location TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(event_id, occurrence_date),
        FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE CASCADE,
        FOREIGN KEY (calendar_id) REFERENCES calendar_calendars(id) ON DELETE RESTRICT
      )
    `)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS calendar_mac_sync (
        local_key TEXT PRIMARY KEY,
        mac_uid TEXT NOT NULL,
        mac_calendar TEXT DEFAULT '',
        last_local_updated TEXT DEFAULT '',
        last_mac_updated TEXT DEFAULT '',
        synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `)
    try {
      this.db.exec('ALTER TABLE calendar_mac_sync ADD COLUMN mac_calendar TEXT DEFAULT ""')
    } catch {}
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reminder_mac_sync (
        local_id INTEGER PRIMARY KEY,
        mac_id TEXT NOT NULL,
        list_id INTEGER,
        mac_list_name TEXT DEFAULT '',
        last_local_updated TEXT DEFAULT '',
        last_mac_updated TEXT DEFAULT '',
        synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS reminder_mac_lists (
        local_list_id INTEGER PRIMARY KEY,
        mac_list_id TEXT NOT NULL,
        local_name TEXT DEFAULT '',
        mac_name TEXT DEFAULT '',
        synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS work_attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        work_date TEXT NOT NULL UNIQUE,
        check_in_at TEXT,
        check_out_at TEXT,
        note TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS work_attendance_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        work_start TEXT DEFAULT '09:00',
        work_end TEXT DEFAULT '18:00',
        workdays TEXT DEFAULT '1,2,3,4,5',
        grace_minutes INTEGER DEFAULT 5,
        lunch_break_minutes INTEGER DEFAULT 0
      );
      INSERT OR IGNORE INTO work_attendance_settings (id) VALUES (1);
    `)
    try {
      this.db.exec('ALTER TABLE work_attendance ADD COLUMN pauses TEXT DEFAULT "[]"')
    } catch {}
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_calendar_events_dates ON calendar_events(start_date, end_date);
      CREATE INDEX IF NOT EXISTS idx_calendar_events_recurrence ON calendar_events(recurrence_type, recurrence_end_date);
      CREATE INDEX IF NOT EXISTS idx_calendar_overrides_date ON calendar_event_overrides(event_id, occurrence_date);
    `)
    this.db.prepare(`
      INSERT OR IGNORE INTO calendar_calendars (name, color, sort_order) VALUES ('日程', '#3b82f6', 0)
    `).run()
    this.db.prepare(`
      INSERT OR IGNORE INTO calendar_calendars (name, color, sort_order) VALUES ('课程', '#8b5cf6', 1)
    `).run()
    this.db.prepare(`
      INSERT OR IGNORE INTO calendar_calendars (name, color, sort_order) VALUES ('提醒事项', '#bf5af2', 2)
    `).run()

    // Balatro 游戏存档（key-value，主键 'main'）
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS balatro_state (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `)

    // 迁移：将现有的已完成任务导入到 task_completions 表
    this._migrateCompletedTasks()
    // 提醒事项：列表/分区/字段迁移（保留旧 MCP 与统计口径）
    this._migrateRemindersSchema()
    // 增量同步：添加 sync metadata、系统表、UUID backfill（Worker 6）
    this._initializeSyncMetadata()
  }

  // 提醒事项首次迁移：建默认列表、回填 list_id、映射旧字段。
  // ponytail: 无日期用 date='' 而不是 NULL，避免重建 daily_tasks 破坏旧索引/外键；
  // 查询端统一以 date != '' 判有日期。上限是 SQL NULL 语义靠约定，升级路径是重建表并把 date 改为可空。
  _migrateRemindersSchema() {
    const versionRow = this.db.prepare("SELECT value FROM app_meta WHERE key = 'reminders_schema_version'").get()
    if (versionRow && Number(versionRow.value) >= 1) return

    try {
      const backupPath = `${this.dbPath}.pre-reminders.${Date.now()}`
      this.db.exec(`VACUUM INTO '${String(backupPath).replace(/'/g, "''")}'`)
    } catch (err) {
      console.warn('[DatabaseService] reminders backup skipped:', err.message)
    }

    const migrate = this.db.transaction(() => {
      let list = this.db.prepare(
        'SELECT id FROM reminder_lists WHERE deleted_at IS NULL ORDER BY sort_order ASC, id ASC LIMIT 1'
      ).get()
      if (!list) {
        const result = this.db.prepare(`
          INSERT INTO reminder_lists (name, color, icon, icon_type, kind, sort_order)
          VALUES ('提醒事项', 'blue', 'list', 'list', 'standard', 0)
        `).run()
        list = { id: result.lastInsertRowid }
      }

      this.db.prepare('UPDATE daily_tasks SET list_id = ? WHERE list_id IS NULL').run(list.id)
      this.db.prepare('UPDATE daily_tasks SET is_flagged = 1 WHERE is_pinned = 1 AND is_flagged = 0').run()
      // 旧 UI 的「中」是默认值而非用户选择；迁成「无」，避免历史任务全部显示 !!。
      this.db.prepare("UPDATE daily_tasks SET priority = '无' WHERE priority = '中'").run()
      this.db.prepare(`
        INSERT INTO app_meta (key, value) VALUES ('reminders_schema_version', '1')
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run()
    })
    migrate()
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
      SELECT p.*,
        COUNT(t.id) as task_count,
        COALESCE(SUM(CASE WHEN t.status = '已完成' THEN 1 ELSE 0 END), 0) as completed_task_count,
        COALESCE(SUM(CASE WHEN t.status = '进行中' THEN 1 ELSE 0 END), 0) as doing_task_count,
        COALESCE(SUM(CASE WHEN t.status != '已完成' AND t.due_date IS NOT NULL AND date(t.due_date) < date('now') THEN 1 ELSE 0 END), 0) as overdue_task_count
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

  // ===== 本地日历 =====

  getCalendarCalendars() {
    return this.db.prepare('SELECT * FROM calendar_calendars ORDER BY sort_order, id').all()
  }

  createCalendar(data) {
    const name = String(data?.name || '').trim()
    const color = String(data?.color || '#3b82f6')
    if (!name) throw new Error('日历分类名称不能为空')
    if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('日历颜色格式无效')
    const result = this.db.prepare(`
      INSERT INTO calendar_calendars (name, color, is_visible, sort_order)
      VALUES (?, ?, ?, ?)
    `).run(name, color, data?.is_visible === false ? 0 : 1, Number(data?.sort_order) || 0)
    return this.db.prepare('SELECT * FROM calendar_calendars WHERE id = ?').get(result.lastInsertRowid)
  }

  updateCalendar(id, data) {
    const existing = this.db.prepare('SELECT * FROM calendar_calendars WHERE id = ?').get(id)
    if (!existing) throw new Error('日历分类不存在')
    const name = data.name !== undefined ? String(data.name).trim() : existing.name
    const color = data.color || existing.color
    if (['日程', '课程', '提醒事项'].includes(existing.name) && name !== existing.name) throw new Error('不能重命名内置日历分类')
    if (!name) throw new Error('日历分类名称不能为空')
    if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('日历颜色格式无效')
    this.db.prepare(`
      UPDATE calendar_calendars
      SET name = ?, color = ?, is_visible = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      name,
      color,
      data.is_visible !== undefined ? (data.is_visible ? 1 : 0) : existing.is_visible,
      data.sort_order ?? existing.sort_order,
      id
    )
    return this.db.prepare('SELECT * FROM calendar_calendars WHERE id = ?').get(id)
  }

  deleteCalendar(id) {
    const existing = this.db.prepare('SELECT * FROM calendar_calendars WHERE id = ?').get(id)
    if (!existing) return false
    if (existing.name === '日程' || existing.name === '课程' || existing.name === '提醒事项') throw new Error('不能删除内置日历分类')
    const fallback = this.db.prepare("SELECT id FROM calendar_calendars WHERE name = '日程'").get()
    this.db.transaction(() => {
      this.db.prepare('UPDATE calendar_events SET calendar_id = ? WHERE calendar_id = ?').run(fallback.id, id)
      this.db.prepare('UPDATE calendar_event_overrides SET calendar_id = ? WHERE calendar_id = ?').run(fallback.id, id)
      this.db.prepare('DELETE FROM calendar_calendars WHERE id = ?').run(id)
    })()
    return true
  }

  _normalizeCalendarEvent(data = {}, existing = null) {
    const value = key => data[key] !== undefined ? data[key] : existing?.[key]
    const title = String(value('title') || '').trim()
    if (!title) throw new Error('日程标题不能为空')
    const dateOnly = date => {
      const text = String(date || '')
      return /^\d{4}-\d{2}-\d{2}$/.test(text) && isValid(parseISO(text))
    }
    const kind = value('kind') || 'event'
    if (!['event', 'class', 'reminder'].includes(kind)) throw new Error('日程类型无效')
    const startDate = value('start_date')
    const endDate = kind === 'reminder' ? startDate : (value('end_date') || startDate)
    if (!dateOnly(startDate) || !dateOnly(endDate)) throw new Error('日程日期格式无效')
    if (endDate < startDate) throw new Error('结束日期不能早于开始日期')

    const allDay = kind === 'reminder' ? 1 : (value('all_day') ? 1 : 0)
    const startTime = allDay ? null : (value('start_time') || '09:00')
    const endTime = allDay ? null : (value('end_time') || '10:00')
    const timeValid = time => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(time || ''))
    if (!allDay && (!timeValid(startTime) || !timeValid(endTime))) throw new Error('日程时间格式无效')
    if (!allDay && startDate === endDate && endTime <= startTime) throw new Error('结束时间必须晚于开始时间')

    const recurrenceType = value('recurrence_type') || 'none'
    const allowedRecurrence = new Set(['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly', 'lunarYearly'])
    if (!allowedRecurrence.has(recurrenceType)) throw new Error('不支持的重复类型')
    let recurrenceValue = recurrenceType === 'weekly' || recurrenceType === 'lunarYearly' ? String(value('recurrence_value') || '') : ''
    if (recurrenceType === 'weekly') {
      const days = [...new Set(recurrenceValue.split(',').map(Number).filter(day => Number.isInteger(day) && day >= 1 && day <= 7))].sort()
      if (!days.length) throw new Error('每周重复至少选择一天')
      recurrenceValue = days.join(',')
    }
    if (recurrenceType === 'lunarYearly') {
      const [month, day] = recurrenceValue.split(',').map(Number)
      if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(day) || day < 1 || day > 30) {
        throw new Error('农历重复日期无效')
      }
      recurrenceValue = `${month},${day}`
    }
    const recurrenceEnd = recurrenceType === 'none' ? null : (value('recurrence_end_date') || null)
    if (recurrenceEnd && (!dateOnly(recurrenceEnd) || recurrenceEnd < startDate)) throw new Error('重复截止日期无效')

    const calendarId = Number(value('calendar_id') || this.db.prepare("SELECT id FROM calendar_calendars WHERE name = '日程'").get()?.id)
    if (!Number.isInteger(calendarId) || !this.db.prepare('SELECT id FROM calendar_calendars WHERE id = ?').get(calendarId)) {
      throw new Error('日历分类不存在')
    }
    return {
      calendar_id: calendarId,
      title,
      kind,
      start_date: startDate,
      end_date: endDate,
      start_time: startTime,
      end_time: endTime,
      all_day: allDay,
      location: String(value('location') || ''),
      notes: String(value('notes') || ''),
      recurrence_type: recurrenceType,
      recurrence_value: recurrenceValue,
      recurrence_end_date: recurrenceEnd,
      reminder_done: kind === 'reminder' ? (value('reminder_done') ? 1 : 0) : 0
    }
  }

  createCalendarEvent(data) {
    const event = this._normalizeCalendarEvent(data)
    const result = this.db.prepare(`
      INSERT INTO calendar_events (
        calendar_id, title, kind, start_date, end_date, start_time, end_time,
        all_day, location, notes, recurrence_type, recurrence_value, recurrence_end_date,
        reminder_done
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.calendar_id, event.title, event.kind, event.start_date, event.end_date,
      event.start_time, event.end_time, event.all_day, event.location, event.notes,
      event.recurrence_type, event.recurrence_value, event.recurrence_end_date,
      event.reminder_done
    )
    return this.getCalendarEventById(result.lastInsertRowid)
  }

  getCalendarEventById(id) {
    return this.db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(id)
  }

  _shiftCalendarDate(date, days) {
    const value = new Date(`${date}T00:00:00Z`)
    value.setUTCDate(value.getUTCDate() + days)
    return value.toISOString().slice(0, 10)
  }

  _calendarDaysBetween(startDate, endDate) {
    return Math.round((new Date(`${endDate}T00:00:00Z`) - new Date(`${startDate}T00:00:00Z`)) / 86400000)
  }

  _assertCalendarOccurrenceDate(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) || !isValid(parseISO(date))) {
      throw new Error('重复日程操作需要有效的原日期')
    }
  }

  _shiftCalendarRecurrenceDays(value, delta) {
    const days = String(value || '').split(',').map(Number).filter(day => day >= 1 && day <= 7)
    return [...new Set(days.map(day => ((day - 1 + delta) % 7 + 7) % 7 + 1))].sort().join(',')
  }

  _shiftCalendarOverrides(eventId, delta, targetEventId = eventId, fromDate = null) {
    const rows = fromDate
      ? this.db.prepare('SELECT * FROM calendar_event_overrides WHERE event_id = ? AND occurrence_date >= ?').all(eventId, fromDate)
      : this.db.prepare('SELECT * FROM calendar_event_overrides WHERE event_id = ?').all(eventId)
    for (const override of rows) {
      this.db.prepare(`
        UPDATE calendar_event_overrides SET
          event_id = ?, occurrence_date = ?,
          start_date = ?, end_date = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        targetEventId,
        this._shiftCalendarDate(override.occurrence_date, delta),
        override.start_date ? this._shiftCalendarDate(override.start_date, delta) : null,
        override.end_date ? this._shiftCalendarDate(override.end_date, delta) : null,
        override.id
      )
    }
  }

  _moveCalendarSeries(existing, data, scope, options) {
    const delta = Number(data.move_delta_days)
    if (!Number.isInteger(delta)) throw new Error('系列移动天数无效')
    const recurrenceValue = existing.recurrence_type === 'weekly'
      ? this._shiftCalendarRecurrenceDays(existing.recurrence_value, delta)
      : existing.recurrence_value
    if (scope === 'all') {
      return this.db.transaction(() => {
        const result = this.updateCalendarEvent(existing.id, {
          ...data,
          move_delta_days: undefined,
          start_date: this._shiftCalendarDate(existing.start_date, delta),
          end_date: this._shiftCalendarDate(existing.end_date, delta),
          recurrence_value: recurrenceValue,
          recurrence_end_date: existing.recurrence_end_date ? this._shiftCalendarDate(existing.recurrence_end_date, delta) : null
        }, { scope: 'all' })
        this._shiftCalendarOverrides(existing.id, delta)
        return result
      })()
    }

    this._assertCalendarOccurrenceDate(options.occurrenceDate)
    if (options.occurrenceDate <= existing.start_date) {
      return this._moveCalendarSeries(existing, data, 'all', options)
    }
    const duration = this._calendarDaysBetween(existing.start_date, existing.end_date)
    const startDate = this._shiftCalendarDate(options.occurrenceDate, delta)
    return this.db.transaction(() => {
      this.db.prepare(`
        UPDATE calendar_events SET recurrence_end_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(this._shiftCalendarDate(options.occurrenceDate, -1), existing.id)
      const result = this.createCalendarEvent({
        ...existing,
        ...data,
        start_date: startDate,
        end_date: this._shiftCalendarDate(startDate, duration),
        recurrence_value: recurrenceValue,
        recurrence_end_date: existing.recurrence_end_date ? this._shiftCalendarDate(existing.recurrence_end_date, delta) : null
      })
      this._shiftCalendarOverrides(existing.id, delta, result.id, options.occurrenceDate)
      return result
    })()
  }

  updateCalendarEvent(id, data, options = {}) {
    const existing = this.getCalendarEventById(id)
    if (!existing) throw new Error('日程不存在')
    const scope = options.scope || 'all'
    if (data.move_delta_days !== undefined && existing.recurrence_type !== 'none' && ['all', 'future'].includes(scope)) {
      return this._moveCalendarSeries(existing, data, scope, options)
    }
    if (existing.recurrence_type !== 'none' && scope === 'this') {
      this._assertCalendarOccurrenceDate(options.occurrenceDate)
      const occurrenceDate = options.occurrenceDate
      const prior = this.db.prepare(`
        SELECT * FROM calendar_event_overrides WHERE event_id = ? AND occurrence_date = ?
      `).get(id, occurrenceDate)
      const priorValues = prior
        ? Object.fromEntries(Object.entries(prior).filter(([, value]) => value !== null))
        : {}
      const base = { ...existing, ...priorValues }
      const baseStart = prior?.start_date || occurrenceDate
      const duration = this._calendarDaysBetween(base.start_date, base.end_date)
      const startDate = data.start_date ?? baseStart
      const endDate = data.end_date ?? this._shiftCalendarDate(startDate, duration)
      const event = this._normalizeCalendarEvent(
        { ...data, start_date: startDate, end_date: endDate, recurrence_end_date: null },
        { ...base, start_date: baseStart, end_date: this._shiftCalendarDate(baseStart, duration) }
      )
      this.db.prepare(`
        INSERT INTO calendar_event_overrides (
          event_id, occurrence_date, is_cancelled, calendar_id, title, kind,
          start_date, end_date, start_time, end_time, all_day, location, notes
        ) VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(event_id, occurrence_date) DO UPDATE SET
          is_cancelled = 0, calendar_id = excluded.calendar_id, title = excluded.title,
          kind = excluded.kind, start_date = excluded.start_date, end_date = excluded.end_date,
          start_time = excluded.start_time, end_time = excluded.end_time, all_day = excluded.all_day,
          location = excluded.location, notes = excluded.notes, updated_at = CURRENT_TIMESTAMP
      `).run(
        id, occurrenceDate, event.calendar_id, event.title, event.kind, event.start_date,
        event.end_date, event.start_time, event.end_time, event.all_day, event.location, event.notes
      )
      return this.getCalendarEventById(id)
    }

    if (existing.recurrence_type !== 'none' && scope === 'future') {
      this._assertCalendarOccurrenceDate(options.occurrenceDate)
      const occurrenceDate = options.occurrenceDate
      if (occurrenceDate > existing.start_date) {
        const duration = this._calendarDaysBetween(existing.start_date, existing.end_date)
        const startDate = data.start_date && data.start_date !== existing.start_date ? data.start_date : occurrenceDate
        const endDate = data.end_date && data.end_date !== existing.end_date
          ? data.end_date
          : this._shiftCalendarDate(startDate, duration)
        return this.db.transaction(() => {
          this.db.prepare(`
            UPDATE calendar_events SET recurrence_end_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
          `).run(this._shiftCalendarDate(occurrenceDate, -1), id)
          const created = this.createCalendarEvent({
            ...existing,
            ...data,
            start_date: startDate,
            end_date: endDate,
            recurrence_end_date: data.recurrence_end_date ?? existing.recurrence_end_date
          })
          this._shiftCalendarOverrides(id, 0, created.id, occurrenceDate)
          return created
        })()
      }
    }

    const event = this._normalizeCalendarEvent(data, existing)
    this.db.prepare(`
      UPDATE calendar_events SET
        calendar_id = ?, title = ?, kind = ?, start_date = ?, end_date = ?,
        start_time = ?, end_time = ?, all_day = ?, location = ?, notes = ?,
        recurrence_type = ?, recurrence_value = ?, recurrence_end_date = ?,
        reminder_done = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      event.calendar_id, event.title, event.kind, event.start_date, event.end_date,
      event.start_time, event.end_time, event.all_day, event.location, event.notes,
      event.recurrence_type, event.recurrence_value, event.recurrence_end_date, event.reminder_done, id
    )
    if (event.recurrence_type === 'none') {
      this.db.prepare('DELETE FROM calendar_event_overrides WHERE event_id = ?').run(id)
    }
    return this.getCalendarEventById(id)
  }

  deleteCalendarEvent(id, options = {}) {
    const existing = this.getCalendarEventById(id)
    if (!existing) return { type: 'empty', events: [], overrides: [] }
    const scope = options.scope || 'all'
    if (existing.recurrence_type !== 'none' && scope === 'this') {
      this._assertCalendarOccurrenceDate(options.occurrenceDate)
      const previousOverride = this.db.prepare(`
        SELECT * FROM calendar_event_overrides WHERE event_id = ? AND occurrence_date = ?
      `).get(id, options.occurrenceDate) || null
      this.db.prepare(`
        INSERT INTO calendar_event_overrides (event_id, occurrence_date, is_cancelled)
        VALUES (?, ?, 1)
        ON CONFLICT(event_id, occurrence_date) DO UPDATE SET
          is_cancelled = 1, updated_at = CURRENT_TIMESTAMP
      `).run(id, options.occurrenceDate)
      const override = this.db.prepare(`
        SELECT * FROM calendar_event_overrides WHERE event_id = ? AND occurrence_date = ?
      `).get(id, options.occurrenceDate)
      return { type: 'override', events: [], overrides: [override], previousOverride }
    }
    if (existing.recurrence_type !== 'none' && scope === 'future') {
      this._assertCalendarOccurrenceDate(options.occurrenceDate)
      if (options.occurrenceDate > existing.start_date) {
        this.db.prepare(`
          UPDATE calendar_events SET recurrence_end_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
        `).run(this._shiftCalendarDate(options.occurrenceDate, -1), id)
        return { type: 'future', events: [existing], overrides: [] }
      }
    }

    const overrides = this.db.prepare('SELECT * FROM calendar_event_overrides WHERE event_id = ?').all(id)
    this.db.prepare('DELETE FROM calendar_events WHERE id = ?').run(id)
    return { type: 'all', events: [existing], overrides }
  }

  getMacSyncRecords() {
    return this.db.prepare('SELECT * FROM calendar_mac_sync ORDER BY local_key').all()
  }

  saveMacSyncRecords(records = []) {
    if (!Array.isArray(records) || !records.length) return true
    const statement = this.db.prepare(`
      INSERT INTO calendar_mac_sync (local_key, mac_uid, mac_calendar, last_local_updated, last_mac_updated, synced_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(local_key) DO UPDATE SET
        mac_uid = excluded.mac_uid,
        mac_calendar = excluded.mac_calendar,
        last_local_updated = excluded.last_local_updated,
        last_mac_updated = excluded.last_mac_updated,
        synced_at = CURRENT_TIMESTAMP
    `)
    const transaction = this.db.transaction(items => {
      for (const item of items) {
        if (!item?.local_key || !item?.mac_uid) continue
        statement.run(item.local_key, item.mac_uid, String(item.mac_calendar ?? ''), String(item.last_local_updated ?? ''), String(item.last_mac_updated ?? ''))
      }
    })
    transaction(records)
    return true
  }

  deleteMacSyncRecords(keys = []) {
    const list = (Array.isArray(keys) ? keys : []).filter(Boolean)
    if (!list.length) return true
    const statement = this.db.prepare('DELETE FROM calendar_mac_sync WHERE local_key = ?')
    const transaction = this.db.transaction(items => { for (const key of items) statement.run(key) })
    transaction(list)
    return true
  }

  getRemindersForMacSync() {
    return this.db.prepare(`
      ${this._reminderSelect()}
      ORDER BY dt.is_completed ASC, dt.id ASC
    `).all()
  }

  getReminderMacSyncRecords() {
    return this.db.prepare('SELECT * FROM reminder_mac_sync ORDER BY local_id').all()
  }

  saveReminderMacSyncRecords(records = []) {
    if (!Array.isArray(records) || !records.length) return true
    const statement = this.db.prepare(`
      INSERT INTO reminder_mac_sync (local_id, mac_id, list_id, mac_list_name, last_local_updated, last_mac_updated, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(local_id) DO UPDATE SET
        mac_id = excluded.mac_id,
        list_id = excluded.list_id,
        mac_list_name = excluded.mac_list_name,
        last_local_updated = excluded.last_local_updated,
        last_mac_updated = excluded.last_mac_updated,
        synced_at = CURRENT_TIMESTAMP
    `)
    const transaction = this.db.transaction(items => {
      for (const item of items) {
        if (!item?.local_id || !item?.mac_id) continue
        statement.run(
          Number(item.local_id),
          String(item.mac_id),
          item.list_id ? Number(item.list_id) : null,
          String(item.mac_list_name ?? ''),
          String(item.last_local_updated ?? ''),
          String(item.last_mac_updated ?? '')
        )
      }
    })
    transaction(records)
    return true
  }

  deleteReminderMacSyncRecords(localIds = []) {
    const list = (Array.isArray(localIds) ? localIds : []).map(Number).filter(Boolean)
    if (!list.length) return true
    const statement = this.db.prepare('DELETE FROM reminder_mac_sync WHERE local_id = ?')
    const transaction = this.db.transaction(items => { for (const id of items) statement.run(id) })
    transaction(list)
    return true
  }

  getReminderMacListMappings() {
    return this.db.prepare('SELECT * FROM reminder_mac_lists ORDER BY local_list_id').all()
  }

  saveReminderMacListMappings(rows = []) {
    if (!Array.isArray(rows) || !rows.length) return true
    const statement = this.db.prepare(`
      INSERT INTO reminder_mac_lists (local_list_id, mac_list_id, local_name, mac_name, synced_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(local_list_id) DO UPDATE SET
        mac_list_id = excluded.mac_list_id,
        local_name = excluded.local_name,
        mac_name = excluded.mac_name,
        synced_at = CURRENT_TIMESTAMP
    `)
    const transaction = this.db.transaction(items => {
      for (const item of items) {
        if (!item?.local_list_id || !item?.mac_list_id) continue
        statement.run(
          Number(item.local_list_id),
          String(item.mac_list_id),
          String(item.local_name ?? ''),
          String(item.mac_name ?? '')
        )
      }
    })
    transaction(rows)
    return true
  }

  deleteReminderMacListMappings(localListIds = []) {
    const list = (Array.isArray(localListIds) ? localListIds : []).map(Number).filter(Boolean)
    if (!list.length) return true
    const statement = this.db.prepare('DELETE FROM reminder_mac_lists WHERE local_list_id = ?')
    const transaction = this.db.transaction(items => { for (const id of items) statement.run(id) })
    transaction(list)
    return true
  }

  getWorkAttendance(startDate, endDate) {
    return this.db.prepare(`
      SELECT * FROM work_attendance
      WHERE work_date >= ? AND work_date <= ?
      ORDER BY work_date
    `).all(startDate, endDate)
  }

  getWorkAttendanceSettings() {
    const row = this.db.prepare('SELECT * FROM work_attendance_settings WHERE id = 1').get()
    return row || {
      work_start: '09:00', work_end: '18:00', workdays: '1,2,3,4,5',
      grace_minutes: 5, lunch_break_minutes: 0
    }
  }

  saveWorkAttendanceSettings(data = {}) {
    const timeValid = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''))
    const workStart = timeValid(data.work_start) ? data.work_start : '09:00'
    const workEnd = timeValid(data.work_end) ? data.work_end : '18:00'
    const workdays = [...new Set(String(data.workdays || '1,2,3,4,5').split(',').map(Number).filter(day => Number.isInteger(day) && day >= 1 && day <= 7))].sort().join(',') || '1,2,3,4,5'
    const grace = Math.max(0, Math.min(120, Number(data.grace_minutes) || 0))
    const lunch = Math.max(0, Math.min(240, Number(data.lunch_break_minutes) || 0))
    this.db.prepare(`
      UPDATE work_attendance_settings
      SET work_start = ?, work_end = ?, workdays = ?, grace_minutes = ?, lunch_break_minutes = ?
      WHERE id = 1
    `).run(workStart, workEnd, workdays, grace, lunch)
    return this.getWorkAttendanceSettings()
  }

  checkInWork(date, at) {
    const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))
    const stampValid = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(at || ''))
    if (!dateValid || !stampValid) throw new Error('打卡时间无效')
    const existing = this.db.prepare('SELECT * FROM work_attendance WHERE work_date = ?').get(date)
    if (existing) {
      if (!existing.check_in_at) {
        this.db.prepare('UPDATE work_attendance SET check_in_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(at, existing.id)
      }
      return this.db.prepare('SELECT * FROM work_attendance WHERE id = ?').get(existing.id)
    }
    const result = this.db.prepare(`
      INSERT INTO work_attendance (work_date, check_in_at) VALUES (?, ?)
    `).run(date, at)
    return this.db.prepare('SELECT * FROM work_attendance WHERE id = ?').get(result.lastInsertRowid)
  }

  checkOutWork(date, at) {
    if (!WORK_STAMP_PATTERN.test(String(at || ''))) throw new Error('下班时间无效')
    const existing = this.db.prepare('SELECT * FROM work_attendance WHERE work_date = ?').get(date)
    if (!existing?.check_in_at) throw new Error('请先上班打卡')
    if (at <= existing.check_in_at) throw new Error('下班时间必须晚于上班时间')
    const pauses = parseWorkPauses(existing.pauses)
    const open = pauses.find(item => !item.end)
    if (open) {
      if (at > open.start) open.end = at
      else pauses.splice(pauses.indexOf(open), 1)
    }
    this.db.prepare('UPDATE work_attendance SET check_out_at = ?, pauses = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(at, JSON.stringify(pauses), existing.id)
    return this.db.prepare('SELECT * FROM work_attendance WHERE id = ?').get(existing.id)
  }

  pauseWork(date, at) {
    if (!WORK_STAMP_PATTERN.test(String(at || ''))) throw new Error('暂停时间无效')
    const existing = this.db.prepare('SELECT * FROM work_attendance WHERE work_date = ?').get(date)
    if (!existing?.check_in_at) throw new Error('请先上班打卡')
    if (existing.check_out_at) throw new Error('已下班，无法暂停')
    if (at <= existing.check_in_at) throw new Error('暂停时间必须晚于上班时间')
    const pauses = parseWorkPauses(existing.pauses)
    if (pauses.some(item => !item.end)) throw new Error('已在暂停中')
    pauses.push({ start: at, end: null })
    this.db.prepare('UPDATE work_attendance SET pauses = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(JSON.stringify(pauses), existing.id)
    return this.db.prepare('SELECT * FROM work_attendance WHERE id = ?').get(existing.id)
  }

  resumeWork(date, at) {
    if (!WORK_STAMP_PATTERN.test(String(at || ''))) throw new Error('恢复时间无效')
    const existing = this.db.prepare('SELECT * FROM work_attendance WHERE work_date = ?').get(date)
    if (!existing?.check_in_at) throw new Error('请先上班打卡')
    if (existing.check_out_at) throw new Error('已下班，无需恢复')
    const pauses = parseWorkPauses(existing.pauses)
    const open = pauses.find(item => !item.end)
    if (!open) throw new Error('当前未暂停')
    if (at > open.start) open.end = at
    else pauses.splice(pauses.indexOf(open), 1)
    this.db.prepare('UPDATE work_attendance SET pauses = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(JSON.stringify(pauses), existing.id)
    return this.db.prepare('SELECT * FROM work_attendance WHERE id = ?').get(existing.id)
  }

  saveWorkAttendance(data = {}) {
    const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(String(data.work_date || ''))
    const stampValid = value => !value || WORK_STAMP_PATTERN.test(String(value))
    if (!dateValid) throw new Error('打卡日期无效')
    if (!stampValid(data.check_in_at) || !stampValid(data.check_out_at)) throw new Error('打卡时间无效')
    if (data.check_in_at && data.check_out_at && data.check_out_at <= data.check_in_at) throw new Error('下班时间必须晚于上班时间')
    let pausesJson
    if (data.pauses !== undefined) {
      const pauses = normalizeWorkPauses(data.pauses)
      for (const pause of pauses) {
        if (data.check_in_at && pause.start < data.check_in_at) throw new Error('暂停时间必须在上班之后')
        if (data.check_out_at && !pause.end) pause.end = data.check_out_at
        if (data.check_out_at && pause.end > data.check_out_at) throw new Error('暂停时间必须在下班之前')
      }
      pausesJson = JSON.stringify(pauses)
    }
    if (data.id) {
      const existing = this.db.prepare('SELECT * FROM work_attendance WHERE id = ?').get(data.id)
      if (!existing) throw new Error('打卡记录不存在')
      this.db.prepare(`
        UPDATE work_attendance SET work_date = ?, check_in_at = ?, check_out_at = ?, pauses = ?, note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(data.work_date, data.check_in_at || null, data.check_out_at || null, pausesJson === undefined ? (existing.pauses || '[]') : pausesJson, String(data.note || ''), data.id)
      return this.db.prepare('SELECT * FROM work_attendance WHERE id = ?').get(data.id)
    }
    const result = this.db.prepare(`
      INSERT INTO work_attendance (work_date, check_in_at, check_out_at, pauses, note) VALUES (?, ?, ?, ?, ?)
    `).run(data.work_date, data.check_in_at || null, data.check_out_at || null, pausesJson || '[]', String(data.note || ''))
    return this.db.prepare('SELECT * FROM work_attendance WHERE id = ?').get(result.lastInsertRowid)
  }

  deleteWorkAttendance(id) {
    const existing = this.db.prepare('SELECT * FROM work_attendance WHERE id = ?').get(id)
    if (!existing) return false
    this.db.prepare('DELETE FROM work_attendance WHERE id = ?').run(id)
    return true
  }

  restoreCalendarEvents(snapshot) {
    if (!snapshot || snapshot.type === 'empty') return false
    if (snapshot.type === 'override') {
      const override = snapshot.overrides[0]
      const previous = snapshot.previousOverride
      if (previous) {
        this.db.prepare(`
          UPDATE calendar_event_overrides SET
            is_cancelled = ?, calendar_id = ?, title = ?, kind = ?, start_date = ?, end_date = ?,
            start_time = ?, end_time = ?, all_day = ?, location = ?, notes = ?, created_at = ?, updated_at = ?
          WHERE id = ?
        `).run(
          previous.is_cancelled, previous.calendar_id, previous.title, previous.kind,
          previous.start_date, previous.end_date, previous.start_time, previous.end_time,
          previous.all_day, previous.location, previous.notes, previous.created_at, previous.updated_at,
          override.id
        )
      } else {
        this.db.prepare('DELETE FROM calendar_event_overrides WHERE id = ?').run(override.id)
      }
      return true
    }
    if (snapshot.type === 'future') {
      const event = snapshot.events[0]
      this.updateCalendarEvent(event.id, event, { scope: 'all' })
      return true
    }
    this.db.transaction(() => {
      for (const event of snapshot.events) {
        this.db.prepare(`
          INSERT INTO calendar_events (
            id, calendar_id, title, kind, start_date, end_date, start_time, end_time,
            all_day, location, notes, recurrence_type, recurrence_value, recurrence_end_date,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          event.id, event.calendar_id, event.title, event.kind, event.start_date, event.end_date,
          event.start_time, event.end_time, event.all_day, event.location, event.notes,
          event.recurrence_type, event.recurrence_value, event.recurrence_end_date,
          event.created_at, event.updated_at
        )
      }
      for (const override of snapshot.overrides) {
        this.db.prepare(`
          INSERT INTO calendar_event_overrides (
            id, event_id, occurrence_date, is_cancelled, calendar_id, title, kind,
            start_date, end_date, start_time, end_time, all_day, location, notes,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          override.id, override.event_id, override.occurrence_date, override.is_cancelled,
          override.calendar_id, override.title, override.kind, override.start_date, override.end_date,
          override.start_time, override.end_time, override.all_day, override.location, override.notes,
          override.created_at, override.updated_at
        )
      }
    })()
    return true
  }

  getCalendarData(startDate, endDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < startDate) {
      throw new Error('日历查询区间无效')
    }
    const events = this.db.prepare(`
      SELECT DISTINCT e.* FROM calendar_events e
      WHERE (
        e.start_date <= ?
        AND (
          (e.recurrence_type = 'none' AND e.end_date >= ?)
          OR (e.recurrence_type != 'none' AND (e.recurrence_end_date IS NULL OR e.recurrence_end_date >= ?))
        )
      ) OR EXISTS (
        SELECT 1 FROM calendar_event_overrides o
        WHERE o.event_id = e.id
          AND (
            (o.start_date <= ? AND o.end_date >= ?)
            OR o.occurrence_date BETWEEN ? AND ?
          )
      )
      ORDER BY e.start_date, e.start_time, e.id
    `).all(endDate, startDate, startDate, endDate, startDate, startDate, endDate)
    return {
      calendars: this.getCalendarCalendars(),
      events,
      overrides: this.db.prepare('SELECT * FROM calendar_event_overrides ORDER BY occurrence_date, id').all()
    }
  }

  searchCalendarEvents(query) {
    const text = String(query || '').trim()
    if (!text) return []
    const like = `%${text}%`
    return this.db.prepare(`
      SELECT DISTINCT e.* FROM calendar_events e
      LEFT JOIN calendar_event_overrides o ON o.event_id = e.id
      WHERE e.title LIKE ? OR e.location LIKE ? OR e.notes LIKE ?
        OR o.title LIKE ? OR o.location LIKE ? OR o.notes LIKE ?
      ORDER BY e.start_date, e.start_time, e.id
    `).all(like, like, like, like, like, like)
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
      WHERE npl.project_id = ? AND dn.deleted_at IS NULL
      ORDER BY COALESCE(dn.is_archived, 0) ASC, dn.is_pinned DESC, dn.updated_at DESC
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

  getDailyTaskHistoryStats(date) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error(`日期格式无效: ${date}`)
    }
    const [year, month, day] = date.split('-').map(Number)
    const probe = new Date(year, month - 1, day)
    if (
      year < 1900 || year > 9999 ||
      probe.getFullYear() !== year ||
      probe.getMonth() !== month - 1 ||
      probe.getDate() !== day
    ) {
      throw new Error(`日期不存在: ${date}`)
    }

    const completion = this.db.prepare(`
      WITH done AS (
        SELECT
          date(datetime(dt.completed_at, 'localtime')) AS done_day,
          julianday(dt.completed_at) AS done_jd,
          julianday(dt.created_at) AS created_jd
        FROM daily_tasks dt
        WHERE dt.deleted_at IS NULL
          AND dt.is_completed = 1
          AND dt.completed_at IS NOT NULL
          AND date(datetime(dt.completed_at, 'localtime')) <= date('now', 'localtime')
      )
      SELECT
        SUM(CASE WHEN done_day = @date THEN 1 ELSE 0 END) AS today_completed,
        SUM(CASE WHEN done_day BETWEEN date(@date, '-6 days') AND @date THEN 1 ELSE 0 END) AS weekly_completed,
        COUNT(CASE
          WHEN done_day BETWEEN date(@date, '-29 days') AND @date
            AND done_jd - created_jd >= 0
          THEN 1
        END) AS sample_count,
        AVG(CASE
          WHEN done_day BETWEEN date(@date, '-29 days') AND @date
            AND done_jd - created_jd >= 0
          THEN done_jd - created_jd
        END) AS avg_days
      FROM done
    `).get({ date })

    const overdue = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM daily_tasks dt
      WHERE dt.deleted_at IS NULL
        AND dt.is_completed = 0
        AND dt.completed_at IS NULL
        AND dt.date <= @date
        AND datetime(dt.created_at, 'localtime') < datetime(@date, '-7 days')
    `).get({ date }).count

    const weeklyCompleted = completion.weekly_completed || 0
    return {
      todayCompleted: completion.today_completed || 0,
      weeklyDailyAverage: weeklyCompleted / 7,
      averageCompletionDays: completion.avg_days == null ? null : completion.avg_days,
      overdueCount: overdue,
      completionSampleCount: completion.sample_count || 0
    }
  }

  createDailyTask(data, options = {}) {
    const stmt = this.db.prepare(`
      INSERT INTO daily_tasks (
        title, date, is_completed, priority,
        time_spent_seconds, sort_order, is_pinned, tags, notes, completed_at,
        repeat_rule_id, project_id, list_id, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `)
    const result = stmt.run(
      data.title,
      data.date || '',
      data.is_completed ? 1 : 0,
      data.priority || '中',
      Math.max(0, Number(data.time_spent_seconds) || 0),
      Number(data.sort_order) || 0,
      data.is_pinned ? 1 : 0,
      data.tags || '',
      data.notes || '',
      data.is_completed ? new Date().toISOString() : null,
      data.repeat_rule_id || null,
      options.inheritProject
        ? this._inheritDailyTaskProjectId(data.project_id)
        : this._resolveDailyTaskProjectId(data.project_id),
      Number(data.list_id) || this._ensureDefaultReminderList()
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
      INSERT INTO daily_task_subtasks (daily_task_id, title, is_completed, is_pinned, sort_order, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `)
    const result = stmt.run(
      taskId,
      data.title,
      data.is_completed ? 1 : 0,
      data.is_pinned ? 1 : 0,
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
        is_pinned = ?,
        sort_order = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    stmt.run(
      data.title ?? existing.title,
      data.is_completed !== undefined ? (data.is_completed ? 1 : 0) : existing.is_completed,
      data.is_completed ? 0 : (data.is_pinned !== undefined ? (data.is_pinned ? 1 : 0) : existing.is_pinned),
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
        title, priority, tags, notes, repeat_type,
        repeat_value, start_date, end_date, is_active,
        wait_for_completion, skip_overdue, repeat_from_completion, project_id, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `)
    const result = stmt.run(
      data.title,
      data.priority || '中',
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

  // "今日必做"每天自动清空：每天首次访问每日任务时，清掉所有任务/子任务的标记
  resetDailyFocusIfNewDay() {
    const today = this._todayStr()
    const row = this.db.prepare("SELECT value FROM app_meta WHERE key = 'daily_focus_reset_date'").get()
    if (row && row.value === today) return false
    const tx = this.db.transaction(() => {
      this.db.prepare('UPDATE daily_tasks SET is_pinned = 0 WHERE is_pinned = 1').run()
      this.db.prepare('UPDATE daily_task_subtasks SET is_pinned = 0 WHERE is_pinned = 1').run()
      this.db.prepare("INSERT INTO app_meta (key, value) VALUES ('daily_focus_reset_date', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(today)
    })
    tx()
    return true
  }

  generateDailyTasksForDate(date) {
    this.resetDailyFocusIfNewDay()
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

  // ===== 提醒事项：列表 =====

  getReminderLists() {
    return this.db.prepare(`
      SELECT l.*,
        (SELECT COUNT(*) FROM daily_tasks dt
          WHERE dt.list_id = l.id AND dt.deleted_at IS NULL AND dt.is_completed = 0) AS open_count
      FROM reminder_lists l
      WHERE l.deleted_at IS NULL
      ORDER BY l.is_pinned DESC, l.sort_order ASC, l.id ASC
    `).all()
  }

  getReminderListById(id) {
    return this.db.prepare('SELECT * FROM reminder_lists WHERE id = ? AND deleted_at IS NULL').get(id)
  }

  _ensureDefaultReminderList() {
    const existing = this.db.prepare(
      'SELECT id FROM reminder_lists WHERE deleted_at IS NULL ORDER BY is_pinned DESC, sort_order ASC, id ASC LIMIT 1'
    ).get()
    if (existing) return existing.id
    const result = this.db.prepare(`
      INSERT INTO reminder_lists (name, color, icon, icon_type, kind, sort_order)
      VALUES ('提醒事项', 'blue', 'list', 'list', 'standard', 0)
    `).run()
    return Number(result.lastInsertRowid)
  }

  createReminderList(data = {}) {
    const name = String(data.name ?? '新建列表').trim() || '新建列表'
    const nextOrder = this.db.prepare(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM reminder_lists WHERE deleted_at IS NULL'
    ).get().n
    const result = this.db.prepare(`
      INSERT INTO reminder_lists (name, color, icon, icon_type, kind, sort_order, is_pinned)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      name,
      data.color || 'blue',
      data.icon || 'list',
      data.icon_type === 'emoji' ? 'emoji' : 'list',
      data.kind === 'shopping' ? 'shopping' : 'standard',
      Number.isFinite(Number(data.sort_order)) ? Number(data.sort_order) : nextOrder,
      data.is_pinned ? 1 : 0
    )
    return this.getReminderListById(result.lastInsertRowid)
  }

  updateReminderList(id, data = {}) {
    const existing = this.getReminderListById(id)
    if (!existing) return null
    this.db.prepare(`
      UPDATE reminder_lists SET
        name = ?, color = ?, icon = ?, icon_type = ?, kind = ?,
        sort_order = ?, is_pinned = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      data.name !== undefined ? (String(data.name).trim() || existing.name) : existing.name,
      data.color ?? existing.color,
      data.icon ?? existing.icon,
      data.icon_type !== undefined ? (data.icon_type === 'emoji' ? 'emoji' : 'list') : existing.icon_type,
      data.kind !== undefined ? (data.kind === 'shopping' ? 'shopping' : 'standard') : existing.kind,
      data.sort_order !== undefined ? Number(data.sort_order) || 0 : existing.sort_order,
      data.is_pinned !== undefined ? (data.is_pinned ? 1 : 0) : existing.is_pinned,
      id
    )
    return this.getReminderListById(id)
  }

  deleteReminderList(id) {
    let moved = 0
    const tx = this.db.transaction(() => {
      const reminders = this.db.prepare(
        'SELECT id FROM daily_tasks WHERE list_id = ? AND deleted_at IS NULL'
      ).all(id)
      for (const reminder of reminders) {
        this.db.prepare(
          'UPDATE daily_task_subtasks SET deleted_at = CURRENT_TIMESTAMP WHERE daily_task_id = ? AND deleted_at IS NULL'
        ).run(reminder.id)
        this.db.prepare(
          'UPDATE daily_tasks SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?'
        ).run(reminder.id)
        moved += 1
      }
      this.db.prepare(
        'UPDATE reminder_lists SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(id)
      this._ensureDefaultReminderList()
    })
    tx()
    return { success: true, moved }
  }

  reorderReminderLists(orderedIds) {
    const stmt = this.db.prepare(
      'UPDATE reminder_lists SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    )
    const tx = this.db.transaction((ids) => {
      ids.forEach((id, index) => stmt.run(index, id))
    })
    tx(orderedIds)
    return { success: true }
  }

  // ===== 提醒事项：分区 =====

  getReminderSections(listId = null) {
    if (listId) {
      return this.db.prepare(`
        SELECT * FROM reminder_sections
        WHERE list_id = ? AND deleted_at IS NULL
        ORDER BY sort_order ASC, id ASC
      `).all(listId)
    }
    return this.db.prepare(`
      SELECT * FROM reminder_sections
      WHERE deleted_at IS NULL
      ORDER BY list_id ASC, sort_order ASC, id ASC
    `).all()
  }

  getReminderSectionById(id) {
    return this.db.prepare('SELECT * FROM reminder_sections WHERE id = ? AND deleted_at IS NULL').get(id)
  }

  createReminderSection(listId, data = {}) {
    const name = String(data.name ?? '新建分区').trim() || '新建分区'
    const nextOrder = this.db.prepare(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM reminder_sections WHERE list_id = ? AND deleted_at IS NULL'
    ).get(listId).n
    const result = this.db.prepare(`
      INSERT INTO reminder_sections (list_id, name, sort_order, is_collapsed)
      VALUES (?, ?, ?, 0)
    `).run(listId, name, nextOrder)
    return this.getReminderSectionById(result.lastInsertRowid)
  }

  updateReminderSection(id, data = {}) {
    const existing = this.getReminderSectionById(id)
    if (!existing) return null
    this.db.prepare(`
      UPDATE reminder_sections SET
        name = ?, sort_order = ?, is_collapsed = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      data.name !== undefined ? (String(data.name).trim() || existing.name) : existing.name,
      data.sort_order !== undefined ? Number(data.sort_order) || 0 : existing.sort_order,
      data.is_collapsed !== undefined ? (data.is_collapsed ? 1 : 0) : existing.is_collapsed,
      id
    )
    return this.getReminderSectionById(id)
  }

  deleteReminderSection(id) {
    const reminderIds = this.db.prepare(
      'SELECT id FROM daily_tasks WHERE section_id = ? AND deleted_at IS NULL'
    ).all(id).map(row => Number(row.id))
    const tx = this.db.transaction(() => {
      this.db.prepare(
        'UPDATE daily_tasks SET section_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE section_id = ? AND deleted_at IS NULL'
      ).run(id)
      this.db.prepare(
        'UPDATE reminder_sections SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(id)
    })
    tx()
    return { success: true, reminderIds }
  }

  restoreReminderSection(id, reminderIds = []) {
    const section = this.db.prepare('SELECT * FROM reminder_sections WHERE id = ?').get(id)
    if (!section) return null
    this.db.prepare(
      'UPDATE reminder_sections SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(id)
    const ids = [...new Set(
      (Array.isArray(reminderIds) ? reminderIds : [])
        .map(value => Number(value))
        .filter(value => Number.isInteger(value) && value > 0)
    )]
    if (ids.length) {
      const statement = this.db.prepare(`
        UPDATE daily_tasks SET section_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND deleted_at IS NULL AND section_id IS NULL
      `)
      const transaction = this.db.transaction(() => {
        for (const reminderId of ids) statement.run(id, reminderId)
      })
      transaction()
    }
    return this.getReminderSectionById(id)
  }

  reorderReminderSections(listId, orderedIds) {
    const stmt = this.db.prepare(
      'UPDATE reminder_sections SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND list_id = ?'
    )
    const tx = this.db.transaction((ids) => {
      ids.forEach((id, index) => stmt.run(index, id, listId))
    })
    tx(orderedIds)
    return { success: true }
  }

  // ===== 提醒事项：主体 =====

  _reminderSelect() {
    return `
      SELECT dt.*,
        COALESCE(l.name, '') AS list_name,
        COALESCE(l.color, 'blue') AS list_color,
        COALESCE(l.icon, 'list') AS list_icon,
        COALESCE(l.icon_type, 'list') AS list_icon_type,
        COALESCE(l.kind, 'standard') AS list_kind,
        COALESCE(s.name, '') AS section_name,
        (SELECT COUNT(*) FROM reminder_attachments ra
          WHERE ra.daily_task_id = dt.id AND ra.deleted_at IS NULL) AS attachment_count
      FROM daily_tasks dt
      LEFT JOIN reminder_lists l ON l.id = dt.list_id AND l.deleted_at IS NULL
      LEFT JOIN reminder_sections s ON s.id = dt.section_id AND s.deleted_at IS NULL
    `
  }

  getAllReminders() {
    return this.db.prepare(`
      ${this._reminderSelect()}
      WHERE dt.deleted_at IS NULL
      ORDER BY dt.is_completed ASC, dt.is_flagged DESC, dt.sort_order ASC, dt.created_at DESC
    `).all()
  }

  getReminderById(id) {
    return this.db.prepare(`
      ${this._reminderSelect()}
      WHERE dt.id = ? AND dt.deleted_at IS NULL
    `).get(id)
  }

  createReminder(data = {}) {
    const title = String(data.title ?? '').trim()
    if (!title) throw new Error('提醒事项标题不能为空')

    const listId = Number(data.list_id) || this._ensureDefaultReminderList()
    let sectionId = data.section_id ? Number(data.section_id) : null
    if (sectionId) {
      const section = this.db.prepare(
        'SELECT id FROM reminder_sections WHERE id = ? AND list_id = ? AND deleted_at IS NULL'
      ).get(sectionId, listId)
      if (!section) sectionId = null
    }

    const sortOrder = data.sort_order !== undefined
      ? Number(data.sort_order) || 0
      : this.db.prepare(
        'SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM daily_tasks WHERE list_id = ? AND deleted_at IS NULL'
      ).get(listId).n
    const completed = data.is_completed ? 1 : 0
    const now = new Date().toISOString()

    const result = this.db.prepare(`
      INSERT INTO daily_tasks (
        title, date, due_time, is_completed, priority, sort_order, is_pinned,
        is_flagged, tags, notes, url, completed_at, repeat_rule_id, project_id,
        list_id, section_id, remind_time, reminded_at,
        recurrence_type, recurrence_value, recurrence_end_date,
        repeat_from_completion, recurrence_source_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      title,
      data.date ? String(data.date) : '',
      data.due_time ? String(data.due_time) : null,
      completed,
      data.priority || '无',
      sortOrder,
      data.is_flagged ? 1 : 0,
      data.tags || '',
      data.notes || '',
      data.url || '',
      completed ? (data.completed_at || now) : null,
      this._inheritDailyTaskProjectId(data.project_id ? Number(data.project_id) : null),
      listId,
      sectionId,
      data.remind_time ? String(data.remind_time) : null,
      data.reminded_at || null,
      data.recurrence_type || 'none',
      data.recurrence_value || '',
      data.recurrence_end_date || null,
      data.repeat_from_completion ? 1 : 0,
      data.recurrence_source_id ? Number(data.recurrence_source_id) : null
    )

    this._finishCreate('daily_tasks', result.lastInsertRowid)
    return this.getReminderById(result.lastInsertRowid)
  }

  updateReminder(id, data = {}) {
    const existing = this.getReminderById(id)
    if (!existing) return null

    const dateChanged = data.date !== undefined && String(data.date || '') !== String(existing.date || '')
    const timeChanged = (data.due_time !== undefined && (data.due_time || null) !== (existing.due_time || null))
      || (data.remind_time !== undefined && (data.remind_time || null) !== (existing.remind_time || null))

    const listId = data.list_id !== undefined
      ? (Number(data.list_id) || this._ensureDefaultReminderList())
      : existing.list_id
    let sectionId = data.section_id !== undefined
      ? (data.section_id ? Number(data.section_id) : null)
      : existing.section_id
    if (data.list_id !== undefined && data.section_id === undefined) sectionId = null
    if (sectionId) {
      const section = this.db.prepare(
        'SELECT id FROM reminder_sections WHERE id = ? AND list_id = ? AND deleted_at IS NULL'
      ).get(sectionId, listId)
      if (!section) sectionId = null
    }

    const nextCompleted = data.is_completed !== undefined ? !!data.is_completed : !!existing.is_completed
    const completedAt = nextCompleted
      ? (data.completed_at !== undefined ? data.completed_at : (existing.completed_at || new Date().toISOString()))
      : null
    const projectId = data.project_id !== undefined
      ? (data.project_id === null || data.project_id === ''
        ? null
        : this._inheritDailyTaskProjectId(Number(data.project_id)))
      : existing.project_id
    const remindedAt = (dateChanged || timeChanged)
      ? null
      : (data.reminded_at !== undefined ? data.reminded_at : existing.reminded_at)

    this.db.prepare(`
      UPDATE daily_tasks SET
        title = ?, date = ?, due_time = ?, is_completed = ?, completed_at = ?,
        priority = ?, is_flagged = ?, tags = ?, notes = ?, url = ?,
        list_id = ?, section_id = ?, remind_time = ?, reminded_at = ?,
        recurrence_type = ?, recurrence_value = ?, recurrence_end_date = ?,
        repeat_from_completion = ?, recurrence_source_id = ?, project_id = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      data.title !== undefined ? (String(data.title).trim() || existing.title) : existing.title,
      data.date !== undefined ? String(data.date || '') : existing.date,
      data.due_time !== undefined ? (data.due_time || null) : existing.due_time,
      nextCompleted ? 1 : 0,
      completedAt,
      data.priority ?? existing.priority ?? '无',
      data.is_flagged !== undefined ? (data.is_flagged ? 1 : 0) : existing.is_flagged,
      data.tags ?? existing.tags ?? '',
      data.notes ?? existing.notes ?? '',
      data.url ?? existing.url ?? '',
      listId,
      sectionId,
      data.remind_time !== undefined ? (data.remind_time || null) : existing.remind_time,
      remindedAt,
      data.recurrence_type ?? existing.recurrence_type ?? 'none',
      data.recurrence_value ?? existing.recurrence_value ?? '',
      data.recurrence_end_date !== undefined ? (data.recurrence_end_date || null) : existing.recurrence_end_date,
      data.repeat_from_completion !== undefined
        ? (data.repeat_from_completion ? 1 : 0)
        : existing.repeat_from_completion,
      data.recurrence_source_id !== undefined ? data.recurrence_source_id : existing.recurrence_source_id,
      projectId,
      id
    )

    this._finishUpdate('daily_tasks', id)
    return this.getReminderById(id)
  }

  _formatDateKey(date) {
    return format(date, 'yyyy-MM-dd')
  }

  // 重复提醒的下一次日期；返回 null 表示不再生成。
  _nextReminderDate(reminder, completionDate = null) {
    const type = reminder.recurrence_type || 'none'
    if (type === 'none') return null

    const baseKey = (reminder.repeat_from_completion && completionDate)
      ? completionDate
      : (reminder.date || completionDate || this._todayStr())
    const base = parseISO(baseKey)
    if (!isValid(base)) return null

    let next = null
    switch (type) {
      case 'daily':
        next = addDays(base, 1)
        break
      case 'weekdays': {
        let candidate = addDays(base, 1)
        while (isWeekend(candidate)) candidate = addDays(candidate, 1)
        next = candidate
        break
      }
      case 'weekly': {
        const wanted = String(reminder.recurrence_value || '')
          .split(/[,，]/)
          .map(value => parseInt(value.trim(), 10))
          .filter(value => Number.isInteger(value) && value >= 1 && value <= 7)
        const targets = wanted.length ? wanted : [getISODay(base)]
        let candidate = addDays(base, 1)
        for (let i = 0; i < 14; i += 1) {
          if (targets.includes(getISODay(candidate))) {
            next = candidate
            break
          }
          candidate = addDays(candidate, 1)
        }
        break
      }
      case 'monthly':
        next = addMonths(base, 1)
        break
      case 'yearly':
        next = addYears(base, 1)
        break
      case 'custom': {
        const [rawCount, unit] = String(reminder.recurrence_value || '').split(':')
        const count = Math.max(1, parseInt(rawCount, 10) || 1)
        if (unit === 'weeks') next = addDays(base, 7 * count)
        else if (unit === 'months') next = addMonths(base, count)
        else if (unit === 'years') next = addYears(base, count)
        else next = addDays(base, count)
        break
      }
      default:
        return null
    }

    if (!next || !isValid(next)) return null
    const nextKey = this._formatDateKey(next)
    if (nextKey <= baseKey) return null
    if (reminder.recurrence_end_date && nextKey > reminder.recurrence_end_date) return null
    return nextKey
  }

  toggleReminderComplete(id, isCompleted) {
    const existing = this.getReminderById(id)
    if (!existing) return null

    const now = new Date().toISOString()
    this.db.prepare(`
      UPDATE daily_tasks SET is_completed = ?, completed_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(isCompleted ? 1 : 0, isCompleted ? now : null, id)
    this._finishUpdate('daily_tasks', id)

    let next = null
    if (isCompleted && existing.recurrence_type && existing.recurrence_type !== 'none') {
      const existingChild = this.db.prepare(
        'SELECT id FROM daily_tasks WHERE recurrence_source_id = ? AND deleted_at IS NULL LIMIT 1'
      ).get(id)
      if (!existingChild) {
        const nextDate = this._nextReminderDate(existing, this._todayStr())
        if (nextDate) {
          try {
            next = this.createReminder({
              ...existing,
              date: nextDate,
              is_completed: 0,
              completed_at: null,
              reminded_at: null,
              recurrence_source_id: id,
              sort_order: undefined
            })
          } catch (err) {
            console.warn('[DatabaseService] create next reminder failed:', err.message)
          }
        }
      }
    }

    return { reminder: this.getReminderById(id), next }
  }

  deleteReminder(id) {
    return this.deleteDailyTask(id)
  }

  restoreReminders(ids) {
    if (!Array.isArray(ids) || !ids.length) return { restored: 0 }
    const defaultListId = this._ensureDefaultReminderList()
    const tx = this.db.transaction((taskIds) => {
      const restoreTask = this.db.prepare(`
        UPDATE daily_tasks SET
          deleted_at = NULL,
          list_id = CASE
            WHEN list_id IS NULL OR list_id NOT IN (SELECT id FROM reminder_lists WHERE deleted_at IS NULL)
            THEN ?
            ELSE list_id
          END,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      const subtaskIds = this.db.prepare(
        'SELECT id FROM daily_task_subtasks WHERE daily_task_id = ? AND deleted_at IS NOT NULL'
      )
      const restoreSubtask = this.db.prepare(
        'UPDATE daily_task_subtasks SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      )
      for (const taskId of taskIds) {
        restoreTask.run(defaultListId, taskId)
        for (const subtask of subtaskIds.all(taskId)) restoreSubtask.run(subtask.id)
      }
    })
    tx(ids)
    return { restored: ids.length }
  }

  reorderReminders(orderedIds, sectionId = undefined) {
    const updateSort = this.db.prepare(
      'UPDATE daily_tasks SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    )
    const updateSection = this.db.prepare(
      'UPDATE daily_tasks SET section_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    )
    const tx = this.db.transaction((ids) => {
      ids.forEach((id, index) => {
        updateSort.run(index, id)
        if (sectionId !== undefined) updateSection.run(sectionId || null, id)
      })
    })
    tx(orderedIds)
    return { success: true }
  }

  moveRemindersToList(ids, listId, sectionId = null) {
    const targetListId = Number(listId) || this._ensureDefaultReminderList()
    const tx = this.db.transaction((taskIds) => {
      const statement = this.db.prepare(`
        UPDATE daily_tasks SET list_id = ?, section_id = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      const start = this.db.prepare(
        'SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM daily_tasks WHERE list_id = ? AND deleted_at IS NULL'
      ).get(targetListId).n
      taskIds.forEach((id, index) => statement.run(targetListId, sectionId || null, start + index, id))
    })
    tx(ids)
    return { success: true }
  }

  clearCompletedReminders(listId = null, completedBefore = null) {
    const conditions = ['is_completed = 1', 'deleted_at IS NULL']
    const params = []
    if (listId) {
      conditions.push('list_id = ?')
      params.push(listId)
    }
    if (completedBefore) {
      conditions.push('completed_at IS NOT NULL')
      conditions.push('datetime(completed_at) <= datetime(?)')
      params.push(completedBefore)
    }
    const rows = this.db.prepare(
      `SELECT id FROM daily_tasks WHERE ${conditions.join(' AND ')}`
    ).all(...params)
    const ids = rows.map(row => row.id)
    if (!ids.length) return { ids: [] }

    const tx = this.db.transaction((taskIds) => {
      const subtask = this.db.prepare(
        'UPDATE daily_task_subtasks SET deleted_at = CURRENT_TIMESTAMP WHERE daily_task_id = ? AND deleted_at IS NULL'
      )
      const task = this.db.prepare(
        'UPDATE daily_tasks SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?'
      )
      for (const id of taskIds) {
        subtask.run(id)
        task.run(id)
      }
    })
    tx(ids)
    return { ids }
  }

  duplicateReminder(id) {
    const existing = this.getReminderById(id)
    if (!existing) return null
    return this.createReminder({
      ...existing,
      is_completed: 0,
      completed_at: null,
      reminded_at: null,
      recurrence_source_id: null,
      sort_order: undefined
    })
  }

  getRecentlyDeletedReminders(limit = 200) {
    this.purgeExpiredReminders()
    return this.db.prepare(`
      SELECT dt.*,
        COALESCE(l.name, '') AS list_name,
        COALESCE(l.color, 'blue') AS list_color,
        COALESCE(l.icon, 'list') AS list_icon,
        COALESCE(l.icon_type, 'list') AS list_icon_type
      FROM daily_tasks dt
      LEFT JOIN reminder_lists l ON l.id = dt.list_id
      WHERE dt.deleted_at IS NOT NULL
      ORDER BY dt.deleted_at DESC
      LIMIT ?
    `).all(limit)
  }

  purgeExpiredReminders() {
    const rows = this.db.prepare(`
      SELECT id FROM daily_tasks
      WHERE deleted_at IS NOT NULL AND datetime(deleted_at) < datetime('now', '-30 days')
    `).all()
    for (const row of rows) this.purgeReminder(row.id)
    return { purged: rows.length }
  }

  purgeReminder(id) {
    const attachments = this.db.prepare(
      'SELECT * FROM reminder_attachments WHERE daily_task_id = ?'
    ).all(id)
    for (const attachment of attachments) {
      try {
        fs.rmSync(this.getReminderAttachmentPath(attachment), { force: true })
      } catch {}
    }
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM reminder_attachments WHERE daily_task_id = ?').run(id)
      this.db.prepare('DELETE FROM daily_task_subtasks WHERE daily_task_id = ?').run(id)
      this.db.prepare('DELETE FROM daily_tasks WHERE id = ?').run(id)
    })
    tx()
    return { success: true }
  }

  // ===== 提醒事项：附件 =====

  _reminderAttachmentDir(reminderId) {
    return path.join(this.uploadsDir, 'reminders', String(reminderId))
  }

  getReminderAttachments(reminderId) {
    return this.db.prepare(`
      SELECT * FROM reminder_attachments
      WHERE daily_task_id = ? AND deleted_at IS NULL
      ORDER BY created_at ASC, id ASC
    `).all(reminderId)
  }

  getReminderAttachmentById(id) {
    return this.db.prepare(
      'SELECT * FROM reminder_attachments WHERE id = ? AND deleted_at IS NULL'
    ).get(id)
  }

  getReminderAttachmentPath(attachment) {
    const dir = this._reminderAttachmentDir(attachment.daily_task_id)
    const filename = sanitizeFilename(attachment.filename)
    return path.join(dir, filename)
  }

  addReminderAttachment(reminderId, file = {}) {
    const reminder = this.getReminderById(reminderId)
    if (!reminder) throw new Error('提醒事项不存在')
    const originalName = sanitizeFilename(file.name || 'file')
    const buffer = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer || [])
    if (!buffer.length) throw new Error('附件内容为空')

    const dir = this._reminderAttachmentDir(reminderId)
    fs.mkdirSync(dir, { recursive: true })
    const filename = `${uuidv4()}_${originalName || 'file'}`
    const fullPath = path.join(dir, filename)
    if (!isPathInside(fullPath, this.uploadsDir)) throw new Error('附件路径非法')
    fs.writeFileSync(fullPath, buffer)

    const result = this.db.prepare(`
      INSERT INTO reminder_attachments (daily_task_id, filename, original_filename, file_size, mime_type)
      VALUES (?, ?, ?, ?, ?)
    `).run(reminderId, filename, originalName || 'file', buffer.length, file.mime_type || 'application/octet-stream')
    return this.getReminderAttachmentById(result.lastInsertRowid)
  }

  deleteReminderAttachment(id) {
    const attachment = this.getReminderAttachmentById(id)
    if (!attachment) return { success: false }
    try {
      fs.rmSync(this.getReminderAttachmentPath(attachment), { force: true })
    } catch {}
    this.db.prepare(
      'UPDATE reminder_attachments SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(id)
    return { success: true }
  }

  // ===== 提醒事项：通知 =====

  getDueRemindersForNotification(now = new Date()) {
    const dateKey = format(now, 'yyyy-MM-dd')
    const timeKey = format(now, 'HH:mm')
    return this.db.prepare(`
      SELECT dt.*, COALESCE(l.name, '') AS list_name, COALESCE(l.color, 'blue') AS list_color
      FROM daily_tasks dt
      LEFT JOIN reminder_lists l ON l.id = dt.list_id
      WHERE dt.deleted_at IS NULL
        AND dt.is_completed = 0
        AND dt.date = ?
        AND COALESCE(NULLIF(dt.remind_time, ''), NULLIF(dt.due_time, '')) IS NOT NULL
        AND time(COALESCE(NULLIF(dt.remind_time, ''), dt.due_time)) BETWEEN time(?, '-2 minutes') AND time(?)
        AND (dt.reminded_at IS NULL OR date(dt.reminded_at, 'localtime') < ?)
    `).all(dateKey, timeKey, timeKey, dateKey)
  }

  markReminderNotified(id) {
    this.db.prepare(
      'UPDATE daily_tasks SET reminded_at = ? WHERE id = ?'
    ).run(new Date().toISOString(), id)
    return { success: true }
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
        const backupCalendarCalendars = getBackupTable('calendar_calendars')
        const backupCalendarEvents = getBackupTable('calendar_events')
        const backupCalendarOverrides = getBackupTable('calendar_event_overrides')

        const projectIdMap = {}
        const taskIdMap = {}
        const dailyTaskIdMap = {}
        const habitIdMap = {}
        const noteIdMap = {}
        const calendarIdMap = {}
        const calendarEventIdMap = {}

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

        // Merge local calendars, event definitions and occurrence overrides
        for (const calendar of backupCalendarCalendars) {
          const existing = this.db.prepare('SELECT id FROM calendar_calendars WHERE name = ?').get(calendar.name)
          if (existing) {
            calendarIdMap[calendar.id] = existing.id
            continue
          }
          const result = this.db.prepare(`
            INSERT INTO calendar_calendars (name, color, is_visible, sort_order, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(
            calendar.name,
            calendar.color || '#3b82f6',
            calendar.is_visible ?? 1,
            calendar.sort_order || 0,
            calendar.created_at || new Date().toISOString(),
            calendar.updated_at || calendar.created_at || new Date().toISOString()
          )
          calendarIdMap[calendar.id] = result.lastInsertRowid
        }
        for (const event of backupCalendarEvents) {
          const calendarId = calendarIdMap[event.calendar_id]
          if (!calendarId) continue
          const existing = this.db.prepare(`
            SELECT id FROM calendar_events WHERE calendar_id = ? AND title = ? AND start_date = ? AND end_date = ?
          `).get(calendarId, event.title, event.start_date, event.end_date)
          if (existing) {
            calendarEventIdMap[event.id] = existing.id
            continue
          }
          const result = this.db.prepare(`
            INSERT INTO calendar_events (
              calendar_id, title, kind, start_date, end_date, start_time, end_time,
              all_day, location, notes, recurrence_type, recurrence_value, recurrence_end_date,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            calendarId, event.title, event.kind || 'event', event.start_date, event.end_date,
            event.start_time, event.end_time, event.all_day || 0, event.location || '', event.notes || '',
            event.recurrence_type || 'none', event.recurrence_value || '', event.recurrence_end_date || null,
            event.created_at || new Date().toISOString(),
            event.updated_at || event.created_at || new Date().toISOString()
          )
          calendarEventIdMap[event.id] = result.lastInsertRowid
        }
        for (const override of backupCalendarOverrides) {
          const eventId = calendarEventIdMap[override.event_id]
          if (!eventId) continue
          const existing = this.db.prepare(`
            SELECT id FROM calendar_event_overrides WHERE event_id = ? AND occurrence_date = ?
          `).get(eventId, override.occurrence_date)
          if (existing) continue
          this.db.prepare(`
            INSERT INTO calendar_event_overrides (
              event_id, occurrence_date, is_cancelled, calendar_id, title, kind,
              start_date, end_date, start_time, end_time, all_day, location, notes,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            eventId, override.occurrence_date, override.is_cancelled || 0,
            override.calendar_id ? (calendarIdMap[override.calendar_id] || null) : null,
            override.title, override.kind, override.start_date, override.end_date,
            override.start_time, override.end_time, override.all_day, override.location, override.notes,
            override.created_at || new Date().toISOString(),
            override.updated_at || override.created_at || new Date().toISOString()
          )
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
