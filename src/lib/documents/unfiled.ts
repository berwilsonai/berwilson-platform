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
import { bestMatch, loadTargets, type Target } from '@/lib/email-sweep/route-phase'
import type { ThreadSummary } from '@/lib/ai/prompts/thread-summary'

/**
 * Document text fed to identifier extraction.
 *
 * Capped, and deliberately not raised: a parcel number or an owning entity is
 * named in a title commitment's first page, and reading 88,000 characters of
 * every document to find it would make the queue a scan of the whole corpus.
 */
const IDENTIFIER_TEXT_CHARS = 4000

export interface CompanyKnowledgeDoc {
  id: string
  fileName: string
  docType: string | null
  mimeType: string | null
  aiSummary: string | null
  /** Which nominated Drive folder it came from, once backfilled. */
  folderPath: string | null
  embeddingStatus: string | null
  /** A human has said this belongs where it is — out of the queue, still listed. */
  filingConfirmed: boolean
  /** How much of the searchable index this document accounts for. */
  chunks: number
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
}

/** Columns every surface reads. ONE definition, deliberately. */
const CANDIDATE_COLUMNS =
  'id, file_name, doc_type, mime_type, ai_summary, extracted_text, drive_folder_path, embedding_status, drive_file_id, filing_confirmed_at'

interface CandidateRow {
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
}

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
 * A synthetic thread summary, so a document can be matched by the same routing
 * logic as correspondence.
 *
 * This is the `toProjectStub` trick from analyze-meeting.ts: `bestMatch` reads
 * `deal_name` for name tokens and `key_facts` for solicitation numbers and
 * learned identifiers, so a document's name, summary and opening text go in
 * exactly those two places. Everything else is filled to satisfy the shape and
 * is never read — notably `counterparty`, which bestMatch pointedly ignores.
 */
function asSummary(row: CandidateRow, name: string): ThreadSummary {
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
 * The name a document is matched on.
 *
 * The Drive folder is included because it is often the only place the deal is
 * named — "Business Plan Myton 1" holds files called "Business Plan.docx". It
 * cannot produce a false positive on its own: bestMatch still requires two
 * distinctive shared words or a record's whole name, so "Corporate" matches
 * nothing.
 */
function documentName(row: CandidateRow): string {
  const stem = row.file_name.replace(/\.[a-z0-9]{1,5}$/i, '')
  return [stem, row.drive_folder_path ?? ''].filter(Boolean).join(' ')
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
export async function loadCompanyKnowledge(): Promise<CompanyKnowledgeDoc[]> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('documents')
    .select(CANDIDATE_COLUMNS)
    .eq('is_company', true)
    .is('superseded_at', null)
    .is('excluded_at', null)
    .order('file_name')
  if (error) {
    // A broken query and an empty knowledge base are the same number on screen
    // (§12). Say which this was and return nothing rather than a false all-clear.
    console.error('[unfiled] could not read company documents:', error.message)
    return []
  }
  const rows = (data ?? []) as unknown as CandidateRow[]
  if (rows.length === 0) return []

  // Chunk counts in one grouped read rather than per document.
  const chunkCounts = await countChunksByDocument(
    supabase,
    rows.map((r) => r.id)
  )

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
      chunks: chunkCounts.get(row.id) ?? 0,
      fromDrive: row.drive_file_id !== null,
      filingConfirmed: row.filing_confirmed_at !== null,
    }

    const notKnowledge = isNotKnowledge(row)
    if (notKnowledge) {
      out.push({ ...base, target: null, reason: notKnowledge, confidence: null })
      continue
    }

    // One composed name for both arguments — see the warning in asSummary.
    const name = documentName(row)
    const match = targets.length > 0 ? bestMatch(name, asSummary(row, name), [], targets) : null
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
  // answers is the one worth deciding about first.
  out.sort((a, b) => b.chunks - a.chunks || a.fileName.localeCompare(b.fileName))
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

/** Chunk counts per document id, paged — PostgREST caps a select at 1000 (§12). */
async function countChunksByDocument(
  supabase: ReturnType<typeof createAdminClient>,
  documentIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (documentIds.length === 0) return counts

  const PAGE = 1000
  let from = 0
  for (;;) {
    const { data, error } = await supabase
      .from('chunks')
      .select('document_id')
      .in('document_id', documentIds)
      .range(from, from + PAGE - 1)
    if (error) {
      console.error('[unfiled] could not count chunks:', error.message)
      return counts
    }
    const page = (data ?? []) as { document_id: string | null }[]
    for (const c of page) {
      if (!c.document_id) continue
      counts.set(c.document_id, (counts.get(c.document_id) ?? 0) + 1)
    }
    if (page.length < PAGE) break
    from += PAGE
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
