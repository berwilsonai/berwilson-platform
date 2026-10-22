/**
 * Database access for field provenance and the "just ask me" queue.
 *
 * ⚠ UNTYPED CLIENTS, AND THE REASON WRITTEN HERE WAS STALE BY 2026-10-15.
 * This said the three tables were missing from src/types/database.ts because a
 * concurrent session had the file modified and gen-types would not overwrite
 * it. All three are typed now — checked, not assumed, which is §12's rule that
 * a workaround's recorded reason must be re-tested before it is inherited.
 *
 * The UNTYPED CLIENT still has to stay: `applyFieldUpdates` takes the table as
 * a runtime string (that is the whole point of a registry-driven writer), and
 * the generated client cannot infer a column set from a value. What could now
 * go is the hand-written ROW SHAPES below, which should become `Refine` aliases
 * of the generated rows per src/lib/supabase/types.ts — left as is only because
 * this module is a security boundary and the change buys no behaviour.
 *
 * ⚠ WRITES GO THROUGH `provDbAs(PEPPER)`, NEVER `provDb()`. The whole safety
 * argument for removing the approval gate is that every autonomous change is
 * attributable and reversible — which is true only if `log_activity()` can see
 * an actor. Pepper has her own auth user for exactly this; a write without it
 * is recorded as "system" and becomes indistinguishable from a trigger.
 */

import { createUntypedAdminClient } from '@/lib/supabase/admin'

export function provDb() {
  return createUntypedAdminClient()
}

export function provDbAs(actor: { id: string; email?: string | null }) {
  return createUntypedAdminClient(actor)
}

/**
 * Pepper's own identity, so her writes carry her name rather than "system".
 *
 * ⚠ HARD-CODED ON PURPOSE, AND ASSERTED AT STARTUP OF EVERY PASS. Resolving it
 * by email at runtime means a pass that silently falls back to an unattributed
 * write the day somebody renames the seat — and an unattributed autonomous
 * write is the one thing this design cannot tolerate. `assertPepper()` below
 * fails the run loudly instead.
 */
export const PEPPER_ACTOR = {
  id: 'ec89f3ee-534d-4e32-96a3-1054734d0adc',
  email: 'info@berwilson.com',
} as const

/** Fails the pass if Pepper's seat is not where it is expected to be. */
export async function assertPepper(): Promise<void> {
  const { data, error } = await provDb()
    .from('team_members')
    .select('id, email')
    .eq('auth_user_id', PEPPER_ACTOR.id)
    .maybeSingle()
  if (error) throw new Error(`cannot verify Pepper's seat: ${error.message}`)
  if (!data) {
    throw new Error(
      `no team_members row with auth_user_id ${PEPPER_ACTOR.id} — autonomous writes ` +
        `would be logged as "system". Fix PEPPER_ACTOR in src/lib/provenance/db.ts.`
    )
  }
}

export type WrittenBy = 'human' | 'pepper'

export type SourceKind =
  | 'email_thread'
  | 'text_session'
  | 'meeting'
  | 'document'
  | 'note'
  | 'form'
  | 'backfill'

export interface FieldProvenanceRow {
  id: string
  table_name: string
  record_id: string
  field_key: string
  written_by: WrittenBy
  source_kind: SourceKind | null
  source_ref: string | null
  evidence: string | null
  confidence: number | null
  as_of: string | null
  /** What the field said before she wrote it. NULL means it was blank. The undo. */
  previous_value: string | null
  created_at: string
  updated_at: string
}

export type ProposalStatus = 'pending' | 'accepted' | 'rejected' | 'superseded'

export interface FieldProposalRow {
  id: string
  table_name: string
  record_id: string
  field_key: string
  record_label: string | null
  current_value: string | null
  proposed_value: string | null
  source_kind: SourceKind | null
  source_ref: string | null
  evidence: string | null
  confidence: number | null
  status: ProposalStatus
  decided_at: string | null
  decided_by: string | null
  created_at: string
  updated_at: string
}

export interface OutboundTextRow {
  id: string
  handle: string
  body_sha256: string
  body: string
  /**
   * ⚠ MIRRORS THE CHECK ON `pepper_outbound_texts.kind` AND MUST MOVE WITH IT.
   * `record_alert` was added 2026-10-19 in
   * `20261019000001_records_from_recordings.sql`, `task_week` /
   * `task_due_today` 2026-10-21 in `20261021000008_task_reminder_text_kinds.sql`,
   * and `document_ready` 2026-10-22 in `20261022000001_document_compose.sql`;
   * a value not in the constraint fails the whole INSERT (§12), which here means
   * the self-loop guard row is not written and `sendText` refuses to send at all.
   */
  kind:
    | 'morning'
    | 'week_ahead'
    | 'nudge'
    | 'reply'
    | 'record_alert'
    | 'task_week'
    | 'task_due_today'
    | 'document_ready'
    | 'ad_hoc'
  sent_at: string
  created_at: string
}
