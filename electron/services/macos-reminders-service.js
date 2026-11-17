const { execFile } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const FIELD_SEP = '\x1f'
const RECORD_SEP = '\x1e'

const pad2 = value => String(value).padStart(2, '0')
const escapeAppleScript = value => String(value ?? '')
  .replace(/\\/g, '\\\\')
  .replace(/"/g, '\\"')

// AppleScript 字符串字面量不能写 \n，用 ASCII character 10 拼接保留换行。
const appleString = value => String(value ?? '')
  .split(/\r\n|\r|\n/)
  .map(part => `"${escapeAppleScript(part)}"`)
  .join(' & (ASCII character 10) & ')

const runAppleScript = script => new Promise((resolve, reject) => {
  if (process.platform !== 'darwin') {
    reject(new Error('仅支持 macOS 提醒事项'))
    return
  }
  const file = path.join(os.tmpdir(), `bongmaster-reminder-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.applescript`)
  fs.writeFileSync(file, script, 'utf8')
  execFile('osascript', [file], { timeout: 120000, killSignal: 'SIGKILL', maxBuffer: 12 * 1024 * 1024 }, (error, stdout, stderr) => {
    fs.rm(file, { force: true }, () => {})
    if (!error) {
      resolve(String(stdout || ''))
      return
    }
    const raw = String(stderr || error.message || '')
    if (/-1743|not authorized|Not authorized/i.test(raw)) {
      reject(new Error('需要在“系统设置 > 隐私与安全性 > 自动化”中允许 BongMaster 控制“提醒事项”'))
      return
    }
    reject(new Error(raw.trim() || '无法访问 macOS 提醒事项'))
  })
})

const dateBlock = (name, parts) => {
  if (!parts) return ''
  return [
    `set ${name} to current date`,
    `set day of ${name} to 1`,
    `set year of ${name} to ${parts.year}`,
    `set month of ${name} to ${parts.month}`,
    `set day of ${name} to ${parts.day}`,
    `set hours of ${name} to ${parts.hour || 0}`,
    `set minutes of ${name} to ${parts.minute || 0}`,
    `set seconds of ${name} to ${parts.second || 0}`
  ].join('\n')
}

const parseDateKey = key => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''))
  if (!match) return null
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

const parseTimeKey = key => {
  const match = /^(\d{2}):(\d{2})$/.exec(String(key || ''))
  if (!match) return null
  return { hour: Number(match[1]), minute: Number(match[2]) }
}

const datePartsFor = (dateKey, timeKey) => {
  const date = parseDateKey(dateKey)
  if (!date) return null
  const time = parseTimeKey(timeKey) || { hour: 0, minute: 0 }
  return { ...date, hour: time.hour, minute: time.minute, second: 0 }
}

const toDateKey = (year, month, day) => (
  year > 0 ? `${year}-${pad2(month)}-${pad2(day)}` : null
)

const toTimeKey = (hour, minute) => `${pad2(hour)}:${pad2(minute)}`

const toStamp = (year, month, day, hour, minute, second) => (
  year > 0 ? `${year}-${pad2(month)}-${pad2(day)} ${pad2(hour)}:${pad2(minute)}:${pad2(second)}` : ''
)

const toMs = (year, month, day, hour = 0, minute = 0, second = 0) => {
  if (!year) return 0
  const value = new Date(year, month - 1, day, hour, minute, second).getTime()
  return Number.isFinite(value) ? value : 0
}

const reminderRecordBlock = () => `        set rid to id of p
        set rname to name of p
        set rbody to body of p
        if rbody is missing value then set rbody to ""
        set completedRaw to 0
        if completed of p then set completedRaw to 1
        set compY to 0
        set compM to 0
        set compD to 0
        set compH to 0
        set compMin to 0
        set compS to 0
        set cd to completion date of p
        if cd is not missing value then
          set compY to year of cd
          set compM to month of cd as integer
          set compD to day of cd
          set compH to hours of cd
          set compMin to minutes of cd
          set compS to seconds of cd
        end if
        set dueKind to 0
        set dueY to 0
        set dueM to 0
        set dueD to 0
        set dueH to 0
        set dueMin to 0
        set dd to due date of p
        if dd is not missing value then
          set dueKind to 1
          set dueY to year of dd
          set dueM to month of dd as integer
          set dueD to day of dd
          set dueH to hours of dd
          set dueMin to minutes of dd
          if dueH = 0 and dueMin = 0 then set dueKind to 2
        end if
        set remY to 0
        set remM to 0
        set remD to 0
        set remH to 0
        set remMin to 0
        set remindValue to remind me date of p
        if remindValue is not missing value then
          set remY to year of remindValue
          set remM to month of remindValue as integer
          set remD to day of remindValue
          set remH to hours of remindValue
          set remMin to minutes of remindValue
        end if
        set priorityRaw to priority of p
        set flaggedRaw to 0
        if flagged of p then set flaggedRaw to 1
        set md to modification date of p
        set modY to year of md
        set modM to month of md as integer
        set modD to day of md
        set modH to hours of md
        set modMin to minutes of md
        set modS to seconds of md
        set output to output & "R" & fieldSep & lid & fieldSep & lname & fieldSep & rid & fieldSep & rname & fieldSep & rbody & fieldSep & completedRaw & fieldSep & compY & fieldSep & compM & fieldSep & compD & fieldSep & compH & fieldSep & compMin & fieldSep & compS & fieldSep & dueKind & fieldSep & dueY & fieldSep & dueM & fieldSep & dueD & fieldSep & dueH & fieldSep & dueMin & fieldSep & remY & fieldSep & remM & fieldSep & remD & fieldSep & remH & fieldSep & remMin & fieldSep & priorityRaw & fieldSep & flaggedRaw & fieldSep & modY & fieldSep & modM & fieldSep & modD & fieldSep & modH & fieldSep & modMin & fieldSep & modS & recordSep`

const buildPullScript = (mappedListIds = [], listNames = []) => {
  const mapped = (Array.isArray(mappedListIds) ? mappedListIds : []).filter(Boolean)
  const names = (Array.isArray(listNames) ? listNames : []).filter(Boolean)
  return `set fieldSep to ASCII character 31
set recordSep to ASCII character 30
set output to ""
set mappedIds to {${mapped.map(id => `"${escapeAppleScript(id)}"`).join(', ')}}
set targetNames to {${names.map(name => `"${escapeAppleScript(name)}"`).join(', ')}}
tell application "Reminders"
  set allLists to every list
  set allListIds to id of every list
  set allListNames to name of every list
  repeat with i from 1 to count of allLists
    set output to output & "L" & fieldSep & (item i of allListIds) & fieldSep & (item i of allListNames) & recordSep
  end repeat
  repeat with i from 1 to count of allLists
    set lid to item i of allListIds
    set lname to item i of allListNames
    set relevant to false
    if targetNames contains lname then set relevant to true
    if mappedIds contains lid then set relevant to true
    if relevant then
      set props to properties of (every reminder of item i of allLists whose completed is false)
      repeat with p in props
${reminderRecordBlock()}
      end repeat
    end if
  end repeat
end tell
return output`
}

const buildCompletedIdsScript = (mappedListIds = [], listNames = []) => {
  const mapped = (Array.isArray(mappedListIds) ? mappedListIds : []).filter(Boolean)
  const names = (Array.isArray(listNames) ? listNames : []).filter(Boolean)
  return `set fieldSep to ASCII character 31
set recordSep to ASCII character 30
set output to ""
set mappedIds to {${mapped.map(id => `"${escapeAppleScript(id)}"`).join(', ')}}
set targetNames to {${names.map(name => `"${escapeAppleScript(name)}"`).join(', ')}}
tell application "Reminders"
  set allLists to every list
  set allListIds to id of every list
  set allListNames to name of every list
  repeat with i from 1 to count of allLists
    set lid to item i of allListIds
    set lname to item i of allListNames
    set relevant to false
    if targetNames contains lname then set relevant to true
    if mappedIds contains lid then set relevant to true
    if relevant then
      set completedIdList to id of (every reminder of item i of allLists whose completed is true)
      repeat with completedId in completedIdList
        set output to output & "X" & fieldSep & lid & fieldSep & completedId & recordSep
      end repeat
    end if
  end repeat
end tell
return output`
}

const parsePullOutput = output => {
  const lists = []
  const reminders = []
  const completedIds = []
  if (!output) return { lists, reminders, completedIds }
  for (const record of output.split(RECORD_SEP)) {
    if (!record) continue
    const fields = record.split(FIELD_SEP)
    if (fields[0] === 'L' && fields.length >= 3) {
      lists.push({ id: fields[1], name: fields[2] })
      continue
    }
    if (fields[0] === 'X' && fields.length >= 3) {
      completedIds.push(fields[2])
      continue
    }
    if (fields[0] !== 'R' || fields.length < 32) continue
    const [
      , listId, listName, id, name, body, completedRaw,
      compY, compM, compD, compH, compMin, compS,
      dueKindRaw, dueY, dueM, dueD, dueH, dueMin,
      remY, remM, remD, remH, remMin,
      priorityRaw, flaggedRaw,
      modY, modM, modD, modH, modMin, modS
    ] = fields
    const dueKind = Number(dueKindRaw) || 0
    reminders.push({
      id,
      listId,
      listName,
      name,
      body: body || '',
      completed: Number(completedRaw) === 1,
      completionDate: toStamp(Number(compY), Number(compM), Number(compD), Number(compH), Number(compMin), Number(compS)) || null,
      dueKind,
      dueDate: dueKind ? toDateKey(Number(dueY), Number(dueM), Number(dueD)) : null,
      dueTime: dueKind === 1 ? toTimeKey(Number(dueH), Number(dueMin)) : null,
      remindDate: Number(remY) ? toDateKey(Number(remY), Number(remM), Number(remD)) : null,
      remindTime: Number(remY) ? toTimeKey(Number(remH), Number(remMin)) : null,
      priority: Number(priorityRaw) || 0,
      flagged: Number(flaggedRaw) === 1,
      modificationDate: toStamp(Number(modY), Number(modM), Number(modD), Number(modH), Number(modMin), Number(modS)),
      modifiedMs: toMs(Number(modY), Number(modM), Number(modD), Number(modH), Number(modMin), Number(modS))
    })
  }
  return { lists, reminders, completedIds }
}

const reminderProperties = payload => {
  const parts = [
    `name:${appleString(payload.title || '新建提醒')}`,
    `body:${appleString(payload.notes || '')}`,
    `completed:${payload.is_completed ? 'true' : 'false'}`,
    `flagged:${payload.is_flagged ? 'true' : 'false'}`,
    `priority:${Number(payload.priorityNumber) || 0}`
  ]
  return parts.join(', ')
}

const dueAssignment = targetVar => [
  'try',
  `  set due date of ${targetVar} to missing value`,
  'end try',
  'try',
  `  set allday due date of ${targetVar} to missing value`,
  'end try'
].join('\n')

const buildApplyScript = ({ creates = [], updates = [], deletes = [] } = {}) => {
  const lines = [
    'set fieldSep to ASCII character 31',
    'set output to ""',
    'tell application "Reminders"'
  ]

  creates.forEach((item, index) => {
    const payload = item.payload || {}
    const listName = item.listName || ''
    const dueParts = payload.date ? datePartsFor(payload.date, payload.is_all_day ? null : payload.due_time) : null
    if (dueParts) lines.push(dateBlock(`dueD${index}`, { ...dueParts, hour: payload.is_all_day ? 0 : dueParts.hour, minute: payload.is_all_day ? 0 : dueParts.minute }))
    lines.push('set createdId to ""')
    lines.push('try')
    lines.push(`  if not (exists list ${appleString(listName)}) then`)
    lines.push(`    make new list with properties {name:${appleString(listName)}}`)
    lines.push('  end if')
    const props = [reminderProperties({
      ...payload,
      priorityNumber: payload.priorityNumber
    })]
    if (dueParts) {
      props.push(payload.is_all_day ? `allday due date:dueD${index}` : `due date:dueD${index}`)
    }
    lines.push(`  set newReminder to make new reminder at end of list ${appleString(listName)} with properties {${props.join(', ')}}`)
    lines.push('  set createdId to id of newReminder')
    lines.push('end try')
    lines.push('set output to output & createdId & fieldSep')
  })

  updates.forEach((item, index) => {
    const payload = item.payload || {}
    const completedValue = payload.is_completed ? 'true' : 'false'
    const dueParts = payload.date ? datePartsFor(payload.date, payload.is_all_day ? null : payload.due_time) : null
    if (dueParts) lines.push(dateBlock(`updDueD${index}`, { ...dueParts, hour: payload.is_all_day ? 0 : dueParts.hour, minute: payload.is_all_day ? 0 : dueParts.minute }))
    lines.push('try')
    lines.push(`  set targetReminder to first reminder whose id is "${escapeAppleScript(item.macId)}"`)
    lines.push(`  set name of targetReminder to ${appleString(payload.title || '')}`)
    lines.push(`  set body of targetReminder to ${appleString(payload.notes || '')}`)
    lines.push(`  if (completed of targetReminder) is not ${completedValue} then`)
    lines.push(`    set completed of targetReminder to ${completedValue}`)
    lines.push('  end if')
    lines.push(`  set flagged of targetReminder to ${payload.is_flagged ? 'true' : 'false'}`)
    lines.push(`  set priority of targetReminder to ${Number(payload.priorityNumber) || 0}`)
    lines.push(dueAssignment('targetReminder'))
    if (dueParts) {
      lines.push('  try')
      lines.push(payload.is_all_day
        ? `    set allday due date of targetReminder to updDueD${index}`
        : `    set due date of targetReminder to updDueD${index}`)
      lines.push('  end try')
    }
    lines.push('end try')
  })

  deletes.forEach(item => {
    lines.push('try')
    lines.push(`  delete (first reminder whose id is "${escapeAppleScript(item.macId)}")`)
    lines.push('end try')
  })

  lines.push('end tell')
  lines.push('return output')
  return lines.join('\n')
}

const buildListScript = ({ creates = [], renames = [] } = {}) => {
  const lines = [
    'set fieldSep to ASCII character 31',
    'set output to ""',
    'tell application "Reminders"'
  ]
  creates.forEach(item => {
    const name = typeof item === 'string' ? item : item?.name
    if (!name) {
      lines.push('set output to output & fieldSep')
      return
    }
    lines.push('set createdListId to ""')
    lines.push('try')
    lines.push(`  if not (exists list ${appleString(name)}) then`)
    lines.push(`    make new list with properties {name:${appleString(name)}}`)
    lines.push('  end if')
    lines.push(`  set createdListId to id of first list whose name is ${appleString(name)}`)
    lines.push('end try')
    lines.push('set output to output & createdListId & fieldSep')
  })
  renames.forEach(item => {
    if (!item?.macListId || !item?.name) return
    lines.push('try')
    lines.push(`  set targetList to first list whose id is "${escapeAppleScript(item.macListId)}"`)
    lines.push(`  set name of targetList to ${appleString(item.name)}`)
    lines.push('end try')
  })
  lines.push('end tell')
  lines.push('return output')
  return lines.join('\n')
}

const parseIds = output => String(output || '')
  .replace(new RegExp(RECORD_SEP, 'g'), '')
  .split(FIELD_SEP)
  .map(value => value.trim())

const pull = async ({ mappedListIds = [], listNames = [], mappedIds = [] } = {}) => {
  const output = await runAppleScript(buildPullScript(mappedListIds, listNames))
  const parsed = parsePullOutput(output)
  const activeIds = new Set(parsed.reminders.map(item => item.id))
  const missing = (Array.isArray(mappedIds) ? mappedIds : []).filter(id => id && !activeIds.has(id))
  if (missing.length) {
    const completedOutput = await runAppleScript(buildCompletedIdsScript(mappedListIds, listNames))
    const completedIds = parsePullOutput(completedOutput).completedIds
    parsed.completedIds = completedIds.filter(id => missing.includes(id))
  }
  return parsed
}

const applyChanges = async payload => {
  const result = await runAppleScript(buildApplyScript(payload))
  return { createdIds: parseIds(result).slice(0, (payload?.creates || []).length) }
}

const applyLists = async payload => {
  const result = await runAppleScript(buildListScript(payload))
  return { createdIds: parseIds(result).slice(0, (payload?.creates || []).length) }
}

module.exports = {
  pull,
  applyChanges,
  applyLists,
  buildPullScript,
  buildCompletedIdsScript,
  buildApplyScript,
  buildListScript,
  parsePullOutput
}
