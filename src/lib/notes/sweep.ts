/**
 * The Notes sweep: snapshot → nominated folders → refuse secrets → threads.
 *
 * Four phases, each of which can only narrow the set:
 *   1. the snapshot (bw-snapshot's copy, db + WAL + shm)
 *   2. the nominated folders — a human filing decision, the real control
 *   3. the credential refusal — defence in depth, fails closed, skips WHOLE
 *   4. `storeFetchedThreads`, the same writer mail and texts use
 *
 * ⚠ IT ADDS A CALLER, NOT A PIPELINE. §12 forbids forking a shared pass, and
 * every phase after this one — summarize, route, append, embed, commitments,
 * predecide — reads `email_threads` and needs no change. A note filed in the
 * nominated folder is therefore summarized, attached to the deal it names,
 * indexed for Ber AI and read for obligations on the same schedule as mail.
 */

import { storeFetchedThreads } from '@/lib/email-sweep/fetch-phase'
import type { ResolvedThread } from '@/lib/integrations/gmail-search'

import { isCallRecording, transcribeCallNote } from './calls'
import { nominatedFolders, readNotes, type NoteRow } from './read'
import { judgeSecrets } from './secrets'
import { noteToThread } from './to-thread'

export interface NotesSweepResult {
  ok: boolean
  dryRun: boolean
  /** Folders Notes actually has, so a misconfiguration can name the options. */
  foldersSeen: string[]
  nominated: string[]
  /** Notes in the nominated folders. */
  found: number
  /** Skipped because they look like they hold credentials. Reason, not text. */
  refused: { title: string; reason: string }[]
  /** Bodies that would not decode — reported, never stored half-read. */
  undecodable: number
  /** Notes carrying attachments the platform can see but not read. */
  withUnreadableAttachments: number
  /** Recorded calls found, transcribed, and deferred — counted apart. */
  calls: { found: number; transcribed: number; deferred: { title: string; why: string }[] }
  inserted: number
  refreshed: number
  notes: string[]
  error: string | null
}

export async function runNotesSweep(
  opts: { dryRun?: boolean; snapshot?: string; includeCalls?: boolean } = {}
): Promise<NotesSweepResult> {
  const dryRun = opts.dryRun ?? false
  const base: NotesSweepResult = {
    ok: false,
    dryRun,
    foldersSeen: [],
    nominated: nominatedFolders(),
    found: 0,
    refused: [],
    undecodable: 0,
    withUnreadableAttachments: 0,
    calls: { found: 0, transcribed: 0, deferred: [] },
    inserted: 0,
    refreshed: 0,
    notes: [],
    error: null,
  }

  const read = readNotes({ snapshot: opts.snapshot, includeCalls: opts.includeCalls })
  base.foldersSeen = read.foldersSeen
  base.undecodable = read.undecodable
  if (read.error) return { ...base, error: read.error }

  base.found = read.notes.length

  const keep: NoteRow[] = []
  for (const note of read.notes) {
    const verdict = judgeSecrets(note.title, note.body)
    if (verdict.refuse) {
      // ⚠ The TITLE is kept in the report and the BODY is not, because a title
      // can itself be the secret ("Brighton bank 2484#"). Truncated for the
      // same reason, and the reason names the RULE rather than the match.
      base.refused.push({ title: note.title.slice(0, 40), reason: verdict.reason ?? 'refused' })
      continue
    }
    if (note.attachments.length > 0) base.withUnreadableAttachments += 1
    keep.push(note)
  }

  if (keep.length === 0) {
    base.notes.push(
      base.found === 0
        ? `no notes in ${base.nominated.join(', ') || '(nothing nominated)'}` +
            (read.foldersSeen.length ? ` — folders present: ${read.foldersSeen.join(', ')}` : '')
        : `all ${base.found} note(s) were refused or unreadable`
    )
    return { ...base, ok: true }
  }

  // ── Recorded calls: the transcript IS the note ────────────────────────────
  //
  // ⚠ SEQUENTIAL AND MEMORY-GUARDED. §12: never run whisper against a resident
  // chat model on this box — with the 22GB model loaded, swap sits at 21.5GB
  // and whisper is OOM-killed, which looks exactly like a corrupt recording. So
  // free memory is read ONCE per run and a refusal is reported with its reason
  // rather than attempted and killed.
  const freeMb = freeMemoryMb()
  for (const note of keep) {
    if (!isCallRecording(note)) continue
    base.calls.found += 1
    const result = await transcribeCallNote(note, { freeMb })
    if (result.text) {
      // The transcript replaces the 254-byte stub, so every downstream phase —
      // summarize, route, commitments, embed — sees what was actually said.
      note.body = `${note.title}\n\n${result.text}`
      base.calls.transcribed += 1
    } else {
      base.calls.deferred.push({ title: note.title.slice(0, 48), why: result.skipped ?? 'unknown' })
    }
  }

  // ⚠ A CALL WITH NO TRANSCRIPT IS NOT STORED. Its body would be the title
  // alone, which summarizes to nothing, indexes as noise, and then reads on the
  // record as though the call had been ingested — the worst of the three
  // outcomes. Deferred calls are reported and retried on the next sweep, when
  // the box may not be paging.
  const storable = keep.filter((n) => !isCallRecording(n) || n.body.trim() !== n.title.trim())

  const threads: ResolvedThread[] = storable.map((n) => noteToThread(n))

  if (dryRun) {
    base.notes.push(...storable.slice(0, 20).map((n) => `${n.modifiedAt.slice(0, 10)}  ${n.title}`))
    return { ...base, ok: true }
  }

  if (threads.length === 0) {
    base.notes.push('nothing storable — every candidate was refused, unreadable or an untranscribed call')
    return { ...base, ok: true }
  }

  // 'deal' is the pipeline the text sweep uses too: these are the owner's own
  // working notes, so they are deal correspondence rather than inbound leads.
  const stored = await storeFetchedThreads(threads, 'deal')
  return { ...base, ok: true, inserted: stored.inserted, refreshed: stored.refreshed }
}

/**
 * Free memory in MB, read from `vm_stat`.
 *
 * Deliberately free + speculative pages only, NOT including inactive: on a box
 * that is already paging, inactive pages are not meaningfully available and
 * counting them would say 8GB free while whisper is being killed.
 */
function freeMemoryMb(): number {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process')
    const out = execFileSync('/usr/bin/vm_stat', { encoding: 'utf8' })
    const page = /page size of (\d+)/.exec(out)
    const free = /Pages free:\s+(\d+)/.exec(out)
    const spec = /Pages speculative:\s+(\d+)/.exec(out)
    if (!page || !free) return 0
    const bytes = (Number(free[1]) + Number(spec?.[1] ?? 0)) * Number(page[1])
    return Math.floor(bytes / 1048576)
  } catch {
    // Unknown is treated as NOT enough: refusing costs one deferred transcript,
    // guessing costs an OOM kill that reads as a corrupt recording.
    return 0
  }
}
