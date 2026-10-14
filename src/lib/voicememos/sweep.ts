/**
 * The Voice Memos sweep: snapshot → transcribe → judge → file.
 *
 * ⚠ THE SHAPE IS DELIBERATELY DIFFERENT FROM THE NOTES SWEEP, IN ONE PLACE.
 * Notes are narrowed by a human filing decision BEFORE anything is read, because
 * a note has no participants and automatic classification measured useless (30%
 * of 334 notes matched a record name, essentially all falsely). A recording is
 * different in the one way that matters: it is SPEECH, so the same summarizer
 * that judges a text conversation business-or-not on its content can judge it.
 *
 * So every memo is read, and the summarizer is the GATE:
 *
 *   noise  → the transcript is nulled, the chunks are deleted, the copied audio
 *            is deleted and the memo is skip-listed so it is never copied or
 *            re-read again. The row survives as the tombstone (§12).
 *   work   → route → apply (the write-up lands on the deal it names) → embed →
 *            commitments → internal tasks, AND a `meetings` row with the recap
 *            staged for a one-tap confirm.
 *
 * That is Richard's call of 10-14: zero taps on the phone, in exchange for a
 * personal recording being transcribed on-box before it is thrown away. The
 * precedent is the text sweep, which already forgets a private conversation the
 * moment it is classified.
 *
 * ⚠ IT ADDS A CALLER, NOT A PIPELINE. §12 forbids forking a shared pass. Every
 * phase here is the one the mail sweep runs; the only new code is the reader,
 * the transcriber and this ordering.
 *
 * ⚠ AND IT RUNS THE PHASES ITSELF RATHER THAN WAITING FOR THE HOURLY CRON.
 * A meeting that ended twenty minutes ago is the single most valuable thing the
 * platform can hold, and "it will be there within the hour" is the difference
 * between an assistant and a filing cabinet.
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
import type { ResolvedThread } from '@/lib/integrations/gmail-search'

import { discardMemoAudioFiles, readSkipList } from './discard'
import { readVoiceMemos, type MemoRow } from './read'
import { transcribeMemo } from './transcribe'
import { memoThreadId, memoToThread } from './to-thread'

/**
 * How stale a snapshot may be before it is reported as a fault.
 *
 * ⚠ A CLOCK, NOT A COUNT (§12). A count of memos that has stopped growing is
 * indistinguishable from a quiet week, and the two human requirements behind
 * this source both fail silently: Voice Memos.app being closed stops iCloud
 * syncing, and a lost Full Disk Access grant stops the copy — with every local
 * check reporting healthy throughout. The snapshot agent runs four times a day,
 * so anything past ~8h is a miss.
 */
const SNAPSHOT_STALE_MINUTES = 8 * 60

/** Per-run ceiling. A first run against a full memo library must not transcribe
 *  for an hour inside a cron; the rest arrive on the next run, newest first. */
const MAX_PER_RUN = 8

export interface VoiceMemoSweepResult {
  ok: boolean
  dryRun: boolean
  /** Age of the snapshot in minutes, and whether that is a fault. */
  snapshotAgeMinutes: number | null
  stale: boolean
  /** Memos in the store (after Recently Deleted and unreadable rows). */
  found: number
  /** Already ingested on an earlier run — the normal steady state. */
  alreadyIngested: number
  /** Skip-listed as private by an earlier run. Never read again. */
  skipListed: number
  /** Rows the reader could not use, with the reason beside each (§12). */
  unreadable: { fileName: string; reason: string }[]
  transcribed: number
  /** Whisper seconds spent, so a slow box is visible in the report. */
  transcribeMs: number
  /** Could not be transcribed this run, with why. Retried next run. */
  deferred: { title: string; why: string }[]
  /** Judged private: transcript and chunks discarded. */
  discarded: number
  /** Audio files actually removed from the snapshot directory. */
  audioDeleted: number
  /** Names added to the copier's skip list, so the audio does not come back. */
  audioSkipListed: number
  /** Became records: the meeting row, and the deal if routing was certain. */
  recorded: { title: string; meetingId: string | null; note?: string }[]
  /** What the shared phases did with them. */
  phases: {
    summarized: number
    linked: number
    inferred: number
    updatesPosted: number
    updatesStaged: number
    meetingsFiled: number
    /** Obligations extracted from THESE recordings, counted from the rows. */
    commitments: number
    /** Of those, the ones that became a task with no human confirm (§11). */
    tasksCreated: number
  }
  notes: string[]
  error: string | null
}

export async function runVoiceMemoSweep(
  opts: { dryRun?: boolean; snapshot?: string; limit?: number } = {}
): Promise<VoiceMemoSweepResult> {
  const dryRun = opts.dryRun ?? false
  const base: VoiceMemoSweepResult = {
    ok: false,
    dryRun,
    snapshotAgeMinutes: null,
    stale: false,
    found: 0,
    alreadyIngested: 0,
    skipListed: 0,
    unreadable: [],
    transcribed: 0,
    transcribeMs: 0,
    deferred: [],
    discarded: 0,
    audioDeleted: 0,
    audioSkipListed: 0,
    recorded: [],
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

  // ── 1. Read the snapshot ──────────────────────────────────────────────────
  const read = readVoiceMemos({ snapshot: opts.snapshot })
  base.snapshotAgeMinutes = read.snapshotAgeMinutes
  base.unreadable = read.skipped
  if (read.error) return { ...base, error: read.error }

  base.found = read.memos.length
  if (read.snapshotAgeMinutes != null && read.snapshotAgeMinutes > SNAPSHOT_STALE_MINUTES) {
    base.stale = true
    base.notes.push(
      `The snapshot is ${Math.round(read.snapshotAgeMinutes / 60)}h old. Either ` +
        `com.berwilson.snapshot is not running, or bw-snapshot has lost Full Disk Access, ` +
        `or Voice Memos.app is closed on the Studio (iCloud syncs it only while it runs). ` +
        `Nothing below is evidence of a quiet week.`
    )
  }

  if (read.memos.length === 0) {
    base.notes.push(
      'No recordings in the store. Record one on the iPhone and leave Voice Memos.app ' +
        'running on the Studio; it arrives at the next snapshot.'
    )
    return { ...base, ok: true }
  }

  // ── 2. Narrow to what has not been handled ────────────────────────────────
  //
  // ⚠ BOTH FILTERS RUN BEFORE WHISPER, WHICH IS THE WHOLE POINT. The 10-14
  // finding was the same 16-minute call re-transcribed on all four daily runs
  // for an identical answer — a recording's audio never changes, so a memo the
  // platform has already read has nothing left to teach it.
  // The skip list is keyed on the audio FILE NAME, because it is the one key
  // the Swift copier can read without a database (see ./discard.ts). A memo on
  // it has no audio left, so without this test it would report "audio not in
  // the snapshot" as a fresh deferral on every run, forever.
  const skip = readSkipList()
  const candidates: MemoRow[] = []
  const known = await ingestedIdentifiers(read.memos.map((m) => m.identifier))
  for (const memo of read.memos) {
    if (skip.has(memo.fileName)) {
      base.skipListed += 1
      continue
    }
    if (known.has(memo.identifier)) {
      base.alreadyIngested += 1
      continue
    }
    candidates.push(memo)
  }

  if (candidates.length === 0) {
    base.notes.push(
      `Nothing new — ${base.alreadyIngested} recording(s) already ingested` +
        (base.skipListed ? `, ${base.skipListed} previously judged private` : '')
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
        (m) =>
          `${m.createdAt.slice(0, 16).replace('T', ' ')}  ${m.title}` +
          (m.durationSeconds != null ? ` (${Math.round(m.durationSeconds / 60)} min)` : '') +
          (m.audioPath ? '' : '  ⚠ audio not in the snapshot')
      )
    )
    return { ...base, ok: true }
  }

  // ── 3. Transcribe, sequentially ───────────────────────────────────────────
  //
  // Sequential because whisper holds a CPU and LM Studio serves one request at
  // a time; two of these in parallel measures the queue, not the box.
  const transcripts = new Map<string, string>()
  const threads: ResolvedThread[] = []
  for (const memo of take) {
    const result = await transcribeMemo(memo)
    if (!result.text) {
      base.deferred.push({ title: memo.title.slice(0, 48), why: result.skipped ?? 'unknown' })
      continue
    }
    base.transcribed += 1
    base.transcribeMs += result.latencyMs ?? 0
    transcripts.set(memo.identifier, result.text)
    threads.push(memoToThread(memo, result.text))
  }

  // ⚠ A RECORDING WITH NO TRANSCRIPT IS NOT STORED. Its body would be a title
  // alone, which summarizes to nothing, indexes as noise, and then reads on the
  // record as though the meeting had been ingested — the worst of the three
  // outcomes. A deferred memo is reported and retried on the next run.
  if (threads.length === 0) {
    base.notes.push('Nothing could be transcribed this run — see `deferred` for each reason.')
    return { ...base, ok: true }
  }

  // ── 4. Store as threads, and find the rows ────────────────────────────────
  const stored = await storeFetchedThreads(threads, 'deal')
  base.notes.push(`${stored.inserted} thread(s) stored, ${stored.refreshed} refreshed`)

  const db = sweepDb()
  const { data: rows, error: rowErr } = await db
    .from('email_threads')
    .select('id, gmail_thread_id')
    .in(
      'gmail_thread_id',
      take.map((m) => memoThreadId(m.identifier))
    )
  if (rowErr) return { ...base, error: `Could not re-read the stored threads: ${rowErr.message}` }

  const threadIdByMemo = new Map<string, string>()
  for (const r of (rows ?? []) as { id: string; gmail_thread_id: string | null }[]) {
    const memo = take.find((m) => memoThreadId(m.identifier) === r.gmail_thread_id)
    if (memo) threadIdByMemo.set(memo.identifier, r.id)
  }
  const threadIds = [...threadIdByMemo.values()]
  if (threadIds.length === 0) {
    return { ...base, error: 'The threads were stored but could not be read back by id.' }
  }

  // ── 5. The gate ───────────────────────────────────────────────────────────
  //
  // Named threads only. Without `threadIds` this would summarize whatever is
  // newest in the queue — usually the same rows, but an hourly mail sweep
  // running concurrently can take a memo first, and then the verdict read below
  // belongs to somebody else's thread.
  const summarized = await summarizePending({ threadIds, maxThreads: threadIds.length })
  base.phases.summarized = summarized.summarized

  const { data: judged } = await db
    .from('email_threads')
    .select('id, gmail_thread_id, summary')
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

  // ── 6. Private recordings: forget them, including the audio ───────────────
  //
  // The summarize phase already redacts each one as it classifies it (that is
  // where the window between classification and forgetting is shortest). This
  // is the backstop that also reaches anything whose redaction failed, and it
  // is what reports the count.
  if (noiseIds.length > 0) {
    base.discarded = noiseIds.length
    try {
      await redactPrivateLocalThreads(noiseIds)
    } catch (err) {
      base.notes.push(
        `⚠ A private recording's TEXT could not be discarded: ${err instanceof Error ? err.message : String(err)}`
      )
    }

    // ⚠ THE AUDIO IS DISCARDED BY FILE NAME, FROM THE ROWS THIS RUN READ — not
    // by asking the redaction pass to resolve it again. Measured on the first
    // synthetic end-to-end run (10-14): the report said "transcript, chunks and
    // audio discarded" while the m4a was still on disk and the skip list had
    // never been written, because the resolver re-read the store at its DEFAULT
    // path. The sweep is holding the file name already. §12 — a pass that
    // reports what it did must read before it writes.
    const noiseFiles = take
      .filter((m) => {
        const id = threadIdByMemo.get(m.identifier)
        return id ? noiseIds.includes(id) : false
      })
      .map((m) => m.fileName)
    const audio = discardMemoAudioFiles(noiseFiles)
    base.audioDeleted = audio.deleted
    base.audioSkipListed = audio.skipListed
    base.notes.push(
      `${noiseIds.length} recording(s) judged private — transcript and chunks discarded; ` +
        `${audio.deleted} audio file(s) deleted, ${audio.skipListed} added to the copier's skip list` +
        (noiseFiles.length < noiseIds.length
          ? `. ⚠ ${noiseIds.length - noiseFiles.length} could not be matched to a file and may be re-copied`
          : '')
    )
  }

  if (workIds.length === 0) {
    base.notes.push('Every recording this run was judged private.')
    return { ...base, ok: true }
  }

  // ── 7. The shared phases, on the work ones ────────────────────────────────
  try {
    const routed = await routeThreads({ threadIds: workIds })
    base.phases.linked = routed.linked
    base.phases.inferred = routed.inferred

    // ⚠ NAMED LINKS, SO THE REPORT IS ABOUT THESE RECORDINGS. `applyThreadUpdates`
    // drains the whole queue when given nothing, and the counts it returns would
    // then include every unapplied mail thread on the box — a sweep claiming it
    // posted eleven updates for one memo. §12: never make a report count work it
    // did not do. The links exist only now, because `routeThreads` just wrote
    // them.
    const { data: links } = await db
      .from('thread_links')
      .select('id')
      .in('thread_id', workIds)
    const linkIds = (links ?? []).map((l) => (l as { id: string }).id)
    if (linkIds.length > 0) {
      const applied = await applyThreadUpdates({ linkIds, budgetMs: 5 * 60 * 1000 })
      base.phases.updatesPosted = applied.updatesPosted
      base.phases.updatesStaged = applied.updatesStaged
      base.phases.meetingsFiled = applied.recordingMeetingsFiled
    } else {
      base.notes.push(
        'No recording named a record with enough certainty to file — each one is ' +
          'searchable and staged at /decide, where one tap attaches it.'
      )
    }
  } catch (err) {
    base.notes.push(
      `⚠ Routing or applying failed: ${err instanceof Error ? err.message : String(err)} — the ` +
        `transcripts are stored and the hourly mail sweep will pick them up.`
    )
  }

  // Embed, commitments and internal tasks work the QUEUE rather than named
  // rows — they have no id filter, and did not need one: whatever else is
  // pending is work the hourly sweep would do anyway, on the same budget.
  try {
    await embedPendingThreads({ budgetMs: 4 * 60 * 1000 })
    await extractCommitments({ budgetMs: 4 * 60 * 1000 })
    const internal = await promoteInternalCommitments()

    // ⚠ COUNTED FROM THE ROWS, NOT FROM THE PHASES' OWN TOTALS. These three
    // phases work the QUEUE — they take no id filter and did not need one,
    // because whatever else is pending is work the hourly sweep would do
    // anyway. But their return values then include that other work, and a
    // sweep reporting "2 commitments, 2 tasks" for one recording when both
    // belonged to a mail thread is the same lie `applyThreadUpdates` told
    // above. So the report asks the database what THESE threads produced.
    const { data: mine } = await db
      .from('commitments')
      .select('id')
      .in('thread_id', workIds)
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
      // The board publishes to a shared Google Sheet; a follow-up from a
      // meeting that just ended has to reach the phone this hour.
      const { queueTaskSheetRefresh } = await import('@/lib/tasks/sheet-refresh')
      queueTaskSheetRefresh()
    }
  } catch (err) {
    base.notes.push(
      `⚠ Indexing or commitments failed: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  // ── 8. And each one becomes a MEETING ─────────────────────────────────────
  //
  // Last, and separate from the thread above rather than instead of it: the
  // thread carries the words into retrieval and the obligation ledger, the
  // meeting carries the EVENT — into `search_meetings`, onto each attendee's
  // profile, and into the queue where a human attaches it to a deal and the
  // follow-up tasks are created. Non-fatal per memo: a failure here costs the
  // register entry, never the transcript.
  for (const memo of take) {
    const threadId = threadIdByMemo.get(memo.identifier)
    const transcript = transcripts.get(memo.identifier)
    if (!threadId || !transcript) continue
    if (!workIds.includes(threadId)) continue // private: no record, by design

    const recorded = await recordLocalRecording({
      title: memo.title,
      meetingDate: localDateString(memo.createdAt),
      transcript,
      sourceRef: memoThreadId(memo.identifier),
      // ⚠ NO SEEDED ATTENDEES, AND THAT IS THE HONEST ANSWER. A phone call
      // hands this `Call with <name>` from iOS, which is structural evidence
      // about both ends. An in-person recording names nobody: who was in the
      // room is whatever the transcript says, which the recap stages for a
      // human rather than asserting. (Saying the names aloud in the first ten
      // seconds is the cheapest fix there is, and it is a habit, not code.)
    }).catch((err) => {
      console.error('[voicememos] meeting record failed:', err)
      return null
    })

    if (!recorded || recorded.skipped) {
      base.notes.push(
        `${memo.title}: transcribed and filed, but not registered as a meeting — ${recorded?.skipped ?? 'unknown'}`
      )
      continue
    }
    base.recorded.push({
      title: memo.title.slice(0, 48),
      meetingId: recorded.meetingId,
      // Say what is still owed. A silent success here reads as "fully filed",
      // when what is actually waiting is the confirm that creates the tasks.
      note: 'recap staged — confirm at /decide to create the follow-up tasks and link the people',
    })
  }

  return { ...base, ok: true }
}

/** Which of these memos already have a thread. One query, by fingerprint. */
async function ingestedIdentifiers(identifiers: string[]): Promise<Set<string>> {
  if (identifiers.length === 0) return new Set()
  const db = sweepDb()
  const { data, error } = await db
    .from('email_threads')
    .select('fingerprint')
    .in('fingerprint', identifiers.map(memoThreadId))
  if (error) throw new Error(`Could not check stored recordings: ${error.message}`)
  const seen = new Set<string>()
  for (const r of (data ?? []) as { fingerprint: string | null }[]) {
    if (!r.fingerprint) continue
    const id = identifiers.find((i) => memoThreadId(i) === r.fingerprint)
    if (id) seen.add(id)
  }
  return seen
}
