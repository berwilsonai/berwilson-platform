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
 *
 * ⚠ A HUMAN'S `target` OUTRANKS THE RESOLVER, AND THAT IS WHY IT EXISTS (10-28,
 * Richard's direction). Without it the only merge this route would perform was
 * the one the pre-decide phase had already named, so a session the matcher
 * could not place offered "Create project" and nothing else — measured on the
 * live queue the same day, a thread labelled `GridEdgeDC` against an
 * opportunity literally called **GridEdge**, whose candidate list held Heber
 * Development and Myton Development at 0.38 trigram and no GridEdge at all.
 * The resolver was not wrong to refuse; the queue was wrong to have no other
 * answer. §12 — ambiguity must mean no match, and an ASSERTION by a person is
 * a fact, not a better guess.
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
  /**
   * The record a HUMAN chose, in place of the one the pre-decide named.
   *
   * Omitted is the original behaviour and still the common path: resolve the
   * pre-decision's own `merge_target_name` out of the session's candidates.
   */
  target?: { kind?: unknown; id?: unknown }
}

const TARGET_TABLES = {
  project: 'projects',
  opportunity: 'opportunities',
} as const

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

  /*
    Where it lands: the person's pick if they made one, otherwise the resolver.

    ⚠ THE CHOSEN RECORD IS READ BACK BEFORE ANYTHING MOVES, exactly as the
    refile route does. A dangling id would otherwise retire the session against
    a record that does not exist, and the conversation would be filed nowhere
    with the queue reporting it done.
  */
  let kind: 'project' | 'opportunity'
  let id: string

  const picked = body.target
  if (picked) {
    const pickedKind = picked.kind
    const pickedId = picked.id
    if ((pickedKind !== 'project' && pickedKind !== 'opportunity') || typeof pickedId !== 'string' || !pickedId) {
      return Response.json(
        { error: 'target must be { kind: "project" | "opportunity", id }.' },
        { status: 400 }
      )
    }
    const { data: dest, error: destErr } = await supabase
      .from(TARGET_TABLES[pickedKind])
      .select('id')
      .eq('id', pickedId)
      .maybeSingle()
    if (destErr) return Response.json({ error: destErr.message }, { status: 500 })
    if (!dest) {
      return Response.json({ error: `That ${pickedKind} no longer exists.` }, { status: 404 })
    }
    kind = pickedKind
    id = pickedId
  } else {
    const target = resolveMergeTarget(session.predecision, session.match_candidates)
    if (!target.ok) {
      // Ambiguity means no match — the same refusal the thread router makes when
      // two records answer to one name. Guessing here would file a conversation
      // onto the wrong deal, which is the expensive half of the trade. The
      // picker on /decide, and the review screen's "Add to existing", are where
      // a human resolves it.
      return Response.json({ error: target.reason }, { status: 400 })
    }
    kind = target.projectId ? 'project' : 'opportunity'
    id = target.projectId ?? target.opportunityId!
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
