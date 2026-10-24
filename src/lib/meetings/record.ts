/**
 * A recorded call becomes a row in `meetings`.
 *
 * ⚠ WHY THIS EXISTS. Until now the Meet importer staged an intake session and
 * filed a document, and `meetings` was only ever written by the hand-typed form
 * at POST /api/meetings. The result, measured on the live database: 5 imported
 * transcripts, 2 `meetings` rows, and neither of the two from an import. That is
 * two disconnected meeting systems — a minutes register the agent can read, and
 * an automatic import it mostly cannot — because `search_meetings` and
 * `get_meeting_content` read this table and nothing else. Asked what was agreed
 * with a counterparty yesterday, Ber AI's meeting tools answered nothing.
 *
 * So an import now writes the row immediately, `scope='unfiled'` when the title
 * names no record, and the confirm step moves it onto whatever the reviewer
 * chose. Nothing here CREATES a project, an opportunity, a party or a task —
 * §11's invariant is untouched. A meeting is the evidence that a conversation
 * happened; it is not a claim about what the business should do next.
 *
 * `status` stays 'draft' throughout. Approving minutes is a governance act with
 * its own button, and a machine-written recap must never arrive pre-approved.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { parseAttendees, parseDecisions, type MeetingAttendee } from '@/lib/utils/meetings'
import type { SeedTarget } from '@/lib/email-ingestion/analyze-meeting'
import type { PartyMatch } from '@/lib/ai/proposal-matching'
import type { TablesInsert, JsonIn, TablesUpdate } from '@/lib/supabase/types'
import { syncAttendeeActivity } from './attendee-activity'
import { logMeetingOnContacts, removeMeetingNotes } from '@/lib/contacts/notes'
import { isConfidentialProject } from '@/lib/security/confidential'

type AdminClient = ReturnType<typeof createAdminClient>

/** The recap fields a meeting row carries, however they were produced. */
export interface MeetingRecordInput {
  title: string
  /** 'YYYY-MM-DD'. Date-only on purpose — see the util's header. */
  meetingDate: string
  summary: string | null
  minutes: string | null
  decisions: unknown
  /** Attendee list in any of the shapes parseAttendees accepts. */
  attendees: unknown
  /** The verbatim export, when there is one. */
  transcript: string | null
  /** Drive file this came from — the idempotency key. */
  driveFileId: string | null
  /** The record it is already known to belong to, if any. */
  target: SeedTarget | null
  /**
   * Attendee → directory-contact matches the analysis already made, aligned to
   * `attendees` by `extracted_index`. See {@link linkAttendees}.
   */
  partyMatches?: PartyMatch[] | null
  /**
   * Links the CALLER resolved itself, by attendee name. A recorded phone call
   * knows who it was with from iOS's own title, which is better evidence than
   * anything in the transcript — see `src/lib/notes/call-party.ts`.
   */
  partyOverrides?: { name: string; partyId: string }[] | null
}

/**
 * Stamp `party_id` onto the attendees an identity match resolved.
 *
 * ⚠ THE CONTACT-LEVEL HALF OF A MEETING HAD NEVER ONCE FIRED, and this is why.
 * `syncAttendeeActivity` keys entirely on `attendee.party_id`, nothing on the
 * automatic path ever set one, and only the hand-typed form called it at all.
 * Measured 2026-10-14 on the live database: 6 imported meetings, 8 rows in
 * `meetings`, and **zero** `meeting_attended` rows against any contact. So a
 * call with someone was invisible on their profile no matter how many times the
 * platform read the transcript.
 *
 * ⚠ IDENTITY MATCHES ONLY — `exact_email` and `exact_name`. `fuzzy_name` is the
 * top trigram hit with no ambiguity check at all (`matchExtractedParties` step
 * 3), which is precisely §12's unchallenged match: one hit on a weak key put
 * "Cliff" on an unrelated academic. A fuzzy hit stays where it already is — a
 * suggestion in the review screen, for a human to accept in one click.
 */
export async function linkAttendees(
  attendees: MeetingAttendee[],
  partyMatches?: PartyMatch[] | null,
  overrides?: { name: string; partyId: string }[] | null
): Promise<MeetingAttendee[]> {
  const out = attendees.map((a) => ({ ...a }))

  const proposed = new Map<number, string>()
  for (const m of partyMatches ?? []) {
    if (!m.matched_party_id) continue
    if (m.match_type !== 'exact_email' && m.match_type !== 'exact_name') continue
    const at = out[m.extracted_index]
    if (at && !at.party_id) proposed.set(m.extracted_index, m.matched_party_id)
  }

  if (proposed.size > 0) {
    const directory = await peopleByName()
    for (const [index, partyId] of proposed) {
      const name = out[index].name.trim().toLowerCase()
      const byName = directory.get(name)
      // ⚠ ONLY A PERSON ATTENDS A MEETING, AND THE MODEL LISTS COMPANIES.
      // Measured across the six imported transcripts: the attendee lists name
      // "Ber Wilson" (three times) and "Bloom Energy", each a real `parties` row
      // with `is_organization = true` and an exact name match. Stamping those
      // would put "attended a call" on our own company's profile and on a
      // vendor's, which is not a fact about anybody — `meeting_attended` exists
      // to answer "when did I last speak to this person". The flag decides, not
      // the name, for the same reason `meet-import.ts` drops our own company
      // from filing candidates. An organization party is simply absent from this
      // map, so a match on one stamps nothing.
      //
      // ⚠ AND ONE NAME MUST MEAN ONE PERSON (§12: ambiguity must mean no
      // match, and one hit is an unchallenged match rather than a unique one).
      // `matchExtractedParties` ends its exact-name branch with `.limit(1)
      // .single()`, so two people called Chris Walker would hand back whichever
      // sorted first. Checked here rather than relied upon, because this is the
      // path that writes without a human looking.
      if (!byName || byName.length !== 1) continue
      if (byName[0] !== partyId) continue
      out[index].party_id = partyId
    }
  }

  for (const o of overrides ?? []) {
    const key = o.name.trim().toLowerCase()
    const at = out.find((a) => a.name.trim().toLowerCase() === key)
    if (at) {
      // The caller's own resolution wins over a fuzzy pre-match it may have
      // been given, which is the only case where two answers can disagree.
      at.party_id = o.partyId
    } else {
      out.push({ name: o.name.trim(), role: null, org: null, party_id: o.partyId, team_member_id: null })
    }
  }

  return out
}

/**
 * The directory's PEOPLE, by lowercased name — and every id that answers to it,
 * so a repeated name can be refused rather than resolved.
 *
 * One page is enough at this directory's size and PostgREST caps a response at
 * 1000 rows silently (§12), so the read is paged rather than limited.
 */
async function peopleByName(): Promise<Map<string, string[]>> {
  const supabase = createAdminClient()
  const out = new Map<string, string[]>()
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('parties')
      .select('id, full_name, is_organization')
      .eq('is_organization', false)
      .not('full_name', 'is', null)
      .order('id')
      .range(from, from + PAGE - 1)
    if (error || !data || data.length === 0) break
    for (const p of data) {
      const key = (p.full_name ?? '').trim().toLowerCase()
      if (!key) continue
      out.set(key, [...(out.get(key) ?? []), p.id])
    }
    if (data.length < PAGE) break
  }
  return out
}

export interface MeetingRecordResult {
  id: string
  created: boolean
  scope: 'project' | 'opportunity' | 'unfiled'
}

function scopeFor(target: SeedTarget | null): 'project' | 'opportunity' | 'unfiled' {
  if (target?.kind === 'project') return 'project'
  if (target?.kind === 'opportunity') return 'opportunity'
  return 'unfiled'
}

/**
 * Create the meeting row for an imported transcript, or return the one that
 * already exists.
 *
 * Idempotent through `drive_file_id`, which carries a partial unique index on
 * this table. ⚠ That index is PARTIAL, so it cannot be an `ON CONFLICT` target —
 * PostgREST has no way to repeat the predicate (§12). Hence read-then-insert,
 * with 23505 treated as "a concurrent run won" rather than as a failure.
 */
export async function upsertMeetingFromImport(
  input: MeetingRecordInput
): Promise<MeetingRecordResult | null> {
  const supabase = createAdminClient()

  if (input.driveFileId) {
    const { data: existing } = await supabase
      .from('meetings')
      .select('id, scope')
      .eq('drive_file_id', input.driveFileId)
      .maybeSingle()
    if (existing) {
      return {
        id: existing.id,
        created: false,
        scope: (existing.scope as MeetingRecordResult['scope']) ?? 'unfiled',
      }
    }
  }

  const scope = scopeFor(input.target)
  const attendees = await linkAttendees(
    parseAttendees(input.attendees),
    input.partyMatches,
    input.partyOverrides
  )
  const row: TablesInsert<'meetings'> = {
    // 'call' rather than 'client': a Meet recording is a call, and the reviewer
    // can retitle the kind. 'board' is never guessed — the governance register
    // is a human's assertion about what a meeting WAS.
    kind: 'call',
    scope,
    project_id: input.target?.kind === 'project' ? input.target.id : null,
    opportunity_id: input.target?.kind === 'opportunity' ? input.target.id : null,
    title: input.title,
    meeting_date: input.meetingDate,
    attendees: attendees as unknown as JsonIn,
    summary: input.summary,
    minutes: input.minutes,
    transcript: input.transcript,
    decisions: parseDecisions(input.decisions) as unknown as JsonIn,
    status: 'draft',
    drive_file_id: input.driveFileId,
    // The transcript is indexed as its own document by fileMeetingDocument, so
    // indexing the row's text again would put the same words in the corpus
    // twice and have them compete with each other for the same question.
    index_ai: false,
  }

  const { data, error } = await supabase.from('meetings').insert(row).select('id').single()
  if (error || !data) {
    if (error?.code === '23505' && input.driveFileId) {
      const { data: winner } = await supabase
        .from('meetings')
        .select('id, scope')
        .eq('drive_file_id', input.driveFileId)
        .maybeSingle()
      if (winner) {
        return {
          id: winner.id,
          created: false,
          scope: (winner.scope as MeetingRecordResult['scope']) ?? 'unfiled',
        }
      }
    }
    console.error('[meetings] could not create the meeting record:', error?.message)
    return null
  }

  // ⚠ THE SAME CALL THE HAND-TYPED FORM MAKES, AT THE SHARED CHOKE POINT.
  // §12: an automatic producer must write the same table the manual one does,
  // or every reader sees only the hand-typed half — and `/contacts/[id]` reads
  // `activity_log` for `meeting_attended` and nothing else. Only POST and PATCH
  // /api/meetings called this, so no imported call had ever reached a profile.
  // Non-fatal: the meeting is recorded either way.
  await syncAttendeeActivity(
    supabase,
    {
      id: data.id,
      title: row.title ?? input.title,
      meeting_date: input.meetingDate,
      scope,
      kind: row.kind ?? null,
      project_id: row.project_id ?? null,
      opportunity_id: row.opportunity_id ?? null,
    },
    attendees
  )

  // ⚠ AND THE RECAP REACHES THE PEOPLE, NOT JUST A ROW IN THE ACTIVITY LOG.
  // `syncAttendeeActivity` puts "attended a call on the 14th" on a profile; it
  // carries the title, the date and the scope and NOT ONE WORD of what was said.
  // Measured 2026-10-23: 38 such rows against 11 contacts, and a reader opening
  // any of those profiles learned that a conversation had happened and nothing
  // about it. Richard's instruction was the other half — "merge that call
  // summary with an existing contact" — so the summary lands on the feed of
  // everybody the call is SURE of, at the same choke point, written as Pepper.
  //
  // ⚠ IT IS AN UPDATE AND NOT A CREATION, so §11 is intact: the contact already
  // exists (an identity match put the `party_id` there), and a child row on an
  // existing record is the same class of write as the mail sweep's
  // `opportunity_notes`. Nobody is invented here — the unlinked attendees go to
  // the findings queue for a human, which is the whole of
  // `src/lib/contacts/attendee-findings.ts`.
  //
  // Non-fatal, like the line above it: the meeting is recorded either way.
  await logMeetingOnContacts(
    supabase,
    {
      id: data.id,
      title: row.title ?? input.title,
      meeting_date: input.meetingDate,
      summary: input.summary,
      minutes: input.minutes,
      scope,
      kind: row.kind ?? null,
    },
    attendees.map((a) => a.party_id).filter((id): id is string => !!id)
  )

  return { id: data.id, created: true, scope }
}

/**
 * Move an unfiled meeting onto the record a human just chose, and refresh the
 * recap they may have edited on the way through.
 *
 * ⚠ FILLS AND MOVES; NEVER BLANKS. A reviewer can edit the title, summary,
 * minutes and decisions in the review screen, so those are written through — but
 * only when they carry something. An absent field means "the caller did not say"
 * and must be omitted rather than nulled (§12), or confirming a session with a
 * collapsed section would erase the recap the import produced.
 *
 * ⚠ AND IT NEVER MOVES A MEETING THAT IS ALREADY FILED. Once a row carries a
 * project or an opportunity, that is a human's filing decision — a second
 * confirm naming a different record must not silently relocate it, because the
 * update feed, the players and the documents of the first record already
 * reference it.
 */
export async function attachMeetingToRecord(
  supabase: AdminClient,
  meetingId: string,
  target: { kind: 'project' | 'opportunity'; id: string },
  recap?: {
    title?: string | null
    meetingDate?: string | null
    summary?: string | null
    minutes?: string | null
    decisions?: string[]
    attendees?: MeetingAttendee[]
  }
): Promise<{ moved: boolean; reason?: string }> {
  const { data: current } = await supabase
    .from('meetings')
    .select('id, scope, project_id, opportunity_id')
    .eq('id', meetingId)
    .maybeSingle()
  if (!current) return { moved: false, reason: 'the meeting record no longer exists' }

  const patch: TablesUpdate<'meetings'> = {}

  const alreadyFiled = Boolean(current.project_id || current.opportunity_id)
  if (!alreadyFiled) {
    patch.scope = target.kind
    patch.project_id = target.kind === 'project' ? target.id : null
    patch.opportunity_id = target.kind === 'opportunity' ? target.id : null
  }

  if (recap) {
    if (recap.title?.trim()) patch.title = recap.title.trim()
    if (recap.meetingDate?.trim()) patch.meeting_date = recap.meetingDate.trim()
    if (recap.summary?.trim()) patch.summary = recap.summary.trim()
    if (recap.minutes?.trim()) patch.minutes = recap.minutes.trim()
    if (recap.decisions && recap.decisions.length > 0) patch.decisions = recap.decisions as unknown as JsonIn
    if (recap.attendees && recap.attendees.length > 0) patch.attendees = recap.attendees as unknown as JsonIn
  }

  if (Object.keys(patch).length === 0) {
    return { moved: false, reason: 'nothing to change' }
  }

  const { error } = await supabase.from('meetings').update(patch).eq('id', meetingId)
  if (error) {
    console.error('[meetings] could not attach the meeting to its record:', error.message)
    return { moved: false, reason: error.message }
  }

  // The attendees' copies carry the title, the date and the SCOPE, so a move
  // leaves them saying "not filed on a deal yet" about a call that now is.
  // Re-read rather than patched together from `patch`, which is partial.
  const { data: moved } = await supabase
    .from('meetings')
    .select('id, title, meeting_date, scope, kind, project_id, opportunity_id, attendees, summary, minutes')
    .eq('id', meetingId)
    .maybeSingle()
  if (moved) {
    await syncAttendeeActivity(supabase, moved, moved.attendees)

    // ⚠ A MOVE ONTO A PROTECTED PROJECT WITHDRAWS THE RECAP FROM THE PROFILES.
    // A recording is registered `unfiled` and its summary reaches the attendees'
    // feeds at once; the filing decision comes later, and it may be a project
    // marked `confidential`. §8 is absolute — a protected project leaves every
    // cross-portfolio surface and every outbound channel — and a contact profile
    // is a surface anybody signed in may open. The conversation is not lost: the
    // register entry keeps the transcript, behind the step-up that gates the
    // project.
    //
    // ⚠ READ WITH `isConfidentialProject` RATHER THAN A VIEWER-AWARE HELPER,
    // because this runs inside the thread router and the sweeps, which have no
    // request. Containment is the question here, not access — and §12: those are
    // different questions, and only one of them can be unlocked.
    if (moved.project_id && (await isConfidentialProject(moved.project_id))) {
      const withdrawn = await removeMeetingNotes(supabase, meetingId)
      if (withdrawn > 0) {
        console.log(
          `[meetings] withdrew ${withdrawn} contact note(s) — this call is now filed on a protected project`
        )
      }
    } else {
      // Otherwise the feeds follow the move, so a note written while the call was
      // unfiled stops describing it as such (§12: an orphaned projection looks
      // perfectly live).
      await logMeetingOnContacts(
        supabase,
        moved,
        parseAttendees(moved.attendees)
          .map((a) => a.party_id)
          .filter((id): id is string => !!id)
      )
    }
  }

  return { moved: !alreadyFiled }
}

/**
 * Point a filed transcript at its meeting row, so the record's Meetings tab
 * shows the file beside the minutes.
 *
 * Only `documents` carries `meeting_id`; `opportunity_documents` has no such
 * column, so an opportunity's transcript is reachable through the opportunity's
 * own documents shelf instead. Saying that out loud here is cheaper than a
 * future reader discovering the asymmetry from a silent no-op.
 */
export async function linkDocumentToMeeting(
  supabase: AdminClient,
  documentId: string,
  meetingId: string
): Promise<void> {
  const { error } = await supabase
    .from('documents')
    .update({ meeting_id: meetingId })
    .eq('id', documentId)
  if (error) {
    // Non-fatal: the document is filed and indexed either way.
    console.error('[meetings] could not link the transcript to its meeting:', error.message)
  }
}
