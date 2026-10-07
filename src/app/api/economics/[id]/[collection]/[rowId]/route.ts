/**
 * PATCH  /api/economics/[id]/[collection]/[rowId]
 * DELETE /api/economics/[id]/[collection]/[rowId]
 *
 * ⚠ EVERY WRITE IS FILTERED BY `economics_id` AS WELL AS BY ROW ID. A row id is
 * a uuid the caller supplies, and without the second filter a caller with
 * access to one deal could patch a line belonging to a deal they cannot see.
 * The access check above proves they may touch THIS model; the filter is what
 * ties the row to it.
 */

import { NextRequest } from 'next/server'
import { forbiddenJson } from '@/lib/auth/viewer'
import { actorFrom, requireEconomicsAccess } from '@/lib/economics/access'
import {
  explainEconomicsError,
  getCollection,
  normalizeCollectionPayload,
} from '@/lib/economics/collections'
import { calcDbAs } from '@/lib/economics/db'
import { assertSpvBelongs } from '@/lib/spvs/access'

type Params = { params: Promise<{ id: string; collection: string; rowId: string }> }

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id, collection, rowId } = await params
  const spec = getCollection(collection)
  if (!spec) return Response.json({ error: 'Unknown collection' }, { status: 404 })

  const access = await requireEconomicsAccess(id)
  if (!access.ok) return access.response
  if (!access.viewer.isAdmin) return forbiddenJson('Admin only')

  const body = (await request.json()) as Record<string, unknown>
  // `partial: true`, so clearing one price does not blank the rest of the row.
  const normalized = normalizeCollectionPayload(spec, body, { partial: true })
  if (!normalized.ok) return Response.json({ error: normalized.error }, { status: 400 })
  if (Object.keys(normalized.value).length === 0) {
    return Response.json({ error: 'Nothing to update' }, { status: 400 })
  }

  // A PATCH can MOVE a line onto another vehicle, so it needs the same check
  // the create does. The guard is shared for exactly this reason.
  const spvCheck = await assertSpvBelongs(normalized.value.spv_id, access.owner)
  if (spvCheck) return spvCheck

  const { data, error } = await calcDbAs(actorFrom(access.viewer))
    .from(spec.table)
    .update(normalized.value)
    .eq('id', rowId)
    .eq('economics_id', id)
    .select('*')
    .maybeSingle()

  if (error) {
    return Response.json({ error: explainEconomicsError(error.message, error.code) }, { status: 400 })
  }
  if (!data) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json({ row: data })
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id, collection, rowId } = await params
  const spec = getCollection(collection)
  if (!spec) return Response.json({ error: 'Unknown collection' }, { status: 404 })

  const access = await requireEconomicsAccess(id)
  if (!access.ok) return access.response
  if (!access.viewer.isAdmin) return forbiddenJson('Admin only')

  const { error, count } = await calcDbAs(actorFrom(access.viewer))
    .from(spec.table)
    .delete({ count: 'exact' })
    .eq('id', rowId)
    .eq('economics_id', id)

  if (error) {
    return Response.json({ error: explainEconomicsError(error.message, error.code) }, { status: 400 })
  }
  if ((count ?? 0) === 0) return Response.json({ error: 'Not found' }, { status: 404 })

  // A deleted line may have been the one a fee was charged against. The engine
  // reports that as an error naming both lines on the next compute, which is
  // the right place: the reader sees it beside the fee rather than in a toast.
  return Response.json({ deleted: true })
}
