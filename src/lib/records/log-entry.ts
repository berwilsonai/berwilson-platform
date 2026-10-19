/**
 * ONE PASS FOR "A HUMAN LOGGED SOMETHING ON A DEAL", WITH A TARGET.
 *
 * A project's running commentary is `updates`; an opportunity's is
 * `opportunity_notes` (§4). They are two tables for one act, and before this
 * existed they were also two different ACTS: the project path ran the text
 * through `/api/ai/extract` and stored summary / waiting_on / risks /
 * decisions, then turned the action items into real tasks on the board, while
 * the opportunity path stored prose and embedded it. So one typed paragraph
 * produced follow-up work on a project and nothing at all on a pursuit —
 * which is §12's "a destination that does not carry what creating carries
 * reads as losing the work. If two paths differ only in WHERE the work lands,
 * they are one pass with a target parameter."
 *
 * This is that parameter. The tables stay two (measured: 86 of the 90 existing
 * notes were written by Ber AI, so moving 2 human rows into `updates` would
 * have meant auditing 23 readers for the sake of relocating almost nothing —
 * see `20261018000001_opportunity_notes_extraction.sql`). The PASS is one.
 *
 * ⚠ In `src/lib`, not in the route, because the rule is that agent tools and
 * other callers never fetch the app's own HTTP routes (§12).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { embedUpdate, embedOpportunityNote } from '@/lib/ai/embeddings'
import { createTasksFromActionItems, type ActionItemLike } from '@/lib/tasks/from-action-items'
import type { Database, TablesInsert, JsonIn } from '@/lib/supabase/types'

/** Which record the entry lands on. Exactly one, never both. */
export type LogTarget =
  | { kind: 'project'; id: string }
  | { kind: 'opportunity'; id: string }

export interface LogEntryInput {
  /** What the human typed or pasted, verbatim. Required — it is the record. */
  rawContent: string
  /**
   * The model's read, or null when it was saved as-is. NULL is a first-class
   * choice here and not a failure: the composer offers both, and on a 35B
   * local model the extract pass is 30–60s a human may not want to wait for.
   */
  summary?: string | null
  actionItems?: ActionItemLike[]
  waitingOn?: unknown[]
  risks?: unknown[]
  decisions?: unknown[]
  mentionedParties?: unknown[]
  confidence?: number | null
  /** Who logged it, for an opportunity note's byline. Stamped from the viewer. */
  author?: string | null
}

export interface LogEntryResult {
  id: string
  tasksCreated: number
  /** Which table it landed in — the caller reports it, never guesses. */
  table: 'updates' | 'opportunity_notes'
}

const arr = (v: unknown[] | undefined) => (v ?? []) as unknown as JsonIn

/**
 * Write the entry, create the confirmed action items as tasks, and index it.
 *
 * Embedding is fire-and-forget on both arms, as it always was for updates:
 * a failed embed must not fail the write, because the text is the record and
 * the index is derived from it.
 */
export async function logEntry(
  supabase: SupabaseClient<Database>,
  target: LogTarget,
  input: LogEntryInput,
): Promise<LogEntryResult> {
  const raw = input.rawContent
  const summary = input.summary?.trim() ? input.summary.trim() : null
  const confidence = typeof input.confidence === 'number' ? input.confidence : null

  if (target.kind === 'project') {
    // action_items are deliberately NOT stored on the update — human-confirmed
    // items become real tasks below (the column is being dropped).
    const row: TablesInsert<'updates'> = {
      project_id: target.id,
      source: 'manual_paste',
      raw_content: raw,
      summary,
      waiting_on: arr(input.waitingOn),
      risks: arr(input.risks),
      decisions: arr(input.decisions),
      mentioned_parties: arr(input.mentionedParties),
      confidence,
      review_state: 'approved',
    }
    const { data, error } = await supabase.from('updates').insert(row).select('id').single()
    if (error) throw new Error(error.message)

    const tasksCreated = await createTasksFromActionItems(supabase, input.actionItems ?? [], target)
    embedUpdate(data.id, target.id, raw).catch(console.error)
    return { id: data.id, tasksCreated, table: 'updates' }
  }

  // ── Opportunity ──────────────────────────────────────────────────────────
  // `body` is the raw text, matching `updates.raw_content`: what the human
  // wrote is the record, and the summary sits beside it rather than replacing
  // it. The five other writers of this table (the mail sweep, email ingestion,
  // lead promotion, meeting-intake confirm) all insert body + author only, and
  // the new columns carry defaults so none of them changes.
  const row: TablesInsert<'opportunity_notes'> = {
    opportunity_id: target.id,
    body: raw,
    author: input.author ?? null,
    summary,
    waiting_on: arr(input.waitingOn),
    risks: arr(input.risks),
    decisions: arr(input.decisions),
    confidence,
  }
  const { data, error } = await supabase.from('opportunity_notes').insert(row).select('id').single()
  if (error) throw new Error(error.message)

  const tasksCreated = await createTasksFromActionItems(supabase, input.actionItems ?? [], target)

  // Touch the opportunity so it sorts to the top of the list — the behaviour
  // the old notes route had, kept.
  await supabase.from('opportunities').update({ updated_at: new Date().toISOString() }).eq('id', target.id)

  embedOpportunityNote(target.id, raw, input.author ?? null).catch(console.error)
  return { id: data.id, tasksCreated, table: 'opportunity_notes' }
}
