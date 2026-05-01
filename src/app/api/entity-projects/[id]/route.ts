import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const body = await request.json()
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('entity_projects')
    .update({
      relationship: body.relationship,
      equity_pct: body.equity_pct != null && body.equity_pct !== '' ? Number(body.equity_pct) : null,
      notes: body.notes?.trim() || null,
    })
    .eq('id', id)
    .select('*, entity:entities(*)')
    .single()

  if (error) {
    console.error('Update entity-project failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
  return Response.json({ entityProject: data })
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const supabase = createAdminClient()

  const { error } = await supabase.from('entity_projects').delete().eq('id', id)

  if (error) {
    console.error('Unlink entity failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
  return new Response(null, { status: 204 })
}
