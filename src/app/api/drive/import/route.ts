import { NextRequest, NextResponse } from 'next/server'
import { getViewer } from '@/lib/auth/viewer'
import { createAdminClient } from '@/lib/supabase/admin'
import { importDriveFolder } from '@/lib/drive/import'

/**
 * POST /api/drive/import  { project_id }
 *
 * Pulls a project's deal folder in from Drive on demand — the counterpart to
 * /api/drive/publish. The nightly cron does this anyway; this is for the moment
 * someone has just dropped the appraisal in the folder and wants to ask Ber AI
 * about it now.
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
    .select('id, deal_folder_id')
    .eq('id', projectId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
  if (!data.deal_folder_id) {
    return NextResponse.json(
      { error: 'This project has no deal folder to import from.' },
      { status: 400 }
    )
  }

  try {
    const result = await importDriveFolder({
      folderId: data.deal_folder_id,
      projectId: data.id,
    })
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[api/drive/import] failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
