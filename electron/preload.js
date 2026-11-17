const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  // ===== 删除撤回 API =====
  // 删除是软删除，撤回 = 清掉 deleted_at，保留原 id 与全部关联。
  restoreEntities: (tableName, ids) => ipcRenderer.invoke('entity:restore', tableName, ids),
  restoreNoteProjectLink: (noteId, projectId) => ipcRenderer.invoke('noteProjectLink:restore', noteId, projectId),

  // ===== 项目 API =====
  getAllProjects: () => ipcRenderer.invoke('project:getAll'),
  getProjectById: (id) => ipcRenderer.invoke('project:getById', id),
  createProject: (data) => ipcRenderer.invoke('project:create', data),
  updateProject: (id, data) => ipcRenderer.invoke('project:update', id, data),
  deleteProject: (id) => ipcRenderer.invoke('project:delete', id),

  // ===== 任务 API =====
  getAllTasks: () => ipcRenderer.invoke('task:getAll'),
  getTasksByProjectId: (projectId) => ipcRenderer.invoke('task:getByProjectId', projectId),
  createTask: (data) => ipcRenderer.invoke('task:create', data),
  updateTask: (id, data) => ipcRenderer.invoke('task:update', id, data),
  deleteTask: (id) => ipcRenderer.invoke('task:delete', id),

  // ===== 本地日历 API =====
  getCalendarData: (startDate, endDate) => ipcRenderer.invoke('calendar:getData', startDate, endDate),
  searchCalendarEvents: (query) => ipcRenderer.invoke('calendar:search', query),
  createCalendar: (data) => ipcRenderer.invoke('calendar:createCategory', data),
  updateCalendar: (id, data) => ipcRenderer.invoke('calendar:updateCategory', id, data),
  deleteCalendar: (id) => ipcRenderer.invoke('calendar:deleteCategory', id),
  createCalendarEvent: (data) => ipcRenderer.invoke('calendar:createEvent', data),
  updateCalendarEvent: (id, data, options) => ipcRenderer.invoke('calendar:updateEvent', id, data, options || {}),
  deleteCalendarEvent: (id, options) => ipcRenderer.invoke('calendar:deleteEvent', id, options || {}),
  restoreCalendarEvents: (snapshot) => ipcRenderer.invoke('calendar:restoreEvents', snapshot),
  saveIcsFile: (payload) => ipcRenderer.invoke('calendar:saveIcs', payload),
  pushCalendarToMac: (payload) => ipcRenderer.invoke('calendarMac:push', payload),
  pullCalendarFromMac: (payload) => ipcRenderer.invoke('calendarMac:pull', payload),
  getMacCalendarName: () => ipcRenderer.invoke('calendarMac:getName'),
  applyMacCalendarChanges: (payload) => ipcRenderer.invoke('calendarMac:apply', payload),
  getMacSyncRecords: () => ipcRenderer.invoke('calendarMac:getSyncRecords'),
  saveMacSyncRecords: (records) => ipcRenderer.invoke('calendarMac:saveSyncRecords', records),
  deleteMacSyncRecords: (keys) => ipcRenderer.invoke('calendarMac:deleteSyncRecords', keys),

  // ===== 娱乐中心 API =====
  fetchFavicon: (url) => ipcRenderer.invoke('entertainment:fetchFavicon', url),
  getSystemIdleSeconds: () => ipcRenderer.invoke('system:idleSeconds'),

  // ===== 上班打卡 API =====
  getWorkAttendanceRange: (startDate, endDate) => ipcRenderer.invoke('workAttendance:getRange', startDate, endDate),
  getWorkAttendanceSettings: () => ipcRenderer.invoke('workAttendance:getSettings'),
  saveWorkAttendanceSettings: (data) => ipcRenderer.invoke('workAttendance:saveSettings', data),
  checkInWork: (date, at) => ipcRenderer.invoke('workAttendance:checkIn', date, at),
  checkOutWork: (date, at) => ipcRenderer.invoke('workAttendance:checkOut', date, at),
  pauseWork: (date, at) => ipcRenderer.invoke('workAttendance:pause', date, at),
  resumeWork: (date, at) => ipcRenderer.invoke('workAttendance:resume', date, at),
  saveWorkAttendance: (data) => ipcRenderer.invoke('workAttendance:save', data),
  deleteWorkAttendance: (id) => ipcRenderer.invoke('workAttendance:delete', id),

  // ===== 每日任务 API =====
  getDailyTasksByDate: (date) => ipcRenderer.invoke('dailyTask:getByDate', date),
  getDailyTaskHistoryStats: (date) => ipcRenderer.invoke('dailyTask:getHistoryStats', date),
  getRecentlyCompletedDailyTasks: (limit) => ipcRenderer.invoke('dailyTask:getRecentlyCompleted', limit),
  createDailyTask: (data) => ipcRenderer.invoke('dailyTask:create', data),
  updateDailyTask: (id, data) => ipcRenderer.invoke('dailyTask:update', id, data),
  deleteDailyTask: (id) => ipcRenderer.invoke('dailyTask:delete', id),
  toggleDailyTaskComplete: (id, isCompleted) => ipcRenderer.invoke('dailyTask:toggleComplete', id, isCompleted),
  reorderDailyTasks: (orderedIds) => ipcRenderer.invoke('dailyTask:reorder', orderedIds),
  moveDailyTasksToDate: (ids, date) => ipcRenderer.invoke('dailyTask:moveToDate', ids, date),

  // ===== 每日任务子任务 API =====
  getDailySubtasksByTaskIds: (taskIds) => ipcRenderer.invoke('dailySubtask:getByTaskIds', taskIds),
  getDailySubtasks: (taskId) => ipcRenderer.invoke('dailySubtask:getByTask', taskId),
  createDailySubtask: (taskId, data) => ipcRenderer.invoke('dailySubtask:create', taskId, data),
  updateDailySubtask: (id, data) => ipcRenderer.invoke('dailySubtask:update', id, data),
  deleteDailySubtask: (id) => ipcRenderer.invoke('dailySubtask:delete', id),
  reorderDailySubtasks: (taskId, orderedIds) => ipcRenderer.invoke('dailySubtask:reorder', taskId, orderedIds),

  // ===== 每日任务重复规则 API =====
  getDailyTaskRepeatRules: () => ipcRenderer.invoke('dailyTaskRepeatRule:getAll'),
  createDailyTaskRepeatRule: (data) => ipcRenderer.invoke('dailyTaskRepeatRule:create', data),
  updateDailyTaskRepeatRule: (id, data) => ipcRenderer.invoke('dailyTaskRepeatRule:update', id, data),
  deleteDailyTaskRepeatRule: (id) => ipcRenderer.invoke('dailyTaskRepeatRule:delete', id),
  generateDailyTasksForDate: (date) => ipcRenderer.invoke('dailyTaskRepeatRule:generateForDate', date),

  // ===== 提醒事项 API =====
  getReminderLists: () => ipcRenderer.invoke('reminderList:getAll'),
  createReminderList: (data) => ipcRenderer.invoke('reminderList:create', data),
  updateReminderList: (id, data) => ipcRenderer.invoke('reminderList:update', id, data),
  deleteReminderList: (id) => ipcRenderer.invoke('reminderList:delete', id),
  reorderReminderLists: (orderedIds) => ipcRenderer.invoke('reminderList:reorder', orderedIds),
  getReminderSections: (listId) => ipcRenderer.invoke('reminderSection:getAll', listId),
  createReminderSection: (listId, data) => ipcRenderer.invoke('reminderSection:create', listId, data),
  updateReminderSection: (id, data) => ipcRenderer.invoke('reminderSection:update', id, data),
  deleteReminderSection: (id) => ipcRenderer.invoke('reminderSection:delete', id),
  restoreReminderSection: (id, reminderIds) => ipcRenderer.invoke('reminderSection:restore', id, reminderIds),
  reorderReminderSections: (listId, orderedIds) => ipcRenderer.invoke('reminderSection:reorder', listId, orderedIds),
  getReminders: () => ipcRenderer.invoke('reminder:getAll'),
  getReminderById: (id) => ipcRenderer.invoke('reminder:getById', id),
  createReminder: (data) => ipcRenderer.invoke('reminder:create', data),
  updateReminder: (id, data) => ipcRenderer.invoke('reminder:update', id, data),
  toggleReminderComplete: (id, isCompleted) => ipcRenderer.invoke('reminder:toggleComplete', id, isCompleted),
  deleteReminder: (id) => ipcRenderer.invoke('reminder:delete', id),
  restoreReminders: (ids) => ipcRenderer.invoke('reminder:restore', ids),
  reorderReminders: (orderedIds, sectionId) => ipcRenderer.invoke('reminder:reorder', orderedIds, sectionId),
  moveRemindersToList: (ids, listId, sectionId) => ipcRenderer.invoke('reminder:moveToList', ids, listId, sectionId),
  clearCompletedReminders: (listId, completedBefore) => ipcRenderer.invoke('reminder:clearCompleted', listId, completedBefore),
  duplicateReminder: (id) => ipcRenderer.invoke('reminder:duplicate', id),
  getRecentlyDeletedReminders: (limit) => ipcRenderer.invoke('reminder:getRecentlyDeleted', limit),
  purgeReminder: (id) => ipcRenderer.invoke('reminder:purge', id),
  syncRemindersWithMac: () => ipcRenderer.invoke('reminderMac:sync'),
  getReminderAttachments: (reminderId) => ipcRenderer.invoke('reminderAttachment:getByReminder', reminderId),
  addReminderAttachment: (reminderId) => ipcRenderer.invoke('reminderAttachment:add', reminderId),
  pickReminderAttachment: () => ipcRenderer.invoke('reminderAttachment:pick'),
  addReminderAttachmentFile: (reminderId, file) => ipcRenderer.invoke('reminderAttachment:addFile', reminderId, file),
  openReminderAttachment: (id) => ipcRenderer.invoke('reminderAttachment:open', id),
  deleteReminderAttachment: (id) => ipcRenderer.invoke('reminderAttachment:delete', id),

  // ===== 应用更新 =====
  getAppVersion: () => ipcRenderer.invoke('update:version'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  onUpdateProgress: (callback) => {
    const listener = (event, payload) => callback(payload)
    ipcRenderer.on('update:progress', listener)
    return () => ipcRenderer.removeListener('update:progress', listener)
  },
  onReminderFocus: (callback) => {
    const listener = (event, id) => callback(id)
    ipcRenderer.on('reminders:focus', listener)
    return () => ipcRenderer.removeListener('reminders:focus', listener)
  },

  // ===== 附件 API =====
  getDocumentsByProjectId: (projectId) => ipcRenderer.invoke('document:getByProjectId', projectId),
  uploadDocument: (projectId, fileData) => ipcRenderer.invoke('document:upload', projectId, fileData),
  downloadDocument: (documentId) => ipcRenderer.invoke('document:download', documentId),
  deleteDocument: (documentId) => ipcRenderer.invoke('document:delete', documentId),

  // ===== 数据导入/导出 =====
  exportData: () => ipcRenderer.invoke('data:export'),
  importData: () => ipcRenderer.invoke('data:import'),

  // ===== Balatro 游戏存档 =====
  balatroLoad: () => ipcRenderer.invoke('balatro:load'),
  balatroSave: (state) => ipcRenderer.invoke('balatro:save', state),
  balatroLoadKey: (key) => ipcRenderer.invoke('balatro:loadKey', key),
  balatroSaveKey: (key, state) => ipcRenderer.invoke('balatro:saveKey', key, state),

  // ===== 应用功能 =====
  getDataDir: () => ipcRenderer.invoke('app:getDataDir'),
  openDataDir: () => ipcRenderer.invoke('app:openDataDir'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  getSpellcheckLanguage: () => ipcRenderer.invoke('spellcheck:getLanguage'),
  onSpellcheckLanguageChanged: (callback) => {
    const listener = (event, language) => callback(language)
    ipcRenderer.on('spellcheck:language-changed', listener)
    return () => ipcRenderer.removeListener('spellcheck:language-changed', listener)
  },

  // ===== AI 功能 =====
  getAiConfig: () => ipcRenderer.invoke('ai:getConfig'),
  saveAiConfig: (config) => ipcRenderer.invoke('ai:saveConfig', config),
  chatWithAI: (messages, context, enableTools, interactive) => ipcRenderer.invoke('ai:chat', messages, context, enableTools, interactive),
  executeActions: (messages, context) => ipcRenderer.invoke('ai:executeActions', messages, context),
  stopChat: () => ipcRenderer.send('ai:stopChat'),

  // ===== 任务视图 API =====
  getTaskViews: () => ipcRenderer.invoke('taskView:getAll'),
  createTaskView: (data) => ipcRenderer.invoke('taskView:create', data),
  updateTaskView: (id, data) => ipcRenderer.invoke('taskView:update', id, data),
  deleteTaskView: (id) => ipcRenderer.invoke('taskView:delete', id),

  // ===== 任务完成统计 API =====
  recordTaskCompletion: (data) => ipcRenderer.invoke('task:recordCompletion', data),
  getTaskCompletionStats: (days, options) => ipcRenderer.invoke('task:getCompletionStats', days, options),
  getAverageCompletionTime: (projectId) => ipcRenderer.invoke('task:getAverageCompletionTime', projectId),
  getBusiestDays: (days) => ipcRenderer.invoke('task:getBusiestDays', days),

  // ===== 习惯 API =====
  getAllHabits: () => ipcRenderer.invoke('habit:getAll'),
  createHabit: (data) => ipcRenderer.invoke('habit:create', data),
  updateHabit: (id, data) => ipcRenderer.invoke('habit:update', id, data),
  deleteHabit: (id) => ipcRenderer.invoke('habit:delete', id),
  archiveHabit: (id, isArchived) => ipcRenderer.invoke('habit:archive', id, isArchived),

  // ===== 习惯打卡 API =====
  getAllCheckins: (startDate, endDate) => ipcRenderer.invoke('habitCheckin:getAll', startDate, endDate),
  getHabitCheckins: (habitId, startDate, endDate) => ipcRenderer.invoke('habitCheckin:getByHabit', habitId, startDate, endDate),
  getCheckinByDate: (habitId, date) => ipcRenderer.invoke('habitCheckin:getByDate', habitId, date),
  createHabitCheckin: (data) => ipcRenderer.invoke('habitCheckin:create', data),
  updateHabitCheckin: (id, data) => ipcRenderer.invoke('habitCheckin:update', id, data),
  deleteHabitCheckin: (id) => ipcRenderer.invoke('habitCheckin:delete', id),

  // ===== 桌面便签 API =====
  getDesktopNotes: (options) => ipcRenderer.invoke('desktopNote:getAll', options),
  getDesktopNotesByProject: (projectId) => ipcRenderer.invoke('desktopNote:getByProject', projectId),
  getDesktopNoteProjects: (noteId) => ipcRenderer.invoke('desktopNote:getProjects', noteId),
  createDesktopNote: (data) => ipcRenderer.invoke('desktopNote:create', data),
  updateDesktopNote: (id, data) => ipcRenderer.invoke('desktopNote:update', id, data),
  setDesktopNoteProjects: (id, projectIds) => ipcRenderer.invoke('desktopNote:setProjects', id, projectIds),
  archiveDesktopNote: (id, isArchived) => ipcRenderer.invoke('desktopNote:archive', id, isArchived),
  archiveDesktopNotes: (ids, isArchived) => ipcRenderer.invoke('desktopNote:archiveMany', ids, isArchived),
  deleteDesktopNote: (id) => ipcRenderer.invoke('desktopNote:delete', id),
  exportDesktopNoteToPdf: (id) => ipcRenderer.invoke('desktopNote:exportPdf', id),
  syncDesktopNoteToAppleNotes: async (id, options) => {
    try {
      return await ipcRenderer.invoke('desktopNote:syncToAppleNotes', id, options)
    } catch (error) {
      if (String(error.message || error).includes('No handler registered')) {
        return ipcRenderer.invoke('appleNotes:syncDesktopNote', id, options)
      }
      throw error
    }
  },

  // ===== 图片 API =====
  saveImage: (noteId, imageData, ext) => ipcRenderer.invoke('image:save', noteId, imageData, ext),
  getImageBaseDir: () => ipcRenderer.invoke('image:getBaseDir'),

  // ===== 分类 API =====
  getCategories: () => ipcRenderer.invoke('categories:getAll'),
  createCategory: (name) => ipcRenderer.invoke('categories:create', name),
  deleteCategory: (name) => ipcRenderer.invoke('categories:delete', name),
  updateNoteCategory: (noteId, category) => ipcRenderer.invoke('note:updateCategory', noteId, category),

  // ===== 事件监听 =====
})
