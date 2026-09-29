import { NextRequest, NextResponse } from 'next/server'
import { getViewer } from '@/lib/auth/viewer'
import { leadsDb, type LeadRow } from '@/lib/leads/db'
import { promoteLead, type AttachTo, type PromoteTarget } from '@/lib/leads/promote'
import { refreshLeadLabel } from '@/lib/leads/gmail-sync'

export const maxDuration = 300

const TARGETS: PromoteTarget[] = ['project', 'opportunity', 'steel', 'attach']

/**
 * POST /api/leads/[id]/promote
 *   { target, capture_lead?, salesperson_id?, attach_to?: { kind, id } }
 *
 * The gate between "an email arrived" and "we are pursuing this". Creates the
 * record, copies the RFP files onto it, indexes them, and drains the lead from
 * the queue. maxDuration is generous because indexing a bid package can mean
 * several local extraction passes.
 *
 * `target: 'attach'` takes `attach_to` instead of creating anything — the deal
 * is real but already has a record, and a second one would split its documents
 * and its mail across both.
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

  // Validated here rather than inside promoteLead: by the time that function
  // runs it is already copying files, and a malformed body should fail before
  // anything has been written.
  let attachTo: AttachTo | null = null
  if (target === 'attach') {
    const raw = body.attach_to as { kind?: unknown; id?: unknown } | undefined
    const kind = raw?.kind
    const recordId = raw?.id
    if ((kind !== 'project' && kind !== 'opportunity') || typeof recordId !== 'string' || !recordId.trim()) {
      return NextResponse.json(
        { error: 'attach_to must be { kind: "project" | "opportunity", id: "<uuid>" }.' },
        { status: 400 }
      )
    }
    attachTo = { kind, id: recordId.trim() }
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
      attachTo,
      // Default the capture lead to whoever clicked — promotion means someone
      // owns it, and an owner-less pursuit is the thing this replaces.
      captureLead:
        (typeof body.capture_lead === 'string' && body.capture_lead.trim()) ||
        viewer.teamMemberName ||
        null,
      // Same reasoning as capture_lead: a steel deal with no salesperson is
      // owned by nobody, and "My Pipeline" — the board's default scope — filters
      // on exactly that column, so an unassigned deal is created and then
      // invisible to everyone who looks for it. Whoever promoted it owns it
      // until they hand it over.
      salespersonId:
        (typeof body.salesperson_id === 'string' && body.salesperson_id.trim()) ||
        viewer.teamMemberId ||
        null,
    })
    // The thread now reads "Promoted" in the mailbox, so nobody works it twice.
    refreshLeadLabel({ ...lead, status: 'promoted' })
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[api/leads/promote] failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
