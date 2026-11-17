import {
  wrapSelection,
  prefixSelectedLines,
  insertBlock,
  indentSelectedLines,
  outdentSelectedLines,
  createTableTemplate,
  applyMarkdownCommandToValue
} from '../src/composables/useMarkdownCommands.js'

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    console.error(`FAIL: ${message}`)
    console.error(`  expected: ${JSON.stringify(expected)}`)
    console.error(`  actual:   ${JSON.stringify(actual)}`)
    process.exitCode = 1
  } else {
    console.log(`PASS: ${message}`)
  }
}

function assertObjectEqual(actual, expected, message) {
  const ok = Object.keys(expected).every(key => actual[key] === expected[key])
  if (!ok) {
    console.error(`FAIL: ${message}`)
    console.error(`  expected: ${JSON.stringify(expected)}`)
    console.error(`  actual:   ${JSON.stringify(actual)}`)
    process.exitCode = 1
  } else {
    console.log(`PASS: ${message}`)
  }
}

// wrapSelection
let r = wrapSelection('abc', 1, 2, '**', '**', '加粗文本')
assertEqual(r.value, 'a**b**c', 'wrap selected single char')
assertEqual(r.selectionStart, 6, 'cursor after wrapper')

r = wrapSelection('', 0, 0, '**', '**', '加粗文本')
assertEqual(r.value, '**加粗文本**', 'wrap empty selection inserts placeholder')
assertEqual(r.selectionStart, 2, 'placeholder start')
assertEqual(r.selectionEnd, 6, 'placeholder end')

// prefixSelectedLines ordered list
r = prefixSelectedLines('a\nb\nc', 0, 5, (_, i) => `${i + 1}. `)
assertEqual(r.value, '1. a\n2. b\n3. c', 'ordered list prefixes increasing numbers')

// indent/outdent
r = indentSelectedLines('a\nb', 0, 3, '  ')
assertEqual(r.value, '  a\n  b', 'indent selected lines')

r = outdentSelectedLines('  a\n  b', 0, 7, 2)
assertEqual(r.value, 'a\nb', 'outdent selected lines')

// table template
const table = createTableTemplate(3, 2)
assertEqual(table.split('\n').length, 4, 'table template has header, separator, 2 rows')
assertEqual(table.includes('---'), true, 'table template has separator')

// applyMarkdownCommandToValue
r = applyMarkdownCommandToValue('hello world', 6, 11, 'bold')
assertEqual(r.value, 'hello **world**', 'bold command wraps selection')

r = applyMarkdownCommandToValue('', 0, 0, 'italic')
assertEqual(r.value, '*斜体文本*', 'italic empty selection')
assertEqual(r.selectionStart, 1, 'italic placeholder start')
assertEqual(r.selectionEnd, 5, 'italic placeholder end')

r = applyMarkdownCommandToValue('line1\nline2\nline3', 0, 17, 'orderedList')
assertEqual(r.value, '1. line1\n2. line2\n3. line3', 'orderedList command numbers lines')

r = applyMarkdownCommandToValue('paragraph', 9, 9, 'table')
assertEqual(r.value.includes('| --- |'), true, 'table command inserts table')

console.log(process.exitCode ? '\nSome tests failed.' : '\nAll tests passed.')
