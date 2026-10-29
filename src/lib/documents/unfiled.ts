/**
 * Which company documents are probably misfiled, and where they belong.
 *
 * The nightly Drive sync indexes everything inside a nominated folder as
 * company knowledge. Measured on 2026-09-30 that made company chunks 1,239 of
 * 6,536 — 19% of the whole searchable index — and the biggest entries were not
 * capability evidence at all: a Phase 1 environmental report (134 chunks), a
 * USACE contract award (79), the IAN/WELSKO patent set (207 across four files),
 * an Army lease, a title commitment, and 54 chunks of logo usage guidelines.
 * `filter_include_company` is an OR branch, so all of that widened every
 * project-scoped question.
 *
 * ⚠ A DOCUMENT WITH NO MATCH IS NOT IN THIS QUEUE. It stays company knowledge,
 * untouched. That is the difference between a short list of real misfilings and
 * a 154-item chore nobody finishes — and it is the same rule as everywhere else
 * here: ambiguity means NO match (§12), never the closest record.
 *
 * Nothing is stored. `bestMatch` is pure string and set work over targets that
 * are a handful of indexed queries, so the proposals are computed on read:
 * no producer pass, no staleness, no schema, and the queue cannot disagree with
 * the records it is proposing against.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { loadTargets, type Target } from '@/lib/email-sweep/route-phase'
import {
  DOCUMENT_MATCH_COLUMNS,
  matchDocument,
  type DocumentMatchRow,
} from './match'

export interface CompanyKnowledgeDoc {
  id: string
  fileName: string
  docType: string | null
  mimeType: string | null
  aiSummary: string | null
  /** Which nominated Drive folder it came from, once backfilled. */
  folderPath: string | null
  /**
   * The SUBJECT of the mail that delivered it, for an unparented row.
   *
   * ⚠ Usually the only thing that says which deal the file is about. A
   * `documents` row called `Package.pdf` or `Quit Claim Deed` names no record;
   * the thread it arrived on is the context a human needs and the reason this
   * is carried rather than read per-row at the renderer.
   */
  sourceSubject: string | null
  embeddingStatus: string | null
  /** A human has said this belongs where it is — out of the queue, still listed. */
  filingConfirmed: boolean
  /** How much of the searchable index this document accounts for. */
  chunks: number
  /**
   * Passages indexed under this file's EMAIL THREAD instead — a document
   * settled as `INDEXED_IN_MAIL` holds no `chunks` of its own. Carried apart
   * from `chunks` because filing moves one and not the other; see the same
   * field on `MisfiledDoc`.
   */
  mailChunks: number
  /**
   * Came from a nominated Drive folder.
   *
   * Decides which removal is offered: a hard delete of a Drive-sourced row is
   * futile — the sync's `known` map is built from existing rows, so the file
   * looks new and is re-imported the same night. Setting aside keeps the row as
   * a tombstone, which is the only removal that sticks.
   */
  fromDrive: boolean
  /**
   * Where it belongs, or null when the only honest action is "not knowledge".
   * A null target with a `reason` of why is not a failed match — it is a file
   * that could never be capability evidence (an image, a logo).
   */
  target: { kind: 'project' | 'opportunity' | 'steel_deal'; id: string; name: string } | null
  /** Why this is being proposed, or null when nothing was proposed. */
  reason: string | null
  /**
   * Match confidence, or null for the not-knowledge class.
   *
   * Treated as a sort key and a pre-tick threshold only. `fit_score`-style
   * numbers are not printed at a reader here (§12).
   */
  confidence: number | null
  /** When the file landed here, for the queue's "Most recent" order. */
  arrivedAt: string | null
}

/** Columns, the composed name and the matcher all live in `match.ts` now —
 * the project-side queue and the mail sweep ask the same question (§12). */
const CANDIDATE_COLUMNS = DOCUMENT_MATCH_COLUMNS
type CandidateRow = DocumentMatchRow

/**
 * Which population of documents is being asked the filing question.
 *
 * `company` — indexed as Ber Wilson company knowledge by the nightly Drive
 * sync. The cost of leaving one is that `filter_include_company` ORs its
 * passages into every project-scoped question.
 *
 * `unparented` — imported off deal mail that belongs to no record (2026-10-25).
 * The cost of leaving one is the opposite and larger: it answers for NOTHING.
 * 809 attachments were in this state on 422 threads, among them
 * `Tensor IQ Teaming Agreement 1.6`, a `Quit Claim Deed` and 11 files on
 * `Carbon County`, because attachment import had always required a
 * `thread_links` row and only 12% of deal threads carry one.
 */
export type FilingScope = 'company' | 'unparented'

/**
 * A file that can never be company knowledge, whatever folder it sits in.
 *
 * Site photos and logo SVGs were being imported, listed among the capability
 * statements, and — where OCR could read one — embedded into the corpus that
 * grounds every fit assessment. The sync no longer takes them; these are the
 * ones already on file.
 */
function isNotKnowledge(row: CandidateRow): string | null {
  const mime = row.mime_type ?? ''
  if (mime.startsWith('image/')) {
    return mime === 'image/svg+xml' ? 'a logo or graphic, not a document' : 'a photograph, not a document'
  }
  return null
}

/**
 * EVERY live company document, each annotated with its retrieval footprint and
 * a proposed home if one clears the bar.
 *
 * One pass serves both surfaces: /decide filters this to the confident
 * proposals, and /company shows all of it with the proposal offered as a chip.
 * Two queries would be two definitions of the same list, and then the queue and
 * the page disagree about what is waiting (§12).
 *
 * Excluded and retired rows are already decided and never reappear.
 */
export async function loadCompanyKnowledge(
  scope: FilingScope = 'company'
): Promise<CompanyKnowledgeDoc[]> {
  const supabase = createAdminClient()

  // ⚠ A SCOPE, NOT A SIBLING MODULE (§12 — a fork is hardest to see as two
  // sibling modules written days apart, and the tell is a second module
  // answering the same question for a second source). "Which deal does this
  // document belong to" is ONE question: same `matchDocument`, same targets,
  // same chunk-footprint annotation, same confirmed-is-decided rule. Only the
  // WHERE clause differs, and a WHERE clause is a parameter.
  const base = supabase
    .from('documents')
    .select(CANDIDATE_COLUMNS)
    .is('superseded_at', null)
    .is('excluded_at', null)
  const scoped =
    scope === 'company'
      ? base.eq('is_company', true)
      : // ⚠ ONE POSITIVE DISCRIMINATOR, NOT AN INFERENCE ACROSS THREE NULLABLE
        // COLUMNS (§12 — give it a positive discriminator). `project_id is null
        // and is_company = false` was the first version and it was wrong in
        // both directions: it swept in the 13 pre-existing parentless rows that
        // came from elsewhere and were never a filing question, and it would
        // have kept offering a row after it was filed. `awaiting_filing` is set
        // by the orphan import and cleared by refileDocument/excludeDocument,
        // so the queue reaches zero and stays there.
        base.eq('awaiting_filing', true)

  const { data, error } = await scoped.order('file_name')
  if (error) {
    // A broken query and an empty knowledge base are the same number on screen
    // (§12). Say which this was and return nothing rather than a false all-clear.
    console.error('[unfiled] could not read company documents:', error.message)
    return []
  }
  const rows = (data ?? []) as unknown as CandidateRow[]
  if (rows.length === 0) return []

  // Chunk counts in one grouped read rather than per document — and the mail
  // index's counts beside them, for the rows whose text was never chunked here.
  const [chunkCounts, mailCounts, subjects] = await Promise.all([
    countChunksByDocument(
      supabase,
      rows.map((r) => r.id)
    ),
    countMailChunksByDocument(
      supabase,
      rows.map((r) => ({ id: r.id, threadId: r.source_thread_id, fileName: r.file_name }))
    ),
    sourceSubjects(
      supabase,
      rows.map((r) => r.source_thread_id)
    ),
  ])

  let targets: Target[] = []
  try {
    targets = await loadTargets()
  } catch (err) {
    // Without targets nothing can be PROPOSED, but the not-knowledge class does
    // not need them — so degrade to that rather than returning an empty queue.
    console.error('[unfiled] could not load records to match against:', err)
  }

  const out: CompanyKnowledgeDoc[] = []
  for (const row of rows) {
    const base = {
      id: row.id,
      fileName: row.file_name,
      docType: row.doc_type,
      mimeType: row.mime_type,
      aiSummary: row.ai_summary,
      folderPath: row.drive_folder_path,
      embeddingStatus: row.embedding_status,
      sourceSubject: row.source_thread_id ? subjects.get(row.source_thread_id) ?? null : null,
      chunks: chunkCounts.get(row.id) ?? 0,
      mailChunks: mailCounts.get(row.id) ?? 0,
      fromDrive: row.drive_file_id !== null,
      filingConfirmed: row.filing_confirmed_at !== null,
      arrivedAt: row.uploaded_at,
    }

    const notKnowledge = isNotKnowledge(row)
    if (notKnowledge) {
      out.push({ ...base, target: null, reason: notKnowledge, confidence: null })
      continue
    }

    const match = matchDocument(row, targets)
    if (!match) {
      // No proposal is the COMMON and correct outcome: a capability statement
      // has no deal home, and reaching for the closest record is how real
      // evidence lands on the wrong one.
      out.push({ ...base, target: null, reason: null, confidence: null })
      continue
    }

    out.push({
      ...base,
      target: {
        kind: match.target.kind as 'project' | 'opportunity' | 'steel_deal',
        id: match.target.id,
        name: match.target.name,
      },
      reason: match.reason,
      confidence: match.confidence,
    })
  }

  // Biggest retrieval footprint first — the document polluting the most
  // answers is the one worth deciding about first. On `chunks`, which is what
  // filing moves, with the mail footprint breaking ties.
  out.sort(
    (a, b) => b.chunks - a.chunks || b.mailChunks - a.mailChunks || a.fileName.localeCompare(b.fileName)
  )
  return out
}

/**
 * The documents actually waiting on a decision: those with a proposed home, and
 * those that could never be knowledge. Everything else is left alone.
 *
 * THE ONE definition of "unfiled", shared by the queue, its count and the
 * badge. A count with its own WHERE clause drifts from the list it counts, and
 * then three numbers for one quantity end up on one screen (§12).
 */
export function isAwaitingDecision(doc: CompanyKnowledgeDoc): boolean {
  // A confirmed document is a DECIDED document. Without this the queue is
  // uncloseable — it is computed from the records, so a proposal reappears on
  // every page load however many times it is dismissed, and a queue that
  // cannot reach zero teaches people to accept rows to make them go away.
  if (doc.filingConfirmed) return false
  return doc.target !== null || doc.reason !== null
}

/** Company documents awaiting a filing decision. */
export async function findMisfiledCompanyDocuments(): Promise<CompanyKnowledgeDoc[]> {
  return (await loadCompanyKnowledge()).filter(isAwaitingDecision)
}

/**
 * Unparented mail attachments, split into the ones that can be offered and the
 * ones that cannot.
 *
 * ⚠ THE HELD COUNT IS RETURNED, NOT DISCARDED, and that is the whole reason this
 * returns a pair instead of an array. `isAwaitingDecision` keeps a document out
 * of the queue when nothing can be proposed for it — right, because reaching for
 * the closest record is how real evidence lands on the wrong deal — but a row
 * held by a gate nobody can see is a black hole (§12: a gated-out row is HELD,
 * never dismissed; report the held count). For THIS population the stakes are
 * the other way round from company knowledge: a held company document still
 * answers questions, while a held unparented document answers nothing at all.
 * So the number has to be on the screen even though the rows are not.
 */
export async function findUnparentedDocuments(): Promise<{
  offered: CompanyKnowledgeDoc[]
  held: number
}> {
  const all = await loadCompanyKnowledge('unparented')
  const offered = all.filter(isAwaitingDecision)
  return { offered, held: all.length - offered.length }
}

/** How many are waiting. Calls the same pass the queue does, deliberately. */
export async function countMisfiledCompanyDocuments(): Promise<number> {
  try {
    return (await findMisfiledCompanyDocuments()).length
  } catch (err) {
    console.error('[unfiled] count failed:', err)
    return 0
  }
}

/**
 * Records a document can be filed onto, for the picker.
 *
 * Reuses the routing targets so the picker offers exactly what the matcher can
 * propose — a name in the list that the matcher cannot reach, or vice versa,
 * is how the two drift apart.
 */
export async function listFilingTargets(): Promise<
  Array<{ kind: 'project' | 'opportunity' | 'steel_deal'; id: string; name: string }>
> {
  try {
    const targets = await loadTargets()
    return targets
      .map((t) => ({
        kind: t.kind as 'project' | 'opportunity' | 'steel_deal',
        id: t.id,
        name: t.name,
      }))
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
  } catch (err) {
    console.error('[unfiled] could not list filing targets:', err)
    return []
  }
}

/**
 * Chunk counts per document id, paged — PostgREST caps a select at 1000 (§12).
 *
 * Exported for the project-side queue (`misfiled.ts`), which asks the identical
 * question. Forking it was the alternative, and a forked pager is a pager with
 * one copy of the 1000-row bug fixed.
 */
export async function countChunksByDocument(
  supabase: ReturnType<typeof createAdminClient>,
  documentIds: string[],
  /**
   * Which pointer to count on. An opportunity's documents live in their own
   * table and `chunks` points at them through their OWN column, so counting an
   * opportunity document's footprint on `document_id` returns zero — and zero
   * reads as "never indexed", which is the one answer that would make a
   * misfiled document look harmless.
   */
  column: 'document_id' | 'opportunity_document_id' = 'document_id'
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (documentIds.length === 0) return counts

  const PAGE = 1000
  /**
   * ⚠ IDS ARE CHUNKED SEPARATELY FROM ROWS, because two different limits
   * apply. `PAGE` is PostgREST's silent 1000-row response cap. This is the URL
   * length: a filter travels in the query string, and 1000 uuids is a 37KB GET
   * that Kong refuses outright with "URI too long" — measured 2026-10-14
   * against 550 ids. One constant cannot serve both caps.
   */
  const ID_CHUNK = 200

  for (let start = 0; start < documentIds.length; start += ID_CHUNK) {
    const ids = documentIds.slice(start, start + ID_CHUNK)
    let from = 0
    for (;;) {
      const { data, error } = await supabase
        .from('chunks')
        .select(column)
        .in(column, ids)
        .range(from, from + PAGE - 1)
      if (error) {
        console.error('[unfiled] could not count chunks:', error.message)
        return counts
      }
      const page = (data ?? []) as unknown as Array<Record<string, string | null>>
      for (const c of page) {
        const id = c[column]
        if (!id) continue
        counts.set(id, (counts.get(id) ?? 0) + 1)
      }
      if (page.length < PAGE) break
      from += PAGE
    }
  }
  return counts
}

/**
 * Passage counts for documents whose text is indexed with their EMAIL THREAD.
 *
 * The companion to `countChunksByDocument`, and needed for the same reason it
 * takes a `column` argument: a document's retrieval footprint is not always in
 * `chunks`. An attachment imported off a thread is settled as
 * `INDEXED_IN_MAIL` — its verbatim text lives in `thread_chunks` under
 * (thread_id, attachment_name) and `chunks` holds nothing for it at all. Asked
 * on `document_id` alone it counts 0, and zero reads as "never indexed".
 *
 * Matched on the thread AND the file name, never the file name alone. Highland
 * Title sends one thread per parcel and every one of them attaches a "Title
 * Commitment - AS.pdf", so a name on its own would pool four parcels' passages
 * onto whichever document asked first.
 */
/**
 * The subject of each thread that delivered one of these documents.
 *
 * One grouped read, chunked — a filter rides in the query string and 200 uuids
 * is already ~7KB (§12: the ROW cap and the URL cap are two different limits).
 * Nulls are dropped and de-duplicated first: several files arrive on one thread,
 * so the id list is routinely shorter than the row list.
 */
async function sourceSubjects(
  supabase: ReturnType<typeof createAdminClient>,
  threadIds: (string | null)[]
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  const ids = [...new Set(threadIds.filter((id): id is string => !!id))]
  if (ids.length === 0) return out

  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from('email_threads')
      .select('id, subject')
      .in('id', ids.slice(i, i + 200))
    if (error) {
      // A missing subject degrades the row to no context, which is worse but
      // still usable. Never fail the whole queue for it.
      console.error('[unfiled] could not read source thread subjects:', error.message)
      continue
    }
    for (const r of (data ?? []) as { id: string; subject: string | null }[]) {
      out.set(r.id, r.subject)
    }
  }
  return out
}

export async function countMailChunksByDocument(
  supabase: ReturnType<typeof createAdminClient>,
  docs: Array<{ id: string; threadId: string | null; fileName: string | null }>
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  const withThread = docs.filter(
    (d): d is { id: string; threadId: string; fileName: string } => !!d.threadId && !!d.fileName
  )
  if (withThread.length === 0) return counts

  // (thread, lowercased name) -> the documents asking about it. A list, because
  // the same file legitimately sits on three records off one thread when it
  // names all three (§12), and each of those rows wants the same count.
  const wanted = new Map<string, string[]>()
  for (const d of withThread) {
    const key = `${d.threadId}:${d.fileName.toLowerCase()}`
    const ids = wanted.get(key)
    if (ids) ids.push(d.id)
    else wanted.set(key, [d.id])
  }

  const threadIds = [...new Set(withThread.map((d) => d.threadId))]
  // Both caps again — PostgREST's silent 1000-row response limit and Kong's
  // URI length, which 1000 uuids in a filter exceeds outright (§12).
  const PAGE = 1000
  const ID_CHUNK = 200

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
        console.error('[unfiled] could not count mail chunks:', error.message)
        return counts
      }
      const page = (data ?? []) as unknown as Array<{
        thread_id: string | null
        attachment_name: string | null
      }>
      for (const c of page) {
        if (!c.thread_id || !c.attachment_name) continue
        const forKey = wanted.get(`${c.thread_id}:${c.attachment_name.toLowerCase()}`)
        if (!forKey) continue
        for (const id of forKey) counts.set(id, (counts.get(id) ?? 0) + 1)
      }
      if (page.length < PAGE) break
      from += PAGE
    }
  }
  return counts
}

export interface SetAsideDoc {
  id: string
  fileName: string
  folderPath: string | null
  /** 'retired' = gone from its nominated folder. 'excluded' = a human's call. */
  state: 'retired' | 'excluded'
  reason: string | null
}

/**
 * Company documents no longer answering questions: retired because they left
 * their nominated Drive folder, or set aside by hand.
 *
 * Shown as a collapsed count rather than inline. Rendering them in the main
 * list is what had seven retired rows reading as part of the corpus — the
 * graveyard reads as a gap, or worse, as content (§12).
 */
export async function loadSetAsideCompanyDocuments(): Promise<SetAsideDoc[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('documents')
    .select('id, file_name, drive_folder_path, superseded_at, superseded_reason, excluded_at, excluded_reason')
    .eq('is_company', true)
    .or('superseded_at.not.is.null,excluded_at.not.is.null')
    .order('file_name')
  if (error) {
    console.error('[unfiled] could not read set-aside documents:', error.message)
    return []
  }
  return (data ?? []).map((r) => ({
    id: r.id,
    fileName: r.file_name,
    folderPath: r.drive_folder_path,
    // Excluded is the stronger statement: a human said this is not knowledge,
    // where retired only means Drive stopped offering it.
    state: r.excluded_at ? ('excluded' as const) : ('retired' as const),
    reason: r.excluded_at ? r.excluded_reason : r.superseded_reason,
  }))
}
