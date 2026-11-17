const MAX_PAGE_BYTES = 2 * 1024 * 1024
const MAX_ICON_BYTES = 128 * 1024
const TIMEOUT_MS = 8000
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

const isHttpUrl = value => {
  try {
    const url = new URL(String(value || ''))
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

const imageMime = (contentType, sourceUrl) => {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase()
  if (type.startsWith('image/')) {
    return type === 'image/vnd.microsoft.icon' ? 'image/x-icon' : type
  }
  if (type.startsWith('text/') || type.includes('json') || type.includes('xml')) return null
  const extension = new URL(sourceUrl).pathname.split('.').pop()?.toLowerCase()
  const fallback = {
    ico: 'image/x-icon',
    png: 'image/png',
    svg: 'image/svg+xml',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp'
  }
  return fallback[extension] || null
}

const readBuffer = async (url, limit) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT, accept: '*/*' }
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const declared = Number(response.headers.get('content-length') || 0)
    if (declared > limit) throw new Error('内容过大')
    if (!response.body) throw new Error('没有响应内容')
    const reader = response.body.getReader()
    const chunks = []
    let total = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > limit) {
        await reader.cancel()
        throw new Error('内容过大')
      }
      chunks.push(Buffer.from(value))
    }
    return {
      buffer: Buffer.concat(chunks),
      contentType: response.headers.get('content-type') || '',
      finalUrl: response.url || url
    }
  } finally {
    clearTimeout(timer)
  }
}

const iconCandidates = (html, pageUrl) => {
  const found = []
  for (const match of String(html || '').matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0]
    const rel = (/\brel\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] || '').toLowerCase()
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]
    if (!rel.includes('icon') || !href) continue
    let score = 1
    if (/(^|\s)shortcut(\s|$)/.test(rel) || /(^|\s)icon(\s|$)/.test(rel)) score = 4
    else if (rel.includes('apple-touch-icon')) score = 3
    const sizes = /\bsizes\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] || ''
    const sizeScore = Math.max(0, ...sizes.split(/\s+/).map(item => Number(item.split('x')[0]) || 0).filter(Boolean))
    found.push({ href, score, sizeScore })
  }
  found.sort((a, b) => b.score - a.score || b.sizeScore - a.sizeScore)
  const candidates = []
  for (const item of found) {
    try {
      const url = new URL(item.href, pageUrl)
      if (url.protocol === 'http:' || url.protocol === 'https:') candidates.push(url.href)
    } catch {}
  }
  return candidates
}

async function fetchSiteFavicon(pageUrl) {
  if (!isHttpUrl(pageUrl)) return { success: false, error: '请输入有效的 http/https 地址' }
  let candidates = []
  let resolvedPageUrl = pageUrl
  try {
    const page = await readBuffer(pageUrl, MAX_PAGE_BYTES)
    resolvedPageUrl = page.finalUrl || pageUrl
    candidates = iconCandidates(page.buffer.toString('utf8'), resolvedPageUrl)
  } catch {}
  candidates.push(new URL('/favicon.ico', resolvedPageUrl).href)
  const seen = new Set()
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue
    seen.add(candidate)
    try {
      const icon = await readBuffer(candidate, MAX_ICON_BYTES)
      if (!icon.buffer.length) continue
      const mime = imageMime(icon.contentType, candidate)
      if (!mime) continue
      return {
        success: true,
        iconUrl: `data:${mime};base64,${icon.buffer.toString('base64')}`,
        source: candidate
      }
    } catch {}
  }
  return { success: false, error: '未能读取网站图标' }
}

module.exports = { fetchSiteFavicon, isHttpUrl }
