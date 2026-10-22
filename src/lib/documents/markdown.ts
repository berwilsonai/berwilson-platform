/**
 * The small slice of Markdown a composed document needs, as HTML Drive can
 * convert into a real Google Doc.
 *
 * ⚠ WRITTEN RATHER THAN DEPENDED ON, AND THAT IS THE CHEAPER CHOICE HERE. The
 * platform has no Markdown library (checked: only fflate, mammoth and unpdf
 * touch document formats) and CLAUDE.md's golden rule is to add no complexity
 * without demonstrated need. The need is six block types. A renderer also has
 * to be the thing that ESCAPES, and model output is untrusted text: a library
 * chosen for its feature set would still have to be configured not to pass raw
 * HTML through, so writing it is both smaller and safer.
 *
 * ⚠ ESCAPE FIRST, THEN MARK UP. The order is the whole security property. The
 * model's prose is escaped before any tag is introduced, so a document that
 * happens to contain `<script>` or `<b>` renders those characters as text and
 * cannot inject markup into the Doc.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Inline marks, applied to ALREADY-ESCAPED text.
 *
 * Bold before italic, because `**` would otherwise be eaten as two italics.
 * Both patterns require a non-space first character so a lone asterisk in
 * prose — a footnote marker, a multiplication sign — is left alone.
 */
function inline(escaped: string): string {
  return escaped
    .replace(/\*\*(\S(?:[^*]*\S)?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(\S(?:[^*]*\S)?)\*/g, '$1<em>$2</em>')
}

/** The document title, taken from the first `# ` heading if there is one. */
export function titleFromMarkdown(markdown: string): string | null {
  for (const line of markdown.split('\n')) {
    const m = /^#\s+(.+?)\s*$/.exec(line)
    if (m) return m[1].trim() || null
  }
  return null
}

/** Everything except the leading `# ` title line, which becomes the Doc's name. */
export function bodyWithoutTitle(markdown: string): string {
  const lines = markdown.split('\n')
  const idx = lines.findIndex((l) => /^#\s+.+/.test(l))
  if (idx === -1) return markdown
  return [...lines.slice(0, idx), ...lines.slice(idx + 1)].join('\n').replace(/^\n+/, '')
}

/**
 * Markdown → a complete HTML document for Drive's converter.
 *
 * `title` is rendered as the `<h1>` and also set as the HTML title, because
 * Drive names the converted Doc from the upload metadata and a mismatch between
 * the file name and the heading is the kind of small wrongness that makes a
 * document look machine-made.
 */
export function markdownToHtml(markdown: string, title: string): string {
  const out: string[] = []
  let list: 'ul' | 'ol' | null = null

  const closeList = () => {
    if (list) {
      out.push(`</${list}>`)
      list = null
    }
  }

  for (const raw of markdown.split('\n')) {
    const line = raw.replace(/\s+$/, '')

    if (!line.trim()) {
      closeList()
      continue
    }

    if (/^(---+|\*\*\*+|___+)$/.test(line.trim())) {
      closeList()
      out.push('<hr />')
      continue
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading) {
      closeList()
      // The title is already the h1, so a `#` inside the body steps down one
      // level rather than producing a second document heading.
      const level = Math.min(heading[1].length + 1, 6)
      out.push(`<h${level}>${inline(escapeHtml(heading[2].trim()))}</h${level}>`)
      continue
    }

    const bullet = /^[-*+]\s+(.+)$/.exec(line.trim())
    if (bullet) {
      if (list !== 'ul') {
        closeList()
        out.push('<ul>')
        list = 'ul'
      }
      out.push(`<li>${inline(escapeHtml(bullet[1].trim()))}</li>`)
      continue
    }

    const numbered = /^\d+[.)]\s+(.+)$/.exec(line.trim())
    if (numbered) {
      if (list !== 'ol') {
        closeList()
        out.push('<ol>')
        list = 'ol'
      }
      out.push(`<li>${inline(escapeHtml(numbered[1].trim()))}</li>`)
      continue
    }

    closeList()
    out.push(`<p>${inline(escapeHtml(line.trim()))}</p>`)
  }
  closeList()

  return [
    '<!DOCTYPE html>',
    '<html><head><meta charset="utf-8" />',
    `<title>${escapeHtml(title)}</title>`,
    '</head><body>',
    `<h1>${escapeHtml(title)}</h1>`,
    out.join('\n'),
    '</body></html>',
  ].join('\n')
}

/**
 * Markdown → plain text, for `extracted_text` on the filed row.
 *
 * The stored text is what Ber AI would later read, so it holds the words and
 * drops the syntax — a retrieval hit on `**` helps nobody.
 */
export function markdownToPlainText(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) =>
      line
        .replace(/^#{1,6}\s+/, '')
        .replace(/^[-*+]\s+/, '• ')
        .replace(/\*\*(\S(?:[^*]*\S)?)\*\*/g, '$1')
        .replace(/(^|[^*])\*(\S(?:[^*]*\S)?)\*/g, '$1$2')
        .replace(/^(---+|\*\*\*+|___+)$/, '')
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
