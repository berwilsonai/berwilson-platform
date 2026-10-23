/**
 * PATCH  /api/spvs/[id] — edit a vehicle.
 * DELETE /api/spvs/[id] — remove one, if nothing is earned in it.
 *
 * ⚠ THE EDIT PATH IS THE POINT OF THIS ROUTE. Before it, changing a vehicle's
 * name or its ownership split meant deleting it and adding it again, which took
 * the participant ledger with it.
 *
 * ⚠ THE DELETE NO LONGER CHECKS FOR REVENUE EARNED IN THE VEHICLE, BECAUSE
 * THERE IS NO LONGER ANYWHERE FOR REVENUE TO BE EARNED (2026-10-23). It counted
 * `economics_lines` with this `spv_id` and refused, because that column was
 * `on delete set null` and deleting the vehicle would have quietly moved its
 * revenue to Ber Wilson Corporation and reported it as wholly ours. The
 * calculator was removed and the table with it. ⚠ WHEN THE MODEL COMES BACK
 * FROM EXCEL AND ITS LINES NAME A VEHICLE AGAIN, THIS CHECK HAS TO COME BACK
 * WITH IT — a silently bigger figure is the worst outcome available here.
 */

import { NextRequest } from 'next/server'
import { forbiddenJson } from '@/lib/auth/viewer'
import { actorFrom, requireSpvAccess } from '@/lib/spvs/access'
import { explainSpvError, normalizeSpv } from '@/lib/spvs/collections'
import { spvDbAs } from '@/lib/spvs/db'
import { resolveOrgNodeName } from '@/lib/spvs/org-node'

type Params = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params
  const access = await requireSpvAccess(id)
  if (!access.ok) return access.response
  if (!access.viewer.isAdmin) return forbiddenJson('Admin only')

  const body = (await request.json()) as Record<string, unknown>
  // `partial: true`, so clearing the jurisdiction does not blank the rest.
  const normalized = normalizeSpv(body, { partial: true })
  if (!normalized.ok) return Response.json({ error: normalized.error }, { status: 400 })
  if (Object.keys(normalized.value).length === 0) {
    return Response.json({ error: 'Nothing to update' }, { status: 400 })
  }

  // Re-snapshot only when the link itself was in the body: a PATCH that never
  // mentioned `org_node_id` must not touch the stored name.
  const snapshot =
    'org_node_id' in normalized.value
      ? await resolveOrgNodeName(normalized.value.org_node_id)
      : { value: {} }
  if ('error' in snapshot) return Response.json(snapshot, { status: 400 })

  const { data, error } = await spvDbAs(actorFrom(access.viewer))
    .from('project_spvs')
    .update({ ...normalized.value, ...snapshot.value })
    .eq('id', id)
    .select('*')
    .maybeSingle()

  if (error) {
    return Response.json({ error: explainSpvError(error.message, error.code) }, { status: 400 })
  }
  if (!data) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json({ row: data })
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params
  const access = await requireSpvAccess(id)
  if (!access.ok) return access.response
  if (!access.viewer.isAdmin) return forbiddenJson('Admin only')

  // Participants cascade. They are recoverable from `activity_log`, which
  // stores `to_jsonb(old)` on every delete — which is what makes a cap-table
  // ledger safe to edit in place.
  const { error } = await spvDbAs(actorFrom(access.viewer))
    .from('project_spvs')
    .delete()
    .eq('id', id)

  if (error) {
    return Response.json({ error: explainSpvError(error.message, error.code) }, { status: 400 })
  }
  return Response.json({ deleted: true })
}
