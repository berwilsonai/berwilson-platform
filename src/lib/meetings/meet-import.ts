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
  type DriveFile,
} from '@/lib/integrations/google-drive'
import { analyzeMeetingNotes, type SeedAttendee } from '@/lib/email-ingestion/analyze-meeting'
import { SYSTEM_USER_ID } from '@/lib/email-ingestion/analyze'

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

export interface MeetImportResult {
  mailboxes: number
  found: number
  imported: number
  alreadyImported: number
  tooShort: number
  failed: number
  /** Recordings sitting in Drive with no transcript beside them. */
  recordingsWithoutTranscript: number
  /** Mailboxes with no Meet Recordings folder at all. */
  noMeetFolder: string[]
  notes: string[]
}

/** Meet names a transcript "<title> - <timestamp> - Transcript". Recover the title. */
export function meetingTitleFromFileName(name: string): string {
  return (
    name
      .replace(/\.txt$/i, '')
      .replace(/\s*-\s*Transcript\s*$/i, '')
      // Meet appends "(2026-08-27 14:00 GMT-6)" — informative in the file name,
      // noise in a meeting title the reviewer has to read.
      .replace(/\s*\(\d{4}-\d{2}-\d{2}[^)]*\)\s*$/, '')
      .trim() || name
  )
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
        const outcome = await importOne(file, mailbox, events)
        if (outcome === 'imported') result.imported++
        else if (outcome === 'too_short') result.tooShort++
        else result.alreadyImported++
        seen.add(file.id)
      } catch (err) {
        result.failed++
        result.notes.push(
          `${file.name}: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
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

/** Pull one transcript, seed it from its calendar event, stage it for review. */
async function importOne(
  file: DriveFile,
  mailbox: string,
  events: CalendarEvent[]
): Promise<Outcome> {
  const content = await fetchDriveFile(file, { mailbox })
  if (!content) throw new Error('Drive returned nothing for this transcript.')

  const text = Buffer.from(content.buffer).toString('utf-8').trim()
  if (text.length < MIN_TRANSCRIPT_CHARS) return 'too_short'

  const title = meetingTitleFromFileName(file.name)
  const event = matchCalendarEvent(title, events)

  const meetingDate = localDateString(event?.start || file.modifiedTime)
  const seedAttendees: SeedAttendee[] = (event?.attendees ?? []).map((a) => ({
    name: a.name,
    email: a.email,
  }))

  try {
    await analyzeMeetingNotes({
      rawText: text,
      title: event?.subject || title,
      meetingDate,
      userId: SYSTEM_USER_ID,
      seedAttendees,
      driveFileId: file.id,
    })
  } catch (err) {
    // The unique index is the real guard against a concurrent run staging the
    // same transcript twice. Losing that race is a no-op, not a failure.
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('email_intake_sessions_drive_file_id_key') || msg.includes('23505')) {
      return 'duplicate'
    }
    throw err
  }
  return 'imported'
}
