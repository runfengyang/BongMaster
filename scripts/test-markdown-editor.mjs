import {
  serializeDescriptorTree,
  markdownRangeForDomRange
} from '../src/utils/markdown-editor.js'

let failures = 0

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    console.error(`FAIL: ${message}`)
    console.error(`  expected: ${JSON.stringify(expected)}`)
    console.error(`  actual:   ${JSON.stringify(actual)}`)
    failures += 1
  } else {
    console.log(`PASS: ${message}`)
  }
}

function text(value, offset = 0) {
  return { text: value, offset }
}

function el(tag, children, attrs = {}) {
  return { tag, attrs, children }
}

function serialize(nodes, options) {
  return serializeDescriptorTree(nodes, options).markdown
}

// paragraphs / line breaks
assertEqual(
  serialize([el('p', [text('first'), el('br'), text('second', 6)])]),
  'first\nsecond',
  'paragraph keeps <br> as a newline'
)

assertEqual(
  serialize([el('p', [text('one')]), el('p', [text('two', 3)])]),
  'one\n\ntwo',
  'adjacent paragraphs separated by a blank line'
)

// headings
assertEqual(serialize([el('h1', [text('Title')])]), '# Title', 'h1')
assertEqual(serialize([el('h6', [text('Deep')])]), '###### Deep', 'h6')

// inline formatting
assertEqual(serialize([el('p', [el('strong', [text('b')])])]), '**b**', 'strong')
assertEqual(serialize([el('p', [el('b', [text('b')])])]), '**b**', 'b tag')
assertEqual(serialize([el('p', [el('em', [text('i')])])]), '*i*', 'em')
assertEqual(serialize([el('p', [el('del', [text('d')])])]), '~~d~~', 'del')
assertEqual(serialize([el('p', [el('s', [text('d')])])]), '~~d~~', 's tag')
assertEqual(serialize([el('p', [el('ins', [text('u')])])]), '<ins>u</ins>', 'ins')
assertEqual(serialize([el('p', [el('u', [text('u')])])]), '<ins>u</ins>', 'u tag')
assertEqual(
  serialize([el('p', [el('mark', [text('h')], { class: 'bm-highlight-yellow' })])]),
  '<mark class="bm-highlight-yellow">h</mark>',
  'mark keeps highlight class'
)
assertEqual(
  serialize([el('p', [el('strong', [text('a')]), text(' and ', 1), el('em', [text('b')])])]),
  '**a** and *b*',
  'inline formatting keeps surrounding text'
)

// links, images, code
assertEqual(
  serialize([el('p', [el('a', [text('site')], { href: 'https://example.com' })])]),
  '[site](https://example.com)',
  'link'
)

assertEqual(
  serialize(
    [el('p', [el('img', [], { src: 'file:///tmp/notes/pic.png', alt: 'pic' })])],
    { imageBaseDir: '/tmp/notes' }
  ),
  '![pic](pic.png)',
  'image src is mapped back to the note-relative path'
)

assertEqual(
  serialize([el('p', [el('img', [], { src: 'https://x.dev/a.png', alt: '' })])]),
  '![](https://x.dev/a.png)',
  'remote image src is untouched'
)

assertEqual(serialize([el('p', [el('code', [text('x = 1')])])]), '`x = 1`', 'inline code')

assertEqual(
  serialize([el('pre', [el('code', [text('const a = 1;')], { class: 'language-js' })])]),
  '```js\nconst a = 1;\n```',
  'fenced code block keeps language'
)

assertEqual(serialize([el('hr')]), '---', 'horizontal rule')

// lists
assertEqual(
  serialize([el('ul', [el('li', [text('a')]), el('li', [text('b', 1)])])]),
  '- a\n- b',
  'unordered list'
)

assertEqual(
  serialize([el('ol', [el('li', [text('a')]), el('li', [text('b', 1)])])]),
  '1. a\n2. b',
  'ordered list numbers items'
)

assertEqual(
  serialize([
    el('ul', [
      el('li', [text('x'), el('ul', [el('li', [text('y', 1)])])])
    ])
  ]),
  '- x\n  - y',
  'nested list is indented'
)

assertEqual(
  serialize([
    el('ul', [
      el('li', [el('input', [], { type: 'checkbox' }), text('todo')]),
      el('li', [el('input', [], { type: 'checkbox', checked: 'checked' }), text('done', 4)])
    ])
  ]),
  '- [ ] todo\n- [x] done',
  'task list checkboxes round-trip'
)

// blockquote
assertEqual(
  serialize([el('blockquote', [el('p', [text('quoted')])])]),
  '> quoted',
  'blockquote'
)

// tables
assertEqual(
  serialize([
    el('table', [
      el('thead', [el('tr', [el('th', [text('a')]), el('th', [text('b')])])]),
      el('tbody', [
        el('tr', [el('td', [text('1')]), el('td', [text('2')])]),
        el('tr', [el('td', [text('3')])])
      ])
    ])
  ]),
  '| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 |  |',
  'table rows are padded to the widest row'
)

// escaping
assertEqual(serialize([el('p', [text('a * b')])]), 'a \\* b', 'literal asterisks are escaped')
assertEqual(serialize([el('p', [text('# not a heading')])]), '\\# not a heading', 'leading # is escaped')
assertEqual(serialize([el('p', [text('- not a list')])]), '\\- not a list', 'leading - is escaped')
assertEqual(serialize([el('p', [text('2 > 1')])]), '2 \\> 1', 'greater-than is escaped')

// math
assertEqual(
  serialize([
    el('p', [el('span', [el('span', [text('render')], { class: 'katex' })], {
      class: 'note-math note-math-inline',
      'data-bm-tex': 'x^2'
    })])
  ]),
  '$x^2$',
  'inline math uses the preserved TeX source, not the KaTeX DOM'
)

assertEqual(
  serialize([el('div', [el('span', [text('render')], { class: 'katex' })], {
    class: 'note-math note-math-display',
    'data-bm-tex': 'a + b'
  })]),
  '$$\na + b\n$$',
  'display math uses the preserved TeX source'
)

// DOM range -> markdown range mapping (drives the editable preview toolbar)
const withMap = serializeDescriptorTree([
  el('p', [el('strong', [text('ab')]), text(' cd', 2)])
])
assertEqual(withMap.markdown, '**ab** cd', 'map sample markdown')

const sliceDom = (tree, domStart, domEnd) => {
  const range = markdownRangeForDomRange(tree, domStart, domEnd)
  return tree.markdown.slice(range.start, range.end)
}
assertEqual(sliceDom(withMap, 0, 2), 'ab', 'bold text maps back without its markers')
assertEqual(sliceDom(withMap, 3, 5), 'cd', 'plain text after the wrapper maps back exactly')
assertEqual(sliceDom(withMap, 2, 3), ' ', 'the space between wrapper and text maps back exactly')
assertEqual(markdownRangeForDomRange(withMap, 1, 1).start, 3, 'collapsed caret lands on the text character')
assertEqual(
  markdownRangeForDomRange(withMap, 2, 2).start,
  6,
  'collapsed caret right after a wrapper skips the closing markers'
)

// A marker-free document keeps a 1:1 mapping with the rendered text offsets.
const plain = serializeDescriptorTree([el('p', [text('这是普通文本。')])])
assertEqual(plain.markdown, '这是普通文本。', 'plain paragraph markdown')
assertEqual(sliceDom(plain, 2, 6), '普通文本', 'plain paragraph offsets map 1:1')

// A bold run inside a paragraph, as produced by the preview editor.
const mixed = serializeDescriptorTree([
  el('p', [text('这是'), el('strong', [text('粗体', 2)]), text('与普通文本。', 4)])
])
assertEqual(mixed.markdown, '这是**粗体**与普通文本。', 'mixed paragraph markdown')
assertEqual(
  sliceDom(mixed, 5, 9),
  '普通文本',
  'selection after an inline wrapper does not swallow neighbouring characters'
)
assertEqual(sliceDom(mixed, 2, 4), '粗体', 'selection on already-formatted text excludes its markers')

// Block prefixes are not part of the selectable text.
const heading = serializeDescriptorTree([el('h2', [text('标题')])])
assertEqual(heading.markdown, '## 标题', 'heading markdown')
assertEqual(sliceDom(heading, 0, 2), '标题', 'heading selection starts after the "## " prefix')

console.log(failures ? `\n${failures} test(s) failed.` : '\nAll markdown editor tests passed.')
if (failures) process.exitCode = 1
