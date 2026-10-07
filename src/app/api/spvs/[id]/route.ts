/**
 * PATCH  /api/spvs/[id] — edit a vehicle.
 * DELETE /api/spvs/[id] — remove one, if nothing is earned in it.
 *
 * ⚠ THE EDIT PATH IS THE POINT OF THIS ROUTE. Before it, changing a vehicle's
 * name or its ownership split meant deleting it and adding it again — and
 * `economics_lines.spv_id` is `on delete set null`, so that silently reparented
 * every revenue line to Ber Wilson Corporation at 100%. A wrong number on the
 * screen with nothing reporting it.
 */

import { NextRequest } from 'next/server'
import { forbiddenJson } from '@/lib/auth/viewer'
import { actorFrom, requireSpvAccess } from '@/lib/spvs/access'
import { explainSpvError, normalizeSpv } from '@/lib/spvs/collections'
import { spvDb, spvDbAs } from '@/lib/spvs/db'
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

  // ⚠ REFUSE IF REVENUE IS EARNED HERE, AND NAME THE COUNT. `spv_id` is
  // `on delete set null`, so deleting a vehicle with lines in it does not fail
  // — it quietly moves that revenue to Ber Wilson Corporation and reports it as
  // wholly ours. Silently making a figure bigger is the worst outcome available
  // here, so the delete stops and says what is attached.
  const { count, error: countError } = await spvDb()
    .from('economics_lines')
    .select('id', { count: 'exact', head: true })
    .eq('spv_id', id)
  if (countError) {
    return Response.json(
      { error: `Could not check what this vehicle earns: ${countError.message}` },
      { status: 400 }
    )
  }
  if ((count ?? 0) > 0) {
    const n = count ?? 0
    return Response.json(
      {
        error: `${n} revenue ${n === 1 ? 'line is' : 'lines are'} earned in this vehicle. Move ${n === 1 ? 'it' : 'them'} to another vehicle first, or the revenue would silently become wholly ours.`,
      },
      { status: 409 }
    )
  }

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
