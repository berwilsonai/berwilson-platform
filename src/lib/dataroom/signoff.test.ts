/**
 * When a sign-off goes stale.
 *
 * The property that matters: a sign-off is a statement about a SET of
 * documents, so the tick has to survive the folder changing while ceasing to
 * claim the folder is current. The case worth the most care is a one-for-one
 * REPLACEMENT — a draft swapped for an executed copy — which leaves the count
 * identical and is exactly the change a diligence index exists to catch.
 */

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  attachSignoffs,
  driftLabel,
  fingerprintDocuments,
  isStale,
  type SectionSignoff,
} from './signoff'
import type { RoomDocument } from './status'

const doc = (id: string, driveFileId: string | null = id): RoomDocument => ({
  id,
  fileName: `${id}.pdf`,
  section: '01.1',
  drivePath: '01 — Power & Property/01.1 — Site Control & Title',
  driveFileId,
  uploadedAt: '2026-10-30T00:00:00Z',
  draft: false,
  summary: null,
})

describe('fingerprintDocuments', () => {
  test('is stable regardless of the order Drive listed them in', () => {
    const a = fingerprintDocuments([doc('x'), doc('y'), doc('z')])
    const b = fingerprintDocuments([doc('z'), doc('x'), doc('y')])
    assert.equal(a, b)
    assert.ok(a && a.length === 64, 'expected a sha256 hex digest')
  })

  test('changes when any document changes', () => {
    const base = fingerprintDocuments([doc('x'), doc('y')])
    assert.notEqual(base, fingerprintDocuments([doc('x')]), 'removal')
    assert.notEqual(base, fingerprintDocuments([doc('x'), doc('y'), doc('z')]), 'addition')
    assert.notEqual(base, fingerprintDocuments([doc('x'), doc('q')]), 'replacement')
  })

  test('an empty section is null, not the hash of nothing', () => {
    // So "signed off while empty" and "never signed" stay distinguishable.
    assert.equal(fingerprintDocuments([]), null)
  })

  test('falls back to the row id for a document with no Drive file', () => {
    // A document uploaded in the platform has no `drive_file_id` and is still
    // part of what somebody signed off.
    const withDrive = fingerprintDocuments([doc('a', 'drive-a')])
    const withoutDrive = fingerprintDocuments([doc('a', null)])
    assert.ok(withDrive && withoutDrive)
    assert.notEqual(withDrive, withoutDrive)
  })
})

describe('isStale', () => {
  const docs = [doc('x'), doc('y')]
  const fresh = { fingerprint: fingerprintDocuments(docs), documentCount: docs.length }

  test('is false while the set is untouched', () => {
    assert.equal(isStale(fresh, docs), false)
  })

  test('is true on an addition and on a removal', () => {
    assert.equal(isStale(fresh, [...docs, doc('z')]), true)
    assert.equal(isStale(fresh, [doc('x')]), true)
  })

  test('⚠ IS TRUE ON A ONE-FOR-ONE REPLACEMENT, which a count cannot see', () => {
    // The whole reason the fingerprint exists rather than a count. A draft
    // replaced by an executed copy leaves the count identical and makes every
    // statement about the folder wrong in the direction that matters most.
    const swapped = [doc('x'), doc('executed-y')]
    assert.equal(swapped.length, docs.length, 'the premise of this test is equal counts')
    assert.equal(isStale(fresh, swapped), true)
  })

  test('a sign-off taken while empty goes stale when a document lands', () => {
    const emptySignoff = { fingerprint: null, documentCount: 0 }
    assert.equal(isStale(emptySignoff, []), false)
    assert.equal(isStale(emptySignoff, [doc('x')]), true)
  })

  test('a null fingerprint over a non-empty section reads as stale, not as fresh', () => {
    // A row written before fingerprints existed. Treating null as "matches
    // anything" would make every such sign-off permanently fresh, which is the
    // one failure mode this feature must not have.
    assert.equal(isStale({ fingerprint: null, documentCount: 2 }, docs), true)
  })
})

describe('attachSignoffs', () => {
  const docs = [doc('x'), doc('y')]
  const row = (over: Partial<Record<string, unknown>> = {}) => ({
    id: 'row-1',
    section_key: '01.1',
    signed_off_by: 'auth-eric',
    signed_off_by_name: 'Eric',
    signed_off_at: '2026-10-30T12:00:00Z',
    document_count: 2,
    document_fingerprint: fingerprintDocuments(docs),
    note: null,
    ...over,
  })

  test('carries who and when, and reports fresh against an unchanged set', () => {
    const map = attachSignoffs([row()], new Map([['01.1', docs]]))
    const s = map.get('01.1')!
    assert.equal(s.by, 'Eric')
    assert.equal(s.byAuthUserId, 'auth-eric')
    assert.equal(s.stale, false)
    assert.equal(s.documentCount, 2)
    assert.equal(s.currentCount, 2)
  })

  test('a section with no documents at all still resolves', () => {
    // ⚠ The map lookup must not throw for a section that is simply empty —
    // `readRoomStatus` only puts a key in the map when a document is in it.
    const map = attachSignoffs([row({ section_key: '02.7' })], new Map())
    const s = map.get('02.7')!
    assert.equal(s.currentCount, 0)
    assert.equal(s.stale, true, 'signed over 2 documents, none there now')
  })
})

describe('driftLabel', () => {
  const base: SectionSignoff = {
    id: 'r',
    sectionKey: '01.1',
    by: 'Eric',
    byAuthUserId: 'u',
    at: '2026-10-30T12:00:00Z',
    documentCount: 3,
    fingerprint: 'abc',
    note: null,
    stale: true,
    currentCount: 3,
  }

  test('says nothing when the sign-off is current', () => {
    assert.equal(driftLabel({ ...base, stale: false }), null)
  })

  test('names the direction and gets the singular right', () => {
    assert.match(driftLabel({ ...base, currentCount: 5 })!, /^2 documents added since/)
    assert.match(driftLabel({ ...base, currentCount: 4 })!, /^1 document added since/)
    assert.match(driftLabel({ ...base, currentCount: 1 })!, /^2 documents removed since/)
    assert.match(driftLabel({ ...base, currentCount: 2 })!, /^1 document removed since/)
  })

  test('names a replacement in words rather than reporting zero change', () => {
    // §12: a bare em dash at a value's own weight reads as a failed render —
    // and "0 documents added" would read as nothing having happened, on the
    // change that matters most.
    assert.match(driftLabel(base)!, /replaced/)
  })
})
