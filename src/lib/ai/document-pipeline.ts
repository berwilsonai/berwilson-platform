import { callGemini, callGeminiWithFile, UnreadableDocumentError } from '@/lib/ai/gemini'
import { transcribePdfText, extractDocxText, extractXlsxText, extractPptxText, extractImageText, storeExtractedText } from '@/lib/ai/document-text'
import { isLocalAI } from '@/lib/ai/local'
import { embedDocument, embedOpportunityDocument } from '@/lib/ai/embeddings'
import type { createAdminClient } from '@/lib/supabase/admin'
import { SYSTEM_USER_ID } from '@/lib/system-user'
// Declared in its own import-free module so a reader of the STATUS does not
// have to import this whole pipeline (and the Google layer behind it).
import { INDEXED_IN_MAIL } from '@/lib/documents/status'
export { INDEXED_IN_MAIL }

// Shared AI pass for rows in the `documents` table: summary + full-text
// extraction + embedding, with an honest embedding_status at the end —
// 'complete', 'error', 'skipped' (file type we can't read), or
// 'indexed_in_mail' (the text is searchable through its email thread instead).
// Used by both document-upload routes and the reindex route, so a doc can
// always be re-run from storage instead of re-uploaded.

type AdminClient = ReturnType<typeof createAdminClient>


const DOC_SUMMARY_SYSTEM = `You are a document analyst for a construction executive intelligence platform.
Summarize the key points of this document in 2-3 sentences. Focus on: parties involved, key obligations or dates, dollar amounts, and critical terms relevant to construction executives.
Return ONLY valid JSON: {"summary": "...", "confidence": 0.0}
confidence is 0.0–1.0 reflecting how clearly this document presents extractable construction intelligence.
Return ONLY valid JSON. No explanation. No markdown.`

export const PDF_MIME_TYPE = 'application/pdf'
export const DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export const XLSX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const PPTX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
export const TEXT_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
])

/** Types Apple Vision can recognize text in (see card-ocr.ts). */
export const IMAGE_MIME_PREFIX = 'image/'

export type DocumentKind = 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'image' | 'text' | 'unsupported'

/** Internal control-flow marker for `skipSummary` — never surfaces to a caller. */
class SkipSummary extends Error {}

export function documentKind(
  mimeType: string | null | undefined,
  fileName?: string | null
): DocumentKind {
  const mime = mimeType ?? ''
  if (mime === PDF_MIME_TYPE) return 'pdf'
  if (mime === DOCX_MIME_TYPE) return 'docx'
  if (mime === XLSX_MIME_TYPE) return 'xlsx'
  if (mime === PPTX_MIME_TYPE) return 'pptx'
  if (TEXT_MIME_TYPES.has(mime)) return 'text'
  if (mime.startsWith(IMAGE_MIME_PREFIX)) return 'image'
  // Fall back on the extension — browsers/Graph sometimes send octet-stream.
  const name = (fileName ?? '').toLowerCase()
  if (name.endsWith('.pdf')) return 'pdf'
  if (name.endsWith('.docx')) return 'docx'
  if (/\.(xlsx|xlsm)$/.test(name)) return 'xlsx'
  if (name.endsWith('.pptx')) return 'pptx'
  if (/\.(txt|md|markdown|csv|html)$/.test(name)) return 'text'
  if (/\.(jpg|jpeg|png|heic|heif|webp|tif|tiff|gif|bmp)$/.test(name)) return 'image'
  return 'unsupported'
}

type DocSummary = { summary?: string; confidence?: number } | string

export interface AiPassResult {
  status: 'complete' | 'error' | 'skipped' | 'indexed_in_mail'
  aiSummary: string | null
  confidence: number | null
}

/**
 * Which document table this pass is writing to.
 *
 * `opportunity_documents` mirrors `documents` closely but has no
 * embedding_status and no confidence column, and embeds through a different
 * function. Those three differences are the ONLY ones — and expressing them as
 * a parameter is the point: email intake used to carry its own hand-rolled copy
 * of this pass for opportunity attachments, which meant the 2026-09-09 fix (a
 * failed summary must not discard the extracted text) landed in one copy and
 * not the other. That second copy silently threw away 413,000 characters of
 * real text on the first opportunity it was pointed at. One pass, two targets.
 */
export type DocumentTarget =
  | { table: 'documents' }
  | { table: 'opportunity_documents'; opportunityId: string }

const DEFAULT_TARGET: DocumentTarget = { table: 'documents' }

async function setStatus(
  supabase: AdminClient,
  target: DocumentTarget,
  documentId: string,
  status: string
) {
  // Both tables carry embedding_status since the Drive-filing migration
  // (20260921000001). Before it, opportunity_documents had no such column and
  // this returned early — which meant an opportunity document could never be
  // seen as stranded and so was never retried.
  if (target.table === 'documents') {
    await supabase.from('documents').update({ embedding_status: status }).eq('id', documentId)
  } else {
    await supabase.from('opportunity_documents').update({ embedding_status: status }).eq('id', documentId)
  }
}

/**
 * Is this document's AI pass unfinished, and therefore worth running again?
 *
 * The settled states are 'complete', 'skipped' and 'indexed_in_mail' — the
 * document is searchable, unreadable, or searchable through its thread.
 * Everything else — 'error', 'processing', 'pending', or a row that predates the
 * column — means the pass never reached an end, and the document has a file but
 * no text and no chunks: invisible to the search it was imported for, while
 * change detection correctly reports its bytes as unchanged and never comes
 * back for it.
 *
 * ⚠ 'indexed_in_mail' was added 2026-10-15 and had to be added HERE in the same
 * change. Left out, the Drive sync would read every mail-indexed document as
 * stranded and re-run a ~48s model pass on it on every nightly run, forever,
 * reporting success each time.
 *
 * Lives here, next to the statuses it interprets, because every sync that
 * imports documents needs the same answer and one of them not having it is how
 * sixteen company documents sat unreadable indefinitely.
 */
export function needsAnotherPass(status: string | null | undefined): boolean {
  return status !== 'complete' && status !== 'skipped' && status !== INDEXED_IN_MAIL
}

/**
 * Run the full AI pass on one document and settle its embedding_status.
 *
 * Never throws. The end state distinguishes four things that look alike from
 * the outside: 'complete', 'error' (worth retrying), 'skipped' (nothing here can
 * read this file, so retrying is waste), and 'indexed_in_mail' (searchable, but
 * through its email thread rather than through chunks of its own).
 */
export async function runDocumentAiPass(input: {
  supabase: AdminClient
  documentId: string
  projectId: string | null
  entityId?: string | null
  isCompany?: boolean
  fileName: string
  mimeType: string | null
  buffer: ArrayBuffer
  /** Defaults to the `documents` table. */
  target?: DocumentTarget
  /**
   * Override the summarizer's framing. Same argument as `target`: opportunity
   * attachments are CIMs, teasers and term sheets, where the useful summary
   * leads with valuation and deal terms rather than scope and schedule. A
   * parameter cannot drift out of sync the way the second copy of this pass
   * did.
   */
  summaryPrompt?: string
  promptVersion?: string
  /**
   * Skip the AI summary and only extract + embed the text.
   *
   * For the OCR backfill on this box. Extraction is Apple Vision, which needs no
   * model and holds no RAM; the summary is a 30-60s call to a 22GB model that
   * has the Mac Studio 20GB into swap. With the LLM unloaded, 39 scanned
   * documents extract and embed in minutes instead of forty — and the searchable
   * text, not the summary, is what Ber AI answers from. The summary can be
   * filled in later by re-running the pass without this flag.
   */
  skipSummary?: boolean
  /**
   * Extract and summarize, but do NOT chunk or embed — settle as
   * `INDEXED_IN_MAIL` instead.
   *
   * For an attachment arriving off an email thread, whose verbatim text
   * `readAttachmentText` already indexes as `thread_chunks`. The document still
   * gets everything that makes it USABLE — the file, the summary
   * `list_documents` presents it by, the `extracted_text` that
   * `get_document_content` reads — and loses only a second copy of its text in
   * a second corpus.
   *
   * ⚠ NOT A PREDICTION, AND MUST NOT BE USED AS ONE. The caller cannot know at
   * import time whether the mail index will actually read the file: an xlsx, a
   * pptx and an image all come back from `readAttachmentText` empty, and a byte
   * fetch can simply fail. So every document left in this state is re-examined
   * by `reconcileMailIndexedDocuments` once the embed phase has run, and any
   * whose text is NOT in `thread_chunks` is embedded properly after all. Set
   * this flag without that reconcile and files go silently unsearchable.
   */
  skipEmbed?: boolean
}): Promise<AiPassResult> {
  const { supabase, documentId, projectId, fileName, mimeType, buffer } = input
  const target = input.target ?? DEFAULT_TARGET
  const summarySystem = input.summaryPrompt ?? DOC_SUMMARY_SYSTEM
  const summaryVersion = input.promptVersion ?? 'doc-summary-1.0'

  const kind = documentKind(mimeType, fileName)
  if (kind === 'unsupported') {
    await setStatus(supabase, target, documentId, 'skipped')
    return { status: 'skipped', aiSummary: null, confidence: null }
  }

  try {
    await setStatus(supabase, target, documentId, 'processing')

    // 1. Full text — what actually gets embedded when available.
    let fullText: string | null = null
    let pdfBase64: string | null = null
    if (kind === 'pdf') {
      pdfBase64 = Buffer.from(buffer).toString('base64')
      fullText = await transcribePdfText({
        dataBase64: pdfBase64,
        byteLength: buffer.byteLength,
        fileName,
        userId: SYSTEM_USER_ID,
      })
    } else if (kind === 'docx') {
      fullText = await extractDocxText(buffer)
    } else if (kind === 'xlsx') {
      fullText = await extractXlsxText(buffer)
    } else if (kind === 'pptx') {
      fullText = await extractPptxText(buffer)
    } else if (kind === 'image') {
      fullText = await extractImageText(buffer, fileName)
    } else {
      fullText = new TextDecoder().decode(buffer)
    }

    // An empty extraction is not text. Normalized here so the `??` below cannot
    // treat '' as a usable value and try to embed nothing.
    if (!fullText?.trim()) fullText = null

    // 2. Summary. PDFs go through the file path (Gemini needs the file;
    // local mode extracts text itself); docx/text summarize the extracted text.
    //
    // A summary failure must NOT cost the document. Extraction has already
    // succeeded at this point, and the summary is a convenience — the verbatim
    // text is what gets embedded and what Ber AI actually answers from. Letting
    // this throw meant one model hiccup discarded the text as well, leaving a
    // document with a file, no chunks, and an 'error' that nothing came back
    // for: exactly the state fifteen company documents were found in, including
    // the Tooele LOI and a DoD award letter.
    //
    // The one exception is a file nothing here can READ at all, which the PDF
    // path reports as UnreadableDocumentError. That is not a hiccup and there is
    // no text behind it, so it stays fatal and settles the document as skipped.
    let parsed: DocSummary | null = null
    try {
      if (input.skipSummary) throw new SkipSummary()
      // A PDF normally summarizes through the file path (Gemini needs the file;
      // local mode extracts the text layer itself). But when the text above came
      // from OCR there IS no text layer, so that path would render and recognize
      // the whole scan a second time only to throw UnreadableDocumentError. If
      // we already hold the text, summarize from it.
      const summarizeFromText = kind !== 'pdf' || (isLocalAI() && fullText !== null)
      if (!summarizeFromText && kind === 'pdf') {
        const result = await callGeminiWithFile<DocSummary>({
          systemPrompt: summarySystem,
          prompt: 'Summarize this document.',
          file: { mimeType: PDF_MIME_TYPE, dataBase64: pdfBase64! },
          userId: SYSTEM_USER_ID,
          logLabel: `Document summary: ${fileName}`,
          promptVersion: summaryVersion,
          maxTokens: 2048, // Gemini-path cap only; local mode ignores maxTokens (unbudgeted)
        })
        parsed = result.data
      } else if (fullText) {
        const result = await callGemini<DocSummary>({
          task: 'doc-summary',
          systemPrompt: summarySystem,
          // Same cap and same reasoning as LOCAL_PDF_SUMMARY_CHARS in gemini.ts.
          userMessage: fullText.slice(0, Number(process.env.LOCAL_SUMMARY_INPUT_CHARS) || 30_000),
          userId: SYSTEM_USER_ID,
          promptVersion: summaryVersion,
          maxTokens: 2048,
        })
        parsed = result.data
      }
    } catch (err) {
      if (err instanceof SkipSummary) {
        // Asked for deliberately — not a failure, and not worth a warning.
      } else if (err instanceof UnreadableDocumentError || !fullText) {
        throw err
      } else {
        console.warn(
          `[document-pipeline] summary failed for ${fileName}, indexing the text anyway:`,
          err instanceof Error ? err.message : String(err)
        )
      }
    }

    let aiSummary: string | null = null
    let confidence: number | null = null
    if (parsed && typeof parsed === 'object') {
      aiSummary = parsed.summary?.trim() || null
      confidence = parsed.confidence ?? null
    } else if (parsed) {
      aiSummary = String(parsed).trim().slice(0, 1000) || null
    }
    if (aiSummary) {
      // Branched rather than passed as a union: opportunity_documents has no
      // confidence column, and a union update type resolves that field to never.
      if (target.table === 'documents') {
        await supabase
          .from('documents')
          .update({ ai_summary: aiSummary, confidence })
          .eq('id', documentId)
      } else {
        await supabase
          .from('opportunity_documents')
          .update({ ai_summary: aiSummary })
          .eq('id', documentId)
      }
    }
    if (fullText) {
      await storeExtractedText(supabase, target.table, documentId, fullText)
    }

    // 3. Embed — full text when we have it, summary as the fallback.
    const embedText = fullText ?? aiSummary

    // Asked for deliberately: this document's text is indexed with its email
    // thread, so chunking it here would put the same bytes in a second corpus.
    //
    // Settled BEFORE the no-text check below, and deliberately so. A file the
    // mail index can read but this pass cannot (a scan whose OCR failed on this
    // attempt) must not be written off as 'skipped' — the reconcile is what
    // decides, and it needs to find the row in this state to decide anything.
    if (input.skipEmbed) {
      await setStatus(supabase, target, documentId, INDEXED_IN_MAIL)
      return { status: 'indexed_in_mail', aiSummary, confidence }
    }

    if (!embedText) {
      // Neither text nor summary, and step 2 no longer swallows the text on a
      // model hiccup — so this is a file whose content genuinely cannot be read
      // (an empty or image-only docx, a blank export). That is 'skipped', not
      // 'error': both leave it unsearchable, but only one of them invites a
      // nightly sync to fetch and re-read it forever.
      await setStatus(supabase, target, documentId, 'skipped')
      return { status: 'skipped', aiSummary, confidence }
    }
    // embedOpportunityDocument swallows its own errors and returns void, so a
    // completed call is the only success signal it offers.
    //
    // It settles embedding_status itself as of 2026-10-05, so the setStatus
    // below is this pipeline keeping its own status machine consistent (it
    // also owns 'skipped' and the error path) rather than the only thing
    // moving the row off 'pending' — which is what it was until a fourth
    // caller, api/admin/backfill-embeddings, forgot the same obligation.
    let ok: boolean
    if (target.table === 'opportunity_documents') {
      await embedOpportunityDocument(documentId, target.opportunityId, embedText)
      ok = true
      await setStatus(supabase, target, documentId, 'complete')
    } else {
      ok = await embedDocument(
        documentId,
        projectId,
        embedText,
        input.entityId ?? null,
        input.isCompany ?? false
      )
    }
    return { status: ok ? 'complete' : 'error', aiSummary, confidence }
  } catch (err) {
    // A document nothing here can read is SKIPPED, not failed. Both leave it
    // unsearchable, but only one of them is worth trying again — and a nightly
    // sync that cannot tell them apart burns its entire budget re-reading the
    // same scanned survey plats and never reaches the documents behind them.
    if (err instanceof UnreadableDocumentError) {
      console.warn(`[document-pipeline] not indexable (${fileName}): ${err.message}`)
      await setStatus(supabase, target, documentId, 'skipped')
      return { status: 'skipped', aiSummary: null, confidence: null }
    }
    console.error(`[document-pipeline] AI pass failed (${fileName}):`, err)
    await setStatus(supabase, target, documentId, 'error')
    return { status: 'error', aiSummary: null, confidence: null }
  }
}
