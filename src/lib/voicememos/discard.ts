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
import { dirname } from 'node:path'

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

/**
 * Delete the audio for these memo THREADS and skip-list them.
 *
 * Takes thread ids (`voicememo:<identifier>`) because that is what the
 * redaction pass holds; the identifier is what the copier keys on.
 */
export async function discardMemoAudio(threadIds: string[]): Promise<number> {
  const identifiers = threadIds
    .filter((t) => t.startsWith(VOICEMEMO_THREAD_PREFIX))
    .map((t) => t.slice(VOICEMEMO_THREAD_PREFIX.length))
  if (identifiers.length === 0) return 0

  // The database is the only thing that maps an identifier to its file, so the
  // file is resolved by reading it. ⚠ A snapshot that has since gone missing
  // costs BOTH halves here — there is no file name to delete and none to
  // skip-list — so the caller is told nothing was discarded rather than being
  // left to believe it was. The next run resolves it: the thread row survives
  // as the tombstone, so the memo is never re-read, and the audio is deleted
  // the first time the database can be opened again.
  const wanted = new Set(identifiers)
  const fileNames: string[] = []
  let deleted = 0
  try {
    const read = readVoiceMemos()
    for (const memo of read.memos) {
      if (!wanted.has(memo.identifier)) continue
      fileNames.push(memo.fileName)
      if (!memo.audioPath) continue
      try {
        rmSync(memo.audioPath, { force: true })
        deleted += 1
      } catch (err) {
        console.error(
          `[voicememos] could not delete ${memo.fileName} from ${voiceMemoAudioDir()}:`,
          err instanceof Error ? err.message : err
        )
      }
    }
  } catch (err) {
    console.error(
      '[voicememos] could not resolve audio to discard:',
      err instanceof Error ? err.message : err
    )
  }

  addToSkipList(fileNames)
  return deleted
}
