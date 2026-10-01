/**
 * Page reads for the governance registers.
 *
 * ⚠ EVERY SELECT HERE CHECKS `error` AND NAMES THE TABLE. The re-embed script
 * that selected a column which did not exist reported `documents: 0/0` having
 * indexed nothing at all, because supabase-js returns that on `error` and the
 * caller destructured only `data` (§12, 09-30). A zero from a broken query and a
 * zero from an empty table are the same number on screen — and on a governance
 * page the wrong one of those reads as "there is nothing on file", which is the
 * single most misleading answer this section can give.
 *
 * ⚠ AND EVERY SELECT IS PAGED. PostgREST truncates at 1,000 rows silently.
 * These tables are small today; an ownership ledger or an acknowledgement log is
 * exactly the kind of table that is small for two years and then is not.
 */

import { govDb } from './db'
import type {
  ConflictDisclosureRow,
  EntityObligationRow,
  OrgRoleRow,
  OwnershipInterestRow,
  PersonnelAgreementRow,
  PersonnelNoteKindRow,
  PersonnelNoteRow,
  PersonnelOffboardingRow,
  PersonnelRow,
  PolicyAcknowledgementRow,
  PolicyRow,
  RelatedPartyTransactionRow,
  ResolutionRow,
} from './db'

const PAGE = 1000

/**
 * Read a whole table, in pages, shouting if the query failed.
 *
 * Returns [] on error rather than throwing, because one broken register must not
 * blank the other five on the page — but it logs the table and the message, so
 * the failure is findable rather than a silently empty panel.
 */
async function readAll<T>(
  table: string,
  orderBy: string,
  ascending: boolean,
  select = '*'
): Promise<T[]> {
  const db = govDb()
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from(table)
      .select(select)
      .order(orderBy, { ascending, nullsFirst: false })
      .range(from, from + PAGE - 1)
    if (error) {
      console.error(`[governance] ${table} read failed: ${error.message}`)
      return out
    }
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < PAGE) return out
  }
}

// ─── Shared pickers ──────────────────────────────────────────────────────────

export interface EntityOption {
  id: string
  name: string
  kind: string
}

export interface PersonOption {
  id: string
  name: string
  status: string
}

/** The entity architecture, as a flat list for every entity dropdown. */
export async function listEntityOptions(): Promise<EntityOption[]> {
  const rows = await readAll<{ id: string; name: string; kind: string }>(
    'org_nodes',
    'name',
    true,
    'id, name, kind'
  )
  return rows
}

export async function listPersonnelOptions(): Promise<PersonOption[]> {
  const rows = await readAll<{ id: string; full_name: string; status: string }>(
    'personnel',
    'full_name',
    true,
    'id, full_name, status'
  )
  return rows.map((r) => ({ id: r.id, name: r.full_name, status: r.status }))
}

/**
 * Resolutions, trimmed to what a picker needs.
 *
 * Reference first where there is one — a resolution is cited by its number, and
 * a dropdown of titles makes the reader read every option to find the one they
 * already know the number of.
 */
export async function listResolutionOptions(): Promise<{ id: string; label: string }[]> {
  const rows = await readAll<{ id: string; reference: string | null; title: string; adopted_on: string }>(
    'resolutions',
    'adopted_on',
    false,
    'id, reference, title, adopted_on'
  )
  return rows.map((r) => ({
    id: r.id,
    label: r.reference ? `${r.reference} — ${r.title}` : r.title,
  }))
}

/** Company-scoped meetings, for attaching a resolution to the minute it came from. */
export async function listCompanyMeetingOptions(): Promise<{ id: string; label: string }[]> {
  const db = govDb()
  const { data, error } = await db
    .from('meetings')
    .select('id, title, meeting_date')
    .eq('scope', 'company')
    .order('meeting_date', { ascending: false })
    .limit(200)
  if (error) {
    console.error(`[governance] meetings read failed: ${error.message}`)
    return []
  }
  return ((data ?? []) as { id: string; title: string; meeting_date: string }[]).map((m) => ({
    id: m.id,
    label: `${m.meeting_date} — ${m.title}`,
  }))
}

export async function listTeamMemberOptions(): Promise<{ id: string; label: string }[]> {
  const rows = await readAll<{ id: string; name: string; active: boolean }>(
    'team_members',
    'name',
    true,
    'id, name, active'
  )
  return rows.filter((r) => r.active).map((r) => ({ id: r.id, label: r.name }))
}

// ─── Personnel page ──────────────────────────────────────────────────────────

export interface PersonnelPageData {
  personnel: PersonnelRow[]
  noteKinds: PersonnelNoteKindRow[]
  notes: PersonnelNoteRow[]
  agreements: PersonnelAgreementRow[]
  offboarding: PersonnelOffboardingRow[]
  roles: OrgRoleRow[]
  entities: EntityOption[]
  /** Who has a login, so a new record can be tied to one. */
  teamMembers: { id: string; label: string }[]
}

export async function loadPersonnelPage(): Promise<PersonnelPageData> {
  const [personnel, noteKinds, notes, agreements, offboarding, roles, entities, teamMembers] =
    await Promise.all([
      // Active first, then most recently departed — a register is read from the
      // top and the question is almost always about someone still here.
      readAll<PersonnelRow>('personnel', 'full_name', true),
      readAll<PersonnelNoteKindRow>('personnel_note_kinds', 'sort_order', true),
      readAll<PersonnelNoteRow>('personnel_notes', 'created_at', false),
      readAll<PersonnelAgreementRow>('personnel_agreements', 'signed_on', false),
      readAll<PersonnelOffboardingRow>('personnel_offboarding', 'sort_order', true),
      readAll<OrgRoleRow>('org_roles', 'effective_from', false),
      listEntityOptions(),
      listTeamMemberOptions(),
    ])
  return { personnel, noteKinds, notes, agreements, offboarding, roles, entities, teamMembers }
}

// ─── Corporate record page ───────────────────────────────────────────────────

export interface CorporateRecordPageData {
  resolutions: ResolutionRow[]
  roles: OrgRoleRow[]
  ownership: OwnershipInterestRow[]
  entities: EntityOption[]
  personnel: PersonOption[]
  resolutionOptions: { id: string; label: string }[]
  meetingOptions: { id: string; label: string }[]
}

export async function loadCorporateRecordPage(): Promise<CorporateRecordPageData> {
  const [resolutions, roles, ownership, entities, personnel, resolutionOptions, meetingOptions] =
    await Promise.all([
      readAll<ResolutionRow>('resolutions', 'adopted_on', false),
      readAll<OrgRoleRow>('org_roles', 'effective_from', false),
      readAll<OwnershipInterestRow>('ownership_interests', 'effective_from', false),
      listEntityOptions(),
      listPersonnelOptions(),
      listResolutionOptions(),
      listCompanyMeetingOptions(),
    ])
  return { resolutions, roles, ownership, entities, personnel, resolutionOptions, meetingOptions }
}

// ─── Compliance page ─────────────────────────────────────────────────────────

export interface CompliancePageData {
  obligations: EntityObligationRow[]
  conflicts: ConflictDisclosureRow[]
  relatedParty: RelatedPartyTransactionRow[]
  policies: PolicyRow[]
  acknowledgements: PolicyAcknowledgementRow[]
  entities: EntityOption[]
  personnel: PersonOption[]
  resolutionOptions: { id: string; label: string }[]
  teamMembers: { id: string; label: string }[]
  /** Company certifications, surfaced here beside the filing calendar. */
  certifications: { id: string; name: string; expiration_date: string | null; is_active: boolean }[]
}

export async function loadCompliancePage(): Promise<CompliancePageData> {
  const [
    obligations,
    conflicts,
    relatedParty,
    policies,
    acknowledgements,
    entities,
    personnel,
    resolutionOptions,
    teamMembers,
    certifications,
  ] = await Promise.all([
    readAll<EntityObligationRow>('entity_obligations', 'next_due_on', true),
    readAll<ConflictDisclosureRow>('conflict_disclosures', 'disclosed_on', false),
    readAll<RelatedPartyTransactionRow>('related_party_transactions', 'started_on', false),
    readAll<PolicyRow>('policies', 'name', true),
    readAll<PolicyAcknowledgementRow>('policy_acknowledgements', 'acknowledged_on', false),
    listEntityOptions(),
    listPersonnelOptions(),
    listResolutionOptions(),
    listTeamMemberOptions(),
    readAll<{ id: string; name: string; expiration_date: string | null; is_active: boolean }>(
      'certifications',
      'expiration_date',
      true,
      'id, name, expiration_date, is_active'
    ),
  ])
  return {
    obligations,
    conflicts,
    relatedParty,
    policies,
    acknowledgements,
    entities,
    personnel,
    resolutionOptions,
    teamMembers,
    certifications,
  }
}
