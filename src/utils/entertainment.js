export const formatDuration = seconds => {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0))
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m`
  return `${safeSeconds}s`
}

// 只保留最近使用的 max 个 webview；当前站点一定保留。
export const pickWebviewsToKeep = ({ mounted = [], recent = [], current = '', max = 3 } = {}) => {
  const mountedSet = new Set(mounted)
  const order = [current, ...recent.filter(id => id !== current)]
  const keep = new Set()
  for (const id of order) {
    if (keep.size >= max) break
    if (mountedSet.has(id)) keep.add(id)
  }
  return mounted.filter(id => keep.has(id))
}

// 页面在前台、窗口有焦点、且不是长时间无操作（正在播放声音时除外）才计时。
export const shouldCountUsage = ({
  pageActive = false,
  hidden = false,
  focused = false,
  idleSeconds = 0,
  audible = false,
  idleAwaySeconds = 300
} = {}) => {
  if (!pageActive || hidden || !focused) return false
  if (idleSeconds >= idleAwaySeconds && !audible) return false
  return true
}

export const usageBarPercent = (seconds = 0, limitMinutes = 0) => {
  const limit = Number(limitMinutes) || 0
  if (limit <= 0) return 0
  const used = Math.max(0, Number(seconds) || 0)
  return Math.min(100, Math.round((used / (limit * 60)) * 100))
}
