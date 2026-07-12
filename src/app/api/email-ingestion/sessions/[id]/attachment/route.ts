import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseStagedAttachments } from '@/lib/email-ingestion/attachments'

interface RouteContext {
  params: Promise<{ id: string }>
}

// Short-lived signed URL for a STAGED email-intake attachment (?path=…,
// ?download=1 forces a download). Signed server-side with the admin client —
// browser-side signing cannot work against this stack (no anon storage RLS).
// The path must be one of the session's own staged attachments.
export async function GET(request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const path = request.nextUrl.searchParams.get('path') ?? ''
  if (!path) return Response.json({ error: 'path is required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: session } = await admin
    .from('email_intake_sessions')
    .select('staged_attachments')
    .eq('id', id)
    .maybeSingle()
  if (!session) return Response.json({ error: 'Session not found' }, { status: 404 })

  const attachment = parseStagedAttachments(session.staged_attachments).find(
    (a) => a.storage_path === path
  )
  if (!attachment) return Response.json({ error: 'Attachment not found on this session' }, { status: 404 })

  const download = request.nextUrl.searchParams.get('download') === '1'
  const { data, error } = await admin.storage
    .from('documents')
    .createSignedUrl(attachment.storage_path, 300, download ? { download: attachment.name } : undefined)

  if (error || !data?.signedUrl) {
    return Response.json({ error: error?.message ?? 'Could not create link' }, { status: 500 })
  }
  return Response.json({ url: data.signedUrl })
}
