const { app, BrowserWindow, ipcMain, dialog, Menu, shell, session } = require('electron')
const path = require('path')
const fs = require('fs')
const { DatabaseService } = require('./services/database-service')
const { AiService } = require('./services/ai-service')
const { ImageService } = require('./services/image-service')
const { AppleNotesService } = require('./services/apple-notes-service')
const { initSyncService } = require('./services/sync-service')

let mainWindow = null
let dbService = null
let aiService = null
let imageService = null
let appleNotesService = null
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
function denySessionPermissions(targetSession) {
  if (!targetSession) return
  targetSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(false)
  })
  targetSession.setPermissionCheckHandler((webContents, permission) => false)
}

function setupWebviewPermissions() {
  if (permissionsConfigured) return
  if (!session || !session.defaultSession) return
  denySessionPermissions(session.defaultSession)
  for (const siteId of ['xiaohongshu', 'bilibili', 'youtube']) {
    denySessionPermissions(session.fromPartition(`persist:${siteId}`))
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
    webPreferences: {
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

  // ===== 任务相关 =====
  ipcMain.handle('task:getAll', () => dbService.getAllTasks())
  ipcMain.handle('task:getByProjectId', (event, projectId) => dbService.getTasksByProjectId(projectId))
  ipcMain.handle('task:create', (event, data) => dbService.createTask(data))
  ipcMain.handle('task:update', (event, id, data) => dbService.updateTask(id, data))
  ipcMain.handle('task:delete', (event, id) => dbService.deleteTask(id))

  // ===== 任务视图相关 =====
  ipcMain.handle('taskView:getAll', () => dbService.getTaskViews())
  ipcMain.handle('taskView:create', (event, data) => dbService.createTaskView(data))
  ipcMain.handle('taskView:update', (event, id, data) => dbService.updateTaskView(id, data))
  ipcMain.handle('taskView:delete', (event, id) => dbService.deleteTaskView(id))

  // ===== 每日任务 =====
  ipcMain.handle('dailyTask:getByDate', (event, date) => dbService.getDailyTasksByDate(date))
  ipcMain.handle('dailyTask:getRecentlyCompleted', (event, limit) => dbService.getRecentlyCompletedDailyTasks(limit))
  ipcMain.handle('dailyTask:create', (event, data) => dbService.createDailyTask(data))
  ipcMain.handle('dailyTask:update', (event, id, data) => dbService.updateDailyTask(id, data))
  ipcMain.handle('dailyTask:delete', (event, id) => dbService.deleteDailyTask(id))
  ipcMain.handle('dailyTask:toggleComplete', (event, id, isCompleted) => dbService.toggleDailyTaskComplete(id, isCompleted))
  ipcMain.handle('dailyTask:reorder', (event, orderedIds) => dbService.reorderDailyTasks(orderedIds))
  ipcMain.handle('dailyTask:moveToDate', (event, ids, date) => dbService.moveDailyTasksToDate(ids, date))
  ipcMain.handle('dailyTask:recordTimeSpent', (event, id, seconds) => dbService.recordDailyTaskTimeSpent(id, seconds))

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
  ipcMain.handle('task:getCompletionStats', (event, days) => dbService.getTaskCompletionStats(days))
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

// 获取 Claude 配置文件路径（跨平台）
function getClaudeConfigPaths() {
  const os = require('os')
  const home = os.homedir()

  if (process.platform === 'darwin') {
    return {
      desktopDir: path.join(home, 'Library/Application Support/Claude'),
      desktopConfigName: 'claude_desktop_config.json',
      cliDir: path.join(home, '.claude'),
      cliConfigName: 'settings.json'
    }
  }

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData/Roaming')
    return {
      desktopDir: path.join(appData, 'Claude'),
      desktopConfigName: 'claude_desktop_config.json',
      cliDir: path.join(appData, 'Claude'),
      cliConfigName: 'settings.json'
    }
  }

  // Linux and others
  return {
    desktopDir: path.join(home, '.config/Claude'),
    desktopConfigName: 'claude_desktop_config.json',
    cliDir: path.join(home, '.claude'),
    cliConfigName: 'settings.json'
  }
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
          label: '自动配置 MCP',
          click: async () => {
            const fs = require('fs')
            const path = require('path')
            const os = require('os')
            const { clipboard } = require('electron')

            const results = []
            let desktopConfigSuccess = false
            let cliConfigSuccess = false

            // 1. 配置 Claude Desktop
            try {
              const claudeDir = path.join(os.homedir(), 'Library/Application Support/Claude')
              const desktopConfigPath = path.join(claudeDir, 'claude_desktop_config.json')
              const electronPath = app.getPath('exe')

              let desktopConfig = {}
              if (fs.existsSync(desktopConfigPath)) {
                desktopConfig = JSON.parse(fs.readFileSync(desktopConfigPath, 'utf-8'))
              }

              if (!desktopConfig.mcpServers) {
                desktopConfig.mcpServers = {}
              }

              desktopConfig.mcpServers.bongmaster = {
                command: electronPath,
                args: ['--mcp-server']
              }

              if (!fs.existsSync(claudeDir)) {
                fs.mkdirSync(claudeDir, { recursive: true })
              }

              fs.writeFileSync(desktopConfigPath, JSON.stringify(desktopConfig, null, 2))
              desktopConfigSuccess = true
              results.push('✅ Claude Desktop 配置成功')
            } catch (err) {
              results.push(`❌ Claude Desktop 配置失败: ${err.message}`)
            }

            // 2. 配置 Claude Code CLI
            try {
              const claudeCliDir = path.join(os.homedir(), '.claude')
              const cliConfigPath = path.join(claudeCliDir, 'settings.json')

              let cliConfig = {}
              if (fs.existsSync(cliConfigPath)) {
                cliConfig = JSON.parse(fs.readFileSync(cliConfigPath, 'utf-8'))
              }

              if (!cliConfig.mcpServers) {
                cliConfig.mcpServers = {}
              }

              cliConfig.mcpServers.bongmaster = {
                command: electronPath,
                args: ['--mcp-server']
              }

              if (!fs.existsSync(claudeCliDir)) {
                fs.mkdirSync(claudeCliDir, { recursive: true })
              }

              fs.writeFileSync(cliConfigPath, JSON.stringify(cliConfig, null, 2))
              cliConfigSuccess = true
              results.push('✅ Claude Code CLI 配置成功')
            } catch (err) {
              results.push(`❌ Claude Code CLI 配置失败: ${err.message}`)
            }

            // 3. 显示结果对话框
            const resultMessage = results.join('\n')
            const detailMessage = `MCP 工具列表:\n• list_projects - 列出所有项目\n• get_project - 获取项目详情\n• create_project - 创建项目\n• update_project - 更新项目\n• delete_project - 删除项目\n• list_tasks - 列出任务\n• create_task - 创建任务\n• update_task - 更新任务\n• delete_task - 删除任务\n• get_daily_tasks - 获取每日任务\n• create_daily_task - 创建每日任务\n• update_daily_task - 更新每日任务\n• update_daily_task_status - 标记任务完成\n• delete_daily_task - 删除每日任务\n• list_daily_subtasks - 列出每日任务子任务\n• create_daily_subtask - 创建每日任务子任务\n• update_daily_subtask - 更新每日任务子任务\n• delete_daily_subtask - 删除每日任务子任务\n• list_habits - 列出习惯\n• get_habit - 获取习惯详情\n• create_habit - 创建习惯\n• update_habit - 更新习惯\n• delete_habit - 删除习惯\n• archive_habit - 归档习惯\n• list_habit_checkins - 列出打卡记录\n• create_habit_checkin - 创建打卡记录\n• update_habit_checkin - 更新打卡记录\n• delete_habit_checkin - 删除打卡记录\n• checkin_today - 今日打卡\n• list_desktop_notes - 列出桌面便签\n• get_desktop_note - 获取便签详情\n• create_desktop_note - 创建便签\n• update_desktop_note - 更新便签\n• delete_desktop_note - 删除便签\n• list_categories - 列出分类\n• create_category - 创建分类\n• delete_category - 删除分类\n• get_statistics - 获取统计数据\n\n配置完成后请重启 Claude Desktop 或 Claude Code CLI。`

            dialog.showMessageBox(mainWindow, {
              type: desktopConfigSuccess || cliConfigSuccess ? 'info' : 'error',
              title: 'MCP 自动配置结果',
              message: resultMessage,
              detail: detailMessage,
              buttons: ['复制配置内容', '关闭'],
              defaultId: 1
            }).then(({ response }) => {
              if (response === 0) {
                const fullConfig = {
                  claudeDesktop: desktopConfigSuccess ? { mcpServers: { bongmaster: { command: electronPath, args: ['--mcp-server'] } } } : null,
                  claudeCli: cliConfigSuccess ? { mcpServers: { bongmaster: { command: electronPath, args: ['--mcp-server'] } } } : null
                }
                clipboard.writeText(JSON.stringify(fullConfig, null, 2))
                dialog.showMessageBox(mainWindow, {
                  type: 'info',
                  title: '已复制',
                  message: '配置内容已复制到剪贴板'
                })
              }
            })
          }
        },
        {
          label: 'MCP 配置说明',
          click: () => {
            const configPath = require('os').homedir() + '/Library/Application Support/Claude/claude_desktop_config.json'
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
              title: 'MCP Server 配置说明',
              message: 'MCP Server 配置说明',
              detail: `在 Claude Desktop 配置文件中添加以下内容:

配置文件路径:
${configPath}

配置内容:
${JSON.stringify(config, null, 2)}

添加后重启 Claude Desktop，即可在对话中使用 BongMaster 工具。`,
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

一个简洁的项目管理工具。
-from Ason's BongBong

✅ MCP Server 已集成
支持 Claude Desktop 和 Claude Code CLI

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
