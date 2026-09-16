/**
 * Google Docs API — the minimum needed to stamp a quote out of a template.
 *
 * ⚠ THIS BUILDS ON `drive.file`, NOT THE `documents` SCOPE, and that is
 * deliberate. moose@ does hold `documents` (read+write on EVERY Doc in the
 * account, granted in Aug 2026 for a one-off repair and unused by any runtime
 * code since). Verified live on 2026-09-16: a token narrowed to `drive.file`
 * alone authorises both `documents.get` and `documents.batchUpdate` on a Doc
 * the app created.
 *
 * So this feature works if `documents` is ever dropped at a re-consent — and,
 * more to the point, it never becomes the reason to keep the broadest grant in
 * the file.
 */

import {
  PRIMARY_MAILBOX,
  googleFetch,
  googleFetchBytes,
} from './google-workspace'

const DOCS_BASE = 'https://docs.googleapis.com/v1'
const DRIVE_BASE = 'https://www.googleapis.com/drive/v3'

/** Enough of the Docs resource for what the quote pipeline needs. */
interface DocMeta {
  documentId: string
  title: string
  revisionId: string
}

export async function getDocMeta(
  documentId: string,
  mailbox: string = PRIMARY_MAILBOX
): Promise<DocMeta> {
  return googleFetch<DocMeta>(
    `${DOCS_BASE}/documents/${documentId}?fields=documentId,title,revisionId`,
    mailbox
  )
}

/**
 * Replace every `{{TOKEN}}` in a document, in one batch.
 *
 * `replaceAllText` reaches table cells, headers and footers as well as body
 * paragraphs — verified against the real template, where the company phone
 * number lives only in the page footer and was correctly replaced.
 *
 * Matching is case-sensitive: the tokens are ASCII UPPER_SNAKE precisely so a
 * near-miss fails loudly at the guard rather than quietly substituting the
 * wrong thing.
 */
export async function replaceTokensInDoc(
  documentId: string,
  tokens: Record<string, string>,
  mailbox: string = PRIMARY_MAILBOX
): Promise<number> {
  return replaceLiteralsInDoc(
    documentId,
    Object.entries(tokens).map(([name, value]) => [`{{${name}}}`, value]),
    mailbox
  )
}

/**
 * Ordered literal-for-literal replacement — the primitive the token form is
 * built on, and what the template seeder needs, since there the find side is
 * the reference document's own prose rather than a token.
 *
 * ⚠ ORDER MATTERS. Docs applies the requests in sequence, so a pair whose find
 * text contains another pair's find text must come first.
 */
export async function replaceLiteralsInDoc(
  documentId: string,
  pairs: [find: string, replace: string][],
  mailbox: string = PRIMARY_MAILBOX
): Promise<number> {
  if (pairs.length === 0) return 0

  const requests = pairs.map(([find, replace]) => ({
    replaceAllText: {
      containsText: { text: find, matchCase: true },
      replaceText: replace,
    },
  }))

  const res = await googleFetch<{
    replies?: { replaceAllText?: { occurrencesChanged?: number } }[]
  }>(`${DOCS_BASE}/documents/${documentId}:batchUpdate`, mailbox, {
    method: 'POST',
    // googleFetch serializes the body and sets the content type itself.
    body: { requests },
  })

  return (res.replies ?? []).reduce(
    (a, r) => a + (r.replaceAllText?.occurrencesChanged ?? 0),
    0
  )
}

/**
 * The document as plain text.
 *
 * This is what the guards read. Exporting rather than walking the Docs
 * structure matters: the export is what a reader actually sees, including
 * table cells, headers and footers, so a cost figure pasted into a footer
 * cannot hide from the leak check.
 */
export async function getDocPlainText(
  documentId: string,
  mailbox: string = PRIMARY_MAILBOX
): Promise<string> {
  const bytes = await googleFetchBytes(
    `${DRIVE_BASE}/files/${documentId}/export?mimeType=text/plain`,
    mailbox
  )
  return Buffer.from(bytes).toString('utf8')
}

/**
 * The document as PDF bytes — the deliverable.
 *
 * Drive's export caps at 10MB; the reference quote is four pages and ~230KB, so
 * the cap is not a live concern. If a template ever grows past it, the Doc still
 * exists and can be exported by hand.
 */
export async function exportDocAsPdf(
  documentId: string,
  mailbox: string = PRIMARY_MAILBOX
): Promise<Buffer> {
  const bytes = await googleFetchBytes(
    `${DRIVE_BASE}/files/${documentId}/export?mimeType=application/pdf`,
    mailbox
  )
  const buf = Buffer.from(bytes)
  // A Drive error page would arrive as a 200 with HTML in it; refusing here is
  // better than storing something that is not a PDF as though it were one.
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new Error(
      `Export of document ${documentId} did not return a PDF (got ${buf.length} bytes starting "${buf.subarray(0, 20).toString('latin1')}").`
    )
  }
  return buf
}

/**
 * Delete every region of a document between a pair of marker strings,
 * inclusive of the structural elements that contain them.
 *
 * This is what lets ONE template serve both a turnkey quote and a supply-only
 * one. The alternative — a second template — would mean the exclusions, quote
 * terms and inclusions existed in two Docs, edited separately, free to diverge.
 *
 * Verified against the real template (2026-09-16): a single deleteContentRange
 * spanning three tables removed all of them cleanly and left the neighbouring
 * sections untouched.
 *
 * Two things make this work:
 *  - ranges are taken from the START of the element holding the opening marker
 *    to the END of the element holding the closing one, so whole paragraphs,
 *    list items and tables go rather than leaving empty husks behind;
 *  - deletions are applied BACK TO FRONT, because every deletion shifts the
 *    indices of everything after it.
 *
 * Markers are matched anywhere in an element's text, so the template can carry
 * them inline (prefixed to a heading, suffixed to a sentence) — there is no way
 * to insert a standalone marker paragraph with replaceAllText alone.
 */
export async function deleteMarkedSections(
  documentId: string,
  openMarker: string,
  closeMarker: string,
  mailbox: string = PRIMARY_MAILBOX
): Promise<number> {
  const doc = await googleFetch<{
    body?: { content?: DocElement[] }
  }>(`${DOCS_BASE}/documents/${documentId}`, mailbox)

  const elements = doc.body?.content ?? []
  const ranges: { start: number; end: number }[] = []
  let open: DocElement | null = null

  for (const el of elements) {
    const text = elementText(el)
    if (!open && text.includes(openMarker)) open = el
    // Same element can open and close a one-line section, which is why the
    // close is checked in the same pass rather than in an else branch.
    if (open && text.includes(closeMarker)) {
      if (open.startIndex != null && el.endIndex != null) {
        ranges.push({ start: open.startIndex, end: el.endIndex })
      }
      open = null
    }
  }

  if (open) {
    throw new Error(
      `The quote template has an unclosed ${openMarker} section — every one needs a matching ${closeMarker}.`
    )
  }
  if (ranges.length === 0) return 0

  // One request per range rather than one batch, because a batch is atomic and
  // a single rejected range would discard the others — and one of these ranges
  // reliably needs a second attempt (see below).
  for (const r of ranges.sort((a, b) => b.start - a.start)) {
    try {
      await deleteRange(documentId, r.start, r.end, mailbox)
    } catch (err) {
      // ⚠ Docs refuses to delete a range that ends on the newline terminating a
      // LIST ITEM: measured on the real template, the lone bullet promising
      // field installation is rejected at [start, end] while every other range
      // succeeds. Consuming the PRECEDING newline instead removes the bullet
      // cleanly. Trimming the trailing one instead ([start, end-1]) does not —
      // it leaves an empty bullet whose marker swallows the next heading, so
      // "PANEL DELIVERY" renders as a bullet point.
      if (r.start <= 1) throw err
      await deleteRange(documentId, r.start - 1, r.end - 1, mailbox)
    }
  }
  return ranges.length
}

async function deleteRange(
  documentId: string,
  startIndex: number,
  endIndex: number,
  mailbox: string
): Promise<void> {
  await googleFetch(`${DOCS_BASE}/documents/${documentId}:batchUpdate`, mailbox, {
    method: 'POST',
    body: { requests: [{ deleteContentRange: { range: { startIndex, endIndex } } }] },
  })
}

/** Enough of a structural element to locate and measure it. */
interface DocElement {
  startIndex?: number
  endIndex?: number
  paragraph?: { elements?: { textRun?: { content?: string } }[] }
  table?: {
    tableRows?: { tableCells?: { content?: DocElement[] }[] }[]
  }
}

/** All the text inside one structural element, tables included. */
function elementText(el: DocElement): string {
  if (el.paragraph) {
    return (el.paragraph.elements ?? []).map((e) => e.textRun?.content ?? '').join('')
  }
  if (el.table) {
    return (el.table.tableRows ?? [])
      .flatMap((r) => r.tableCells ?? [])
      .flatMap((c) => c.content ?? [])
      .map(elementText)
      .join('')
  }
  return ''
}

/**
 * Delete every TABLE ROW whose text contains a marker.
 *
 * Sections are removed with deleteContentRange, but a row cannot be: a range
 * covering part of a table is not deletable, so Docs provides deleteTableRow
 * for exactly this. Used for the two Payment Summary rows that only mean
 * something when Ber Wilson is installing — the mobilization payment and the
 * remaining progress payments.
 *
 * Rows are removed back to front within each table, because deleting one
 * renumbers those after it.
 */
export async function deleteMarkedTableRows(
  documentId: string,
  marker: string,
  mailbox: string = PRIMARY_MAILBOX
): Promise<number> {
  const doc = await googleFetch<{ body?: { content?: DocElement[] } }>(
    `${DOCS_BASE}/documents/${documentId}`,
    mailbox
  )

  const targets: { tableStart: number; rowIndex: number }[] = []
  for (const el of doc.body?.content ?? []) {
    if (!el.table || el.startIndex == null) continue
    const rows = el.table.tableRows ?? []
    rows.forEach((row, rowIndex) => {
      const text = (row.tableCells ?? [])
        .flatMap((c) => c.content ?? [])
        .map(elementText)
        .join('')
      if (text.includes(marker)) targets.push({ tableStart: el.startIndex!, rowIndex })
    })
  }
  if (targets.length === 0) return 0

  // Descending by row within a table, and by table position, so no index that
  // still has work pending is invalidated by an earlier deletion.
  targets.sort((a, b) => b.tableStart - a.tableStart || b.rowIndex - a.rowIndex)

  for (const t of targets) {
    await googleFetch(`${DOCS_BASE}/documents/${documentId}:batchUpdate`, mailbox, {
      method: 'POST',
      body: {
        requests: [
          {
            deleteTableRow: {
              tableCellLocation: {
                tableStartLocation: { index: t.tableStart },
                rowIndex: t.rowIndex,
                columnIndex: 0,
              },
            },
          },
        ],
      },
    })
  }
  return targets.length
}
