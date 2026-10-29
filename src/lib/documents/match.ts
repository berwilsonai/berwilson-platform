/**
 * THE one way a document is matched to the record it belongs on.
 *
 * These four pieces — the columns, the composed name, the synthetic summary and
 * the call into `bestMatch` — were private to `unfiled.ts`, which asks the
 * question for COMPANY knowledge only. Three surfaces now ask it:
 *
 *   - the company-knowledge queue (`unfiled.ts`), "does this belong on a deal?"
 *   - the project-side queue (`misfiled.ts`), "is it on the RIGHT deal?"
 *   - the mail sweep (`apply-phase.ts`), "which of this thread's deals is this
 *     attachment for?"
 *
 * They are one question with three target sets, so they share one matcher
 * rather than three that drift (§12). The alternative was measured: forking
 * `documentName` would have given the sweep a matcher with no folder-path
 * signal and no identifier extraction, which is most of what makes it work.
 *
 * ⚠ NOTHING HERE PICKS A WINNER FROM AN AMBIGUOUS SET. `bestMatch` returns null
 * when two records score within AMBIGUITY_MARGIN, and every caller must treat
 * that as "leave it alone", never as "the closest one". A due-diligence
 * workbook named for three sites genuinely belongs on three sites.
 */

import { bestMatch, type MatchResult, type Target } from '@/lib/email-sweep/route-phase'
import type { ThreadSummary } from '@/lib/ai/prompts/thread-summary'

/**
 * Document text fed to identifier extraction.
 *
 * Capped, and deliberately not raised: a parcel number or an owning entity is
 * named in a title commitment's first page, and reading 88,000 characters of
 * every document to find it would make the queue a scan of the whole corpus.
 */
const IDENTIFIER_TEXT_CHARS = 4000

/** Columns every surface that matches a document reads. ONE definition. */
export const DOCUMENT_MATCH_COLUMNS =
  'id, file_name, doc_type, mime_type, ai_summary, extracted_text, drive_folder_path, embedding_status, drive_file_id, filing_confirmed_at, source_thread_id, uploaded_at'

export interface DocumentMatchRow {
  id: string
  file_name: string
  doc_type: string | null
  mime_type: string | null
  ai_summary: string | null
  extracted_text: string | null
  drive_folder_path: string | null
  embedding_status: string | null
  drive_file_id: string | null
  filing_confirmed_at: string | null
  /**
   * The thread that delivered the file, where one did. Carried here because
   * both queues print a document's retrieval footprint, and a mail-indexed
   * document's passages live in `thread_chunks` under this thread — counting
   * only `chunks` would report it as 0, and zero reads as "never indexed",
   * which is the one answer that makes a misfiled document look harmless.
   */
  source_thread_id: string | null
  /**
   * When the row arrived here — the sort key for the queue's "Most recent".
   *
   * ⚠ `uploaded_at`, BECAUSE THESE TABLES HAVE NO `created_at`. Both
   * `documents` and `opportunity_documents` depart from §4's convention and
   * carry `uploaded_at` instead, so a reader reaching for the conventional name
   * gets `42703` — which fails the WHOLE query, not the column (§12), and on a
   * queue page would read as "no documents are waiting".
   */
  uploaded_at: string | null
}

/**
 * The name a document is matched on.
 *
 * The Drive folder is included because it is often the only place the deal is
 * named — "Business Plan Myton 1" holds files called "Business Plan.docx". It
 * cannot produce a false positive on its own: bestMatch still requires two
 * distinctive shared words, a record's whole name, or a human-asserted alias,
 * so "Corporate" matches nothing.
 */
export function documentName(row: Pick<DocumentMatchRow, 'file_name' | 'drive_folder_path'>): string {
  const stem = row.file_name.replace(/\.[a-z0-9]{1,5}$/i, '')
  return [stem, row.drive_folder_path ?? ''].filter(Boolean).join(' ')
}

/**
 * A synthetic thread summary, so a document can be matched by the same routing
 * logic as correspondence.
 *
 * This is the `toProjectStub` trick from analyze-meeting.ts: `bestMatch` reads
 * `deal_name` for name tokens and `key_facts` for solicitation numbers and
 * learned identifiers, so a document's name, summary and opening text go in
 * exactly those two places. Everything else is filled to satisfy the shape and
 * is never read — notably `counterparty`, which bestMatch pointedly ignores.
 */
export function asDocumentSummary(
  row: Pick<DocumentMatchRow, 'ai_summary' | 'extracted_text'>,
  name: string
): ThreadSummary {
  const facts: string[] = []
  if (row.ai_summary) facts.push(row.ai_summary)
  if (row.extracted_text) facts.push(row.extracted_text.slice(0, IDENTIFIER_TEXT_CHARS))
  return {
    relevance: 'deal',
    // ⚠ MUST be the composed name, not the bare file name. bestMatch reads
    // `summary.deal_name` IN PREFERENCE to its own `subject` argument
    // (`summary?.deal_name ?? subject`), so a deal_name set here silently
    // discards everything the subject added — which cost the folder path and,
    // with it, every match that only the folder could make.
    deal_name: name,
    counterparty: null,
    sector: null,
    location: null,
    estimated_value: null,
    stage_signal: null,
    people: [],
    key_facts: facts,
    open_items: [],
    summary: row.ai_summary ?? '',
    confidence: 0,
  }
}

/**
 * Which record this document names, among the ones offered.
 *
 * `targets` is the whole portfolio for the two review queues and the THREAD'S
 * OWN linked records for the sweep. Restricting the set is safe because every
 * score here is absolute — the overlap between the document's tokens and one
 * record's — and only the ambiguity check compares records to each other. A
 * narrower set therefore asks a narrower question ("which of these three?")
 * with the same evidence and the same refusal to guess.
 */
export function matchDocument(
  row: Pick<DocumentMatchRow, 'file_name' | 'doc_type' | 'drive_folder_path' | 'ai_summary' | 'extracted_text'>,
  targets: Target[]
): MatchResult | null {
  if (targets.length === 0) return null
  // doc_type is folded into the name rather than the facts: it is a label like
  // "Purchase Agreement", which adds tokens a deal name can match on.
  const name = [documentName(row), row.doc_type ?? ''].filter(Boolean).join(' ')
  return bestMatch(name, asDocumentSummary(row, name), [], targets)
}
