import { addDays, format, getISODay, parseISO, isValid } from 'date-fns'
import { normalizeTags } from './reminders.js'

const RELATIVE_DAYS = {
  今天: 0,
  明天: 1,
  后天: 2,
  大后天: 3
}

const WEEKDAY_MAP = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7
}

const PRIORITY_TOKENS = {
  '!!!': '高',
  '!!': '中',
  '!': '低',
  p1: '高',
  P1: '高',
  高: '高',
  p2: '中',
  P2: '中',
  中: '中',
  p3: '低',
  P3: '低',
  低: '低'
}

const PERIOD_HOURS = {
  上午: null,
  早上: null,
  中午: 12,
  下午: 12,
  傍晚: 12,
  晚上: 12,
  今晚: 12
}

function nextWeekday(target, now, forceNextWeek = false) {
  const current = getISODay(now)
  let delta = target - current
  if (delta <= 0) delta += 7
  if (forceNextWeek) delta += 7
  return format(addDays(now, delta), 'yyyy-MM-dd')
}

function parseTime(text) {
  const withColon = text.match(/(上午|早上|中午|下午|傍晚|晚上|今晚)?\s*(\d{1,2})[:：](\d{1,2})/)
  if (withColon) {
    return buildTime(withColon[1], Number(withColon[2]), Number(withColon[3]))
  }

  const withPoint = text.match(/(上午|早上|中午|下午|傍晚|晚上|今晚)?\s*(\d{1,2})\s*点\s*(半|\d{1,2}\s*分?)?/)
  if (withPoint) {
    let minute = 0
    if (withPoint[3] === '半') minute = 30
    else if (withPoint[3]) minute = parseInt(withPoint[3], 10) || 0
    return buildTime(withPoint[1], Number(withPoint[2]), minute)
  }

  return null
}

function buildTime(period, hour, minute) {
  let h = Number(hour)
  let m = Number(minute)
  if (!Number.isFinite(h) || h < 0 || h > 23) return null
  if (!Number.isFinite(m) || m < 0 || m > 59) m = 0
  if (period && PERIOD_HOURS[period] !== null && PERIOD_HOURS[period] !== undefined) {
    if (period === '中午') {
      if (h < 11) h = 12
    } else if (h < 12) {
      h += 12
    }
  }
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function parseReminderInput(input, options = {}) {
  const now = options.now instanceof Date && isValid(options.now) ? options.now : new Date()
  const today = format(now, 'yyyy-MM-dd')
  const defaultDate = options.defaultDate || ''
  const result = {
    title: '',
    date: defaultDate,
    due_time: null,
    priority: '无',
    tags: '',
    notes: '',
    is_flagged: false,
    list_id: options.listId || null,
    meta: { parsedTokens: [], warnings: [] }
  }

  const raw = String(input ?? '').trim()
  if (!raw) return result

  let working = raw
  const remove = token => {
    if (!token) return
    working = working.replace(token, ' ')
    result.meta.parsedTokens.push(token.trim())
  }

  // 标签
  const tags = []
  working = working.replace(/#([^\s#]+)/g, (match, tag) => {
    const cleaned = String(tag).replace(/[，,。.；;：:]+$/, '')
    if (cleaned && !tags.includes(cleaned)) tags.push(cleaned)
    result.meta.parsedTokens.push(match)
    return ' '
  })

  // 优先级：!!! / !! / ! / p1 / 高
  working = working.replace(/(^|\s)(!!!|!!|!)(?=\s|$)/g, (match, lead, token) => {
    result.priority = PRIORITY_TOKENS[token] || result.priority
    result.meta.parsedTokens.push(token)
    return lead
  })
  working = working.replace(/(^|\s)(p[123]|P[123]|高|中|低)(?=\s|$)/g, (match, lead, token) => {
    result.priority = PRIORITY_TOKENS[token] || result.priority
    result.meta.parsedTokens.push(token)
    return lead
  })

  // 日期：显式日期
  let dateMatched = false
  const explicit = working.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/)
  if (explicit) {
    const candidate = `${explicit[1]}-${String(explicit[2]).padStart(2, '0')}-${String(explicit[3]).padStart(2, '0')}`
    if (isValid(parseISO(candidate))) {
      result.date = candidate
      dateMatched = true
      remove(explicit[0])
    }
  }

  if (!dateMatched) {
    const monthDay = working.match(/(\d{1,2})月(\d{1,2})日?/)
    if (monthDay) {
      const month = Number(monthDay[1])
      const day = Number(monthDay[2])
      const candidate = `${now.getFullYear()}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      if (isValid(parseISO(candidate))) {
        result.date = candidate
        dateMatched = true
        remove(monthDay[0])
      }
    }
  }

  if (!dateMatched) {
    const shortDate = working.match(/\b(\d{1,2})-(\d{1,2})\b/)
    if (shortDate) {
      const month = Number(shortDate[1])
      const day = Number(shortDate[2])
      const candidate = `${now.getFullYear()}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      if (isValid(parseISO(candidate))) {
        result.date = candidate
        dateMatched = true
        remove(shortDate[0])
      }
    }
  }

  if (!dateMatched) {
    const relative = working.match(/今天|明天|后天|大后天/)
    if (relative) {
      result.date = format(addDays(now, RELATIVE_DAYS[relative[0]]), 'yyyy-MM-dd')
      dateMatched = true
      remove(relative[0])
    }
  }

  if (!dateMatched) {
    const weekday = working.match(/(下周|这周|本周)?\s*(?:周|星期|礼拜)([一二三四五六日天])/)
    if (weekday) {
      result.date = nextWeekday(WEEKDAY_MAP[weekday[2]], now, weekday[1] === '下周')
      dateMatched = true
      remove(weekday[0])
    }
  }

  // 时间
  const time = parseTime(working)
  if (time) {
    result.due_time = time
    const timeMatch = working.match(/(上午|早上|中午|下午|傍晚|晚上|今晚)?\s*\d{1,2}\s*(?:[:：]\s*\d{1,2}|点\s*(?:半|\d{1,2}\s*分?)?)/)
    if (timeMatch) remove(timeMatch[0])
  } else if (/今晚/.test(working)) {
    result.due_time = '20:00'
    remove('今晚')
    if (!dateMatched) {
      result.date = today
      dateMatched = true
    }
  }

  if (result.due_time && !result.date) {
    result.date = defaultDate || today
  }

  result.tags = normalizeTags(tags.join(',')).join(',')
  result.title = working.replace(/\s+/g, ' ').trim()
  if (!result.title) result.meta.warnings.push('标题为空')
  return result
}
