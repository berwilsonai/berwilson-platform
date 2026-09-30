import { NextRequest, NextResponse } from 'next/server'
import { getViewer } from '@/lib/auth/viewer'
import { leadsDb, type LeadRow } from '@/lib/leads/db'
import { forwardLeadToDino } from '@/lib/leads/forward'
import { refreshLeadLabel } from '@/lib/leads/gmail-sync'

export const maxDuration = 120

/**
 * POST /api/leads/[id]/forward  { to? }
 *
 * Hands a plumbing/HVAC lead to Dino Service Pros by email, with the brief and
 * the original files attached. Dino has no platform login and no tailnet access,
 * so their inbox is the only delivery that actually reaches them.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer()
  if (!viewer?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const to =
    (typeof body.to === 'string' && body.to.trim()) || process.env.DINO_LEAD_EMAIL || ''

  if (!to || !to.includes('@')) {
    return NextResponse.json(
      { error: 'No destination address. Set DINO_LEAD_EMAIL, or pass one in the request.' },
      { status: 400 }
    )
  }

  const { data, error } = await leadsDb().from('leads').select('*').eq('id', id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  try {
    const result = await forwardLeadToDino(data as LeadRow, to)
    // Mark the thread handed off, so info@ does not work it again.
    refreshLeadLabel({ ...(data as LeadRow), status: 'forwarded' })
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[api/leads/forward] failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
