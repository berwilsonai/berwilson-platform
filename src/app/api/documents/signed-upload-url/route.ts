import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, canAccessProject, forbiddenJson } from '@/lib/auth/viewer'
import { canAccessMeeting } from '@/lib/meetings/access'

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

  // Scoped users may only stage uploads into their granted projects' folders
  // (or a meeting they can access — meeting files live under meetings/<id>/).
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) {
    const projMatch = /^projects\/([0-9a-f-]{36})\//.exec(storage_path)
    const meetMatch = /^meetings\/([0-9a-f-]{36})\//.exec(storage_path)
    if (projMatch) {
      if (!(await canAccessProject(viewer, projMatch[1]))) return forbiddenJson()
    } else if (meetMatch) {
      const { data: meeting } = await supabase
        .from('meetings')
        .select('scope, project_id')
        .eq('id', meetMatch[1])
        .maybeSingle()
      if (!meeting || !(await canAccessMeeting(viewer, meeting))) return forbiddenJson()
    } else {
      return forbiddenJson()
    }
  }

  const { data, error } = await supabase.storage
    .from('documents')
    .createSignedUploadUrl(storage_path)

  if (error || !data) {
    return Response.json({ error: error?.message ?? 'Failed to create upload URL' }, { status: 500 })
  }

  return Response.json({ signedUrl: data.signedUrl, token: data.token, path: data.path })
}
