/**
 * One whisper call, whatever the recording came from.
 *
 * ⚠ WHY THIS EXISTS. `voicememos/transcribe.ts` and `driveaudio/transcribe.ts`
 * were written three days apart and are the same function twice: check whisper
 * is configured, answer the cheap guards before moving any bytes, fetch the
 * audio, refuse an empty file, run whisper, trim, and return a result whose
 * `skipped` is deliberately named so a skip never reads as "there was no
 * recording". Measured 2026-10-19: ~90 of ~110 lines identical, down to the
 * wording of the paging advice on a failure.
 *
 * Copy-paste between source modules has already cost one real bug — a
 * recording's `meetings` row never followed its filed thread, and the fix had
 * to be applied to both sweeps because neither shared the tail. A third
 * recorder (a Zoom export, a dictaphone, a web upload) would have been a third
 * copy, and the next fix a three-way edit.
 *
 * What stays per-source is only what genuinely differs: WHERE the bytes come
 * from, and WHICH cheap guards can be answered first. A voice memo knows its
 * duration and lives on a disk that can be full; a Drive file knows its byte
 * size and lives behind a quota. Both are expressed as `preflight`, so the
 * guard order — refuse before downloading — is enforced here rather than
 * remembered in each caller.
 */
import { transcribeAudio, whisperEnabled } from '@/lib/ai/whisper'

export interface RecordingTranscript {
  /** The transcript, trimmed. Null whenever `skipped` is set. */
  text: string | null
  /**
   * Why there is no transcript, in words a human can act on. Named `skipped`
   * rather than `error` because most of these are decisions, not faults — and
   * §12: "no text" must say WHY, because a permanent reason reads differently
   * from a transient one.
   */
  skipped: string | null
  /** Whisper wall-clock, for the report — a slow box should be visible. */
  latencyMs: number | null
  /** What was actually read, so a quota or disk question has a number. */
  bytes: number | null
}

export interface RecordingSource {
  /** The file as a human would name it, used in every message. */
  fileName: string
  /**
   * Guards answerable before any bytes move — a duration floor, a size
   * ceiling, a full disk. Return the reason to skip, or null to proceed.
   * Runs after the whisper check and before `read`, which is the whole point.
   */
  preflight?: () => Promise<string | null> | string | null
  /**
   * Fetch the audio. Return null when the source will not serve it — the
   * caller's own message is used, since only it knows why.
   */
  read: () => Promise<{ bytes: Buffer; fileName?: string; unavailable?: string } | null>
}

function none(skipped: string, bytes: number | null = null): RecordingTranscript {
  return { text: null, skipped, latencyMs: null, bytes }
}

export async function transcribeRecording(source: RecordingSource): Promise<RecordingTranscript> {
  if (!whisperEnabled()) {
    return none('whisper is not configured (WHISPER_BIN/WHISPER_MODEL)')
  }

  const skip = await source.preflight?.()
  if (skip) return none(skip)

  const started = Date.now()
  let bytes: number | null = null
  try {
    const content = await source.read()
    if (!content) return none(`the recording could not be read (${source.fileName})`)
    if (content.unavailable) return none(content.unavailable)

    bytes = content.bytes.byteLength
    if (bytes === 0) {
      return none('the audio file is empty — an upload or an iCloud download that never finished', 0)
    }

    const text = await transcribeAudio(content.bytes, content.fileName ?? source.fileName)
    const trimmed = text.trim()
    if (!trimmed) return none('whisper returned no text', bytes)

    return { text: trimmed, skipped: null, latencyMs: Date.now() - started, bytes }
  } catch (err) {
    return {
      text: null,
      // ⚠ Keep the paging advice. A whisper that was KILLED rather than failed
      // is the most common real cause here and reads like a code fault: the
      // box is 36GB and llama-server holds ~25GB resident, so whisper and the
      // chat model do not fit at once (§12 — never run OCR or whisper beside
      // the LLM).
      skipped:
        `whisper or the read failed on ${source.fileName}: ` +
        `${err instanceof Error ? err.message : String(err)}` +
        ` — if whisper was KILLED the box is paging: \`lms unload\`, re-run, then` +
        ` \`zsh deploy/lmstudio-check.sh --fix\` to restore the load settings`,
      latencyMs: null,
      bytes,
    }
  }
}
