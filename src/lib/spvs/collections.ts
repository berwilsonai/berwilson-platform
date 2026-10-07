/**
 * The field whitelists for a vehicle and for a participant.
 *
 * ⚠ THE WHITELIST IS A SECURITY BOUNDARY, NOT A CONVENIENCE. A request body
 * reaches PostgREST only through the columns named below. `id`, `project_id`,
 * `opportunity_id`, `spv_id`, `created_at` and `updated_at` are deliberately
 * absent, so a crafted body cannot move a vehicle onto another deal or a
 * participant into another vehicle, nor restamp when either was created. Same
 * contract as src/lib/economics/collections.ts and
 * src/lib/governance/registers.ts, for the same reason.
 *
 * ⚠ THE COERCION IS IMPORTED, NOT COPIED. `normalizeCollectionPayload` carries
 * the rules that matter — a money field strips `$ , whitespace` so a reader can
 * type 1,250,000, and an EMPTY STRING BECOMES NULL rather than 0. A third copy
 * of "absent is not zero" is how that rule drifts in one place and not the
 * others.
 */

import {
  normalizeCollectionPayload,
  type CollectionSpec,
  type NormalizeResult,
} from '@/lib/economics/collections'
import { SPV_CLASSES, SPV_PURPOSES, SPV_ROLES } from './types'

const PROVENANCE_STATUSES = [
  'planning_assumption',
  'benchmark',
  'vendor_quoted',
  'loi_term_sheet',
  'contracted',
  'validated',
] as const

export const SPV_SPEC: CollectionSpec = {
  table: 'project_spvs',
  label: 'vehicle',
  fields: {
    label: 'text',
    purpose: 'text',
    entity_id: 'uuid',
    org_node_id: 'uuid',
    jurisdiction: 'text',
    // The FALLBACK share, read only when this vehicle has no participants.
    // Still nullable: an unset split means not yet determined, never 100%.
    bw_ownership_pct: 'number',
    // A goal. Never a rollup of the participants' commitments.
    raise_target: 'number',
    status: 'text',
    note: 'text',
    sort_order: 'int',
  },
  enums: {
    purpose: SPV_PURPOSES,
    status: PROVENANCE_STATUSES,
  },
  required: ['label'],
  orderBy: { column: 'sort_order', ascending: true },
}

// ⚠ `org_node_name` IS ABSENT FROM THE WHITELIST ON PURPOSE. It is a snapshot
// the route resolves from `org_nodes` itself, exactly as the governance
// registers do — a client that could set it could make a vehicle claim to be an
// entity it is not.

export const PARTICIPANT_SPEC: CollectionSpec = {
  table: 'project_spv_participants',
  label: 'participant',
  fields: {
    holder_name: 'text',
    holder_party_id: 'uuid',
    holder_entity_id: 'uuid',
    investor_id: 'uuid',
    is_ber_wilson: 'bool',
    role: 'text',
    class: 'text',
    equity_pct: 'number',
    capital_committed: 'number',
    capital_funded: 'number',
    preferred_return_pct: 'number',
    profit_share_pct: 'number',
    status: 'text',
    note: 'text',
    sort_order: 'int',
  },
  enums: {
    role: SPV_ROLES,
    class: SPV_CLASSES,
    status: PROVENANCE_STATUSES,
  },
  required: ['holder_name'],
  orderBy: { column: 'sort_order', ascending: true },
}

export function normalizeSpv(
  body: Record<string, unknown>,
  opts: { partial?: boolean } = {}
): NormalizeResult {
  return normalizeCollectionPayload(SPV_SPEC, body, opts)
}

export function normalizeParticipant(
  body: Record<string, unknown>,
  opts: { partial?: boolean } = {}
): NormalizeResult {
  return normalizeCollectionPayload(PARTICIPANT_SPEC, body, opts)
}

/**
 * Postgres codes turned into sentences that name the fix.
 *
 * The constraints are matched BY NAME, which is why the migration names them:
 * a reader cannot act on `23505`, and "that already exists" without saying what
 * is barely better.
 */
export function explainSpvError(message: string, code?: string): string {
  if (code === '23505' || /duplicate key/i.test(message)) {
    if (/project_spvs_label_unique/.test(message)) {
      return 'This deal already has a vehicle with that name. Vehicle names are unique within a deal so a revenue line can only ever point at one of them.'
    }
    if (/uniq_spv_participants_bw/.test(message)) {
      return 'This vehicle already has a participant marked as Ber Wilson. Our share is read from that one row, so there can only be one — edit the existing row rather than adding a second.'
    }
    return 'That record already exists.'
  }

  if (code === '23514' || /violates check constraint/i.test(message)) {
    if (/project_spvs_parent_check/.test(message)) {
      return 'A vehicle belongs to exactly one project or one opportunity, never both and never neither.'
    }
    if (/equity_pct/.test(message) || /profit_share_pct/.test(message)) {
      return 'A percentage must be between 0 and 100. Leave it empty if it has not been agreed — empty means undetermined, which is different from zero.'
    }
    if (/bw_ownership_pct/.test(message)) {
      return 'Our share must be between 0 and 100, or empty if it is not yet determined.'
    }
    if (/purpose/.test(message)) {
      return 'That is not a vehicle purpose. Use Land, Energy, Data center, Housing or Other.'
    }
    return 'The database refused that value. Check the percentages and the status.'
  }

  if (code === '23503' || /violates foreign key/i.test(message)) {
    if (/org_node_id/.test(message)) {
      return 'That entity is no longer in the org chart. Pick another, or leave the link empty until the vehicle is formed.'
    }
    if (/investor_id/.test(message)) {
      return 'That investor record no longer exists. Leave the link empty and the participant keeps their name.'
    }
    return 'Something this points at no longer exists.'
  }

  if (code === '42501') {
    return 'The database refused the request for lack of permission, which on this stack usually means the table was created without API grants.'
  }

  return message
}
