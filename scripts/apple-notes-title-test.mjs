import assert from 'node:assert/strict'
import { AppleNotesService } from '../electron/services/apple-notes-service.js'

const service = new AppleNotesService('/tmp')
const title = 'Whistleblowing Option Pricing：文献数据与研究设计'
const note = {
  id: 36,
  title,
  content: `# ${title}\n\n> 先纠正两个数字/口径\n\n正文内容`,
  category: '论文',
  updated_at: '2026-09-26 10:00:00'
}

const payload = await service.buildPayload(note)
assert.equal(payload.title, title)
assert.equal(payload.body.startsWith('<h1>'), false, 'Apple Notes body must not prepend the title')
assert.equal(payload.body.includes(`<h1>${title}</h1>`), false, 'Apple Notes body must not duplicate the title')

const pdf = service.buildPrintHtml(note)
assert.equal((pdf.match(/<h1>/g) || []).length, 1, 'PDF must contain exactly one title heading')
assert.ok(pdf.includes(`<h1>${service.escapeHtml(title)}</h1>`))

for (const [sample, expected] of [
  ['# 标题\n\n正文', '正文'],
  ['## 标题\n正文', '正文'],
  ['标题\n正文', '正文'],
  ['**标题**\n正文', '正文'],
  ['# 标题 #\n正文', '正文'],
  ['\n\n# 标题\n正文', '\n\n正文']
]) {
  assert.equal(service.stripLeadingTitle(sample, '标题'), expected, `strip failed: ${JSON.stringify(sample)}`)
}

assert.equal(service.stripLeadingTitle('正文内容\n\n# 标题', title), '正文内容\n\n# 标题')
assert.equal(service.stripLeadingTitle('正文内容', title), '正文内容')

console.log('Apple Notes title tests passed')
