import { NextRequest, NextResponse } from 'next/server'
import { getViewer } from '@/lib/auth/viewer'
import { actorAdminClient } from '@/lib/auth/viewer'
import { folderUrl } from '@/lib/integrations/google-drive-write'

/**
 * PUT /api/drive/source-folder  { project_id, folder_id | null, folder_name? }
 *
 * Links a project to the team's own Drive folder, or clears the link.
 *
 * Deliberately a distinct column from `drive_folder_id` (where the platform
 * PUBLISHES to). The two point at different places — one is the team's filing,
 * the other is a folder this platform created — and conflating them would have
 * publishing write into the team's own folders.
 *
 * Unlinking stops future imports and touches nothing already imported: those
 * documents are on the record, and quietly removing them because a link was
 * changed would be the surprising thing to do.
 *
 * Admin-only by default-deny, matching the rest of `/api/drive`.
 */
export async function PUT(request: NextRequest) {
  const viewer = await getViewer()
  if (!viewer?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const projectId = typeof body.project_id === 'string' ? body.project_id : ''
  if (!projectId) {
    return NextResponse.json({ error: 'A project_id is required.' }, { status: 400 })
  }

  // Accept a pasted folder URL as well as an id: a picker is the intended path,
  // but "copy link" is the reflex, and rejecting it would be pure friction.
  const raw = typeof body.folder_id === 'string' ? body.folder_id.trim() : null
  const folderId = raw ? (raw.match(/\/folders\/([A-Za-z0-9_-]+)/)?.[1] ?? raw) : null
  if (folderId && !/^[A-Za-z0-9_-]{10,}$/.test(folderId)) {
    return NextResponse.json(
      { error: 'That does not look like a Drive folder id or URL.' },
      { status: 400 }
    )
  }

  const supabase = await actorAdminClient()
  const { error } = await supabase
    .from('projects')
    .update({
      drive_source_folder_id: folderId,
      drive_source_folder_url: folderId ? folderUrl(folderId) : null,
    })
    .eq('id', projectId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    folder_id: folderId,
    folder_url: folderId ? folderUrl(folderId) : null,
  })
}
