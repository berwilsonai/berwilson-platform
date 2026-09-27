import { callGeminiWithFile } from '@/lib/ai/gemini'
import { isLocalAI, extractPdfText, LOCAL_PDF_TEXT_MAX_CHARS } from '@/lib/ai/local'
import type { createAdminClient } from '@/lib/supabase/admin'

// Shared full-text extraction for uploaded PDFs. The 2-3 sentence AI summary
// stays (card display), but search quality comes from embedding the complete
// document text.
//
// The size ceiling is PER PATH, because the two paths are limited by different
// things. Gemini receives the whole file base64-inlined in the request, so it
// caps out around 15MB. Local mode makes no request at all — `unpdf` reads the
// buffer in process — so the only real constraint is memory, and applying the
// API's ceiling there silently cost real documents: a 20.5MB technical report
// holding 50,000 characters of readable text was stored with a summary and no
// text, which is the difference between Ber AI quoting a report and merely
// knowing it exists.
export const PDF_FULLTEXT_MAX_BYTES = 15 * 1024 * 1024
export const PDF_FULLTEXT_MAX_BYTES_LOCAL = 100 * 1024 * 1024

// Postgres text/jsonb rejects NUL bytes ("unsupported Unicode escape
// sequence") and lone surrogates — PDFs with embedded fonts produce both.
function sanitizeExtractedText(text: string): string {
  return text.replace(/\u0000/g, '').replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
}

const FULLTEXT_SYSTEM = `You are a document transcriber for a construction executive intelligence platform.
Extract the COMPLETE text content of this document as clean markdown.
Preserve headings, lists, tables (as markdown tables), dollar figures, dates, names, and section numbering exactly as written.
Do not summarize, skip sections, or add commentary. Output ONLY the extracted text.`

/**
 * Transcribe a PDF's full text. Returns null on failure or when the file is
 * beyond the active path's ceiling — callers fall back to embedding the
 * summary, exactly as before.
 *
 * In local mode this is two attempts, not one: the embedded text layer first,
 * then Apple Vision OCR over rendered pages when there is no text layer. **30 of
 * 315 live PDFs were in exactly that state** — scanned leases, plat maps, title
 * commitments and assay letters, stored with a file and no text, invisible to
 * Ber AI. The lease that prompted this read in 3 seconds and held the acreage
 * the agent had been asked for three times.
 */
export async function transcribePdfText(input: {
  dataBase64: string
  byteLength: number
  fileName: string
  userId: string
}): Promise<string | null> {
  // Local mode: extract the text directly — no model pass needed for a
  // verbatim transcription, and nothing leaves the machine.
  if (isLocalAI()) {
    if (input.byteLength > PDF_FULLTEXT_MAX_BYTES_LOCAL) return null
    const raw = await extractPdfText(input.dataBase64)
    const text = raw ? sanitizeExtractedText(raw) : null
    if (text && text.length >= 40) return text

    // No text layer — the PDF is a scan. Render and recognize it.
    //
    // A transient failure (OcrFailedError: killed, out of memory, timed out) is
    // deliberately allowed to PROPAGATE, so the caller records the document as
    // an error to retry rather than as permanently unreadable. Only a missing
    // binary is swallowed, because that is a host setup problem which would
    // otherwise fail every document in a backfill one at a time.
    const { ocrDocument, OcrFailedError } = await import('@/lib/ai/card-ocr')
    try {
      const ocr = await ocrDocument(Buffer.from(input.dataBase64, 'base64'), input.fileName)
      if (!ocr) return null
      const cleaned = sanitizeExtractedText(ocr)
      return cleaned.length >= 40 ? cleaned.slice(0, LOCAL_PDF_TEXT_MAX_CHARS) : null
    } catch (err) {
      if (err instanceof OcrFailedError) throw err
      console.error('[document-text] OCR unavailable:', err instanceof Error ? err.message : err)
      return null
    }
  }

  if (input.byteLength > PDF_FULLTEXT_MAX_BYTES) return null

  try {
    const result = await callGeminiWithFile<string>({
      systemPrompt: FULLTEXT_SYSTEM,
      prompt: 'Extract the full text of this document.',
      file: { mimeType: 'application/pdf', dataBase64: input.dataBase64 },
      userId: input.userId,
      logLabel: `Document full text: ${input.fileName}`,
      promptVersion: 'doc-fulltext-1.0',
      jsonMode: false,
      maxTokens: 60000,
    })
    const text = typeof result.data === 'string' ? sanitizeExtractedText(result.data.trim()) : ''
    return text.length >= 40 ? text : null
  } catch (err) {
    console.error('[document-text] full-text extraction failed:', err)
    return null
  }
}

/**
 * Extract the text of a .docx file (Word). Returns null on failure or when
 * the document has no meaningful text — callers mark the doc unindexable.
 */
export async function extractDocxText(buffer: ArrayBuffer): Promise<string | null> {
  try {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) })
    const text = sanitizeExtractedText(result.value?.trim() ?? '')
    return text.length >= 40 ? text : null
  } catch (err) {
    console.error('[document-text] docx extraction failed:', err)
    return null
  }
}

/**
 * Extract the text of an .xlsx workbook as markdown tables, one per sheet.
 *
 * Added because the one spreadsheet on the Alaska project — `Full Claim List.xlsx`,
 * holding the claim numbers and acreage — was the single document that answered
 * "where is this land and how big is it", and the platform could not open it:
 * `documentKind` returned 'unsupported', so no text was stored and Ber AI could
 * only see that a file by that name existed. A schedule of claims, a rent roll
 * or a bid tab is exactly the kind of evidence this platform is for.
 *
 * An .xlsx is a zip of XML. `fflate` inflates it (no dependency of its own), and
 * the sheet XML is read directly rather than through a spreadsheet library:
 * cells, their shared-string references and their inline values, in row order.
 * Formulas are skipped in favour of their cached values, which is what the
 * workbook's reader would see.
 */
export async function extractXlsxText(buffer: ArrayBuffer): Promise<string | null> {
  try {
    const { unzipSync } = await import('fflate')
    const files = unzipSync(new Uint8Array(buffer))
    const decode = (name: string): string | null => {
      const bytes = files[name]
      return bytes ? new TextDecoder().decode(bytes) : null
    }

    // Shared strings: most cell text lives here, referenced by index (t="s").
    const shared: string[] = []
    const sharedXml = decode('xl/sharedStrings.xml')
    if (sharedXml) {
      for (const si of sharedXml.match(/<si\b[\s\S]*?<\/si>/g) ?? []) {
        // An <si> can hold several <t> runs (rich text) — concatenate them.
        const runs = si.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) ?? []
        shared.push(runs.map((r) => unescapeXml(r.replace(/<[^>]+>/g, ''))).join(''))
      }
    }

    // Sheet names in workbook order, so a table is labelled the way the reader
    // sees it rather than as "sheet1.xml".
    const names: string[] = []
    const workbookXml = decode('xl/workbook.xml')
    if (workbookXml) {
      for (const m of workbookXml.matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)) {
        names.push(unescapeXml(m[1]))
      }
    }

    const sheetPaths = Object.keys(files)
      .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
      .sort((a, b) => sheetNumber(a) - sheetNumber(b))

    const parts: string[] = []
    for (const [i, path] of sheetPaths.entries()) {
      const xml = decode(path)
      if (!xml) continue
      const rows = sheetRows(xml, shared)
      if (rows.length === 0) continue

      // State the row count rather than leaving the reader to count.
      // Measured: asked how many claims the Alaska schedule holds, the local
      // model read all 69 rows and reported 62, with its per-township split
      // wrong too. Counting rows of a long table is the one thing a language
      // model is worst at and a line of code is exact at, and the count is the
      // figure an executive repeats. The header row is named as such so the
      // total is unambiguous.
      const body = rows.length > 1 ? rows.length - 1 : rows.length
      const header = rows.length > 1 ? ' (first row is the header)' : ''
      parts.push(
        `## Sheet: ${names[i] ?? `Sheet ${i + 1}`}\n` +
          `${body} data row${body === 1 ? '' : 's'}${header}. This table is complete — use this count rather than counting the rows below.\n\n` +
          rows.map((r) => `| ${r.join(' | ')} |`).join('\n')
      )
    }

    const text = sanitizeExtractedText(parts.join('\n\n').trim())
    return text.length >= 40 ? text : null
  } catch (err) {
    console.error('[document-text] xlsx extraction failed:', err)
    return null
  }
}

function sheetNumber(path: string): number {
  return Number(path.match(/sheet(\d+)\.xml$/)?.[1] ?? 0)
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
}

/**
 * Cell values in row order, padded so a column lines up across rows.
 *
 * The column letter in each cell's r="C12" reference is what places it: a blank
 * cell is simply absent from the XML, so reading cells in sequence without it
 * shifts every value after a gap one column left — which silently mis-pairs a
 * claim number with the wrong acreage.
 */
function sheetRows(xml: string, shared: string[]): string[][] {
  const rows: string[][] = []
  for (const rowXml of xml.match(/<row\b[\s\S]*?(?:<\/row>|\/>)/g) ?? []) {
    const cells: string[] = []
    for (const cellXml of rowXml.match(/<c\b[\s\S]*?(?:<\/c>|\/>)/g) ?? []) {
      const ref = cellXml.match(/\br="([A-Z]+)\d+"/)?.[1]
      if (ref) {
        const col = columnIndex(ref)
        while (cells.length < col) cells.push('')
      }
      cells.push(cellValue(cellXml, shared))
    }
    while (cells.length && cells[cells.length - 1] === '') cells.pop()
    if (cells.some((c) => c !== '')) rows.push(cells)
  }
  return rows
}

/** "A" → 0, "B" → 1, "AA" → 26. */
function columnIndex(letters: string): number {
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

function cellValue(cellXml: string, shared: string[]): string {
  const type = cellXml.match(/\bt="([^"]*)"/)?.[1]

  // Inline string: the text sits in <is><t>…</t></is> rather than in <v>.
  if (type === 'inlineStr') {
    const runs = cellXml.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) ?? []
    return runs.map((r) => unescapeXml(r.replace(/<[^>]+>/g, ''))).join('')
  }

  const raw = cellXml.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1]
  if (raw === undefined) return ''
  const value = unescapeXml(raw)

  if (type === 's') {
    const idx = Number(value)
    return Number.isInteger(idx) && idx >= 0 && idx < shared.length ? shared[idx] : ''
  }
  return value
}

/**
 * Extract the text of an image (a photographed page, a screenshot, a map with
 * labels) through Apple Vision. Returns null when nothing legible was found —
 * for a photograph that is a fact about the file, not a failure to retry.
 */
export async function extractImageText(
  buffer: ArrayBuffer,
  fileName: string
): Promise<string | null> {
  if (!isLocalAI()) return null
  const { ocrDocument, OcrFailedError } = await import('@/lib/ai/card-ocr')
  try {
    const ocr = await ocrDocument(buffer, fileName)
    if (!ocr) return null
    const text = sanitizeExtractedText(ocr)
    return text.length >= 40 ? text : null
  } catch (err) {
    if (err instanceof OcrFailedError) throw err
    console.error('[document-text] OCR unavailable:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Persist extracted text onto a document row. Tolerant of the migration
 * window: if the extracted_text column doesn't exist yet (20260703000001 not
 * applied), the write is skipped silently — the text is still embedded.
 */
export async function storeExtractedText(
  supabase: ReturnType<typeof createAdminClient>,
  table: 'documents' | 'opportunity_documents',
  id: string,
  text: string
): Promise<void> {
  const { error } = await supabase.from(table).update({ extracted_text: text }).eq('id', id)
  if (error && !(error.code === 'PGRST204' || /extracted_text/i.test(error.message))) {
    console.error(`[document-text] failed to store extracted_text on ${table}:`, error.message)
  }
}
