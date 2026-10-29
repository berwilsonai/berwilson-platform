/**
 * Take a staged conversation's follow-ups as TASKS on a deal, and create
 * nothing else.
 *
 * ⚠ THE MISSING MIDDLE OF /decide (10-22, Richard's direction). A staged thread
 * or recorded call offered three answers — create a whole record, file the
 * conversation onto one, or dismiss it — and the commonest real answer was none
 * of the three: *"that is not a project, that is a task on Steelton."* Reaching
 * it meant leaving the queue for /tasks and retyping follow-ups the extraction
 * was already holding, which is the same friction that got 5 sessions confirmed
 * out of 136 before Accept existed on this page at all.
 *
 * ⚠ IT IS A NARROWER WRITE THAN MERGE, NOT A DIFFERENT ONE. Merging runs the
 * whole of `applySession` — fields, players, the report, attachments, Drive. This
 * runs step 3 only, through the function `applySession` itself now calls
 * (`createTasksForRecord`), so a column added to the task insert cannot go
 * missing on one of the two paths (§12 — never fork a shared pass).
 *
 * §11 is untouched: the invariant is that mail must not become a record WITHOUT
 * human review, and the press IS the review. Nothing here runs unattended.
 *
 * ⚠ AND A HUMAN MAY NAME THE DEAL (10-28). `resolveSessionTaskTarget` refuses
 * whenever the title resolves to nothing or to two records, which is correct for
 * a MATCHER and left the commonest case with no button at all: a recorded call
 * titled `Call with Taylor` names nobody's deal by design, and a thread labelled
 * `GridEdgeDC` does not resolve to the opportunity called `GridEdge`. A person
 * knows both in a second. The pick is an assertion and outranks the resolver;
 * everything else about the write is identical.
 */

import { NextRequest } from 'next/server'
import { getViewer, actorAdminClient } from '@/lib/auth/viewer'
import { createTasksForRecord } from '@/lib/tasks/from-extraction'
import {
  resolveSessionTaskTarget,
  readExtractionTasks,
  type SessionTaskTarget,
} from '@/lib/email-ingestion/task-target'
import type { JsonIn } from '@/lib/supabase/types'

export const maxDuration = 120

const TARGET_TABLES = {
  project: 'projects',
  opportunity: 'opportunities',
} as const

/**
 * The deal a person chose, checked to exist, with the session's own follow-ups.
 *
 * Returns the SAME shape the resolver does so the caller has one branch and one
 * refusal path — a second return type here would be a fork of the one thing
 * this route does (§12).
 */
async function pickedTarget(
  supabase: Awaited<ReturnType<typeof actorAdminClient>>,
  picked: { kind?: unknown; id?: unknown },
  session: { extraction_result: unknown }
): Promise<SessionTaskTarget> {
  const kind = picked.kind
  const id = picked.id
  if ((kind !== 'project' && kind !== 'opportunity') || typeof id !== 'string' || !id) {
    return { ok: false, reason: 'target must be { kind: "project" | "opportunity", id }.' }
  }
  const { data: dest } = await supabase
    .from(TARGET_TABLES[kind])
    .select('id, name')
    .eq('id', id)
    .maybeSingle()
  if (!dest) return { ok: false, reason: `That ${kind} no longer exists.` }
  return {
    ok: true,
    kind,
    id,
    name: (dest as { name: string | null }).name ?? kind,
    tasks: readExtractionTasks(session.extraction_result),
  }
}

export async function POST(request: NextRequest) {
  const viewer = await getViewer()
  if (!viewer?.isAdmin) return Response.json({ error: 'Forbidden' }, { status: 403 })

  let body: { session_id?: string; target?: { kind?: unknown; id?: unknown } }
  try {
    body = (await request.json()) as { session_id?: string; target?: { kind?: unknown; id?: unknown } }
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const sessionId = body.session_id
  if (!sessionId) return Response.json({ error: 'session_id is required' }, { status: 400 })

  const supabase = await actorAdminClient()
  const { data: session } = await supabase
    .from('email_intake_sessions')
    .select('*')
    .eq('id', sessionId)
    .single()

  if (!session) return Response.json({ error: 'Session not found' }, { status: 404 })
  // ⚠ CHECKED BEFORE THE WRITE, NOT AFTER. Two presses on a row the optimistic
  // UI has already hidden would otherwise create the same follow-ups twice —
  // and unlike a record there is no unique constraint on a task's title to
  // catch it. The status transition below is the latch.
  if (session.status !== 'pending') {
    return Response.json({ error: `Session is already ${session.status}.` }, { status: 409 })
  }

  const target = body.target
    ? await pickedTarget(supabase, body.target, session)
    : await resolveSessionTaskTarget(session)
  if (!target.ok) return Response.json({ error: target.reason }, { status: 400 })
  if (target.tasks.length === 0) {
    return Response.json(
      { error: 'This conversation has no follow-ups to turn into tasks.' },
      { status: 400 }
    )
  }

  const applied = await createTasksForRecord({
    supabase,
    tasks: target.tasks,
    projectId: target.kind === 'project' ? target.id : null,
    opportunityId: target.kind === 'opportunity' ? target.id : null,
  })

  // ⚠ NOTHING LANDED MEANS THE SESSION STAYS OPEN. Closing it here would retire
  // the only copy of the follow-ups on the strength of a failed write, and a row
  // that disappears without being written is the one outcome this queue must
  // never produce.
  if (applied.taskIds.length === 0) {
    return Response.json(
      { error: `Could not create ${applied.failed.length === 1 ? 'the task' : 'any of the tasks'}. Nothing was changed.` },
      { status: 500 }
    )
  }

  // Confirmed, because the human decided — and `created_record_ids` says
  // honestly that tasks are ALL that came out of it, which is what a reader
  // looking back at the session needs to know. The other id arrays stay empty
  // rather than being omitted, so the shape matches `applySession`'s.
  const { error: closeErr } = await supabase
    .from('email_intake_sessions')
    .update({
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
      created_record_ids: {
        task_ids: applied.taskIds,
        party_ids: [],
        document_ids: [],
        tasks_only: true,
        task_target: { kind: target.kind, id: target.id, name: target.name },
      } as unknown as JsonIn,
    })
    .eq('id', sessionId)
    // ⚠ RE-ASSERTED IN THE WHERE CLAUSE. The check above read the row; this
    // writes it, and between the two a second press could have confirmed it.
    .eq('status', 'pending')
  if (closeErr) {
    // The tasks exist. Saying so matters more than the status: the reader must
    // not press again and double them.
    console.error('[intake-tasks] created tasks but could not close session:', closeErr.message)
  }

  return Response.json({
    tasks_created: applied.taskIds.length,
    tasks_failed: applied.failed,
    kind: target.kind,
    id: target.id,
    name: target.name,
  })
}
