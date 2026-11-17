import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { DatabaseService } = require('../electron/services/database-service.js')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bongmaster-legacy-db-'))
const dbPath = path.join(dir, 'database.db')
const uploads = path.join(dir, 'uploads')
fs.mkdirSync(uploads, { recursive: true })

const legacy = new Database(dbPath)
legacy.exec(`
  CREATE TABLE projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT '未开始',
    priority TEXT DEFAULT '中',
    start_date DATE,
    due_date DATE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  INSERT INTO projects (name) VALUES ('旧项目');
  CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    name TEXT NOT NULL,
    status TEXT DEFAULT '待办',
    priority TEXT DEFAULT '中',
    due_date DATE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  INSERT INTO tasks (project_id, name) VALUES (1, '旧任务项');
  CREATE TABLE daily_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    date DATE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  INSERT INTO daily_tasks (title, date) VALUES ('旧任务', '2026-11-10');
  CREATE TABLE desktop_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  INSERT INTO desktop_notes (title, content) VALUES ('旧便签', '内容');
`)
legacy.close()

try {
  const service = new DatabaseService(dbPath, uploads)
  service.initialize()

  const dailyColumns = service.db.prepare('PRAGMA table_info(daily_tasks)').all().map(column => column.name)
  for (const name of ['is_pinned', 'is_completed', 'priority', 'estimated_minutes', 'list_id', 'is_flagged']) {
    assert.ok(dailyColumns.includes(name), `daily_tasks missing ${name}`)
  }

  const noteColumns = service.db.prepare('PRAGMA table_info(desktop_notes)').all().map(column => column.name)
  for (const name of ['is_pinned', 'is_minimized', 'pos_x', 'pos_y']) {
    assert.ok(noteColumns.includes(name), `desktop_notes missing ${name}`)
  }

  const projectColumns = service.db.prepare('PRAGMA table_info(projects)').all().map(column => column.name)
  for (const name of ['overview', 'progress', 'is_ongoing']) {
    assert.ok(projectColumns.includes(name), `projects missing ${name}`)
  }

  assert.equal(service.getAllProjects().length, 1)
  assert.equal(service.getAllReminders().length, 1)
  assert.equal(service.getDesktopNotes().length, 1)
  service.db.close()
  console.log('legacy-db-migration-test: ok')
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
}
