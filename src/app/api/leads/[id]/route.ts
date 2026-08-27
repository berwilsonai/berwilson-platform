import { NextRequest, NextResponse } from 'next/server'
import { getViewer } from '@/lib/auth/viewer'
import { leadsDb, type LeadRow, type LeadStatus } from '@/lib/leads/db'
import { LEAD_ROUTES, type LeadRoute } from '@/lib/ai/prompts/lead-triage'
import { refreshLeadLabel } from '@/lib/leads/gmail-sync'

const STATUSES: LeadStatus[] = [
  'new',
  'reviewing',
  'promoted',
  'forwarded',
  'ignored',
  'expired',
  'spam',
]

/** GET one lead. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer()
  if (!viewer?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const { data, error } = await leadsDb().from('leads').select('*').eq('id', id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  return NextResponse.json({ lead: data as LeadRow })
}

/**
 * PATCH — the human corrections: change the routing the AI guessed, dismiss a
 * lead, or rescue one the filter wrongly rejected.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer()
  if (!viewer?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const patch: Record<string, unknown> = {}

  if ('status' in body) {
    const status = body.status
    if (!STATUSES.includes(status as LeadStatus)) {
      return NextResponse.json({ error: 'Unknown status.' }, { status: 400 })
    }
    patch.status = status
    // Rescuing a wrongly-filtered lead has to re-open scoring, or it would sit
    // in the queue permanently unscored.
    if (status !== 'spam') patch.spam_reason = null
  }

  if ('route' in body) {
    if (!LEAD_ROUTES.includes(body.route as LeadRoute)) {
      return NextResponse.json({ error: 'Unknown route.' }, { status: 400 })
    }
    patch.route = body.route
  }

  if ('notes' in body) {
    patch.notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null
  }

  // Queue an unscored lead for the next sweep — used by "Not spam".
  if (body.rescore === true) {
    patch.score_state = 'pending'
    patch.score_error = null
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  }

  const { data, error } = await leadsDb()
    .from('leads')
    .update(patch)
    .eq('id', id)
    .select('*')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  // Push the decision out to Gmail now rather than at tomorrow's sweep — the
  // people who act on the mailbox cannot see this queue.
  if ('status' in body) refreshLeadLabel(data as LeadRow)

  return NextResponse.json({ lead: data as LeadRow })
}

/**
 * DELETE removes the lead row only. The underlying email_threads row stays, so
 * the thread is not re-triaged into a duplicate on the next sweep.
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer()
  if (!viewer?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const { error } = await leadsDb().from('leads').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
