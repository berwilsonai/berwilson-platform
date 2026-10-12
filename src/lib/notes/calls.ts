/**
 * A recorded phone call becomes a transcript the platform can read.
 *
 * ⚠ THIS IS WHY NOTES IS A SOURCE AT ALL, AND IT NEEDED NO DRIVE AND NO
 * SHORTCUT. Richard asked how to push the iPhone's call-recording folder up to
 * Google Drive so the platform would not have to read his notes. Three
 * measurements answered it:
 *
 *   1. There IS no auto-created folder on this account. Both recordings sit in
 *      the default `Notes` folder; iOS names the NOTE `Call with <name>` and
 *      that title is the structural signal, not a folder.
 *   2. The recording's note body is **254 bytes** — a title and an attachment
 *      pointer, with NO transcript. The audio is the content, so pushing text
 *      would push nothing.
 *   3. The audio is ALREADY on this Mac. iCloud downloads Notes attachments
 *      while Notes.app runs, and `bw-snapshot` now copies them. Nothing has to
 *      leave the box, and an Apps Script could not have reached them anyway —
 *      it runs in Google's cloud and cannot see Apple Notes.
 *
 * So the answer to "that way Pepper doesn't need to read my notes" is better
 * served HERE than by Drive: this reads ONLY notes that are recorded calls, by
 * a signal iOS generates, from any folder — and the general notes sweep still
 * reads nothing at all unless a folder is nominated.
 */

import { readFile } from 'node:fs/promises'

import { transcribeAudio, whisperEnabled } from '@/lib/ai/whisper'
import type { NoteRow } from './read'

/**
 * iOS's own title for a call recording.
 *
 * ⚠ A GENERATED STRING, WHICH IS WHY IT IS ALLOWED TO BE A TITLE MATCH. §12
 * warns repeatedly against matching records by a word in a name — that is about
 * matching a human's prose to a record. This is the opposite: iOS writes this
 * title itself, in this exact form, and the note must ALSO carry audio. A note
 * a person typed and called "call with the bank" has no attachment and is not
 * selected.
 */
const CALL_TITLE = /^\s*call with\s+\S/i

/** Is this note a recorded call? Title AND audio — never either alone. */
export function isCallRecording(note: Pick<NoteRow, 'title' | 'audio'>): boolean {
  if (note.audio.length === 0) return false
  return CALL_TITLE.test(note.title)
}

/**
 * Free memory below which transcription is refused. **0 = always attempt.**
 *
 * ⚠ MEASURED, AND THE FIRST VERSION OF THIS GUARD WAS WRONG IN BOTH DIRECTIONS.
 * §12 says never run OCR and the chat model together — with the 22GB model
 * resident, swap hit 21.5GB and `bw-ocr` was being KILLED. I assumed whisper
 * inherited that, and gated on 2GB of free memory.
 *
 * Both halves of that were wrong, measured here on 2026-10-12 against a real
 * 16-minute call (`Call with Eric Tuaone`, 12.3MB m4a):
 *
 *   - **"Free" is not the metric on this box.** With the chat model UNLOADED,
 *     free pages were still 135MB — macOS holds the rest compressed and
 *     inactive. A free-pages gate never opens, so the guard deferred every
 *     call forever while reporting a tidy reason.
 *   - **Whisper is not OCR.** With the chat model fully resident it completed
 *     in **29.7s** and produced 5,956 characters (13.9s with it unloaded).
 *     OCR's problem is rendering pages at 200 DPI; whisper large-v3-turbo
 *     needs about 1.6GB and survives the contention.
 *
 * So the default is to ATTEMPT, and a kill or a failure is reported as a
 * deferral with §12's remedy attached. The cost of trying and failing is one
 * deferred transcript on the next sweep; the cost of refusing pre-emptively was
 * the whole feature. The variable survives so a paging box can be told to stop.
 */
const MIN_FREE_MB = Number(process.env.NOTES_TRANSCRIBE_MIN_FREE_MB ?? 0)

export interface TranscriptResult {
  text: string | null
  /** Named so a skip never reads as "there was no recording". */
  skipped: string | null
}

export async function transcribeCallNote(
  note: NoteRow,
  opts: { freeMb: number }
): Promise<TranscriptResult> {
  const playable = note.audio.filter((a) => a.path)
  if (playable.length === 0) {
    const names = note.audio.map((a) => a.fileName).join(', ')
    return {
      text: null,
      skipped:
        `audio not in the snapshot (${names || 'none'}) — rebuild bw-snapshot and ` +
        `re-grant it Full Disk Access, and leave Notes.app running so iCloud downloads attachments`,
    }
  }
  if (!whisperEnabled()) {
    return { text: null, skipped: 'whisper is not configured (WHISPER_BIN/WHISPER_MODEL)' }
  }
  if (MIN_FREE_MB > 0 && opts.freeMb < MIN_FREE_MB) {
    return {
      text: null,
      skipped:
        `only ${opts.freeMb}MB free and NOTES_TRANSCRIBE_MIN_FREE_MB is ${MIN_FREE_MB} — skipped by configuration`,
    }
  }

  // The longest recording wins when a note carries several: iOS files a short
  // "moments" clip beside the real call, and the call is the one worth reading.
  const parts: string[] = []
  for (const a of playable) {
    try {
      const buffer = await readFile(a.path!)
      const text = await transcribeAudio(buffer, a.fileName)
      if (text.trim()) parts.push(text.trim())
    } catch (err) {
      // ⚠ A KILLED WHISPER AND A CORRUPT RECORDING LOOK IDENTICAL FROM HERE,
      // so the remedy is named rather than guessed at. Measured: it survives a
      // resident chat model, so a kill means the box is worse off than it was.
      return {
        text: null,
        skipped:
          `whisper failed on ${a.fileName}: ${err instanceof Error ? err.message : String(err)}` +
          ` — if it was killed, the box is paging: \`lms unload\` then re-run, and` +
          ` \`zsh deploy/lmstudio-check.sh --fix\` afterwards to restore the load settings`,
      }
    }
  }
  if (parts.length === 0) return { text: null, skipped: 'whisper returned no text' }
  // Longest first, so the real call leads and a clip follows it.
  parts.sort((a, b) => b.length - a.length)
  return { text: parts.join('\n\n---\n\n'), skipped: null }
}
