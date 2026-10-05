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

import { createClient } from '@supabase/supabase-js'

export function calcDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export function calcDbAs(actor: { id: string; email?: string | null }) {
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
// `| null` on every nullable column, because the engine's whole discipline is
// that absent is not zero and a row interface that lies about nullability is
// how a null becomes a 0 three layers later.

export interface DealEconomicsRow {
  id: string
  project_id: string | null
  opportunity_id: string | null
  discount_rate_pct: number | null
  cap_rate_pct: number | null
  base_year: number | null
  stated_total_amount: number | null
  /** 'recurring' | 'contract' | 'one_time' | 'asset' | 'capture' */
  stated_total_shape: string | null
  computed_firm_mw: number | null
  computed_utilization_pct: number | null
  computed_gross_annual_recurring: number | null
  computed_gross_contract_value: number | null
  computed_gross_one_time: number | null
  computed_gross_project_value: number | null
  computed_bw_gross_annual_recurring: number | null
  computed_bw_gross_contract_value: number | null
  computed_bw_gross_one_time: number | null
  computed_bw_net_annual_recurring: number | null
  computed_bw_net_contract_value: number | null
  computed_bw_net_one_time: number | null
  computed_bw_net_tax_credits: number | null
  computed_asset_value: number | null
  computed_undetermined_annual_recurring: number | null
  computed_undetermined_one_time: number | null
  computed_capture_pct_of_gross: number | null
  computed_status: string | null
  computed_valid: boolean | null
  computed_at: string | null
  notes: string | null
  created_at: string
  updated_at: string | null
}

export interface CapacitySourceRow {
  id: string
  economics_id: string
  label: string
  kind: string
  nameplate_mw: number | null
  availability_pct: number | null
  block_count: number | null
  redundant_blocks: number | null
  block_mw: number | null
  stated_net_mw: number | null
  status: string
  sort_order: number
}

export interface BucketRow {
  id: string
  economics_id: string
  label: string
  priority: number
  peak_mw: number | null
}

export interface SpvRow {
  id: string
  economics_id: string
  label: string
  purpose: string
  entity_id: string | null
  /** NULL is "not yet determined". It is never 100. */
  bw_ownership_pct: number | null
  status: string
  sort_order: number
}

export interface LineRow {
  id: string
  economics_id: string
  line_type: string
  label: string
  spv_id: string | null
  bucket_id: string | null
  is_ber_wilson_revenue: boolean
  is_carve_out: boolean
  counts_toward_project_value: boolean
  referenced_line_id: string | null
  rides_on_line_id: string | null
  start_year: number | null
  term_years: number | null
  escalator_pct: number | null
  ramp: number[] | null
  mw: number | null
  it_mw: number | null
  acres: number | null
  quantity: number | null
  units: number | null
  price: number | null
  price_unit: string | null
  price_per_mw: number | null
  price_per_unit: number | null
  price_per_unit_month: number | null
  price_per_mwh: number | null
  rate_per_kw_month: number | null
  annual_rent: number | null
  amount: number | null
  capital_base: number | null
  cost: number | null
  cost_per_mw: number | null
  cost_per_unit: number | null
  opex_annual: number | null
  fixed_om_per_kw_year: number | null
  variable_om_per_mwh: number | null
  heat_rate: number | null
  gas_price_per_mmbtu: number | null
  load_factor: number | null
  occupancy: number | null
  pue: number | null
  minimum_take_pct: number | null
  annual_rate_pct: number | null
  our_share_pct: number | null
  pct_of_line: number | null
  mode: string | null
  fee_base: string | null
  disposition: string | null
  credit_kind: string | null
  attribute_kind: string | null
  unit_label: string | null
  counterparty: string | null
  partner_label: string | null
  transferable: boolean
  power_passed_through: boolean
  power_revenue_retained: boolean
  status: string
  notes: string | null
  sort_order: number
}

export interface ScheduleRow {
  id: string
  line_id: string
  /** 'milestone' | 'ramp' */
  kind: string
  label: string
  pct: number | null
  due_date: string | null
  months_from_ntp: number | null
  sort_order: number
}

export interface ProvenanceRow {
  id: string
  economics_id: string
  /** NULL for a deal-level input such as the discount rate. */
  line_id: string | null
  field_key: string
  status: string
  source: string | null
  source_ref: string | null
  as_of: string | null
  note: string | null
}

export interface VersionRow {
  id: string
  economics_id: string
  version: number
  label: string | null
  note: string | null
  input_snapshot: unknown
  result_snapshot: unknown
  created_by: string | null
  created_at: string
}

export interface BenchmarkRow {
  id: string
  key: string
  label: string
  value_low: number | null
  value_high: number | null
  unit: string
  geography: string | null
  source: string | null
  as_of: string | null
  notes: string | null
  /** A tone NAME against a palette in source, never a Tailwind class string. */
  tone: string
  needs_review: boolean
  active: boolean
  sort_order: number
}

export interface TemplateRow {
  id: string
  key: string
  label: string
  description: string | null
  /** Structure only. A template never carries a price. */
  structure: unknown
  active: boolean
  system: boolean
  sort_order: number
}

export interface InputProposalRow {
  id: string
  economics_id: string
  line_id: string | null
  field_key: string
  proposed_value: number | null
  proposed_unit: string | null
  proposed_line_type: string | null
  proposed_label: string | null
  source_document_id: string | null
  source_quote: string | null
  confidence: number | null
  reasoning: string | null
  /** `pending` is the only state a machine may write. */
  status: string
  decided_by: string | null
  decided_at: string | null
  created_at: string
}

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
