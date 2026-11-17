const { execFile } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const CALENDAR_NAME = process.env.BONGMASTER_MAC_CALENDAR || '日程'
const LEGACY_CALENDAR_NAME = 'BongMaster'
const FIELD_SEP = '\x1f'
const RECORD_SEP = '\x1e'

const pad2 = value => String(value).padStart(2, '0')
const escapeAppleScript = value => String(value ?? '')
  .replace(/\\/g, '\\\\')
  .replace(/"/g, '\\"')
  .replace(/\r?\n/g, ' ')
const parseDateKey = key => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''))
  if (!match) return null
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}
const shiftDateKey = (key, days) => {
  const date = new Date(`${key}T12:00:00`)
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

const runAppleScript = script => new Promise((resolve, reject) => {
  const file = path.join(os.tmpdir(), `bongmaster-calendar-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.applescript`)
  fs.writeFileSync(file, script, 'utf8')
  execFile('osascript', [file], { timeout: 120000, killSignal: 'SIGKILL', maxBuffer: 12 * 1024 * 1024 }, (error, stdout, stderr) => {
    fs.rm(file, { force: true }, () => {})
    if (!error) {
      resolve(String(stdout || ''))
      return
    }
    const raw = String(stderr || error.message || '')
    if (/-1743|not authorized|Not authorized/i.test(raw)) {
      reject(new Error('需要在“系统设置 > 隐私与安全性 > 自动化”中允许 BongMaster 控制“日历”'))
      return
    }
    reject(new Error(raw.trim() || '无法访问 macOS 日历'))
  })
})

const dateBlock = (name, date, time) => {
  const [hour, minute] = String(time || '00:00').split(':').map(Number)
  return [
    `set ${name} to current date`,
    `set day of ${name} to 1`,
    `set year of ${name} to ${date.year}`,
    `set month of ${name} to ${date.month}`,
    `set day of ${name} to ${date.day}`,
    `set hours of ${name} to ${Number.isFinite(hour) ? hour : 0}`,
    `set minutes of ${name} to ${Number.isFinite(minute) ? minute : 0}`,
    `set seconds of ${name} to 0`
  ].join('\n')
}

const buildPullScript = (startDate, endDate, calendarNames = []) => {
  const start = parseDateKey(startDate)
  const end = parseDateKey(endDate)
  const names = (Array.isArray(calendarNames) ? calendarNames : []).filter(Boolean)
  return `set fieldSep to ASCII character 31
set recordSep to ASCII character 30
set output to ""
set targetNames to {${names.map(name => `"${escapeAppleScript(name)}"`).join(', ')}}
tell application "Calendar"
  set calList to every calendar
  repeat with cal in calList
    set output to output & "C" & fieldSep & (name of cal) & fieldSep & ((writable of cal) as integer) & recordSep
  end repeat
  repeat with cal in calList
    set calName to name of cal
    set relevant to false
    if (count of targetNames) = 0 then
      if calName is "${escapeAppleScript(CALENDAR_NAME)}" then set relevant to true
    else if targetNames contains calName then
      set relevant to true
    end if
    if relevant then
      if writable of cal then
        tell cal
${dateBlock('startD', start, '00:00')}
${dateBlock('endD', end, '23:59')}
        set evs to every event whose start date is greater than or equal to startD and start date is less than or equal to endD
        repeat with ev in evs
          set summaryText to ""
          set descriptionText to ""
          set locationText to ""
          set uidText to ""
          set stampYear to 0
          set stampMonth to 0
          set stampDay to 0
          set stampHour to 0
          set stampMinute to 0
          set stampSecond to 0
          try
            set summaryText to summary of ev
          end try
          try
            set descriptionText to description of ev
          end try
          try
            set locationText to location of ev
          end try
          try
            set uidText to uid of ev
          end try
          try
            set stampDate to stamp date of ev
            set stampYear to year of stampDate
            set stampMonth to month of stampDate as integer
            set stampDay to day of stampDate
            set stampHour to hours of stampDate
            set stampMinute to minutes of stampDate
            set stampSecond to seconds of stampDate
          end try
          set sd to start date of ev
          set ed to end date of ev
          set output to output & "E" & fieldSep & calName & fieldSep & summaryText & fieldSep & uidText & fieldSep & stampYear & fieldSep & stampMonth & fieldSep & stampDay & fieldSep & stampHour & fieldSep & stampMinute & fieldSep & stampSecond & fieldSep & (year of sd) & fieldSep & (month of sd as integer) & fieldSep & (day of sd) & fieldSep & (hours of sd) & fieldSep & (minutes of sd) & fieldSep & (year of ed) & fieldSep & (month of ed as integer) & fieldSep & (day of ed) & fieldSep & (hours of ed) & fieldSep & (minutes of ed) & fieldSep & ((allday event of ev) as integer) & fieldSep & descriptionText & fieldSep & locationText & recordSep
        end repeat
      end tell
      end if
    end if
  end repeat
end tell
return output`
}

const buildRenameLegacyScript = (legacyBaseName = '') => {
  const base = String(legacyBaseName || CALENDAR_NAME).trim()
  const prefix = `${LEGACY_CALENDAR_NAME} · `
  const startIndex = prefix.length + 1
  const lines = ['tell application "Calendar"']
  if (base && base !== LEGACY_CALENDAR_NAME) {
    lines.push('  try')
    lines.push(`    if (exists calendar "${escapeAppleScript(LEGACY_CALENDAR_NAME)}") and not (exists calendar "${escapeAppleScript(base)}") then`)
    lines.push(`      set name of calendar "${escapeAppleScript(LEGACY_CALENDAR_NAME)}" to "${escapeAppleScript(base)}"`)
    lines.push('    end if')
    lines.push('  end try')
  }
  lines.push('  set calList to every calendar')
  lines.push('  repeat with cal in calList')
  lines.push('    set calName to name of cal')
  lines.push(`    if calName starts with "${escapeAppleScript(prefix)}" then`)
  lines.push(`      set targetName to text ${startIndex} thru -1 of calName`)
  lines.push('      if not (exists calendar targetName) then')
  lines.push('        try')
  lines.push('          set name of cal to targetName')
  lines.push('        end try')
  lines.push('      end if')
  lines.push('    end if')
  lines.push('  end repeat')
  lines.push('end tell', 'return "ok"')
  return lines.join('\n')
}

const buildClearScript = (startDate, endDate) => {
  const start = parseDateKey(startDate)
  const end = parseDateKey(endDate)
  return `tell application "Calendar"
  if exists calendar "${CALENDAR_NAME}" then
    tell calendar "${CALENDAR_NAME}"
${dateBlock('startD', start, '00:00')}
${dateBlock('endD', end, '23:59')}
      set doomed to {}
      set evs to every event whose start date is greater than or equal to startD and start date is less than or equal to endD
      repeat with ev in evs
        try
          if (description of ev as string) starts with "[bm:" then set end of doomed to ev
        end try
      end repeat
      repeat with ev in doomed
        delete ev
      end repeat
    end tell
  end if
end tell
return "ok"`
}

const buildDeleteEventsScript = (uids, calendarName = CALENDAR_NAME) => {
  const lines = [
    'tell application "Calendar"',
    `  if exists calendar "${calendarName}" then`,
    `    tell calendar "${calendarName}"`
  ]
  for (const uid of uids) {
    if (!uid) continue
    lines.push('      try', `        delete (first event whose uid is "${escapeAppleScript(uid)}")`, '      end try')
  }
  lines.push('    end tell', '  end if', 'end tell', 'return "ok"')
  return lines.join('\n')
}

const buildUpdateEventsScript = (updates, calendarName = CALENDAR_NAME) => {
  const lines = [
    'tell application "Calendar"',
    `  if exists calendar "${calendarName}" then`,
    `    tell calendar "${calendarName}"`
  ]
  updates.forEach((event, index) => {
    if (!event.uid) return
    const start = parseDateKey(event.startDate)
    const end = parseDateKey(event.endDate || event.startDate)
    if (!start || !end) return
    const timed = !event.allDay
    const startTime = timed ? (event.startTime || '09:00') : '00:00'
    const endDate = timed ? (event.endDate || event.startDate) : shiftDateKey(event.endDate || event.startDate, 1)
    const endParts = parseDateKey(endDate)
    const endTime = timed ? (event.endTime || '10:00') : '00:00'
    const description = `${event.marker ? `[${event.marker}] ` : ''}${event.notes || ''}`.trim()
    lines.push(`      try`)
    lines.push(`        set targetEvent${index} to first event whose uid is "${escapeAppleScript(event.uid)}"`)
    lines.push(dateBlock(`startD${index}`, start, startTime))
    lines.push(dateBlock(`endD${index}`, endParts, endTime))
    lines.push(`        set tempEnd${index} to current date`)
    lines.push(`        set day of tempEnd${index} to 1`)
    lines.push(`        set year of tempEnd${index} to 2099`)
    lines.push(`        set month of tempEnd${index} to 12`)
    lines.push(`        set day of tempEnd${index} to 31`)
    lines.push(`        set hours of tempEnd${index} to 0`)
    lines.push(`        set minutes of tempEnd${index} to 0`)
    lines.push(`        set seconds of tempEnd${index} to 0`)
    lines.push(`        set end date of targetEvent${index} to tempEnd${index}`)
    lines.push(`        set start date of targetEvent${index} to startD${index}`)
    lines.push(`        set end date of targetEvent${index} to endD${index}`)
    lines.push(`        set allday event of targetEvent${index} to ${event.allDay ? 'true' : 'false'}`)
    lines.push(`        set summary of targetEvent${index} to "${escapeAppleScript(event.title || '新建日程')}"`)
    lines.push(`        set description of targetEvent${index} to "${escapeAppleScript(description)}"`)
    lines.push(`        set location of targetEvent${index} to "${escapeAppleScript(event.location || '')}"`)
    lines.push('      end try')
  })
  lines.push('    end tell', '  end if', 'end tell', 'return "ok"')
  return lines.join('\n')
}

const applyChanges = async ({ creates = [], updates = [], deletes = [] } = {}) => {
  if (process.platform !== 'darwin') throw new Error('仅支持 macOS 日历')
  const groups = new Map()
  const ensure = name => {
    const calendar = name || CALENDAR_NAME
    if (!groups.has(calendar)) groups.set(calendar, { creates: [], updates: [], deletes: [] })
    return groups.get(calendar)
  }
  for (const item of Array.isArray(creates) ? creates : []) {
    if (!item?.startDate) continue
    ensure(item.calendarName).creates.push(item)
  }
  for (const item of Array.isArray(updates) ? updates : []) {
    if (!item?.uid) continue
    ensure(item.calendarName).updates.push(item)
  }
  for (const item of Array.isArray(deletes) ? deletes : []) {
    const uid = typeof item === 'string' ? item : item?.uid
    if (!uid) continue
    ensure(typeof item === 'string' ? CALENDAR_NAME : item.calendarName).deletes.push(uid)
  }
  let deleted = 0
  let updated = 0
  let created = 0
  for (const [calendarName, group] of groups) {
    if (group.deletes.length) {
      await runAppleScript(buildDeleteEventsScript(group.deletes, calendarName))
      deleted += group.deletes.length
    }
    if (group.updates.length) {
      await runAppleScript(buildUpdateEventsScript(group.updates, calendarName))
      updated += group.updates.length
    }
    if (group.creates.length) {
      await runAppleScript(buildPushScript(group.creates, calendarName))
      created += group.creates.length
    }
  }
  return { deletes: deleted, updates: updated, creates: created }
}

const buildPushScript = (events, calendarName = CALENDAR_NAME) => {
  const lines = [
    `tell application "Calendar"`,
    `  if not (exists calendar "${calendarName}") then`,
    `    make new calendar with properties {name:"${calendarName}"}`,
    `  end if`,
    `  tell calendar "${calendarName}"`
  ]
  events.forEach((event, index) => {
    const start = parseDateKey(event.startDate)
    const end = parseDateKey(event.endDate || event.startDate)
    if (!start || !end) return
    const timed = !event.allDay
    const startTime = timed ? (event.startTime || '09:00') : '00:00'
    const allDayEnd = shiftDateKey(event.endDate || event.startDate, 1)
    const endDate = timed ? (event.endDate || event.startDate) : allDayEnd
    const endTime = timed ? (event.endTime || '10:00') : '00:00'
    const endParts = parseDateKey(endDate)
    const description = `${event.marker ? `[${event.marker}] ` : ''}${event.notes || ''}`.trim()
    lines.push(dateBlock(`startD${index}`, start, startTime))
    lines.push(dateBlock(`endD${index}`, endParts, endTime))
    lines.push(`    make new event with properties {summary:"${escapeAppleScript(event.title || '新建日程')}", start date:startD${index}, end date:endD${index}, allday event:${event.allDay ? 'true' : 'false'}, description:"${escapeAppleScript(description)}", location:"${escapeAppleScript(event.location || '')}"}`)
  })
  lines.push('  end tell', 'end tell', 'return "ok"')
  return lines.join('\n')
}

const parsePullOutput = output => {
  const calendars = []
  const events = []
  if (!output) return { calendars, events }
  for (const record of output.split(RECORD_SEP)) {
    if (!record) continue
    const fields = record.split(FIELD_SEP)
    if (fields[0] === 'C' && fields.length >= 3) {
      calendars.push({ name: fields[1], writable: fields[2] === '1' })
      continue
    }
    if ((fields[0] === 'E' ? fields.length - 1 : fields.length) < 22) continue
    const values = fields[0] === 'E' ? fields.slice(1) : fields
    const [calendarName, summary, uid, stampY, stampM, stampD, stampH, stampMin, stampS, sy, sm, sd, sh, smin, ey, em, ed, eh, emin, allDayRaw, description, location] = values
    const stamp = `${Number(stampY)}-${pad2(Number(stampM))}-${pad2(Number(stampD))} ${pad2(Number(stampH))}:${pad2(Number(stampMin))}:${pad2(Number(stampS))}`
    const startDate = `${Number(sy)}-${pad2(Number(sm))}-${pad2(Number(sd))}`
    const endRaw = `${Number(ey)}-${pad2(Number(em))}-${pad2(Number(ed))}`
    const allDay = Number(allDayRaw) === 1
    const endDate = allDay ? shiftDateKey(endRaw, -1) : endRaw
    events.push({
      calendarName,
      uid: uid || `${calendarName}-${summary}-${startDate}-${allDay ? 'all' : `${pad2(Number(sh))}:${pad2(Number(smin))}`}`,
      stamp,
      title: summary,
      startDate,
      endDate: endDate < startDate ? startDate : endDate,
      startTime: allDay ? null : `${pad2(Number(sh))}:${pad2(Number(smin))}`,
      endTime: allDay ? null : `${pad2(Number(eh))}:${pad2(Number(emin))}`,
      allDay,
      description: description || '',
      location: location || ''
    })
  }
  return { calendars, events }
}

const pullMonth = async ({ startDate, endDate, calendarNames = [], legacyBaseName = '' } = {}) => {
  if (process.platform !== 'darwin') throw new Error('仅支持 macOS 日历')
  if (!parseDateKey(startDate) || !parseDateKey(endDate)) throw new Error('同步日期无效')
  const names = (Array.isArray(calendarNames) ? calendarNames : []).filter(Boolean)
  if (legacyBaseName) {
    try {
      await runAppleScript(buildRenameLegacyScript(legacyBaseName))
    } catch (error) {
      console.warn('[CalendarMac] legacy calendar rename skipped:', error.message)
    }
  }
  const output = await runAppleScript(buildPullScript(startDate, endDate, names))
  const parsed = parsePullOutput(output)
  return { calendar: CALENDAR_NAME, calendars: parsed.calendars, events: parsed.events }
}

const pushMonth = async ({ startDate, endDate, events = [] } = {}) => {
  if (process.platform !== 'darwin') throw new Error('仅支持 macOS 日历')
  if (!parseDateKey(startDate) || !parseDateKey(endDate)) throw new Error('同步日期无效')
  const existing = await pullMonth({ startDate, endDate })
  const removed = existing.events.filter(event => /^\[bm:\d+:[^\]]+\]/.test(event.description || '')).length
  await runAppleScript(buildClearScript(startDate, endDate))
  const pending = events.filter(event => event.startDate && event.endDate)
  if (pending.length) await runAppleScript(buildPushScript(pending))
  return { calendar: CALENDAR_NAME, created: pending.length, removed, skipped: 0 }
}

module.exports = { CALENDAR_NAME, LEGACY_CALENDAR_NAME, pushMonth, pullMonth, applyChanges, buildPushScript, buildPullScript, buildRenameLegacyScript, buildClearScript, buildDeleteEventsScript, buildUpdateEventsScript, parsePullOutput }
