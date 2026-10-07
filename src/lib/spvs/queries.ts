/**
 * Reading a deal's vehicles and the people in them.
 *
 * One pass: the vehicles for a record, then their participants in a single
 * `in` query rather than one per vehicle. Three vehicles is the normal case and
 * five is possible, so N+1 would be cheap — but the participants have to be
 * grouped anyway and the engine's loader calls this too.
 */

import { isProvenanceStatus, type ProvenanceStatus } from '@/lib/economics/provenance'
import { RECORD_SCOPE_COLUMN, type RecordKind } from '@/lib/records/scope'
import { num, spvDb, type ProjectSpvRow, type SpvParticipantRow } from './db'
import {
  SPV_CLASSES,
  SPV_ROLES,
  type ProjectSpv,
  type SpvClass,
  type SpvParticipant,
  type SpvPurpose,
  type SpvRole,
} from './types'

const PAGE = 1000

function status(value: string): ProvenanceStatus {
  return isProvenanceStatus(value) ? value : 'planning_assumption'
}

function purpose(value: string): SpvPurpose {
  return value === 'land' ||
    value === 'energy' ||
    value === 'data_center' ||
    value === 'housing'
    ? value
    : 'other'
}

function role(value: string): SpvRole {
  return (SPV_ROLES as readonly string[]).includes(value) ? (value as SpvRole) : 'other'
}

function holderClass(value: string): SpvClass {
  return (SPV_CLASSES as readonly string[]).includes(value) ? (value as SpvClass) : 'other'
}

export function toParticipant(row: SpvParticipantRow): SpvParticipant {
  return {
    id: row.id,
    spvId: row.spv_id,
    holderName: row.holder_name,
    holderPartyId: row.holder_party_id,
    holderEntityId: row.holder_entity_id,
    investorId: row.investor_id,
    isBerWilson: row.is_ber_wilson === true,
    role: role(row.role),
    class: holderClass(row.class),
    // ⚠ `num` returns null for absent, never 0. PostgREST hands numerics back
    // as strings and a `Number(null)` of 0 would turn "not agreed" into "none".
    equityPct: num(row.equity_pct),
    capitalCommitted: num(row.capital_committed),
    capitalFunded: num(row.capital_funded),
    preferredReturnPct: num(row.preferred_return_pct),
    profitSharePct: num(row.profit_share_pct),
    status: status(row.status),
    note: row.note,
    sortOrder: row.sort_order ?? 0,
  }
}

export function toProjectSpv(
  row: ProjectSpvRow,
  participants: SpvParticipant[]
): ProjectSpv {
  return {
    id: row.id,
    label: row.label,
    purpose: purpose(row.purpose),
    entityId: row.entity_id,
    orgNodeId: row.org_node_id,
    orgNodeName: row.org_node_name,
    jurisdiction: row.jurisdiction,
    // ⚠ Not defaulted. An unknown share must never read as 100%.
    bwOwnershipPct: num(row.bw_ownership_pct),
    raiseTarget: num(row.raise_target),
    status: status(row.status),
    note: row.note,
    sortOrder: row.sort_order ?? 0,
    participants,
  }
}

/**
 * Every vehicle on a record, with its participants.
 *
 * ⚠ THROWS rather than returning an empty array on a database error. A 42703
 * from a renamed column comes back on `error` with `data` null, and an empty
 * array would read as "this deal has no vehicles" while reporting nothing
 * anywhere — which is the failure this codebase has hit most often.
 */
export async function loadProjectSpvs(
  kind: RecordKind,
  recordId: string
): Promise<ProjectSpv[]> {
  const db = spvDb()

  const { data: spvRows, error } = await db
    .from('project_spvs')
    .select('*')
    .eq(RECORD_SCOPE_COLUMN[kind], recordId)
    .order('sort_order', { ascending: true })
    .limit(PAGE)
  if (error) throw new Error(`Could not load project_spvs: ${error.message}`)

  const vehicles = (spvRows ?? []) as ProjectSpvRow[]
  if (vehicles.length === 0) return []

  const { data: partRows, error: partError } = await db
    .from('project_spv_participants')
    .select('*')
    .in('spv_id', vehicles.map((v) => v.id))
    .order('sort_order', { ascending: true })
    .limit(PAGE)
  if (partError) {
    throw new Error(`Could not load project_spv_participants: ${partError.message}`)
  }

  const bySpv = new Map<string, SpvParticipant[]>()
  for (const row of (partRows ?? []) as SpvParticipantRow[]) {
    const participant = toParticipant(row)
    const list = bySpv.get(participant.spvId)
    if (list) list.push(participant)
    else bySpv.set(participant.spvId, [participant])
  }

  return vehicles.map((row) => toProjectSpv(row, bySpv.get(row.id) ?? []))
}

/** The tab badge count: how many vehicles a record has. */
export async function countProjectSpvs(
  kind: RecordKind,
  recordId: string
): Promise<number> {
  const { count, error } = await spvDb()
    .from('project_spvs')
    .select('id', { count: 'exact', head: true })
    .eq(RECORD_SCOPE_COLUMN[kind], recordId)
  if (error) {
    // A count is decoration; a thrown error here would take down the whole tab
    // bar. Said out loud rather than swallowed.
    console.error('[spvs] vehicle count failed:', error.message)
    return 0
  }
  return count ?? 0
}
