export const localSyncKey = item => `${item.eventId ?? item.id}:${item.occurrenceDate || item.startDate}`

export const macMarkerKey = event => {
  const match = /\[bm:(\d+:\d{4}-\d{2}-\d{2})\]/.exec(String(event.description || ''))
  return match ? match[1] : ''
}

const markerFor = key => `bm:${key}`

const localPayload = item => ({
  title: item.title,
  startDate: item.startDate,
  endDate: item.endDate,
  startTime: item.startTime || null,
  endTime: item.endTime || null,
  allDay: Boolean(item.allDay),
  location: item.location || '',
  notes: item.notes || '',
  calendarName: item.macCalendar || '日程'
})

const macNotes = event => String(event.description || '').replace(/^\[bm:\d+:\d{4}-\d{2}-\d{2}\]\s*/, '')

const macPayloadForLocal = event => ({
  title: event.title,
  start_date: event.startDate,
  end_date: event.endDate,
  start_time: event.allDay ? null : (event.startTime || null),
  end_time: event.allDay ? null : (event.endTime || null),
  all_day: event.allDay ? 1 : 0,
  location: event.location || '',
  notes: macNotes(event)
})

const localDelete = item => ({
  key: item.key,
  eventId: item.eventId ?? item.id,
  occurrenceDate: item.occurrenceDate || item.startDate,
  isRecurring: Boolean(item.recurrence_type && item.recurrence_type !== 'none')
})

const localUpdate = (item, event) => ({
  ...localDelete(item),
  occurrenceKey: item.occurrenceKey,
  payload: macPayloadForLocal(event)
})

const contentOfLocal = item => JSON.stringify([
  item.title, item.startDate, item.endDate, item.startTime || null, item.endTime || null,
  Boolean(item.allDay), item.location || '', item.notes || ''
])

const contentOfMac = event => JSON.stringify([
  event.title, event.startDate, event.endDate, event.allDay ? null : (event.startTime || null),
  event.allDay ? null : (event.endTime || null), Boolean(event.allDay), event.location || '', macNotes(event)
])

/**
 * Compare local expanded occurrences with macOS Calendar events and produce
 * the minimal set of changes for a latest-wins two-way sync.
 *
 * Timestamps must already be milliseconds: localItems[].updatedAtMs from
 * event/override updated_at, macEvents[].stampMs from the macOS stamp date.
 */
export function planMacSync({ localItems = [], macEvents = [], records = [], startDate = '', endDate = '' }) {
  const localMap = new Map()
  for (const item of localItems) {
    const key = localSyncKey(item)
    localMap.set(key, { ...item, key })
  }
  const macByUid = new Map()
  const macByMarker = new Map()
  for (const event of macEvents) {
    if (!event?.uid) continue
    macByUid.set(event.uid, event)
    const marker = macMarkerKey(event)
    if (marker) macByMarker.set(marker, event)
  }
  const recordByKey = new Map(records.map(record => [record.local_key, record]))
  const recordByUid = new Map(records.map(record => [record.mac_uid, record]))

  const macCreates = []
  const macUpdates = []
  const macDeletes = []
  const localCreates = []
  const localUpdates = []
  const localDeletes = []
  const recordsToDelete = new Set()
  const handledUids = new Set()

  for (const local of localMap.values()) {
    const key = local.key
    const record = recordByKey.get(key)
    let mac = record?.mac_uid ? macByUid.get(record.mac_uid) : null
    if (!mac) mac = macByMarker.get(key)
    if (mac) handledUids.add(mac.uid)

    if (!mac) {
      if (record) {
        const localChanged = (local.updatedAtMs || 0) > Number(record.last_local_updated || 0)
        if (localChanged) {
          macCreates.push({ key, payload: { ...localPayload(local), marker: markerFor(key) } })
        } else {
          localDeletes.push(localDelete(local))
        }
        recordsToDelete.add(key)
      } else {
        macCreates.push({ key, payload: { ...localPayload(local), marker: markerFor(key) } })
      }
      continue
    }

    const localMs = local.updatedAtMs || 0
    const macMs = mac.stampMs || 0
    const desiredCalendar = local.macCalendar || '日程'
    if (mac.calendarName && desiredCalendar && mac.calendarName !== desiredCalendar) {
      const useMac = macMs > localMs
      macDeletes.push({ uid: mac.uid, key, calendarName: mac.calendarName })
      macCreates.push({
        key,
        payload: useMac
          ? {
              title: mac.title,
              startDate: mac.startDate,
              endDate: mac.endDate,
              startTime: mac.allDay ? null : (mac.startTime || null),
              endTime: mac.allDay ? null : (mac.endTime || null),
              allDay: Boolean(mac.allDay),
              location: mac.location || '',
              notes: macNotes(mac),
              calendarName: desiredCalendar,
              marker: markerFor(key)
            }
          : { ...localPayload(local), calendarName: desiredCalendar, marker: markerFor(key) }
      })
      if (useMac) localUpdates.push(localUpdate(local, mac))
      continue
    }
    if (!record) {
      if (localMs === macMs) {
        if (contentOfLocal(local) !== contentOfMac(mac)) {
          // Same timestamp but different content: keep the macOS copy, it is
          // the side that was explicitly edited in Calendar.
          localUpdates.push(localUpdate(local, mac))
        }
      } else if (localMs > macMs) {
        macUpdates.push({ uid: mac.uid, key, payload: { ...localPayload(local), marker: markerFor(key) } })
      } else {
        localUpdates.push(localUpdate(local, mac))
      }
      continue
    }

    const localChanged = localMs !== Number(record.last_local_updated || 0)
    const macChanged = macMs !== Number(record.last_mac_updated || 0)
    if (localChanged && macChanged) {
      if (localMs >= macMs) macUpdates.push({ uid: mac.uid, key, payload: { ...localPayload(local), marker: markerFor(key) } })
      else localUpdates.push(localUpdate(local, mac))
    } else if (localChanged) {
      macUpdates.push({ uid: mac.uid, key, payload: { ...localPayload(local), marker: markerFor(key) } })
    } else if (macChanged) {
      localUpdates.push(localUpdate(local, mac))
    }
  }

  for (const mac of macByUid.values()) {
    if (handledUids.has(mac.uid)) continue
    const marker = macMarkerKey(mac)
    const record = recordByUid.get(mac.uid)
    if (marker) {
      if (localMap.has(marker)) continue
      macDeletes.push({ uid: mac.uid, key: marker, calendarName: mac.calendarName })
      recordsToDelete.add(marker)
      continue
    }
    if (record) {
      if (localMap.has(record.local_key)) continue
      macDeletes.push({ uid: mac.uid, key: record.local_key, calendarName: mac.calendarName })
      recordsToDelete.add(record.local_key)
      continue
    }
    localCreates.push({
      macUid: mac.uid,
      payload: {
        title: mac.title,
        calendar_id: mac.localCalendarId,
        start_date: mac.startDate,
        end_date: mac.endDate,
        start_time: mac.allDay ? null : (mac.startTime || null),
        end_time: mac.allDay ? null : (mac.endTime || null),
        all_day: mac.allDay ? 1 : 0,
        location: mac.location || '',
        notes: macNotes(mac)
      }
    })
  }

  for (const record of records) {
    if (recordsToDelete.has(record.local_key)) continue
    if (localMap.has(record.local_key) || macByUid.has(record.mac_uid)) continue
    const date = String(record.local_key).split(':')[1] || ''
    if (date && startDate && endDate && date >= startDate && date <= endDate) recordsToDelete.add(record.local_key)
  }

  return {
    macCreates,
    macUpdates,
    macDeletes,
    localCreates,
    localUpdates,
    localDeletes,
    recordsToDelete: [...recordsToDelete],
    summary: {
      macCreated: macCreates.length,
      macUpdated: macUpdates.length,
      macDeleted: macDeletes.length,
      localCreated: localCreates.length,
      localUpdated: localUpdates.length,
      localDeleted: localDeletes.length
    }
  }
}
