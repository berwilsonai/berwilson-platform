/**
 * PATCH  /api/spvs/[id]/participants/[rowId] — edit a participant.
 * DELETE /api/spvs/[id]/participants/[rowId] — remove one.
 *
 * ⚠ EVERY WRITE FILTERS ON `spv_id` AS WELL AS ON THE ROW ID. A row id is a
 * uuid the caller supplies, and without the second filter a caller with access
 * to one deal could edit a participant on a deal they cannot see — the access
 * guard above only proves they may touch THIS vehicle. Same contract as
 * src/app/api/economics/[id]/[collection]/[rowId]/route.ts.
 */

import { NextRequest } from 'next/server'
import { forbiddenJson } from '@/lib/auth/viewer'
import { actorFrom, requireSpvAccess } from '@/lib/spvs/access'
import { explainSpvError, normalizeParticipant } from '@/lib/spvs/collections'
import { spvDbAs } from '@/lib/spvs/db'

type Params = { params: Promise<{ id: string; rowId: string }> }

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id, rowId } = await params
  const access = await requireSpvAccess(id)
  if (!access.ok) return access.response
  if (!access.viewer.isAdmin) return forbiddenJson('Admin only')

  const body = (await request.json()) as Record<string, unknown>
  // `partial: true`, so clearing a funded figure does not blank the commitment.
  const normalized = normalizeParticipant(body, { partial: true })
  if (!normalized.ok) return Response.json({ error: normalized.error }, { status: 400 })
  if (Object.keys(normalized.value).length === 0) {
    return Response.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { data, error } = await spvDbAs(actorFrom(access.viewer))
    .from('project_spv_participants')
    .update(normalized.value)
    .eq('id', rowId)
    .eq('spv_id', id)
    .select('*')
    .maybeSingle()

  if (error) {
    return Response.json({ error: explainSpvError(error.message, error.code) }, { status: 400 })
  }
  if (!data) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json({ row: data })
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id, rowId } = await params
  const access = await requireSpvAccess(id)
  if (!access.ok) return access.response
  if (!access.viewer.isAdmin) return forbiddenJson('Admin only')

  // Recoverable from `activity_log`: the trigger stores `to_jsonb(old)` in
  // `metadata` on every delete, so a split removed by mistake can be read back.
  const { error } = await spvDbAs(actorFrom(access.viewer))
    .from('project_spv_participants')
    .delete()
    .eq('id', rowId)
    .eq('spv_id', id)

  if (error) {
    return Response.json({ error: explainSpvError(error.message, error.code) }, { status: 400 })
  }
  return Response.json({ deleted: true })
}
