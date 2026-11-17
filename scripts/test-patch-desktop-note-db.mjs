// 便签局部替换（真实 SQLite + MCP 工具层）：patchDesktopNote / patch_desktop_note
// 校验点：唯一匹配、歧义拒绝、occurrence/replace_all、乐观并发、事务回滚、非目标字段不动。
//
// 需要 Electron 的 Node ABI（better-sqlite3 是按 Electron 编译的），所以用:
//   ELECTRON_RUN_AS_NODE=1 npx electron scripts/test-patch-desktop-note-db.mjs
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import crypto from 'crypto'
import os from 'os'
import path from 'path'
import fs from 'fs'

const require = createRequire(import.meta.url)
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { DatabaseService } = require(path.join(projectRoot, 'electron/services/database-service.js'))
const { McpServerService } = require(path.join(projectRoot, 'electron/services/mcp-server.js'))

let failures = 0

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`FAIL: ${message}`)
    console.error(`  expected: ${JSON.stringify(expected)}`)
    console.error(`  actual:   ${JSON.stringify(actual)}`)
    failures += 1
  } else {
    console.log(`PASS: ${message}`)
  }
}

function assertThrows(fn, matcher, message) {
  try {
    fn()
  } catch (err) {
    if (matcher && !matcher.test(err.message)) {
      console.error(`FAIL: ${message}`)
      console.error(`  error message didn't match ${matcher}: ${err.message}`)
      failures += 1
    } else {
      console.log(`PASS: ${message}`)
    }
    return
  }
  console.error(`FAIL: ${message}（未抛错）`)
  failures += 1
}

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex')

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-patch-note-'))
const db = new DatabaseService(path.join(tmpDir, 'database.db'), path.join(tmpDir, 'uploads'))
db.initialize()

const content = '会议纪要\n- TODO: 修 bug\n结论：先观察\n'
const noteId = db.createDesktopNote({ title: '纪要', content }).id

try {
  // ===== 唯一匹配：只改这一处，其余正文原样 =====
  const one = db.patchDesktopNote(noteId, { find: 'TODO: 修 bug', replace: 'DONE: 已修' })
  assertEqual(one.replaced, 1, '唯一匹配替换 1 处')
  assertEqual(
    one.note.content,
    '会议纪要\n- DONE: 已修\n结论：先观察\n',
    '替换后正文只有该片段发生变化'
  )
  assertEqual(one.note.content_hash, sha256(one.note.content), '返回的 content_hash 是正文 sha256')

  // ===== find 空 / 找不到 =====
  assertThrows(() => db.patchDesktopNote(noteId, { find: '', replace: 'x' }), /find 不能为空/, 'find 为空报错')
  assertThrows(() => db.patchDesktopNote(noteId, { find: '不存在的片段', replace: 'x' }), /未在便签正文中找到/, 'find 找不到报错')

  // ===== 歧义：出现 2 次且未消歧 -> 报错且正文不动 =====
  const before = db.getDesktopNoteById(noteId).content
  db.updateDesktopNote(noteId, { content: 'A 重复\nB 重复\n' })
  const ambiguous = db.getDesktopNoteById(noteId).content
  assertThrows(
    () => db.patchDesktopNote(noteId, { find: '重复', replace: '唯一' }),
    /出现 2 次/,
    '重复文本默认拒绝替换'
  )
  assertEqual(db.getDesktopNoteById(noteId).content, ambiguous, '歧义拒绝后正文未被改动')
  assertEqual(ambiguous, 'A 重复\nB 重复\n', '重复文本准备就绪')

  // ===== occurrence：只替换第 2 次 =====
  const nth = db.patchDesktopNote(noteId, { find: '重复', replace: '唯一', occurrence: 2 })
  assertEqual(nth.replaced, 1, 'occurrence 只替换 1 处')
  assertEqual(nth.note.content, 'A 重复\nB 唯一\n', 'occurrence=2 只改第二次')
  assertThrows(
    () => db.patchDesktopNote(noteId, { find: '唯一', replace: 'x', occurrence: 3 }),
    /只出现 1 次/,
    'occurrence 越界报错'
  )

  // ===== replace_all =====
  const all = db.patchDesktopNote(noteId, { find: '重复', replace: '全部', replace_all: true })
  assertEqual(all.replaced, 1, 'replace_all 命中 1 处（另一次已被替换）')
  assertEqual(all.note.content, 'A 全部\nB 唯一\n', 'replace_all 替换全部匹配')

  // ===== occurrence 与 replace_all 互斥 =====
  assertThrows(
    () => db.patchDesktopNote(noteId, { find: '全部', replace: 'x', occurrence: 1, replace_all: true }),
    /互斥/,
    'occurrence 与 replace_all 互斥'
  )

  // ===== 替换为空字符串 = 删除片段；replace 里的 $& 按字面处理 =====
  db.patchDesktopNote(noteId, { find: 'A 全部\n', replace: '' })
  assertEqual(db.getDesktopNoteById(noteId).content, 'B 唯一\n', '空 replace 表示删除片段')
  db.patchDesktopNote(noteId, { find: 'B 唯一\n', replace: '捕获 $& 与 $1 按字面' })
  assertEqual(db.getDesktopNoteById(noteId).content, '捕获 $& 与 $1 按字面', '$ 特殊符号不被当作替换模式')

  // ===== 乐观并发：哈希 / updated_at =====
  const now = db.getDesktopNoteById(noteId)
  assertThrows(
    () => db.patchDesktopNote(noteId, { find: '字面', replace: 'x', expected_content_hash: sha256('别的正文') }),
    /哈希不匹配/,
    'expected_content_hash 不匹配时报错'
  )
  assertEqual(db.getDesktopNoteById(noteId).content, now.content, '并发校验失败后正文未被改动')
  assertThrows(
    () => db.patchDesktopNote(noteId, { find: '字面', replace: 'x', expected_updated_at: '1970-01-01 00:00:00' }),
    /更新时间/,
    'expected_updated_at 不匹配时报错'
  )
  const ok = db.patchDesktopNote(noteId, {
    find: '字面',
    replace: '字面 OK',
    expected_content_hash: now.content_hash,
    expected_updated_at: now.updated_at
  })
  assertEqual(ok.note.content, '捕获 $& 与 $1 按字面 OK', '哈希与时间都匹配时替换成功')

  // ===== 不存在的便签 =====
  assertThrows(() => db.patchDesktopNote(999999, { find: 'a', replace: 'b' }), /不存在/, '便签不存在时报错')

  // ===== 非目标字段不受影响，update_desktop_note 行为不变 =====
  const project = db.createProject({ name: '局部替换项目' })
  const rich = db.createDesktopNote({
    title: '原题',
    content: '正文 v1',
    category: '工作',
    is_pinned: true,
    project_ids: [project.id]
  })
  db.patchDesktopNote(rich.id, { find: 'v1', replace: 'v2' })
  const after = db.getDesktopNoteById(rich.id)
  assertEqual(after.content, '正文 v2', '局部替换写入新正文')
  assertEqual(
    [after.title, after.category, after.is_pinned, after.project_ids],
    ['原题', '工作', 1, [project.id]],
    '标题/分类/置顶/项目关联都不受影响'
  )

  db.updateDesktopNote(rich.id, { title: '新题', category: '生活', is_pinned: false, project_ids: [] })
  const afterUpdate = db.getDesktopNoteById(rich.id)
  assertEqual(
    [afterUpdate.title, afterUpdate.category, afterUpdate.is_pinned, afterUpdate.project_ids, afterUpdate.content],
    ['新题', '生活', 0, [], '正文 v2'],
    'update_desktop_note 原有行为不变（含清空项目关联）'
  )

  // ===== MCP 工具层（trust boundary + 工具注册） =====
  const mcp = new McpServerService(db)
  const tool = mcp.getTools().find(t => t.name === 'patch_desktop_note')
  assertEqual(tool?.inputSchema?.required, ['note_id', 'find', 'replace'], 'MCP 工具已注册且必需参数正确')

  const longBody = `${'批注上下文占位文字。'.repeat(20)}批注位置 B\n${'后续正文。'.repeat(10)}`
  const mcpNoteId = db.createDesktopNote({ content: longBody }).id
  const reply = await mcp.executeTool('patch_desktop_note', { note_id: mcpNoteId, find: '批注位置 B', replace: '批注位置 B 已处理' })
  console.log(reply)
  assertEqual(/成功替换 1 处/.test(reply), true, 'MCP 返回替换次数')
  assertEqual(/成功替换 1 处 \(ID: \d+\)/.test(reply), true, 'MCP 返回 note_id')
  const afterMcp = db.getDesktopNoteById(mcpNoteId)
  assertEqual(reply.includes(afterMcp.content), false, 'MCP 返回不输出完整正文')
  assertEqual(/摘要: /.test(reply), true, 'MCP 返回只给正文摘要')
  assertEqual(afterMcp.content.length > 60, true, '长正文用于验证摘要截断')
  assertEqual(afterMcp.content.includes('批注位置 B 已处理'), true, 'MCP 调用真的改了正文')
  assertEqual(afterMcp.content.startsWith('批注上下文占位文字。'), true, 'MCP 替换保留正文前段')

  let mcpError = null
  try {
    await mcp.executeTool('patch_desktop_note', { note_id: mcpNoteId, find: '', replace: 'x' })
  } catch (err) {
    mcpError = err.message
  }
  assertEqual(/find 不能为空/.test(mcpError || ''), true, 'MCP 侧空 find 被拦下')

  mcpError = null
  try {
    await mcp.executeTool('patch_desktop_note', { note_id: mcpNoteId, find: '批注上下文占位文字。', replace: 'x' })
  } catch (err) {
    mcpError = err.message
  }
  assertEqual(/出现 20 次/.test(mcpError || ''), true, 'MCP 侧重复文本被拦下并提示消歧')

  mcpError = null
  try {
    await mcp.executeTool('patch_desktop_note', { note_id: mcpNoteId, find: 'a', replace: 'b', occurrence: 1, replace_all: true })
  } catch (err) {
    mcpError = err.message
  }
  assertEqual(/互斥/.test(mcpError || ''), true, 'MCP 侧互斥参数被拦下')

  const nullish = await mcp.executeTool('patch_desktop_note', {
    note_id: mcpNoteId,
    find: '批注位置 B 已处理',
    replace: '批注位置 B 收尾',
    occurrence: null,
    replace_all: null,
    expected_content_hash: null,
    expected_updated_at: null
  })
  assertEqual(/成功替换 1 处/.test(nullish), true, '可选参数显式传 null 视为未提供')
  assertEqual(db.getDesktopNoteById(mcpNoteId).content.includes('批注位置 B 收尾'), true, 'null 参数下替换仍生效')

  const mcpUpdate = await mcp.executeTool('update_desktop_note', { note_id: mcpNoteId, title: 'MCP 改名', is_pinned: true })
  assertEqual(/成功更新便签/.test(mcpUpdate), true, 'update_desktop_note 仍可用')
  assertEqual(
    [db.getDesktopNoteById(mcpNoteId).title, db.getDesktopNoteById(mcpNoteId).is_pinned],
    ['MCP 改名', 1],
    'update_desktop_note 的 title/is_pinned 仍生效'
  )
  const finalContent = db.getDesktopNoteById(mcpNoteId).content
  assertEqual(
    finalContent === longBody.replace('批注位置 B', '批注位置 B 收尾'),
    true,
    'update_desktop_note 不改正文（局部替换结果原样保留）'
  )
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true })
}

console.log(failures ? `\n${failures} test(s) failed.` : '\nAll patch-desktop-note tests passed.')
if (failures) process.exitCode = 1
