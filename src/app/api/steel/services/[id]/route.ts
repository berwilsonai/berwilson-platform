import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, canSeeSteelFinancials, forbiddenJson } from '@/lib/auth/viewer'

interface RouteContext {
  params: Promise<{ id: string }>
}

/** PATCH — mark a service's salesperson commission paid/unpaid. Financials-only. */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id } = await params

  // /api/steel is allowlisted for steel_sales too, so guard financials here.
  const viewer = await getViewer()
  if (!canSeeSteelFinancials(viewer)) return forbiddenJson()

  let body: { paid?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (typeof body.paid !== 'boolean') {
    return Response.json({ error: 'paid (boolean) is required' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('steel_deal_services')
    .update({
      commission_paid: body.paid,
      commission_paid_date: body.paid ? new Date().toISOString().slice(0, 10) : null,
    })
    .eq('id', id)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
