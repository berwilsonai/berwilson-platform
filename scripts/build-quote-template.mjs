/**
 * Rebuild the checked-in prefab steel quote template from a source .docx.
 *
 *   node scripts/build-quote-template.mjs ~/Downloads/Mira-Vista-Prefab-Steel-Quote-TBQ.docx
 *
 * All this does is insert a hairline empty paragraph between every pair of
 * ADJACENT tables, then rezip.
 *
 * ⚠ WHY THAT ONE EDIT MATTERS. Google Drive MERGES two tables that touch with
 * no paragraph between them. The reference quote has 14 tables and 6 such
 * adjacencies, so converting it straight over produced a document with 8 tables:
 * each coloured callout was absorbed as an extra ROW of the table above it and
 * inherited that table's narrow first column (115pt instead of 523pt). SCHEDULE
 * BASIS, OWNER-CREW INSTALLATION and BER WILSON INSTALLATION all collapsed into
 * a column a third of the page wide, and the document ran to 5 pages with a
 * near-blank page 3.
 *
 * With the spacers: 14/14 tables preserved, every callout full width, 4 pages,
 * visually indistinguishable from the Word original.
 *
 * The {{TOKENS}} are NOT inserted here. They are applied to the Google Doc after
 * conversion, by seedQuoteTemplate() in src/lib/steel/quote-template.ts, because
 * Word splits a phrase across several <w:r> runs — "44,400 SF" is rarely one
 * string in the XML — and the Docs API's replaceAllText sees the rendered text
 * instead, so it matches reliably where an XML search-and-replace would not.
 */

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import os from 'node:os'

const OUT = path.join(process.cwd(), 'assets', 'steel-quote-template.docx')

// 1pt, no spacing above or below: enough to stop the merge, invisible on paper.
const SPACER =
  '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>' +
  '<w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr></w:pPr></w:p>'

const src = process.argv[2]
if (!src) {
  console.error('usage: node scripts/build-quote-template.mjs <source.docx>')
  process.exit(1)
}
if (!fs.existsSync(src)) {
  console.error(`not found: ${src}`)
  process.exit(1)
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-tpl-'))
try {
  execFileSync('unzip', ['-q', '-o', src, '-d', tmp])

  const docXml = path.join(tmp, 'word', 'document.xml')
  const before = fs.readFileSync(docXml, 'utf8')
  const tables = (before.match(/<w:tbl>/g) || []).length
  // Counted on the INPUT. Counting the output would also match tables that
  // already had a paragraph after them and over-report what was done.
  const inserted = (before.match(/<\/w:tbl>\s*<w:tbl>/g) || []).length
  const after = before.replace(/<\/w:tbl>\s*<w:tbl>/g, `</w:tbl>${SPACER}<w:tbl>`)

  if (/<\/w:tbl>\s*<w:tbl>/.test(after)) {
    console.error('adjacent tables still present after patching — aborting')
    process.exit(1)
  }
  fs.writeFileSync(docXml, after)

  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  if (fs.existsSync(OUT)) fs.rmSync(OUT)
  execFileSync('zip', ['-q', '-r', '-X', OUT, '.'], { cwd: tmp })

  console.log(`source tables:      ${tables}`)
  console.log(`spacers inserted:   ${inserted}`)
  console.log(`wrote:              ${OUT} (${fs.statSync(OUT).size} bytes)`)
  console.log('\nNext: seed it into Drive with POST /api/steel/quote-template/seed (admin).')
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
