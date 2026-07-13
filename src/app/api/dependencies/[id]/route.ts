/**
 * PATCH /api/dependencies/[id] — update a dependency (status, severity, description)
 * DELETE /api/dependencies/[id] — delete a dependency
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database'

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
  const supabase = createAdminClient()

  const { error } = await supabase
    .from('project_dependencies')
    .delete()
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ deleted: true })
}
