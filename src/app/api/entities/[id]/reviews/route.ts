import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('entity_reviews')
    .select('*, projects(id, name)')
    .eq('entity_id', id)
    .order('reviewed_at', { ascending: false })

  if (error) {
    console.error('Fetch entity reviews failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
  return Response.json({ reviews: data })
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const body = await request.json()
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('entity_reviews')
    .insert({
      entity_id: id,
      project_id: body.project_id || null,
      rating: Number(body.rating),
      on_time: body.on_time ?? null,
      on_budget: body.on_budget ?? null,
      would_rehire: body.would_rehire ?? null,
      notes: body.notes?.trim() || null,
      reviewed_by: body.reviewed_by?.trim() || null,
      reviewed_at: body.reviewed_at || new Date().toISOString(),
    })
    .select('*, projects(id, name)')
    .single()

  if (error) {
    console.error('Create entity review failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
  return Response.json({ review: data }, { status: 201 })
}
