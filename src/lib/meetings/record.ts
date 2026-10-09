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
import type { TablesInsert, JsonIn, TablesUpdate } from '@/lib/supabase/types'

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
    attendees: parseAttendees(input.attendees) as unknown as JsonIn,
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
