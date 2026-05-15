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

  const update: TablesUpdate<'compliance_items'> = {}
  if (body.framework !== undefined) update.framework = body.framework?.trim()
  if (body.requirement !== undefined) update.requirement = body.requirement?.trim()
  if (body.status !== undefined) update.status = body.status || null
  if (body.due_date !== undefined) update.due_date = body.due_date || null
  if (body.notes !== undefined) update.notes = body.notes?.trim() || null

  const { data, error } = await supabase
    .from('compliance_items')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Update compliance item failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ compliance_item: data })
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { error } = await supabase.from('compliance_items').delete().eq('id', id)

  if (error) {
    console.error('Delete compliance item failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ ok: true })
}
