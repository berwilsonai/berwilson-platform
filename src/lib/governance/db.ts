/**
 * Service-role client and row shapes for the governance module.
 *
 * ⚠ THE ROW SHAPES ARE NOW GENERATED, NOT HAND-WRITTEN. They were thirteen
 * hand-maintained interfaces, because `npm run gen-types` had been a disabled
 * stub since the cutover (§4). It was repaired 2026-10-08 and all thirteen
 * tables are in src/types/database.ts, so these are aliases — and the drift
 * the hand-written versions had accumulated is gone with them: twenty-two
 * live columns were missing from these interfaces, and `personnel.status` was
 * typed NOT NULL against a GENERATED column, which is nullable.
 *
 * The client stays untyped: its callers select across these tables with
 * embeds and dynamic register names (registers.ts), which the generated
 * client's inference cannot follow. The TYPES are what matters here.
 *
 * ⚠ No classes and no TypeScript parameter properties anywhere in this
 * directory (§12): Node's strip-only type stripping refuses
 * `constructor(private x: T)` outright, so a lib written that way typechecks,
 * builds, deploys — and cannot be imported by any verification script.
 */

import { createUntypedAdminClient } from '@/lib/supabase/admin'
import type { Refine, Tables } from '@/lib/supabase/types'

export function govDb() {
  return createUntypedAdminClient()
}

/**
 * The same untyped client, carrying the acting user for the activity log.
 *
 * EVERY mutation in this module goes through this, never through govDb().
 * `log_activity` falls back to the `x-actor-id` request header when
 * `auth.uid()` is null — which it always is on a service-role write — so
 * without it a human recording a termination is logged as "system" (§12). On a
 * governance table that is not a cosmetic defect: the audit trail's whole
 * purpose is saying who decided.
 */
export function govDbAs(actor: { id: string; email?: string | null }) {
  return createUntypedAdminClient(actor)
}

// ─── Personnel ───────────────────────────────────────────────────────────────

export type PersonnelClassification =
  | 'employee'
  | 'contractor_1099'
  | 'seconded'
  | 'temp'
  | 'intern'
  | 'officer_only'
  | 'board_only'

export type SeparationType =
  | 'resigned'
  | 'terminated_cause'
  | 'terminated_without_cause'
  | 'layoff'
  | 'contract_end'
  | 'retired'
  | 'mutual'
  | 'deceased'
  | 'other'

/**
 * ⚠ `status` IS REFINED BACK TO NOT NULL, DELIBERATELY. It is a GENERATED
 * column — `case when separated_on is null then 'active' else 'departed' end`
 * — so the expression is total and the value can never be null. Postgres still
 * reports every generated column as nullable in information_schema, so the
 * generated type says `string | null`; that is the schema being pessimistic,
 * not a fact about the data. Naming the two members is stricter than the
 * `string` the hand-written interface had.
 *
 * One definition, in the schema, so a row cannot be active with a separation
 * date on it (§12 — one quantity, one definition).
 */
export type PersonnelRow = Refine<Tables<'personnel'>, { status: 'active' | 'departed' }>

/**
 * Field notes carried over from the hand-written interface this replaced —
 * the columns themselves now come from the schema.
 *
 * `tone` — A tone NAME against TONE_BADGE in src/lib/utils/leads.ts, never
 *   classes.
 */
export type PersonnelNoteKindRow = Tables<'personnel_note_kinds'>

/**
 * Field notes carried over from the hand-written interface this replaced —
 * the columns themselves now come from the schema.
 *
 * `author` — Stamped server-side from the viewer. Never accepted from a
 *   client.
 * `effective_on` — When it HAPPENED, as against created_at = when it was
 *   written down.
 */
export type PersonnelNoteRow = Tables<'personnel_notes'>

export type PersonnelAgreementRow = Tables<'personnel_agreements'>

export type PersonnelOffboardingRow = Tables<'personnel_offboarding'>

// ─── Corporate record ────────────────────────────────────────────────────────

/**
 * Field notes carried over from the hand-written interface this replaced —
 * the columns themselves now come from the schema.
 *
 * `meeting_id` — NULL for a written consent, enforced by a CHECK — that is
 *   the whole point.
 */
export type ResolutionRow = Tables<'resolutions'>

/**
 * Field notes carried over from the hand-written interface this replaced —
 * the columns themselves now come from the schema.
 *
 * `signing_limit` — NULL with can_sign_contracts means UNLIMITED — a real
 *   state, not a gap.
 */
export type OrgRoleRow = Tables<'org_roles'>

export type OwnershipInterestRow = Tables<'ownership_interests'>

// ─── Compliance register ─────────────────────────────────────────────────────

/**
 * Field notes carried over from the hand-written interface this replaced —
 * the columns themselves now come from the schema.
 *
 * `kind` — Free text by design — the set grows with every new state and
 *   licence class.
 */
export type EntityObligationRow = Tables<'entity_obligations'>

/**
 * Field notes carried over from the hand-written interface this replaced —
 * the columns themselves now come from the schema.
 *
 * `has_conflicts` — A "nothing to disclose" return IS the record. False here
 *   means someone was asked and said no; the absence of a row means nobody was
 *   asked, and the register exists to tell those two apart.
 */
export type ConflictDisclosureRow = Tables<'conflict_disclosures'>

/**
 * Field notes carried over from the hand-written interface this replaced —
 * the columns themselves now come from the schema.
 *
 * `arms_length_basis` — HOW the price was set — the question an auditor is
 *   actually asking.
 */
export type RelatedPartyTransactionRow = Tables<'related_party_transactions'>

/**
 * Field notes carried over from the hand-written interface this replaced —
 * the columns themselves now come from the schema.
 *
 * `version` — Not optional. An acknowledgement of "the handbook" with no
 *   version is worth nothing.
 */
export type PolicyRow = Tables<'policies'>

export type PolicyAcknowledgementRow = Tables<'policy_acknowledgements'>
