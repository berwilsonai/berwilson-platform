/**
 * One file in the Drive intake folder → whisper → text, on this box.
 *
 * A thin sibling of `voicememos/transcribe.ts` over the same shared
 * `transcribeAudio`, which spawns `afconvert` (decodes every container in
 * RECORDING_EXTENSIONS) and whisper.cpp. Both are local: the bytes come down
 * from Drive and the words are made here, so nothing is sent anywhere to be
 * read. That is the point of taking the raw audio rather than a vendor's
 * transcript.
 *
 * ⚠ THE FLOOR IS BYTES, NOT SECONDS, AND IT IS A PROXY RATHER THAN A MEASURE.
 * `voicememos/transcribe.ts` can refuse anything under 5 seconds because Core
 * Data stores the duration; the Drive API reports duration for VIDEO only
 * (`videoMediaMetadata`), and reports nothing at all for an mp3. So the guard
 * is a size floor, and it exists for the same reason the duration floor does:
 * whisper answers confident hallucinated text on silence rather than erroring,
 * so a tap on the record button becomes a paragraph of invented conversation.
 * 24KB is about 6 seconds of the lowest bitrate anything exports (32kbps mono)
 * and well under one second of anything else — deliberately loose, because
 * refusing a real short call is worse than reading a pocket-dial.
 *
 * ⚠ AND A CEILING, WHICH THE LOCAL SOURCES DO NOT NEED. A voice memo was
 * recorded on a phone; this folder is a place a human can drop a 4GB screen
 * recording, and `fetchDriveFile` buffers the whole body in memory on a box
 * that already pages (§12). 500MB is ~8 hours of mp3 and ~40 minutes of raw
 * video, which is past anything this is for.
 */

import { fetchDriveFile } from '@/lib/integrations/google-drive'
import { transcribeAudio, whisperEnabled } from '@/lib/ai/whisper'
import type { DriveAudioRow } from './read'

const MIN_BYTES = 24 * 1024
const MAX_BYTES = 500 * 1024 * 1024

export interface DriveAudioTranscript {
  text: string | null
  /** Named so a skip never reads as "there was no recording". */
  skipped: string | null
  /** Whisper seconds, for the report — a slow box should be visible. */
  latencyMs: number | null
  /** What was actually downloaded, so a quota question has a number. */
  bytes: number | null
}

export async function transcribeDriveAudio(
  file: DriveAudioRow,
  opts: { mailbox?: string } = {}
): Promise<DriveAudioTranscript> {
  const none = (skipped: string): DriveAudioTranscript => ({
    text: null,
    skipped,
    latencyMs: null,
    bytes: null,
  })

  if (!whisperEnabled()) {
    return none('whisper is not configured (WHISPER_BIN/WHISPER_MODEL)')
  }
  if (file.sizeBytes != null && file.sizeBytes < MIN_BYTES) {
    return none(
      `${file.sizeBytes} bytes — below the ${Math.round(MIN_BYTES / 1024)}KB floor, which is ` +
        `a few seconds of audio at any bitrate`
    )
  }
  if (file.sizeBytes != null && file.sizeBytes > MAX_BYTES) {
    return none(
      `${Math.round(file.sizeBytes / 1024 / 1024)}MB — above the ` +
        `${Math.round(MAX_BYTES / 1024 / 1024)}MB ceiling. Trim it or transcribe it by hand on ` +
        `the record's Meetings tab, which streams from Storage rather than buffering a Drive body`
    )
  }

  const started = Date.now()
  let bytes: number | null = null
  try {
    const content = await fetchDriveFile(
      {
        id: file.fileId,
        name: file.fileName,
        mimeType: file.mimeType,
        modifiedTime: file.recordedAt,
        size: file.sizeBytes,
      },
      { mailbox: opts.mailbox }
    )
    // Null means a Google-native type, which the extension filter already
    // excluded — so reaching this is a real surprise and says so.
    if (!content) return none(`Drive would not serve the bytes for ${file.fileName} (${file.mimeType})`)

    bytes = content.buffer.byteLength
    if (bytes === 0) return none('the file is empty in Drive — an upload that did not finish')

    const text = await transcribeAudio(Buffer.from(content.buffer), content.fileName)
    const trimmed = text.trim()
    if (!trimmed) return none('whisper returned no text')
    return { text: trimmed, skipped: null, latencyMs: Date.now() - started, bytes }
  } catch (err) {
    return {
      text: null,
      skipped:
        `whisper or the download failed on ${file.fileName}: ` +
        `${err instanceof Error ? err.message : String(err)}` +
        ` — if whisper was KILLED the box is paging: \`lms unload\`, re-run, then` +
        ` \`zsh deploy/lmstudio-check.sh --fix\` to restore the load settings`,
      latencyMs: null,
      bytes,
    }
  }
}
