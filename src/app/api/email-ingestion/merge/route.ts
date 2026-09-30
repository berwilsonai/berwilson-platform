/**
 * Fold a staged conversation into a record that already exists.
 *
 * ⚠ `merge` was a LABEL WITH NOTHING BEHIND IT. The pre-decide phase has been
 * returning `disposition: 'merge'` with a `merge_target_name` since it shipped,
 * `/decide` and `/intake` both render it — and there was no merge control in
 * the review form and no merge branch in the confirm route. Six sessions were
 * sitting on a recommendation whose only available action was to dismiss it.
 *
 * ⚠ AND THEN IT ONLY LINKED THE THREADS. The first version of this route called
 * `linkClusterToRecord` and stopped, so merging silently discarded the report,
 * the people, the tasks and the attachments the run had already assembled —
 * everything a create would have carried. From the chair that is indistinguishable
 * from losing the work: the correspondence pointed at the right deal and the
 * deal never heard what it said. Since 2026-09-30 a merge runs the SAME pass a
 * create runs (`applySession`), with an existing record as the target — which
 * is also what the review screen's "Add to existing" does, so the two cannot
 * drift apart.
 *
 * No record is created here. That is still the point of merging: blank columns
 * on the target are filled from the mail, nothing already set is overwritten,
 * and the record is never renamed.
 */

import { NextRequest } from 'next/server'
import { actorAdminClient } from '@/lib/auth/viewer'
import { getViewer } from '@/lib/auth/viewer'
import { applySession } from '@/lib/email-ingestion/apply-session'
import { buildConfirmBody } from '@/lib/email-ingestion/defaults'
import { parseStagedAttachments } from '@/lib/email-ingestion/attachments'
import { resolveMergeTarget } from '@/lib/email-ingestion/merge-target'
import type { EmailIntakeExtraction } from '@/lib/ai/prompts/email-intake'
import type { PartyMatch } from '@/lib/ai/proposal-matching'

export const maxDuration = 300

interface MergeBody {
  session_id?: string
}

export async function POST(request: NextRequest) {
  const viewer = await getViewer()
  if (!viewer?.isAdmin) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: MergeBody
  try {
    body = (await request.json()) as MergeBody
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const sessionId = body.session_id
  if (!sessionId) {
    return Response.json({ error: 'session_id is required' }, { status: 400 })
  }

  const supabase = await actorAdminClient()
  const { data: session } = await supabase
    .from('email_intake_sessions')
    .select('*')
    .eq('id', sessionId)
    .single()

  if (!session) {
    return Response.json({ error: 'Session not found' }, { status: 404 })
  }
  if (session.status !== 'pending') {
    return Response.json({ error: `Session is already ${session.status}.` }, { status: 409 })
  }

  const target = resolveMergeTarget(session.predecision, session.match_candidates)
  if (!target.ok) {
    // Ambiguity means no match — the same refusal the thread router makes when
    // two records answer to one name. Guessing here would file a conversation
    // onto the wrong deal, which is the expensive half of the trade. The review
    // screen's "Add to existing" picker is where a human resolves it.
    return Response.json({ error: target.reason }, { status: 400 })
  }

  // The default actions — every person, task and attachment the run staged.
  // `ready` is deliberately ignored: it only reports a missing record NAME, and
  // a merge target already has one.
  const draft = buildConfirmBody({
    sessionId: session.id,
    extraction: session.extraction_result as unknown as EmailIntakeExtraction,
    partyMatches: (session.party_matches ?? []) as unknown as PartyMatch[],
    stagedAttachments: parseStagedAttachments(session.staged_attachments),
  })

  const kind = target.projectId ? 'project' : 'opportunity'
  const id = target.projectId ?? target.opportunityId!

  const result = await applySession(supabase, session, draft.body, {
    mode: 'existing',
    kind,
    id,
  })
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status })
  }

  return Response.json({
    merged_into: result.id,
    kind: result.kind,
    name: result.name,
    fields_filled: result.ids.fields_filled ?? [],
    parties_created: result.ids.party_ids.length,
    tasks_created: result.ids.task_ids.length,
    documents_created: result.ids.document_ids.length,
  })
}
