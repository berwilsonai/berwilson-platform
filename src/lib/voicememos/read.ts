/**
 * Read iPhone Voice Memos from the on-box snapshot. Nothing leaves.
 *
 * ⚠ WHY VOICE MEMOS AND NOT A BROWSER BUTTON. Richard asked for a Record button
 * at the top of the app for in-person meetings, then asked the better question:
 * what captures a meeting without losing it to a screen lock. A browser tab is
 * the wrong answer on the device he wants to use — on iOS, locking the screen
 * or leaving Safari suspends the page and WebAudio capture stops, which is the
 * exact failure he named. Voice Memos holds a system background-audio
 * entitlement and records through a locked screen for hours. And the store is
 * reachable by the mechanism Apple Notes already proved on 10-12: iCloud syncs
 * it to this Mac, `bw-snapshot` copies it, whisper reads it on-box.
 *
 * ⚠ EVERY MEMO IS READ, WHICH IS THE OPPOSITE OF THE NOTES RULE, AND THE REASON
 * IS THE GATE THAT FOLLOWS. Notes are read only from a folder a human
 * nominated, because a note has no participants and automatic classification
 * measured useless (30% of 334 notes matched a record name, essentially all
 * falsely). A recorded meeting is different in the one way that matters: it is
 * SPEECH, so the thread summarizer — the same pass that judges a text
 * conversation business-or-not on its content — can judge it. So the sweep
 * transcribes every memo and the summarizer's `noise` verdict discards the
 * transcript, the chunks and the copied audio (see ./sweep.ts, and the text
 * sweep's `redactPrivateLocalThreads`, whose precedent this follows). Richard's
 * call, 10-14, in exchange for zero taps on the phone.
 *
 * ⚠ IT READS db + -wal + -shm, AND THAT IS CORRECTNESS, NOT CAUTION. Measured
 * on Notes: the main file alone reported the corpus as ending 2026-09-15 with
 * 334 notes where the WAL carried it to 10-01 with 348 — and the only recorded
 * call on the machine was in the part the main file could not see.
 *
 * ⚠ AND IT READS THE SNAPSHOT, NEVER THE LIVE CONTAINER, which is TCC-protected
 * and so needs Full Disk Access — a grant that reaches the whole home folder.
 * This process also holds the service-role key, the Google refresh tokens and
 * the mail corpus, so it must never hold FDA. `bw-snapshot` is the only thing
 * on the box that does.
 *
 * ⚠ THE SCHEMA IS RESOLVED FROM THE FILE, NOT WRITTEN FROM MEMORY. Apple's
 * Core Data column names vary by OS version and several are nullable in ways
 * that are invisible until a reader believes them: `ZCREATIONDATE1` is null for
 * all 353 rows in the Notes store, and a sentinel default dated that entire
 * corpus to 1970 before anyone noticed (§12 — a column that still exists but
 * holds nothing reads as an empty answer, and never fall back to a value a
 * reader cannot tell from a real one). So each field below is resolved against
 * `pragma table_info` from a list of candidates, and a field that resolves to
 * nothing is NAMED in the error with the columns that are actually present.
 */

import { DatabaseSync } from 'node:sqlite'
import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

/** Apple's reference date: 2001-01-01 UTC, in Unix seconds. */
const APPLE_EPOCH_OFFSET = 978_307_200

/** Where `bw-snapshot` leaves the Voice Memos database. No FDA needed to read. */
export function voiceMemoSnapshotPath(): string {
  return join(homedir(), 'berwilson-data', 'local-sources', 'CloudRecordings.db')
}

/** Where `bw-snapshot` copies the audio, same layout as the Recordings dir. */
export function voiceMemoAudioDir(): string {
  return join(homedir(), 'berwilson-data', 'local-sources', 'voice-memos')
}

/**
 * The list of memo ids `bw-snapshot` must stop copying audio for.
 *
 * Written by the sweep when the summarizer calls a memo noise; read by the
 * Swift copier. A file rather than a table because the copier holds Full Disk
 * Access and deliberately cannot reach the database — and because this list can
 * only ever NARROW what that binary reads, which keeps its promise that no
 * input widens its reach.
 */
export function voiceMemoSkipListPath(): string {
  return join(voiceMemoAudioDir(), '.skip')
}

export interface MemoRow {
  /** Stable across renames — the idempotency key for the whole pipeline. */
  identifier: string
  /** What the memo is called: the human's rename, else iOS's own name. */
  title: string
  /** When the recording was MADE, ISO. Never a fallback (§12) — see read. */
  createdAt: string
  /** Seconds, or null when the column held nothing. */
  durationSeconds: number | null
  /** Absolute path inside the snapshot's audio dir, or null if not copied. */
  audioPath: string | null
  /** The file as Voice Memos names it, for the whisper call and the report. */
  fileName: string
  /** Voice Memos folder, when the schema exposes one. Reported, never a filter. */
  folder: string | null
}

export interface MemoReadResult {
  memos: MemoRow[]
  /** Rows skipped with the reason, so a gap is never silent. */
  skipped: { fileName: string; reason: string }[]
  /** Age of the snapshot in minutes — a CLOCK, not a count (§12). */
  snapshotAgeMinutes: number | null
  /** Folders present in the store, for diagnostics. */
  foldersSeen: string[]
  error: string | null
}

/**
 * Resolve one logical field to a real column.
 *
 * Returns the first candidate the table actually has. Apple renames these
 * across OS versions (and appends `1`, `2` suffixes when an entity is
 * re-versioned), so a hard-coded name is a silent empty answer waiting to
 * happen.
 */
function pickColumn(available: Set<string>, candidates: string[]): string | null {
  for (const c of candidates) if (available.has(c)) return c
  return null
}

/**
 * Core Data timestamp → ISO, or null. A zero or absent value is NOT a date.
 *
 * ⚠ BOUNDED AT BOTH ENDS, AND THE UPPER BOUND IS THE ONE THAT CATCHES THE REAL
 * MISTAKE. Apple has shipped "seconds since 2001" and "seconds since 1970" in
 * adjacent columns of the same table, and reading the second as the first does
 * not produce an obviously broken 1970 — it produces a confident date 27 years
 * in the FUTURE (a 2026 recording reads as 2053). A recording cannot have
 * happened after today, so the window closes at now, with two days of slack for
 * a clock or a timezone rather than a judgement about plausibility.
 */
function appleTimeToIso(value: unknown): string | null {
  if (typeof value !== 'number' || !isFinite(value) || value <= 0) return null
  const ms = (value + APPLE_EPOCH_OFFSET) * 1000
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return null
  // Voice Memos shipped with iOS 1; nothing on this account predates 2007, and
  // 2005 leaves room without admitting a 1970 sentinel.
  if (d.getUTCFullYear() < 2005) return null
  if (ms > Date.now() + 2 * 86_400_000) return null
  return d.toISOString()
}

/**
 * Read the memos out of the snapshot.
 *
 * Opens a temp COPY, because sqlite may need to recover the WAL and the
 * snapshot's permissions are 0600 — recovering in place would mutate a file the
 * next snapshot run replaces anyway.
 */
export function readVoiceMemos(opts: { snapshot?: string } = {}): MemoReadResult {
  const base: MemoReadResult = {
    memos: [],
    skipped: [],
    snapshotAgeMinutes: null,
    foldersSeen: [],
    error: null,
  }

  const dbPath = opts.snapshot ?? voiceMemoSnapshotPath()
  if (!existsSync(dbPath)) {
    return {
      ...base,
      error:
        `No Voice Memos snapshot at ${dbPath}. Two things produce it, in order: ` +
        `Voice Memos.app must be RUNNING on the Studio (iCloud syncs it only while it is), ` +
        `then \`bw-snapshot\` copies it — rebuild with \`zsh scripts/build-snapshot.sh\` and ` +
        `check ~/Library/Logs/berwilson/snapshot.err.log.`,
    }
  }

  // ⚠ THE NEWEST MTIME ACROSS db + -wal + -shm, NEVER THE `.db` ALONE.
  //
  // §12 already carries this rule and it had not reached this door. SQLite
  // leaves the main file untouched for long stretches and writes to the
  // write-ahead log, so the `.db` mtime is the age of the last CHECKPOINT, not
  // of the data. Measured 2026-10-25: `CloudRecordings.db` was 10 days old while
  // `-wal` was 6, and this probe reported "246h old" — overstating a real outage
  // by four days, on the one check whose whole job is to be believed. A check
  // that cries wolf louder than the truth is one nobody reads on the day it is
  // right, which is the failure this rule exists to prevent.
  //
  // The same reasoning as the copy below, which already reads all three files
  // because reading only the `.db` would miss recent rows entirely — the clock
  // and the data have to come from the same set.
  let newest = 0
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      newest = Math.max(newest, statSync(dbPath + suffix).mtimeMs)
    } catch {
      /* a missing -wal/-shm is normal: SQLite removes them on a clean close */
    }
  }
  if (newest > 0) base.snapshotAgeMinutes = Math.floor((Date.now() - newest) / 60_000)

  const tmp = mkdtempSync(join(tmpdir(), 'bw-memos-'))
  try {
    const localDb = join(tmp, 'CloudRecordings.db')
    copyFileSync(dbPath, localDb)
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(dbPath + suffix)) copyFileSync(dbPath + suffix, localDb + suffix)
    }

    const db = new DatabaseSync(localDb, { readOnly: false })
    try {
      // ── Which table holds the recordings ──────────────────────────────────
      const tables = new Set(
        db
          .prepare(`select name from sqlite_master where type='table'`)
          .all()
          .map((r) => String((r as { name: unknown }).name))
      )
      const recTable = ['ZCLOUDRECORDING', 'ZRECORDING', 'ZMEMO'].find((t) => tables.has(t))
      if (!recTable) {
        return {
          ...base,
          error:
            `Voice Memos snapshot has no recordings table. Tables present: ` +
            `${[...tables].slice(0, 40).join(', ')}`,
        }
      }

      const cols = new Set(
        db
          .prepare(`pragma table_info(${recTable})`)
          .all()
          .map((r) => String((r as { name: unknown }).name))
      )

      const colId = pickColumn(cols, ['ZUNIQUEID', 'ZIDENTIFIER', 'ZRECORDINGID'])
      const colPath = pickColumn(cols, ['ZPATH', 'ZFILEPATH', 'ZFILENAME'])
      const colDate = pickColumn(cols, ['ZDATE', 'ZCREATIONDATE', 'ZRECORDINGDATE'])
      const colLabel = pickColumn(cols, ['ZCUSTOMLABEL', 'ZTITLE', 'ZLABEL'])
      const colDuration = pickColumn(cols, ['ZDURATION', 'ZLENGTH'])
      const colFolder = pickColumn(cols, ['ZFOLDER', 'ZPARENTFOLDER'])
      const colTrashed = pickColumn(cols, ['ZTRASHEDDATE', 'ZDELETEDDATE', 'ZTRASHED'])

      // The two that cannot be worked around: without an id there is no
      // idempotency key, and without a path there is no audio to transcribe.
      const missing: string[] = []
      if (!colId) missing.push('unique id (ZUNIQUEID)')
      if (!colPath) missing.push('file path (ZPATH)')
      if (missing.length > 0) {
        return {
          ...base,
          error:
            `${recTable} is missing ${missing.join(' and ')}. Columns present: ` +
            `${[...cols].join(', ')}. Update the candidate lists in ` +
            `src/lib/voicememos/read.ts to match this macOS version.`,
        }
      }

      // ── Folder names, when the schema has them ────────────────────────────
      const folderNames = new Map<number, string>()
      const folderTable = ['ZFOLDER', 'ZRECORDINGFOLDER'].find((t) => tables.has(t))
      if (folderTable) {
        const fCols = new Set(
          db
            .prepare(`pragma table_info(${folderTable})`)
            .all()
            .map((r) => String((r as { name: unknown }).name))
        )
        const nameCol = pickColumn(fCols, ['ZNAME', 'ZTITLE', 'ZLABEL'])
        if (nameCol) {
          for (const row of db.prepare(`select Z_PK, ${nameCol} as name from ${folderTable}`).all()) {
            const r = row as { Z_PK: unknown; name: unknown }
            const pk = Number(r.Z_PK)
            const name = r.name == null ? null : String(r.name)
            if (isFinite(pk) && name) {
              folderNames.set(pk, name)
              base.foldersSeen.push(name)
            }
          }
        }
      }

      // ── The rows ──────────────────────────────────────────────────────────
      const select = [
        `${colId} as id`,
        `${colPath} as path`,
        colDate ? `${colDate} as date` : `null as date`,
        colLabel ? `${colLabel} as label` : `null as label`,
        colDuration ? `${colDuration} as duration` : `null as duration`,
        colFolder ? `${colFolder} as folder` : `null as folder`,
        colTrashed ? `${colTrashed} as trashed` : `null as trashed`,
      ].join(', ')

      const rows = db.prepare(`select ${select} from ${recTable}`).all() as {
        id: unknown
        path: unknown
        date: unknown
        label: unknown
        duration: unknown
        folder: unknown
        trashed: unknown
      }[]

      const audioDir = voiceMemoAudioDir()

      for (const row of rows) {
        const identifier = row.id == null ? '' : String(row.id)
        // `ZPATH` holds a file name on every version seen, but a version that
        // stores a full path must not produce `audio/dir//Users/...`.
        const rawPath = row.path == null ? '' : String(row.path)
        const fileName = rawPath.split('/').filter(Boolean).pop() ?? ''

        if (!identifier || !fileName) {
          base.skipped.push({ fileName: fileName || '(unnamed)', reason: 'no id or no file name' })
          continue
        }

        // Recently Deleted: a memo the human threw away must not become a
        // record. A trashed-date column that is absent is not evidence of
        // nothing being trashed, so the folder name is checked too.
        const folderName =
          row.folder == null ? null : (folderNames.get(Number(row.folder)) ?? null)
        const trashed =
          (typeof row.trashed === 'number' && row.trashed > 0) ||
          /recently deleted|deleted/i.test(folderName ?? '')
        if (trashed) {
          base.skipped.push({ fileName, reason: 'in Recently Deleted' })
          continue
        }

        const createdAt = appleTimeToIso(row.date)
        if (!createdAt) {
          // ⚠ REPORTED, NOT DEFAULTED. A memo stamped with "now" would file a
          // last-month meeting onto this week's feed, and one stamped 1970
          // dates the corpus — the exact failure the Notes reader hit.
          base.skipped.push({
            fileName,
            reason: colDate
              ? `${colDate} held no usable date (${String(row.date)})`
              : 'no date column in this schema',
          })
          continue
        }

        const audioPath = join(audioDir, fileName)
        const duration =
          typeof row.duration === 'number' && isFinite(row.duration) && row.duration > 0
            ? row.duration
            : null

        base.memos.push({
          identifier,
          // iOS leaves the auto-name in the file name and only fills the label
          // on a rename, so the label is preferred and the file name is the
          // fallback — with its extension dropped, which is not a title.
          title: (row.label == null ? '' : String(row.label).trim()) || fileName.replace(/\.[a-z0-9]+$/i, ''),
          createdAt,
          durationSeconds: duration,
          audioPath: existsSync(audioPath) ? audioPath : null,
          fileName,
          folder: folderName,
        })
      }

      // Newest first: if a run is cut short, the meeting that just happened is
      // the one that reaches the CRM.
      base.memos.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      return base
    } finally {
      db.close()
    }
  } catch (err) {
    return { ...base, error: `Could not read the Voice Memos snapshot: ${err instanceof Error ? err.message : String(err)}` }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}
