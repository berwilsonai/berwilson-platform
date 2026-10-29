/**
 * The data room's vocabulary.
 *
 * What is locked here is not the contents of Richard's list but the properties
 * every consumer depends on: one key per section, a real parent on every leaf,
 * a path that parses back to the key it was built from, and a `Record` over
 * every template so a new one cannot be half-wired (§12, 10-29 — the fix for a
 * drifting enumeration is the TYPE, and the test that proves the type bites).
 *
 * The hostile cases in `sectionOf` are the point of the file: one of them
 * (`10.5 MW study`) failed when it was written, which is how the parser came to
 * check membership of the template rather than the shape of a number.
 */

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  DATA_CENTER_ROOM,
  DRAFTS_FOLDER,
  ROOM_TEMPLATES,
  UNSORTED_SECTION,
  WORKING_FOLDERS,
  folderName,
  isDraftPath,
  isRoomTemplateKey,
  leafSections,
  roomFolderPaths,
  sectionByKey,
  sectionOf,
  sectionPath,
  type RoomTemplateKey,
} from './data-room'

describe('the template itself', () => {
  test('has a unique key per section', () => {
    const keys = DATA_CENTER_ROOM.map((s) => s.key)
    assert.equal(new Set(keys).size, keys.length)
  })

  test('names a real parent on every leaf', () => {
    const keys = new Set(DATA_CENTER_ROOM.map((s) => s.key))
    for (const s of DATA_CENTER_ROOM) {
      if (s.parent !== null) assert.ok(keys.has(s.parent), `${s.key} → ${s.parent}`)
    }
  })

  test('carries Richard’s three sections and nineteen subfolders', () => {
    // The count is the thing a partner experiences, so it is asserted rather
    // than described. `00.0 — _Unsorted` is ours, not his, and is excluded.
    const parents = DATA_CENTER_ROOM.filter((s) => !s.parent && s.key !== UNSORTED_SECTION)
    const leaves = DATA_CENTER_ROOM.filter((s) => s.parent !== null)
    assert.deepEqual(parents.map((s) => s.key), ['00', '01', '02'])
    assert.equal(leaves.length, 19)
  })

  test('gives every leaf at least one expected document', () => {
    // A section with no `expects` contributes no row to the 00.2 tracker, so it
    // would be a folder the index can never report on.
    for (const s of leafSections()) {
      if (s.key === UNSORTED_SECTION) continue
      assert.ok(s.expects.length > 0, `${s.key} ${s.label}`)
    }
  })

  test('marks only the genuinely optional section optional', () => {
    const optional = DATA_CENTER_ROOM.filter((s) => s.optional).map((s) => s.key)
    // 01.6 is Richard's own "Not Applicable for projects without on-site
    // generation". 00.0 is ours and is empty on a clean room.
    assert.deepEqual(optional.sort(), [UNSORTED_SECTION, '01.6'])
  })

  test('covers every template key, so a new template cannot be half-wired', () => {
    const keys: RoomTemplateKey[] = ['standard', 'data_center']
    for (const k of keys) assert.ok(k in ROOM_TEMPLATES, k)
    assert.deepEqual(Object.keys(ROOM_TEMPLATES).sort(), [...keys].sort())
    assert.equal(isRoomTemplateKey('data_center'), true)
    assert.equal(isRoomTemplateKey('housing'), false)
    assert.equal(isRoomTemplateKey(null), false)
  })
})

describe('folder names', () => {
  test('formats a section the way Drive will hold it', () => {
    assert.equal(folderName(sectionByKey('01.5')!), '01.5 — Utility Power Commitment')
    assert.equal(folderName(sectionByKey('00')!), '00 — Start Here')
  })

  test('nests a leaf under its parent and leaves 00.0 at the root', () => {
    assert.equal(
      sectionPath(sectionByKey('01.5')!),
      '01 — Power & Property/01.5 — Utility Power Commitment'
    )
    assert.equal(sectionPath(sectionByKey(UNSORTED_SECTION)!), '00.0 — _Unsorted')
  })

  test('builds every folder the room needs, parents before children', () => {
    const paths = roomFolderPaths()
    assert.equal(new Set(paths).size, paths.length)
    for (const p of paths) {
      const parent = p.split('/').slice(0, -1).join('/')
      if (parent) assert.ok(paths.indexOf(parent) < paths.indexOf(p), p)
    }
    // 3 parents + 20 leaves + 19×2 status folders + 3 working folders.
    assert.equal(paths.length, 3 + 20 + 38 + WORKING_FOLDERS.length)
    assert.ok(paths.includes('01 — Power & Property/01.5 — Utility Power Commitment/Drafts'))
    assert.ok(paths.includes('Correspondence'))
  })

  test('sorts the data room above the working folders, as Drive will', () => {
    // The whole reason the sections are numbered: Drive sorts by name, so the
    // sort order IS the reading order a partner gets. Asserted rather than
    // asserted-in-a-comment, because an un-numbered working folder sorting
    // between 01 and 02 would put the mail shelf inside the diligence closet.
    const top = [...new Set(roomFolderPaths().map((p) => p.split('/')[0]))]
    const sorted = [...top].sort((a, b) => a.localeCompare(b))
    const firstWorking = sorted.findIndex((n) => (WORKING_FOLDERS as readonly string[]).includes(n))
    const lastNumbered = sorted.reduce((last, n, i) => (/^\d/.test(n) ? i : last), -1)
    assert.ok(lastNumbered < firstWorking, `${lastNumbered} < ${firstWorking}`)
  })
})

describe('sectionOf — the one parser', () => {
  test('reads the key out of a stored path', () => {
    assert.equal(sectionOf('01 — Power & Property/01.5 — Utility Power Commitment'), '01.5')
    assert.equal(sectionOf('00 — Start Here/00.2 — Master Document Index & Outstanding Items'), 
      '00.2'
    )
    assert.equal(sectionOf('00.0 — _Unsorted'), '00.0')
  })

  test('still reads it through a status subfolder', () => {
    assert.equal(sectionOf('01 — Power & Property/01.1 — Site Control & Title/Drafts'), '01.1')
  })

  test('answers null for the folders that are not sections', () => {
    assert.equal(sectionOf('Correspondence'), null)
    assert.equal(sectionOf('Diligence/Rail & Transportation'), null)
    assert.equal(sectionOf('_Unsorted'), null)
    assert.equal(sectionOf(null), null)
    assert.equal(sectionOf(''), null)
  })

  test('cannot be fooled by a human folder name that contains a slash or a number', () => {
    // ⚠ This drive really holds `Fort Polk / Johnson - Design Build Matocc`,
    // and `PQC Giovanni Campus /Utah Land Records /Land Tenure Documents` —
    // both of which split into segments that are not sections.
    assert.equal(sectionOf('Fort Polk / Johnson - Design Build Matocc'), null)
    assert.equal(sectionOf('PQC Giovanni Campus /Utah Land Records /Land Tenure Documents'), null)
    // A year, a phone number and a version are not section keys.
    assert.equal(sectionOf('2026 Budget'), null)
    assert.equal(sectionOf('Rev 01.5 drawings'), null)
    // ⚠ The shape alone matched this one: `10.5` + a space. Caught here, which
    // is why `sectionOf` checks membership of the template rather than the shape.
    assert.equal(sectionOf('10.5 MW study'), null)
    assert.equal(sectionOf('03.1 — Something We Never Declared'), null)
  })

  test('resolves every path the template generates', () => {
    for (const s of leafSections()) {
      assert.equal(sectionOf(sectionPath(s)), s.key, s.key)
    }
  })
})

describe('isDraftPath', () => {
  test('is true only for the Drafts leaf itself', () => {
    assert.equal(isDraftPath(`01 — Power & Property/01.1 — Site Control & Title/${DRAFTS_FOLDER}`), 
      true
    )
    assert.equal(isDraftPath('01 — Power & Property/01.1 — Site Control & Title'), false)
    // A record folder a human named "Drafts something" is not the convention.
    assert.equal(isDraftPath('Draft Agreements'), false)
    assert.equal(isDraftPath(null), false)
  })
})
