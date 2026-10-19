/**
 * What is waiting in the Drive audio intake folder.
 *
 * ⚠ A NOMINATED FOLDER IS THE CONTROL MODEL, EXACTLY AS IT IS FOR NOTES AND FOR
 * THE KNOWLEDGE BASE (§7). Dropping a file in here is a human filing decision,
 * which is why this source needs no classifier deciding whether a recording is
 * admissible: somebody chose it. UNSET means the sweep does nothing — never
 * point it at a Drive root, and never at a folder anything else writes into.
 *
 * ⚠ IT IS DELIBERATELY NOT THE MEET FOLDER AND NOT A KNOWLEDGE FOLDER. Meet's
 * folder is Google's own, named by a UI string that has changed under us once
 * already (§12), and a knowledge folder is indexed as DOCUMENTS — where an mp3
 * reads as `unsupported`, gets a `documents` row with no text and a null
 * `ai_summary`, and is therefore a document the agent never opens. A separate
 * id keeps the two questions apart.
 */

import { listFolder, type DriveFile } from '@/lib/integrations/google-drive'
import { isRecordingFileName } from '@/lib/utils/meetings'

/**
 * The folder recordings are dropped into. UNSET = this source is off.
 *
 * ⚠ Depth matters and is capped at 2 below: files sitting directly in the
 * folder, plus one level of subfolder whose NAME is read as the deal. Deeper
 * nesting is not walked, so a mis-pointed id cannot hoover a whole Drive.
 */
export function driveAudioFolderId(): string | null {
  return process.env.GOOGLE_AUDIO_INTAKE_FOLDER_ID?.trim() || null
}

/** How far back a file is worth reading. **0 disables the window.** */
const MAX_AGE_DAYS = Number(process.env.DRIVE_AUDIO_MAX_AGE_DAYS ?? 0)

export interface DriveAudioRow {
  /** Drive's file id — stable across rename AND move. The idempotency key. */
  fileId: string
  /** The file's own name with the extension stripped — what a reader scans. */
  title: string
  /** As Drive holds it. whisper sniffs the container from the extension. */
  fileName: string
  mimeType: string
  /**
   * When the conversation happened, ISO.
   *
   * ⚠ A BEST EFFORT THAT SAYS SO, WHICH IS THE ONLY HONEST SHAPE HERE. Drive
   * knows when a file was UPLOADED and cannot know when it was recorded, and an
   * export sitting on a phone for three days would otherwise file a Tuesday
   * call onto Friday — above the mail that answered it. So the file NAME is
   * read first, because every device that exports audio timestamps it, and
   * `recordedAtSource` carries which of the two this is.
   */
  recordedAt: string
  recordedAtSource: 'file-name' | 'drive-modified'
  sizeBytes: number | null
  /** The subfolder it was filed in, read as the deal name. Null at the top. */
  folderHint: string | null
  webViewLink: string | null
}

export interface DriveAudioReadResult {
  files: DriveAudioRow[]
  /** Non-audio files in the folder, named with the reason (§12). */
  skipped: { fileName: string; reason: string }[]
  /** Outside DRIVE_AUDIO_MAX_AGE_DAYS, when a window is set. */
  tooOld: number
  error: string | null
}

/**
 * Parse the recording's own timestamp out of its file name.
 *
 * Handles what the exporters actually write: `2026-10-18 10-30-00`,
 * `20261018_103000`, `Plaude 2026-10-18T10.30`, `Recording 2026-10-18 at 10.30`.
 *
 * ⚠ BOUNDED AT BOTH ENDS, AND THE UPPER BOUND CATCHES THE REAL MISTAKE. Any
 * eight digits in a file name look like a date — an invoice number, a parcel
 * id, a phone number — so a parse that cannot be wrong is worth less than one
 * that refuses. A recording cannot have happened after today (two days of slack
 * for a clock or a timezone) and nothing this platform holds predates 2020.
 *
 * ⚠ BUILT FROM PARTS, NEVER `new Date('YYYY-MM-DD')`, which is parsed as UTC
 * midnight and lands the previous evening in Mountain Time.
 */
export function recordedAtFromName(fileName: string): string | null {
  const m = /(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})(?:[T\s_]+(?:at[\s_]+)?(\d{2})[-_.:]?(\d{2})(?:[-_.:]?(\d{2}))?)?/.exec(
    fileName
  )
  if (!m) return null
  const [, y, mo, d, hh, mm, ss] = m
  const year = Number(y)
  const month = Number(mo)
  const day = Number(d)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const date = new Date(
    year,
    month - 1,
    day,
    hh ? Number(hh) : 12, // midday when the name carries no time: a date-only
    mm ? Number(mm) : 0, //  name must not sort before everything else that day
    ss ? Number(ss) : 0
  )
  if (Number.isNaN(date.getTime())) return null
  // The constructor rolls an impossible day over (Feb 30 → Mar 2), which would
  // turn a non-date into a confident one. Reject rather than accept the roll.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  if (year < 2020) return null
  if (date.getTime() > Date.now() + 2 * 86_400_000) return null
  return date.toISOString()
}

/** The file's name without its container extension. */
function stripExtension(name: string): string {
  return name.replace(/\.[A-Za-z0-9]{1,5}$/, '').trim()
}

/** One Drive file → a row, or null when it is not a recording. */
function toRow(file: DriveFile): DriveAudioRow | null {
  if (!isRecordingFileName(file.name)) return null
  const fromName = recordedAtFromName(file.name)
  // A subfolder path deeper than one level keeps only its FIRST segment: the
  // deal is the shelf, and `Steelton/Calls` names the same deal as `Steelton`.
  const folderHint = file.path ? (file.path.split('/')[0] || null) : null
  return {
    fileId: file.id,
    title: stripExtension(file.name) || file.name,
    fileName: file.name,
    mimeType: file.mimeType,
    recordedAt: fromName ?? file.modifiedTime,
    recordedAtSource: fromName ? 'file-name' : 'drive-modified',
    sizeBytes: file.size,
    folderHint,
    webViewLink: file.webViewLink ?? null,
  }
}

/**
 * Read the intake folder, newest first.
 *
 * Never throws for a folder that is simply empty or missing — both are reported
 * as themselves, because "nothing new" and "the id is wrong" must not look the
 * same from a cron log (§12: a liveness check needs to name its reason).
 */
export async function readDriveAudio(
  opts: { folderId?: string; mailbox?: string } = {}
): Promise<DriveAudioReadResult> {
  const folderId = opts.folderId ?? driveAudioFolderId()
  const base: DriveAudioReadResult = { files: [], skipped: [], tooOld: 0, error: null }
  if (!folderId) {
    return {
      ...base,
      error:
        'GOOGLE_AUDIO_INTAKE_FOLDER_ID is not set — create a Drive folder for recordings and ' +
        'put its id in .env.local. Nothing is read until a folder is nominated.',
    }
  }

  let listed: DriveFile[]
  try {
    listed = await listFolder(folderId, { mailbox: opts.mailbox, maxDepth: 2 })
  } catch (err) {
    return {
      ...base,
      error: `Could not list the audio intake folder: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const rows: DriveAudioRow[] = []
  for (const file of listed) {
    const row = toRow(file)
    if (!row) {
      base.skipped.push({
        fileName: file.name,
        // Named rather than counted: a transcript or a photo in here is a human
        // putting something in the wrong folder, and an unlabelled count is not
        // a coverage signal (§12).
        reason: `not a container afconvert decodes (${file.mimeType})`,
      })
      continue
    }
    rows.push(row)
  }

  const oldestAllowed = MAX_AGE_DAYS > 0 ? Date.now() - MAX_AGE_DAYS * 86_400_000 : null
  const within = rows.filter((r) => {
    if (oldestAllowed === null) return true
    const ok = Date.parse(r.recordedAt) >= oldestAllowed
    if (!ok) base.tooOld += 1
    return ok
  })

  // Newest first, so a per-run ceiling reads the call that just happened rather
  // than the oldest thing in the folder.
  within.sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt))
  return { ...base, files: within }
}
