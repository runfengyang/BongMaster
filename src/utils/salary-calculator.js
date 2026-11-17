export const DEFAULT_SALARY_SETTINGS = {
  amount: 0,
  currency: 'CNY'
}

const parseStamp = value => {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(value || ''))
  if (!match) return null
  const [, year, month, day, hour, minute, second] = match.map(Number)
  const date = new Date(year, month - 1, day, hour, minute, second)
  return Number.isFinite(date.getTime()) ? date : null
}

const dateKey = date => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const parseClock = value => {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || ''))
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

const workdayNumbers = settings => String(settings?.workdays || '1,2,3,4,5')
  .split(',').map(Number).filter(day => Number.isInteger(day) && day >= 1 && day <= 7)

const pauseList = value => {
  let list = value
  if (typeof list === 'string') {
    try { list = JSON.parse(list) } catch { return [] }
  }
  return Array.isArray(list) ? list : []
}

export function validateSalarySettings(settings) {
  if (!settings || typeof settings !== 'object') return '请先设置收入信息'
  if (!Number.isFinite(settings.amount) || settings.amount <= 0 || settings.amount > 1e12) return '请输入有效的月薪金额（大于0且不超过1万亿）'
  if (!['CNY', 'USD', 'EUR', 'HKD'].includes(settings.currency)) return '请选择支持的币种'
  return null
}

export function countMonthlyWorkdays(settings, date = new Date()) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return 0
  const days = workdayNumbers(settings)
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  let count = 0
  for (let day = 1; day <= daysInMonth; day += 1) {
    const weekday = new Date(date.getFullYear(), date.getMonth(), day).getDay() || 7
    if (days.includes(weekday)) count += 1
  }
  return count
}

export function calculateDaySalary(record, salary, workSettings, now = new Date()) {
  const error = validateSalarySettings(salary)
  if (error) throw new Error(error)
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('当前时间无效')
  const key = dateKey(now)
  const startMinutes = parseClock(workSettings?.work_start || '09:00') ?? 540
  const endMinutes = parseClock(workSettings?.work_end || '18:00') ?? 1080
  const year = Number(String(record?.work_date || key).slice(0, 4)) || now.getFullYear()
  const month = Number(String(record?.work_date || key).slice(5, 7)) - 1
  const day = Number(String(record?.work_date || key).slice(8, 10)) || now.getDate()
  const workStart = new Date(year, month, day, 0, startMinutes).getTime()
  const workEnd = new Date(year, month, day, 0, endMinutes).getTime()
  const shiftEnd = workEnd > workStart ? workEnd : workEnd + 86400000
  const standardSeconds = Math.max(1, (shiftEnd - workStart) / 1000)
  const monthlyDays = countMonthlyWorkdays(workSettings, new Date(year, month, 1))
  const perSecond = salary.amount / Math.max(1, monthlyDays) / standardSeconds
  const checkIn = parseStamp(record?.check_in_at)
  const checkOut = parseStamp(record?.check_out_at)
  const workDate = parseStamp(`${record?.work_date || key} 00:00:00`)
  const isWorkday = workDate ? workdayNumbers(workSettings).includes(workDate.getDay() || 7) : false
  const start = checkIn?.getTime()
  const stop = Math.min(now.getTime(), checkOut?.getTime() ?? now.getTime())
  let regularSeconds = 0
  let overtimeSeconds = 0
  let workedSeconds = 0
  const pauses = pauseList(record?.pauses)
  if (start !== undefined && Number.isFinite(start) && stop > start) {
    const paidSpan = (from, to) => {
      const duration = Math.max(0, Math.min(stop, to) - Math.max(start, from)) / 1000
      const paused = pauses.reduce((sum, pause) => {
        const pauseStart = parseStamp(pause?.start)?.getTime()
        const pauseEnd = parseStamp(pause?.end)?.getTime() ?? stop
        return Number.isFinite(pauseStart) ? sum + Math.max(0, Math.min(stop, to, pauseEnd) - Math.max(start, from, pauseStart)) / 1000 : sum
      }, 0)
      return Math.max(0, duration - paused)
    }
    regularSeconds = isWorkday ? paidSpan(workStart, shiftEnd) : 0
    overtimeSeconds = isWorkday ? paidSpan(start, workStart) + paidSpan(shiftEnd, stop) : paidSpan(start, stop)
    workedSeconds = regularSeconds + overtimeSeconds
  }
  const regularEarned = regularSeconds * perSecond
  const overtimeEarned = overtimeSeconds * perSecond * 2
  const status = !checkIn || start >= now.getTime() ? 'off' : checkOut && checkOut <= now ? 'after' : pauses.some(pause => pause?.start && !pause?.end) ? 'break' : 'working'
  return {
    earned: regularEarned + overtimeEarned,
    regularEarned,
    overtimeEarned,
    workedSeconds,
    regularSeconds,
    overtimeSeconds,
    standardSeconds,
    perSecond,
    isWorkday,
    status
  }
}

export function calculateSalarySnapshot(salary, workSettings, records = [], now = new Date()) {
  const list = Array.isArray(records) ? records : []
  const today = calculateDaySalary(list.find(record => record?.work_date === dateKey(now)), salary, workSettings, now)
  const mondayOffset = (now.getDay() + 6) % 7
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const sumBefore = (start, end) => list
    .filter(record => record?.work_date >= dateKey(start) && record?.work_date < dateKey(end))
    .reduce((sum, record) => sum + calculateDaySalary(record, salary, workSettings, now).earned, 0)
  return {
    ...today,
    weeklyEarned: sumBefore(weekStart, now) + today.earned,
    monthlyEarned: sumBefore(monthStart, now) + today.earned
  }
}
