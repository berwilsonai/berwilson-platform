/**
 * Upload a recording onto a project or an opportunity.
 *
 * The fallback door (10-19, Richard's direction): the Drive folder deduces the
 * record from the transcript, and this one is told. `src/lib/audio/upload.ts`
 * carries the reasoning; this file is the edge — read the record, check access,
 * hand over the bytes.
 *
 * ⚠ THE RECORD IS READ BEFORE THE WRITE, WHICH IS PRECISELY THE CHECK THAT GOES
 * MISSING. §12, measured on 10-19: of 61 route handlers touching one table with
 * one write verb, 22 carried no record-level access check at all — because a
 * request carries only an id, so the parent has to be fetched on purpose. This
 * route writes a thread, a meeting, an update, commitments and tasks onto a
 * record named in the BODY, which is the shape `src/lib/security/guard.ts`
 * exists for.
 *
 * ⚠ AND THE PATH IS DISTINGUISHABLE AT THE PREFIX. The role gate's
 * `matchesPrefix` is not method-aware, so this sits at
 * `/api/records/recording` and not under a shorter string that would also
 * allowlist the child registry — `/api/records/milestones` is the one child a
 * `project_manager` holds, and a shorter prefix would have handed them this too.
 *
 * ⚠ ADMIN-ONLY BY DEFAULT-DENY, deliberately: this path is in no role's
 * allowlist in `src/lib/auth/permissions.ts`, so only an admin can reach it.
 * Both executives are admins. If a project manager should ever be able to
 * upload onto their own projects, the line to add is this exact path — and
 * `canAccessRecord` below already confines them to records they hold.
 */

import { NextRequest } from 'next/server'
import { canAccessRecord, forbiddenJson, getViewer } from '@/lib/auth/viewer'
import { ingestUploadedRecording, type UploadTarget } from '@/lib/audio/upload'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * ⚠ MEASURED, AND WHISPER IS NOT THE EXPENSIVE PART. A 40-second test recording
 * took **177.9s end to end** on 2026-10-19: whisper is a few seconds of that,
 * and the rest is the model passes this path deliberately runs — the thread
 * summary, the recap, the obligation extraction — on an LM Studio that serves
 * ONE REQUEST AT A TIME, so each one also queues behind whatever else is
 * running. Those passes cost roughly the same whatever the recording's length,
 * so a long call is whisper's extra time ON TOP of a near-constant ~170s floor.
 *
 * Hence 600 and not 300: at 300 a real hour-long call would have been cut off
 * after the records were already written, and the caller would have seen a
 * failure for work that succeeded.
 */
export const maxDuration = 600

/** 200MB: a Plaude export of a three-hour meeting, with room to spare. */
const MAX_BYTES = Number(process.env.UPLOAD_MAX_AUDIO_BYTES ?? 200 * 1024 * 1024)

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export async function POST(request: NextRequest) {
  const viewer = await getViewer()
  // Unreachable behind the middleware, which 401s an unauthenticated request —
  // but this is the layer that must not assume that, and it narrows `viewer`.
  if (!viewer) return forbiddenJson()

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return Response.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file')
  const projectId = (formData.get('project_id') as string | null)?.trim() || null
  const opportunityId = (formData.get('opportunity_id') as string | null)?.trim() || null
  const title = (formData.get('title') as string | null)?.trim() || null
  const occurredOn = (formData.get('occurred_on') as string | null)?.trim() || null

  if (!(file instanceof File)) {
    return Response.json({ error: 'A file is required.' }, { status: 400 })
  }
  // XOR, not "one of" — a body naming both would leave the caller guessing
  // which record it landed on.
  if (Boolean(projectId) === Boolean(opportunityId)) {
    return Response.json(
      { error: 'Exactly one of project_id or opportunity_id is required.' },
      { status: 400 }
    )
  }
  if (occurredOn && !ISO_DATE.test(occurredOn)) {
    return Response.json({ error: 'occurred_on must be YYYY-MM-DD.' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      {
        error: `That file is ${(file.size / 1024 / 1024).toFixed(0)}MB, over the ${Math.round(
          MAX_BYTES / 1024 / 1024
        )}MB limit. Drop it in the Ber AI Recordings folder in Drive instead — that path streams it.`,
      },
      { status: 413 }
    )
  }
  // Audio or video; a video's audio track is what whisper reads.
  const type = file.type || ''
  if (type && !type.startsWith('audio/') && !type.startsWith('video/')) {
    return Response.json({ error: 'Only an audio or video file can be transcribed.' }, { status: 400 })
  }

  const kind: UploadTarget['kind'] = projectId ? 'project' : 'opportunity'
  const id = (projectId ?? opportunityId) as string

  // ── The record is read BEFORE anything is written ────────────────────────
  const supabase = createAdminClient()
  const { data: record } = await supabase
    .from(kind === 'project' ? 'projects' : 'opportunities')
    .select('id, name')
    .eq('id', id)
    .maybeSingle()
  if (!record) return Response.json({ error: 'That record does not exist.' }, { status: 404 })
  if (!(await canAccessRecord(viewer, kind, id))) return forbiddenJson()

  const result = await ingestUploadedRecording({
    bytes: Buffer.from(await file.arrayBuffer()),
    fileName: file.name,
    target: { kind, id, name: (record as { name: string }).name },
    title,
    occurredOn,
    uploadedBy: viewer.teamMemberName ?? viewer.email ?? null,
  })

  if (!result.ok) {
    // The reasons are all sentences a person can act on (no speech in the file,
    // whisper unconfigured, a transcript too short), so the message is returned
    // verbatim rather than flattened to "upload failed".
    return Response.json({ error: result.error }, { status: 422 })
  }

  return Response.json({
    ok: true,
    record: { kind, id, name: (record as { name: string }).name },
    meeting_id: result.meetingId,
    thread_id: result.threadId,
    transcript_chars: result.transcriptChars,
    phases: result.phases,
    created: (result.promotion?.created ?? []).map((c) => ({
      kind: c.kind,
      id: c.id,
      name: c.name,
    })),
    notes: result.notes,
  })
}
