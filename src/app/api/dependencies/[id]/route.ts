/**
 * PATCH /api/dependencies/[id] — update a dependency (status, severity, description)
 * DELETE /api/dependencies/[id] — delete a dependency
 *
 * ⚠ DELIBERATELY NOT IN THE CHILD REGISTRY (src/lib/records/children.ts). Every
 * table there hangs off ONE record, named by exactly one of two columns; a
 * dependency names TWO projects and is the relationship between them, so its
 * guard has to be satisfied at both ends and its list drops a row when EITHER
 * end is protected. Generalising the registry to cover a second parent shape
 * for a single table would be a concept earning its keep in one place — so this
 * route keeps its own file and got the guard it was missing instead.
 *
 * Both ends, because editing a dependency from the open end is a write against
 * the protected one — the same reasoning the collection route already applied
 * on create.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAccessAll } from '@/lib/security/guard'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database'

/** Read the pair of projects a dependency joins, so both can be guarded. */
async function dependencyEnds(id: string): Promise<string[] | null> {
  const { data } = await createAdminClient()
    .from('project_dependencies')
    .select('upstream_project_id, downstream_project_id')
    .eq('id', id)
    .maybeSingle()
  if (!data) return null
  return [data.upstream_project_id, data.downstream_project_id]
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  let body: { status?: string; severity?: string; description?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const ends = await dependencyEnds(id)
  if (!ends) return NextResponse.json({ error: 'That dependency no longer exists.' }, { status: 404 })
  const denied = await requireProjectAccessAll(ends)
  if (denied) return denied

  const supabase = createAdminClient()
  const update: Database['public']['Tables']['project_dependencies']['Update'] = {
    updated_at: new Date().toISOString(),
  }

  if (body.status) update.status = body.status
  if (body.severity) update.severity = body.severity
  if (body.description !== undefined) update.description = body.description
  if (body.status === 'resolved') update.resolved_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('project_dependencies')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ dependency: data })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const ends = await dependencyEnds(id)
  if (!ends) return NextResponse.json({ error: 'That dependency no longer exists.' }, { status: 404 })
  const denied = await requireProjectAccessAll(ends)
  if (denied) return denied

  const supabase = createAdminClient()

  const { error } = await supabase
    .from('project_dependencies')
    .delete()
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ deleted: true })
}
