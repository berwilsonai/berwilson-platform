/**
 * Putting a person on a deal — ONE write path, for every door that does it.
 *
 * ⚠ IT EXISTED ONLY INSIDE `applySession` AND A SECOND CALLER WAS ABOUT TO COPY
 * IT. The insert carries three non-obvious obligations, and a fork would have
 * had to rediscover all three: the role PROSE goes on `role` while the category
 * comes from the one registry via `categorizePlayerRole` (§4); the table hangs
 * off EITHER a project or an opportunity under an exactly-one check (§4 shared
 * children); and `(project_id, party_id, role)` is a unique constraint whose
 * opportunity half is a PARTIAL index, so it can be neither an insert that
 * assumes absence nor an upsert — PostgREST cannot name a partial index as a
 * conflict target (§12). Read the roll first, skip what is there, and COUNT the
 * skips rather than swallowing them.
 *
 * §12: never fork a shared pass — add a caller.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { categorizePlayerRole } from '@/lib/contacts/roles'

type Db = SupabaseClient<Database>

export type PlayerRecordKind = 'project' | 'opportunity'

export interface AddPlayerResult {
  /** The write happened. */
  added: boolean
  /** This person already held this role on this record — not an error. */
  alreadyThere: boolean
  error: string | null
}

/** What `role` becomes when a caller has nothing to say. Matches applySession. */
export const DEFAULT_PLAYER_ROLE = 'Contact'

/**
 * Who is already on a record, as `partyId:role` keys folded for comparison.
 *
 * Exported so a caller adding SEVERAL people reads the roll once rather than
 * once per person — which is what `applySession` does, and what a job applying
 * sixty proposals must do or it is sixty extra round trips.
 */
export async function loadPlayerRoll(
  db: Db,
  kind: PlayerRecordKind,
  recordId: string
): Promise<Set<string>> {
  const col = kind === 'project' ? 'project_id' : 'opportunity_id'
  const { data } = await db.from('project_players').select('party_id, role').eq(col, recordId)
  const roll = new Set<string>()
  for (const p of data ?? []) {
    roll.add(`${(p as { party_id: string | null }).party_id}:${((p as { role: string | null }).role ?? '').toLowerCase()}`)
  }
  return roll
}

export async function addPlayerToRecord(
  db: Db,
  input: {
    kind: PlayerRecordKind
    recordId: string
    partyId: string
    /** The prose. Falls back to {@link DEFAULT_PLAYER_ROLE}. */
    role?: string | null
    /** A roll already read by the caller, to avoid re-reading it per person. */
    roll?: Set<string>
  }
): Promise<AddPlayerResult> {
  const role = input.role?.trim() || DEFAULT_PLAYER_ROLE
  const roll = input.roll ?? (await loadPlayerRoll(db, input.kind, input.recordId))
  const key = `${input.partyId}:${role.toLowerCase()}`
  if (roll.has(key)) return { added: false, alreadyThere: true, error: null }

  const { error } = await db.from('project_players').insert({
    project_id: input.kind === 'project' ? input.recordId : null,
    opportunity_id: input.kind === 'opportunity' ? input.recordId : null,
    party_id: input.partyId,
    role,
    // The prose goes on `role`; the category comes from the ONE registry
    // (§4, 2026-10-21). Null when nothing is certain — never a guess.
    role_key: await categorizePlayerRole(role),
  })
  if (error) return { added: false, alreadyThere: false, error: error.message }
  roll.add(key)
  return { added: true, alreadyThere: false, error: null }
}
