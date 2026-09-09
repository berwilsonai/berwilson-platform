import { NextRequest, NextResponse } from 'next/server'
import { getViewer } from '@/lib/auth/viewer'
import {
  listSharedDrives,
  listSubfolders,
  summarizeFolder,
  isArchiveFolder,
} from '@/lib/integrations/google-drive'
import { isGoogleConfigured } from '@/lib/integrations/google-workspace'

/**
 * GET /api/drive/browse?parent=<folderId>&driveId=<sharedDriveId>
 *
 * Walks Drive one level at a time so a project can be pointed at the team's own
 * folder by clicking rather than by pasting an id out of a URL.
 *
 * With no `parent`, returns the shared drives plus the top of My Drive. That
 * default matters: the team's real document home turned out to be a SHARED
 * drive, and a picker that opened on My Drive alone would show an empty shelf
 * and teach the user the feature is broken.
 *
 * Each folder is returned with a file count and the date of its newest file,
 * because "3 files, newest 9 Sept" is what tells someone they have found the
 * right folder — and an empty one usually means going a level deeper.
 *
 * Read-only. Admin-only by default-deny: `/api/drive` is in no permissions.ts
 * allowlist, matching the publish and import routes beside it.
 */
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const viewer = await getViewer()
  if (!viewer?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (!isGoogleConfigured()) {
    return NextResponse.json({ error: 'Google Workspace is not configured.' }, { status: 503 })
  }

  const parent = request.nextUrl.searchParams.get('parent')?.trim() || null
  const driveId = request.nextUrl.searchParams.get('driveId')?.trim() || undefined

  try {
    if (!parent) {
      const drives = await listSharedDrives()
      return NextResponse.json({
        roots: [
          ...drives.map((d) => ({ id: d.id, name: d.name, kind: 'shared' as const, driveId: d.id })),
          { id: 'root', name: 'My Drive (moose@)', kind: 'my-drive' as const, driveId: null },
        ],
        folders: [],
      })
    }

    const subfolders = await listSubfolders(parent, { driveId, orderBy: 'name' })

    // Counts are one listing per folder. Bounded because a picker that takes
    // twenty seconds to open is one nobody uses; past this the count is simply
    // omitted rather than the whole level being slow.
    const COUNTED = 25
    const folders = await Promise.all(
      subfolders.map(async (f, i) => ({
        id: f.id,
        name: f.name,
        archive: isArchiveFolder(f.name),
        ...(i < COUNTED ? await summarizeFolder(f.id) : { files: null, newest: null }),
      }))
    )

    return NextResponse.json({ roots: [], folders })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[api/drive/browse] failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
