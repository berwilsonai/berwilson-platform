import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, canWorkSteel, forbiddenJson } from '@/lib/auth/viewer'

// Signed upload URL for a steel-deal file. Files live under steel-deals/<id>/…;
// any steel worker can attach documents to a deal (the module shares all deals).
export async function POST(request: NextRequest) {
  const viewer = await getViewer()
  if (!canWorkSteel(viewer)) return forbiddenJson()

  let body: { storage_path?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { storage_path } = body
  if (!storage_path || !/^steel-deals\/[0-9a-f-]{36}\//.test(storage_path)) {
    return Response.json({ error: 'A steel-deals/<id>/ storage_path is required' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase.storage.from('documents').createSignedUploadUrl(storage_path)
  if (error || !data) {
    return Response.json({ error: error?.message ?? 'Failed to create upload URL' }, { status: 500 })
  }

  return Response.json({ signedUrl: data.signedUrl, token: data.token, path: data.path })
}
