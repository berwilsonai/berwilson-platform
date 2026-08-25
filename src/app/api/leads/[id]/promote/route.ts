import { NextRequest, NextResponse } from 'next/server'
import { getViewer } from '@/lib/auth/viewer'
import { leadsDb, type LeadRow } from '@/lib/leads/db'
import { promoteLead, type PromoteTarget } from '@/lib/leads/promote'

export const maxDuration = 300

const TARGETS: PromoteTarget[] = ['project', 'opportunity', 'steel']

/**
 * POST /api/leads/[id]/promote  { target, capture_lead?, salesperson_id? }
 *
 * The gate between "an email arrived" and "we are pursuing this". Creates the
 * record, copies the RFP files onto it, indexes them, and drains the lead from
 * the queue. maxDuration is generous because indexing a bid package can mean
 * several local extraction passes.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer()
  if (!viewer?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const target = body.target as PromoteTarget

  if (!TARGETS.includes(target)) {
    return NextResponse.json(
      { error: `target must be one of ${TARGETS.join(', ')}.` },
      { status: 400 }
    )
  }

  const { data, error } = await leadsDb().from('leads').select('*').eq('id', id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  const lead = data as LeadRow
  if (lead.status === 'promoted') {
    return NextResponse.json({ error: 'This lead has already been promoted.' }, { status: 409 })
  }

  try {
    const result = await promoteLead(lead, target, {
      // Default the capture lead to whoever clicked — promotion means someone
      // owns it, and an owner-less pursuit is the thing this replaces.
      captureLead:
        (typeof body.capture_lead === 'string' && body.capture_lead.trim()) ||
        viewer.teamMemberName ||
        null,
      salespersonId: typeof body.salesperson_id === 'string' ? body.salesperson_id : null,
    })
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[api/leads/promote] failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
