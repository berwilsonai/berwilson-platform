/**
 * The reader, against a database built here on purpose.
 *
 * ⚠ WHY A SYNTHETIC STORE AND NOT A FIXTURE. The real `CloudRecordings.db` is
 * Apple's, its column names move between macOS versions, and on this box it did
 * not exist yet when this was written — so the reader resolves each field from
 * `pragma table_info` against a candidate list. That resolution is the part
 * most likely to break silently on an OS upgrade, and the part no fixture from
 * one version can protect. These tests build the shapes that matter.
 *
 * ⚠ AND THE DATE IS THE REASON THIS FILE EXISTS. Apple keeps a Notes note's
 * creation time in `ZCREATIONDATE3` while `…DATE1` is null for all 353 rows,
 * and a sentinel fallback dated that whole corpus to 1970 before anyone noticed
 * (§12 — a column that still exists but holds nothing reads as an empty answer,
 * and never fall back to a value a reader cannot tell from a real one). A memo
 * whose date cannot be read must be REPORTED, never stored with a guess.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readVoiceMemos } from '@/lib/voicememos/read'

const APPLE_EPOCH_OFFSET = 978_307_200

/** Core Data seconds for an ISO instant. */
function appleTime(iso: string): number {
  return new Date(iso).getTime() / 1000 - APPLE_EPOCH_OFFSET
}

interface Row {
  id: string
  path: string
  date: number | null
  label: string | null
  duration: number | null
  folder: number | null
  trashed: number | null
}

/** Build a store with Apple's column names and the rows a test wants. */
function storeWith(rows: Row[], folders: { pk: number; name: string }[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), 'bw-memo-test-'))
  const path = join(dir, 'CloudRecordings.db')
  const db = new DatabaseSync(path)
  db.exec(`create table ZFOLDER (Z_PK integer primary key, ZNAME text)`)
  db.exec(`create table ZCLOUDRECORDING (
    Z_PK integer primary key,
    ZUNIQUEID text,
    ZPATH text,
    ZDATE real,
    ZCUSTOMLABEL text,
    ZDURATION real,
    ZFOLDER integer,
    ZTRASHEDDATE real
  )`)
  for (const f of folders) {
    db.prepare(`insert into ZFOLDER (Z_PK, ZNAME) values (?, ?)`).run(f.pk, f.name)
  }
  for (const r of rows) {
    db.prepare(
      `insert into ZCLOUDRECORDING
         (ZUNIQUEID, ZPATH, ZDATE, ZCUSTOMLABEL, ZDURATION, ZFOLDER, ZTRASHEDDATE)
       values (?, ?, ?, ?, ?, ?, ?)`
    ).run(r.id, r.path, r.date, r.label, r.duration, r.folder, r.trashed)
  }
  db.close()
  return path
}

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: 'A1B2C3',
    path: '20261014 103000.m4a',
    date: appleTime('2026-10-14T16:30:00.000Z'),
    label: 'Steelton site walk',
    duration: 2_700,
    folder: null,
    trashed: null,
    ...overrides,
  }
}

test('a renamed memo reads back with its date, title and length', () => {
  const path = storeWith([row()])
  try {
    const result = readVoiceMemos({ snapshot: path })
    assert.equal(result.error, null)
    assert.equal(result.memos.length, 1)
    const memo = result.memos[0]
    assert.equal(memo.identifier, 'A1B2C3')
    assert.equal(memo.title, 'Steelton site walk')
    assert.equal(memo.createdAt, '2026-10-14T16:30:00.000Z')
    assert.equal(memo.durationSeconds, 2_700)
    assert.equal(memo.fileName, '20261014 103000.m4a')
  } finally {
    rmSync(path, { force: true })
  }
})

test('an un-renamed memo falls back to the file name without its extension', () => {
  // iOS fills the label only on a rename, so this is the common case — and an
  // extension is not a title.
  const path = storeWith([row({ label: null })])
  try {
    const memo = readVoiceMemos({ snapshot: path }).memos[0]
    assert.equal(memo.title, '20261014 103000')
  } finally {
    rmSync(path, { force: true })
  }
})

test('a memo with no readable date is reported, never dated by guess', () => {
  const path = storeWith([
    row({ id: 'NODATE', date: null }),
    row({ id: 'ZERO', path: 'b.m4a', date: 0 }),
  ])
  try {
    const result = readVoiceMemos({ snapshot: path })
    assert.equal(result.memos.length, 0, 'neither row may be admitted with an invented date')
    assert.equal(result.skipped.length, 2)
    // The REASON beside the number, naming the column (§12).
    assert.ok(result.skipped.every((s) => /ZDATE|date/i.test(s.reason)))
  } finally {
    rmSync(path, { force: true })
  }
})

test('a unix-epoch value in the Apple column is refused, not read as 2053', () => {
  // ⚠ THIS TEST CHANGED THE READER. Apple has shipped "seconds since 2001" and
  // "seconds since 1970" in adjacent columns of the same table, and the obvious
  // guard — "reject 1970" — is aimed at the wrong end: reading unix seconds as
  // Core Data seconds produces a confident date 27 years in the FUTURE. The
  // first draft's 2005-2100 window accepted it, which would have put a meeting
  // on a project's feed dated 2053 and sorted it above everything real.
  const unixSecondsForToday = Math.floor(Date.now() / 1000)
  const path = storeWith([row({ date: unixSecondsForToday })])
  try {
    const result = readVoiceMemos({ snapshot: path })
    assert.equal(result.memos.length, 0, 'a future date is not a date')
    assert.equal(result.skipped.length, 1)
  } finally {
    rmSync(path, { force: true })
  }
})

test('a 1970 sentinel is refused too', () => {
  // The other end, and the one that dated 353 Apple Notes to 1970 when a null
  // creation column fell back to zero.
  const path = storeWith([row({ date: -APPLE_EPOCH_OFFSET + 86_400 })])
  try {
    assert.equal(readVoiceMemos({ snapshot: path }).memos.length, 0)
  } finally {
    rmSync(path, { force: true })
  }
})

test('a memo in Recently Deleted is never ingested', () => {
  // A human threw it away. Both signals are honoured, because a trashed-date
  // column that is absent is not evidence that nothing was trashed.
  const path = storeWith(
    [
      row({ id: 'TRASHED-DATE', trashed: appleTime('2026-10-14T18:00:00.000Z') }),
      row({ id: 'TRASHED-FOLDER', path: 'c.m4a', folder: 9 }),
      row({ id: 'KEEP', path: 'd.m4a', folder: 1 }),
    ],
    [
      { pk: 9, name: 'Recently Deleted' },
      { pk: 1, name: 'All Recordings' },
    ]
  )
  try {
    const result = readVoiceMemos({ snapshot: path })
    assert.deepEqual(
      result.memos.map((m) => m.identifier),
      ['KEEP']
    )
    assert.equal(result.skipped.filter((s) => /deleted/i.test(s.reason)).length, 2)
  } finally {
    rmSync(path, { force: true })
  }
})

test('memos come back newest first', () => {
  // If a run is cut short by the per-run ceiling, the meeting that just
  // happened is the one that reaches the CRM.
  const path = storeWith([
    row({ id: 'OLD', path: 'old.m4a', date: appleTime('2026-10-01T10:00:00.000Z') }),
    row({ id: 'NEW', path: 'new.m4a', date: appleTime('2026-10-14T10:00:00.000Z') }),
  ])
  try {
    assert.deepEqual(
      readVoiceMemos({ snapshot: path }).memos.map((m) => m.identifier),
      ['NEW', 'OLD']
    )
  } finally {
    rmSync(path, { force: true })
  }
})

test('a missing store names what has to happen, in order', () => {
  const result = readVoiceMemos({ snapshot: join(tmpdir(), 'bw-no-such-store.db') })
  assert.equal(result.memos.length, 0)
  assert.ok(result.error)
  assert.ok(/Voice Memos\.app/.test(result.error!), 'must name the app that has to be running')
  assert.ok(/bw-snapshot/.test(result.error!), 'must name the copier')
})

test('a store with an unrecognised schema says what it found', () => {
  // The upgrade failure: Apple renames a column and the reader must hand the
  // real column list to whoever has to fix the candidate lists, not return an
  // empty answer that reads as "no recordings".
  const dir = mkdtempSync(join(tmpdir(), 'bw-memo-test-'))
  const path = join(dir, 'CloudRecordings.db')
  const db = new DatabaseSync(path)
  db.exec(`create table ZCLOUDRECORDING (Z_PK integer primary key, ZSOMETHINGNEW text)`)
  db.close()
  try {
    const result = readVoiceMemos({ snapshot: path })
    assert.ok(result.error)
    assert.ok(/ZSOMETHINGNEW/.test(result.error!), 'the error must list the columns present')
    assert.ok(/read\.ts/.test(result.error!), 'and point at the file to fix')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
