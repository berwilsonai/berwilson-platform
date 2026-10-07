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

import { createClient } from '@supabase/supabase-js'

export function spvDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export function spvDbAs(actor: { id: string; email?: string | null }) {
  const headers: Record<string, string> = { 'x-actor-id': actor.id }
  if (actor.email) headers['x-actor-email'] = actor.email
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers },
    }
  )
}

// ── Row shapes — the hand-maintained stand-in for the generated types ────────
//
// `| null` on every nullable column. A row interface that lies about
// nullability is how an undecided equity split becomes a 0% one three layers
// later, and 0% and undecided are different facts about a deal.

export interface ProjectSpvRow {
  id: string
  project_id: string | null
  opportunity_id: string | null
  label: string
  purpose: string
  entity_id: string | null
  org_node_id: string | null
  /** Snapshot of the org node's name, so tidying the chart cannot erase it. */
  org_node_name: string | null
  jurisdiction: string | null
  /** The FALLBACK share, read only when this vehicle has no participants. */
  bw_ownership_pct: number | null
  /** A goal, never a rollup of the participants' commitments. */
  raise_target: number | null
  status: string
  note: string | null
  sort_order: number
  created_at: string
  updated_at: string | null
}

export interface SpvParticipantRow {
  id: string
  spv_id: string
  holder_name: string
  holder_party_id: string | null
  holder_entity_id: string | null
  investor_id: string | null
  /** Which row is ours. A flag, never a name match. */
  is_ber_wilson: boolean
  role: string
  class: string
  equity_pct: number | null
  capital_committed: number | null
  capital_funded: number | null
  preferred_return_pct: number | null
  profit_share_pct: number | null
  status: string
  note: string | null
  sort_order: number
  created_at: string
  updated_at: string | null
}

/**
 * PostgREST hands `numeric` back as a STRING. Reused from the economics module
 * rather than re-implemented, because the one rule that matters is shared:
 * absent returns null, NEVER 0.
 */
export { num } from '@/lib/economics/db'
