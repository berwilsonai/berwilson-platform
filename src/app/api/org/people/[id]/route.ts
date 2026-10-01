import { NextRequest } from 'next/server'
import { getViewer, forbiddenJson, actorAdminClient } from '@/lib/auth/viewer'
import { orgTier, orgPersonStatus } from '@/lib/utils/org'
import type { TablesUpdate } from '@/lib/supabase/types'

// Admin-only by default-deny (see api/org/nodes/route.ts).

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const viewer = await getViewer()
  if (!viewer?.isAdmin) return forbiddenJson()

  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const update: TablesUpdate<'org_people'> = {}
  if (body.role !== undefined) {
    const role = (body.role as string)?.trim()
    if (!role) return Response.json({ error: 'role cannot be empty' }, { status: 400 })
    update.role = role
  }
  if (body.name !== undefined) update.name = (body.name as string)?.trim() || null
  if (body.detail !== undefined) update.detail = (body.detail as string)?.trim() || null
  if (body.status !== undefined) {
    update.status = orgPersonStatus(body.status as string)
    if (update.status === 'open') update.name = null
    // A departure is a date, not a flag. Filled only when it is blank —
    // re-marking someone departed must not move the date they actually left.
    if (update.status === 'departed') {
      const supplied = typeof body.departed_on === 'string' ? body.departed_on.trim() : ''
      update.departed_on = /^\d{4}-\d{2}-\d{2}$/.test(supplied)
        ? supplied
        : new Date().toISOString().slice(0, 10)
    }
    if (update.status === 'active') update.departed_on = null
  } else if (typeof body.departed_on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.departed_on.trim())) {
    update.departed_on = body.departed_on.trim()
  }
  if (body.tier !== undefined) update.tier = orgTier(body.tier as string)
  if ('node_id' in body) update.node_id = (body.node_id as string) || null
  if (typeof body.sort_order === 'number') update.sort_order = body.sort_order

  if (Object.keys(update).length === 0) {
    return Response.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const supabase = await actorAdminClient()
  const { data, error } = await supabase
    .from('org_people')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ person: data })
}

/**
 * DELETE — retire first, remove second.
 *
 * ⚠ THIS USED TO BE A HARD DELETE AND THAT WAS THE BUG. A person left, the row
 * vanished, and nothing recorded that they had ever held the box — no date, no
 * reason, no trace. §12's rule is that the row is the tombstone.
 *
 * So the first press on a NAMED, active person marks them departed and keeps
 * them in the record. A second press removes the box, which is the right act for
 * a seat that genuinely no longer exists. A vacant seat (status 'open', no name)
 * removes immediately — there is no person behind it to keep.
 *
 * Either way there is now a net underneath: log_activity fires on org_people as
 * of 2026-09-30 and writes to_jsonb(old) into activity_log.metadata on DELETE,
 * and activity_log has no UPDATE or DELETE policy. The row outlives its own
 * deletion in an append-only log.
 *
 * The employment record is separate and is NOT touched here — /company/people
 * owns separations, and deleting a box must never look like firing somebody.
 */
export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const viewer = await getViewer()
  if (!viewer?.isAdmin) return forbiddenJson()

  const { id } = await params
  const supabase = await actorAdminClient()

  const { data: person, error: readError } = await supabase
    .from('org_people')
    .select('name, status')
    .eq('id', id)
    .maybeSingle()
  if (readError) return Response.json({ error: readError.message }, { status: 500 })
  if (!person) return Response.json({ error: 'That person is no longer on the chart.' }, { status: 404 })

  const named = Boolean(person.name?.trim())
  const alreadyDeparted = person.status === 'departed'

  if (named && !alreadyDeparted) {
    const { data, error } = await supabase
      .from('org_people')
      .update({ status: 'departed', departed_on: new Date().toISOString().slice(0, 10) })
      .eq('id', id)
      .select()
      .single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({
      departed: true,
      person: data,
      message: `${person.name} is marked departed and stays in the record. Remove again to take the box off the chart.`,
    })
  }

  const { error } = await supabase.from('org_people').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ deleted: true })
}
