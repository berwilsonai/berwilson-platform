/**
 * A CONTACT'S OWN FEED — the conversations we have had with a person.
 *
 * ⚠ WHY A TABLE AND NOT `parties.relationship_notes`. Measured 2026-10-23:
 * 98 of 151 contacts have that column filled, so it is in daily use — and it is
 * ONE textarea. It answers "who is this person" and it cannot answer "what did
 * we say on the 14th, and then again on the 22nd". Every other record type in
 * the platform already has the second shape (`task_notes`, `investor_notes`,
 * `lead_notes`, `opportunity_notes`, `steel_deal_notes`, `personnel_notes`,
 * `dino_notes`); `parties` was the only one without. Richard's own words for
 * the gap: "often times they wont be tied to any particular project or
 * opportunity" — a networking call has nowhere else to land.
 *
 * So `relationship_notes` keeps its job (the standing description, edited in
 * place) and this carries the sequence. They are not alternatives.
 *
 * ⚠ AND THE AUTOMATIC WRITER IS AN UPDATE, NOT A CREATION. §11 permits Pepper
 * to update records with no approval and forbids her creating a project,
 * opportunity, party or lead. A note on a contact that already exists is the
 * same class of write as the mail sweep's `opportunity_notes` row (86 of that
 * table's 90 rows were written by Ber AI) — a child row on an existing record,
 * reversible, carrying its own provenance. Creating the CONTACT stays a human
 * act, which is what `attendee-findings.ts` is for.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database, Refine, Tables, TablesInsert } from '@/lib/supabase/types'

type AdminClient = SupabaseClient<Database>

/**
 * Which door wrote the note.
 *
 * ⚠ THE ONE PLACE THIS UNION LIVES, and it must equal the CHECK on
 * `party_notes.source` — §12: a value outside an enum fails the WHOLE query and
 * returns a NULL row set, so a plausible-but-wrong member here discards every
 * other field in the same insert. Deliberately structural (the doors) rather
 * than a taxonomy of relationship moments: a category the writer was never told
 * about simply never fires, and what KIND of conversation it was is prose in the
 * body, where nothing can lose it.
 */
export type PartyNoteSource = 'typed' | 'meeting' | 'email'

/** The row, with the CHECK-backed column narrowed from the generator's `string`. */
export type PartyNote = Refine<Tables<'party_notes'>, { source: PartyNoteSource }>

/**
 * A contact's feed, newest conversation first.
 *
 * Ordered by `note_date` and not by `created_at`: a recording swept at 02:00 is
 * a conversation from the afternoon before, and a backfilled call from August
 * must not sit above this morning's coffee. `created_at` breaks the tie for two
 * notes on one day.
 */
export async function listContactNotes(
  partyId: string,
  limit = 100,
  client?: AdminClient,
): Promise<PartyNote[]> {
  const supabase = client ?? createAdminClient()
  const { data, error } = await supabase
    .from('party_notes')
    .select('*')
    .eq('party_id', partyId)
    .order('note_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    console.error('[contacts/notes] could not read the feed:', error.message)
    return []
  }
  return (data ?? []) as PartyNote[]
}

export interface MeetingForContactNote {
  id: string
  title: string | null
  meeting_date: string | null
  summary: string | null
  minutes: string | null
  /** 'project' | 'opportunity' | 'company' | 'unfiled' | 'contact'. */
  scope: string | null
  kind: string | null
}

/**
 * The body a conversation writes onto a person's feed.
 *
 * ⚠ THE SUMMARY, NOT THE MINUTES, AND NOT THE TRANSCRIPT. A recording's
 * transcript is already a document and already indexed as `thread_chunks` — §12:
 * two doors for one artifact means asking which one owns its index, or the same
 * text sits in two corpora as two answers that can disagree. What a contact's
 * feed is FOR is reading, so it carries the recap and a pointer to the register
 * entry, which is where the verbatim lives.
 *
 * ⚠ AND IT NAMES WHAT THE CALL WAS ABOUT RATHER THAN CLAIMING A DEAL. A
 * 'contact'-scoped call belongs to no project by a human's decision and an
 * 'unfiled' one does not belong to one YET; saying "not filed on a deal" about
 * the first would read as a backlog item on somebody's profile.
 */
export function meetingNoteBody(meeting: MeetingForContactNote): string | null {
  const recap = meeting.summary?.trim() || meeting.minutes?.trim() || null
  if (!recap) return null
  const what =
    meeting.kind === 'call' ? 'Recorded call' : meeting.kind === 'site_visit' ? 'Site visit' : 'Meeting'
  const title = meeting.title?.trim()
  const head = title ? `${what} — ${title}` : what
  return `${head}\n\n${recap}`
}

export interface LogMeetingResult {
  /** Notes written by this call. */
  written: number
  /** Contacts that already carried this meeting — the latch doing its job. */
  alreadyHad: number
  /** Why nothing was written, when nothing was. Never silent (§12). */
  skipped: string | null
}

/**
 * Put a conversation on the feed of every contact who was in it.
 *
 * ⚠ IDEMPOTENT BY READING FIRST, BECAUSE THE LATCH IS A PARTIAL INDEX. §12:
 * `ON CONFLICT` cannot use a partial unique index, and PostgREST has no way to
 * repeat the predicate — so this reads the (party, meeting) pairs that already
 * exist and inserts the rest. A 23505 from a concurrent run is a no-op, not a
 * failure: both runs wanted the same row.
 *
 * ⚠ A MEETING NOTE IS NOT INDEXED, AND A TYPED ONE IS. §12: two doors for one
 * artifact means asking which one OWNS its index, or both build one and the same
 * text sits in two corpora as two answers that can disagree. A recording's words
 * are already in the index — as `thread_chunks` for a swept recording, or as a
 * filed transcript — and this note is a DERIVATIVE of them, written so a person
 * can read their own history on a profile. Embedding it would put the same
 * conversation in `chunks` to compete with itself, which is exactly why
 * `upsertMeetingFromImport` sets `index_ai: false` on its own row. A note a human
 * TYPES has no other home, so `/api/updates/save` embeds that one.
 *
 * ⚠ IT UPDATES AN EXISTING NOTE WHEN THE RECAP HAS MOVED ON. A recording is
 * registered minutes before its thread is routed, and a reviewer can retitle a
 * meeting at any time, so the body a contact carries goes stale under them —
 * §12: an orphaned projection looks perfectly live. The note is rewritten only
 * when the derived body actually differs, and only when nobody has edited it
 * (`updated_at` still equal to `created_at`): once a human has touched their own
 * note about a person, it is theirs.
 */
export async function logMeetingOnContacts(
  supabase: AdminClient,
  meeting: MeetingForContactNote,
  partyIds: string[],
): Promise<LogMeetingResult> {
  const unique = [...new Set(partyIds.filter(Boolean))]
  if (unique.length === 0) return { written: 0, alreadyHad: 0, skipped: 'no linked contacts' }

  const body = meetingNoteBody(meeting)
  if (!body) return { written: 0, alreadyHad: 0, skipped: 'the meeting carries no recap yet' }

  const { data: existing, error: readErr } = await supabase
    .from('party_notes')
    .select('id, party_id, body, created_at, updated_at')
    .eq('meeting_id', meeting.id)
    .in('party_id', unique)
  if (readErr) {
    return { written: 0, alreadyHad: 0, skipped: `could not read the existing notes: ${readErr.message}` }
  }

  const have = new Map((existing ?? []).map((r) => [r.party_id, r]))
  const toInsert: TablesInsert<'party_notes'>[] = []

  for (const partyId of unique) {
    const row = have.get(partyId)
    if (!row) {
      toInsert.push({
        party_id: partyId,
        body,
        summary: meeting.summary?.trim() || null,
        author: 'Ber AI',
        source: 'meeting',
        meeting_id: meeting.id,
        note_date: meeting.meeting_date ?? undefined,
      })
      continue
    }
    // Refresh a stale copy, never a touched one.
    const untouched = !row.updated_at || !row.created_at || row.updated_at === row.created_at
    if (row.body !== body && untouched) {
      const { error } = await supabase
        .from('party_notes')
        .update({ body, summary: meeting.summary?.trim() || null, note_date: meeting.meeting_date ?? undefined })
        .eq('id', row.id)
      if (error) console.error('[contacts/notes] could not refresh a meeting note:', error.message)
    }
  }

  let written = 0
  if (toInsert.length > 0) {
    const { data, error } = await supabase.from('party_notes').insert(toInsert).select('id')
    if (error) {
      // 23505 means a concurrent run wrote the same (party, meeting) pair. Both
      // runs wanted the row, so the outcome is correct and this is not an error.
      if (error.code !== '23505') {
        return {
          written: 0,
          alreadyHad: have.size,
          skipped: `could not write the notes: ${error.message}`,
        }
      }
    } else {
      written = data?.length ?? 0
    }
  }

  return { written, alreadyHad: have.size, skipped: null }
}

/**
 * Backfill the feed for one contact from every meeting they are an attendee on.
 *
 * ⚠ THIS IS THE "MERGE THAT CALL SUMMARY WITH AN EXISTING CONTACT" HALF of
 * Richard's 10-23 instruction, and it must run on a RESOLUTION as well as on a
 * sweep. A name heard on a call in August is linked to a contact today; the
 * conversations are already recorded, and asking from the side that just
 * changed is the only way they reach the person (§12: a cleanup that is a side
 * effect of having work to do never reaches the rows with no work).
 *
 * The attendee array is jsonb, so the meetings are found by a containment
 * filter on `party_id` rather than by a join.
 *
 * ⚠ THE FILTER VALUE IS A JSON **STRING**, AND PASSING THE ARRAY ITSELF FAILS
 * SILENTLY-ISH. `supabase-js`'s `.contains()` sees an Array and renders it as a
 * POSTGRES array literal — `{${value.join(',')}}` — so an array of objects
 * becomes the literal `{[object Object]}` and Postgres answers `invalid input
 * syntax for type json`. The caller logged it and returned `{written: 0}`, so a
 * live round trip reported a contact linked to three calls with an EMPTY feed
 * and no failure anywhere above it. §12: a refusal must not be reported as an
 * absence — and this one was found only by running the whole path against real
 * rows and reading what landed, which a typecheck and the suite both passed.
 * A string is forwarded to PostgREST verbatim, which is what jsonb `cs` wants.
 */
export async function backfillContactFeed(
  supabase: AdminClient,
  partyId: string,
): Promise<{ written: number; meetings: number }> {
  const { data, error } = await supabase
    .from('meetings')
    .select('id, title, meeting_date, summary, minutes, scope, kind')
    .contains('attendees', JSON.stringify([{ party_id: partyId }]))
  if (error) {
    console.error('[contacts/notes] could not read this contact’s meetings:', error.message)
    return { written: 0, meetings: 0 }
  }

  let written = 0
  for (const meeting of data ?? []) {
    const result = await logMeetingOnContacts(supabase, meeting, [partyId])
    written += result.written
  }
  return { written, meetings: (data ?? []).length }
}

/**
 * Remove the notes THIS PASS wrote for a meeting, leaving anything a human
 * typed alone.
 *
 * ⚠ IT EXISTS FOR CONTAINMENT, NOT FOR TIDINESS. A recording is registered
 * `unfiled` and its recap reaches the attendees' feeds straight away; the thread
 * router may then file that same conversation onto a project marked
 * `confidential`, minutes later. §8 is absolute about what follows — a protected
 * project leaves every cross-portfolio surface — and a contact profile that
 * anybody may open, carrying the recap of a protected deal's call, is one. The
 * recap cannot be un-read, but it can be un-published, and the register entry
 * (`meetings`, which the step-up gates) keeps it.
 *
 * Scoped to `source = 'meeting'` and nothing else, because a note a human wrote
 * about a person is theirs and `author` can be edited.
 */
export async function removeMeetingNotes(
  supabase: AdminClient,
  meetingId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('party_notes')
    .delete()
    .eq('meeting_id', meetingId)
    .eq('source', 'meeting')
    .select('id')
  if (error) {
    console.error('[contacts/notes] could not withdraw the meeting notes:', error.message)
    return 0
  }
  return data?.length ?? 0
}
