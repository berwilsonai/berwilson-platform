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
 * Retire one document: chunks removed so it is no longer retrievable, row kept.
 * Never throws — a supersession that fails is a stale answer, not a failed sync.
 */
export async function supersedeDocument(
  supabase: AdminClient,
  documentId: string,
  reason: string
): Promise<boolean> {
  try {
    // Chunks first. If the flag were set first and this failed, the document
    // would read as retired while still answering questions — the worst of both.
    await supabase.from('chunks').delete().eq('document_id', documentId)
    const { error } = await supabase
      .from('documents')
      .update({
        superseded_at: new Date().toISOString(),
        superseded_reason: reason.slice(0, 300),
        embedding_status: 'skipped',
      })
      .eq('id', documentId)
    if (error) throw new Error(error.message)
    return true
  } catch (err) {
    console.error('[drive/supersede] could not supersede', documentId, err)
    return false
  }
}

/** Clear the flag. The caller is responsible for re-indexing the content. */
export async function restoreDocument(
  supabase: AdminClient,
  documentId: string
): Promise<void> {
  await supabase
    .from('documents')
    .update({ superseded_at: null, superseded_reason: null })
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
