import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { TablesUpdate } from '@/lib/supabase/types'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json()

  const update: TablesUpdate<'stakeholder_relationships'> = {}
  if (body.role !== undefined) update.role = body.role || null
  if (body.temperature !== undefined) update.temperature = body.temperature || null
  if (body.next_scheduled !== undefined) update.next_scheduled = body.next_scheduled || null
  if (body.notes !== undefined) update.notes = body.notes?.trim() || null

  const { data, error } = await supabase
    .from('stakeholder_relationships')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Update stakeholder failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ stakeholder: data })
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { error } = await supabase.from('stakeholder_relationships').delete().eq('id', id)

  if (error) {
    console.error('Delete stakeholder failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ ok: true })
}
