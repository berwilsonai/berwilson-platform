/**
 * The vehicles on a deal, and the people in them.
 *
 * `SpvPurpose` and its labels are NOT redeclared here — they live in
 * src/lib/economics/types.ts because the engine's `Spv` carries them, and a
 * second copy of a union is how a purpose the model was never told about
 * silently never fires (CLAUDE.md §12 on taxonomies as second schemas).
 */

import type { ProvenanceStatus } from '@/lib/economics/provenance'
import type { SpvPurpose } from '@/lib/economics/types'

export type { SpvPurpose }
export {
  SPV_PURPOSES,
  SPV_PURPOSE_LABELS,
  DEFAULT_SPV_PURPOSES,
} from '@/lib/economics/types'

/**
 * Title case, for use INSIDE THE NAME OF A COMPANY.
 *
 * Separate from `SPV_PURPOSE_LABELS` because the two do different jobs: a
 * column heading reads "Data center" and a legal entity is "Myton Data Center
 * LLC". The bootstrap writes a name a human will read on a signature block, so
 * reusing the label produced "Myton Data center LLC".
 */
export const SPV_PURPOSE_NAMES: Record<SpvPurpose, string> = {
  land: 'Land',
  energy: 'Energy',
  data_center: 'Data Center',
  housing: 'Housing',
  other: 'Holdings',
}

/**
 * What a participant IS in the deal, not how much they hold.
 *
 * A fixed vocabulary rather than a registry: these are structural positions in
 * a transaction, and the set does not grow when Ber Wilson adds a line of
 * business. That is the test CLAUDE.md §12 sets for CHECK-vs-table, and the
 * answer here is the opposite of `lead_categories`.
 */
export type SpvRole =
  | 'sponsor'
  | 'capital_partner'
  | 'land_owner'
  | 'operator'
  | 'offtaker'
  | 'service_provider'
  | 'other'

export const SPV_ROLES: readonly SpvRole[] = [
  'sponsor',
  'capital_partner',
  'land_owner',
  'operator',
  'offtaker',
  'service_provider',
  'other',
]

export const SPV_ROLE_LABELS: Record<SpvRole, string> = {
  sponsor: 'Sponsor',
  capital_partner: 'Capital partner',
  land_owner: 'Land owner',
  operator: 'Operator',
  offtaker: 'Offtaker',
  service_provider: 'Service provider',
  other: 'Other',
}

/** The same nine members as `ownership_interests.class`, so a row promoted into
 *  the corporate record later keeps its meaning. */
export type SpvClass =
  | 'membership_units'
  | 'series_interest'
  | 'common'
  | 'preferred'
  | 'profits_interest'
  | 'option'
  | 'warrant'
  | 'convertible_note'
  | 'other'

export const SPV_CLASSES: readonly SpvClass[] = [
  'membership_units',
  'series_interest',
  'common',
  'preferred',
  'profits_interest',
  'option',
  'warrant',
  'convertible_note',
  'other',
]

export const SPV_CLASS_LABELS: Record<SpvClass, string> = {
  membership_units: 'Membership units',
  series_interest: 'Series interest',
  common: 'Common',
  preferred: 'Preferred',
  profits_interest: 'Profits interest',
  option: 'Option',
  warrant: 'Warrant',
  convertible_note: 'Convertible note',
  other: 'Other',
}

/**
 * One participant in a vehicle — and, because they are the same ledger, one
 * line of its capital raise.
 *
 * Every money and percentage field is nullable and NULL means "not agreed yet".
 * A 0% split and an undecided one are different facts about a deal, and so are
 * $0 committed and nobody having said.
 */
export interface SpvParticipant {
  id: string
  spvId: string
  holderName: string
  holderPartyId: string | null
  holderEntityId: string | null
  /** Set when this participant is already in the capital-raise pipeline. */
  investorId: string | null
  /** Which row is ours. A flag, never a name match. */
  isBerWilson: boolean
  role: SpvRole
  class: SpvClass
  equityPct: number | null
  capitalCommitted: number | null
  capitalFunded: number | null
  preferredReturnPct: number | null
  profitSharePct: number | null
  status: ProvenanceStatus
  note: string | null
  sortOrder: number
}

/**
 * A liability-siloed vehicle inside a deal.
 *
 * `bwOwnershipPct` here is the TYPED fallback, read only when `participants` is
 * empty. Our actual share comes from `resolveBwShare` in ownership.ts, which
 * prefers the ledger and says which of the two it read — one quantity, one
 * definition, and the screen never has to guess.
 */
export interface ProjectSpv {
  id: string
  label: string
  purpose: SpvPurpose
  entityId: string | null
  orgNodeId: string | null
  orgNodeName: string | null
  jurisdiction: string | null
  bwOwnershipPct: number | null
  raiseTarget: number | null
  status: ProvenanceStatus
  note: string | null
  sortOrder: number
  participants: SpvParticipant[]
}

/**
 * An SPV node from the corporate org chart, for the vehicle's link picker.
 *
 * In the lib rather than beside the picker because a SERVER component reads the
 * chart, and a type imported from a `'use client'` module drags a client
 * reference into a server page (CLAUDE.md §12, 07-11).
 */
export interface OrgNodeOption {
  id: string
  name: string
  /** The division it sits under, for a picker that has fifteen of these. */
  under: string | null
}
