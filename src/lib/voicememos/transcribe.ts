/**
 * Transcribe one iPhone voice memo, from the snapshot `bw-snapshot` made.
 *
 * The whisper call itself, the empty-file refusal and the paging advice on a
 * failure all live in `@/lib/audio/transcribe-source` — this module used to be
 * a near-exact copy of the Drive-audio one (§12: never fork a shared pass).
 * What is genuinely local to a voice memo is the guard chain BEFORE any bytes
 * are read, and every one of those guards is about the snapshot rather than
 * about audio.
 */
import { readFile, stat } from 'node:fs/promises'
import { transcribeRecording, type RecordingTranscript } from '@/lib/audio/transcribe-source'
import type { MemoRow } from './read'

const MIN_FREE_MB = Number(process.env.NOTES_TRANSCRIBE_MIN_FREE_MB ?? 0)
const MIN_SECONDS = 5

/** Kept as an alias so the sweep's own types do not have to move. */
export type MemoTranscript = RecordingTranscript

export async function transcribeMemo(
  memo: MemoRow,
  opts: { freeMb?: number } = {}
): Promise<MemoTranscript> {
  return transcribeRecording({
    fileName: memo.fileName,
    preflight: async () => {
      // ⚠ The most common real cause of "nothing happened", and it is not a
      // fault in the reader: Voice Memos syncs only while the app RUNS on the
      // Studio, and the snapshot only sees what has synced.
      if (!memo.audioPath) {
        return (
          `audio not in the snapshot (${memo.fileName}) — if this memo is new, bw-snapshot ` +
          `has not run since it synced; if it is not, check Voice Memos.app is RUNNING on the ` +
          `Studio and that ~/.local/bin/bw-snapshot still holds Full Disk Access`
        )
      }
      if (memo.durationSeconds != null && memo.durationSeconds < MIN_SECONDS) {
        return `${Math.round(memo.durationSeconds)}s of audio — below the ${MIN_SECONDS}s floor`
      }
      if (MIN_FREE_MB > 0 && (opts.freeMb ?? 0) < MIN_FREE_MB) {
        return `only ${opts.freeMb ?? 0}MB free and NOTES_TRANSCRIBE_MIN_FREE_MB is ${MIN_FREE_MB} — skipped by configuration`
      }
      try {
        const { size } = await stat(memo.audioPath)
        if (size === 0) return 'the audio file is empty — iCloud has not finished downloading it'
      } catch (err) {
        return `could not read ${memo.fileName}: ${err instanceof Error ? err.message : String(err)}`
      }
      return null
    },
    read: async () => ({ bytes: await readFile(memo.audioPath as string), fileName: memo.fileName }),
  })
}
