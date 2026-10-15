/**
 * Which documents are on the WRONG deal, and which deal they name.
 *
 * The sibling of `unfiled.ts`, asking the other half of one question. That one
 * asks whether a COMPANY document belongs on a deal; this asks whether a
 * document already on a deal is on the right one. Both read a document through
 * `match.ts`, so neither can drift from the other or from the mail router.
 *
 * ⚠ WHY A DOCUMENT LANDS ON THE WRONG DEAL, measured 2026-10-14 against the
 * live corpus. 32 of 738 filed documents (4.3%) disagreed with the matcher, and
 * they came from exactly two causes, not from a general sloppiness:
 *
 *   1. ONE THREAD, THREE DEALS. A conversation titled "Assignment Doc for
 *      Steelton, Weirton and Riverdale" is correctly filed onto three records,
 *      and every attachment was then copied to all three — so the Steelton PSA
 *      and the Dynegy power attestation sat on two deals they say nothing
 *      about. Fixed at source in `apply-phase.ts`; these are the rows already
 *      landed.
 *   2. SIBLING DEALS SHARING A WORD. "Myton Development" and "Myton Rail" are
 *      two projects, and nine IAN acquisition documents plus six rail filings
 *      had collected on the wrong one of the pair.
 *
 * ⚠ A DOCUMENT WITH NO MATCH IS NOT IN THIS QUEUE, and that is the common and
 * correct outcome — 482 of the 738. A title commitment names a parcel and an
 * owner, never the deal; an ALTA survey names a job number. Ambiguity means NO
 * match (§12), never the closest record, and silence here means "leave it
 * where it is", never "it is unfiled".
 *
 * Nothing is stored. The proposals are computed on read from the records they
 * propose against, so there is no producer pass, no staleness, and the queue
 * cannot disagree with the portfolio.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { loadTargets, type Target } from '@/lib/email-sweep/route-phase'
import { DOCUMENT_MATCH_COLUMNS, matchDocument, type DocumentMatchRow } from './match'
import { countChunksByDocument, countMailChunksByDocument } from './unfiled'

export interface MisfiledDoc {
  id: string
  fileName: string
  /** Which table the row lives in — an opportunity's documents are their own. */
  side: 'project' | 'opportunity'
  /** The record it is on today, in words. */
  sitsOn: { kind: 'project' | 'opportunity'; id: string; name: string }
  /** The record it names. Never null: a row with no proposal is not in here. */
  target: { kind: 'project' | 'opportunity' | 'steel_deal'; id: string; name: string }
  reason: string
  /** Sort key and batch pre-tick only; never printed as a number (§12). */
  confidence: number
  /** How many indexed passages answer for the wrong deal today. */
  chunks: number
  /**
   * Passages indexed under this file's EMAIL THREAD rather than under the
   * document row — the footprint of a document settled as `INDEXED_IN_MAIL`.
   *
   * Reported APART from `chunks` rather than summed into it, because the two
   * answer different questions. Filing the document moves `chunks`; the mail
   * passages follow the THREAD's links and do not move at all. Summing would
   * promise the tap does more than it does, and showing only `chunks` would
   * print "not indexed, nothing is answering from it" over a document whose
   * text is fully searchable. Neither is true, so both numbers are carried.
   */
  mailChunks: number
  /** The thread that delivered the file, where one did. Keys `mailChunks`. */
  threadId: string | null
  folderPath: string | null
}

/** Shared by both reads, so one definition decides what "live" means. */
const LIVE = { superseded: null, excluded: null } as const

type Row = DocumentMatchRow & { project_id?: string | null; opportunity_id?: string | null }

/**
 * Every filed document whose own name points at a different record.
 *
 * Reads BOTH tables, deliberately. An opportunity's documents live in
 * `opportunity_documents`, and a pass over one table is a pass that reports
 * half the corpus as clean — which is precisely what the first version of this
 * audit did, because it named columns the second table did not have and read
 * the resulting error as an empty result.
 */
export async function findMisfiledRecordDocuments(): Promise<MisfiledDoc[]> {
  const supabase = createAdminClient()

  let targets: Target[]
  try {
    targets = await loadTargets()
  } catch (err) {
    // Without the records nothing can be proposed, and proposing nothing is the
    // right failure here — an empty queue after a failed read must not read as
    // an all-clear, so say which it was.
    console.error('[misfiled] could not load records to match against:', err)
    return []
  }
  const named = new Map(targets.map((t) => [`${t.kind}:${t.id}`, t.name]))

  const [projectDocs, opportunityDocs] = await Promise.all([
    supabase
      .from('documents')
      .select(`${DOCUMENT_MATCH_COLUMNS}, project_id`)
      .not('project_id', 'is', null)
      .is('superseded_at', LIVE.superseded)
      .is('excluded_at', LIVE.excluded)
      .is('filing_confirmed_at', null),
    supabase
      .from('opportunity_documents')
      .select(`${DOCUMENT_MATCH_COLUMNS}, opportunity_id`)
      .not('opportunity_id', 'is', null)
      .is('superseded_at', LIVE.superseded)
      .is('excluded_at', LIVE.excluded)
      .is('filing_confirmed_at', null),
  ])

  for (const [label, res] of [
    ['documents', projectDocs],
    ['opportunity_documents', opportunityDocs],
  ] as const) {
    if (res.error) console.error(`[misfiled] could not read ${label}:`, res.error.message)
  }

  const items: Array<{ row: Row; side: 'project' | 'opportunity'; recordId: string }> = []
  for (const r of (projectDocs.data ?? []) as unknown as Row[]) {
    if (r.project_id) items.push({ row: r, side: 'project', recordId: r.project_id })
  }
  for (const r of (opportunityDocs.data ?? []) as unknown as Row[]) {
    if (r.opportunity_id) items.push({ row: r, side: 'opportunity', recordId: r.opportunity_id })
  }

  const out: MisfiledDoc[] = []
  for (const { row, side, recordId } of items) {
    const match = matchDocument(row, targets)
    if (!match) continue
    // Agrees with where it sits. The common outcome among those that match at
    // all, and nothing to decide.
    if (match.target.kind === side && match.target.id === recordId) continue

    out.push({
      id: row.id,
      fileName: row.file_name,
      side,
      sitsOn: {
        kind: side,
        id: recordId,
        name: named.get(`${side}:${recordId}`) ?? 'a record that no longer exists',
      },
      target: {
        kind: match.target.kind as 'project' | 'opportunity' | 'steel_deal',
        id: match.target.id,
        name: match.target.name,
      },
      reason: match.reason,
      confidence: match.confidence,
      chunks: 0,
      mailChunks: 0,
      threadId: row.source_thread_id,
      folderPath: row.drive_folder_path,
    })
  }

  // The retrieval footprint. TWO reads, because `chunks` points at an
  // opportunity's document through its own column — counting both sides on
  // `document_id` would report every opportunity document as never indexed.
  const [projectCounts, oppCounts] = await Promise.all([
    countChunksByDocument(supabase, out.filter((d) => d.side === 'project').map((d) => d.id)),
    countChunksByDocument(
      supabase,
      out.filter((d) => d.side === 'opportunity').map((d) => d.id),
      'opportunity_document_id'
    ),
  ])
  // And the footprint of the ones indexed with their mail instead. One read
  // for both sides, because `thread_chunks` keys on the THREAD and knows
  // nothing about which document table the file was registered in.
  const mailCounts = await countMailChunksByDocument(
    supabase,
    out.map((d) => ({ id: d.id, threadId: d.threadId, fileName: d.fileName }))
  )
  for (const d of out) {
    d.chunks = (d.side === 'project' ? projectCounts : oppCounts).get(d.id) ?? 0
    d.mailChunks = mailCounts.get(d.id) ?? 0
  }

  // Biggest footprint first: the document answering for the most wrong
  // questions is the one worth deciding about first. Sorted on `chunks` alone
  // — what the decision actually moves — with the mail footprint breaking ties
  // so a mail-indexed document is not pinned to the bottom of the queue.
  out.sort(
    (a, b) => b.chunks - a.chunks || b.mailChunks - a.mailChunks || a.fileName.localeCompare(b.fileName)
  )
  return out
}

/** How many are waiting. Calls the same pass the queue does, deliberately. */
export async function countMisfiledRecordDocuments(): Promise<number> {
  try {
    return (await findMisfiledRecordDocuments()).length
  } catch (err) {
    console.error('[misfiled] count failed:', err)
    return 0
  }
}
