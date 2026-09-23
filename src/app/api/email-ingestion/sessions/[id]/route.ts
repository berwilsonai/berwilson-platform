import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseStagedAttachments, removeStagedFiles } from '@/lib/email-ingestion/attachments'
import { buildConfirmBody } from '@/lib/email-ingestion/defaults'
import type { EmailIntakeExtraction } from '@/lib/ai/prompts/email-intake'
import type { PartyMatch } from '@/lib/ai/proposal-matching'

interface RouteContext {
  params: Promise<{ id: string }>
}

/** PATCH — dismiss a session (clear failed/stale runs or skip a pending review). */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const admin = createAdminClient()

  // Confirmed sessions are a record of created data — they stay.
  const { data: session } = await admin
    .from('email_intake_sessions')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (!session) return Response.json({ error: 'Session not found' }, { status: 404 })
  if (session.status === 'confirmed') {
    return Response.json({ error: 'Confirmed sessions cannot be dismissed' }, { status: 400 })
  }

  // A dismissed session's staged attachment files are dead weight — clear them.
  await removeStagedFiles(admin, parseStagedAttachments(session.staged_attachments))

  const { error } = await admin
    .from('email_intake_sessions')
    .update({ status: 'dismissed' })
    .eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}

/**
 * GET — what this session would create if nobody changed anything.
 *
 * Fetched on click rather than shipped with the Decide page: a full draft is a
 * couple of kilobytes and most rows are never accepted, so sending seventy of
 * them up front would pay for work nobody asked for. Accept is a deliberate
 * action, not a hot path — one extra round trip is the right trade.
 *
 * Returns the body VERBATIM for the caller to POST to /confirm. Nothing here
 * writes; agreeing with the draft is still a separate, explicit request.
 */
export async function GET(_request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const admin = createAdminClient()
  const { data: session } = await admin
    .from('email_intake_sessions')
    .select('id, status, extraction_result, party_matches, staged_attachments')
    .eq('id', id)
    .maybeSingle()

  if (!session) return Response.json({ error: 'Session not found' }, { status: 404 })
  if (session.status !== 'pending') {
    return Response.json({ error: `Session is already ${session.status}.` }, { status: 409 })
  }

  const draft = buildConfirmBody({
    sessionId: session.id,
    extraction: session.extraction_result as unknown as EmailIntakeExtraction,
    partyMatches: (session.party_matches ?? []) as unknown as PartyMatch[],
    stagedAttachments: parseStagedAttachments(session.staged_attachments),
  })

  if (!draft.ready) {
    return Response.json({ error: draft.blocker }, { status: 422 })
  }
  return Response.json(draft)
}
