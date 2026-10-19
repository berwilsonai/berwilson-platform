import { NextRequest } from 'next/server'
import { requireProjectAccess } from '@/lib/security/guard'
import { actorAdminClient, getViewer, canAccessOpportunity, forbiddenJson } from '@/lib/auth/viewer'
import { logEntry, type LogTarget } from '@/lib/records/log-entry'

/**
 * A human logged something on a deal — one door for both record kinds.
 *
 * Takes `project_id` XOR `opportunity_id`. The write itself is `logEntry` in
 * `src/lib/records/log-entry.ts`, which is one pass with a target: it picks the
 * table (`updates` / `opportunity_notes`), stores the extraction beside the raw
 * text, turns the confirmed action items into real tasks, and indexes it.
 *
 * ⚠ The two kinds take DIFFERENT access checks and that is not an oversight.
 * A project may be `confidential`, so it goes through `requireProjectAccess`,
 * which can answer "locked — step up first". An opportunity has no such flag;
 * its gate is the access grant, and the id arrives in the BODY where the
 * middleware cannot see it either way (§12).
 */
export async function POST(request: NextRequest) {
  const body = await request.json()
  const {
    project_id,
    opportunity_id,
    raw_content,
    summary,
    action_items,
    waiting_on,
    risks,
    decisions,
    mentioned_parties,
    confidence,
  } = body

  if (!raw_content || typeof raw_content !== 'string' || !raw_content.trim()) {
    return Response.json({ error: 'raw_content is required' }, { status: 400 })
  }
  // Exactly one, never both — the same exactly-one rule the shared-children
  // tables carry as a CHECK (§4). Naming both is a caller bug, not a choice to
  // resolve by preferring one.
  if (!!project_id === !!opportunity_id) {
    return Response.json(
      { error: 'exactly one of project_id or opportunity_id is required' },
      { status: 400 },
    )
  }

  const target: LogTarget = project_id
    ? { kind: 'project', id: project_id }
    : { kind: 'opportunity', id: opportunity_id }

  const viewer = await getViewer()

  if (target.kind === 'project') {
    // This route writes an update AND embeds it into `chunks`, so it is one of
    // the two doors content enters retrieval through.
    const denied = await requireProjectAccess(target.id)
    if (denied) return denied
  } else if (viewer && !viewer.isAdmin && !canAccessOpportunity(viewer, target.id)) {
    return forbiddenJson()
  }

  const supabase = await actorAdminClient()

  try {
    const result = await logEntry(supabase, target, {
      rawContent: raw_content,
      summary,
      actionItems: Array.isArray(action_items) ? action_items : [],
      waitingOn: Array.isArray(waiting_on) ? waiting_on : [],
      risks: Array.isArray(risks) ? risks : [],
      decisions: Array.isArray(decisions) ? decisions : [],
      mentionedParties: Array.isArray(mentioned_parties) ? mentioned_parties : [],
      confidence,
      // Stamped from the signed-in viewer, never from the client — otherwise a
      // note could be posted under someone else's name.
      author: viewer?.teamMemberName ?? viewer?.email ?? null,
    })
    return Response.json({ id: result.id, tasks_created: result.tasksCreated, table: result.table })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Save failed'
    console.error('Save entry failed:', message)
    return Response.json({ error: message }, { status: 500 })
  }
}
