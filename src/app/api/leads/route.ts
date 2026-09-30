import { NextRequest, NextResponse } from 'next/server'
import { getViewer } from '@/lib/auth/viewer'
import { leadsDb, OPEN_LEAD_STATUSES, type LeadRow } from '@/lib/leads/db'
import { categoriesByKey } from '@/lib/leads/categories'

/**
 * GET /api/leads
 *
 * Admin-only by default-deny: /api/leads is in no ROLE_API_PREFIXES allowlist,
 * so the middleware already blocks every non-admin role. The in-route guard is
 * belt-and-braces, matching the investors/org precedent.
 *
 * ?route=  any lead_categories.key (see /settings/lead-categories)
 * ?status= a lead status, or 'open' (the default working queue)
 * ?q=      free text over title / sender / summary
 */
export async function GET(request: NextRequest) {
  const viewer = await getViewer()
  if (!viewer?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const params = request.nextUrl.searchParams
  const db = leadsDb()

  let query = db.from('leads').select('*')

  const status = params.get('status')
  if (!status || status === 'open') {
    query = query.in('status', OPEN_LEAD_STATUSES)
  } else if (status !== 'all') {
    query = query.eq('status', status)
  }

  // Checked against the registry rather than a baked-in list. An unknown key
  // is ignored rather than 400'd, matching how ?status= behaves — a stale
  // bookmark from a renamed category should show the whole queue, not an error.
  const route = params.get('route')
  if (route && (await categoriesByKey()).has(route)) query = query.eq('route', route)

  const q = params.get('q')?.trim()
  if (q) {
    const safe = q.replace(/[%,()]/g, ' ')
    query = query.or(
      `title.ilike.%${safe}%,sender_company.ilike.%${safe}%,sender_name.ilike.%${safe}%,summary.ilike.%${safe}%`
    )
  }

  // Soonest bid first — the queue's whole point is not missing a due date.
  const { data, error } = await query
    .order('bid_due_date', { ascending: true, nullsFirst: false })
    .order('fit_score', { ascending: false, nullsFirst: false })
    .limit(Math.min(Number(params.get('limit')) || 200, 500))

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ leads: (data ?? []) as LeadRow[] })
}
