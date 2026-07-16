import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, canAccessOpportunity, forbiddenJson } from '@/lib/auth/viewer'

interface RouteContext {
  params: Promise<{ id: string }>
}

// Returns a short-lived signed URL for viewing (?download=1 forces a
// download). Signed with the admin client — see /api/documents/[id] GET.
export async function GET(request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const admin = createAdminClient()

  const { data: doc, error: fetchError } = await admin
    .from('opportunity_documents')
    .select('id, storage_path, file_name, opportunity_id')
    .eq('id', id)
    .single()

  if (fetchError || !doc) {
    return Response.json({ error: 'Document not found' }, { status: 404 })
  }

  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin && !canAccessOpportunity(viewer, doc.opportunity_id)) return forbiddenJson()

  const download = request.nextUrl.searchParams.get('download') === '1'
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
  const admin = createAdminClient()

  const { data: doc, error: fetchError } = await admin
    .from('opportunity_documents')
    .select('id, storage_path, opportunity_id')
    .eq('id', id)
    .single()

  if (fetchError || !doc) {
    return Response.json({ error: 'Document not found' }, { status: 404 })
  }

  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin && !canAccessOpportunity(viewer, doc.opportunity_id)) return forbiddenJson()

  // DB row first (cascades the document's chunks), storage cleanup after —
  // if the row delete fails we must not have already destroyed the file.
  const { error: dbError } = await admin
    .from('opportunity_documents')
    .delete()
    .eq('id', id)

  if (dbError) {
    return Response.json({ error: dbError.message }, { status: 500 })
  }

  const { error: storageError } = await admin.storage
    .from('documents')
    .remove([doc.storage_path])

  if (storageError) {
    console.error('Storage delete failed:', storageError.message)
  }

  return Response.json({ success: true })
}
