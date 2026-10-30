import { NextRequest, NextResponse } from 'next/server'
import { getViewer } from '@/lib/auth/viewer'
import { actorAdminClient } from '@/lib/auth/viewer'
import { ensureFolder, folderUrl, renameFile } from '@/lib/integrations/google-drive-write'
import { listSubfolders } from '@/lib/integrations/google-drive'
import { isGoogleConfigured } from '@/lib/integrations/google-workspace'
import { isConfidentialProject } from '@/lib/security/confidential'
import { driveFolderName } from '@/lib/drive/classify'
import {
  HQ_FOLDER_ID,
  PROJECTS_SHELF,
  SHARED_DRIVE_ID,
  roomFolderPaths,
} from '@/lib/drive/data-room'

/**
 * PUT /api/drive/source-folder  { project_id | opportunity_id, folder_id | null }
 *
 * Links a record to the team's own Drive folder, or clears the link.
 *
 * ⚠ IT TOOK `project_id` ONLY UNTIL 2026-10-29, while `opportunities` has
 * carried `drive_source_folder_id` since the column was added — so an
 * opportunity's folder could be imported from but never linked through the
 * platform, and the seven opportunities with a room all had it set by script.
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
  const target = recordFrom(body)
  if (!target) {
    return NextResponse.json(
      { error: 'A project_id or an opportunity_id is required.' },
      { status: 400 }
    )
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
    .from(target.table)
    .update({
      drive_source_folder_id: folderId,
      drive_source_folder_url: folderId ? folderUrl(folderId) : null,
    })
    .eq('id', target.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    folder_id: folderId,
    folder_url: folderId ? folderUrl(folderId) : null,
  })
}

/** Which record the body names. One shape for both verbs. */
function recordFrom(
  body: Record<string, unknown>
): { table: 'projects' | 'opportunities'; id: string } | null {
  if (typeof body.project_id === 'string' && body.project_id) {
    return { table: 'projects', id: body.project_id }
  }
  if (typeof body.opportunity_id === 'string' && body.opportunity_id) {
    return { table: 'opportunities', id: body.opportunity_id }
  }
  return null
}

/**
 * POST /api/drive/source-folder  { project_id | opportunity_id }
 *
 * CLAIM A DATA ROOM FOR THIS RECORD, in one press.
 *
 * Richard asked for 25 pre-built blank rooms so a new deal is a rename rather
 * than a build, AND for the platform to do the claiming (10-29: both). This is
 * the second half: it takes the lowest unused `_NEW NN — (rename me)` slot,
 * renames it to the record's name and links it — a single Drive call, so the
 * room exists the moment the button returns. With no slot left it builds a
 * fresh room from the template instead, which is slower but never blocked.
 *
 * ⚠ IT REFUSES A RECORD THAT ALREADY HAS A FOLDER. Re-pointing a record is the
 * one gesture that can lose work — `setup-drive-structure.mts` guards the same
 * thing behind `--relink` and calls it out as such — and the failure is silent:
 * the record looks fine and its documents are in a folder nothing reads.
 *
 * ⚠ AND IT REFUSES A CONFIDENTIAL PROJECT. A folder named after a protected
 * deal in the company's shared drive discloses it to everyone with access,
 * whatever is inside — §8, and the same rule `setup-drive-structure.mts` and
 * `publishRecordToDrive` already apply.
 */
export async function POST(request: NextRequest) {
  const viewer = await getViewer()
  if (!viewer?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!isGoogleConfigured()) {
    return NextResponse.json({ error: 'Google Workspace is not configured.' }, { status: 503 })
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const target = recordFrom(body)
  if (!target) {
    return NextResponse.json(
      { error: 'A project_id or an opportunity_id is required.' },
      { status: 400 }
    )
  }

  const supabase = await actorAdminClient()
  const { data: record, error: readErr } = await supabase
    .from(target.table)
    .select('name, drive_source_folder_id')
    .eq('id', target.id)
    .maybeSingle()
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
  if (!record) return NextResponse.json({ error: 'Record not found.' }, { status: 404 })

  if (record.drive_source_folder_id) {
    return NextResponse.json(
      {
        error:
          'This record already has a Drive folder. Clear the link first if you really mean to move it — its documents were imported from the old one.',
        folder_url: folderUrl(record.drive_source_folder_id),
      },
      { status: 409 }
    )
  }
  if (target.table === 'projects' && (await isConfidentialProject(target.id))) {
    return NextResponse.json(
      {
        error:
          'This project is protected, so it gets no folder in the shared drive — the folder name alone would disclose the deal.',
      },
      { status: 403 }
    )
  }

  const name = driveFolderName(record.name ?? '')
  if (!name) return NextResponse.json({ error: 'The record has no name.' }, { status: 400 })

  try {
    const shelf = await ensureFolder(PROJECTS_SHELF, HQ_FOLDER_ID)
    const rooms = await listSubfolders(shelf.id, { driveId: SHARED_DRIVE_ID })

    // Lowest-numbered unclaimed slot, so the list stays readable as it drains.
    const slot = rooms
      .filter((f) => /^_NEW \d+ — \(rename me\)$/.test(f.name.trim()))
      .sort((a, b) => a.name.localeCompare(b.name))[0]

    let folderId: string
    let claimed: boolean
    if (slot) {
      await renameFile(slot.id, name)
      folderId = slot.id
      claimed = true
    } else {
      const made = await ensureFolder(name, shelf.id)
      for (const path of roomFolderPaths()) {
        let parent = made.id
        for (const segment of path.split('/')) parent = (await ensureFolder(segment, parent)).id
      }
      folderId = made.id
      claimed = false
    }

    const { error } = await supabase
      .from(target.table)
      .update({
        drive_source_folder_id: folderId,
        drive_source_folder_url: folderUrl(folderId),
        data_room_template: 'data_center',
      })
      .eq('id', target.id)
    if (error) throw new Error(error.message)

    return NextResponse.json({
      folder_id: folderId,
      folder_url: folderUrl(folderId),
      claimed_slot: claimed ? slot!.name.trim() : null,
      built_fresh: !claimed,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Drive refused the request.' },
      { status: 502 }
    )
  }
}
