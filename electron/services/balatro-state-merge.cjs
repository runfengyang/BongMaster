// Balatro 三方存档合并器：base 是渲染端上次读到的状态，incoming 是本次修改结果。
// 将 incoming-base 的变化应用到最新 disk，可同时保留后台 MCP 奖励和前台消费。

const num = (v) => {
  const n = Math.floor(Number(v))
  return Number.isFinite(n) && n > 0 ? n : 0
}
const arr = (v) => (Array.isArray(v) ? v : [])
const unionIds = (a, b) => [...new Set([...arr(a), ...arr(b)])]

function applyNumberDelta(disk, incoming, base) {
  return Math.max(0, num(disk) + num(incoming) - num(base))
}

function applyArrayDelta(disk, incoming, base, keyOf = JSON.stringify) {
  const counts = (items) => {
    const out = new Map()
    for (const item of arr(items)) {
      const key = keyOf(item)
      out.set(key, (out.get(key) || 0) + 1)
    }
    return out
  }
  const baseCounts = counts(base)
  const incomingCounts = counts(incoming)
  const removals = new Map()
  const additions = new Map()
  for (const [key, count] of baseCounts) {
    const n = count - (incomingCounts.get(key) || 0)
    if (n > 0) removals.set(key, n)
  }
  for (const [key, count] of incomingCounts) {
    const n = count - (baseCounts.get(key) || 0)
    if (n > 0) additions.set(key, n)
  }
  const out = arr(disk).filter(item => {
    const key = keyOf(item)
    const n = removals.get(key) || 0
    if (!n) return true
    removals.set(key, n - 1)
    return false
  })
  for (const item of arr(incoming)) {
    const key = keyOf(item)
    const n = additions.get(key) || 0
    if (!n) continue
    out.push(item)
    additions.set(key, n - 1)
  }
  return out
}

// disk / incoming / base 均为已解析对象（可为 null）。无 base 时兼容旧客户端。
function mergeBalatroState(disk, incoming, base = null) {
  if (!disk || typeof disk !== 'object') return incoming
  if (!incoming || typeof incoming !== 'object') return disk
  const out = { ...disk, ...incoming }
  const hasBase = base && typeof base === 'object'

  // gold 可增可减；packsOpened 只增。三方合并时都按本次变化量应用到最新磁盘。
  if (disk.economy || incoming.economy) {
    out.economy = {
      ...(disk.economy || {}), ...(incoming.economy || {}),
      gold: hasBase
        ? applyNumberDelta(disk.economy?.gold, incoming.economy?.gold, base.economy?.gold)
        : (incoming.economy?.gold === undefined ? num(disk.economy?.gold) : num(incoming.economy.gold)),
      packsOpened: hasBase
        ? applyNumberDelta(disk.economy?.packsOpened, incoming.economy?.packsOpened, base.economy?.packsOpened)
        : Math.max(num(disk.economy?.packsOpened), num(incoming.economy?.packsOpened)),
    }
  }

  // pendingPacks 可开掉也可新增，不能按数组长度合并。
  if (disk.productivity || incoming.productivity) {
    out.productivity = {
      ...(disk.productivity || {}), ...(incoming.productivity || {}),
      count: hasBase
        ? applyNumberDelta(disk.productivity?.count, incoming.productivity?.count, base.productivity?.count)
        : Math.max(num(disk.productivity?.count), num(incoming.productivity?.count)),
      pendingPacks: hasBase
        ? applyArrayDelta(disk.productivity?.pendingPacks, incoming.productivity?.pendingPacks, base.productivity?.pendingPacks, String)
        : (Array.isArray(incoming.productivity?.pendingPacks)
            ? incoming.productivity.pendingPacks
            : arr(disk.productivity?.pendingPacks)),
    }
  }

  // discovered 永不回退；ownedCards/newIds 都允许删除。
  if (disk.collection || incoming.collection) {
    out.collection = {
      ...(disk.collection || {}), ...(incoming.collection || {}),
      discovered: unionIds(incoming.collection?.discovered, disk.collection?.discovered),
      newIds: hasBase
        ? applyArrayDelta(disk.collection?.newIds, incoming.collection?.newIds, base.collection?.newIds, String)
        : (Array.isArray(incoming.collection?.newIds) ? incoming.collection.newIds : arr(disk.collection?.newIds)),
      ownedCards: hasBase
        ? applyArrayDelta(disk.collection?.ownedCards, incoming.collection?.ownedCards, base.collection?.ownedCards)
        : (Array.isArray(incoming.collection?.ownedCards)
            ? incoming.collection.ownedCards
            : arr(disk.collection?.ownedCards)),
    }
  }

  return out
}

module.exports = { mergeBalatroState }
