import assert from 'node:assert/strict'
import { createServer } from 'vite'

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })

try {
  const { parseDailyTaskInput } = await server.ssrLoadModule('/src/utils/daily-task-parser.js')
  const datedTitle = parseDailyTaskInput('8 月 12 日完成 XX')
  const timedTask = parseDailyTaskInput('完成 XX 45m')

  assert.equal(datedTitle.title, '8 月 12 日完成 XX')
  assert.equal('estimated_minutes' in datedTitle, false)
  assert.equal(timedTask.title, '完成 XX 45m')
  assert.equal('estimated_minutes' in timedTask, false)
  assert.equal(parseDailyTaskInput('读文献 1h30m p1').title, '读文献 1h30m')
  assert.equal(parseDailyTaskInput('读文献 1h30m p1').priority, '高')
  console.log('Daily task parser tests passed')
} finally {
  await server.close()
}
