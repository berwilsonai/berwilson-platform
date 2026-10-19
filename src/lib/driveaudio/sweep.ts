/**
 * The Drive audio sweep: nominated folder → whisper → the eight mail phases.
 *
 * ⚠ THE DOOR FOR A RECORDER THAT IS NOT AN APPLE DEVICE. The platform already
 * reads two kinds of recording, and both arrive by a transport only this Mac
 * can see: an iPhone call recording lands in Apple Notes, an in-person meeting
 * lands in the Voice Memos store, and `bw-snapshot` copies each one. A hardware
 * recorder (Plaude and anything like it) can reach neither — it exports to
 * Notes as a timestamp-titled note with an attachment, which the notes sweep
 * deliberately will not transcribe (only iOS's own `Call with …` title opens
 * that door), or to Drive, where until now nothing read audio at all: the Meet
 * importer only COUNTS recordings with no transcript beside them, and a
 * knowledge folder treats an mp3 as `unsupported`.
 *
 * ⚠ ITS GATE IS THE FOLDER, NOT THE SUMMARIZER, AND THAT IS THE ONE PLACE IT
 * DIFFERS FROM THE VOICE MEMO SWEEP. Every voice memo is read because a memo
 * library is a personal archive with no filing decision in it — so the
 * summarizer has to be the gate, and a `noise` verdict deletes the transcript,
 * the chunks AND the copied audio. Here somebody chose this file and put it in
 * this folder, which is the Notes control model and the knowledge-base control
 * model (§7). So:
 *
 *   - a `noise` verdict still discards the TEXT, because the prefix is in
 *     `LOCAL_THREAD_PREFIXES` and the summarize phase redacts there by default
 *     — a filter at the choke point, not a parameter each caller passes (§12);
 *   - the AUDIO is never touched. `redact.ts` gates audio deletion on
 *     `isVoiceMemoThread`, and that is deliberate: the file is Richard's, in
 *     his Drive, and the platform deleting a document a human deliberately
 *     filed is not a thing it gets to do. Which also makes the discard
 *     recoverable — see the note the report prints.
 *
 * ⚠ IT RUNS THE PHASES ITSELF rather than waiting for the hourly mail cron,
 * for the reason the voice memo sweep does: a call that ended twenty minutes
 * ago is the most valuable thing the platform can hold, and "it will be there
 * within the hour" is the difference between an assistant and a filing cabinet.
 *
 * ⚠ IT ADDS A CALLER, NOT A PIPELINE (§12). Every phase below is the one the
 * mail sweep runs. The only new code is the reader, the transcriber, and this
 * ordering.
 */

import { storeFetchedThreads } from '@/lib/email-sweep/fetch-phase'
import { summarizePending } from '@/lib/email-sweep/summarize-phase'
import { routeThreads } from '@/lib/email-sweep/route-phase'
import { applyThreadUpdates } from '@/lib/email-sweep/apply-phase'
import { redactPrivateLocalThreads } from '@/lib/email-sweep/redact'
import { sweepDb } from '@/lib/email-sweep/db'
import { embedPendingThreads } from '@/lib/ai/thread-embeddings'
import { extractCommitments } from '@/lib/commitments/extract-phase'
import { promoteInternalCommitments } from '@/lib/commitments/internal-tasks'
import { recordLocalRecording, localDateString } from '@/lib/meetings/record-local'
import { resolveMeetingTarget } from '@/lib/meetings/file-notes'
import { fileMeetingFromThreadLinks } from '@/lib/meetings/attach-recording'
import { upsertLink } from '@/lib/email-sweep/route-phase'
import { isGoogleConfigured } from '@/lib/integrations/google-workspace'
import type { ResolvedThread } from '@/lib/integrations/gmail-search'

import { readDriveAudio, driveAudioFolderId, type DriveAudioRow } from './read'
import { transcribeDriveAudio } from './transcribe'
import { driveAudioThreadId, driveAudioToThread, driveAudioSubject } from './to-thread'

/**
 * Per-run ceiling. A first run against a folder somebody has been filling for
 * a month must not transcribe for an hour inside one cron; the rest arrive on
 * the next run, newest first.
 */
const MAX_PER_RUN = 6

export interface DriveAudioSweepResult {
  ok: boolean
  dryRun: boolean
  /** The folder that was read, so a wrong id is visible in the log. */
  folderId: string | null
  /** Recordings in the folder, after the extension filter. */
  found: number
  /** Already ingested on an earlier run — the normal steady state. */
  alreadyIngested: number
  /** Files in the folder that are not audio, named with the reason. */
  skipped: { fileName: string; reason: string }[]
  /** Outside DRIVE_AUDIO_MAX_AGE_DAYS, when a window is set. */
  tooOld: number
  transcribed: number
  /** Whisper + download milliseconds, so a slow run is visible. */
  transcribeMs: number
  /** Bytes pulled from Drive this run. */
  bytesFetched: number
  /** Could not be read this run, with why. Retried next run. */
  deferred: { title: string; why: string }[]
  /** Judged not work-related: the TEXT was discarded, the file was not. */
  discarded: { title: string }[]
  /** Became records: the meeting row, and the deal when routing was certain. */
  recorded: { title: string; meetingId: string | null; note?: string }[]
  /** Filed by the SUBFOLDER's name, before any guessing. */
  filedByFolder: { title: string; record: string }[]
  /** What the shared phases did with them. */
  phases: {
    summarized: number
    linked: number
    inferred: number
    updatesPosted: number
    updatesStaged: number
    meetingsFiled: number
    commitments: number
    tasksCreated: number
  }
  notes: string[]
  error: string | null
}

export async function runDriveAudioSweep(
  opts: { dryRun?: boolean; limit?: number; folderId?: string; mailbox?: string } = {}
): Promise<DriveAudioSweepResult> {
  const dryRun = opts.dryRun ?? false
  const base: DriveAudioSweepResult = {
    ok: false,
    dryRun,
    folderId: opts.folderId ?? driveAudioFolderId(),
    found: 0,
    alreadyIngested: 0,
    skipped: [],
    tooOld: 0,
    transcribed: 0,
    transcribeMs: 0,
    bytesFetched: 0,
    deferred: [],
    discarded: [],
    recorded: [],
    filedByFolder: [],
    phases: {
      summarized: 0,
      linked: 0,
      inferred: 0,
      updatesPosted: 0,
      updatesStaged: 0,
      meetingsFiled: 0,
      commitments: 0,
      tasksCreated: 0,
    },
    notes: [],
    error: null,
  }

  // ⚠ NEVER assert one specific Google env var (§12) — `getAccessToken()` picks
  // a mode by which of them are set, and a health check that named one shipped
  // a misfire once already.
  if (!isGoogleConfigured()) {
    return { ...base, error: 'Google Workspace credentials are not configured on this host.' }
  }

  // ── 1. Read the folder ────────────────────────────────────────────────────
  const read = await readDriveAudio({ folderId: opts.folderId, mailbox: opts.mailbox })
  base.skipped = read.skipped
  base.tooOld = read.tooOld
  if (read.error) return { ...base, error: read.error }

  base.found = read.files.length
  if (read.files.length === 0) {
    base.notes.push(
      'No recordings in the intake folder. Export one to it and it is read at the next run' +
        (read.skipped.length
          ? ` — note ${read.skipped.length} file(s) in there are not audio and were ignored.`
          : '.')
    )
    return { ...base, ok: true }
  }

  // ── 2. Narrow to what has not been read ───────────────────────────────────
  //
  // ⚠ BEFORE THE DOWNLOAD AND BEFORE WHISPER, which is the whole point. The
  // 10-14 finding on the Notes path was the same 16-minute call re-transcribed
  // on all four daily runs for an identical answer. Audio never changes, so a
  // file the platform has already read has nothing left to teach it — and
  // unlike the local sources, this one's file STAYS in the folder after it is
  // read, so without this every run would re-read the whole folder forever.
  const known = await ingestedFileIds(read.files.map((f) => f.fileId))
  const candidates = read.files.filter((f) => {
    if (known.has(f.fileId)) {
      base.alreadyIngested += 1
      return false
    }
    return true
  })

  if (candidates.length === 0) {
    base.notes.push(
      `Nothing new — all ${base.alreadyIngested} recording(s) in the folder have been read. ` +
        `They are left where they are: the transcript is the record now, so the file can be ` +
        `trashed or dragged into an "Archive" subfolder (which this sweep skips) whenever you like.`
    )
    return { ...base, ok: true }
  }

  const take = candidates.slice(0, opts.limit ?? MAX_PER_RUN)
  if (candidates.length > take.length) {
    base.notes.push(
      `${candidates.length - take.length} more recording(s) wait for the next run (newest first).`
    )
  }

  if (dryRun) {
    base.notes.push(
      ...take.map(
        (f) =>
          `${localStamp(f.recordedAt)}  ${driveAudioSubject(f)}` +
          (f.sizeBytes != null ? ` (${humanSize(f.sizeBytes)})` : '') +
          (f.recordedAtSource === 'drive-modified' ? '  [dated by upload time]' : '')
      )
    )
    return { ...base, ok: true }
  }

  // ── 3. Download and transcribe, sequentially ──────────────────────────────
  //
  // Sequential because whisper holds a CPU and LM Studio serves one request at
  // a time; two of these in parallel measures the queue, not the box (§12).
  const transcripts = new Map<string, string>()
  const threads: ResolvedThread[] = []
  for (const file of take) {
    const result = await transcribeDriveAudio(file, { mailbox: opts.mailbox })
    base.bytesFetched += result.bytes ?? 0
    if (!result.text) {
      base.deferred.push({ title: driveAudioSubject(file).slice(0, 60), why: result.skipped ?? 'unknown' })
      continue
    }
    base.transcribed += 1
    base.transcribeMs += result.latencyMs ?? 0
    transcripts.set(file.fileId, result.text)
    threads.push(driveAudioToThread(file, result.text))
  }

  // ⚠ A RECORDING WITH NO TRANSCRIPT IS NOT STORED. Its body would be a title
  // alone, which summarizes to nothing, indexes as noise, and then reads on the
  // record as though the call had been ingested — the worst of the three
  // outcomes. A deferred file is reported and retried on the next run.
  if (threads.length === 0) {
    base.notes.push('Nothing could be transcribed this run — see `deferred` for each reason.')
    return { ...base, ok: true }
  }

  const undated = take.filter(
    (f) => transcripts.has(f.fileId) && f.recordedAtSource === 'drive-modified'
  )
  if (undated.length > 0) {
    base.notes.push(
      `${undated.length} recording(s) carry no date in the file name, so they are filed under ` +
        `when they were uploaded. A name containing 2026-10-18 (or 20261018) is read as the date ` +
        `the conversation happened, which matters when an export sits on the device for days.`
    )
  }

  // ── 4. Store as threads, and find the rows ────────────────────────────────
  const stored = await storeFetchedThreads(threads, 'deal')
  base.notes.push(`${stored.inserted} thread(s) stored, ${stored.refreshed} refreshed`)

  const db = sweepDb()
  const { data: rows, error: rowErr } = await db
    .from('email_threads')
    .select('id, gmail_thread_id')
    .in('gmail_thread_id', take.map((f) => driveAudioThreadId(f.fileId)))
  if (rowErr) return { ...base, error: `Could not re-read the stored threads: ${rowErr.message}` }

  const threadIdByFile = new Map<string, string>()
  for (const r of (rows ?? []) as { id: string; gmail_thread_id: string | null }[]) {
    const file = take.find((f) => driveAudioThreadId(f.fileId) === r.gmail_thread_id)
    if (file) threadIdByFile.set(file.fileId, r.id)
  }
  const threadIds = [...threadIdByFile.values()]
  if (threadIds.length === 0) {
    return { ...base, error: 'The threads were stored but could not be read back by id.' }
  }

  // ── 5. Summarize these threads, by name ───────────────────────────────────
  //
  // Named threads only. Without `threadIds` this summarizes whatever is newest
  // in the queue — usually the same rows, but an hourly mail sweep running
  // concurrently can take one first, and then the verdict read below belongs to
  // somebody else's thread.
  const summarized = await summarizePending({ threadIds, maxThreads: threadIds.length })
  base.phases.summarized = summarized.summarized

  const { data: judged } = await db
    .from('email_threads')
    .select('id, summary')
    .in('id', threadIds)

  const verdicts = new Map<string, string | null>()
  for (const r of (judged ?? []) as { id: string; summary: unknown }[]) {
    const summary = r.summary as { relevance?: unknown } | null
    verdicts.set(r.id, typeof summary?.relevance === 'string' ? summary.relevance : null)
  }

  const workIds: string[] = []
  const noiseIds: string[] = []
  for (const id of threadIds) {
    if (verdicts.get(id) === 'noise') noiseIds.push(id)
    else workIds.push(id)
  }

  // ── 6. A private recording: forget the words, keep the file ───────────────
  //
  // The summarize phase already redacted each one as it classified it (that is
  // where the window between classification and forgetting is shortest). This
  // is the backstop that also reaches anything whose redaction failed, and it
  // is what reports the count.
  //
  // ⚠ NAMED, UNLIKE THE VOICE MEMO SWEEP, WHICH REPORTS A BARE COUNT. There the
  // name is iOS's and the recording may be anybody's private life, so naming it
  // in a log would be a description of a private conversation. Here the name is
  // one Richard typed on a file he deliberately filed, and the remedy needs it:
  // the only thing that undoes a wrong verdict is knowing which file to re-drop.
  if (noiseIds.length > 0) {
    try {
      await redactPrivateLocalThreads(noiseIds)
    } catch (err) {
      base.notes.push(
        `⚠ A discarded recording's TEXT could not be removed: ${err instanceof Error ? err.message : String(err)}`
      )
    }
    base.discarded = take
      .filter((f) => {
        const id = threadIdByFile.get(f.fileId)
        return id ? noiseIds.includes(id) : false
      })
      .map((f) => ({ title: driveAudioSubject(f).slice(0, 60) }))
    base.notes.push(
      `${noiseIds.length} recording(s) read as not work-related, so the transcript and its ` +
        `passages were discarded. The FILE is untouched in Drive. If that is wrong, upload a ` +
        `copy — a copy is a new Drive id, so it is read again, where re-dropping the same file ` +
        `is not (the row it left behind is what stops it being transcribed twice).`
    )
  }

  if (workIds.length === 0) {
    base.notes.push('Every recording this run read as not work-related.')
    return { ...base, ok: true }
  }

  // ── 7. The subfolder's name is a filing decision, so it files ─────────────
  //
  // ⚠ WITHOUT THIS THE HINT BUYS NOTHING, WHICH IS MEASURED AND NOT A GUESS. On
  // the first live run a recording in a subfolder called "Tooele" — the exact
  // name of a real project — came back `linked: 0`. `bestMatch` was working
  // exactly as designed: a ONE-WORD record name is ambiguous evidence by nature
  // ("GridEdge" is a brand, "Tooele" is a county) so it needs a shared CONTACT
  // to corroborate it, and a recording structurally has no external
  // participants at all. That is the §12 rule arriving for the third time — a
  // two-signal bar makes a record invisible where one signal cannot exist for
  // the source — and its remedy is not to weaken the bar.
  //
  // The bar does not need weakening, because a folder name is not a DESCRIPTION
  // the platform extracted from prose; it is an assertion a human made by
  // dragging a file. That has the standing of an alias or a learned identifier,
  // so it goes through `resolveMeetingTarget`, whose first two bars are a title
  // a human has already filed and an EXACT record name unique across both
  // tables. A `suggestion` is deliberately not acted on — that bar exists to
  // pre-tick a checkbox for a person, never to file (§12: an automatic bar and
  // a pre-tick bar are two bars).
  //
  // Writing the link here rather than teaching `bestMatch` about folders keeps
  // the knowledge where it belongs: `routeThreads` already respects an existing
  // `linked` link and skips guessing entirely for that thread.
  for (const file of take) {
    if (!file.folderHint) continue
    const threadId = threadIdByFile.get(file.fileId)
    if (!threadId || !workIds.includes(threadId)) continue

    const resolved = await resolveMeetingTarget([file.folderHint]).catch((err) => {
      console.error('[driveaudio] folder resolve failed:', err)
      return null
    })
    if (!resolved?.target) {
      base.notes.push(
        `"${file.folderHint}" is not the exact name of a record` +
          (resolved?.ambiguous ? ` (${resolved.ambiguous})` : '') +
          (resolved?.suggestion ? `; closest is "${resolved.suggestion.name}"` : '') +
          ' — the recording is staged at /decide instead. Renaming the subfolder to the ' +
          "record's exact name files the next one by itself."
      )
      continue
    }
    await upsertLink(
      threadId,
      resolved.target.kind,
      resolved.target.id,
      'linked',
      1,
      `filed in Drive under "${file.folderHint}" — ${resolved.target.name}`
    )
    base.filedByFolder.push({
      title: driveAudioSubject(file).slice(0, 60),
      record: resolved.target.name,
    })
  }

  // ── 8. The shared phases, on the work ones ────────────────────────────────
  try {
    const routed = await routeThreads({ threadIds: workIds })
    base.phases.linked = routed.linked
    base.phases.inferred = routed.inferred

    // ⚠ NAMED LINKS, SO THE REPORT IS ABOUT THESE RECORDINGS.
    // `applyThreadUpdates` drains the whole queue when given nothing, and the
    // counts it returns would then include every unapplied mail thread on the
    // box — a sweep claiming it posted eleven updates for one call (§12: never
    // let a report count work it did not do). The links exist only now, because
    // `routeThreads` just wrote them.
    const { data: links } = await db.from('thread_links').select('id').in('thread_id', workIds)
    const linkIds = (links ?? []).map((l) => (l as { id: string }).id)
    if (linkIds.length > 0) {
      const applied = await applyThreadUpdates({ linkIds, budgetMs: 5 * 60 * 1000 })
      base.phases.updatesPosted = applied.updatesPosted
      base.phases.updatesStaged = applied.updatesStaged
      base.phases.meetingsFiled = applied.recordingMeetingsFiled
    } else {
      base.notes.push(
        'No recording named a record with enough certainty to file — each one is searchable ' +
          'and staged at /decide, where one tap attaches it. Naming the file after the deal, or ' +
          'dropping it in a subfolder named after the deal, files it without the tap.'
      )
    }
  } catch (err) {
    base.notes.push(
      `⚠ Routing or applying failed: ${err instanceof Error ? err.message : String(err)} — the ` +
        `transcripts are stored and the hourly mail sweep will pick them up.`
    )
  }

  // Embed, commitments and internal tasks work the QUEUE rather than named
  // rows — they take no id filter and did not need one: whatever else is
  // pending is work the hourly sweep would do anyway, on the same budget.
  try {
    await embedPendingThreads({ budgetMs: 4 * 60 * 1000 })
    await extractCommitments({ budgetMs: 4 * 60 * 1000 })
    const internal = await promoteInternalCommitments()

    // ⚠ COUNTED FROM THE ROWS, NOT FROM THE PHASES' OWN TOTALS, for the reason
    // above: those three drain the queue, so their return values include other
    // threads' work. The report asks the database what THESE threads produced.
    const { data: mine } = await db.from('commitments').select('id').in('thread_id', workIds)
    const commitmentIds = (mine ?? []).map((c) => (c as { id: string }).id)
    base.phases.commitments = commitmentIds.length
    if (commitmentIds.length > 0) {
      const { count: tasks } = await db
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .in('commitment_id', commitmentIds)
      base.phases.tasksCreated = tasks ?? 0
    }

    if (internal.created > 0) {
      // The board publishes to a shared Google Sheet; a follow-up from a call
      // that just ended has to reach the phone this hour.
      const { queueTaskSheetRefresh } = await import('@/lib/tasks/sheet-refresh')
      queueTaskSheetRefresh()
    }
  } catch (err) {
    base.notes.push(
      `⚠ Indexing or commitments failed: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  // ── 9. And each one becomes a MEETING ─────────────────────────────────────
  //
  // Last, and separate from the thread rather than instead of it: the thread
  // carries the words into retrieval and the obligation ledger, the meeting
  // carries the EVENT — into `search_meetings`, onto each attendee's profile,
  // and into the queue where a human attaches it to a deal and the follow-up
  // tasks get created. Non-fatal per file: a failure costs the register entry,
  // never the transcript.
  for (const file of take) {
    const threadId = threadIdByFile.get(file.fileId)
    const transcript = transcripts.get(file.fileId)
    if (!threadId || !transcript) continue
    if (!workIds.includes(threadId)) continue // discarded: no record, by design

    const recorded = await recordLocalRecording({
      // The OUTSIDE world's title, which is the filing key and not the display
      // name: the model's rewrite goes on the meeting, this goes on the session
      // as `source_title` and is what meeting-title learning stores, so the
      // next recording in a series files itself.
      title: driveAudioSubject(file),
      meetingDate: localDateString(file.recordedAt),
      transcript,
      sourceRef: driveAudioThreadId(file.fileId),
      // ⚠ NO SEEDED ATTENDEES, AND THAT IS THE HONEST ANSWER. An iPhone call
      // recording hands this iOS's `Call with <name>`, which is structural
      // evidence about both ends. A hardware recorder names nobody: who was
      // there is whatever the transcript says, which the recap stages for a
      // human rather than asserting. (Saying the names aloud in the first ten
      // seconds is the cheapest fix there is, and it is a habit, not code.)
    }).catch((err) => {
      console.error('[driveaudio] meeting record failed:', err)
      return null
    })

    if (!recorded || recorded.skipped) {
      base.notes.push(
        `${driveAudioSubject(file)}: transcribed and filed, but not registered as a meeting — ` +
          `${recorded?.skipped ?? 'unknown'}`
      )
      continue
    }
    // ⚠ ASKED FROM THIS SIDE BECAUSE THE OTHER SIDE CANNOT SEE IT. The meeting
    // is written last (the recap is a model pass), so when `applyThreadUpdates`
    // visited this thread's link there was no row to move — and a link with
    // nothing owing is never visited again. See the docblock on
    // `fileMeetingFromThreadLinks`: both voice memos on the box were sitting
    // unfiled for exactly this reason. A no-op when the thread is not filed.
    const movedOnto = await fileMeetingFromThreadLinks(threadId).catch(() => null)
    if (movedOnto?.moved) base.phases.meetingsFiled += 1

    base.recorded.push({
      title: driveAudioSubject(file).slice(0, 60),
      meetingId: recorded.meetingId,
      // Say what is still owed. A silent success reads as "fully filed", when
      // what is waiting is the confirm that creates the tasks and links people.
      note: movedOnto?.moved
        ? 'filed on the deal; confirm at /decide to create the follow-up tasks and link the people'
        : 'recap staged — confirm at /decide to attach it to a deal, create the tasks and link the people',
    })
  }

  return { ...base, ok: true }
}

/**
 * The recording's own clock, for a line a human reads beside the file name.
 *
 * ⚠ LOCAL, NOT THE ISO STRING'S FIRST SIXTEEN CHARACTERS. Slicing the stored
 * ISO is what the sibling sweeps do and it is harmless there, because the
 * reader has nothing to compare it against. Here the date came OUT of the file
 * name, so printing it in UTC makes the report disagree with the thing it is
 * reporting on: `2026-10-18 141500.mp3` listed as "2026-10-18 20:15" reads as
 * the parse having gone wrong, when it went exactly right.
 */
function localStamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** A size with a unit it fits in — `0MB` on a 435KB file reads as an empty one. */
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

/** Which of these files already have a thread. One query, by fingerprint. */
async function ingestedFileIds(fileIds: string[]): Promise<Set<string>> {
  if (fileIds.length === 0) return new Set()
  const db = sweepDb()
  // ⚠ Chunked: a filter rides in the query string, and `.in()` with a thousand
  // values is a URL Kong refuses outright (§12). A folder big enough to hit
  // this is unlikely, but a failed read here would mean re-transcribing
  // everything rather than reading as "nothing new".
  const seen = new Set<string>()
  for (let i = 0; i < fileIds.length; i += 200) {
    const batch = fileIds.slice(i, i + 200)
    const { data, error } = await db
      .from('email_threads')
      .select('fingerprint')
      .in('fingerprint', batch.map(driveAudioThreadId))
    if (error) throw new Error(`Could not check stored recordings: ${error.message}`)
    for (const r of (data ?? []) as { fingerprint: string | null }[]) {
      if (!r.fingerprint) continue
      const id = batch.find((f) => driveAudioThreadId(f) === r.fingerprint)
      if (id) seen.add(id)
    }
  }
  return seen
}

/** The row shape the health check wants, without running a sweep. */
export type { DriveAudioRow }
