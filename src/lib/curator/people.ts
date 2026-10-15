/**
 * The rolodex sweep — fill in the contacts the mail already describes.
 *
 * ⚠ CONTACTS WERE ONLY EVER ENRICHED AS A BY-PRODUCT, AND THE NUMBERS SAY SO.
 * `run.ts` gathers person-mentions from the evidence of each DEAL record it
 * walks, and that evidence comes strictly from `thread_links` — so a contact's
 * title is learned only if some project she is linked to happened to have new
 * correspondence that cycle, and a signature block on an unfiled thread is
 * invisible no matter how many times it appears. Measured 2026-10-15: of 97
 * contacts, 72 had no title, 54 no email and 45 no company, while
 * `curator_cursors` held 23 rows — every one of them a project or an
 * opportunity, none a party. `parties` has been in the writable registry
 * (`provenance/fields.ts`) since 10-12 with all six of its columns on the OPEN
 * tier, which is to say fully autonomous. Nothing was asking.
 *
 * So this pass walks the CORRESPONDENCE instead of the records: every
 * summarized deal thread, linked or not, newest first, handing its structured
 * people to the same `applyPeople` the record pass uses. ⚠ It does not fork
 * that function (§12), because everything that makes it safe lives inside it —
 * matching by mailbox or a unique two-word name and refusing ambiguity,
 * skipping our own people by address, newest-wins per FIELD rather than per
 * sighting, and reporting an unmatched name rather than creating a party (§11).
 *
 * ⚠ AND IT MAKES NO MODEL CALL. The sweep already extracted `people` into
 * `email_threads.summary` for every thread. §12: check whether the data is
 * already on the row before calling it an extraction problem.
 */

import { provDb } from '@/lib/provenance/db'
import type { ThreadPerson, ThreadSummary } from './evidence'
import { applyPeople, readCursor, writeCursor, type PersonMention, type PersonOutcome } from './fold'

/**
 * The cursor's identity.
 *
 * ⚠ ONE ROW FOR THE WHOLE PASS, NOT ONE PER PARTY. The record pass keys its
 * cursor on the record because its evidence is scoped to that record. Here the
 * evidence is the corpus and the targets are whoever it names, so what has to
 * be remembered is HOW FAR THROUGH THE MAIL the pass has read — a per-party
 * cursor could not express that, and would re-read the corpus once per contact.
 * `curator_cursors` has no FK on `record_id`, and the unique constraint is on
 * (table_name, record_id), so a fixed sentinel gives exactly one row.
 */
const CURSOR_TABLE = 'people_sweep'
const CURSOR_ID = '00000000-0000-0000-0000-000000000000'

/** Threads read in one page. PostgREST truncates at 1000 silently (§12). */
const PAGE = 500

/**
 * How far back a cold run reaches.
 *
 * Only used when the cursor is empty. The whole deal corpus is 1,744 threads,
 * which is one indexed read of a jsonb column and no model calls, so there is
 * no reason to cap a first run — but there IS a reason to bound it rather than
 * leave it open: a run that reads everything every night because the cursor
 * write failed should be slow enough to notice, not silently quadratic.
 */
const COLD_START = '2000-01-01T00:00:00Z'

export interface PeopleSweepResult {
  /** Threads whose structured people were read. */
  threadsRead: number
  /** Person-sightings handed to the matcher, before deduping by party. */
  mentions: number
  /** Contacts that gained at least one field. */
  enriched: number
  fieldsWritten: number
  fieldsProposed: number
  outcomes: PersonOutcome[]
  /** Named in the mail, matched to no contact. Reported, never created (§11). */
  unmatched: string[]
  /** How far through the correspondence this run read. */
  evidenceThrough: string | null
  error: string | null
}

/**
 * Walk the correspondence and fill in the rolodex.
 *
 * `force` ignores the cursor and re-reads the whole corpus; `sinceIso`
 * overrides where it starts. Same pass either way — a parameter, not a fork.
 */
export async function runPeopleSweep(args: {
  dryRun?: boolean
  force?: boolean
  sinceIso?: string
} = {}): Promise<PeopleSweepResult> {
  const { dryRun = false, force = false, sinceIso } = args
  const result: PeopleSweepResult = {
    threadsRead: 0,
    mentions: 0,
    enriched: 0,
    fieldsWritten: 0,
    fieldsProposed: 0,
    outcomes: [],
    unmatched: [],
    evidenceThrough: null,
    error: null,
  }

  let since = sinceIso ?? COLD_START
  if (!sinceIso && !force) {
    const cursor = await readCursor(CURSOR_TABLE, CURSOR_ID)
    if (cursor.error) {
      result.error = cursor.error
      return result
    }
    if (cursor.evidenceThrough) since = cursor.evidenceThrough
  }

  const mentions: PersonMention[] = []
  let newestAt: string | null = null
  let from = 0

  // Paged ASCENDING on last_at, so a partial run still advances the cursor to
  // a point everything before which has genuinely been read. Descending would
  // mean a failure halfway left the cursor past threads never examined.
  for (;;) {
    const { data, error } = await provDb()
      .from('email_threads')
      .select('id, subject, last_at, summary')
      .eq('pipeline', 'deal')
      .eq('summary_state', 'summarized')
      .gt('last_at', since)
      .order('last_at', { ascending: true })
      .range(from, from + PAGE - 1)

    if (error) {
      result.error = `threads: ${error.message}`
      return result
    }

    const rows = (data ?? []) as {
      id: string
      subject: string | null
      last_at: string | null
      summary: unknown
    }[]
    if (rows.length === 0) break

    for (const row of rows) {
      result.threadsRead += 1
      if (row.last_at && (!newestAt || row.last_at > newestAt)) newestAt = row.last_at

      // `summary` is jsonb. A thread summarized before the structured shape
      // existed, or one whose summary is prose, simply carries no people — it
      // is skipped rather than parsed hopefully.
      const structured = (row.summary ?? null) as ThreadSummary | null
      const people = Array.isArray(structured?.people) ? (structured.people as ThreadPerson[]) : []

      for (const person of people) {
        // An organization is not a contact to enrich, and a sighting with
        // neither a name nor an address cannot be matched to anything.
        if (person.is_organization) continue
        if (!person.name?.trim() && !person.email?.trim()) continue
        // Nothing to learn from a bare sighting: `applyPeople` only ever writes
        // title, company and email, so a mention carrying none of them costs a
        // match attempt and can change nothing.
        if (!person.title?.trim() && !person.company?.trim() && !person.email?.trim()) continue

        mentions.push({
          person,
          sourceKind: 'email_thread',
          sourceRef: row.id,
          sourceLabel: row.subject ?? '(no subject)',
          at: row.last_at,
        })
      }
    }

    if (rows.length < PAGE) break
    from += PAGE
  }

  result.mentions = mentions.length
  result.evidenceThrough = newestAt

  if (mentions.length === 0) {
    // Still advance the cursor: threads were read and found to name nobody new,
    // which is a real outcome and not a reason to read them again tomorrow.
    if (!dryRun && newestAt) {
      await writeCursor(CURSOR_TABLE, CURSOR_ID, newestAt, 0, 0, null)
    }
    return result
  }

  // ⚠ FILL ONLY. This source is the whole corpus, where most sightings are
  // incidental rather than descriptive — see the `fillOnly` doc on
  // `applyPeople` for the four live examples its dry run produced. The win
  // here is the 72 blank titles and 54 blank emails, not re-deciding somebody's
  // job from a passing mention.
  const applied = await applyPeople({ mentions, dryRun, fillOnly: true })
  if (applied.error) {
    result.error = `people: ${applied.error}`
    // ⚠ THE CURSOR IS NOT ADVANCED ON FAILURE. Advancing it would skip past
    // every thread this run could not apply, permanently — the failure would
    // cost the corpus rather than one night.
    if (!dryRun) {
      await writeCursor(CURSOR_TABLE, CURSOR_ID, null, 0, 0, result.error)
    }
    return result
  }

  result.outcomes = applied.outcomes
  result.unmatched = applied.unmatched
  for (const o of applied.outcomes) {
    result.fieldsWritten += o.written.length
    result.fieldsProposed += o.proposed.length
    if (o.written.length > 0) result.enriched += 1
  }

  if (!dryRun && newestAt) {
    await writeCursor(
      CURSOR_TABLE,
      CURSOR_ID,
      newestAt,
      result.fieldsWritten,
      result.fieldsProposed,
      null
    )
  }

  return result
}
