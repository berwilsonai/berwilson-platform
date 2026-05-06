import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface RouteContext {
  params: Promise<{ id: string; reviewId: string }>
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id, reviewId } = await params
  const body = await request.json()
  const supabase = createAdminClient()

  const updates: Record<string, unknown> = {}
  if ('rating' in body) updates.rating = Number(body.rating)
  if ('on_time' in body) updates.on_time = body.on_time
  if ('on_budget' in body) updates.on_budget = body.on_budget
  if ('would_rehire' in body) updates.would_rehire = body.would_rehire
  if ('notes' in body) updates.notes = body.notes?.trim() || null
  if ('reviewed_by' in body) updates.reviewed_by = body.reviewed_by?.trim() || null
  if ('project_id' in body) updates.project_id = body.project_id || null

  const { data, error } = await supabase
    .from('entity_reviews')
    .update(updates)
    .eq('id', reviewId)
    .eq('entity_id', id)
    .select('*, projects(id, name)')
    .single()

  if (error) {
    console.error('Update entity review failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
  return Response.json({ review: data })
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const { id, reviewId } = await params
  const supabase = createAdminClient()

  const { error } = await supabase
    .from('entity_reviews')
    .delete()
    .eq('id', reviewId)
    .eq('entity_id', id)

  if (error) {
    console.error('Delete entity review failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
  return new Response(null, { status: 204 })
}
