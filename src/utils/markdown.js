import { marked } from 'marked';
import DOMPurify from 'dompurify';
import katex from 'katex';
import 'katex/dist/katex.min.css';

// Configure marked options
marked.use({
  gfm: true,
  breaks: true,
});

const MATH_TOKEN_PREFIX = '@@BM_MATH_';
const CODE_TOKEN_PREFIX = '@@BM_CODE_';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderMath(tex, displayMode = false) {
  const html = katex.renderToString(tex, {
    displayMode,
    throwOnError: false,
    output: 'html'
  });
  const className = displayMode ? 'note-math note-math-display' : 'note-math note-math-inline';
  // `data-bm-tex` keeps the original TeX reachable for the editable preview,
  // which serializes the rendered DOM back to Markdown.
  const sourceAttr = ` data-bm-tex="${escapeAttribute(tex.trim())}"`;
  return displayMode
    ? `<div class="${className}"${sourceAttr}>${html}</div>`
    : `<span class="${className}"${sourceAttr}>${html}</span>`;
}

function extractCodeTokens(content) {
  const tokens = [];
  const processed = content.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`/g, (code) => {
    const token = `${CODE_TOKEN_PREFIX}${tokens.length}@@`;
    tokens.push({ token, code });
    return token;
  });

  return { processed, tokens };
}

function restoreCodeTokens(content, tokens) {
  return tokens.reduce((output, { token, code }) => {
    return output.replace(new RegExp(escapeRegExp(token), 'g'), code);
  }, content);
}

function extractMathTokens(content) {
  const tokens = [];
  const stash = (tex, displayMode) => {
    const token = `${MATH_TOKEN_PREFIX}${tokens.length}@@`;
    tokens.push({
      token,
      displayMode,
      html: renderMath(tex.trim(), displayMode)
    });
    return token;
  };

  const codeResult = extractCodeTokens(content);

  let processed = codeResult.processed.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => {
    return `\n\n${stash(tex, true)}\n\n`;
  });

  processed = processed.replace(/\\\[([\s\S]+?)\\\]/g, (_, tex) => {
    return `\n\n${stash(tex, true)}\n\n`;
  });

  processed = processed.replace(/\\\(([^\n]+?)\\\)/g, (_, tex) => {
    return stash(tex, false);
  });

  processed = processed.replace(/(^|[^\\$])\$([^\n$]+?)\$/g, (match, prefix, tex) => {
    return `${prefix}${stash(tex, false)}`;
  });

  processed = restoreCodeTokens(processed, codeResult.tokens);

  return { processed, tokens };
}

function restoreMathTokens(html, tokens) {
  return tokens.reduce((output, { token, displayMode, html: mathHtml }) => {
    const tokenPattern = escapeRegExp(token);
    let nextOutput = output;
    if (displayMode) {
      nextOutput = nextOutput.replace(new RegExp(`<p>\\s*${tokenPattern}\\s*</p>`, 'g'), mathHtml);
    }
    return nextOutput.replace(new RegExp(tokenPattern, 'g'), mathHtml);
  }, html);
}

/**
 * Render markdown content to sanitized HTML
 * @param {string} content - Markdown content to render
 * @param {string} baseDir - Base directory for resolving local image paths
 * @returns {string} Sanitized HTML string
 */
export function renderMarkdown(content, baseDir = '') {
  if (!content || typeof content !== 'string') {
    return '';
  }

  try {
    // First, handle image paths manually before parsing
    let processedContent = content;

    // Convert local image paths to file:// URLs
    // Match ![](path) or ![alt](path)
    processedContent = processedContent.replace(
      /!\[([^\]]*)\]\(([^)]+)\)/g,
      (match, alt, src) => {
        // Skip if already absolute URL
        if (src.match(/^https?:\/\//i) || src.match(/^data:/i) || src.match(/^file:\/\//i)) {
          return match;
        }
        // Convert to file:// URL. baseDir often contains spaces
        // (e.g. "Application Support"), which would terminate the Markdown
        // link destination and leave the image syntax as plain text.
        const cleanSrc = src.replace(/^\.?\//, '');
        const fileUrl = encodeURI(`file://${baseDir ? baseDir + '/' : ''}${cleanSrc}`);
        return `![${alt}](${fileUrl})`;
      }
    );

    // Render markdown to HTML
    const { processed, tokens } = extractMathTokens(processedContent);
    const rawHtml = marked.parse(processed);

    // Sanitize HTML output
    const cleanHtml = DOMPurify.sanitize(rawHtml, {
      ALLOWED_TAGS: [
        'p', 'br', 'hr',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'blockquote', 'pre', 'code',
        'ul', 'ol', 'li',
        'strong', 'em', 'del', 's', 'ins', 'mark',
        'a', 'img',
        'input',
        'table', 'thead', 'tbody', 'tr', 'th', 'td',
        'div', 'span', 'sup', 'sub'
      ],
      ALLOWED_ATTR: [
        'href', 'title', 'target', 'rel',
        'src', 'alt', 'width', 'height',
        'class', 'id',
        'align', 'colspan', 'rowspan',
        'type', 'checked', 'disabled',
        'aria-hidden'
      ],
      ALLOW_DATA_ATTR: false,
      // Local notes serve images from file:// URLs under the app data dir.
      ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|file):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i
    });

    return restoreMathTokens(cleanHtml, tokens);
  } catch (error) {
    console.error('[renderMarkdown] Error:', error);
    // Fallback: return content with HTML entities escaped
    return content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}

/**
 * Extract plain text preview from markdown content
 * @param {string} content - Markdown content
 * @param {number} maxLength - Maximum length of preview text
 * @returns {string} Plain text preview
 */
export function extractPreview(content, maxLength = 100) {
  if (!content || typeof content !== 'string') {
    return '';
  }

  // Remove code blocks
  let text = content.replace(/```[\s\S]*?```/g, '');
  text = text.replace(/`[^`]*`/g, '');

  // Remove images
  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '');

  // Remove links but keep text
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  text = text.replace(/<[^>]+>/g, '');

  // Remove HTML tags
  text = text.replace(/<[^>]*>/g, '');

  // Remove heading markers
  text = text.replace(/^#{1,6}\s+/gm, '');

  // Remove list markers
  text = text.replace(/^[-*+]\s+/gm, '');
  text = text.replace(/^\d+\.\s+/gm, '');

  // Remove blockquote markers
  text = text.replace(/^>\s*/gm, '');

  // Remove emphasis markers
  text = text.replace(/(\*{1,2}|_{1,2})([^*_]+)\1/g, '$2');
  text = text.replace(/~~([^~]+)~~/g, '$1');

  // Normalize whitespace
  text = text.replace(/\s+/g, ' ').trim();

  // Truncate if necessary
  if (text.length > maxLength) {
    text = text.substring(0, maxLength).trim() + '...';
  }

  return text;
}

/**
 * Count non-whitespace characters in content
 * @param {string} content - Text content to count
 * @returns {number} Count of non-whitespace characters
 */
export function countChars(content) {
  if (!content || typeof content !== 'string') {
    return 0;
  }

  // Remove all whitespace characters and count remaining characters
  return content.replace(/\s/g, '').length;
}

export default {
  renderMarkdown,
  extractPreview,
  countChars
};
