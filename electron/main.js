const { app, BrowserWindow, ipcMain, dialog, Menu, shell, session } = require('electron')
const path = require('path')
const fs = require('fs')
const { DatabaseService } = require('./services/database-service')
const { AiService } = require('./services/ai-service')
const { ImageService } = require('./services/image-service')
const { AppleNotesService } = require('./services/apple-notes-service')
const { fetchSiteFavicon } = require('./services/favicon-service')
const macCalendarService = require('./services/macos-calendar-service')
const updateService = require('./services/update-service')
const macRemindersService = require('./services/macos-reminders-service')
const reminderMacSyncService = require('./services/reminder-mac-sync-service')
const { ReminderNotificationService } = require('./services/reminder-notification-service')
const { initSyncService } = require('./services/sync-service')

let mainWindow = null
let dbService = null
let aiService = null
let imageService = null
let appleNotesService = null
let reminderNotificationService = null
let permissionsConfigured = false
let webContentsSecurityConfigured = false
const hardenedWebContents = new WeakSet()
const isMcpServerMode = process.argv.includes('--mcp-server')
const SYNC_SERVER_URL = process.env.BONGMASTER_SYNC_URL || 'http://localhost:3000'
const SPELLCHECK_SETTINGS_FILE = 'editor-settings.json'
const SPELLCHECK_LANGUAGES = [
  {
    id: 'zh-CN',
    label: '中文（简体）',
    candidates: ['zh-CN', 'zh']
  },
  {
    id: 'en-US',
    label: 'English (US)',
    candidates: ['en-US', 'en-GB', 'en']
  },
  {
    id: 'es',
    label: 'Español',
    candidates: ['es', 'es-ES']
  }
]
let spellcheckLanguage = 'zh-CN'

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.zip': 'application/zip',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
}

const mimeForFile = filePath => MIME_BY_EXT[path.extname(filePath).toLowerCase()] || 'application/octet-stream'

// 获取数据目录
const getUserDataPath = () => app.getPath('userData')

const ensureDir = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

function getSpellcheckSettingsPath() {
  return path.join(getUserDataPath(), SPELLCHECK_SETTINGS_FILE)
}

function loadSpellcheckLanguage() {
  try {
    const settingsPath = getSpellcheckSettingsPath()
    if (!fs.existsSync(settingsPath)) return
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    if (SPELLCHECK_LANGUAGES.some((language) => language.id === settings.spellcheckLanguage)) {
      spellcheckLanguage = settings.spellcheckLanguage
    }
  } catch (err) {
    console.warn('[Spellcheck] Failed to load editor settings:', err)
  }
}

function saveSpellcheckLanguage() {
  try {
    const settingsPath = getSpellcheckSettingsPath()
    ensureDir(path.dirname(settingsPath))
    let settings = {}
    if (fs.existsSync(settingsPath)) {
      try {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
      } catch {
        settings = {}
      }
    }
    settings.spellcheckLanguage = spellcheckLanguage
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
  } catch (err) {
    console.warn('[Spellcheck] Failed to save editor settings:', err)
  }
}

function resolveAvailableSpellcheckLanguage(targetSession, language) {
  const availableLanguages = targetSession.availableSpellCheckerLanguages || []
  return language.candidates.find((candidate) => availableLanguages.includes(candidate)) || null
}

function applySpellcheckLanguage(targetSession) {
  if (!targetSession) return
  targetSession.setSpellCheckerEnabled(true)

  // macOS uses the system spellchecker and detects language automatically.
  if (process.platform === 'darwin') return

  const language = SPELLCHECK_LANGUAGES.find((item) => item.id === spellcheckLanguage)
  const availableLanguage = language && resolveAvailableSpellcheckLanguage(targetSession, language)
  if (availableLanguage) {
    targetSession.setSpellCheckerLanguages([availableLanguage])
  }
}

function setSpellcheckLanguage(languageId, contents) {
  if (!SPELLCHECK_LANGUAGES.some((language) => language.id === languageId)) return
  spellcheckLanguage = languageId
  saveSpellcheckLanguage()
  applySpellcheckLanguage(contents.session)
  contents.send('spellcheck:language-changed', spellcheckLanguage)
}

function createEditorContextMenu(contents, params) {
  const template = []
  const suggestions = params.dictionarySuggestions.slice(0, 8)

  if (params.misspelledWord) {
    if (suggestions.length > 0) {
      for (const suggestion of suggestions) {
        template.push({
          label: suggestion,
          click: () => contents.replaceMisspelling(suggestion)
        })
      }
    } else {
      template.push({
        label: '没有可用的拼写建议',
        enabled: false
      })
    }

    template.push({
      label: `将“${params.misspelledWord}”加入词典`,
      click: () => contents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
    })
    template.push({ type: 'separator' })
  }

  template.push({
    label: '纠错语言',
    submenu: SPELLCHECK_LANGUAGES.map((language) => {
      const isAvailable = process.platform === 'darwin' ||
        Boolean(resolveAvailableSpellcheckLanguage(contents.session, language))
      return {
        type: 'radio',
        label: language.label,
        checked: spellcheckLanguage === language.id,
        enabled: isAvailable,
        click: () => setSpellcheckLanguage(language.id, contents)
      }
    })
  })
  template.push({ type: 'separator' })
  template.push(
    {
      role: 'undo',
      label: '撤销',
      enabled: params.editFlags.canUndo
    },
    {
      role: 'redo',
      label: '重做',
      enabled: params.editFlags.canRedo
    },
    { type: 'separator' },
    {
      role: 'cut',
      label: '剪切',
      enabled: params.editFlags.canCut
    },
    {
      role: 'copy',
      label: '复制',
      enabled: params.editFlags.canCopy
    },
    {
      role: 'paste',
      label: '粘贴',
      enabled: params.editFlags.canPaste
    },
    {
      role: 'selectAll',
      label: '全选',
      enabled: params.editFlags.canSelectAll
    }
  )

  return Menu.buildFromTemplate(template)
}

function setupEditorContextMenu(contents) {
  contents.on('context-menu', (event, params) => {
    if (!params.isEditable) return
    event.preventDefault()
    const menu = createEditorContextMenu(contents, params)
    menu.popup({
      window: BrowserWindow.fromWebContents(contents)
    })
  })
}

// MCP Server 模式启动
const startMcpServerMode = async () => {
  try {
    const { McpServerService } = require('./services/mcp-server')
    const dbPath = path.join(getUserDataPath(), 'database.db')
    const uploadsDir = path.join(getUserDataPath(), 'uploads')

    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true })
    }

    dbService = new DatabaseService(dbPath, uploadsDir)
    dbService.initialize()
    // 使用 stderr 输出日志，避免干扰 stdout 的 JSON-RPC 通信
    console.error(`[MCP] Database initialized at ${dbPath}`)

    const mcpServer = new McpServerService(dbService)
    await mcpServer.start()
  } catch (err) {
    console.error('[MCP] Failed to start:', err)
    process.exit(1)
  }
}

function keepMcpServerInBackground() {
  if (process.platform !== 'darwin') return
  try {
    if (typeof app.setActivationPolicy === 'function') {
      app.setActivationPolicy('accessory')
    }
    if (app.dock && typeof app.dock.hide === 'function') {
      app.dock.hide()
    }
  } catch (err) {
    console.error('[MCP] Failed to hide dock icon:', err)
  }
}

// 检测 MCP Server 模式
if (isMcpServerMode) {
  keepMcpServerInBackground()
  app.whenReady().then(startMcpServerMode)
  return
}

// 拒绝所有 webview 权限请求，防止嵌入页面访问敏感资源
// 例外：HTML 全屏（视频播放必需）。允许后 Electron 会自动让宿主窗口进入/退出全屏，
// 并向 guest 与 host 双方派发 enter-html-full-screen / leave-html-full-screen。
function denySessionPermissions(targetSession, { allowHtmlFullscreen = false } = {}) {
  if (!targetSession) return
  targetSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(allowHtmlFullscreen && permission === 'fullscreen')
  })
  targetSession.setPermissionCheckHandler((webContents, permission) => false)
}

function setupWebviewPermissions() {
  if (permissionsConfigured) return
  if (!session || !session.defaultSession) return
  denySessionPermissions(session.defaultSession)
  for (const siteId of ['xiaohongshu', 'bilibili', 'youtube', 'instagram', 'x', 'douyin']) {
    denySessionPermissions(session.fromPartition(`persist:${siteId}`), { allowHtmlFullscreen: true })
  }
  app.on('session-created', denySessionPermissions)
  permissionsConfigured = true
}

function isAllowedAppNavigation(url) {
  if (!url) return false
  if (url.startsWith('file://')) return true
  if (process.env.NODE_ENV === 'development' && url.startsWith('http://localhost:5173')) return true
  return false
}

function isAllowedWebviewUrl(url) {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return ['https:', 'http:'].includes(parsed.protocol)
  } catch {
    return false
  }
}

function hardenWebContents(contents) {
  if (!contents || hardenedWebContents.has(contents)) return
  hardenedWebContents.add(contents)

  const isWebview = typeof contents.getType === 'function' && contents.getType() === 'webview'
  contents.setWindowOpenHandler(({ url }) => {
    if (!isWebview && url && /^https?:\/\//i.test(url)) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  if (isWebview) {
    return
  }

  contents.on('will-navigate', (event, url) => {
    if (!isAllowedAppNavigation(url)) {
      event.preventDefault()
    }
  })

  contents.on('will-attach-webview', (event, webPreferences, params) => {
    if (!isAllowedWebviewUrl(params.src)) {
      event.preventDefault()
      return
    }
    webPreferences.nodeIntegration = false
    webPreferences.nodeIntegrationInSubFrames = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    webPreferences.webSecurity = true
    webPreferences.allowRunningInsecureContent = false
    delete webPreferences.preload
  })
}

function setupWebContentsSecurity() {
  if (webContentsSecurityConfigured) return
  app.on('web-contents-created', (event, contents) => {
    hardenWebContents(contents)
  })
  webContentsSecurityConfigured = true
}

// 创建主窗口
const createMainWindow = async () => {
  setupWebviewPermissions()
  setupWebContentsSecurity()

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: process.env.BM_E2E_HIDDEN !== '1',
    webPreferences: {
      backgroundThrottling: process.env.BM_E2E_HIDDEN !== '1',
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: true,
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true // 启用 webview 标签（用于小红书浏览器）
    }
  })

  hardenWebContents(mainWindow.webContents)
  setupEditorContextMenu(mainWindow.webContents)

  if (process.env.NODE_ENV === 'development') {
    await mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../dist/renderer/index.html'))
  }

  return mainWindow
}

// 初始化数据库
const initializeDatabase = async () => {
  const dbPath = path.join(getUserDataPath(), 'database.db')
  const uploadsDir = path.join(getUserDataPath(), 'uploads')

  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true })
  }

  dbService = new DatabaseService(dbPath, uploadsDir)
  dbService.initialize()
  console.log(`[Database] Initialized at ${dbPath}`)

  // Initialize AI service with db access for tool calling
  aiService = new AiService(dbService)
  console.log('[AI] Service initialized')

  // Initialize Image service
  imageService = new ImageService(getUserDataPath())
  console.log('[Image] Service initialized')

  // Initialize Apple Notes service
  appleNotesService = new AppleNotesService(getUserDataPath())
  console.log('[AppleNotes] Service initialized')
}

const syncDesktopNoteToAppleNotes = async (noteId, options = {}) => {
  if (!appleNotesService) {
    appleNotesService = new AppleNotesService(getUserDataPath())
  }

  const note = dbService.getDesktopNoteById(noteId)
  if (!note) {
    return { success: false, status: 'not_found', error: '便签不存在' }
  }

  const payload = await appleNotesService.buildPayload(note, { mathMode: 'latex' })
  const sourceHash = appleNotesService.hashSnapshot(payload.title, payload.body)
  const existingLink = dbService.getAppleNoteLink(noteId)

  if (!existingLink || options.recreate === true) {
    const created = await appleNotesService.createNote(payload)
    if (!created.success) return created

    dbService.upsertAppleNoteLink(noteId, {
      apple_note_id: created.appleNoteId,
      apple_note_title: created.title,
      last_synced_hash: sourceHash,
      last_synced_apple_hash: created.appleHash
    })

    return {
      success: true,
      status: existingLink ? 'recreated' : 'created',
      appleNoteId: created.appleNoteId,
      syncedAt: new Date().toISOString(),
      note: dbService.getDesktopNoteById(noteId)
    }
  }

  const currentAppleNote = await appleNotesService.getNote(existingLink.apple_note_id)
  if (!currentAppleNote.success) {
    return currentAppleNote
  }

  if (
    options.force !== true &&
    existingLink.last_synced_apple_hash &&
    currentAppleNote.appleHash !== existingLink.last_synced_apple_hash
  ) {
    return {
      success: false,
      status: 'conflict',
      appleNoteId: existingLink.apple_note_id,
      appleNoteTitle: currentAppleNote.title,
      error: 'Apple Notes 中的对应便签自上次同步后被修改过。'
    }
  }

  const updated = await appleNotesService.updateNote(existingLink.apple_note_id, payload)
  if (!updated.success) return updated

  dbService.upsertAppleNoteLink(noteId, {
    apple_note_id: updated.appleNoteId,
    apple_note_title: updated.title,
    last_synced_hash: sourceHash,
    last_synced_apple_hash: updated.appleHash
  })

  return {
    success: true,
    status: 'updated',
    appleNoteId: updated.appleNoteId,
    syncedAt: new Date().toISOString(),
    note: dbService.getDesktopNoteById(noteId)
  }
}

const sanitizePdfFilename = (value) => {
  const cleaned = String(value || '无标题便签')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || '无标题便签'
}

const exportDesktopNoteToPdf = async (noteId) => {
  if (!appleNotesService) {
    appleNotesService = new AppleNotesService(getUserDataPath())
  }

  const note = dbService.getDesktopNoteById(noteId)
  if (!note) {
    return { success: false, status: 'not_found', error: '便签不存在' }
  }

  const defaultPath = `${sanitizePdfFilename(note.title)}.pdf`
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: '导出便签为 PDF',
    defaultPath,
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
  })

  if (canceled || !filePath) {
    return { success: false, cancelled: true }
  }

  const printWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      sandbox: true
    }
  })

  try {
    const html = appleNotesService.buildPrintHtml(note)
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    const pdfBuffer = await printWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: {
        marginType: 'default'
      }
    })
    fs.writeFileSync(filePath, pdfBuffer)
    return { success: true, filePath }
  } catch (error) {
    return { success: false, status: 'error', error: error.message || '导出 PDF 失败' }
  } finally {
    if (!printWindow.isDestroyed()) {
      printWindow.close()
    }
  }
}

// 注册 IPC 处理器
const registerIpcHandlers = () => {
  // ===== 项目相关 =====
  ipcMain.handle('project:getAll', () => dbService.getAllProjects())
  ipcMain.handle('project:getById', (event, id) => dbService.getProjectById(id))
  ipcMain.handle('project:create', (event, data) => dbService.createProject(data))
  ipcMain.handle('project:update', (event, id, data) => dbService.updateProject(id, data))
  ipcMain.handle('project:delete', (event, id) => dbService.deleteProject(id))

  // ===== 删除撤回 =====
  ipcMain.handle('entity:restore', (event, tableName, ids) => dbService.restoreEntities(tableName, ids))
  ipcMain.handle('noteProjectLink:restore', (event, noteId, projectId) => dbService.restoreNoteProjectLink(noteId, projectId))

  // ===== 任务相关 =====
  ipcMain.handle('task:getAll', () => dbService.getAllTasks())
  ipcMain.handle('task:getByProjectId', (event, projectId) => dbService.getTasksByProjectId(projectId))
  ipcMain.handle('task:create', (event, data) => dbService.createTask(data))
  ipcMain.handle('task:update', (event, id, data) => dbService.updateTask(id, data))
  ipcMain.handle('task:delete', (event, id) => dbService.deleteTask(id))

  // ===== 本地日历 =====
  ipcMain.handle('calendar:getData', (event, startDate, endDate) => dbService.getCalendarData(startDate, endDate))
  ipcMain.handle('calendar:search', (event, query) => dbService.searchCalendarEvents(query))
  ipcMain.handle('calendar:createCategory', (event, data) => dbService.createCalendar(data))
  ipcMain.handle('calendar:updateCategory', (event, id, data) => dbService.updateCalendar(id, data))
  ipcMain.handle('calendar:deleteCategory', (event, id) => dbService.deleteCalendar(id))
  ipcMain.handle('calendar:createEvent', (event, data) => dbService.createCalendarEvent(data))
  ipcMain.handle('calendar:updateEvent', (event, id, data, options) => dbService.updateCalendarEvent(id, data, options || {}))
  ipcMain.handle('calendar:deleteEvent', (event, id, options) => dbService.deleteCalendarEvent(id, options || {}))
  ipcMain.handle('calendar:restoreEvents', (event, snapshot) => dbService.restoreCalendarEvents(snapshot))
  ipcMain.handle('calendar:saveIcs', async (event, payload = {}) => {
    const content = typeof payload.content === 'string' ? payload.content : ''
    if (!content || Buffer.byteLength(content, 'utf8') > 20 * 1024 * 1024) {
      return { success: false, error: '导出内容为空或超过 20MB' }
    }
    const requested = path.basename(String(payload.defaultName || 'BongMaster.ics'))
    const defaultName = requested.toLowerCase().endsWith('.ics') ? requested : `${requested}.ics`
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName,
      filters: [{ name: 'iCalendar', extensions: ['ics'] }]
    })
    if (canceled || !filePath) return { cancelled: true }
    try {
      await fs.promises.writeFile(filePath, content, 'utf8')
      return { success: true, filePath }
    } catch (error) {
      return { success: false, error: error.message || '写入文件失败' }
    }
  })

  ipcMain.handle('calendarMac:push', (event, payload) => macCalendarService.pushMonth(payload))
  ipcMain.handle('calendarMac:pull', (event, payload) => macCalendarService.pullMonth(payload))
  ipcMain.handle('calendarMac:getName', () => macCalendarService.CALENDAR_NAME)
  ipcMain.handle('calendarMac:apply', (event, payload) => macCalendarService.applyChanges(payload))
  ipcMain.handle('calendarMac:getSyncRecords', () => dbService.getMacSyncRecords())
  ipcMain.handle('calendarMac:saveSyncRecords', (event, records) => dbService.saveMacSyncRecords(records))
  ipcMain.handle('calendarMac:deleteSyncRecords', (event, keys) => dbService.deleteMacSyncRecords(keys))

  // ===== 应用更新 =====
  ipcMain.handle('update:check', () => updateService.checkForUpdates())
  ipcMain.handle('update:download', event => updateService.downloadAndInstall(event.sender))
  ipcMain.handle('update:version', () => app.getVersion())

  // ===== 娱乐中心 =====
  ipcMain.handle('entertainment:fetchFavicon', (event, url) => fetchSiteFavicon(url))

  ipcMain.handle('workAttendance:getRange', (event, startDate, endDate) => dbService.getWorkAttendance(startDate, endDate))
  ipcMain.handle('workAttendance:getSettings', () => dbService.getWorkAttendanceSettings())
  ipcMain.handle('workAttendance:saveSettings', (event, data) => dbService.saveWorkAttendanceSettings(data))
  ipcMain.handle('workAttendance:checkIn', (event, date, at) => dbService.checkInWork(date, at))
  ipcMain.handle('workAttendance:checkOut', (event, date, at) => dbService.checkOutWork(date, at))
  ipcMain.handle('workAttendance:pause', (event, date, at) => dbService.pauseWork(date, at))
  ipcMain.handle('workAttendance:resume', (event, date, at) => dbService.resumeWork(date, at))
  ipcMain.handle('workAttendance:save', (event, data) => dbService.saveWorkAttendance(data))
  ipcMain.handle('workAttendance:delete', (event, id) => dbService.deleteWorkAttendance(id))

  // ===== 任务视图相关 =====
  ipcMain.handle('taskView:getAll', () => dbService.getTaskViews())
  ipcMain.handle('taskView:create', (event, data) => dbService.createTaskView(data))
  ipcMain.handle('taskView:update', (event, id, data) => dbService.updateTaskView(id, data))
  ipcMain.handle('taskView:delete', (event, id) => dbService.deleteTaskView(id))

  // ===== 每日任务 =====
  ipcMain.handle('dailyTask:getByDate', (event, date) => dbService.getDailyTasksByDate(date))
  ipcMain.handle('dailyTask:getHistoryStats', (event, date) => dbService.getDailyTaskHistoryStats(date))
  ipcMain.handle('dailyTask:getRecentlyCompleted', (event, limit) => dbService.getRecentlyCompletedDailyTasks(limit))
  ipcMain.handle('dailyTask:create', (event, data) => dbService.createDailyTask(data))
  ipcMain.handle('dailyTask:update', (event, id, data) => dbService.updateDailyTask(id, data))
  ipcMain.handle('dailyTask:delete', (event, id) => dbService.deleteDailyTask(id))
  ipcMain.handle('dailyTask:toggleComplete', (event, id, isCompleted) => dbService.toggleDailyTaskComplete(id, isCompleted))
  ipcMain.handle('dailyTask:reorder', (event, orderedIds) => dbService.reorderDailyTasks(orderedIds))
  ipcMain.handle('dailyTask:moveToDate', (event, ids, date) => dbService.moveDailyTasksToDate(ids, date))

  // ===== 每日任务子任务 =====
  ipcMain.handle('dailySubtask:getByTaskIds', (event, taskIds) => dbService.getDailySubtasksByTaskIds(taskIds))
  ipcMain.handle('dailySubtask:getByTask', (event, taskId) => dbService.getDailySubtasks(taskId))
  ipcMain.handle('dailySubtask:create', (event, taskId, data) => dbService.createDailySubtask(taskId, data))
  ipcMain.handle('dailySubtask:update', (event, id, data) => dbService.updateDailySubtask(id, data))
  ipcMain.handle('dailySubtask:delete', (event, id) => dbService.deleteDailySubtask(id))
  ipcMain.handle('dailySubtask:reorder', (event, taskId, orderedIds) => dbService.reorderDailySubtasks(taskId, orderedIds))

  // ===== 每日任务重复规则 =====
  ipcMain.handle('dailyTaskRepeatRule:getAll', () => dbService.getDailyTaskRepeatRules())
  ipcMain.handle('dailyTaskRepeatRule:create', (event, data) => dbService.createDailyTaskRepeatRule(data))
  ipcMain.handle('dailyTaskRepeatRule:update', (event, id, data) => dbService.updateDailyTaskRepeatRule(id, data))
  ipcMain.handle('dailyTaskRepeatRule:delete', (event, id) => dbService.deleteDailyTaskRepeatRule(id))
  ipcMain.handle('dailyTaskRepeatRule:generateForDate', (event, date) => dbService.generateDailyTasksForDate(date))

  // ===== 提醒事项：列表 / 分区 =====
  ipcMain.handle('reminderList:getAll', () => dbService.getReminderLists())
  ipcMain.handle('reminderList:create', (event, data) => dbService.createReminderList(data))
  ipcMain.handle('reminderList:update', (event, id, data) => dbService.updateReminderList(id, data))
  ipcMain.handle('reminderList:delete', (event, id) => dbService.deleteReminderList(id))
  ipcMain.handle('reminderList:reorder', (event, orderedIds) => dbService.reorderReminderLists(orderedIds))

  ipcMain.handle('reminderSection:getAll', (event, listId) => dbService.getReminderSections(listId))
  ipcMain.handle('reminderSection:create', (event, listId, data) => dbService.createReminderSection(listId, data))
  ipcMain.handle('reminderSection:update', (event, id, data) => dbService.updateReminderSection(id, data))
  ipcMain.handle('reminderSection:delete', (event, id) => dbService.deleteReminderSection(id))
  ipcMain.handle('reminderSection:restore', (event, id, reminderIds) => dbService.restoreReminderSection(id, reminderIds))
  ipcMain.handle('reminderSection:reorder', (event, listId, orderedIds) => dbService.reorderReminderSections(listId, orderedIds))

  // ===== 提醒事项 =====
  ipcMain.handle('reminder:getAll', () => dbService.getAllReminders())
  ipcMain.handle('reminder:getById', (event, id) => dbService.getReminderById(id))
  ipcMain.handle('reminder:create', (event, data) => dbService.createReminder(data))
  ipcMain.handle('reminder:update', (event, id, data) => dbService.updateReminder(id, data))
  ipcMain.handle('reminder:toggleComplete', (event, id, isCompleted) => dbService.toggleReminderComplete(id, isCompleted))
  ipcMain.handle('reminder:delete', (event, id) => dbService.deleteReminder(id))
  ipcMain.handle('reminder:restore', (event, ids) => dbService.restoreReminders(ids))
  ipcMain.handle('reminder:reorder', (event, orderedIds, sectionId) => dbService.reorderReminders(orderedIds, sectionId))
  ipcMain.handle('reminder:moveToList', (event, ids, listId, sectionId) => dbService.moveRemindersToList(ids, listId, sectionId))
  ipcMain.handle('reminder:clearCompleted', (event, listId, completedBefore) => dbService.clearCompletedReminders(listId, completedBefore))
  ipcMain.handle('reminder:duplicate', (event, id) => dbService.duplicateReminder(id))
  ipcMain.handle('reminder:getRecentlyDeleted', (event, limit) => dbService.getRecentlyDeletedReminders(limit))
  ipcMain.handle('reminder:purge', (event, id) => dbService.purgeReminder(id))
  ipcMain.handle('reminderMac:sync', () => reminderMacSyncService.syncReminders(dbService, macRemindersService))

  // ===== 提醒事项附件 =====
  ipcMain.handle('reminderAttachment:getByReminder', (event, reminderId) => dbService.getReminderAttachments(reminderId))
  ipcMain.handle('reminderAttachment:pick', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '添加附件',
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths.length) return { cancelled: true }
    const filePath = result.filePaths[0]
    const stat = fs.statSync(filePath)
    if (stat.size > 50 * 1024 * 1024) throw new Error('附件不能超过 50MB')
    return {
      name: path.basename(filePath),
      size: stat.size,
      mime_type: mimeForFile(filePath),
      bufferBase64: fs.readFileSync(filePath).toString('base64')
    }
  })
  ipcMain.handle('reminderAttachment:addFile', (event, reminderId, file) => {
    const buffer = Buffer.from(file?.bufferBase64 || '', 'base64')
    return dbService.addReminderAttachment(reminderId, {
      name: file?.name,
      buffer,
      mime_type: file?.mime_type
    })
  })
  ipcMain.handle('reminderAttachment:add', async (event, reminderId) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '添加附件',
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths.length) return { cancelled: true }
    const filePath = result.filePaths[0]
    const stat = fs.statSync(filePath)
    if (stat.size > 50 * 1024 * 1024) throw new Error('附件不能超过 50MB')
    return dbService.addReminderAttachment(reminderId, {
      name: path.basename(filePath),
      buffer: fs.readFileSync(filePath),
      mime_type: mimeForFile(filePath)
    })
  })
  ipcMain.handle('reminderAttachment:open', async (event, id) => {
    const attachment = dbService.getReminderAttachmentById(id)
    if (!attachment) return { success: false, error: '附件不存在' }
    const error = await shell.openPath(dbService.getReminderAttachmentPath(attachment))
    return error ? { success: false, error } : { success: true }
  })
  ipcMain.handle('reminderAttachment:delete', (event, id) => dbService.deleteReminderAttachment(id))

  // ===== 附件管理 =====
  ipcMain.handle('document:getByProjectId', (event, projectId) => dbService.getDocumentsByProjectId(projectId))
  ipcMain.handle('document:upload', async (event, projectId, fileData) => dbService.uploadDocument(projectId, fileData))
  ipcMain.handle('document:download', async (event, documentId) => dbService.downloadDocument(documentId))
  ipcMain.handle('document:delete', (event, documentId) => dbService.deleteDocument(documentId))

  // ===== 数据导入/导出 =====
  ipcMain.handle('data:export', async () => {
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `BongMaster_backup_${new Date().toISOString().split('T')[0]}.zip`,
      filters: [{ name: 'ZIP Files', extensions: ['zip'] }]
    })
    if (filePath) {
      return dbService.exportData(filePath)
    }
    return { cancelled: true }
  })

  // ===== Balatro 游戏存档 =====
  ipcMain.handle('balatro:load', () => dbService.getBalatroState('main'))
  // §19 金币 bug 修复：保存时合并而非整体覆盖（多实例/旧版本并发写防护，详见 balatro-state-merge.cjs）
  const { mergeBalatroState } = require('./services/balatro-state-merge.cjs')
  ipcMain.handle('balatro:save', (event, state) => {
    try {
      const payload = typeof state === 'string' ? JSON.parse(state) : state
      const incoming = payload?.state && typeof payload.state === 'object' ? payload.state : payload
      const base = payload?.state && typeof payload.base === 'object' ? payload.base : null
      const diskRaw = dbService.getBalatroState('main')
      const disk = diskRaw ? JSON.parse(diskRaw) : null
      const merged = mergeBalatroState(disk, incoming, base)
      dbService.saveBalatroState(JSON.stringify(merged), 'main')
      return JSON.stringify(merged)
    } catch (err) {
      console.warn('[Balatro] 存档合并失败，已保留磁盘原状态:', err)
      return false
    }
  })

  // 带键存档（远征模式 'expedition:*' 等；契约 §7）。键名白名单校验，防注入。
  const sanitizeBalatroKey = (key) => {
    const k = String(key || '')
    return /^[a-z0-9:_-]{1,64}$/i.test(k) ? k : 'main'
  }
  ipcMain.handle('balatro:loadKey', (event, key) => dbService.getBalatroState(sanitizeBalatroKey(key)))
  ipcMain.handle('balatro:saveKey', (event, key, state) => dbService.saveBalatroState(state, sanitizeBalatroKey(key)))

  ipcMain.handle('data:import', async () => {
    const { filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'ZIP Files', extensions: ['zip'] },
        { name: 'Database Files', extensions: ['db'] }
      ]
    })
    if (filePaths && filePaths.length > 0) {
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['完全覆盖', '合并导入', '取消'],
        defaultId: 1,
        cancelId: 2,
        title: '导入模式',
        message: '请选择导入模式',
        detail: '完全覆盖：删除现有数据并替换为备份数据。\n合并导入：保留现有数据，仅添加不存在的项目并更新重复项目的状态。'
      })
      if (response === 2) {
        return { cancelled: true }
      }
      const mode = response === 0 ? 'replace' : 'merge'
      const result = await dbService.importData(filePaths[0], mode)
      if (!result.success) {
        dialog.showErrorBox('导入失败', result.error || '未知错误')
      }
      return result
    }
    return { cancelled: true }
  })

  // ===== 应用功能 =====
  ipcMain.handle('app:getDataDir', () => getUserDataPath())
  ipcMain.handle('app:openDataDir', () => {
    const dataDir = getUserDataPath()
    shell.openPath(dataDir)
  })
  ipcMain.handle('app:openExternal', (event, url) => {
    const target = new URL(String(url))
    if (!['http:', 'https:'].includes(target.protocol)) throw new Error('仅支持打开网页链接')
    return shell.openExternal(target.toString())
  })
  ipcMain.handle('spellcheck:getLanguage', () => spellcheckLanguage)

  // ===== AI 功能 =====
  ipcMain.handle('ai:getConfig', () => aiService.getConfig())
  ipcMain.handle('ai:saveConfig', (event, config) => aiService.saveConfig(config))
  ipcMain.handle('ai:chat', (event, messages, context, enableTools, interactive) => aiService.chat(messages, context, enableTools !== false, interactive === true))
  ipcMain.handle('ai:executeActions', (event, messages, context) => aiService.executeActions(messages, context))
  ipcMain.on('ai:stopChat', () => { aiService.stopChat() })

  // ===== 任务完成统计 =====
  ipcMain.handle('task:recordCompletion', (event, data) => {
    return dbService.recordTaskCompletion(data.taskId, data.projectId, data.completionTimeMinutes)
  })
  ipcMain.handle('task:getCompletionStats', (event, days, options) => dbService.getTaskCompletionStats(days, options))
  ipcMain.handle('task:getAverageCompletionTime', (event, projectId) => dbService.getAverageCompletionTime(projectId))
  ipcMain.handle('task:getBusiestDays', (event, days) => dbService.getBusiestDays(days))

  // ===== 习惯 =====
  ipcMain.handle('habit:getAll', () => dbService.getAllHabits())
  ipcMain.handle('habit:create', (event, data) => dbService.createHabit(data))
  ipcMain.handle('habit:update', (event, id, data) => dbService.updateHabit(id, data))
  ipcMain.handle('habit:delete', (event, id) => dbService.deleteHabit(id))
  ipcMain.handle('habit:archive', (event, id, isArchived) => dbService.archiveHabit(id, isArchived))

  // ===== 习惯打卡 =====
  ipcMain.handle('habitCheckin:getAll', (event, startDate, endDate) => dbService.getAllCheckins(startDate, endDate))
  ipcMain.handle('habitCheckin:getByHabit', (event, habitId, startDate, endDate) => dbService.getHabitCheckins(habitId, startDate, endDate))
  ipcMain.handle('habitCheckin:getByDate', (event, habitId, date) => dbService.getCheckinByDate(habitId, date))
  ipcMain.handle('habitCheckin:create', (event, data) => dbService.createHabitCheckin(data))
  ipcMain.handle('habitCheckin:update', (event, id, data) => dbService.updateHabitCheckin(id, data))
  ipcMain.handle('habitCheckin:delete', (event, id) => dbService.deleteHabitCheckin(id))

  // ===== 桌面便签 =====
  ipcMain.handle('desktopNote:getAll', (event, options) => dbService.getDesktopNotes(options || {}))
  ipcMain.handle('desktopNote:getByProject', (event, projectId) => dbService.getDesktopNotesByProject(projectId))
  ipcMain.handle('desktopNote:getProjects', (event, noteId) => dbService.getNoteProjects(noteId))
  ipcMain.handle('desktopNote:create', (event, data) => dbService.createDesktopNote(data))
  ipcMain.handle('desktopNote:update', (event, id, data) => dbService.updateDesktopNote(id, data))
  ipcMain.handle('desktopNote:setProjects', (event, id, projectIds) => dbService.setDesktopNoteProjects(id, projectIds))
  ipcMain.handle('desktopNote:archive', (event, id, isArchived) => dbService.archiveDesktopNote(id, isArchived))
  ipcMain.handle('desktopNote:archiveMany', (event, ids, isArchived) => dbService.archiveDesktopNotes(ids, isArchived))
  ipcMain.handle('desktopNote:delete', (event, id) => dbService.deleteDesktopNote(id))
  ipcMain.handle('desktopNote:exportPdf', (event, id) => exportDesktopNoteToPdf(id))
  const handleAppleNotesSync = (event, id, options) => syncDesktopNoteToAppleNotes(id, options || {})
  ipcMain.handle('desktopNote:syncToAppleNotes', handleAppleNotesSync)
  ipcMain.handle('appleNotes:syncDesktopNote', handleAppleNotesSync)
  console.log('[IPC] Registered Apple Notes sync handlers')

  // ===== 图片管理 =====
  ipcMain.handle('image:save', (event, noteId, imageData, ext) => imageService.saveImage(noteId, imageData, ext))
  ipcMain.handle('image:getBaseDir', () => imageService.getBaseDir())

  // ===== 分类管理 =====
  ipcMain.handle('categories:getAll', () => dbService.getAllCategories())
  ipcMain.handle('categories:create', (event, name) => dbService.createCategory(name))
  ipcMain.handle('categories:delete', (event, name) => dbService.deleteCategory(name))

  // ===== 笔记分类 =====
  ipcMain.handle('note:updateCategory', (event, noteId, category) => dbService.updateNoteCategory(noteId, category))
}

// 创建应用菜单
const createAppMenu = () => {
  const template = [
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '数据管理',
      submenu: [
        {
          label: '导出数据库',
          click: async () => {
            const { filePath } = await dialog.showSaveDialog(mainWindow, {
              defaultPath: `BongMaster_backup_${new Date().toISOString().split('T')[0]}.zip`,
              filters: [{ name: 'ZIP Files', extensions: ['zip'] }]
            })
            if (filePath) {
              const result = await dbService.exportData(filePath)
              if (result.success) {
                dialog.showMessageBox(mainWindow, {
                  type: 'info',
                  title: '导出成功',
                  message: `备份已保存到: ${filePath}`
                })
              }
            }
          }
        },
        {
          label: '导入数据库',
          click: async () => {
            const { filePaths } = await dialog.showOpenDialog(mainWindow, {
              properties: ['openFile'],
              filters: [
                { name: 'ZIP Files', extensions: ['zip'] },
                { name: 'Database Files', extensions: ['db'] }
              ]
            })
            if (filePaths && filePaths.length > 0) {
              const { response } = await dialog.showMessageBox(mainWindow, {
                type: 'question',
                buttons: ['完全覆盖', '合并导入', '取消'],
                defaultId: 1,
                cancelId: 2,
                title: '导入模式',
                message: '请选择导入模式',
                detail: '完全覆盖：删除现有数据并替换为备份数据。\n合并导入：保留现有数据，仅添加不存在的项目并更新重复项目的状态。'
              })
              if (response === 2) return
              const mode = response === 0 ? 'replace' : 'merge'
              const result = await dbService.importData(filePaths[0], mode)
              if (result.success) {
                const detail = `项目数量: ${result.projectCount || 'N/A'}\n附件记录: ${result.docCount || 'N/A'}`
                dialog.showMessageBox(mainWindow, {
                  type: 'info',
                  title: '导入成功',
                  message: '数据库已导入，页面将刷新。',
                  detail
                })
                mainWindow.webContents.reload()
              } else {
                dialog.showErrorBox('导入失败', result.error || '未知错误')
              }
            }
          }
        },
        { type: 'separator' },
        {
          label: '打开数据目录',
          click: () => {
            const dataDir = getUserDataPath()
            shell.openPath(dataDir)
          }
        }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: 'MCP 配置说明',
          click: () => {
            const electronPath = app.getPath('exe')
            const config = {
              mcpServers: {
                bongmaster: {
                  command: electronPath,
                  args: ['--mcp-server']
                }
              }
            }
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'MCP 配置说明',
              message: 'MCP 配置说明',
              detail: `BongMaster 提供标准 MCP Server，可接入支持 MCP 的 AI 应用、桌面客户端、命令行工具或其他 MCP 客户端。

请在所使用客户端的 MCP 配置文件中，加入以下配置。不同客户端的配置文件位置和重载方式可能不同，请以该客户端的说明为准。

配置内容:
${JSON.stringify(config, null, 2)}

保存配置后，按照客户端的说明重新加载 MCP 配置，即可使用 BongMaster 工具。`,
              buttons: ['复制配置', '关闭'],
              defaultId: 1
            }).then(({ response }) => {
              if (response === 0) {
                require('electron').clipboard.writeText(JSON.stringify(config, null, 2))
                dialog.showMessageBox(mainWindow, {
                  type: 'info',
                  title: '已复制',
                  message: '配置已复制到剪贴板'
                })
              }
            })
          }
        },
        { type: 'separator' },
        {
          label: '关于 BongMaster',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '关于 BongMaster',
              message: 'BongMaster',
              detail: `版本 ${app.getVersion()}

一个简洁的本地项目管理工具，支持项目、任务、每日计划、习惯和便签管理。

提供标准 MCP Server，可供兼容 MCP 的 AI 应用和其他客户端连接使用。

数据目录: ${getUserDataPath()}`
            })
          }
        }
      ]
    }
  ]

  // macOS 第一个菜单必须是应用名
  if (process.platform === 'darwin') {
    template.unshift({
      label: 'BongMaster',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    })
  }

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

// 应用生命周期
app.whenReady().then(async () => {
  try {
    loadSpellcheckLanguage()
    applySpellcheckLanguage(session.defaultSession)
    await initializeDatabase()
    registerIpcHandlers()
    initSyncService(dbService, SYNC_SERVER_URL)
    createAppMenu()
    await createMainWindow()
    reminderNotificationService = new ReminderNotificationService(dbService)
    reminderNotificationService.start(() => mainWindow)
  } catch (err) {
    console.error('[App] Failed to start:', err)
    dialog.showErrorBox('启动错误', `应用启动失败: ${err.message}`)
    app.quit()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
