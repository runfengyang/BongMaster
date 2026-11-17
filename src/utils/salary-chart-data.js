import {
  differenceInCalendarDays,
  eachDayOfInterval,
  format,
  getDay,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths
} from 'date-fns'
import * as salaryCalculator from './salary-calculator.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const formatterCache = new Map()

function currencyCode(currency) {
  const code = typeof currency === 'string' ? currency.toUpperCase() : ''
  return /^[A-Z]{3}$/.test(code) ? code : 'CNY'
}

function formatterFor(currency) {
  const code = currencyCode(currency)
  if (formatterCache.has(code)) return formatterCache.get(code)
  let formatter
  try {
    formatter = new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
  } catch {
    formatter = new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency: 'CNY',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
  }
  formatterCache.set(code, formatter)
  return formatter
}

export function formatSalaryMoney(value, currency = 'CNY', privateMode = false) {
  if (privateMode) return '••••'
  const amount = Number(value)
  if (!Number.isFinite(amount)) return '—'
  return formatterFor(currency).format(amount)
}

export function heatLevel(value, max) {
  if (!(max > 0)) return 0
  const ratio = Math.max(0, Number(value) || 0) / max
  return ratio >= 0.75 ? 4 : ratio >= 0.5 ? 3 : ratio >= 0.25 ? 2 : ratio > 0 ? 1 : 0
}

function toNumber(value) {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

function dayKey(value) {
  return String(value || '').slice(0, 10)
}

function round(value) {
  return Math.round(value * 100) / 100
}

function normalizeDaily(daily) {
  const map = new Map()
  for (const row of Array.isArray(daily) ? daily : []) {
    const date = dayKey(row?.date)
    if (!DATE_RE.test(date)) continue
    const value = Math.max(0, toNumber(row?.value))
    const regular = row?.regular === undefined || row?.regular === null ? null : Math.max(0, toNumber(row.regular))
    const overtime = row?.overtime === undefined || row?.overtime === null ? null : Math.max(0, toNumber(row.overtime))
    const prev = map.get(date)
    if (!prev) {
      map.set(date, { date, value, regular, overtime })
      continue
    }
    prev.value += value
    prev.regular = prev.regular === null ? regular : regular === null ? prev.regular : prev.regular + regular
    prev.overtime = prev.overtime === null ? overtime : overtime === null ? prev.overtime : prev.overtime + overtime
  }
  return map
}

function splitFor(row) {
  const value = Math.max(0, toNumber(row?.value))
  const hasRegular = row?.regular !== undefined && row?.regular !== null
  const hasOvertime = row?.overtime !== undefined && row?.overtime !== null
  let regular
  let overtime
  if (!hasRegular && !hasOvertime) {
    regular = value
    overtime = 0
  } else {
    regular = hasRegular ? row.regular : Math.max(0, value - toNumber(row?.overtime))
    overtime = hasOvertime ? row.overtime : Math.max(0, value - regular)
  }
  let total = regular + overtime
  if (total <= 0 && value > 0) {
    regular = value
    overtime = 0
    total = value
  }
  return { regular, overtime, total }
}

export function buildActivityHeatmap(daily, now = new Date(), width = 420, options = {}) {
  const gap = Number.isFinite(options.gap) ? options.gap : 2
  const cellMin = Number.isFinite(options.cellMin) ? options.cellMin : 10
  const cellMax = Number.isFinite(options.cellMax) ? options.cellMax : 20
  const records = normalizeDaily(daily)
  const end = startOfDay(now)
  const start = startOfMonth(subMonths(end, 5))
  const gridStart = startOfWeek(start, { weekStartsOn: 0 })
  const startDate = format(start, 'yyyy-MM-dd')
  const endDate = format(end, 'yyyy-MM-dd')
  const days = eachDayOfInterval({ start: gridStart, end })
  const weeks = Math.max(1, Math.ceil(days.length / 7))
  const available = Number.isFinite(Number(width)) ? Number(width) : 420
  const cell = Math.min(cellMax, Math.max(cellMin, (available - weeks * gap) / weeks))
  const pitch = cell + gap

  let maxValue = 0
  let total = 0
  let activeDays = 0
  for (const [key, row] of records) {
    if (key < startDate || key > endDate) continue
    if (row.value > maxValue) maxValue = row.value
    total += row.value
    if (row.value > 0) activeDays += 1
  }

  const cells = days.map(day => {
    const date = format(day, 'yyyy-MM-dd')
    const inWindow = date >= startDate && date <= endDate
    const detail = inWindow ? splitFor(records.get(date)) : { regular: 0, overtime: 0, total: 0 }
    const value = detail.total
    const col = Math.floor(differenceInCalendarDays(day, gridStart) / 7)
    const row = getDay(day)
    const x = col * pitch
    const y = row * pitch
    return {
      date,
      dateLabel: format(day, 'M月d日'),
      weekday: getDay(day),
      col,
      row,
      x,
      y,
      size: cell,
      hitX: x,
      hitY: y,
      hitWidth: pitch,
      hitHeight: pitch,
      value,
      regular: detail.regular,
      overtime: detail.overtime,
      level: heatLevel(value, maxValue)
    }
  })

  const months = Array.from({ length: 6 }, (_, index) => {
    const month = new Date(start.getFullYear(), start.getMonth() + index, 1)
    const col = Math.floor(differenceInCalendarDays(month, gridStart) / 7)
    return { key: format(month, 'yyyy-MM'), label: format(month, 'M月'), col, x: col * pitch }
  })

  const height = 7 * pitch - gap
  return {
    cells,
    months,
    weeks,
    startDate,
    endDate,
    cell,
    gap,
    pitch,
    width: weeks * pitch - gap,
    height,
    activeDays,
    maxValue,
    total
  }
}

export function smoothLinePath(points) {
  const list = Array.isArray(points) ? points : []
  if (!list.length) return ''
  if (list.length < 3) {
    return list.map((point, index) => `${index ? 'L' : 'M'}${round(point.x)},${round(point.y)}`).join(' ')
  }
  let path = `M${round(list[0].x)},${round(list[0].y)}`
  for (let index = 0; index < list.length - 1; index += 1) {
    const p0 = list[Math.max(0, index - 1)]
    const p1 = list[index]
    const p2 = list[index + 1]
    const p3 = list[Math.min(list.length - 1, index + 2)]
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    path += ` C${round(c1x)},${round(c1y)} ${round(c2x)},${round(c2y)} ${round(p2.x)},${round(p2.y)}`
  }
  return path
}

export function buildTrendArea(daily, now = new Date(), width = 420, options = {}) {
  const height = Number.isFinite(options.height) ? options.height : 96
  const padTop = Number.isFinite(options.padTop) ? options.padTop : 8
  const padBottom = Number.isFinite(options.padBottom) ? options.padBottom : 22
  const padX = Number.isFinite(options.padX) ? options.padX : 2
  const measured = Number(width)
  const chartWidth = Math.max(240, Number.isFinite(measured) ? measured : 240)
  const records = normalizeDaily(daily)
  const end = startOfDay(now)
  const start = subDays(end, 29)
  const days = eachDayOfInterval({ start, end })
  const innerW = Math.max(1, chartWidth - padX * 2)
  const innerH = Math.max(1, height - padTop - padBottom)
  const baseline = padTop + innerH

  const rows = days.map(day => {
    const date = format(day, 'yyyy-MM-dd')
    const row = records.get(date)
    return {
      date,
      dateLabel: format(day, 'M/d'),
      fullLabel: format(day, 'M月d日'),
      weekday: getDay(day),
      ...splitFor(row)
    }
  })
  const peak = Math.max(0, ...rows.map(row => row.total))
  const maxValue = peak > 0 ? peak : 1
  const total = rows.reduce((sum, row) => sum + row.total, 0)
  const points = rows.map((row, index) => ({
    ...row,
    x: padX + (rows.length <= 1 ? innerW / 2 : innerW * index / (rows.length - 1)),
    y: padTop + innerH - innerH * row.total / maxValue
  }))

  points.forEach((point, index) => {
    const left = index === 0 ? padX : (points[index - 1].x + point.x) / 2
    const right = index === points.length - 1 ? chartWidth - padX : (point.x + points[index + 1].x) / 2
    point.hitX = left
    point.hitWidth = Math.max(1, right - left)
  })

  const linePath = smoothLinePath(points)
  const areaPath = points.length
    ? `${linePath} L${round(points[points.length - 1].x)},${round(baseline)} L${round(points[0].x)},${round(baseline)} Z`
    : ''

  const middle = Math.floor((points.length - 1) / 2)
  const labelIndexes = [...new Set([0, middle, points.length - 1])]
  const labels = labelIndexes.map((index, position) => ({
    key: points[index].date,
    text: points[index].dateLabel,
    x: points[index].x,
    y: height - 6,
    anchor: position === 0 ? 'start' : position === labelIndexes.length - 1 ? 'end' : 'middle'
  }))

  return {
    width: chartWidth,
    height,
    plot: { x: padX, y: padTop, w: innerW, h: innerH },
    peak,
    maxValue,
    total,
    points,
    linePath,
    areaPath,
    labels
  }
}

export function buildSalaryDaily(records, salary, workSettings, now = new Date()) {
  const calculate = salaryCalculator.calculateDaySalary
  if (typeof calculate !== 'function') {
    throw new Error('calculateDaySalary 尚未在 src/utils/salary-calculator.js 中导出')
  }
  const end = format(now, 'yyyy-MM-dd')
  const byDate = new Map()
  for (const record of Array.isArray(records) ? records : []) {
    const date = dayKey(record?.work_date || record?.date)
    if (!DATE_RE.test(date) || date > end) continue
    const result = calculate(record, salary, workSettings, now)
    if (!result) continue
    const row = byDate.get(date) || { date, value: 0, regular: 0, overtime: 0, workedSeconds: 0 }
    row.value += toNumber(result.earned)
    row.regular += toNumber(result.regularEarned)
    row.overtime += toNumber(result.overtimeEarned)
    row.workedSeconds += toNumber(result.workedSeconds)
    byDate.set(date, row)
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}
