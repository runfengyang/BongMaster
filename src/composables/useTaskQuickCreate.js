import { format, addDays } from 'date-fns'

const PRIORITY_TOKENS = {
  '!高': '高',
  '!中': '中',
  '!低': '低'
}

const RELATIVE_DATE_TOKENS = {
  '@今天': 0,
  '@明天': 1,
  '@后天': 2
}

export function useTaskQuickCreate() {
  function resolveProject(tokenValue, projects) {
    const name = tokenValue.replace(/^#/, '')
    if (!name) return null
    const match = projects.find(p => p.name === name)
    return match ? match.id : null
  }

  function resolveDate(token) {
    if (RELATIVE_DATE_TOKENS.hasOwnProperty(token)) {
      return format(addDays(new Date(), RELATIVE_DATE_TOKENS[token]), 'yyyy-MM-dd')
    }
    const dateMatch = token.match(/^@(\d{4}-\d{2}-\d{2})$/)
    if (dateMatch) return dateMatch[1]
    return null
  }

  function parseQuickCreate(input, options = {}) {
    const { projects = [], status = '待办' } = options
    const tokens = input.trim().split(/\s+/)

    let priority = '中'
    let due_date = ''
    let project_id = ''
    const nameParts = []

    for (const token of tokens) {
      if (PRIORITY_TOKENS.hasOwnProperty(token)) {
        priority = PRIORITY_TOKENS[token]
        continue
      }
      if (token.startsWith('@')) {
        const resolved = resolveDate(token)
        if (resolved) {
          due_date = resolved
          continue
        }
      }
      if (token.startsWith('#')) {
        const resolved = resolveProject(token, projects)
        if (resolved) {
          project_id = resolved
          continue
        }
      }
      nameParts.push(token)
    }

    return {
      name: nameParts.join(' ').trim(),
      project_id,
      status,
      priority,
      assignee: '',
      due_date
    }
  }

  return { parseQuickCreate }
}
