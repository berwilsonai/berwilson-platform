import { NextRequest, NextResponse } from 'next/server'
import { getViewer } from '@/lib/auth/viewer'
import { leadsDb, type LeadRow } from '@/lib/leads/db'
import { handOffLead } from '@/lib/leads/handoff'
import { refreshLeadLabel } from '@/lib/leads/gmail-sync'

export const maxDuration = 120

/**
 * POST /api/leads/[id]/handoff  { to? }
 *
 * Hands a lead to the team that does the work — by email, with the brief, the
 * original files, and a link to the lane's Drive folder. Those teams have no
 * platform login and no tailnet access, so their inbox is the only delivery
 * that reaches them.
 *
 * The address comes from the lead's CATEGORY. `to` overrides it for a one-off
 * recipient and is not the normal path: routing a lane somewhere new belongs in
 * Settings → Lead categories, where it persists, rather than in a request that
 * is forgotten the moment it returns.
 *
 * Was /forward, addressed to Dino alone off the DINO_LEAD_EMAIL env var — which
 * was never set, so every press 400'd.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer()
  if (!viewer?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const to = typeof body.to === 'string' && body.to.trim() ? body.to.trim() : undefined

  const { data, error } = await leadsDb().from('leads').select('*').eq('id', id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  const lead = data as LeadRow
  if (lead.status === 'forwarded') {
    return NextResponse.json(
      { error: `This lead was already handed to ${lead.forwarded_to ?? 'someone'}.` },
      { status: 409 }
    )
  }

  try {
    const result = await handOffLead(lead, to)
    // Mark the thread handed off, so nobody works info@ again on this one.
    refreshLeadLabel({ ...lead, status: 'forwarded' })
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[api/leads/handoff] failed:', message)
    // A missing handoff address is the caller's to fix in settings, not a
    // server fault — 400 so the UI shows the sentence rather than "failed".
    const status = /handoff address/i.test(message) ? 400 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
