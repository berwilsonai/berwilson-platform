/**
 * Assert the Notes decoder against every note on this box.
 *
 * ⚠ THE CHECK THE DECODER CANNOT FAKE: Apple Notes' first line IS the note's
 * title, stored separately in `ZTITLE1`. So a correct body decode must START
 * with that title. A decoder that scrapes printable bytes out of the protobuf
 * passes this on short notes and fails on any note holding a checklist, a
 * table or an attachment — which is exactly the population that matters, since
 * a recorded call is an attachment.
 *
 * Run: node --import ./deploy/register.mjs --env-file=.env.local \
 *        scripts/verify-notes-decode.mts
 */
import { DatabaseSync } from 'node:sqlite'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { decodeNoteBody, titleOf } from '@/lib/notes/decode'

const src = join(homedir(), 'berwilson-data', 'local-sources', 'NoteStore.sqlite')
if (!existsSync(src)) {
  console.log(`FAIL  no snapshot at ${src} — run bw-snapshot first`)
  process.exit(1)
}

// ⚠ db + -wal + -shm. Reading the main file alone reported this corpus as
// ending 2026-09-15 when it actually runs to 10-01, and hid the only recorded
// call entirely. The same trap bw-snapshot's own header records.
const dir = mkdtempSync(join(tmpdir(), 'notes-verify-'))
for (const suffix of ['', '-wal', '-shm']) {
  if (existsSync(src + suffix)) copyFileSync(src + suffix, join(dir, 'NoteStore.sqlite' + suffix))
}

const db = new DatabaseSync(join(dir, 'NoteStore.sqlite'), { readOnly: true })
const rows = db
  .prepare(
    `select o.ZTITLE1 as title, d.ZDATA as data
       from ZICCLOUDSYNCINGOBJECT o
       join ZICNOTEDATA d on d.ZNOTE = o.Z_PK
      where o.ZTITLE1 is not null
        and coalesce(o.ZMARKEDFORDELETION, 0) = 0
        and d.ZDATA is not null`
  )
  .all() as { title: string; data: Uint8Array }[]

let decoded = 0
let titleMatches = 0
let empty = 0
const mismatches: string[] = []

for (const row of rows) {
  const { text, via } = decodeNoteBody(Buffer.from(row.data))
  if (via === 'none' || !text) {
    empty += 1
    continue
  }
  decoded += 1
  // Notes normalizes the title, so compare loosely on the leading run.
  const want = row.title.replace(/\s+/g, ' ').trim().slice(0, 24).toLowerCase()
  const got = titleOf(text).replace(/\s+/g, ' ').trim().slice(0, 24).toLowerCase()
  if (want && got.startsWith(want.slice(0, Math.min(12, want.length)))) titleMatches += 1
  else mismatches.push(`${JSON.stringify(row.title.slice(0, 40))} -> ${JSON.stringify(titleOf(text).slice(0, 40))}`)
}

db.close()
rmSync(dir, { recursive: true, force: true })

const pct = (n: number) => `${Math.round((n / Math.max(rows.length, 1)) * 100)}%`
console.log(`notes with a body:      ${rows.length}`)
console.log(`decoded via protobuf:   ${decoded} (${pct(decoded)})`)
console.log(`no text at all:         ${empty} (${pct(empty)})`)
console.log(`body starts with title: ${titleMatches} of ${decoded}`)
if (mismatches.length) {
  console.log(`\nfirst mismatches (${mismatches.length}):`)
  for (const m of mismatches.slice(0, 10)) console.log('  ' + m)
}

// A decoder that cannot reach 95% of bodies is not a decoder; a note it cannot
// read must be SKIPPED by the sweep, never stored half-read.
if (decoded / Math.max(rows.length, 1) < 0.95 || titleMatches / Math.max(decoded, 1) < 0.95) {
  console.log('\nFAIL  decode coverage or title agreement below 95%')
  process.exitCode = 1
} else {
  console.log('\nDecoder agrees with the stored titles.')
}
