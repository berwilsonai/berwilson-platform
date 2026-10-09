/**
 * What Pepper has already said, and to whom.
 *
 * ⚠ SHE HAD NO IDEA. `notification_log` stores a count and no body, so every
 * morning note was composed as though it were the first. Two costs, and the
 * second is far worse than the first:
 *
 *   1. She could not say "this is the fourth morning I have put this in front
 *      of you" — which is the most assistant-like sentence available to her,
 *      and the only thing that turns a list into pressure.
 *
 *   2. `commitmentWeight()` is pure f(due_date, created_at). Fully
 *      deterministic. So barring new rows the SAME twelve commitments appeared
 *      in the SAME order every single morning, while the other 357 undated
 *      obligations were never named to anybody at all. Every comment in these
 *      modules warns against teaching the reader to filter the note; the
 *      ranking function guaranteed it.
 *
 * HOW THE ROTATION WORKS, AND WHAT IT DELIBERATELY DOES NOT TOUCH. Dated and
 * overdue commitments keep their existing order exactly — a deadline is a real
 * fact and must not be shuffled for variety. The rotation applies only to the
 * UNDATED tail, where there is no intrinsic order at all: those are ranked
 * never-named first, then longest-since-named, then oldest. That turns a
 * permanent top-12 into a round robin over the whole backlog, so an obligation
 * reaches the reader within weeks instead of never.
 *
 * The mention count does two things, and the second one needs the snooze to be
 * honest. It ANNOTATES — "6th morning", via `mentionClause` — and it applies a
 * small, expiring, within-band penalty in `recentPenalty` so a row that was
 * just shown steps aside for one that was not. Demoting at all would be the
 * platform silently overruling a reader IF they had no way to say "not today";
 * `snoozed_until` is that way, it is one tap in the note, and the penalty is
 * bounded at 125 against 5,000 between bands — so it can reorder a morning and
 * can never hide anything.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import type { Tables } from '@/lib/supabase/types'

export type NoteItemRow = Tables<'pepper_note_items'>
export type NoteItemKind = 'commitment' | 'task' | 'crack'

/** What Pepper remembers about one item, for one reader. */
export interface Mention {
  timesNamed: number
  firstNamedOn: string
  lastNamedOn: string
  /** Days since she last raised it, or null if she never has. */
  daysSinceNamed: number | null
}

/** Named this many mornings and still open — worth saying out loud. */
export const ESCALATE_AFTER = 3

function daysSinceDate(date: string): number | null {
  const then = new Date(`${date}T00:00:00`).getTime()
  if (!isFinite(then)) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((today.getTime() - then) / 86_400_000)
}

/**
 * Everything Pepper has said to one person, by item key.
 *
 * One query for the whole history rather than one per row. The table is one row
 * per person per item forever, so for two executives over a 500-row ledger this
 * stays in the low thousands — small enough to read whole and keep in a Map.
 */
export async function loadMentions(
  teamMemberId: string,
  kind: NoteItemKind
): Promise<Map<string, Mention>> {
  const out = new Map<string, Mention>()
  const { data, error } = await createAdminClient()
    .from('pepper_note_items')
    .select('item_key, times_named, first_named_on, last_named_on')
    .eq('team_member_id', teamMemberId)
    .eq('kind', kind)
    // Paged generously rather than unbounded: PostgREST truncates at 1000
    // silently (§12), and this is read on every note.
    .limit(5000)

  if (error) {
    // A note without memory is the note as it was for two weeks — degraded,
    // never broken. Said out loud by the caller rather than swallowed here.
    console.error(`[pepper-memory] could not read mentions: ${error.message}`)
    return out
  }

  for (const row of (data ?? []) as Pick<
    NoteItemRow,
    'item_key' | 'times_named' | 'first_named_on' | 'last_named_on'
  >[]) {
    out.set(row.item_key, {
      timesNamed: row.times_named,
      firstNamedOn: row.first_named_on,
      lastNamedOn: row.last_named_on,
      daysSinceNamed: daysSinceDate(row.last_named_on),
    })
  }
  return out
}

export interface RecordedMention {
  kind: NoteItemKind
  itemKey: string
}

/**
 * Write down what this morning's note named.
 *
 * ⚠ RUN THIS ONLY AFTER THE SEND SUCCEEDS. Recording a mention for a note that
 * failed to send would have Pepper telling the reader "this is the fourth
 * morning" about something they have been shown twice — and §12's rule holds
 * that the value of a report of what was done is that the reader can believe
 * it.
 *
 * Idempotent per day: a forced re-run on the same date updates `last_named_on`
 * to the same value and leaves the count alone, so re-sending a note does not
 * inflate the history. The count advances only when the DAY changes.
 */
export async function recordMentions(
  teamMemberId: string,
  items: RecordedMention[],
  today = new Date().toISOString().slice(0, 10)
): Promise<number> {
  if (items.length === 0) return 0
  const supabase = createAdminClient()

  // Read the rows this note touches so the increment is correct and a same-day
  // repeat is a no-op. One query, not one per item.
  const keys = [...new Set(items.map((i) => i.itemKey))]
  const { data: existing } = await supabase
    .from('pepper_note_items')
    .select('kind, item_key, times_named, first_named_on, last_named_on')
    .eq('team_member_id', teamMemberId)
    .in('item_key', keys)

  const seen = new Map<string, Pick<NoteItemRow, 'times_named' | 'first_named_on' | 'last_named_on'>>()
  for (const row of (existing ?? []) as NoteItemRow[]) {
    seen.set(`${row.kind}:${row.item_key}`, row)
  }

  // ⚠ ONE STATEMENT WITH A UNIFORM COLUMN LIST (§12). Every row names every
  // column; a row that omitted one would receive an explicit NULL rather than
  // the default, which is loud on these NOT NULL columns and silent on nothing.
  const rows = items.map((i) => {
    const prior = seen.get(`${i.kind}:${i.itemKey}`)
    const sameDay = prior?.last_named_on === today
    return {
      team_member_id: teamMemberId,
      kind: i.kind,
      item_key: i.itemKey,
      first_named_on: prior?.first_named_on ?? today,
      last_named_on: today,
      times_named: prior ? (sameDay ? prior.times_named : prior.times_named + 1) : 1,
    }
  })

  const { error } = await supabase
    .from('pepper_note_items')
    .upsert(rows, { onConflict: 'team_member_id,kind,item_key' })

  if (error) {
    console.error(`[pepper-memory] could not record mentions: ${error.message}`)
    return 0
  }
  return rows.length
}

/**
 * How a mention reads in the note's input.
 *
 * Returns null below the escalation bar, so a first or second mention says
 * nothing — the whole point is that the count means something when it appears.
 */
export function mentionClause(m: Mention | undefined): string | null {
  if (!m || m.timesNamed < ESCALATE_AFTER) return null
  return `, RAISED ON ${m.timesNamed} PREVIOUS MORNINGS and still open — first on ${m.firstNamedOn}`
}
