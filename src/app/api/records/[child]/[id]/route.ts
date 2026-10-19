import { NextRequest, NextResponse } from 'next/server'

import { getViewer } from '@/lib/auth/viewer'
import { guardExistingRow } from '@/lib/records/children-access'
import { applyStamp, getChild } from '@/lib/records/children'
import { normalizePayload } from '@/lib/registry/fields'
import { createUntypedAdminClient } from '@/lib/supabase/admin'

/**
 * PATCH / DELETE one child row of a project or an opportunity.
 *
 * Same fixed child map and the same guard as the collection route — see the
 * header there and src/lib/records/children.ts. The two things this half adds:
 *
 *  - The parent is read off the ROW, not taken from the body. A client that
 *    could name its own parent could move a row onto a record it may write and
 *    edit it there, so `project_id` and `opportunity_id` are absent from every
 *    `fields` map and a re-parenting is simply not expressible.
 *  - The update is PARTIAL. Only keys present in the body are written, which is
 *    §12's rule that a field the caller never mentioned must be OMITTED rather
 *    than nulled — `financing/[id]` wrote `?? null` for all twelve of its
 *    columns and would have blanked a row on any partial PATCH.
 */

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ child: string; id: string }> }
) {
  const viewer = await getViewer()
  if (!viewer) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { child, id } = await params
  const spec = getChild(child)
  if (!spec) return NextResponse.json({ error: `Unknown record child "${child}"` }, { status: 404 })

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const guarded = await guardExistingRow(viewer, spec, id)
  if (!guarded.ok) return guarded.response

  const parsed = normalizePayload(spec, body, { partial: true })
  // A body that carries ONLY the stamp key is a legitimate edit — ticking a
  // milestone sends `{ completed: true }` and nothing else — so "nothing to
  // save" is only an error when the stamp has nothing to say either.
  const value: Record<string, unknown> = parsed.ok ? parsed.value : {}
  applyStamp(spec, body, value)
  if (!parsed.ok && Object.keys(value).length === 0) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  if (spec.touchUpdatedAt) value.updated_at = new Date().toISOString()

  const admin = createUntypedAdminClient({ id: viewer.authUserId, email: viewer.email })
  const { data, error } = await admin
    .from(spec.table)
    .update(value)
    .eq('id', id)
    .select(spec.select ?? '*')
    .maybeSingle()

  if (error) {
    if (error.code === '23505' && spec.conflict) {
      return NextResponse.json({ error: spec.conflict }, { status: 409 })
    }
    console.error(`[records/${child}] update ${id} failed:`, error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: `That ${spec.label} no longer exists.` }, { status: 404 })
  }

  return NextResponse.json({ row: data })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ child: string; id: string }> }
) {
  const viewer = await getViewer()
  if (!viewer) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { child, id } = await params
  const spec = getChild(child)
  if (!spec) return NextResponse.json({ error: `Unknown record child "${child}"` }, { status: 404 })

  /**
   * Four of the six tables had a delete route and two did not. The registry
   * keeps that surface identical rather than quietly granting two new
   * destructive verbs nothing asks for (§11 — no pre-building for a later
   * phase). Adding one is a line in the spec, on the day something needs it.
   */
  if (!spec.deletable) {
    return NextResponse.json(
      { error: `A ${spec.label} cannot be deleted from here.` },
      { status: 405 }
    )
  }

  const guarded = await guardExistingRow(viewer, spec, id)
  if (!guarded.ok) return guarded.response

  const admin = createUntypedAdminClient({ id: viewer.authUserId, email: viewer.email })
  const { error } = await admin.from(spec.table).delete().eq('id', id)

  if (error) {
    console.error(`[records/${child}] delete ${id} failed:`, error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ deleted: true })
}
