/**
 * GET /api/dependencies — list all active dependencies (optionally filtered by project)
 * POST /api/dependencies — create a new dependency
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('project_id')
  const supabase = createAdminClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase as any)
    .from('project_dependencies')
    .select('*, upstream:projects!project_dependencies_upstream_project_id_fkey(id, name), downstream:projects!project_dependencies_downstream_project_id_fkey(id, name)')
    .order('created_at', { ascending: false })

  if (projectId) {
    q = q.or(`upstream_project_id.eq.${projectId},downstream_project_id.eq.${projectId}`)
  }

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ dependencies: data ?? [] })
}

export async function POST(request: NextRequest) {
  let body: {
    upstream_project_id?: string
    downstream_project_id?: string
    dependency_type?: string
    description?: string
    severity?: string
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.upstream_project_id || !body.downstream_project_id) {
    return NextResponse.json({ error: 'upstream_project_id and downstream_project_id are required' }, { status: 400 })
  }

  if (body.upstream_project_id === body.downstream_project_id) {
    return NextResponse.json({ error: 'A project cannot depend on itself' }, { status: 400 })
  }

  const supabase = createAdminClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('project_dependencies')
    .insert({
      upstream_project_id: body.upstream_project_id,
      downstream_project_id: body.downstream_project_id,
      dependency_type: body.dependency_type ?? 'blocks',
      description: body.description ?? null,
      severity: body.severity ?? 'watch',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ dependency: data }, { status: 201 })
}
