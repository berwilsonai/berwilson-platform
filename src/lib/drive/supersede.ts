/**
 * Retiring a document without deleting it.
 *
 * Two problems, one mechanism.
 *
 * The first is that a superseded document keeps answering questions. A "Master
 * Plan" and a "Master Plan Final" both indexed means every retrieval about the
 * master plan is split between them, and the answer is whichever the ranker
 * happened to like — the same near-duplicate failure already measured in the
 * correspondence build, where one briefing stored twice doubled its chunks and
 * biased every search that touched it.
 *
 * The second is that the people who KNOW a document is stale mostly cannot
 * reach this platform. So the gesture that retires one has to be available in
 * Drive: dragging the file into an "Archive" folder. `listFolder` skips those
 * subtrees, the file stops appearing in the nightly listing, and
 * {@link reconcileVanished} turns that disappearance into a supersession.
 *
 * Superseding drops the chunks and keeps everything else. The row, the file in
 * storage, and the document's place on the record all survive — so a mistake
 * costs a re-index, never a lost document. Nothing here ever deletes from Drive:
 * that is the team's own filing and not ours to rearrange.
 */

import type { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

export interface KnownDriveDoc {
  id: string
  drive_file_id: string
  superseded_at: string | null
}

/**
 * Which table the document lives in.
 *
 * A document can live in `documents` or in `opportunity_documents` (§9's
 * two-table split), and the two keep their chunks under DIFFERENT keys —
 * `chunks.document_id` against `chunks.opportunity_document_id`. So a supersede
 * written for one silently drops no chunks at all for the other: the row reads
 * as retired while every one of its passages keeps being cited. A target, never
 * a forked copy.
 */
export type DocumentTable = 'documents' | 'opportunity_documents'

const CHUNK_KEY: Record<DocumentTable, 'document_id' | 'opportunity_document_id'> = {
  documents: 'document_id',
  opportunity_documents: 'opportunity_document_id',
}

/** What a supersession records beyond the timestamp. */
export interface SupersedeOptions {
  /**
   * A decision the IMPORTERS MAY NOT UNDO. Set it whenever a person retired the
   * document, or the deduper did on their behalf.
   *
   * Without it the `returning` branch in both Drive importers restores any
   * superseded row whose file is still in its folder, so the retirement is
   * reversed on the next nightly run — measured 2026-10-09: no Drive-sourced
   * document had ever been durably retired by hand. The vanish path leaves this
   * false on purpose, because a file dragged back out of Archive SHOULD return.
   */
  byHand?: boolean
  /** The document this one duplicates, when that is why it is being retired. */
  duplicateOf?: string
  /** Defaults to `documents`. */
  table?: DocumentTable
}

/**
 * Retire one document: chunks removed so it is no longer retrievable, row kept.
 * Never throws — a supersession that fails is a stale answer, not a failed sync.
 */
export async function supersedeDocument(
  supabase: AdminClient,
  documentId: string,
  reason: string,
  opts: SupersedeOptions = {}
): Promise<boolean> {
  try {
    // Chunks first. If the flag were set first and this failed, the document
    // would read as retired while still answering questions — the worst of both.
    const table = opts.table ?? 'documents'
    await supabase.from('chunks').delete().eq(CHUNK_KEY[table], documentId)

    const patch = {
      superseded_at: new Date().toISOString(),
      superseded_reason: reason.slice(0, 300),
      embedding_status: 'skipped',
      // A duplicate is always a human decision, so the pointer implies the
      // lock. Writing both together is what stops a caller setting one and
      // producing a retirement the next sync quietly reverses.
      superseded_by_hand: opts.byHand || !!opts.duplicateOf,
      ...(opts.duplicateOf ? { duplicate_of: opts.duplicateOf } : {}),
    }

    // Branched rather than parameterised by table name: a union of two table
    // names collapses the typed client's update payload to `never`. Same reason
    // the attachment importer branches its reads — one pass, two statements, not
    // two passes.
    const { error } =
      table === 'opportunity_documents'
        ? await supabase.from('opportunity_documents').update(patch).eq('id', documentId)
        : await supabase.from('documents').update(patch).eq('id', documentId)
    if (error) throw new Error(error.message)
    return true
  } catch (err) {
    console.error('[drive/supersede] could not supersede', documentId, err)
    return false
  }
}

/**
 * Clear the flag. The caller is responsible for re-indexing the content.
 *
 * Clears the lock and the duplicate pointer too: restoring IS the undo, and a
 * row left locked after a restore would be retired again by nothing and
 * un-retirable by the importers forever.
 */
export async function restoreDocument(
  supabase: AdminClient,
  documentId: string
): Promise<void> {
  await supabase
    .from('documents')
    .update({
      superseded_at: null,
      superseded_reason: null,
      superseded_by_hand: false,
      duplicate_of: null,
    })
    .eq('id', documentId)
}

export interface VanishReconcileResult {
  superseded: number
  /** Set when the guard below refused to act, with the reason. */
  heldBack: string | null
}

/**
 * Supersede documents that were imported from Drive and are no longer there.
 *
 * The guards matter more than the action. A folder that is renamed, moved,
 * re-permissioned, or listed during a Drive hiccup returns fewer files than it
 * holds — and acting on that would retire a project's entire document set in one
 * silent pass. So:
 *
 *   - a listing that returned nothing is never evidence of anything;
 *   - a run that stopped early saw only part of the folder, so it proves nothing
 *     about what is missing;
 *   - and losing more than half of what was known at once is a folder-level
 *     event, not a filing decision, so it is reported instead of obeyed.
 *
 * Each guard is a failure that would be invisible: nobody notices documents
 * quietly leaving the index until an answer is wrong weeks later.
 */
export async function reconcileVanished(opts: {
  supabase: AdminClient
  known: KnownDriveDoc[]
  /** Drive file ids seen in this pass. */
  seen: Set<string>
  /** True when the pass ran out of budget and did not see the whole folder. */
  partial: boolean
  /** How many files the listing returned in total. */
  listed: number
  reason: string
}): Promise<VanishReconcileResult> {
  const { supabase, known, seen, partial, listed, reason } = opts
  const live = known.filter((d) => !d.superseded_at)

  if (partial) return { superseded: 0, heldBack: 'pass did not complete' }
  if (live.length === 0) return { superseded: 0, heldBack: null }
  if (listed === 0) return { superseded: 0, heldBack: 'listing returned no files' }

  const vanished = live.filter((d) => !seen.has(d.drive_file_id))
  if (vanished.length === 0) return { superseded: 0, heldBack: null }

  // A single missing file is a filing decision, not a folder event — and the
  // guards above have already ruled out the ways a folder breaks: a pass that
  // stopped early proves nothing, and an empty listing is never evidence.
  // Without this the majority rule swallowed its own edge case: a folder holding
  // ONE document could never have it retired (1 is always more than half of 1),
  // so the archive gesture silently did nothing and the refusal was reported
  // again every night with no way to ever clear it.
  if (vanished.length > 1 && vanished.length > live.length / 2) {
    return {
      superseded: 0,
      heldBack: `${vanished.length} of ${live.length} documents vanished at once — treated as a folder problem, not a filing decision`,
    }
  }

  let superseded = 0
  for (const doc of vanished) {
    if (await supersedeDocument(supabase, doc.id, reason)) superseded++
  }
  return { superseded, heldBack: null }
}
