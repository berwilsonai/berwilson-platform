/**
 * Vocabulary for the governance registers — labels and badge tones.
 *
 * Every stored value in these tables reaches a reader through enumLabel() and
 * one of the maps below. §7's rule is absolute: never print a stored enum at a
 * reader. `terminated_without_cause` on a personnel row is the schema leaking
 * through the page, and on this particular page it also reads as an accusation
 * the record does not make.
 *
 * Tones are NAMES resolved through TONE_BADGE in src/lib/utils/leads.ts. A
 * Tailwind class string must never be stored or assembled at runtime — v4 emits
 * only what it finds by scanning source, so a computed class produces an
 * unstyled element with no error anywhere (§12).
 */

import { TONE_BADGE } from '@/lib/utils/leads'

export const tone = (name: string): string => TONE_BADGE[name] ?? TONE_BADGE.slate

// ─── Personnel ───────────────────────────────────────────────────────────────

export const CLASSIFICATIONS = [
  'employee',
  'contractor_1099',
  'seconded',
  'temp',
  'intern',
  'officer_only',
  'board_only',
] as const

export const CLASSIFICATION_LABELS: Record<string, string> = {
  employee: 'Employee (W-2)',
  contractor_1099: 'Contractor (1099)',
  seconded: 'Seconded from a group company',
  temp: 'Temporary',
  intern: 'Intern',
  officer_only: 'Officer only (not employed)',
  board_only: 'Board only (not employed)',
}

/** Worker classification is the audit magnet in construction — flag the risky ones. */
export const CLASSIFICATION_TONE: Record<string, string> = {
  employee: 'slate',
  contractor_1099: 'amber',
  seconded: 'violet',
  temp: 'amber',
  intern: 'slate',
  officer_only: 'blue',
  board_only: 'blue',
}

export const SEPARATION_TYPES = [
  'resigned',
  'terminated_cause',
  'terminated_without_cause',
  'layoff',
  'contract_end',
  'retired',
  'mutual',
  'deceased',
  'other',
] as const

export const SEPARATION_TYPE_LABELS: Record<string, string> = {
  resigned: 'Resigned',
  terminated_cause: 'Terminated — for cause',
  terminated_without_cause: 'Terminated — without cause',
  layoff: 'Layoff / reduction in force',
  contract_end: 'Contract ended',
  retired: 'Retired',
  mutual: 'Mutual separation',
  deceased: 'Deceased',
  other: 'Other',
}

export const SEPARATION_TYPE_TONE: Record<string, string> = {
  resigned: 'slate',
  terminated_cause: 'rose',
  terminated_without_cause: 'amber',
  layoff: 'amber',
  contract_end: 'slate',
  retired: 'emerald',
  mutual: 'slate',
  deceased: 'slate',
  other: 'slate',
}

export const PERSONNEL_STATUS_TONE: Record<string, string> = {
  active: 'emerald',
  departed: 'slate',
}

export const AGREEMENT_KINDS = [
  'offer_letter',
  'employment_agreement',
  'contractor_agreement',
  'nda',
  'non_solicit',
  'non_compete',
  'ip_assignment',
  'arbitration',
  'handbook_ack',
  'separation_agreement',
  'release',
  'other',
] as const

export const AGREEMENT_KIND_LABELS: Record<string, string> = {
  offer_letter: 'Offer letter',
  employment_agreement: 'Employment agreement',
  contractor_agreement: 'Contractor agreement',
  nda: 'NDA / confidentiality',
  non_solicit: 'Non-solicitation',
  non_compete: 'Non-compete',
  ip_assignment: 'IP assignment',
  arbitration: 'Arbitration agreement',
  handbook_ack: 'Handbook acknowledgement',
  separation_agreement: 'Separation agreement',
  release: 'Release / waiver',
  other: 'Other',
}

/** The covenants whose expiry is the live question on the day someone resigns. */
export const RESTRICTIVE_AGREEMENT_KINDS = ['nda', 'non_solicit', 'non_compete', 'ip_assignment']

export const OFFBOARDING_CATEGORIES = ['access', 'property', 'payroll', 'authority', 'external', 'other'] as const

export const OFFBOARDING_CATEGORY_LABELS: Record<string, string> = {
  access: 'Access',
  property: 'Company property',
  payroll: 'Pay & benefits',
  authority: 'Authority',
  external: 'External',
  other: 'Other',
}

export const OFFBOARDING_CATEGORY_TONE: Record<string, string> = {
  access: 'rose',
  property: 'amber',
  payroll: 'violet',
  authority: 'blue',
  external: 'teal',
  other: 'slate',
}

// ─── Corporate record ────────────────────────────────────────────────────────

export const RESOLUTION_KINDS = ['resolution', 'written_consent', 'ratification', 'minute_action'] as const

export const RESOLUTION_KIND_LABELS: Record<string, string> = {
  resolution: 'Resolution',
  written_consent: 'Written consent (no meeting)',
  ratification: 'Ratification',
  minute_action: 'Action minuted',
}

export const RESOLUTION_KIND_TONE: Record<string, string> = {
  resolution: 'blue',
  written_consent: 'violet',
  ratification: 'teal',
  minute_action: 'slate',
}

export const ADOPTING_BODIES = ['board', 'members', 'managers', 'shareholders', 'officer', 'committee'] as const

export const ADOPTING_BODY_LABELS: Record<string, string> = {
  board: 'Board of directors',
  members: 'Members',
  managers: 'Managers',
  shareholders: 'Shareholders',
  officer: 'Officer (delegated)',
  committee: 'Committee',
}

export const SIGNATURE_STATUSES = ['unsigned', 'circulating', 'signed', 'superseded'] as const

export const SIGNATURE_STATUS_LABELS: Record<string, string> = {
  unsigned: 'Unsigned',
  circulating: 'Out for signature',
  signed: 'Signed',
  superseded: 'Superseded',
}

export const SIGNATURE_STATUS_TONE: Record<string, string> = {
  unsigned: 'amber',
  circulating: 'blue',
  signed: 'emerald',
  superseded: 'slate',
}

export const APPOINTED_BY = [
  'board',
  'members',
  'managers',
  'shareholders',
  'officer',
  'committee',
  'operating_agreement',
] as const

export const APPOINTED_BY_LABELS: Record<string, string> = {
  ...ADOPTING_BODY_LABELS,
  operating_agreement: 'Operating agreement',
}

export const ROLE_END_REASONS = [
  'resigned',
  'removed',
  'term_expired',
  'role_changed',
  'separation',
  'entity_dissolved',
  'other',
] as const

export const ROLE_END_REASON_LABELS: Record<string, string> = {
  resigned: 'Resigned the office',
  removed: 'Removed',
  term_expired: 'Term expired',
  role_changed: 'Role changed',
  separation: 'Left the company',
  entity_dissolved: 'Entity dissolved',
  other: 'Other',
}

export const OWNERSHIP_CLASSES = [
  'membership_units',
  'series_interest',
  'common',
  'preferred',
  'profits_interest',
  'option',
  'warrant',
  'convertible_note',
  'other',
] as const

export const OWNERSHIP_CLASS_LABELS: Record<string, string> = {
  membership_units: 'Membership units',
  series_interest: 'Series interest',
  common: 'Common stock',
  preferred: 'Preferred stock',
  profits_interest: 'Profits interest',
  option: 'Option',
  warrant: 'Warrant',
  convertible_note: 'Convertible note',
  other: 'Other',
}

// ─── Compliance register ─────────────────────────────────────────────────────

export const OBLIGATION_CATEGORIES = [
  'filing',
  'licence',
  'registration',
  'tax',
  'insurance',
  'bond',
  'certification',
  'other',
] as const

export const OBLIGATION_CATEGORY_LABELS: Record<string, string> = {
  filing: 'Filing',
  licence: 'Licence',
  registration: 'Registration',
  tax: 'Tax',
  insurance: 'Insurance',
  bond: 'Bond',
  certification: 'Certification',
  other: 'Other',
}

export const OBLIGATION_CATEGORY_TONE: Record<string, string> = {
  filing: 'blue',
  licence: 'violet',
  registration: 'teal',
  tax: 'amber',
  insurance: 'sky',
  bond: 'indigo',
  certification: 'emerald',
  other: 'slate',
}

export const OBLIGATION_PERIODS = ['annual', 'biennial', 'quarterly', 'monthly', 'one_time', 'as_needed'] as const

export const OBLIGATION_PERIOD_LABELS: Record<string, string> = {
  annual: 'Annual',
  biennial: 'Every 2 years',
  quarterly: 'Quarterly',
  monthly: 'Monthly',
  one_time: 'One time',
  as_needed: 'As needed',
}

export const OBLIGATION_STATUSES = ['open', 'filed', 'lapsed', 'not_applicable', 'waived'] as const

export const OBLIGATION_STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  filed: 'Filed',
  lapsed: 'Lapsed',
  not_applicable: 'Not applicable',
  waived: 'Waived',
}

export const OBLIGATION_STATUS_TONE: Record<string, string> = {
  open: 'amber',
  filed: 'emerald',
  lapsed: 'rose',
  not_applicable: 'slate',
  waived: 'slate',
}

/**
 * Bands for a due date, so the colour still means something.
 *
 * WHEN EVERY ROW IS RED, RED HAS STOPPED SIGNIFYING (§12) — nine commitments at
 * 227d, 218d and 117d overdue were all in alarm colour and the screen said
 * nothing. Alarm is reserved for lapsed or due inside a fortnight; everything
 * further out is information.
 */
export function dueTone(nextDueOn: string | null, status: string): string {
  if (status === 'not_applicable' || status === 'waived') return 'slate'
  if (!nextDueOn) return 'slate'
  const days = Math.round(
    (new Date(`${nextDueOn}T00:00:00`).getTime() - new Date(new Date().toDateString()).getTime()) / 86_400_000
  )
  if (days < 0) return 'rose'
  if (days <= 14) return 'amber'
  if (days <= 60) return 'blue'
  return 'slate'
}

export const DISCLOSURE_KINDS = ['annual', 'transaction', 'update'] as const

export const DISCLOSURE_KIND_LABELS: Record<string, string> = {
  annual: 'Annual return',
  transaction: 'Transaction-specific',
  update: 'Update',
}

export const RPT_APPROVERS = [
  'board',
  'members',
  'disinterested_directors',
  'officer',
  'pending',
  'not_approved',
] as const

export const RPT_APPROVER_LABELS: Record<string, string> = {
  board: 'Board',
  members: 'Members',
  disinterested_directors: 'Disinterested directors',
  officer: 'Officer (delegated)',
  pending: 'Approval pending',
  not_approved: 'Not approved',
}

export const RPT_APPROVER_TONE: Record<string, string> = {
  board: 'emerald',
  members: 'emerald',
  disinterested_directors: 'emerald',
  officer: 'blue',
  pending: 'amber',
  not_approved: 'rose',
}

export const RPT_STATUSES = ['active', 'closed', 'under_review'] as const

export const RPT_STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  closed: 'Closed',
  under_review: 'Under review',
}

export const RPT_STATUS_TONE: Record<string, string> = {
  active: 'blue',
  closed: 'slate',
  under_review: 'amber',
}

export const POLICY_CATEGORIES = [
  'conduct',
  'safety',
  'hr',
  'finance',
  'it_security',
  'procurement',
  'governance',
  'quality',
  'other',
] as const

export const POLICY_CATEGORY_LABELS: Record<string, string> = {
  conduct: 'Code of conduct',
  safety: 'Safety',
  hr: 'HR',
  finance: 'Finance',
  it_security: 'IT & security',
  procurement: 'Procurement',
  governance: 'Governance',
  quality: 'Quality',
  other: 'Other',
}

export const ACK_CADENCES = ['once', 'annual', 'on_change'] as const

export const ACK_CADENCE_LABELS: Record<string, string> = {
  once: 'Once',
  annual: 'Annually',
  on_change: 'On each new version',
}

export const ACK_METHODS = ['platform', 'signed', 'email', 'training', 'other'] as const

export const ACK_METHOD_LABELS: Record<string, string> = {
  platform: 'In the platform',
  signed: 'Signed document',
  email: 'By email',
  training: 'At training',
  other: 'Other',
}
