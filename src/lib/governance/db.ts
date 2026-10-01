/**
 * Service-role client and row shapes for the governance module.
 *
 * Same arrangement as src/lib/email-sweep/db.ts and src/lib/leads/db.ts, for
 * the documented reason: `npm run gen-types` is a disabled stub on this stack
 * (§4), so none of the thirteen tables below will ever appear in the generated
 * Database type. Rather than scatter `as never` casts, this exports one
 * deliberately untyped client and the interfaces here carry the contract.
 *
 * ⚠ No classes and no TypeScript parameter properties anywhere in this
 * directory (§12): Node's strip-only type stripping refuses
 * `constructor(private x: T)` outright, so a lib written that way typechecks,
 * builds, deploys — and cannot be imported by any verification script.
 */

import { createClient } from '@supabase/supabase-js'

export function govDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
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

export interface PersonnelRow {
  id: string
  full_name: string
  party_id: string | null
  org_person_id: string | null
  team_member_id: string | null
  employing_entity_id: string | null
  employing_entity_name: string | null
  title: string | null
  classification: PersonnelClassification
  engaged_on: string | null
  separated_on: string | null
  separation_notice_on: string | null
  separation_type: SeparationType | null
  rehire_eligible: boolean | null
  /**
   * GENERATED, never written. `separated_on is null ? 'active' : 'departed'` —
   * one definition in the schema so a row cannot be active with a separation
   * date on it (§12, one quantity one definition).
   */
  status: 'active' | 'departed'
  retention_until: string | null
  legal_hold: boolean
  legal_hold_reason: string | null
  created_at: string | null
  updated_at: string | null
}

export interface PersonnelNoteKindRow {
  id: string
  key: string
  label: string
  description: string | null
  /** A tone NAME against TONE_BADGE in src/lib/utils/leads.ts, never classes. */
  tone: string
  sensitive: boolean
  requires_document: boolean
  sort_order: number
  active: boolean
  system: boolean
}

export interface PersonnelNoteRow {
  id: string
  personnel_id: string
  kind: string
  body: string
  /** Stamped server-side from the viewer. Never accepted from a client. */
  author: string | null
  /** When it HAPPENED, as against created_at = when it was written down. */
  effective_on: string | null
  document_id: string | null
  confidential: boolean
  created_at: string | null
}

export interface PersonnelAgreementRow {
  id: string
  personnel_id: string
  kind: string
  version: string | null
  signed_on: string | null
  effective_from: string | null
  expires_on: string | null
  consideration: number | null
  document_id: string | null
  note: string | null
}

export interface PersonnelOffboardingRow {
  id: string
  personnel_id: string
  label: string
  category: 'access' | 'property' | 'payroll' | 'authority' | 'external' | 'other'
  required: boolean
  sort_order: number
  completed_at: string | null
  completed_by: string | null
  note: string | null
}

// ─── Corporate record ────────────────────────────────────────────────────────

export interface ResolutionRow {
  id: string
  org_node_id: string | null
  org_node_name: string | null
  reference: string | null
  title: string
  kind: 'resolution' | 'written_consent' | 'ratification' | 'minute_action'
  adopting_body: string
  adopted_on: string
  effective_on: string | null
  /** NULL for a written consent, enforced by a CHECK — that is the whole point. */
  meeting_id: string | null
  votes_for: number | null
  votes_against: number | null
  votes_abstain: number | null
  recusals: string[]
  text_body: string | null
  signature_status: 'unsigned' | 'circulating' | 'signed' | 'superseded'
  signed_on: string | null
  document_id: string | null
  superseded_by_resolution_id: string | null
  note: string | null
  created_at: string | null
}

export interface OrgRoleRow {
  id: string
  personnel_id: string | null
  party_id: string | null
  org_person_id: string | null
  person_name: string
  org_node_id: string | null
  org_node_name: string | null
  title: string
  appointed_by: string | null
  appointing_resolution_id: string | null
  is_officer: boolean
  is_director: boolean
  is_manager: boolean
  can_sign_contracts: boolean
  /** NULL with can_sign_contracts means UNLIMITED — a real state, not a gap. */
  signing_limit: number | null
  bank_signatory: boolean
  can_bind_surety: boolean
  authority_note: string | null
  effective_from: string
  effective_to: string | null
  end_reason: string | null
  ending_resolution_id: string | null
  note: string | null
}

export interface OwnershipInterestRow {
  id: string
  org_node_id: string
  org_node_name: string | null
  holder_name: string
  holder_party_id: string | null
  holder_entity_id: string | null
  holder_node_id: string | null
  investor_id: string | null
  class: string
  units: number | null
  percent: number | null
  capital_contributed: number | null
  effective_from: string
  effective_to: string | null
  acquired_from_id: string | null
  consideration: number | null
  authorizing_resolution_id: string | null
  certificate_number: string | null
  note: string | null
}

// ─── Compliance register ─────────────────────────────────────────────────────

export interface EntityObligationRow {
  id: string
  org_node_id: string | null
  org_node_name: string | null
  category: string
  /** Free text by design — the set grows with every new state and licence class. */
  kind: string
  jurisdiction: string | null
  authority: string | null
  identifier: string | null
  period: string
  last_filed_on: string | null
  next_due_on: string | null
  status: 'open' | 'filed' | 'lapsed' | 'not_applicable' | 'waived'
  owner_team_member_id: string | null
  cost: number | null
  document_id: string | null
  note: string | null
}

export interface ConflictDisclosureRow {
  id: string
  personnel_id: string | null
  party_id: string | null
  person_name: string
  kind: 'annual' | 'transaction' | 'update'
  period: string | null
  disclosed_on: string
  /**
   * A "nothing to disclose" return IS the record. False here means someone was
   * asked and said no; the absence of a row means nobody was asked, and the
   * register exists to tell those two apart.
   */
  has_conflicts: boolean
  description: string | null
  related_party_id: string | null
  related_entity_id: string | null
  related_name: string | null
  org_node_id: string | null
  project_id: string | null
  recused: boolean
  resolution_id: string | null
  reviewed_by: string | null
  reviewed_on: string | null
  document_id: string | null
}

export interface RelatedPartyTransactionRow {
  id: string
  title: string
  org_node_id: string | null
  org_node_name: string | null
  counterparty_name: string
  counterparty_party_id: string | null
  counterparty_entity_id: string | null
  relationship: string
  nature: string | null
  project_id: string | null
  amount: number | null
  period: string | null
  started_on: string | null
  ended_on: string | null
  /** HOW the price was set — the question an auditor is actually asking. */
  arms_length_basis: string | null
  approved_by: string | null
  resolution_id: string | null
  disclosed_in: string | null
  status: 'active' | 'closed' | 'under_review'
  document_id: string | null
  note: string | null
}

export interface PolicyRow {
  id: string
  name: string
  /** Not optional. An acknowledgement of "the handbook" with no version is worth nothing. */
  version: string
  category: string
  summary: string | null
  effective_from: string | null
  retired_on: string | null
  requires_acknowledgement: boolean
  acknowledgement_cadence: 'once' | 'annual' | 'on_change'
  adopted_by_resolution_id: string | null
  document_id: string | null
}

export interface PolicyAcknowledgementRow {
  id: string
  policy_id: string
  personnel_id: string | null
  team_member_id: string | null
  person_name: string
  acknowledged_on: string
  method: string
  document_id: string | null
  note: string | null
}
