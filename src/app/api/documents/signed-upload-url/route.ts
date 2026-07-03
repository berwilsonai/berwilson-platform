import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, canAccessProject, forbiddenJson } from '@/lib/auth/viewer'

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()

  let body: { storage_path: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { storage_path } = body
  if (!storage_path) {
    return Response.json({ error: 'storage_path is required' }, { status: 400 })
  }

  // Scoped users may only stage uploads into their granted projects' folders.
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) {
    const match = /^projects\/([0-9a-f-]{36})\//.exec(storage_path)
    if (!match || !(await canAccessProject(viewer, match[1]))) return forbiddenJson()
  }

  const { data, error } = await supabase.storage
    .from('documents')
    .createSignedUploadUrl(storage_path)

  if (error || !data) {
    return Response.json({ error: error?.message ?? 'Failed to create upload URL' }, { status: 500 })
  }

  return Response.json({ signedUrl: data.signedUrl, token: data.token, path: data.path })
}
