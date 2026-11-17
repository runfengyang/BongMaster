import { addDays, format, getISODay, startOfMonth } from 'date-fns'
import { LunarDay, SolarDay } from 'tyme4ts'
import { fromDateKey, toDateKey } from './calendar-recurrence.js'

export { expandOccurrences, makeOccurrence } from './calendar-recurrence.js'
export { fromDateKey, toDateKey }
const holidayModules = import.meta.glob('../data/calendar-pro/**/*.json', { eager: true, import: 'default' })
const holidayMaps = {}
for (const [filePath, entries] of Object.entries(holidayModules)) {
  const region = filePath.match(/\/(mainland-cn|hong-kong|us|uk)[/-]/)?.[1]
  if (!region) continue
  if (!holidayMaps[region]) holidayMaps[region] = new Map()
  for (const entry of entries) holidayMaps[region].set(entry.date, entry)
}
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const solarDayFor = dateKey => {
  const [year, month, day] = dateKey.split('-').map(Number)
  return SolarDay.fromYmd(year, month, day)
}

export function getLunarInfo(dateKey) {
  const solar = solarDayFor(dateKey)
  const lunar = solar.getLunarDay()
  const monthText = lunar.getLunarMonth().getName()
  const dayText = lunar.getName()
  const dayNumber = lunar.getDay()
  const festivalName = lunar.getFestival()?.getName() || solar.getFestival()?.getName() || null
  const termDay = solar.getTermDay()
  const solarTermName = termDay.getDayIndex() === 0 ? termDay.getSolarTerm().getName() : null
  return {
    yearName: lunar.getYearSixtyCycle().getName(),
    monthNumber: lunar.getMonth(),
    monthText,
    dayNumber,
    dayText,
    isLeapMonth: Boolean(lunar.getLunarMonth().isLeap?.() ?? lunar.getLunarMonth().leap),
    festivalName,
    solarTermName,
    displayText: festivalName || solarTermName || (dayNumber === 1 ? monthText : dayText),
    fullText: `${lunar.getYearSixtyCycle().getName()}年${monthText}${dayText}`
  }
}

export function solarDateForLunar(year, month, day) {
  try {
    const solar = LunarDay.fromYmd(year, month, day).getSolarDay()
    return `${solar.getYear()}-${String(solar.getMonth()).padStart(2, '0')}-${String(solar.getDay()).padStart(2, '0')}`
  } catch {
    return null
  }
}

export function getAlmanacInfo(dateKey) {
  const cycleDay = solarDayFor(dateKey).getSixtyCycleDay()
  return {
    recommends: cycleDay.getRecommends().map(item => item.getName()).filter(Boolean),
    avoids: cycleDay.getAvoids().map(item => item.getName()).filter(Boolean),
    dutyName: cycleDay.getDuty().getName(),
    naYin: cycleDay.getSixtyCycle().getSound().getName()
  }
}

export const HOLIDAY_REGIONS = [
  { id: 'mainland-cn', label: '中国大陆' },
  { id: 'hong-kong', label: '中国香港' },
  { id: 'us', label: '美国' },
  { id: 'uk', label: '英国' }
]

export function getHoliday(dateKey, region = 'mainland-cn') {
  return holidayMaps[region]?.get(dateKey) || null
}

export function getHolidayCoverage(region = 'mainland-cn') {
  const entries = [...(holidayMaps[region]?.values() || [])]
  const years = entries.map(item => Number(item.date.slice(0, 4))).filter(Number.isFinite)
  if (!years.length) return null
  return { min: Math.min(...years), max: Math.max(...years) }
}

export function hasHolidayData(region, year) {
  const coverage = getHolidayCoverage(region)
  return Boolean(coverage && year >= coverage.min && year <= coverage.max)
}

export function getCalendarProDay(dateKey, displayedMonthDate, selectedDate, currentDate = toDateKey(new Date()), region = 'mainland-cn') {
  const date = fromDateKey(dateKey)
  const lunar = getLunarInfo(dateKey)
  const holiday = getHoliday(dateKey, region)
  const badge = holiday
    ? (holiday.kind === 'workingAdjustmentDay' ? '班' : holiday.kind === 'festival' ? '' : '休')
    : ''
  const subtitle = holiday && holiday.kind !== 'workingAdjustmentDay'
    ? holiday.name
    : lunar.displayText
  return {
    date: dateKey,
    dayNumber: date.getDate(),
    weekdayLabel: WEEKDAYS[date.getDay()],
    isWeekend: date.getDay() === 0 || date.getDay() === 6,
    isInDisplayedMonth: dateKey.slice(0, 7) === displayedMonthDate.slice(0, 7),
    isToday: dateKey === currentDate,
    isSelected: dateKey === selectedDate,
    lunarText: lunar.displayText,
    lunarFullText: lunar.fullText,
    lunar,
    almanac: getAlmanacInfo(dateKey),
    holiday,
    badge,
    subtitle
  }
}

export function makeMonthGrid(anchorDate, selectedDate, currentDate = toDateKey(new Date()), region = 'mainland-cn', weekStartIso = 1) {
  const monthStart = startOfMonth(fromDateKey(anchorDate))
  const leading = (getISODay(monthStart) - weekStartIso + 7) % 7
  const gridStart = addDays(monthStart, -leading)
  return Array.from({ length: 42 }, (_, index) => {
    const dateKey = toDateKey(addDays(gridStart, index))
    return getCalendarProDay(dateKey, anchorDate, selectedDate, currentDate, region)
  })
}

export function makeSelectedDateSummary(dateKey, monthDays = [], region = 'mainland-cn') {
  const day = monthDays.find(item => item.date === dateKey)
    || getCalendarProDay(dateKey, dateKey, dateKey, undefined, region)
  const chips = []
  const add = value => {
    if (value && !chips.includes(value)) chips.push(value)
  }
  if (day.holiday) add(day.holiday.name)
  add(day.lunar.festivalName)
  add(day.lunar.solarTermName)
  if (day.badge) add(day.badge)
  return {
    date: dateKey,
    dateText: format(fromDateKey(dateKey), 'M月d日'),
    weekdayText: day.weekdayLabel,
    lunarText: day.lunarFullText,
    chips,
    day
  }
}

export function itemsForDate(items, dateKey) {
  return (items || [])
    .filter(item => item.startDate <= dateKey && item.endDate >= dateKey)
    .sort((a, b) =>
      Number(b.allDay) - Number(a.allDay) ||
      String(a.startTime || '').localeCompare(String(b.startTime || '')) ||
      a.title.localeCompare(b.title, 'zh-CN')
    )
}

export function meetingLinkFor(item) {
  const text = `${item.location || ''} ${item.notes || ''}`
  const meeting = text.match(/https?:\/\/[^\s]*(zoom\.us|meet\.google\.com|teams\.microsoft\.com|meeting\.tencent\.com|voovmeeting\.com|feishu\.cn|larksuite\.com|webex\.com|dingtalk\.com|whereby\.com|gotomeeting\.com)[^\s]*/i)
  return meeting?.[0] || null
}

export function eventTimeLabel(item) {
  if (item.allDay) return '全天'
  if (!item.startTime) return '无时间'
  return item.endTime ? `${item.startTime}–${item.endTime}` : item.startTime
}

export function groupOverviewItems(items, startDate, days = 14) {
  const start = fromDateKey(startDate)
  const groups = []
  for (let index = -7; index < days; index += 1) {
    const key = toDateKey(addDays(start, index))
    const dayItems = itemsForDate(items, key)
    if (dayItems.length) {
      groups.push({
        date: key,
        label: format(fromDateKey(key), 'M月d日'),
        weekday: WEEKDAYS[fromDateKey(key).getDay()],
        items: dayItems
      })
    }
  }
  return groups
}

