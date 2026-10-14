/**
 * Read Apple Notes from the on-box snapshot. Nothing leaves.
 *
 * ⚠ ONLY THE NOTES IN A NOMINATED FOLDER, AND THAT IS THE WHOLE DESIGN.
 * Automatic classification was tried and measured first, the way the text
 * sweep's was. It does not work here, for a structural reason rather than a
 * tuning one: the text classifier's strongest signal is WHO IS ON THE
 * CONVERSATION — a CRM contact's phone number — and a note has no participants
 * at all. Scoring 334 real notes against every project, opportunity and contact
 * name matched 101 of them (30%), and essentially all were false: `Costco`
 * matched *box*, `Movies/Shows to Watch` matched *richard*, `Reptilian brain`
 * matched *economy*, `Honey` matched *community*. §12 — sometimes the
 * measurement says a threshold cannot work, and then the question is what
 * signal actually exists.
 *
 * The signal that exists is the one this platform already trusts everywhere
 * else: a human filing decision. `GOOGLE_DRIVE_KNOWLEDGE_FOLDER_ID` works that
 * way and its note in §7 says nominating folders IS the control model. So
 * `NOTES_FOLDER_NAMES` names the folders to read, UNSET means the sweep
 * no-ops, and a note Richard has not filed there is never opened.
 *
 * ⚠ IT READS db + -wal + -shm, AND THAT IS CORRECTNESS. Notes holds its store
 * open with a write-ahead log. Measured here: the main file alone reported this
 * corpus as ending 2026-09-15 with 334 notes, when the WAL (63MB) carries it to
 * 10-01 with 348 — and the only recorded call on the machine was in the part
 * the main file could not see. The same trap bw-snapshot's own header records.
 *
 * ⚠ AND IT READS THE SNAPSHOT, NEVER THE LIVE FILE. The Notes group container
 * is TCC-protected, so reading it needs Full Disk Access — a grant that reaches
 * the whole home folder. The platform's process also holds the service-role
 * key, the Google refresh tokens and the mail corpus, so it must never hold
 * FDA. `bw-snapshot` already copies NoteStore.sqlite for exactly this.
 */

import { DatabaseSync } from 'node:sqlite'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { isCallRecording } from './calls'
import { decodeNoteBody } from './decode'

/** Where `bw-snapshot` leaves its copy. Readable without Full Disk Access. */
export function notesSnapshotPath(): string {
  return join(homedir(), 'berwilson-data', 'local-sources', 'NoteStore.sqlite')
}

/** Where `bw-snapshot` copies Notes audio attachments, same layout as Media/. */
export function notesMediaPath(): string {
  return join(homedir(), 'berwilson-data', 'local-sources', 'notes-media')
}

/**
 * The folders to read, by name.
 *
 * A LIST, not one name, for the reason §12 gives about the Meet folder: a
 * folder name is a UI string somebody renames, and matching one exactly had
 * `cron-meet-import` report success 192 times against a Drive that had the
 * folder under a new name. Here the renamer would be Richard himself.
 */
export function nominatedFolders(): string[] {
  return (process.env.NOTES_FOLDER_NAMES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export interface NoteAudio {
  /** Path inside the snapshot's notes-media directory, or null if not copied. */
  path: string | null
  fileName: string
  uti: string
}

export interface NoteRow {
  /** Apple's own identifier, stable across edits. The dedupe key. */
  identifier: string
  title: string
  body: string
  folder: string
  createdAt: string
  modifiedAt: string
  /** Attachment type names on this note, for reporting what we cannot read. */
  attachments: string[]
  /**
   * Audio attachments, resolved to files on disk where the snapshot has them.
   *
   * ⚠ RESOLVED THROUGH THE FK CHAIN, NEVER BY FILENAME. An attachment row
   * points at a media row via `ZMEDIA`, and THAT row carries the three parts of
   * the path: `ZIDENTIFIER` (the directory), `ZGENERATION1` (the version
   * subdirectory) and `ZFILENAME`. Matching on the filename instead would be
   * ambiguous on this very corpus — three different notes each carry a
   * `recording.m4a`, and two media rows carry `Call with Eric Tuaone.m4a`
   * because the file has two generations on disk.
   */
  audio: NoteAudio[]
}

export interface NotesReadResult {
  notes: NoteRow[]
  /** Folders that exist in Notes, so a misconfiguration can name the options. */
  foldersSeen: string[]
  /** Notes in a nominated folder whose body would not decode. */
  undecodable: number
  error: string | null
}

const APPLE_EPOCH = 978_307_200

/**
 * Read the nominated folders, and — separately — recorded calls.
 *
 * ⚠ TWO INDEPENDENT DOORS, AND THE SECOND IS THE POINT. Richard's aim is that
 * the platform gets his recorded calls WITHOUT reading his notes. A recorded
 * call is identifiable by a signal iOS generates (a `Call with …` title plus an
 * audio attachment, see ./calls.ts), and on this account those notes sit in the
 * DEFAULT folder — there is no auto-created call folder to nominate. So calls
 * are admitted from any folder while everything else still requires a human to
 * have filed it into a nominated one. With `NOTES_FOLDER_NAMES` unset, the ONLY
 * thing read is recorded calls.
 */
export function readNotes(
  opts: { snapshot?: string; includeCalls?: boolean } = {}
): NotesReadResult {
  const src = opts.snapshot ?? notesSnapshotPath()
  const includeCalls = opts.includeCalls ?? true
  const empty: NotesReadResult = { notes: [], foldersSeen: [], undecodable: 0, error: null }

  if (!existsSync(src)) {
    return { ...empty, error: `no Notes snapshot at ${src} — is bw-snapshot installed and granted Full Disk Access?` }
  }

  const wanted = nominatedFolders()
  if (wanted.length === 0 && !includeCalls) {
    return { ...empty, error: 'NOTES_FOLDER_NAMES is unset and calls are disabled — nothing to read' }
  }

  const dir = mkdtempSync(join(tmpdir(), 'bw-notes-'))
  try {
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(src + suffix)) copyFileSync(src + suffix, join(dir, `NoteStore.sqlite${suffix}`))
    }
    const db = new DatabaseSync(join(dir, 'NoteStore.sqlite'), { readOnly: true })
    try {
      const folders = db
        .prepare(`select ZTITLE2 as name from ZICCLOUDSYNCINGOBJECT where ZTITLE2 is not null`)
        .all() as { name: string }[]
      const foldersSeen = [...new Set(folders.map((f) => f.name))].sort()

      // Matched case-insensitively on the whole name — a folder called "Ber
      // Wilson" must not also pull in "Ber Wilson personal".
      const target = new Set(wanted.map((w) => w.toLowerCase()))

      const rows = db
        .prepare(
          `select n.ZIDENTIFIER as identifier,
                  n.ZTITLE1     as title,
                  f.ZTITLE2     as folder,
                  -- ⚠ ZCREATIONDATE1 IS NULL FOR EVERY NOTE IN THIS STORE —
                  -- all 353 of them, measured 2026-10-14. Apple keeps the
                  -- creation time in ZCREATIONDATE3 here; 1 and 2 are legacy
                  -- columns that still EXIST, which is why selecting one
                  -- returned no error and no value. appleDate(null) then fell
                  -- back to the epoch, so every note and every recorded call
                  -- ingested since 10-12 was dated 1970-01-01 — on the thread's
                  -- first_at, on the meeting row, and on the attendee's contact
                  -- profile ("1969-12-31", the epoch in Mountain Time).
                  --
                  -- Coalesced rather than swapped: a store that does populate
                  -- the older column is not worth a second code path, and the
                  -- verified value for the one recorded call is 22:14:20
                  -- against a 22:30:20 modification — the sixteen minutes the
                  -- call actually ran.
                  coalesce(n.ZCREATIONDATE1, n.ZCREATIONDATE3) as created,
                  n.ZMODIFICATIONDATE1 as modified,
                  d.ZDATA       as data
             from ZICCLOUDSYNCINGOBJECT n
             join ZICNOTEDATA d on d.ZNOTE = n.Z_PK
             left join ZICCLOUDSYNCINGOBJECT f on f.Z_PK = n.ZFOLDER
            where n.ZTITLE1 is not null
              and coalesce(n.ZMARKEDFORDELETION, 0) = 0
              and d.ZDATA is not null`
        )
        .all() as {
        identifier: string | null
        title: string
        folder: string | null
        created: number | null
        modified: number | null
        data: Uint8Array | null
      }[]

      const attachmentsByNote = attachmentIndex(db)
      const audioByNote = audioIndex(db)

      const notes: NoteRow[] = []
      let undecodable = 0

      for (const row of rows) {
        const folder = row.folder ?? ''
        const nominated = target.has(folder.toLowerCase())
        const audio = audioByNote.get(row.identifier ?? '') ?? []
        // A recorded call is admitted on its own signal, from any folder.
        const isCall = includeCalls && isCallRecording({ title: row.title, audio })
        if (!nominated && !isCall) continue
        const { text } = decodeNoteBody(row.data ? Buffer.from(row.data) : null)
        // ⚠ A CALL RECORDING HAS NO BODY WORTH DECODING — 254 bytes of title
        // and an attachment pointer — so an empty decode is EXPECTED there and
        // is not a failure. Counting it as undecodable would report every call
        // as a broken note.
        if (!text.trim() && !isCall) {
          // Reported, never stored half-read. §12: "no text" must say why.
          undecodable += 1
          continue
        }
        notes.push({
          identifier: row.identifier ?? `${folder}:${row.title}`,
          title: row.title.replace(/\s+/g, ' ').trim(),
          // A call's transcript is attached later by the sweep; until then the
          // title is all there is, and storing an empty body would make the
          // thread read as a note with nothing in it.
          body: text.trim() || row.title.replace(/\s+/g, ' ').trim(),
          folder,
          // And if BOTH are missing, the modification time — never the epoch.
          // A note has to have been written at some point; 1970 is a value no
          // reader can tell from a real one, and it sorts to the top of every
          // list that orders by date.
          createdAt: appleDate(row.created ?? row.modified),
          modifiedAt: appleDate(row.modified),
          attachments: attachmentsByNote.get(row.identifier ?? '') ?? [],
          audio,
        })
      }

      notes.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
      return { notes, foldersSeen, undecodable, error: null }
    } finally {
      db.close()
    }
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : String(err) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Attachment type names per note.
 *
 * ⚠ TYPES ONLY — THE BYTES ARE NOT HERE. Measured on this box: the Media
 * directory holds ZERO files, so the audio of `Call with Eric Tuaone`
 * (2026-09-21, the one recorded call in this corpus) exists in the database as
 * a row and nowhere on disk. Notes downloads attachments lazily and only while
 * Notes.app is running. So a recorded call cannot be transcribed from here, and
 * the honest thing is to NAME it as an attachment the sweep can see but not
 * read — which is what `attachments` is for and what the report says out loud.
 */
function attachmentIndex(db: DatabaseSync): Map<string, string[]> {
  const out = new Map<string, string[]>()
  try {
    const rows = db
      .prepare(
        `select p.ZIDENTIFIER as note, a.ZTYPEUTI as uti
           from ZICCLOUDSYNCINGOBJECT a
           join ZICCLOUDSYNCINGOBJECT p on p.Z_PK = a.ZNOTE
          where a.ZTYPEUTI is not null and p.ZIDENTIFIER is not null`
      )
      .all() as { note: string; uti: string }[]
    for (const r of rows) {
      const list = out.get(r.note) ?? []
      list.push(r.uti)
      out.set(r.note, list)
    }
  } catch {
    // An older schema without one of these columns is not a reason to fail the
    // sweep — it costs the attachment report, not the notes.
  }
  return out
}

/**
 * Audio attachments per note, resolved to files in the snapshot.
 *
 * ⚠ THE PATH COMES FROM THE DATABASE, NOT FROM A DIRECTORY LISTING. The chain
 * is attachment → `ZMEDIA` → that row's `ZIDENTIFIER` / `ZGENERATION1` /
 * `ZFILENAME`, which is exactly the layout under `Accounts/<id>/Media/` and
 * exactly what bw-snapshot preserves. Verified against the live store: both
 * generations of `Call with Eric Tuaone.m4a` resolve to their own directories.
 *
 * `path` is null when the file is not in the snapshot — which is the normal
 * state until `bw-snapshot` is rebuilt AND re-granted Full Disk Access, since
 * TCC keys that grant to the binary and a rebuild replaces it. A null path is
 * REPORTED rather than treated as "no recording".
 */
function audioIndex(db: DatabaseSync): Map<string, NoteAudio[]> {
  const out = new Map<string, NoteAudio[]>()
  try {
    const rows = db
      .prepare(
        `select p.ZIDENTIFIER as note,
                a.ZTYPEUTI    as uti,
                m.ZIDENTIFIER as dir,
                m.ZGENERATION1 as generation,
                m.ZFILENAME   as fileName
           from ZICCLOUDSYNCINGOBJECT a
           join ZICCLOUDSYNCINGOBJECT p on p.Z_PK = a.ZNOTE
           join ZICCLOUDSYNCINGOBJECT m on m.Z_PK = a.ZMEDIA
          where p.ZIDENTIFIER is not null
            and m.ZFILENAME is not null
            and (a.ZTYPEUTI like '%m4a%'
              or a.ZTYPEUTI like '%mpeg-4-audio%'
              or a.ZTYPEUTI like '%coreaudio%'
              or a.ZTYPEUTI = 'public.mp3')`
      )
      .all() as {
      note: string
      uti: string
      dir: string | null
      generation: string | null
      fileName: string
    }[]

    const root = notesMediaPath()
    for (const r of rows) {
      let path: string | null = null
      if (r.dir && r.generation) {
        const candidate = join(root, r.dir, r.generation, r.fileName)
        if (existsSync(candidate)) path = candidate
      }
      const list = out.get(r.note) ?? []
      list.push({ path, fileName: r.fileName, uti: r.uti })
      out.set(r.note, list)
    }
  } catch {
    // An older schema is not a reason to fail the sweep — it costs the audio,
    // not the notes, and the caller reports an empty list as "none resolved".
  }
  return out
}

function appleDate(value: number | null): string {
  if (!value) return new Date(0).toISOString()
  return new Date((value + APPLE_EPOCH) * 1000).toISOString()
}
