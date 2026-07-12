import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, canAccessProject, forbiddenJson, actorAdminClient } from '@/lib/auth/viewer'

interface RouteContext {
  params: Promise<{ id: string }>
}

// Returns a short-lived signed URL for viewing (?download=1 forces a
// download), or the stored readable text (?text=1 — extracted text with the
// AI summary as fallback, used by the read-aloud button). Signed with the
// admin client — the self-hosted storage has no anon RLS policies, so
// browser-side signing always fails; access control happens here instead.
export async function GET(request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { data: doc, error: fetchError } = await supabase
    .from('documents')
    .select('id, storage_path, file_name, project_id, extracted_text, ai_summary')
    .eq('id', id)
    .single()

  if (fetchError || !doc) {
    return Response.json({ error: 'Document not found' }, { status: 404 })
  }

  // Scoped users may only open documents on their granted projects.
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) {
    if (!doc.project_id || !(await canAccessProject(viewer, doc.project_id))) return forbiddenJson()
  }

  if (request.nextUrl.searchParams.get('text') === '1') {
    const text = doc.extracted_text?.trim() || doc.ai_summary?.trim() || null
    if (!text) return Response.json({ error: 'No readable text stored for this document' }, { status: 404 })
    return Response.json({ text })
  }

  const download = request.nextUrl.searchParams.get('download') === '1'
  const admin = createAdminClient()
  const { data, error: signError } = await admin.storage
    .from('documents')
    .createSignedUrl(doc.storage_path, 300, download ? { download: doc.file_name } : undefined)

  if (signError || !data?.signedUrl) {
    return Response.json({ error: signError?.message ?? 'Could not create link' }, { status: 500 })
  }

  return Response.json({ url: data.signedUrl })
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  // Fetch the document to get its storage path
  const { data: doc, error: fetchError } = await supabase
    .from('documents')
    .select('id, storage_path, project_id')
    .eq('id', id)
    .single()

  if (fetchError || !doc) {
    return Response.json({ error: 'Document not found' }, { status: 404 })
  }

  // Scoped users may only delete documents on their granted projects.
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) {
    if (!doc.project_id || !(await canAccessProject(viewer, doc.project_id))) return forbiddenJson()
  }

  // Remove from Supabase Storage (admin needed to bypass storage RLS)
  const admin = await actorAdminClient()
  const { error: storageError } = await admin.storage
    .from('documents')
    .remove([doc.storage_path])

  if (storageError) {
    // Log but don't block — still delete the DB record
    console.error('Storage delete failed:', storageError.message)
  }

  // Delete DB record via user client so activity_log captures the real user
  const { error: dbError } = await supabase
    .from('documents')
    .delete()
    .eq('id', id)

  if (dbError) {
    return Response.json({ error: dbError.message }, { status: 500 })
  }

  return Response.json({ success: true })
}
