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

  const { category, item, severity, status, assigned_to, notes, resolved_at } = body

  const update: TablesUpdate<'dd_items'> = {}
  if (category !== undefined) update.category = category
  if (item !== undefined) update.item = item?.trim()
  if (severity !== undefined) update.severity = severity
  if (status !== undefined) update.status = status
  if ('assigned_to' in body) update.assigned_to = assigned_to || null
  if (notes !== undefined) update.notes = notes?.trim() || null
  if ('resolved_at' in body) update.resolved_at = resolved_at || null

  // Auto-set resolved_at when status transitions to resolved
  if (status === 'resolved' && !('resolved_at' in body)) {
    update.resolved_at = new Date().toISOString()
  } else if (status && status !== 'resolved' && !('resolved_at' in body)) {
    update.resolved_at = null
  }

  const { data, error } = await supabase
    .from('dd_items')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Update dd_item failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ dd_item: data })
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { error } = await supabase.from('dd_items').delete().eq('id', id)

  if (error) {
    console.error('Delete dd_item failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ ok: true })
}
