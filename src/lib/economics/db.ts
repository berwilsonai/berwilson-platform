/**
 * Database access for deal economics.
 *
 * ⚠ DELIBERATELY UNTYPED SUPABASE CLIENTS, AND THE INTERFACES BELOW CARRY THE
 * CONTRACT INSTEAD. `npm run gen-types` is a hard-disabled stub (it pointed at
 * the retired cloud project), so src/types/database.ts is hand-maintained and
 * none of these eleven tables appears in it. This is the convention
 * src/lib/email-sweep/db.ts and src/lib/governance/db.ts already established;
 * the alternative is `as never` casts scattered through every call site, which
 * CLAUDE.md §4 forbids by name.
 *
 * ⚠ EVERY MUTATION GOES THROUGH `calcDbAs`, NEVER `calcDb`. App traffic uses
 * the service role, so `auth.uid()` is NULL on the write and `log_activity()`
 * falls back to the `x-actor-id` header. Without it the audit trail records a
 * human editing a discount rate as "system", and the whole point of auditing
 * this feature is that a number changed and someone changed it.
 *
 * ⚠ AND THIS FILE IS NOT PART OF THE ENGINE. src/lib/economics/index.ts
 * deliberately does not re-export it: the engine is pure so `npm test` and the
 * verification scripts can load it with no environment and no database.
 */

import { createUntypedAdminClient } from '@/lib/supabase/admin'
import type { Refine, Tables } from '@/lib/supabase/types'

export function calcDb() {
  return createUntypedAdminClient()
}

export function calcDbAs(actor: { id: string; email?: string | null }) {
  return createUntypedAdminClient(actor)
}

// ── Row shapes — the hand-maintained stand-in for the generated types ────────
//
// `| null` on every nullable column, because the engine's whole discipline is
// that absent is not zero and a row interface that lies about nullability is
// how a null becomes a 0 three layers later.

/**
 * Field notes carried over from the hand-written interface this replaced —
 * the columns themselves now come from the schema.
 *
 * `stated_total_shape` — 'recurring' | 'contract' | 'one_time' | 'asset' |
 *   'capture'
 */
export type DealEconomicsRow = Tables<'deal_economics'>

export type CapacitySourceRow = Tables<'economics_capacity_sources'>

export type BucketRow = Tables<'economics_buckets'>

// ⚠ `SpvRow` LIVED HERE AND NOW LIVES IN src/lib/spvs/db.ts, because a vehicle
// stopped being a child of the economics model on 2026-10-06. It hangs off the
// project or opportunity instead, so it outlives a model being rebuilt and can
// exist before one is built at all. `economics_lines.spv_id` still points at
// it; the engine reads it through `loadProjectSpvs`.

export type LineRow = Refine<Tables<'economics_lines'>, { ramp: number[] | null }>

/**
 * Field notes carried over from the hand-written interface this replaced —
 * the columns themselves now come from the schema.
 *
 * `kind` — 'milestone' | 'ramp'
 */
export type ScheduleRow = Tables<'economics_line_schedule'>

/**
 * Field notes carried over from the hand-written interface this replaced —
 * the columns themselves now come from the schema.
 *
 * `line_id` — NULL for a deal-level input such as the discount rate.
 */
export type ProvenanceRow = Tables<'economics_provenance'>

export type VersionRow = Refine<Tables<'economics_versions'>, { input_snapshot: unknown; result_snapshot: unknown }>

/**
 * Field notes carried over from the hand-written interface this replaced —
 * the columns themselves now come from the schema.
 *
 * `tone` — A tone NAME against a palette in source, never a Tailwind class
 *   string.
 */
export type BenchmarkRow = Tables<'economics_benchmarks'>

/**
 * Field notes carried over from the hand-written interface this replaced —
 * the columns themselves now come from the schema.
 *
 * `structure` — Structure only. A template never carries a price.
 */
export type TemplateRow = Refine<Tables<'economics_templates'>, { structure: unknown }>

/**
 * Field notes carried over from the hand-written interface this replaced —
 * the columns themselves now come from the schema.
 *
 * `status` — `pending` is the only state a machine may write.
 */
export type InputProposalRow = Tables<'economics_input_proposals'>

/**
 * Postgres `numeric` arrives from PostgREST as a string often enough that
 * trusting it to be a number is a bug waiting for a large value.
 *
 * ⚠ AND THIS MUST RETURN NULL, NOT ZERO, FOR ANYTHING UNREADABLE. The engine
 * treats null as "nobody has said" and 0 as a real figure, so a coercion that
 * defaults to 0 would turn every empty input into a priced one.
 */
export function num(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** The same coercion for an array of numerics, used by `ramp`. */
export function numArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null
  const out = value.map(num).filter((v): v is number => v != null)
  return out.length > 0 ? out : null
}
