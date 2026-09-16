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
