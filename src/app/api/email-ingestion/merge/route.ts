/**
 * Fold a staged conversation into a record that already exists.
 *
 * ⚠ `merge` was a LABEL WITH NOTHING BEHIND IT. The pre-decide phase has been
 * returning `disposition: 'merge'` with a `merge_target_name` since it shipped,
 * `/decide` and `/intake` both render it — and there was no merge control in
 * the review form and no merge branch in the confirm route. Six sessions were
 * sitting on a recommendation whose only available action was to dismiss it.
 *
 * The machinery was already written and simply never called this way:
 * `linkClusterToRecord` ties a session's threads to a record with `linked`
 * certainty, the apply phase then posts the correspondence and imports the
 * attachments, and the confirm route has called it since day one — with the id
 * of a record it had just CREATED. Handing it an EXISTING id is the merge.
 *
 * Nothing new is created here. That is the point of merging.
 */

import { NextRequest } from 'next/server'
import { actorAdminClient } from '@/lib/auth/viewer'
import { getViewer } from '@/lib/auth/viewer'
import { linkClusterToRecord } from '@/lib/email-sweep/cluster-link'
import { resolveMergeTarget } from '@/lib/email-ingestion/merge-target'

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
    .select('id, status, predecision, match_candidates')
    .eq('id', sessionId)
    .single()

  if (!session) {
    return Response.json({ error: 'Session not found' }, { status: 404 })
  }
  if (session.status !== 'pending') {
    return Response.json(
      { error: `Session is already ${session.status}.` },
      { status: 409 }
    )
  }

  const target = resolveMergeTarget(session.predecision, session.match_candidates)
  if (!target.ok) {
    // Ambiguity means no match — the same refusal the thread router makes when
    // two records answer to one name. Guessing here would file a conversation
    // onto the wrong deal, which is the expensive half of the trade.
    return Response.json({ error: target.reason }, { status: 400 })
  }

  await linkClusterToRecord(sessionId, target.projectId, target.opportunityId)

  await supabase
    .from('email_intake_sessions')
    .update({
      status: 'confirmed',
      created_record_ids: {
        merged_into: target.projectId ?? target.opportunityId,
        merged_kind: target.projectId ? 'project' : 'opportunity',
        merged_name: target.name,
      } as unknown as never,
      confirmed_at: new Date().toISOString(),
    })
    .eq('id', sessionId)

  return Response.json({
    merged_into: target.projectId ?? target.opportunityId,
    kind: target.projectId ? 'project' : 'opportunity',
    name: target.name,
  })
}
