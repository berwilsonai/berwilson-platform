import { NextRequest, NextResponse } from 'next/server'
import { getViewer } from '@/lib/auth/viewer'
import { createAdminClient } from '@/lib/supabase/admin'
import { importDriveFolder } from '@/lib/drive/import'
import { postArrivalUpdate } from '@/lib/drive/project-folder-sync'

/**
 * POST /api/drive/import  { project_id }
 *
 * Pulls a project's linked Drive folder in on demand — the counterpart to
 * /api/drive/publish. The nightly cron does this anyway; this is for the moment
 * someone has just dropped the appraisal in the folder and wants to ask Ber AI
 * about it now.
 *
 * Posts the same feed update the cron does, so a hand-run import and a nightly
 * one leave the project's history looking identical.
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

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const projectId = typeof body.project_id === 'string' ? body.project_id : ''
  if (!projectId) {
    return NextResponse.json({ error: 'A project_id is required.' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, deal_folder_id, drive_source_folder_id')
    .eq('id', projectId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })

  // Same collapse as the nightly sync: a web-form deal folder that has also been
  // linked as the source is one folder, not two.
  const folders = [
    ...new Set([data.drive_source_folder_id, data.deal_folder_id].filter(Boolean)),
  ] as string[]
  if (folders.length === 0) {
    return NextResponse.json(
      { error: 'No Drive folder is linked to this project yet.' },
      { status: 400 }
    )
  }

  try {
    const merged = { added: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0, superseded: 0 }
    const arrivals = []
    const errors: string[] = []

    for (const folderId of folders) {
      const result = await importDriveFolder({ folderId, projectId: data.id })
      merged.added += result.added
      merged.updated += result.updated
      merged.unchanged += result.unchanged
      merged.skipped += result.skipped
      merged.failed += result.failed
      merged.superseded += result.superseded
      arrivals.push(...result.arrivals)
      errors.push(...result.errors)
      if (result.supersedeHeldBack) errors.push(result.supersedeHeldBack)
    }

    await postArrivalUpdate(data.id, data.name ?? 'this project', arrivals, merged.superseded)
    return NextResponse.json({ ...merged, errors })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[api/drive/import] failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
