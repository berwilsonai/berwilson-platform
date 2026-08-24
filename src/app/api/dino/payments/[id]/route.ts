import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, forbiddenJson } from '@/lib/auth/viewer'
import type { TablesUpdate } from '@/lib/supabase/types'

interface RouteContext {
  params: Promise<{ id: string }>
}

// Partial update — the mark-paid toggle sends only { paid }, the edit form
// sends the full set. Applying only the keys present avoids the toggle wiping
// the amount. When paid flips true, a paid_date is stamped (today) unless one
// is supplied; flipping false clears it.
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id } = await params

  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) return forbiddenJson()

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() !== '' ? v.trim() : null

  const update: TablesUpdate<'dino_payments'> = {}

  if ('label' in body) update.label = str(body.label)
  if ('due_date' in body) update.due_date = str(body.due_date)
  if ('notes' in body) update.notes = str(body.notes)
  if ('amount' in body) {
    const v = body.amount
    const parsed = v == null || v === '' ? null : typeof v === 'number' ? v : parseFloat(String(v))
    if (parsed !== null && (isNaN(parsed) || parsed < 0)) {
      return Response.json({ error: 'Amount must be a positive number.' }, { status: 400 })
    }
    update.amount = parsed ?? 0
  }
  if ('paid' in body) {
    const paid = body.paid === true || body.paid === 'true'
    update.paid = paid
    update.paid_date = paid ? str(body.paid_date) ?? new Date().toISOString().slice(0, 10) : null
  }

  if (Object.keys(update).length === 0) {
    return Response.json({ error: 'No fields to update' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('dino_payments')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ payment: data })
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const { id } = await params

  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) return forbiddenJson()

  const supabase = createAdminClient()
  const { error } = await supabase.from('dino_payments').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ success: true })
}
