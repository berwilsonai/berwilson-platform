import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, canWorkSteel, forbiddenJson, actorAdminClient } from '@/lib/auth/viewer'

interface RouteContext {
  params: Promise<{ id: string }>
}

// Short-lived signed URL to view/download a steel-deal file. Signed server-side
// with the admin client — the self-hosted storage has no anon RLS policies.
export async function GET(request: NextRequest, { params }: RouteContext) {
  const viewer = await getViewer()
  if (!canWorkSteel(viewer)) return forbiddenJson()

  const { id } = await params
  const admin = createAdminClient()
  const { data: doc, error } = await admin
    .from('documents')
    .select('id, storage_path, file_name, steel_deal_id')
    .eq('id', id)
    .single()

  if (error || !doc || !doc.steel_deal_id) {
    return Response.json({ error: 'Document not found' }, { status: 404 })
  }

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
  const viewer = await getViewer()
  if (!canWorkSteel(viewer)) return forbiddenJson()

  const { id } = await params
  const admin = createAdminClient()
  const { data: doc, error: fetchError } = await admin
    .from('documents')
    .select('id, storage_path, steel_deal_id')
    .eq('id', id)
    .single()

  if (fetchError || !doc || !doc.steel_deal_id) {
    return Response.json({ error: 'Document not found' }, { status: 404 })
  }

  // DB row first (a DB cascade can't reach storage); storage cleanup after.
  const actor = await actorAdminClient()
  const { error: dbError } = await actor.from('documents').delete().eq('id', id)
  if (dbError) return Response.json({ error: dbError.message }, { status: 500 })

  const { error: storageError } = await admin.storage.from('documents').remove([doc.storage_path])
  if (storageError) console.error('Steel doc storage delete failed:', storageError.message)

  return Response.json({ success: true })
}
