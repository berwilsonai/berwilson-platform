/**
 * Who may read or write a deal's vehicles.
 *
 * ⚠ THESE ROUTES TAKE A VEHICLE ID IN THE PATH, NOT A PROJECT ID, SO THE
 * MIDDLEWARE STEP-UP GATE CANNOT SEE THEM. That gate only fires on a project id
 * in the PATH. A confidential project is therefore protected here or nowhere,
 * which is why every handler's first act is to resolve the vehicle back to its
 * owning record and ask `canAccessRecord` — the choke point that already
 * carries the `hiddenProjectIds` check.
 *
 * ⚠ AND IT RESOLVES THE OWNER FROM THE DATABASE, NEVER FROM THE REQUEST. A body
 * carrying both a vehicle id and a project id could name a project the caller
 * may see and a vehicle belonging to one they may not.
 */

import { canAccessRecord, forbiddenJson, getViewer, type Viewer } from '@/lib/auth/viewer'
import { RECORD_SCOPE_COLUMN, type RecordKind } from '@/lib/records/scope'
import { spvDb } from './db'

export interface SpvOwner {
  spvId: string
  kind: RecordKind
  recordId: string
}

export type SpvAccessResult =
  | { ok: true; viewer: Viewer; owner: SpvOwner }
  | { ok: false; response: Response }

function notFound(): Response {
  // 404 rather than 403, matching the economics routes and the project layout:
  // refusing with "forbidden" confirms the vehicle exists, and on a protected
  // project the fact that Ber Wilson is structuring a deal at all is itself the
  // sensitive fact.
  return Response.json({ error: 'Not found' }, { status: 404 })
}

/** Resolve a vehicle id to the record that owns it. */
export async function ownerOfSpv(spvId: string): Promise<SpvOwner | null> {
  const { data, error } = await spvDb()
    .from('project_spvs')
    .select('id,project_id,opportunity_id')
    .eq('id', spvId)
    .maybeSingle()
  if (error) throw new Error(`Could not resolve the vehicle: ${error.message}`)
  if (!data) return null

  const row = data as { id: string; project_id: string | null; opportunity_id: string | null }
  if (row.project_id) return { spvId: row.id, kind: 'project', recordId: row.project_id }
  if (row.opportunity_id) {
    return { spvId: row.id, kind: 'opportunity', recordId: row.opportunity_id }
  }
  // The CHECK makes this unreachable; treating it as missing rather than
  // throwing means a hypothetical bad row cannot be read by anyone.
  return null
}

/** The guard every handler on an existing vehicle runs first. */
export async function requireSpvAccess(spvId: string): Promise<SpvAccessResult> {
  const viewer = await getViewer()
  if (!viewer) return { ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) }

  const owner = await ownerOfSpv(spvId)
  if (!owner) return { ok: false, response: notFound() }

  if (!(await canAccessRecord(viewer, owner.kind, owner.recordId))) {
    return { ok: false, response: forbiddenJson() }
  }
  return { ok: true, viewer, owner }
}

export { requireRecordAccess, actorFrom } from '@/lib/economics/access'

/**
 * Refuse a `spv_id` that belongs to a different deal.
 *
 * ⚠ A VEHICLE IS NOT A CHILD OF THE ECONOMICS MODEL, SO ITS ID MUST BE CHECKED
 * BY HAND. `spv_id` is a whitelisted uuid on `economics_lines`, and the
 * whitelist can only stop a column being written — not stop it being written
 * with another deal's value. Without this a body could attribute this deal's
 * revenue to another deal's vehicle, and the ownership weight would then come
 * from a split nobody on this deal agreed to.
 *
 * Lives here rather than in either route because BOTH the create and the patch
 * can set the column, and a guard that only half the writers call is the half
 * that gets forgotten (§12 — a security filter belongs at the choke point).
 *
 * Returns a Response on refusal, and null when there is nothing to check: a
 * line with no vehicle is earned by the parent company, which is the normal
 * case and not an error.
 */
export async function assertSpvBelongs(
  spvId: unknown,
  owner: { kind: RecordKind; recordId: string }
): Promise<Response | null> {
  if (typeof spvId !== 'string' || !spvId) return null

  const { data, error } = await spvDb()
    .from('project_spvs')
    .select('id')
    .eq('id', spvId)
    .eq(RECORD_SCOPE_COLUMN[owner.kind], owner.recordId)
    .maybeSingle()
  if (error) {
    return Response.json(
      { error: `Could not check the vehicle: ${error.message}` },
      { status: 400 }
    )
  }
  if (!data) {
    return Response.json(
      {
        error:
          'That vehicle does not belong to this deal. Pick one of this deal’s own vehicles, or leave it empty so the line is earned by Ber Wilson Corporation.',
      },
      { status: 400 }
    )
  }
  return null
}
