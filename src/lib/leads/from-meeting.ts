/**
 * Stage a candidate deal named in a meeting as a LEAD.
 *
 * A site-selection or brokerage call names a dozen properties in an hour. Each
 * one is a separate decision and none of them is a pursuit yet, so creating a
 * project per property is exactly the mistake `promoteLead` exists to prevent —
 * 10 of 15 projects already sit in pursuit/capture/bid, and letting every
 * mentioned site become one is what put $50B of notional pipeline on the
 * dashboard.
 *
 * A lead is the right shape for them: the existing score phase fit-assesses each
 * one against the company pursuit profile overnight on the idle local model, the
 * queue sorts them by that verdict, and promotion stays the human gate it
 * already is.
 *
 * What a meeting lead does NOT have is a thread, a mailbox, a sender or an
 * attachment — only what somebody said on a call. That is the same shape a
 * web-form lead has had since 09-05, and every Gmail-facing consumer already
 * filters on `.not('thread_id','is',null)`, so nothing downstream needs to know.
 */

import { leadsDb } from './db'
import type { LeadRoute } from '@/lib/ai/prompts/lead-triage'

/** What the reviewer confirmed about one candidate deal from the call. */
export interface MeetingLeadInput {
  name: string
  /** How the meeting touched it — becomes the lead's summary. */
  note?: string | null
  location?: string | null
  sector?: string | null
  estimated_value?: number | null
  /**
   * 'project' for built work, 'opportunity' for a corporate transaction. Only
   * used to pick the lead's route; a lead is neither yet.
   */
  kind: 'project' | 'opportunity'
}

/** The call the deal was spoken about in. */
export interface MeetingLeadOrigin {
  title: string
  /** ISO date of the meeting, or null. */
  date: string | null
  /** Narrative minutes, trimmed into the lead's first note. */
  minutes?: string | null
  /** Follow-ups the meeting raised about THIS deal, already filtered by caller. */
  followUps?: string[]
}

export interface MeetingLeadResult {
  id: string | null
  error: string | null
}

/**
 * Route a meeting lead into the same lanes the email triage uses.
 *
 * Mirrors `promoteTargetFor` in reverse: construction leads become projects,
 * corporate leads become opportunities. Steel and Dino are deliberately absent —
 * they are decided by what the WORK is, which a reviewer tagging a site on a
 * portfolio call has not said. `unknown` would bury these in the Unsorted tab,
 * so the reviewer's own project/opportunity choice is honoured instead.
 */
function routeFor(kind: 'project' | 'opportunity'): LeadRoute {
  return kind === 'opportunity' ? 'corporate' : 'construction'
}

/**
 * The lead's first activity entry: where it came from, in a form that survives
 * promotion (`originNote` folds the summary onto the created record).
 *
 * The follow-ups are written here as TEXT rather than as tasks. `tasks.lead_id`
 * carries a UNIQUE index — one task per lead, reserved for the bid-deadline sync
 * latch — so a call that raised three follow-ups about one site cannot have all
 * three, and silently keeping one would be worse than keeping none. They become
 * real tasks when the lead is promoted and somebody owns it.
 */
function originBody(origin: MeetingLeadOrigin, input: MeetingLeadInput): string {
  const lines: string[] = [
    `Raised in "${origin.title}"${origin.date ? ` on ${origin.date}` : ''}.`,
  ]
  if (input.note?.trim()) lines.push('', input.note.trim())
  if (origin.followUps?.length) {
    lines.push('', 'Follow-ups discussed:', ...origin.followUps.map((f) => `- ${f}`))
  }
  if (origin.minutes?.trim()) {
    lines.push('', '---', '', origin.minutes.trim().slice(0, 20_000))
  }
  return lines.join('\n')
}

/**
 * Create one lead from a meeting, with its first note.
 *
 * ⚠ No dedupe key. `leads` dedupes on (thread_id, thread_item) and a meeting
 * lead has a NULL thread, which Postgres treats as distinct from every other
 * NULL — so confirming the same meeting twice would stack duplicates. What
 * prevents that is upstream: the meeting confirm route reads its session with
 * `.eq('status','pending')` and a second confirm finds nothing.
 */
export async function createLeadFromMeeting(
  input: MeetingLeadInput,
  origin: MeetingLeadOrigin
): Promise<MeetingLeadResult> {
  const name = input.name?.trim()
  if (!name) return { id: null, error: 'A lead needs a name.' }

  const db = leadsDb()
  const { data, error } = await db
    .from('leads')
    .insert({
      thread_id: null,
      mailbox: null,
      source: 'meeting',
      route: routeFor(input.kind),
      status: 'new',
      title: name,
      // The call is when we heard about it, which is what the queue sorts on.
      received_at: origin.date ? `${origin.date}T12:00:00Z` : new Date().toISOString(),
      summary: input.note?.trim() || null,
      location: input.location?.trim() || null,
      sector: input.sector?.trim() || null,
      estimated_value: input.estimated_value ?? null,
      // A human explicitly staged this from a call they attended — the same
      // standing the website form gets, and stronger than any triage guess.
      triage_confidence: 1,
      // Hands it to the existing score phase: fit assessment runs on the next
      // sweep, against the same pursuit profile everything else is judged by.
      score_state: 'pending',
      notes: `From the meeting "${origin.title}".`,
    })
    .select('id')
    .single()

  if (error) return { id: null, error: `Could not stage the lead: ${error.message}` }
  const id = (data as { id: string }).id

  const { error: noteErr } = await db.from('lead_notes').insert({
    lead_id: id,
    body: originBody(origin, input),
    author: 'Meeting intake',
  })
  // Non-fatal: the lead exists and carries its summary. Losing the note costs
  // the minutes behind it, not the deal.
  if (noteErr) console.error('[leads/from-meeting] note insert failed:', noteErr.message)

  return { id, error: null }
}
