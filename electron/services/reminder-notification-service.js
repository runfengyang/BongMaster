const { Notification } = require('electron')

class ReminderNotificationService {
  constructor(dbService) {
    this.dbService = dbService
    this.timer = null
    this.getWindow = null
  }

  start(getWindow) {
    this.stop()
    this.getWindow = getWindow
    this.check()
    this.timer = setInterval(() => this.check(), 30000)
    if (typeof this.timer.unref === 'function') this.timer.unref()
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  check() {
    if (!Notification.isSupported()) return
    let due = []
    try {
      due = this.dbService.getDueRemindersForNotification(new Date())
    } catch (err) {
      console.warn('[Reminders] notification query failed:', err.message)
      return
    }

    for (const reminder of due) {
      try {
        const time = reminder.remind_time || reminder.due_time || ''
        const notification = new Notification({
          title: reminder.title,
          body: [reminder.list_name, time].filter(Boolean).join(' · ')
        })
        notification.on('click', () => {
          const win = this.getWindow?.()
          if (!win || win.isDestroyed()) return
          if (win.isMinimized()) win.restore()
          win.show()
          win.focus()
          win.webContents.send('reminders:focus', reminder.id)
        })
        notification.show()
        this.dbService.markReminderNotified(reminder.id)
      } catch (err) {
        console.warn('[Reminders] notification failed:', err.message)
      }
    }
  }
}

module.exports = { ReminderNotificationService }
