import { NextRequest, NextResponse } from 'next/server'
import { getViewer, actorAdminClient } from '@/lib/auth/viewer'
import { createAdminClient } from '@/lib/supabase/admin'
import { clearStepUps, hasStepUp } from '@/lib/security/confidential'
import { hasVerifiedTotp } from '@/lib/security/mfa'
import { logSecurityEvent } from '@/lib/security/audit'
import { mayStepUp } from '@/lib/security/request'

/**
 * POST /api/projects/[id]/confidential  { confidential: boolean }
 *
 * Marking and un-marking are deliberately NOT symmetrical (CLAUDE.md §12 —
 * filling a blank and overwriting a value are different acts):
 *
 *   ON  — any admin, no second factor. Raising protection must never be the
 *         thing that is hard to do; hesitating over a 6-digit code is how a
 *         project stays unprotected.
 *   OFF — requires a LIVE step-up on that project, which means a fresh code.
 *         Declassifying is the dangerous direction, and an unattended session
 *         is exactly the threat the whole feature exists to answer.
 *
 * Turning it on also closes every open step-up on that project, so the state
 * after the call is unambiguous: protected, and nobody is inside.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer()
  if (!mayStepUp(viewer)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  if (typeof body.confidential !== 'boolean') {
    return NextResponse.json({ error: 'confidential must be true or false.' }, { status: 400 })
  }
  const next = body.confidential

  const admin = createAdminClient()
  const { data: project, error: readError } = await admin
    .from('projects')
    .select('id, name, confidential, drive_folder_url, drive_folder_id')
    .eq('id', id)
    .maybeSingle()
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 })
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  if (project.confidential === next) return NextResponse.json({ ok: true, unchanged: true })

  if (!next) {
    if (!(await hasStepUp(viewer!.authUserId, id))) {
      return NextResponse.json(
        {
          error: 'Unlock this project with your authenticator before removing its protection.',
          needsStepUp: true,
          needsEnrollment: !(await hasVerifiedTotp()),
        },
        { status: 403 }
      )
    }
  }

  const { error } = await (await actorAdminClient())
    .from('projects')
    .update({ confidential: next })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const sessionsClosed = next ? await clearStepUps({ projectId: id }) : 0

  await logSecurityEvent({
    action: next ? 'confidential_enabled' : 'confidential_disabled',
    viewer,
    projectId: id,
    metadata: { project_name: project.name, sessions_closed: sessionsClosed },
  })

  // What protection CANNOT reach, named at the moment it is switched on.
  //
  // The flag governs this platform. It does not govern a Drive folder that is
  // already shared, mail already sent, or a brief already in somebody's inbox.
  // Saying so here is the difference between a security control and a feeling
  // of one.
  const caveats: string[] = []
  if (next) {
    if (project.drive_folder_id) {
      caveats.push(
        'This project has a shared Drive folder. Its files stay shared with whoever already has access — the lock does not reach Drive.'
      )
    }
    const { count: briefCount } = await admin
      .from('stored_briefs')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', id)
    if ((briefCount ?? 0) > 0) {
      caveats.push(
        `${briefCount} stored brief${briefCount === 1 ? '' : 's'} already exist and may have been emailed. Protection applies from now on, not backwards.`
      )
    }
  }

  return NextResponse.json({
    ok: true,
    confidential: next,
    sessionsClosed,
    driveFolderUrl: next ? project.drive_folder_url : null,
    caveats,
  })
}
