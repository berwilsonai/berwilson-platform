/**
 * Database access for the vehicles on a deal and the people in them.
 *
 * ⚠ DELIBERATELY UNTYPED SUPABASE CLIENTS, AND THE INTERFACES BELOW CARRY THE
 * CONTRACT INSTEAD. `npm run gen-types` is a hard-disabled stub, so
 * src/types/database.ts is hand-maintained and neither of these tables appears
 * in it. Same convention as src/lib/economics/db.ts, src/lib/governance/db.ts
 * and src/lib/email-sweep/db.ts; the alternative is `as never` casts scattered
 * through every call site, which CLAUDE.md §4 forbids by name.
 *
 * ⚠ EVERY MUTATION GOES THROUGH `spvDbAs`, NEVER `spvDb`. App traffic uses the
 * service role, so `auth.uid()` is NULL on the write and `log_activity()` falls
 * back to the `x-actor-id` header. Without it a human moving a partner's equity
 * from 35% to 25% is recorded as "system", and on a cap table the actor is half
 * the point of having the record.
 *
 * ⚠ THE DERIVATION LIVES IN ownership.ts, NOT HERE. That file is pure and takes
 * no environment, so `npm test` and the verification scripts load it with no
 * database — the same split the economics engine keeps.
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
 * PostgREST hands `numeric` back as a STRING. Reused from the economics module
 * rather than re-implemented, because the one rule that matters is shared:
 * absent returns null, NEVER 0.
 */
export { num } from '@/lib/economics/db'
