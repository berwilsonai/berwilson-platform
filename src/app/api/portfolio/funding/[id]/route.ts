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

  const update: TablesUpdate<'funding_sources'> = {}
  if (body.source_name !== undefined) update.source_name = body.source_name?.trim()
  if (body.category !== undefined) update.category = body.category
  if (body.agency !== undefined) update.agency = body.agency || null
  if (body.amount !== undefined) update.amount = body.amount
  if (body.status !== undefined) update.status = body.status || null
  if (body.contact_party_id !== undefined) update.contact_party_id = body.contact_party_id || null
  if (body.notes !== undefined) update.notes = body.notes?.trim() || null

  const { data, error } = await supabase
    .from('funding_sources')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Update funding source failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ funding_source: data })
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { error } = await supabase.from('funding_sources').delete().eq('id', id)

  if (error) {
    console.error('Delete funding source failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ ok: true })
}
