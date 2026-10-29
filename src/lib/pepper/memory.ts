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
  /** Every morning it has been named, TODAY INCLUDED if it already has been. */
  timesNamed: number
  /**
   * Mornings before this one — what "the fourth morning" actually counts.
   *
   * ⚠ THIS IS NOT `timesNamed` AND THE DIFFERENCE IS ORDERING. Both channels
   * record what they named, so by the time the 06:50 email loads memory the
   * 06:45 text may already have counted today — and `timesNamed` would then
   * make the clause say "RAISED ON 4 PREVIOUS MORNINGS" on the fourth morning.
   * The same overstatement was already reachable with `?force=1`, which
   * re-sends a note on a day it has been recorded. Deriving the figure the
   * clause means, rather than relying on which cron ran first, makes it true
   * by construction.
   */
  previousMornings: number
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
  kind: NoteItemKind,
  today = new Date().toISOString().slice(0, 10)
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
    const namedToday = row.last_named_on === today
    out.set(row.item_key, {
      timesNamed: row.times_named,
      previousMornings: Math.max(0, row.times_named - (namedToday ? 1 : 0)),
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
  //
  // ⚠ DEDUPED FIRST. `ON CONFLICT DO UPDATE cannot affect row a second time` is
  // what Postgres answers to one statement carrying the same (kind, item_key)
  // twice, and it fails the WHOLE upsert — every other mention in the note
  // along with it. The three task buckets are disjoint today and owed/awaited
  // are split by `side`, so nothing reaches it; the guard is here because the
  // cost of a new caller getting that wrong is the entire morning's memory.
  const unique = new Map<string, RecordedMention>()
  for (const i of items) unique.set(`${i.kind}:${i.itemKey}`, i)

  const rows = [...unique.values()].map((i) => {
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
  if (!m || m.previousMornings < ESCALATE_AFTER) return null
  return `, RAISED ON ${m.previousMornings} PREVIOUS MORNINGS and still open — first on ${m.firstNamedOn}`
}

/**
 * Did this arrive since the last note?
 *
 * ⚠ THE ONE THING THE NOTE COULD NOT SAY, AND THE REASON IT STOPPED EARNING ITS
 * SLOT. Held 2026-10-21 because *"the content isn't really helpful at this
 * point"*; read back, the last note sent is almost entirely the standing
 * ledger — three of its fourteen bullets say *"this is the fifth morning I've
 * raised them"*, two more say third or fourth, and two sections end *"Another
 * 30 behind these."* Against 199 open commitments it samples ten and counts the
 * rest, so a reader cannot tell yesterday's note from today's.
 *
 * Measured 2026-10-29: **4 to 16 commitments arrive per day**, median ~9,
 * against that standing 199. So "what came in since I last wrote" is a real,
 * bounded, genuinely-new section every morning — which is what a DAILY message
 * needs to be worth opening, and exactly what this note had no way to express.
 *
 * ⚠ THIS IS ADDITIVE AND HIDES NOTHING, WHICH IS THE CONSTRAINT THIS MODULE'S
 * OWN HEADER SETS. The mention count may annotate and may reorder within a
 * band, and "can never hide anything" — the reader's way to say *not today* is
 * the snooze tap, not the platform deciding for them. Marking what is new takes
 * nothing off the list; it only tells the reader which end is which.
 *
 * ⚠ PARSED, NOT STRING-COMPARED. `sinceIso` comes from `Date.toISOString()`
 * (`…T09:00:00.000Z`) and `created_at` from PostgREST (`…T09:00:00.123+00:00`).
 * Lexicographically `+` sorts BEFORE `Z`, so two identical instants in the two
 * formats compare the wrong way round — the kind of edge that is invisible
 * until the one morning it matters.
 */
export function arrivedSince(createdAt: string | null, sinceIso: string): boolean {
  if (!createdAt) return false
  const made = Date.parse(createdAt)
  const since = Date.parse(sinceIso)
  if (!isFinite(made) || !isFinite(since)) return false
  return made >= since
}

/** The marker the prompt reads. Empty when the item is not new. */
export function arrivedClause(createdAt: string | null, sinceIso: string): string {
  return arrivedSince(createdAt, sinceIso) ? ', NEW SINCE THE LAST NOTE' : ''
}
