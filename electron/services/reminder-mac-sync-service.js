const PRIORITY_TO_MAC = { 高: 1, 中: 5, 低: 9, 无: 0 }

const priorityFromMac = value => {
  const rank = Number(value) || 0
  if (rank >= 1 && rank <= 4) return '高'
  if (rank === 5) return '中'
  if (rank >= 6 && rank <= 9) return '低'
  return '无'
}

const priorityToMac = value => PRIORITY_TO_MAC[value] ?? 0

// SQLite CURRENT_TIMESTAMP 是 UTC 且不带时区；ISO 字符串带 Z。
const parseLocalMs = value => {
  if (value === undefined || value === null || value === '') return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const text = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
    const ms = Date.parse(`${text.replace(' ', 'T')}Z`)
    return Number.isFinite(ms) ? ms : 0
  }
  const ms = Date.parse(text)
  return Number.isFinite(ms) ? ms : 0
}

const normalizeText = value => String(value ?? '').replace(/\r\n/g, '\n')

const localSnapshot = (item, listName) => ({
  title: String(item.title || ''),
  notes: normalizeText(item.notes),
  date: item.date || '',
  due_time: item.due_time || null,
  is_completed: Boolean(item.is_completed),
  is_flagged: Boolean(item.is_flagged),
  priority: item.priority || '无',
  is_all_day: Boolean(item.date) && !item.due_time,
  list_name: listName
})

const macSnapshot = (reminder, listName) => ({
  title: String(reminder.name || ''),
  notes: normalizeText(reminder.body),
  date: reminder.dueDate || '',
  due_time: reminder.dueKind === 1 ? (reminder.dueTime || null) : null,
  is_completed: Boolean(reminder.completed),
  is_flagged: Boolean(reminder.flagged),
  priority: priorityFromMac(reminder.priority),
  is_all_day: reminder.dueKind === 2,
  list_name: listName
})

const macLocalPayload = reminder => ({
  title: String(reminder.name || '').trim() || '未命名提醒',
  notes: normalizeText(reminder.body),
  date: reminder.dueDate || '',
  due_time: reminder.dueKind === 1 ? (reminder.dueTime || null) : null,
  is_completed: Boolean(reminder.completed),
  completed_at: reminder.completed ? (reminder.completionDate || null) : null,
  is_flagged: Boolean(reminder.flagged),
  priority: priorityFromMac(reminder.priority)
})

const macPayload = (item, listName) => ({
  ...localSnapshot(item, listName),
  priorityNumber: priorityToMac(item.priority)
})

/**
 * 对齐本地列表和 macOS 列表：同名映射，不加前缀。
 * 本地列表是命名主源：本地改名会同步改名 macOS 列表；macOS 侧不额外导入列表。
 * mappings 里 local_list_id 已不存在的行视为墓碑，保留以防已删除的本地列表被同名列表重新导入。
 */
function planReminderListSync({ localLists = [], macLists = [], mappings = [] } = {}) {
  const macById = new Map(macLists.map(list => [String(list.id), list]))
  const mappingByLocal = new Map(mappings.map(row => [Number(row.local_list_id), row]))
  const usedMacIds = new Set()
  const bindings = []
  const macListCreates = []
  const macListRenames = []
  const resetLocalListIds = []

  for (const list of localLists) {
    const localId = Number(list.id)
    const mapping = mappingByLocal.get(localId)
    const mappedMac = mapping ? macById.get(String(mapping.mac_list_id)) : null

    if (mapping && !mappedMac) {
      resetLocalListIds.push(localId)
    }

    if (mappedMac) {
      usedMacIds.add(String(mappedMac.id))
      if (mappedMac.name !== list.name) {
        macListRenames.push({ macListId: mappedMac.id, name: list.name })
      }
      bindings.push({
        localListId: localId,
        macListId: String(mappedMac.id),
        localName: list.name,
        macName: list.name
      })
      continue
    }

    const candidate = macLists.find(item => (
      item.name === list.name && !usedMacIds.has(String(item.id))
    ))
    if (candidate) {
      usedMacIds.add(String(candidate.id))
      bindings.push({
        localListId: localId,
        macListId: String(candidate.id),
        localName: list.name,
        macName: list.name
      })
      continue
    }

    macListCreates.push({
      localListId: localId,
      localName: list.name,
      name: list.name
    })
  }

  return { bindings, macListCreates, macListRenames, resetLocalListIds }
}

/**
 * 本地提醒与 macOS 提醒逐条比对，产出最小写入集合。
 * 时间戳谁新谁赢，相同则本地优先；无映射记录的两条视为互不相关。
 */
function planReminderItemSync({
  localItems = [],
  deletedLocalIds = [],
  macReminders = [],
  records = [],
  completedMacIds = [],
  listIdByMacListId = {},
  fallbackListName = ''
} = {}) {
  const localById = new Map(localItems.map(item => [Number(item.id), item]))
  const deletedIds = new Set((Array.isArray(deletedLocalIds) ? deletedLocalIds : []).map(Number))
  const macById = new Map(macReminders.map(item => [String(item.id), item]))
  const recordByLocal = new Map(records.map(row => [Number(row.local_id), row]))
  const recordByMac = new Map(records.map(row => [String(row.mac_id), row]))
  const completedMacIdSet = new Set((Array.isArray(completedMacIds) ? completedMacIds : []).map(String))
  const handledMacIds = new Set()

  const macCreates = []
  const macUpdates = []
  const macDeletes = []
  const localCreates = []
  const localUpdates = []
  const localDeletes = []
  const localCompletes = []
  const pairs = []

  const listNameFor = item => item.list_name || fallbackListName || '提醒事项'
  const pushPair = (localId, macId) => pairs.push({ localId: Number(localId), macId: String(macId) })
  const createOnMac = item => macCreates.push({
    localId: Number(item.id),
    listName: listNameFor(item),
    payload: macPayload(item, listNameFor(item))
  })

  for (const item of localItems) {
    const localId = Number(item.id)
    if (!localId || deletedIds.has(localId)) continue
    const record = recordByLocal.get(localId)
    const mac = record ? macById.get(String(record.mac_id)) : null
    if (mac) handledMacIds.add(String(mac.id))

    if (!mac) {
      if (!record) {
        if (!item.is_completed) createOnMac(item)
        continue
      }
      if (completedMacIdSet.has(String(record.mac_id))) {
        if (!item.is_completed) localCompletes.push({ localId })
        continue
      }
      if (item.is_completed) continue
      const localChanged = (item.updatedMs ?? parseLocalMs(item.updated_at)) !== Number(record.last_local_updated || 0)
      if (localChanged) createOnMac(item)
      else localDeletes.push({ localId })
      continue
    }

    if (!record) {
      if (!item.is_completed) createOnMac(item)
      continue
    }

    const localMs = item.updatedMs ?? parseLocalMs(item.updated_at)
    const macMs = Number(mac.modifiedMs) || 0
    const localChanged = localMs !== Number(record.last_local_updated || 0)
    const macChanged = macMs !== Number(record.last_mac_updated || 0)
    const mappedLocalListId = listIdByMacListId[String(mac.listId)]
    const listConflict = mappedLocalListId && Number(mappedLocalListId) !== Number(item.list_id)

    if (listConflict) {
      if (macMs > localMs) {
        localUpdates.push({ localId, payload: { ...macLocalPayload(mac), list_id: Number(mappedLocalListId) } })
        pushPair(localId, mac.id)
      } else if (localMs > macMs) {
        macDeletes.push({ macId: mac.id, listName: mac.listName })
        createOnMac(item)
      } else {
        pushPair(localId, mac.id)
      }
      continue
    }

    if (localChanged && macChanged) {
      if (localMs >= macMs) macUpdates.push({ macId: mac.id, listName: listNameFor(item), payload: macPayload(item, listNameFor(item)) })
      else localUpdates.push({ localId, payload: macLocalPayload(mac) })
      pushPair(localId, mac.id)
      continue
    }

    if (localChanged) {
      macUpdates.push({ macId: mac.id, listName: listNameFor(item), payload: macPayload(item, listNameFor(item)) })
      pushPair(localId, mac.id)
      continue
    }

    if (macChanged) {
      localUpdates.push({ localId, payload: macLocalPayload(mac) })
      pushPair(localId, mac.id)
      continue
    }

    const localContent = JSON.stringify(localSnapshot(item, listNameFor(item)))
    const macContent = JSON.stringify(macSnapshot(mac, listNameFor(item)))
    if (localContent !== macContent) {
      // 同一秒内的编辑时间戳无法区分，以本地内容为准，避免丢改动。
      macUpdates.push({ macId: mac.id, listName: listNameFor(item), payload: macPayload(item, listNameFor(item)) })
    }
    pushPair(localId, mac.id)
  }

  for (const mac of macReminders) {
    const macId = String(mac.id)
    if (handledMacIds.has(macId)) continue
    const record = recordByMac.get(macId)
    if (record) {
      // 本地已被删除或已不存在：macOS 侧一并在删除之列。
      macDeletes.push({ macId, listName: mac.listName })
      continue
    }
    // 不导入 macOS 的历史已完成项，避免首次同步灌入大量旧记录。
    if (mac.completed) continue
    const localListId = listIdByMacListId[String(mac.listId)]
    if (!localListId) continue
    localCreates.push({
      macId,
      payload: { ...macLocalPayload(mac), list_id: Number(localListId) }
    })
  }

  return {
    macCreates,
    macUpdates,
    macDeletes,
    localCreates,
    localUpdates,
    localDeletes,
    localCompletes,
    pairs
  }
}

let runningSync = null

async function doSync(dbService, macService) {
  const initialMappings = dbService.getReminderMacListMappings()
  const initialLocalLists = dbService.getReminderLists()
  let records = dbService.getReminderMacSyncRecords()
  const initialMac = await macService.pull({
    mappedListIds: initialMappings.map(row => row.mac_list_id).filter(Boolean),
    listNames: initialLocalLists.map(list => list.name),
    mappedIds: records.map(row => row.mac_id).filter(Boolean)
  })

  const listPlan = planReminderListSync({
    localLists: initialLocalLists,
    macLists: initialMac.lists,
    mappings: initialMappings
  })

  const bindings = [...listPlan.bindings]
  if (listPlan.resetLocalListIds.length) {
    const resetIds = new Set(listPlan.resetLocalListIds.map(Number))
    const staleRecordIds = records
      .filter(row => resetIds.has(Number(row.list_id)))
      .map(row => Number(row.local_id))
    if (staleRecordIds.length) dbService.deleteReminderMacSyncRecords(staleRecordIds)
    records = dbService.getReminderMacSyncRecords()
  }

  if (listPlan.macListCreates.length || listPlan.macListRenames.length) {
    const result = await macService.applyLists({
      creates: listPlan.macListCreates.map(item => ({ name: item.name })),
      renames: listPlan.macListRenames
    })
    listPlan.macListCreates.forEach((item, index) => {
      const macId = (result.createdIds || [])[index]
      if (!macId) return
      bindings.push({
        localListId: item.localListId,
        macListId: String(macId),
        localName: item.localName,
        macName: item.name
      })
    })
  }

  if (bindings.length) {
    dbService.saveReminderMacListMappings(bindings.map(binding => ({
      local_list_id: binding.localListId,
      mac_list_id: binding.macListId,
      local_name: binding.localName,
      mac_name: binding.macName
    })))
  }

  const localLists = dbService.getReminderLists()
  const listIdByMacListId = {}
  for (const binding of bindings) {
    if (binding.macListId) listIdByMacListId[String(binding.macListId)] = Number(binding.localListId)
  }
  const fallbackListName = localLists[0]?.name || '提醒事项'

  const rows = dbService.getRemindersForMacSync()
  const activeItems = rows.filter(row => !row.deleted_at)
  const deletedLocalIds = rows.filter(row => row.deleted_at).map(row => Number(row.id))

  const plan = planReminderItemSync({
    localItems: activeItems,
    deletedLocalIds,
    macReminders: initialMac.reminders,
    records,
    completedMacIds: initialMac.completedIds,
    listIdByMacListId,
    fallbackListName
  })

  const macResult = (plan.macCreates.length || plan.macUpdates.length || plan.macDeletes.length)
    ? await macService.applyChanges({
      creates: plan.macCreates.map(item => ({
        listName: item.listName,
        payload: item.payload
      })),
      updates: plan.macUpdates.map(item => ({ macId: item.macId, payload: item.payload })),
      deletes: plan.macDeletes.map(item => ({ macId: item.macId }))
    })
    : { createdIds: [] }

  for (const item of plan.localUpdates) {
    try {
      dbService.updateReminder(item.localId, item.payload)
    } catch (error) {
      console.warn('[ReminderMacSync] update local failed:', error.message)
    }
  }
  for (const item of plan.localDeletes) {
    try {
      dbService.deleteReminder(item.localId)
    } catch (error) {
      console.warn('[ReminderMacSync] delete local failed:', error.message)
    }
  }
  for (const item of plan.localCompletes) {
    try {
      dbService.toggleReminderComplete(item.localId, true)
    } catch (error) {
      console.warn('[ReminderMacSync] complete local failed:', error.message)
    }
  }
  const createdLocals = []
  for (const item of plan.localCreates) {
    try {
      createdLocals.push(dbService.createReminder(item.payload))
    } catch (error) {
      console.warn('[ReminderMacSync] create local failed:', error.message)
      createdLocals.push(null)
    }
  }

  const pairs = [...plan.pairs]
  const createdMacIds = macResult.createdIds || []
  plan.macCreates.forEach((item, index) => {
    const macId = createdMacIds[index]
    if (macId) pairs.push({ localId: Number(item.localId), macId: String(macId) })
  })
  plan.localCreates.forEach((item, index) => {
    const created = createdLocals[index]
    if (created?.id) pairs.push({ localId: Number(created.id), macId: String(item.macId) })
  })

  const finalMac = await macService.pull({
    mappedListIds: Object.keys(listIdByMacListId),
    listNames: localLists.map(list => list.name)
  })
  const finalMacById = new Map(finalMac.reminders.map(item => [String(item.id), item]))
  const recordsToSave = []
  for (const pair of pairs) {
    const local = dbService.getReminderById(pair.localId)
    const mac = finalMacById.get(String(pair.macId))
    if (!local || local.deleted_at || !mac) continue
    if (local.is_completed) continue
    recordsToSave.push({
      local_id: Number(local.id),
      mac_id: String(mac.id),
      list_id: local.list_id ? Number(local.list_id) : null,
      mac_list_name: mac.listName || '',
      last_local_updated: String(parseLocalMs(local.updated_at)),
      last_mac_updated: String(Number(mac.modifiedMs) || 0)
    })
  }
  if (recordsToSave.length) dbService.saveReminderMacSyncRecords(recordsToSave)

  const keep = new Set(recordsToSave.map(item => item.local_id))
  const stale = dbService.getReminderMacSyncRecords()
    .filter(item => !keep.has(Number(item.local_id)))
    .map(item => Number(item.local_id))
  if (stale.length) dbService.deleteReminderMacSyncRecords(stale)

  return {
    listsCreated: listPlan.macListCreates.length,
    listsRenamed: listPlan.macListRenames.length,
    macCreated: plan.macCreates.length,
    macUpdated: plan.macUpdates.length,
    macDeleted: plan.macDeletes.length,
    localCreated: plan.localCreates.length,
    localUpdated: plan.localUpdates.length,
    localDeleted: plan.localDeletes.length,
    localCompleted: plan.localCompletes.length
  }
}

function syncReminders(dbService, macService) {
  if (!runningSync) {
    runningSync = doSync(dbService, macService).finally(() => {
      runningSync = null
    })
  }
  return runningSync
}

module.exports = {
  parseLocalMs,
  planReminderListSync,
  planReminderItemSync,
  syncReminders
}
