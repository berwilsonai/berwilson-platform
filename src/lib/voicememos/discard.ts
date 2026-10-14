/**
 * Forget a recording: delete the copied audio and tell the copier to stop.
 *
 * ⚠ TWO STEPS, AND DELETING THE FILE ALONE WOULD BE A LOOP. `bw-snapshot` runs
 * four times a day and copies any memo audio it does not already have, so a
 * deleted file is back within six hours — and the sweep would then see audio
 * for a memo it had already judged, forever. The skip list is what makes the
 * deletion stick.
 *
 * ⚠ THE SKIP LIST IS A FILE, NOT A TABLE, BECAUSE OF WHO HAS TO READ IT. The
 * copier is 250 lines of Swift holding Full Disk Access and deliberately has no
 * database client, no network and no credentials — that narrowness is the whole
 * argument for granting it FDA at all. A file in the directory it already owns
 * is the only channel that does not widen it. And the list can only ever NARROW
 * what the binary reads, which keeps its header's promise that no input widens
 * its reach.
 *
 * ⚠ AND IT IS KEYED ON THE FILE NAME, NOT THE RECORDING'S IDENTIFIER, for the
 * same reason. The identifier is the key everywhere else in this module —
 * stable across renames, which is what the ingest ledger needs — but the
 * mapping from identifier to file lives in the database, and the only way the
 * copier could follow it would be to grow a SQLite client. So the one place
 * these two programs have to agree uses the one key they can both see.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { readVoiceMemos, voiceMemoAudioDir, voiceMemoSkipListPath } from './read'
import { VOICEMEMO_THREAD_PREFIX } from './to-thread'

/** The audio FILE NAMES the copier must leave alone. */
export function readSkipList(): Set<string> {
  const path = voiceMemoSkipListPath()
  if (!existsSync(path)) return new Set()
  try {
    return new Set(
      readFileSync(path, 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
    )
  } catch {
    // An unreadable skip list must not stop a sweep: the cost is audio copied
    // again, not a record lost.
    return new Set()
  }
}

/** Add file names to the skip list, without duplicating what is already there. */
export function addToSkipList(fileNames: string[]): number {
  const held = readSkipList()
  const fresh = [...new Set(fileNames.filter((n) => n && !held.has(n)))]
  if (fresh.length === 0) return 0
  const path = voiceMemoSkipListPath()
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  if (!existsSync(path)) {
    appendFileSync(
      path,
      '# Recordings bw-snapshot must not copy.\n' +
        '# Written by the platform when the summarizer judged a recording private:\n' +
        '# its transcript, its chunks and this audio were all discarded.\n' +
        '# One audio FILE NAME per line. Safe to delete this file — the memos are\n' +
        '# then copied, re-transcribed and re-judged, which costs whisper time and\n' +
        '# reaches the same verdict.\n',
      { mode: 0o600 }
    )
  }
  appendFileSync(path, fresh.map((n) => `${n}\n`).join(''), { mode: 0o600 })
  return fresh.length
}

export interface DiscardResult {
  /** Audio files actually removed from the snapshot directory. */
  deleted: number
  /** File names added to the skip list, so the copier stops bringing them back. */
  skipListed: number
  /**
   * Recordings whose FILE could not be named, and so could neither be deleted
   * nor skip-listed.
   *
   * ⚠ THIS FIELD EXISTS BECAUSE THE FIRST VERSION REPORTED A DISCARD IT HAD NOT
   * PERFORMED. Measured 2026-10-14 on the first synthetic end-to-end run: the
   * sweep printed "transcript, chunks and audio discarded" while the m4a was
   * still on disk and the skip list had never been created, because the
   * identifier→file mapping is resolved by re-reading the store and that read
   * found no store. §12 — a pass that reports what it did must read before it
   * writes, and the reason belongs beside the number.
   */
  unresolved: number
}

/**
 * Delete these audio FILES and skip-list them. No database, no resolution.
 *
 * The honest primitive: the caller that knows the file name is the caller that
 * can be sure. The sweep always knows it, because it just read the row.
 */
export function discardMemoAudioFiles(fileNames: string[]): DiscardResult {
  const unique = [...new Set(fileNames.filter(Boolean))]
  let deleted = 0
  for (const name of unique) {
    const path = join(voiceMemoAudioDir(), name)
    if (!existsSync(path)) continue
    try {
      rmSync(path, { force: true })
      deleted += 1
    } catch (err) {
      console.error(
        `[voicememos] could not delete ${name} from ${voiceMemoAudioDir()}:`,
        err instanceof Error ? err.message : err
      )
    }
  }
  // Skip-listing matters even when the file was already gone: it is what stops
  // the next snapshot copying it back in six hours.
  const skipListed = addToSkipList(unique)
  return { deleted, skipListed, unresolved: 0 }
}

/**
 * Discard the audio for these memo THREADS, resolving each file from the store.
 *
 * Used by the redaction pass, whose only handle is a thread id — it is called
 * from the summarize phase, which has never seen the recording's row. Where the
 * caller DOES know the file name (the sweep), it calls
 * {@link discardMemoAudioFiles} instead and nothing has to be resolved.
 *
 * ⚠ AN UNRESOLVED RECORDING IS COUNTED, NOT SWALLOWED. If the store cannot be
 * read, there is no file name to delete and none to skip-list, and the honest
 * answer is that nothing was discarded — not a log line nobody reads. The
 * transcript and the chunks are already gone by this point, which is the half
 * that could answer a question out loud; the audio is retried by the next
 * sweep, because the thread row survives as the tombstone and the memo is
 * therefore never re-transcribed.
 */
export async function discardMemoAudio(threadIds: string[]): Promise<DiscardResult> {
  const identifiers = threadIds
    .filter((t) => t.startsWith(VOICEMEMO_THREAD_PREFIX))
    .map((t) => t.slice(VOICEMEMO_THREAD_PREFIX.length))
  if (identifiers.length === 0) return { deleted: 0, skipListed: 0, unresolved: 0 }

  const wanted = new Set(identifiers)
  const fileNames: string[] = []
  try {
    const read = readVoiceMemos()
    for (const memo of read.memos) {
      if (wanted.has(memo.identifier)) fileNames.push(memo.fileName)
    }
  } catch (err) {
    console.error(
      '[voicememos] could not resolve audio to discard:',
      err instanceof Error ? err.message : err
    )
  }

  const result = discardMemoAudioFiles(fileNames)
  return { ...result, unresolved: identifiers.length - fileNames.length }
}
