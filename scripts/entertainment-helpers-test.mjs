import assert from 'node:assert/strict'
import { formatDuration, pickWebviewsToKeep, shouldCountUsage, usageBarPercent } from '../src/utils/entertainment.js'

assert.equal(formatDuration(0), '0s')
assert.equal(formatDuration(59), '59s')
assert.equal(formatDuration(60), '1m')
assert.equal(formatDuration(3660), '1h 1m')

assert.deepEqual(
  pickWebviewsToKeep({ mounted: ['a', 'b', 'c', 'd'], recent: ['a', 'b', 'c', 'd'], current: 'b', max: 3 }),
  ['a', 'b', 'c']
)
assert.deepEqual(
  pickWebviewsToKeep({ mounted: ['a', 'b'], recent: ['b', 'a'], current: 'a', max: 3 }),
  ['a', 'b']
)

const base = { pageActive: true, hidden: false, focused: true, idleSeconds: 0 }
assert.equal(shouldCountUsage(base), true)
assert.equal(shouldCountUsage({ ...base, focused: false }), false)
assert.equal(shouldCountUsage({ ...base, hidden: true }), false)
assert.equal(shouldCountUsage({ ...base, idleSeconds: 301 }), false)
assert.equal(shouldCountUsage({ ...base, idleSeconds: 301, audible: true }), true)

assert.equal(usageBarPercent(0, 45), 0)
assert.equal(usageBarPercent(1350, 45), 50)
assert.equal(usageBarPercent(9999, 45), 100)
assert.equal(usageBarPercent(100, 0), 0)

console.log('entertainment helpers ok')
