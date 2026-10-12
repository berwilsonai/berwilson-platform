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
  inserted: number
  refreshed: number
  notes: string[]
  error: string | null
}

export async function runNotesSweep(
  opts: { dryRun?: boolean; snapshot?: string } = {}
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
    inserted: 0,
    refreshed: 0,
    notes: [],
    error: null,
  }

  const read = readNotes({ snapshot: opts.snapshot })
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

  const threads: ResolvedThread[] = keep.map((n) => noteToThread(n))

  if (dryRun) {
    base.notes.push(...keep.slice(0, 20).map((n) => `${n.modifiedAt.slice(0, 10)}  ${n.title}`))
    return { ...base, ok: true }
  }

  // 'deal' is the pipeline the text sweep uses too: these are the owner's own
  // working notes, so they are deal correspondence rather than inbound leads.
  const stored = await storeFetchedThreads(threads, 'deal')
  return { ...base, ok: true, inserted: stored.inserted, refreshed: stored.refreshed }
}
