/**
 * Database access for the vehicles on a deal and the people in them.
 *
 * ⚠ DELIBERATELY UNTYPED SUPABASE CLIENTS, WITH THE ROW TYPES BELOW TAKEN FROM
 * THE GENERATED SCHEMA. `createUntypedAdminClient` survives for the embed-heavy
 * reads the generated client cannot infer; the TYPES do not depend on it. Same
 * convention as src/lib/governance/db.ts and src/lib/email-sweep/db.ts; the
 * alternative is `as never` casts scattered through every call site, which
 * CLAUDE.md §4 forbids by name.
 *
 * ⚠ EVERY MUTATION GOES THROUGH `spvDbAs`, NEVER `spvDb`. App traffic uses the
 * service role, so `auth.uid()` is NULL on the write and `log_activity()` falls
 * back to the `x-actor-id` header. Without it a human moving a partner's equity
 * from 35% to 25% is recorded as "system", and on a cap table the actor is half
 * the point of having the record.
 *
 * ⚠ THE DERIVATION LIVES IN ownership.ts, NOT HERE. That file is pure and takes
 * no environment, so `npm test` and the verification scripts load it with no
 * database.
 */

import { createUntypedAdminClient } from '@/lib/supabase/admin'
import type { Tables } from '@/lib/supabase/types'

export function spvDb() {
  return createUntypedAdminClient()
}

export function spvDbAs(actor: { id: string; email?: string | null }) {
  return createUntypedAdminClient(actor)
}

// ── Row shapes — the hand-maintained stand-in for the generated types ────────
//
// `| null` on every nullable column. A row interface that lies about
// nullability is how an undecided equity split becomes a 0% one three layers
// later, and 0% and undecided are different facts about a deal.

/**
 * Field notes carried over from the hand-written interface this replaced —
 * the columns themselves now come from the schema.
 *
 * `org_node_name` — Snapshot of the org node's name, so tidying the chart
 *   cannot erase it.
 * `bw_ownership_pct` — The FALLBACK share, read only when this vehicle has
 *   no participants.
 * `raise_target` — A goal, never a rollup of the participants' commitments.
 */
export type ProjectSpvRow = Tables<'project_spvs'>

/**
 * Field notes carried over from the hand-written interface this replaced —
 * the columns themselves now come from the schema.
 *
 * `is_ber_wilson` — Which row is ours. A flag, never a name match.
 */
export type SpvParticipantRow = Tables<'project_spv_participants'>

/**
 * PostgREST hands `numeric` back as a STRING.
 *
 * ⚠ ABSENT RETURNS NULL, NEVER 0. An undecided equity split and a 0% one are
 * different facts about a deal, and a coercion that folds them together is how
 * "nobody has said" becomes "they get nothing" three layers later.
 *
 * ⚠ IT USED TO BE RE-EXPORTED FROM src/lib/economics/db.ts AND IS DECLARED HERE
 * AS OF 2026-10-23, when the calculator was removed. One home: if the Excel
 * model comes back needing the same coercion it imports this.
 */
export function num(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    if (value.trim() === '') return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}
