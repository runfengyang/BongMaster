import assert from 'node:assert/strict'
import {
  buildActivityHeatmap,
  buildSalaryDaily,
  buildTrendArea,
  formatSalaryMoney,
  heatLevel,
  smoothLinePath
} from '../src/utils/salary-chart-data.js'

const close = (actual, expected, message) => {
  assert.ok(Math.abs(actual - expected) < 0.02, `${message}: ${actual} !== ${expected}`)
}

// Intensity thresholds mirror Token Monitor (0 / 25% / 50% / 75%).
assert.equal(heatLevel(0, 100), 0)
assert.equal(heatLevel(1, 100), 1)
assert.equal(heatLevel(24, 100), 1)
assert.equal(heatLevel(25, 100), 2)
assert.equal(heatLevel(50, 100), 3)
assert.equal(heatLevel(75, 100), 4)
assert.equal(heatLevel(100, 100), 4)
assert.equal(heatLevel(10, 0), 0)

// Currency formatting: zh-CN, two decimals, masked in privacy mode.
assert.equal(formatSalaryMoney(1234.5, 'CNY'), '¥1,234.50')
assert.equal(formatSalaryMoney(0, 'CNY'), '¥0.00')
assert.equal(formatSalaryMoney(1234.5, 'CNY', true), '••••')
assert.equal(formatSalaryMoney(Number.NaN, 'CNY'), '—')
assert.equal(formatSalaryMoney(10, 'NOT_A_CURRENCY'), '¥10.00')

// Smooth curve: cubic bezier, straight fallback for two points.
const curve = smoothLinePath([{ x: 0, y: 10 }, { x: 10, y: 5 }, { x: 20, y: 8 }])
assert.ok(curve.startsWith('M0,10'))
assert.ok(curve.includes(' C'))
assert.equal(smoothLinePath([{ x: 0, y: 1 }, { x: 5, y: 2 }]), 'M0,1 L5,2')
assert.equal(smoothLinePath([]), '')

// Activity window: the last 6 natural months (including this month), Sunday columns.
const now = new Date(2026, 10, 11)
const activity = buildActivityHeatmap([
  { date: '2026-05-31', value: 50 },
  { date: '2026-06-02', value: 250 },
  { date: '2026-11-11', value: 1000, regular: 900, overtime: 100 },
  { date: '2026-11-12', value: 5000 }
], now, 420)

assert.equal(activity.startDate, '2026-06-01')
assert.equal(activity.endDate, '2026-11-11')
assert.equal(activity.cells[0].date, '2026-05-31')
assert.equal(activity.cells[0].row, 0)
assert.equal(activity.cells[0].col, 0)
assert.equal(activity.cells.at(-1).date, '2026-11-11')
assert.equal(activity.cells.at(-1).row, 3)
assert.equal(activity.cells.at(-1).col, 23)
assert.equal(activity.weeks, 24)
assert.equal(activity.cells.some(cell => cell.date === '2026-11-12'), false)

// Empty days are kept; only in-window values drive the scale and active count.
const todayCell = activity.cells.find(cell => cell.date === '2026-11-11')
const emptyCell = activity.cells.find(cell => cell.date === '2026-11-09')
const beforeWindow = activity.cells.find(cell => cell.date === '2026-05-31')
assert.equal(todayCell.value, 1000)
assert.equal(todayCell.regular, 900)
assert.equal(todayCell.overtime, 100)
assert.equal(todayCell.level, 4)
assert.equal(emptyCell.value, 0)
assert.equal(emptyCell.regular, 0)
assert.equal(emptyCell.overtime, 0)
assert.equal(emptyCell.level, 0)
assert.equal(beforeWindow.value, 0)
assert.equal(beforeWindow.level, 0)
assert.equal(activity.maxValue, 1000)
assert.equal(activity.total, 1250)
assert.equal(activity.activeDays, 2)

// Width-driven square cells, clamped 10–20, no horizontal scroll geometry.
assert.equal(activity.gap, 2)
close(activity.cell, 15.5, 'cell from available width')
close(activity.pitch, 17.5, 'cell pitch')
close(activity.height, 120.5, 'compact heatmap height')
assert.ok(activity.height >= 108 && activity.height <= 122, 'heatmap stays compact at 420px')
assert.equal(activity.width, 418)
assert.ok(Math.abs(420 - activity.width) <= activity.gap)
assert.equal(activity.cells[0].size, activity.cell)
assert.equal(activity.cells[0].hitHeight, activity.pitch)
assert.ok(activity.cells.every(cell => cell.hitWidth === activity.pitch))

const narrow = buildActivityHeatmap([], now, 320)
assert.ok(narrow.cell > 10 && narrow.cell < 12)
const wide = buildActivityHeatmap([], now, 900)
assert.equal(wide.cell, 20)
assert.equal(wide.width, 24 * 22 - 2)

// Six month labels, each anchored at the column containing the 1st.
assert.equal(activity.months.length, 6)
assert.deepEqual(activity.months[0], { key: '2026-06', label: '6月', col: 0, x: 0 })
assert.equal(activity.months.at(-1).label, '11月')
assert.equal(activity.months.at(-1).col, 22)

// Trend: 30 local days of smooth area, no bar model, future rows ignored.
const trend = buildTrendArea([
  { date: '2026-11-09', value: 0, regular: 0, overtime: 0 },
  { date: '2026-11-10', value: 200, regular: 150, overtime: 50 },
  { date: '2026-11-11', value: 100, regular: 100, overtime: 0 },
  { date: '2026-11-12', value: 999, regular: 999, overtime: 0 }
], now, 420)

assert.equal(trend.width, 420)
assert.equal(trend.height, 96)
assert.equal(trend.points.length, 30)
assert.equal(trend.points[0].date, '2026-10-13')
assert.equal(trend.points.at(-1).date, '2026-11-11')
assert.equal(trend.points.some(point => point.date === '2026-11-12'), false)
assert.equal('bars' in trend, false)
assert.equal(trend.total, 300)
assert.equal(trend.peak, 200)
assert.equal(trend.maxValue, 200)

assert.ok(trend.linePath.startsWith('M2,'))
assert.ok(trend.linePath.includes(' C'))
assert.ok(trend.areaPath.startsWith(trend.linePath))
assert.ok(trend.areaPath.includes(' L'))
assert.ok(trend.areaPath.endsWith(' Z'))
close(trend.plot.x, 2, 'plot left padding')
close(trend.plot.y, 8, 'plot top padding')
close(trend.plot.h, 66, 'compact trend plot height')
assert.equal(trend.points[0].x, 2)
assert.equal(trend.points.at(-1).x, 418)

const stacked = trend.points.find(point => point.date === '2026-11-10')
assert.equal(stacked.total, 200)
assert.equal(stacked.regular, 150)
assert.equal(stacked.overtime, 50)
const todayPoint = trend.points.at(-1)
assert.equal(todayPoint.total, 100)
assert.equal(todayPoint.regular, 100)
assert.equal(todayPoint.overtime, 0)

// Three bottom date labels: start, middle, end.
assert.equal(trend.labels.length, 3)
assert.deepEqual(trend.labels.map(label => label.anchor), ['start', 'middle', 'end'])
assert.equal(trend.labels[0].text, '10/13')
assert.equal(trend.labels.at(-1).text, '11/11')
assert.equal(trend.labels[1].x > trend.labels[0].x, true)
assert.equal(trend.labels[1].x < trend.labels.at(-1).x, true)

// Invisible hit columns cover the plot and carry split data for titles.
assert.equal(trend.points[0].hitX, 2)
close(trend.points.at(-1).hitX + trend.points.at(-1).hitWidth, 418, 'hit columns reach the right edge')
assert.ok(trend.points.every(point => point.hitWidth > 0))

const emptyTrend = buildTrendArea([], now, 420)
assert.equal(emptyTrend.total, 0)
assert.equal(emptyTrend.peak, 0)
assert.equal(emptyTrend.points.length, 30)

// buildSalaryDaily stays lazy-safe until salary-calculator exports calculateDaySalary.
assert.equal(typeof buildSalaryDaily, 'function')

console.log('salary chart data tests passed')
