import { NextRequest } from 'next/server'
import { getViewer, forbiddenJson, actorAdminClient } from '@/lib/auth/viewer'
import { folderUrl } from '@/lib/integrations/google-drive-write'

/**
 * Link a steel deal to the team's OWN Drive folder — the one under
 * `Prefab Steel Projects / Utah / <Deal>` holding the plans.
 *
 * Read FROM, never written to: the platform holds drive.file and physically
 * cannot write into a folder a human created. Mirrors
 * PUT /api/drive/source-folder for projects, including accepting a pasted
 * folder URL as well as a bare id, because pasting the URL is what people
 * actually do.
 *
 * Admin-only: `/api/drive` is default-deny for the same reason, and the guard
 * is explicit here because `/api/steel` is allowlisted for steel_sales.
 */
export async function PUT(request: NextRequest) {
  const viewer = await getViewer()
  if (!viewer?.isAdmin) return forbiddenJson()

  let body: { deal_id?: string; folder_id?: string | null }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const dealId = body.deal_id
  if (!dealId) return Response.json({ error: 'deal_id is required' }, { status: 400 })

  const raw = body.folder_id?.trim() || null
  let folderId: string | null = null
  if (raw) {
    folderId = raw.match(/\/folders\/([A-Za-z0-9_-]+)/)?.[1] ?? raw
    if (!/^[A-Za-z0-9_-]{10,}$/.test(folderId)) {
      return Response.json({ error: 'That does not look like a Drive folder id or URL.' }, { status: 400 })
    }
  }

  const supabase = await actorAdminClient()
  const { error } = await supabase
    .from('steel_deals')
    .update({
      drive_source_folder_id: folderId,
      drive_source_folder_url: folderId ? folderUrl(folderId) : null,
    })
    .eq('id', dealId)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  // Unlinking touches nothing already imported — it only stops future reads.
  return Response.json({ ok: true, folder_id: folderId })
}
