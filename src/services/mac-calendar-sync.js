import { planMacSync, macMarkerKey } from '@utils/calendar-mac-sync.js'

const toUtcMs = value => {
  if (!value) return 0
  const parsed = Date.parse(`${String(value).replace(' ', 'T')}Z`)
  return Number.isFinite(parsed) ? parsed : 0
}

const toLocalMs = value => {
  if (!value) return 0
  const parsed = Date.parse(String(value).replace(' ', 'T'))
  return Number.isFinite(parsed) ? parsed : 0
}

const legacyBaseNameFor = calendars => (
  calendars.find(item => item.name === '日程') || calendars[0]
)?.name || ''

/**
 * 以「最新修改为准」双向同步一段日期范围内的日历事件。
 * loadLocalItems 会在同步前和写回后各调用一次，用于拿到最新的本地事件
 * （包括刚从 macOS 导入的新事件及其 updated_at）。
 */
async function doSync({ startDate, endDate, calendars, loadLocalItems }) {
  const calendarNameList = calendars.map(item => item.name)
  const legacyBaseName = legacyBaseNameFor(calendars)
  const [macResult, records] = await Promise.all([
    window.electronAPI.pullCalendarFromMac({ startDate, endDate, calendarNames: calendarNameList, legacyBaseName }),
    window.electronAPI.getMacSyncRecords()
  ])

  const daytimeCalendar = calendars.find(item => item.name === '日程') || calendars[0]
  const macWritableByName = new Map((macResult.calendars || []).map(item => [item.name, item.writable]))
  const syncableCalendars = calendars.filter(item => macWritableByName.get(item.name) !== false)
  const skippedCalendars = calendars.filter(item => macWritableByName.get(item.name) === false)
  const calendarNames = new Map(syncableCalendars.map(item => [item.id, item.name]))
  const localIdByMacName = new Map(syncableCalendars.map(item => [item.name, item.id]))
  const localCalendarIdForName = name => localIdByMacName.get(name) || daytimeCalendar?.id

  const normalize = items => (Array.isArray(items) ? items : [])
    .filter(item => (
      item.sourceType !== 'task'
      && item.calendar_id
      && calendarNames.has(item.calendar_id)
      && item.startDate <= endDate
      && item.endDate >= startDate
    ))
    .map(item => ({
      ...item,
      occurrenceDate: item.occurrenceDate || item.startDate,
      updatedAtMs: item.updatedAtMs ?? toUtcMs(item.updatedAt),
      macCalendar: calendarNames.get(item.calendar_id)
    }))

  const macEvents = (macResult.events || []).map(event => ({
    ...event,
    stampMs: toLocalMs(event.stamp),
    localCalendarId: localCalendarIdForName(event.calendarName)
  }))

  const localBefore = normalize(await loadLocalItems())
  const plan = planMacSync({ localItems: localBefore, macEvents, records, startDate, endDate })

  if (plan.macCreates.length || plan.macUpdates.length || plan.macDeletes.length) {
    await window.electronAPI.applyMacCalendarChanges({
      creates: plan.macCreates.map(item => item.payload),
      updates: plan.macUpdates.map(item => ({ uid: item.uid, ...item.payload })),
      deletes: plan.macDeletes
    })
  }

  for (const operation of plan.localUpdates) {
    try {
      await window.electronAPI.updateCalendarEvent(
        operation.eventId,
        operation.payload,
        operation.isRecurring ? { scope: 'this', occurrenceDate: operation.occurrenceDate } : { scope: 'all' }
      )
    } catch {}
  }
  for (const operation of plan.localDeletes) {
    try {
      await window.electronAPI.deleteCalendarEvent(
        operation.eventId,
        operation.isRecurring ? { scope: 'this', occurrenceDate: operation.occurrenceDate } : { scope: 'all' }
      )
    } catch {}
  }

  const createdFromMac = []
  for (const operation of plan.localCreates) {
    try {
      const created = await window.electronAPI.createCalendarEvent({
        calendar_id: daytimeCalendar?.id,
        kind: 'event',
        recurrence_type: 'none',
        recurrence_value: '',
        recurrence_end_date: null,
        ...operation.payload
      })
      if (created) createdFromMac.push({ macUid: operation.macUid, key: `${created.id}:${created.start_date}` })
    } catch {}
  }
  if (plan.recordsToDelete.length) await window.electronAPI.deleteMacSyncRecords(plan.recordsToDelete)

  const localAfter = normalize(await loadLocalItems())
  const finalMac = await window.electronAPI.pullCalendarFromMac({
    startDate,
    endDate,
    calendarNames: calendarNameList,
    legacyBaseName
  })
  const finalEvents = (finalMac.events || []).map(event => ({ ...event, stampMs: toLocalMs(event.stamp) }))
  const finalByUid = new Map(finalEvents.map(event => [event.uid, event]))
  const finalByMarker = new Map()
  for (const event of finalEvents) {
    const marker = macMarkerKey(event)
    if (marker) finalByMarker.set(marker, event)
  }
  const recordByKey = new Map(records.map(record => [record.local_key, record]))
  const createdByKey = new Map(createdFromMac.map(item => [item.key, finalByUid.get(item.macUid)]))
  const recordsToSave = []
  for (const item of localAfter) {
    const key = `${item.eventId}:${item.occurrenceDate}`
    let macEvent = finalByMarker.get(key)
    if (!macEvent) {
      const record = recordByKey.get(key)
      if (record) macEvent = finalByUid.get(record.mac_uid)
    }
    if (!macEvent) macEvent = createdByKey.get(key)
    if (!macEvent) continue
    recordsToSave.push({
      local_key: key,
      mac_uid: macEvent.uid,
      mac_calendar: macEvent.calendarName || '',
      last_local_updated: String(item.updatedAtMs || 0),
      last_mac_updated: String(macEvent.stampMs || 0)
    })
  }
  if (recordsToSave.length) await window.electronAPI.saveMacSyncRecords(recordsToSave)

  return { summary: plan.summary, skippedCalendars }
}

let running = null

export function syncCalendarWithMac(args) {
  if (running) return running
  running = doSync(args).finally(() => {
    running = null
  })
  return running
}
