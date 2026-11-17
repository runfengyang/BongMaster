// 在 Electron 的 Node 环境里运行：
// ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/create-test-note.mjs

import path from 'path'
import os from 'os'
import Database from 'better-sqlite3'

const DB_PATH = process.env.BM_DB_PATH || path.join(os.homedir(), 'Library/Application Support/bongmaster-vue/database.db')

function generateContent() {
  const sections = []
  for (let i = 1; i <= 12; i++) {
    sections.push(`# 第 ${i} 章：测试章节 ${i}`)
    sections.push('')
    sections.push(`这是第 ${i} 章的导语。我们在这个章节中会讨论多个主题，包括 Markdown 表格、列表、代码块、数学公式以及图片渲染。通过这一章，你可以验证编辑器在长文档中的表现。`)
    sections.push('')
    sections.push(`## 第 ${i} 节：段落与排版`)
    sections.push('')
    for (let p = 1; p <= 3; p++) {
      sections.push(`段落 ${p}：在一篇长文档中，段落的连贯性非常重要。用户希望打字时光标稳定，不会因为自动保存或预览更新而跳回到开头。这个测试文档就是为了模拟真实的长文写作场景，覆盖多章节、多格式元素，确保新编辑器在各类情况下都能保持流畅。`)
      sections.push('')
    }
    sections.push(`## 第 ${i} 节：列表与任务`)
    sections.push('')
    sections.push('### 无序列表')
    sections.push('')
    sections.push('- 第一项：验证无序列表渲染')
    sections.push('- 第二项：检查列表缩进是否正常')
    sections.push('- 第三项：确保列表项之间间距合适')
    sections.push('')
    sections.push('### 有序列表')
    sections.push('')
    sections.push('1. 第一步：打开便签编辑器')
    sections.push('2. 第二步：输入测试内容')
    sections.push('3. 第三步：切换分屏模式查看预览')
    sections.push('')
    sections.push('### 待办列表')
    sections.push('')
    sections.push('- [ ] 验证光标不乱跳')
    sections.push('- [ ] 验证表格可正常编辑')
    sections.push('- [ ] 验证图片粘贴功能')
    sections.push('- [x] 完成基础编辑器迁移')
    sections.push('')
    sections.push(`## 第 ${i} 节：表格示例`)
    sections.push('')
    sections.push('| 项目名称 | 负责人 | 状态 | 备注 |')
    sections.push('| --- | --- | --- | --- |')
    sections.push(`| 任务 ${i}-1 | 张三 | 进行中 | 需要进一步确认 |`)
    sections.push(`| 任务 ${i}-2 | 李四 | 已完成 | 已验收通过 |`)
    sections.push(`| 任务 ${i}-3 | 王五 | 待开始 | 等待资源到位 |`)
    sections.push('')
    sections.push(`## 第 ${i} 节：代码块`)
    sections.push('')
    sections.push('```javascript')
    sections.push(`function example${i}() {`)
    sections.push('  const message = "Hello, BongMaster!"')
    sections.push('  console.log(message)')
    sections.push('  return message')
    sections.push('}')
    sections.push('```')
    sections.push('')
    sections.push(`## 第 ${i} 节：数学公式`)
    sections.push('')
    sections.push('行内公式示例：$E = mc^2$')
    sections.push('')
    sections.push('块级公式示例：')
    sections.push('')
    sections.push('$$')
    sections.push('\\int_{a}^{b} f(x) \\, dx = F(b) - F(a)')
    sections.push('$$')
    sections.push('')
    sections.push(`> 第 ${i} 章结语：通过以上多种元素的组合，这篇测试文档可以全面检验新编辑器在渲染、同步、保存等方面的稳定性。`)
    sections.push('')
  }

  return sections.join('\n')
}

function main() {
  console.log('[create-test-note] Using DB:', DB_PATH)
  const db = new Database(DB_PATH)

  const title = `长文档测试便签 - ${new Date().toLocaleString('zh-CN')}`
  const content = generateContent()

  const stmt = db.prepare(`
    INSERT INTO desktop_notes (title, content, width, height, pos_x, pos_y, is_pinned, is_minimized, category)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const result = stmt.run(title, content, 260, 300, 0, 0, 0, 0, '')
  const noteId = result.lastInsertRowid

  const row = db.prepare('SELECT id, title, LENGTH(content) as content_length FROM desktop_notes WHERE id = ?').get(noteId)
  console.log('[create-test-note] Created note:', row)
  console.log('[create-test-note] Content length:', content.length, 'characters')
}

main()
