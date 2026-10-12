/**
 * Database access for field provenance and the "just ask me" queue.
 *
 * ⚠ UNTYPED CLIENTS WITH HAND-WRITTEN ROW SHAPES, deliberately and temporarily.
 * `npm run gen-types` works again as of 2026-10-08 and these three tables
 * SHOULD be in src/types/database.ts — but a concurrent session has that file
 * modified in the working tree, and gen-types refuses to overwrite it while it
 * has uncommitted changes (§4, and the reason is two sessions sharing this
 * repo). Regenerate and retire these interfaces once the tree is clean; the
 * `Refine` convention in src/lib/supabase/types.ts is where they should land.
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
  kind: 'morning' | 'week_ahead' | 'nudge' | 'reply' | 'ad_hoc'
  sent_at: string
  created_at: string
}
