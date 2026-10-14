/**
 * A voice memo becomes words, on this machine.
 *
 * A thin sibling of `notes/calls.ts` over the same shared `transcribeAudio` —
 * which spawns `afconvert` (reads m4a natively) and whisper.cpp, both local.
 * The two differ only in where the audio was found, so the measurements that
 * shaped the call path are inherited rather than re-litigated:
 *
 * ⚠ IT ATTEMPTS BY DEFAULT RATHER THAN GUARDING ON FREE MEMORY. §12 says never
 * run OCR against a resident chat model, and the first version of the call
 * guard assumed whisper inherited that. Both halves were wrong, measured
 * 2026-10-12 on a real 16-minute call: free pages read 135MB even with the
 * model UNLOADED (macOS holds the rest compressed), so a free-pages gate never
 * opens and deferred every call forever; and whisper large-v3-turbo needs about
 * 1.6GB and completed in 29.7s with the 22GB chat model fully resident. The
 * cost of trying and failing is one deferred transcript; the cost of refusing
 * pre-emptively was the whole feature.
 *
 * ⚠ A KILLED WHISPER AND A CORRUPT RECORDING LOOK IDENTICAL FROM HERE, so the
 * remedy is named in the skip reason rather than guessed at by whoever reads
 * the log.
 *
 * ⚠ AND A LONG RECORDING IS THE NORMAL CASE HERE, which it was not for calls.
 * An in-person meeting runs 30-90 minutes where a phone call ran 16. whisper
 * measured ~32x realtime on this box, so an hour of audio is ~2 minutes of
 * transcription — well inside `TRANSCRIBE_TIMEOUT_MS` (120 min) — but it holds
 * a CPU for that long, which is why the sweep runs sequentially and five
 * minutes behind the other local sweeps (LM Studio serves one request at a
 * time, §12).
 */

import { readFile, stat } from 'node:fs/promises'

import { transcribeAudio, whisperEnabled } from '@/lib/ai/whisper'
import type { MemoRow } from './read'

/**
 * Free memory below which transcription is refused. **0 = always attempt.**
 * Kept so a box that is genuinely paging can be told to stop; see the header
 * for why it is not a default.
 */
const MIN_FREE_MB = Number(process.env.NOTES_TRANSCRIBE_MIN_FREE_MB ?? 0)

/**
 * Audio this short cannot be a meeting.
 *
 * Not a relevance filter — that is the summarizer's job, and the whole design
 * here is that every memo is read. This is the floor below which there is
 * nothing to read at all: a pocket-dial, a tap on the record button, two
 * seconds of silence. whisper answers confident hallucinated text on pure
 * silence rather than erroring, so a floor is cheaper than a retraction.
 */
const MIN_SECONDS = 5

export interface MemoTranscript {
  text: string | null
  /** Named so a skip never reads as "there was no recording". */
  skipped: string | null
  /** How long whisper took, for the report. */
  latencyMs: number | null
}

export async function transcribeMemo(
  memo: MemoRow,
  opts: { freeMb?: number } = {}
): Promise<MemoTranscript> {
  const none = (skipped: string): MemoTranscript => ({ text: null, skipped, latencyMs: null })

  if (!memo.audioPath) {
    return none(
      `audio not in the snapshot (${memo.fileName}) — if this memo is new, bw-snapshot ` +
        `has not run since it synced; if it is not, check Voice Memos.app is RUNNING on the ` +
        `Studio and that ~/.local/bin/bw-snapshot still holds Full Disk Access`
    )
  }
  if (!whisperEnabled()) {
    return none('whisper is not configured (WHISPER_BIN/WHISPER_MODEL)')
  }
  if (memo.durationSeconds != null && memo.durationSeconds < MIN_SECONDS) {
    return none(`${Math.round(memo.durationSeconds)}s of audio — below the ${MIN_SECONDS}s floor`)
  }
  if (MIN_FREE_MB > 0 && (opts.freeMb ?? 0) < MIN_FREE_MB) {
    return none(
      `only ${opts.freeMb ?? 0}MB free and NOTES_TRANSCRIBE_MIN_FREE_MB is ${MIN_FREE_MB} — skipped by configuration`
    )
  }

  // A zero-length file is iCloud having synced the DATABASE ROW but not the
  // bytes — a real state, and one that must read as "not yet" rather than as a
  // corrupt recording, because the next run will find it.
  try {
    const { size } = await stat(memo.audioPath)
    if (size === 0) return none('the audio file is empty — iCloud has not finished downloading it')
  } catch (err) {
    return none(`could not read ${memo.fileName}: ${err instanceof Error ? err.message : String(err)}`)
  }

  const started = Date.now()
  try {
    const buffer = await readFile(memo.audioPath)
    const text = await transcribeAudio(buffer, memo.fileName)
    const trimmed = text.trim()
    if (!trimmed) return none('whisper returned no text')
    return { text: trimmed, skipped: null, latencyMs: Date.now() - started }
  } catch (err) {
    return none(
      `whisper failed on ${memo.fileName}: ${err instanceof Error ? err.message : String(err)}` +
        ` — if it was killed, the box is paging: \`lms unload\` then re-run, and` +
        ` \`zsh deploy/lmstudio-check.sh --fix\` afterwards to restore the load settings`
    )
  }
}
