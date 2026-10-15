import { createAdminClient } from '@/lib/supabase/admin'
import { embedDocument, embedOpportunityDocument } from '@/lib/ai/embeddings'
import { runDocumentAiPass } from '@/lib/ai/document-pipeline'
import { INDEXED_IN_MAIL } from '@/lib/documents/status'

/**
 * Settle the documents whose text was left to the mail index.
 *
 * WHY THIS PASS HAS TO EXIST, rather than the decision being made at the import:
 * `apply` runs BEFORE `embed` in the sweep's phase order, so when
 * `importThreadAttachments` registers an attachment there is not yet a single
 * `thread_chunks` row for that thread. It cannot know whether the mail index
 * will carry the file's text. So it does not guess — it sets `INDEXED_IN_MAIL`
 * and leaves the question here, after the embed phase, when `thread_chunks` is
 * the authoritative answer.
 *
 * And the question genuinely has two answers. `readAttachmentText` handles
 * pdf/docx/text only: an emailed `.xlsx`, `.pptx` or image is fetched,
 * discarded, and indexed nowhere. A byte fetch can fail outright (Gmail meters
 * by cost-units-per-minute). A thread the summarizer judged `noise` is never
 * embedded at all. Guessing from `documentKind` at import time would have been
 * a projection of what the other half of the pipeline was going to do — and §12
 * is explicit that an orphaned projection looks perfectly live.
 *
 * So: present in `thread_chunks` → leave it, the text is searchable once.
 * Absent → index it as a document after all. The fallback is the SAFE
 * direction, which is what makes the optimisation allowable at all; the cost of
 * being wrong is a duplicate passage, never a document nobody can find.
 *
 * Cheap by construction. The check is one grouped read per batch, and a
 * document that needs indexing is embedded from the `extracted_text` the import
 * already stored — no re-download, no second OCR of a scanned survey, and no
 * model call, since the summary is already on the row.
 */

export interface ReconcileProgress {
  /** Rows examined. */
  examined: number
  /** Left alone — their text is in the mail index. */
  inMail: number
  /** Indexed as documents after all, because the mail index had no text. */
  embedded: number
  /** Could not be settled this run; they stay in the queue. */
  failed: number
  outOfTime: boolean
}

interface PendingRow {
  id: string
  file_name: string | null
  storage_path: string | null
  mime_type: string | null
  extracted_text: string | null
  source_thread_id: string | null
  project_id?: string | null
  opportunity_id?: string | null
}

/** PostgREST's silent row cap, and Kong's URI cap on a filter (§12). */
const PAGE = 1000
const ID_CHUNK = 200

/**
 * Which (thread, file name) pairs the mail index actually holds.
 *
 * Lowercased both sides: the name on a `thread_chunks` row comes from Gmail's
 * attachment metadata and the one on the document row may have been
 * disambiguated with the thread subject, but the base name is the same string
 * from the same message. Matched on the THREAD as well as the name, never the
 * name alone — Highland Title sends one thread per parcel and every one of them
 * attaches a "Title Commitment - AS.pdf".
 */
async function mailIndexedNames(
  supabase: ReturnType<typeof createAdminClient>,
  threadIds: string[]
): Promise<Set<string>> {
  const held = new Set<string>()
  for (let start = 0; start < threadIds.length; start += ID_CHUNK) {
    const ids = threadIds.slice(start, start + ID_CHUNK)
    let from = 0
    for (;;) {
      const { data, error } = await supabase
        .from('thread_chunks')
        .select('thread_id, attachment_name')
        .in('thread_id', ids)
        .eq('source', 'attachment')
        .range(from, from + PAGE - 1)
      if (error) {
        // ⚠ A FAILED READ IS NOT AN EMPTY ANSWER (§12). Returning an empty set
        // here would read as "the mail index holds nothing", and every document
        // in the batch would be re-embedded — which is wasteful but safe, and
        // safe is the direction to fail in. Throwing instead so the phase
        // reports it rather than quietly doing the expensive thing.
        throw new Error(`could not read thread_chunks: ${error.message}`)
      }
      const page = (data ?? []) as unknown as Array<{
        thread_id: string | null
        attachment_name: string | null
      }>
      for (const c of page) {
        if (!c.thread_id || !c.attachment_name) continue
        held.add(`${c.thread_id}:${c.attachment_name.toLowerCase()}`)
      }
      if (page.length < PAGE) break
      from += PAGE
    }
  }
  return held
}

/**
 * Index one document that the mail index could not read.
 *
 * Prefers the stored `extracted_text`: the import has already run extraction
 * (including Apple Vision OCR on a scan) and the summary, so all that is left
 * is the chunk-and-embed. Only when there is no stored text does this go back
 * to storage for the bytes and run the whole pass again.
 */
async function embedFromRecord(
  supabase: ReturnType<typeof createAdminClient>,
  row: PendingRow,
  side: 'project' | 'opportunity'
): Promise<boolean> {
  const fileName = row.file_name ?? 'document'

  if (row.extracted_text?.trim()) {
    if (side === 'opportunity') {
      if (!row.opportunity_id) return false
      await embedOpportunityDocument(row.id, row.opportunity_id, row.extracted_text)
      return true
    }
    return await embedDocument(row.id, row.project_id ?? null, row.extracted_text)
  }

  // No stored text — extraction never produced any, so the bytes have to be
  // read again. Rare, and the only path here that costs a model call.
  if (!row.storage_path) return false
  const { data: file, error } = await supabase.storage.from('documents').download(row.storage_path)
  if (error || !file) {
    console.error(`[reconcile] could not download ${fileName}:`, error?.message)
    return false
  }
  const buffer = await file.arrayBuffer()
  const result = await runDocumentAiPass({
    supabase,
    documentId: row.id,
    projectId: side === 'project' ? (row.project_id ?? null) : null,
    fileName,
    mimeType: row.mime_type,
    buffer,
    target:
      side === 'opportunity' && row.opportunity_id
        ? { table: 'opportunity_documents', opportunityId: row.opportunity_id }
        : { table: 'documents' },
  })
  return result.status === 'complete'
}

const SELECT =
  'id, file_name, storage_path, mime_type, extracted_text, source_thread_id'

export async function reconcileMailIndexedDocuments(
  opts: { budgetMs?: number; limit?: number } = {}
): Promise<ReconcileProgress> {
  const supabase = createAdminClient()
  const deadline = Date.now() + (opts.budgetMs ?? 5 * 60 * 1000)
  const batch = opts.limit ?? 200

  const progress: ReconcileProgress = {
    examined: 0,
    inMail: 0,
    embedded: 0,
    failed: 0,
    outOfTime: false,
  }

  // BOTH tables. An opportunity's documents are their own table (§4), and a
  // pass over one of them is a pass that leaves half the corpus unsettled —
  // which on the opportunity side is very nearly all of it, since the
  // attachments ARE the documents there.
  const [projectRes, oppRes] = await Promise.all([
    supabase
      .from('documents')
      .select(`${SELECT}, project_id`)
      .eq('embedding_status', INDEXED_IN_MAIL)
      .not('source_thread_id', 'is', null)
      .is('superseded_at', null)
      .limit(batch),
    supabase
      .from('opportunity_documents')
      .select(`${SELECT}, opportunity_id`)
      .eq('embedding_status', INDEXED_IN_MAIL)
      .not('source_thread_id', 'is', null)
      .is('superseded_at', null)
      .limit(batch),
  ])

  for (const [label, res] of [
    ['documents', projectRes],
    ['opportunity_documents', oppRes],
  ] as const) {
    // ⚠ Reported, never swallowed into "nothing to do". A PostgREST error read
    // as an empty result is how a filing audit ran green over 103 documents it
    // had never looked at (§4).
    if (res.error) {
      console.error(`[reconcile] could not read ${label}:`, res.error.message)
      progress.failed++
    }
  }

  const pending: Array<{ row: PendingRow; side: 'project' | 'opportunity' }> = [
    ...((projectRes.data ?? []) as unknown as PendingRow[]).map((row) => ({
      row,
      side: 'project' as const,
    })),
    ...((oppRes.data ?? []) as unknown as PendingRow[]).map((row) => ({
      row,
      side: 'opportunity' as const,
    })),
  ]
  if (pending.length === 0) return progress

  const threadIds = [
    ...new Set(pending.map((p) => p.row.source_thread_id).filter((t): t is string => !!t)),
  ]
  const held = await mailIndexedNames(supabase, threadIds)

  for (const { row, side } of pending) {
    if (Date.now() >= deadline) {
      progress.outOfTime = true
      break
    }
    progress.examined++

    const key = `${row.source_thread_id}:${(row.file_name ?? '').toLowerCase()}`
    if (held.has(key)) {
      // The mail index carries this file's text. Nothing to do, and nothing to
      // re-examine: the row stays INDEXED_IN_MAIL, which `needsAnotherPass`
      // reads as settled, so no sync comes back for it.
      progress.inMail++
      continue
    }

    try {
      const ok = await embedFromRecord(supabase, row, side)
      if (ok) progress.embedded++
      else progress.failed++
    } catch (err) {
      progress.failed++
      console.error(
        `[reconcile] could not index ${row.file_name ?? row.id}:`,
        err instanceof Error ? err.message : String(err)
      )
    }
  }

  return progress
}
