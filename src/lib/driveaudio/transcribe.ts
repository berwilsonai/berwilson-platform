/**
 * Transcribe one recording a human dropped in the nominated Drive folder.
 *
 * The whisper call, the empty-file refusal and the paging advice live in
 * `@/lib/audio/transcribe-source`; this module was a near-exact copy of the
 * voice-memo one until 2026-10-19 (§12: never fork a shared pass — add a
 * source). What is genuinely local here is a byte budget, because unlike a
 * memo on local disk every byte of this one crosses the Drive API.
 */
import { fetchDriveFile } from '@/lib/integrations/google-drive'
import { transcribeRecording, type RecordingTranscript } from '@/lib/audio/transcribe-source'
import type { DriveAudioRow } from './read'

/** Below this is a few seconds of audio at any bitrate — not a meeting. */
const MIN_BYTES = 24 * 1024

/**
 * Above this the body is buffered in memory on a box that already swaps. The
 * record's own Meetings tab streams from Storage instead, which is why the
 * message names it.
 */
const MAX_BYTES = 500 * 1024 * 1024

/** Kept as an alias so the sweep's own types do not have to move. */
export type DriveAudioTranscript = RecordingTranscript

export async function transcribeDriveAudio(
  file: DriveAudioRow,
  opts: { mailbox?: string } = {}
): Promise<DriveAudioTranscript> {
  return transcribeRecording({
    fileName: file.fileName,
    preflight: () => {
      if (file.sizeBytes != null && file.sizeBytes < MIN_BYTES) {
        return (
          `${file.sizeBytes} bytes — below the ${Math.round(MIN_BYTES / 1024)}KB floor, which is ` +
          `a few seconds of audio at any bitrate`
        )
      }
      if (file.sizeBytes != null && file.sizeBytes > MAX_BYTES) {
        return (
          `${Math.round(file.sizeBytes / 1024 / 1024)}MB — above the ` +
          `${Math.round(MAX_BYTES / 1024 / 1024)}MB ceiling. Trim it or transcribe it by hand on ` +
          `the record's Meetings tab, which streams from Storage rather than buffering a Drive body`
        )
      }
      return null
    },
    read: async () => {
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
      if (!content) {
        return {
          bytes: Buffer.alloc(0),
          unavailable: `Drive would not serve the bytes for ${file.fileName} (${file.mimeType})`,
        }
      }
      return { bytes: Buffer.from(content.buffer), fileName: content.fileName }
    },
  })
}
