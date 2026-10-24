import { NextRequest } from 'next/server'
import { requireProjectAccess } from '@/lib/security/guard'
import { actorAdminClient, getViewer, canAccessOpportunity, forbiddenJson } from '@/lib/auth/viewer'
import { logEntry, type LogTarget } from '@/lib/records/log-entry'
import { embedPartyNote } from '@/lib/ai/embeddings'

/**
 * A human logged something — one door for every record kind.
 *
 * Takes `project_id` XOR `opportunity_id` XOR `party_id`. The write itself is `logEntry` in
 * `src/lib/records/log-entry.ts`, which is one pass with a target: it picks the
 * table (`updates` / `opportunity_notes`), stores the extraction beside the raw
 * text, turns the confirmed action items into real tasks, and indexes it.
 *
 * ⚠ The kinds take DIFFERENT access checks and that is not an oversight.
 * A project may be `confidential`, so it goes through `requireProjectAccess`,
 * which can answer "locked — step up first". An opportunity has no such flag;
 * its gate is the access grant, and the id arrives in the BODY where the
 * middleware cannot see it either way (§12).
 *
 * ⚠ A CONTACT (`party_id`, added 2026-10-23) HAS NO RECORD-LEVEL GATE, because
 * the directory has none: every signed-in user may read and edit any contact,
 * and the auth boundary is the middleware (§8). What a contact note can still
 * do is QUOTE a protected project in prose, and indexing it makes those words
 * retrievable portfolio-wide — a limit this route does not solve and should not
 * pretend to. It is the pre-existing position of `parties.relationship_notes`
 * and of the enrichment chunks, the text is written by a human who is
 * authorised for whatever they typed, and the AUTOMATIC writer is closed: the
 * findings queue filters hidden projects in SQL before a meeting can reach a
 * contact's feed at all.
 */
export async function POST(request: NextRequest) {
  const body = await request.json()
  const {
    project_id,
    opportunity_id,
    party_id,
    note_date,
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
  // Exactly one — the same exactly-one rule the shared-children tables carry as
  // a CHECK (§4). Naming two is a caller bug, not a choice to resolve by
  // preferring one. Counted rather than compared, because three pointers cannot
  // be checked with `!!a === !!b`.
  const named = [project_id, opportunity_id, party_id].filter(Boolean)
  if (named.length !== 1) {
    return Response.json(
      { error: 'exactly one of project_id, opportunity_id or party_id is required' },
      { status: 400 },
    )
  }

  const target: LogTarget = project_id
    ? { kind: 'project', id: project_id }
    : opportunity_id
      ? { kind: 'opportunity', id: opportunity_id }
      : { kind: 'contact', id: party_id }

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
      noteDate: typeof note_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(note_date) ? note_date : null,
    })
    // ⚠ THE CONTACT ARM EMBEDS HERE AND THE OTHER TWO EMBED INSIDE logEntry.
    // Not an inconsistency: the reason is in embedPartyNote's own header — the
    // decision of WHETHER to index a contact note needs the viewer, and
    // `src/lib` cannot reach a request without dragging `next/headers` into a
    // module the crons import (§12). Fire-and-forget, as both other arms are:
    // the text is the record and the index is derived from it.
    if (target.kind === 'contact') {
      embedPartyNote(result.id, target.id, raw_content).catch(console.error)
    }
    return Response.json({ id: result.id, tasks_created: result.tasksCreated, table: result.table })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Save failed'
    console.error('Save entry failed:', message)
    return Response.json({ error: message }, { status: 500 })
  }
}
