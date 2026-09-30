import { NextRequest } from 'next/server'
import { actorAdminClient } from '@/lib/auth/viewer'
import { applySession, type ApplyDestination } from '@/lib/email-ingestion/apply-session'
import type { ConfirmBody } from '@/lib/email-ingestion/defaults'

export const maxDuration = 300

export async function POST(request: NextRequest) {
  const supabase = await actorAdminClient()

  let body: ConfirmBody
  try {
    body = (await request.json()) as ConfirmBody
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { session_id, record_kind } = body
  if (!session_id) return Response.json({ error: 'session_id is required' }, { status: 400 })

  const { data: session } = await supabase
    .from('email_intake_sessions')
    .select('*')
    .eq('id', session_id)
    .eq('status', 'pending')
    .single()

  if (!session) {
    return Response.json({ error: 'Session not found or already confirmed' }, { status: 404 })
  }

  // Attaching to a record that already exists is the same pass with a different
  // target — see the header of apply-session.ts for why it cannot be a second
  // confirm path. `target_record` absent means create, which is what every
  // caller written before this did.
  const destination: ApplyDestination =
    body.target_record && body.target_record.id
      ? { mode: 'existing', kind: body.target_record.kind, id: body.target_record.id }
      : { mode: 'create', kind: record_kind }

  const result = await applySession(supabase, session, body, destination)
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status })
  }

  return Response.json({
    ok: true,
    record_kind: result.kind,
    opportunity_id: result.kind === 'opportunity' ? result.id : null,
    project_id: result.kind === 'project' ? result.id : null,
    attached: result.attached,
    record_name: result.name,
    fields_filled: result.ids.fields_filled ?? [],
    players_already_linked: result.players_already_linked,
    parties_created: result.ids.party_ids.length,
    tasks_created: result.ids.task_ids.length,
    documents_created: result.ids.document_ids.length,
  })
}
