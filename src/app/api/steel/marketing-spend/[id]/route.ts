import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, canWorkSteel, forbiddenJson } from '@/lib/auth/viewer'
import type { TablesUpdate } from '@/lib/supabase/types'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const viewer = await getViewer()
  if (!canWorkSteel(viewer)) return forbiddenJson()

  const { id } = await params
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const update: TablesUpdate<'steel_marketing_spend'> = {}
  if ('channel' in body) {
    const c = typeof body.channel === 'string' ? body.channel.trim() : ''
    if (!c) return Response.json({ error: 'Channel cannot be empty.' }, { status: 400 })
    update.channel = c
  }
  if ('amount' in body) {
    const a = Number(body.amount)
    if (!isFinite(a) || a < 0) return Response.json({ error: 'Amount must be a positive number.' }, { status: 400 })
    update.amount = a
  }
  if ('spend_month' in body) {
    const m = /^(\d{4})-(\d{2})/.exec(typeof body.spend_month === 'string' ? body.spend_month : '')
    if (!m) return Response.json({ error: 'Invalid month.' }, { status: 400 })
    update.spend_month = `${m[1]}-${m[2]}-01`
  }
  if ('description' in body) update.description = typeof body.description === 'string' ? body.description.trim() || null : null
  if ('notes' in body) update.notes = typeof body.notes === 'string' ? body.notes.trim() || null : null

  if (Object.keys(update).length === 0) {
    return Response.json({ error: 'No fields to update' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase.from('steel_marketing_spend').update(update).eq('id', id).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ spend: data })
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const viewer = await getViewer()
  if (!canWorkSteel(viewer)) return forbiddenJson()

  const { id } = await params
  const supabase = createAdminClient()
  const { error } = await supabase.from('steel_marketing_spend').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}
