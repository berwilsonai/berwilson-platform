/**
 * Which reader a file gets — and nothing else.
 *
 * Its own import-free module for the same reason `INDEXED_IN_MAIL` has one: a
 * caller that only needs to KNOW a file's kind should not have to pull in the
 * AI pipeline and the Google layer behind it. The health card classifies every
 * skipped document through this, and must stay cheap enough to.
 *
 * ⚠ A TYPE WITH NO BRANCH HERE IS INVISIBLE, NOT UNREADABLE, AND NOTHING
 * REPORTS IT (§12). Measured twice now: .pptx missing left two investor decks
 * with no `documents` row at all, and on 2026-10-21 legacy .doc and .eml left
 * six contract-grade documents holding no text — a Steelton PSA assignment,
 * three assignment agreements, the Vistra data-centre base contract and two
 * saved West Wendover threads. When adding a kind, add it to the extract switch
 * in document-pipeline.ts and to document-kinds.test.ts in the same change.
 */

export const PDF_MIME_TYPE = 'application/pdf'
export const DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export const XLSX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const PPTX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
/** Legacy Word, pre-2007 binary .doc — mammoth reads .docx only. */
export const DOC_MIME_TYPE = 'application/msword'
/** A saved email, as Gmail and Outlook both export one. */
export const EML_MIME_TYPES = new Set(['message/rfc822', 'application/vnd.ms-outlook'])
export const TEXT_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
])

/** Types Apple Vision can recognize text in (see card-ocr.ts). */
export const IMAGE_MIME_PREFIX = 'image/'

export type DocumentKind =
  | 'pdf'
  | 'docx'
  | 'doc'
  | 'xlsx'
  | 'pptx'
  | 'eml'
  | 'image'
  | 'text'
  | 'unsupported'



export function documentKind(
  mimeType: string | null | undefined,
  fileName?: string | null
): DocumentKind {
  const mime = mimeType ?? ''
  if (mime === PDF_MIME_TYPE) return 'pdf'
  if (mime === DOCX_MIME_TYPE) return 'docx'
  if (mime === XLSX_MIME_TYPE) return 'xlsx'
  if (mime === PPTX_MIME_TYPE) return 'pptx'
  if (mime === DOC_MIME_TYPE) return 'doc'
  if (EML_MIME_TYPES.has(mime)) return 'eml'
  if (TEXT_MIME_TYPES.has(mime)) return 'text'
  if (mime.startsWith(IMAGE_MIME_PREFIX)) return 'image'
  // Fall back on the extension — browsers/Graph sometimes send octet-stream.
  const name = (fileName ?? '').toLowerCase()
  if (name.endsWith('.pdf')) return 'pdf'
  if (name.endsWith('.docx')) return 'docx'
  // ⚠ AFTER .docx, always: '.docx'.endsWith('.doc') is false, but the pair is
  // one rename away from the substring trap §12 names, and the ordering is the
  // thing a reader has to be able to see.
  if (name.endsWith('.doc')) return 'doc'
  if (/\.(xlsx|xlsm)$/.test(name)) return 'xlsx'
  if (name.endsWith('.pptx')) return 'pptx'
  if (/\.(eml|msg)$/.test(name)) return 'eml'
  if (/\.(txt|md|markdown|csv|html)$/.test(name)) return 'text'
  if (/\.(jpg|jpeg|png|heic|heif|webp|tif|tiff|gif|bmp)$/.test(name)) return 'image'
  return 'unsupported'
}
