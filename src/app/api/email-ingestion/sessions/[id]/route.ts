import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseStagedAttachments, removeStagedFiles } from '@/lib/email-ingestion/attachments'

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
