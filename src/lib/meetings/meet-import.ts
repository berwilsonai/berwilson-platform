/**
 * Google Meet transcript import.
 *
 * An executive records a call in Meet. Google writes the verbatim transcript
 * into that organizer's Drive. This pulls it in, seeds it with the attendees
 * from the matching calendar event, and stages it through the EXISTING
 * meeting-intake path — the same one a pasted transcript takes. That path
 * already runs the AI recap, pre-matches the projects and opportunities the
 * meeting touched, and holds all of it for a human to confirm.
 *
 * Nothing is created automatically. §11's invariant is the reason: the platform
 * may read, summarize, and propose, but a recording becomes a record only when
 * a person says so. The review screen at /intake/meeting/[id] is that step.
 *
 * Only the deal mailboxes (MAILBOXES — the executives) are read. Steel reps
 * record in Meet and keep their files in their own Drive; the platform
 * deliberately never looks.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import {
  MAILBOXES,
  isGoogleConfigured,
  fetchCalendarEvents,
  type CalendarEvent,
} from '@/lib/integrations/google-workspace'
import {
  listMeetTranscripts,
  fetchDriveFile,
  MEET_FOLDER_NAMES,
  type DriveFile,
} from '@/lib/integrations/google-drive'
import { analyzeMeetingNotes, type SeedAttendee } from '@/lib/email-ingestion/analyze-meeting'
import { SYSTEM_USER_ID } from '@/lib/email-ingestion/analyze'
import { splitGeminiNotes } from '@/lib/meetings/gemini-notes'
import { resolveMeetingTarget, fileMeetingDocument, type FileTarget } from '@/lib/meetings/file-notes'
import { upsertMeetingFromImport, linkDocumentToMeeting } from '@/lib/meetings/record'

/**
 * How far back a first run reaches. A Drive with two years of calls would
 * otherwise stage hundreds of sessions into a review queue nobody could face —
 * and the value of this is tomorrow's meetings, not 2024's.
 */
const FIRST_RUN_DAYS = 14

/** Per-run ceiling. Each transcript costs one local-model pass (~30-60s). */
const MAX_PER_RUN = 12

/** Transcripts shorter than this are a call somebody joined and left. */
const MIN_TRANSCRIPT_CHARS = 400

/**
 * Ber Wilson's own name, as it is actually typed. "Bear Wilson" is a standing
 * misspelling in correspondence (and in these very transcripts), so both forms
 * are dropped from filing candidates — the company is never the deal.
 */
const OWN_COMPANY = /^(ber|bear)\s+wilson$/i

export interface MeetImportResult {
  mailboxes: number
  found: number
  imported: number
  alreadyImported: number
  tooShort: number
  failed: number
  /** Recordings sitting in Drive with no transcript beside them. */
  recordingsWithoutTranscript: number
  /** Mailboxes with no Meet folder at all. */
  noMeetFolder: string[]
  /** Notes filed straight onto a project/opportunity named in the title. */
  filed: number
  /**
   * Filed on the REFERENCE shelf because the title named no record.
   *
   * These used to be counted as `unfiled` and filed nowhere at all — the
   * transcript existed only in Drive, unsearchable and unquotable, until
   * somebody worked the review queue. Measured on the live corpus: 3 of 5
   * imported transcripts, including a call from the day before.
   */
  filedReference: number
  /** Imported but left for the reviewer to file — no confident title match. */
  unfiled: number
  /** Meeting records created in `meetings`, which is what the agent reads. */
  meetingsCreated: number
  notes: string[]
}

/**
 * Recover the meeting title from a Meet artifact file name.
 *
 * Meet has used two stamping conventions and both turn up in one Drive:
 *   "<title> (2026-08-27 14:00 GMT-6) - Transcript"
 *   "<title> - 2026/09/25 10:58 MDT - Notes by Gemini"
 *
 * The title itself is left alone, slashes and all. "Ber Wilson/TensorIQ/Elite
 * Solutions" is what the organizer typed into the invitation, and that path is
 * the strongest filing key the platform gets — see meetingTargetFromTitle.
 */
export function meetingTitleFromFileName(name: string): string {
  return (
    name
      .replace(/\.txt$/i, '')
      .replace(/\s*-\s*(Notes by Gemini|Transcript)\s*$/i, '')
      // "- 2026/09/25 10:58 MDT" / "- 2026-09-25 10:58 GMT-6": the trailing
      // timestamp. Anchored to the END so a date inside a real title survives.
      .replace(/\s*-\s*\d{4}[/-]\d{2}[/-]\d{2}[ T]\d{1,2}:\d{2}(:\d{2})?\s*[A-Z]{2,5}(?:[+-]\d{1,2})?\s*$/, '')
      // Meet appends "(2026-08-27 14:00 GMT-6)" — informative in the file name,
      // noise in a meeting title the reviewer has to read.
      .replace(/\s*\(\d{4}-\d{2}-\d{2}[^)]*\)\s*$/, '')
      .trim() || name
  )
}

/**
 * The record a meeting title is asking to be filed against.
 *
 * Executives title these calls as a path — "Ber Wilson/TensorIQ/Elite
 * Solutions" — so the segments are tried RIGHT TO LEFT, narrowest first.
 *
 * Not simply "the last segment": one real title is
 * "Ber Wilson/TensorIQ/Elite Solutions/Jaren Davis", where the last segment is a
 * PERSON and the deal is the one before it. Walking outwards finds the deal in
 * both shapes, and a segment that matches nothing costs only a lookup.
 *
 * Ber Wilson's own name is dropped: it is on the front of most of these titles,
 * it is not a deal, and matching it would score against half the portfolio.
 *
 * Returns candidates in preference order; a title with no slashes is tried whole.
 */
export function meetingTargetFromTitle(title: string): string[] {
  const parts = title
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !OWN_COMPANY.test(p))

  const out: string[] = []
  for (const part of [...parts].reverse()) {
    if (!out.includes(part)) out.push(part)
  }
  const whole = title.trim()
  if (whole && !out.includes(whole)) out.push(whole)
  return out
}

/** Local (not UTC) calendar date of an ISO timestamp — the same date-only
 *  convention the rest of the app stores meeting_date in. */
function localDateString(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * Find the calendar event this transcript came from.
 *
 * Matched on title against events near the transcript's timestamp, rather than
 * on the Meet link — Drive exposes no conference id on the transcript file, so
 * the title plus a day-wide window is the strongest join available. A miss is
 * harmless: the AI still reads the transcript, it just doesn't get the invitee
 * list handed to it up front.
 */
export function matchCalendarEvent(
  title: string,
  events: CalendarEvent[]
): CalendarEvent | null {
  const want = normalizeTitle(title)
  if (!want) return null
  let best: { event: CalendarEvent; score: number } | null = null
  for (const e of events) {
    const have = normalizeTitle(e.subject)
    if (!have) continue
    let score = 0
    if (have === want) score = 3
    else if (have.includes(want) || want.includes(have)) score = 2
    else continue
    if (!best || score > best.score) best = { event: e, score }
  }
  return best?.event ?? null
}

/** Import every new Meet transcript across the executive mailboxes. */
export async function importMeetTranscripts(
  opts: { budgetMs?: number; limit?: number } = {}
): Promise<MeetImportResult> {
  const started = Date.now()
  const budgetMs = opts.budgetMs ?? 25 * 60 * 1000
  const limit = opts.limit ?? MAX_PER_RUN

  const result: MeetImportResult = {
    mailboxes: MAILBOXES.length,
    found: 0,
    imported: 0,
    alreadyImported: 0,
    tooShort: 0,
    failed: 0,
    recordingsWithoutTranscript: 0,
    noMeetFolder: [],
    filed: 0,
    filedReference: 0,
    unfiled: 0,
    meetingsCreated: 0,
    notes: [],
  }

  if (!isGoogleConfigured()) {
    result.notes.push('Google Workspace is not configured.')
    return result
  }

  const supabase = createAdminClient()

  // Everything imported so far, so a transcript edited in Drive (which bumps
  // modifiedTime) is recognised rather than staged a second time.
  const { data: seenRows } = await supabase
    .from('email_intake_sessions')
    .select('drive_file_id')
    .not('drive_file_id', 'is', null)
  const seen = new Set((seenRows ?? []).map((r) => r.drive_file_id as string))

  // Reach back only to the newest thing already imported; on a first run, to
  // FIRST_RUN_DAYS. Google filters on modifiedTime server-side, so an untouched
  // back catalogue costs nothing.
  const since = seen.size
    ? null
    : new Date(Date.now() - FIRST_RUN_DAYS * 86_400_000).toISOString()

  for (const mailbox of MAILBOXES) {
    if (Date.now() - started > budgetMs) {
      result.notes.push('Ran out of time before every mailbox was read.')
      break
    }

    let artifacts
    try {
      artifacts = await listMeetTranscripts(mailbox, {
        since: since ?? undefined,
        limit: 100,
      })
    } catch (err) {
      result.failed++
      result.notes.push(
        `${mailbox}: could not list Meet transcripts — ${err instanceof Error ? err.message : String(err)}`
      )
      continue
    }

    result.recordingsWithoutTranscript += artifacts.recordingsWithoutTranscript
    if (artifacts.noMeetFolder) {
      result.noMeetFolder.push(mailbox)
      continue
    }

    const fresh = artifacts.transcripts.filter((f) => !seen.has(f.id))
    result.found += artifacts.transcripts.length
    result.alreadyImported += artifacts.transcripts.length - fresh.length
    if (!fresh.length) continue

    // Calendar events spanning the transcripts in hand, fetched once per mailbox
    // rather than per file. Widened a day either side so a call that ran past
    // midnight, or a transcript Google wrote out the next morning, still matches.
    const events = await loadEventsAround(mailbox, fresh).catch(() => [] as CalendarEvent[])

    for (const file of fresh) {
      if (result.imported >= limit) {
        result.notes.push(`Stopped at the per-run limit of ${limit}; the rest import next run.`)
        return result
      }
      if (Date.now() - started > budgetMs) {
        result.notes.push('Ran out of time; the remaining transcripts import next run.')
        return result
      }
      try {
        const one = await importOne(file, mailbox, events)
        if (one.outcome === 'imported') {
          result.imported++
          if (one.filed) result.filed++
          else if (one.filedReference) result.filedReference++
          else result.unfiled++
          if (one.meetingCreated) result.meetingsCreated++
        } else if (one.outcome === 'too_short') result.tooShort++
        else result.alreadyImported++
        if (one.note) result.notes.push(one.note)
        seen.add(file.id)
      } catch (err) {
        result.failed++
        result.notes.push(
          `${file.name}: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  }

  if (result.noMeetFolder.length) {
    // Name the folders that were looked for. The predecessor of this message said
    // only "no Meet folder", and a Drive that HAD one under a newer name read
    // identically to a Drive with none — for 192 consecutive runs.
    result.notes.push(
      `No Meet folder in ${result.noMeetFolder.join(', ')}. Looked for ${MEET_FOLDER_NAMES.map((n) => `"${n}"`).join(' or ')}; ` +
        'set GOOGLE_MEET_FOLDER_ID to a folder id if Meet files recordings somewhere else.'
    )
  }

  if (result.recordingsWithoutTranscript > 0 && result.found === 0) {
    result.notes.push(
      `${result.recordingsWithoutTranscript} recording(s) have no transcript beside them. ` +
        'Meet only writes transcripts when transcription is switched on for the meeting ' +
        '(Workspace admin console → Apps → Google Meet → Gemini/Recording settings).'
    )
  }

  return result
}

/** Calendar events covering the day of every transcript in the batch, ±1 day. */
async function loadEventsAround(mailbox: string, files: DriveFile[]): Promise<CalendarEvent[]> {
  const times = files.map((f) => new Date(f.modifiedTime).getTime()).filter((t) => isFinite(t))
  if (!times.length) return []
  const min = new Date(Math.min(...times) - 86_400_000).toISOString()
  const max = new Date(Math.max(...times) + 86_400_000).toISOString()
  return fetchCalendarEvents(min, max, mailbox)
}

type Outcome = 'imported' | 'too_short' | 'duplicate'

interface ImportOutcome {
  outcome: Outcome
  /** True when the note was filed onto a project or opportunity. */
  filed: boolean
  /** True when it was filed on the reference shelf instead — searchable, unowned. */
  filedReference: boolean
  /** True when a row was created in `meetings`. */
  meetingCreated: boolean
  /** Why it was not filed on a record, when that is worth saying out loud. */
  note?: string
}

/**
 * Pull one meeting note, seed it from its calendar event, stage it for review,
 * file the verbatim transcript, and write the meeting record.
 *
 * ⚠ THE TRANSCRIPT IS ALWAYS FILED SOMEWHERE. It used to be filed only when the
 * title matched a record name exactly, and the measurement is what forced the
 * change: 3 of the 5 transcripts ever imported matched nothing and were
 * therefore indexed nowhere — "Ber Wilson/Tensor Discuss Uintah Basin" names the
 * deal by its GEOGRAPHY, which is simply how these calls get titled. Asked about
 * that meeting the next morning, Ber AI had no passage to retrieve, and the only
 * trace was one line in a cron log.
 *
 * A transcript you were in is evidence whether or not somebody typed the right
 * words into a calendar invitation. So an unmatched one goes to the REFERENCE
 * shelf — searchable and quotable immediately, and deliberately not company
 * knowledge, because a company-scoped chunk is handed to assessFit() as
 * "RELEVANT BER WILSON EVIDENCE" and a call about deals nobody chose to pursue
 * must not be scoring future ones. Confirming the session moves it onto the
 * record that was chosen, re-pointing its chunks rather than re-embedding them.
 */
async function importOne(
  file: DriveFile,
  mailbox: string,
  events: CalendarEvent[]
): Promise<ImportOutcome> {
  const content = await fetchDriveFile(file, { mailbox })
  if (!content) throw new Error('Drive returned nothing for this meeting note.')

  const raw = Buffer.from(content.buffer).toString('utf-8')

  // A Gemini note holds the recap AND the transcript. The recap is what the
  // extraction reads — dense, already structured, and small enough to stay well
  // inside the local model's real ceiling. The whole thing is what gets filed.
  const { notes, transcript } = splitGeminiNotes(raw)
  const whole = transcript ? `${notes}\n\n${transcript}` : notes

  // Measured against the RECAP, not the export: a long transcript with an empty
  // notes tab is still nothing for a reviewer to act on.
  if (notes.length < MIN_TRANSCRIPT_CHARS) {
    return { outcome: 'too_short', filed: false, filedReference: false, meetingCreated: false }
  }

  const title = meetingTitleFromFileName(file.name)
  const event = matchCalendarEvent(title, events)

  const meetingDate = localDateString(event?.start || file.modifiedTime)
  const seedAttendees: SeedAttendee[] = (event?.attendees ?? []).map((a) => ({
    name: a.name,
    email: a.email,
  }))

  // Resolve the filing target from the title BEFORE staging, so the review
  // screen opens with it selected rather than making the reviewer find it.
  //
  // `target` is strong enough to file on; `suggestion` is only strong enough to
  // pre-tick. Both are handed to the review screen as the seed — the difference
  // is what the IMPORTER acts on, never what the reviewer is shown.
  const resolution = await resolveMeetingTarget(meetingTargetFromTitle(title)).catch(() => ({
    target: null,
    suggestion: null,
    ambiguous: null,
    via: null,
  }))
  const { target, suggestion, ambiguous, via } = resolution

  let result
  try {
    result = await analyzeMeetingNotes({
      rawText: notes,
      title: event?.subject || title,
      meetingDate,
      userId: SYSTEM_USER_ID,
      seedAttendees,
      driveFileId: file.id,
      seedTarget: target ?? suggestion,
      // The recap goes to the model; the whole export is kept on the row, so a
      // meeting the reviewer has not filed yet still has its transcript.
      retainText: whole,
    })
  } catch (err) {
    // The unique index is the real guard against a concurrent run staging the
    // same transcript twice. Losing that race is a no-op, not a failure.
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('email_intake_sessions_drive_file_id_key') || msg.includes('23505')) {
      return { outcome: 'duplicate', filed: false, filedReference: false, meetingCreated: false }
    }
    throw err
  }

  const extraction = result.extraction

  // ── The meeting becomes a record the agent can read ────────────────────────
  //
  // Not gated on a filing target. `scope='unfiled'` exists for exactly this: a
  // real meeting that nobody has attached to a deal yet. Without the row,
  // search_meetings cannot see the call at all — which is how a table meant to
  // be the meeting register ended up holding 2 rows against 5 imports.
  const meeting = await upsertMeetingFromImport({
    title: extraction.title ?? title,
    meetingDate: extraction.meeting_date ?? meetingDate,
    summary: extraction.summary || null,
    minutes: extraction.minutes,
    decisions: extraction.decisions,
    attendees: extraction.attendees,
    transcript: whole,
    driveFileId: file.id,
    target,
  }).catch((err) => {
    console.error('[meet-import] meeting record failed:', err)
    return null
  })

  // ── The verbatim transcript, filed and indexed ─────────────────────────────
  const fileTarget: FileTarget = target
    ? { kind: target.kind, id: target.id, name: target.name }
    : { kind: 'reference', id: 'reference', name: title }

  const filedDoc = await fileMeetingDocument({
    target: fileTarget,
    driveFileId: file.id,
    title,
    content: whole,
    summary: extraction.summary ?? null,
    meetingDate,
  }).catch((err) => {
    console.error('[meet-import] filing failed:', err)
    return null
  })

  // The document shows on the record's Meetings tab beside its minutes. Only
  // `documents` carries meeting_id, so an opportunity transcript is reached
  // through the opportunity's own shelf instead — see linkDocumentToMeeting.
  if (filedDoc && meeting && fileTarget.kind !== 'opportunity') {
    await linkDocumentToMeeting(createAdminClient(), filedDoc.documentId, meeting.id)
  }

  const onRecord = Boolean(target && filedDoc)
  const onReference = Boolean(!target && filedDoc)

  // Say what happened and why, in the words a reader can act on. The predecessor
  // of this message said only "no record matches the title", which read as the
  // transcript having gone nowhere — and until now it had.
  let note: string | undefined
  if (!filedDoc) {
    note = `${title}: staged, but the transcript could not be filed.`
  } else if (!target) {
    const because = ambiguous
      ? `${ambiguous}`
      : suggestion
        ? `closest is ${suggestion.name}, which is a suggestion rather than a match`
        : 'the title names no record'
    note = `${title}: filed as reference and searchable now — ${because}. Confirm it in the review queue to move it onto the deal.`
  } else if (via === 'learned_title') {
    note = `${title}: filed on ${target.name} from a title you filed before.`
  }

  return {
    outcome: 'imported',
    filed: onRecord,
    filedReference: onReference,
    meetingCreated: Boolean(meeting?.created),
    note,
  }
}
