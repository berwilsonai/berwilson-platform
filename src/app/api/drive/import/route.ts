import { NextRequest, NextResponse } from 'next/server'
import { getViewer } from '@/lib/auth/viewer'
import { createAdminClient } from '@/lib/supabase/admin'
import { importDriveFolder } from '@/lib/drive/import'
import { postArrivalUpdate } from '@/lib/drive/project-folder-sync'
import { notifyArrivals } from '@/lib/notifications/documents'

/**
 * POST /api/drive/import  { project_id }
 *
 * Pulls a project's linked Drive folder in on demand — the counterpart to
 * /api/drive/publish. The nightly cron does this anyway; this is for the moment
 * someone has just dropped the appraisal in the folder and wants to ask Ber AI
 * about it now.
 *
 * Posts the same feed update AND raises the same notifications the cron does,
 * so a hand-run import and a nightly one leave the project's history looking
 * identical. The notifications were missing until 2026-09-22, which meant
 * pressing the button announced nothing while the identical nightly path rang
 * everyone's bell.
 *
 * Idempotent: unchanged files cost one list entry and nothing else, so pressing
 * the button twice is free.
 *
 * Admin-only by default-deny — `/api/drive` appears in no permissions.ts
 * allowlist, matching the publish route beside it.
 */
export const maxDuration = 300

export async function POST(request: NextRequest) {
  const viewer = await getViewer()
  if (!viewer?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  /**
   * ⚠ OPPORTUNITIES TOO, WHICH THIS ROUTE COULD NOT SERVE. It took a bare
   * `project_id`, so the "pull it in from Drive now" button existed for half
   * the records — and seven opportunities have a linked room, GridEdge among
   * them on the data-room template. Richard's model is that Drive is the source
   * of truth, which a record the manual sync cannot reach does not satisfy.
   */
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const projectId = typeof body.project_id === 'string' ? body.project_id : ''
  const opportunityId = typeof body.opportunity_id === 'string' ? body.opportunity_id : ''
  if (!projectId && !opportunityId) {
    return NextResponse.json(
      { error: 'A project_id or an opportunity_id is required.' },
      { status: 400 }
    )
  }

  const kind: 'project' | 'opportunity' = projectId ? 'project' : 'opportunity'
  const recordId = projectId || opportunityId

  const supabase = createAdminClient()
  const { data, error } =
    kind === 'project'
      ? await supabase
          .from('projects')
          .select('id, name, deal_folder_id, drive_source_folder_id')
          .eq('id', recordId)
          .maybeSingle()
      : await supabase
          .from('opportunities')
          .select('id, name, drive_source_folder_id')
          .eq('id', recordId)
          .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Record not found.' }, { status: 404 })

  // Same collapse as the nightly sync: a web-form deal folder that has also been
  // linked as the source is one folder, not two.
  const folders = [
    ...new Set(
      [
        data.drive_source_folder_id,
        // `deal_folder_id` is the website form's folder and exists on projects
        // only — adopted at promotion INTO a project.
        'deal_folder_id' in data ? data.deal_folder_id : null,
      ].filter(Boolean)
    ),
  ] as string[]
  if (folders.length === 0) {
    return NextResponse.json(
      { error: `No Drive folder is linked to this ${kind} yet.` },
      { status: 400 }
    )
  }

  try {
    const merged = {
      added: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0, superseded: 0,
      // Moved between folders in Drive — path corrected, bytes untouched.
      refiled: 0,
    }
    const arrivals = []
    const errors: string[] = []

    for (const folderId of folders) {
      const result = await importDriveFolder({ folderId, target: { kind, id: data.id } })
      merged.added += result.added
      merged.updated += result.updated
      merged.unchanged += result.unchanged
      merged.refiled += result.refiled
      merged.skipped += result.skipped
      merged.failed += result.failed
      merged.superseded += result.superseded
      arrivals.push(...result.arrivals)
      errors.push(...result.errors)
      if (result.supersedeHeldBack) errors.push(result.supersedeHeldBack)
    }

    const name = data.name ?? `this ${kind}`
    // ⚠ The arrival UPDATE is a project's feed (`updates.project_id`), so an
    // opportunity's arrivals are counted and returned but not posted — its
    // running commentary is `opportunity_notes`, a different table. Reported
    // rather than silently skipped.
    if (kind === 'project') await postArrivalUpdate(data.id, name, arrivals, merged.superseded)
    await notifyArrivals(
      { label: name, href: `/projects/${data.id}/documents`, projectId: data.id },
      arrivals
    )
    return NextResponse.json({ ...merged, errors })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[api/drive/import] failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
