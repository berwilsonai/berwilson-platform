/**
 * Noticing that a file was MOVED in Drive.
 *
 * ⚠ PROVED BEFORE IT WAS BUILT: a Drive move does not change `modifiedTime`.
 * Three Riverdale documents re-parented on 2026-10-29 still reported a
 * `modifiedTime` of 8 October, because a move changes a file's PARENTS and
 * `modifiedTime` is the content clock. Both importers short-circuited on
 * `driveFileUnchanged` alone, so a human dragging a file into its section was
 * invisible — and `drive_folder_path` is the only thing `sectionOf` reads.
 *
 * That made filing-by-dragging inert, which is the gesture anyone without a
 * platform login has to use, and it is the foundation a per-section sign-off
 * sits on: a checkbox reading "verified" on a folder whose contents the
 * platform has wrong is worse than no checkbox.
 */

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { driveFolderMoved } from '@/lib/integrations/google-drive'

describe('driveFolderMoved', () => {
  test('is true when the folder path differs', () => {
    assert.equal(
      driveFolderMoved('Land & Title', {
        path: '01 — Power & Property/01.1 — Site Control & Title',
      }),
      true
    )
  })

  test('is false when it is the same shelf', () => {
    const path = '01 — Power & Property/01.5 — Utility Power Commitment'
    assert.equal(driveFolderMoved(path, { path }), false)
  })

  test('ignores a difference that is only whitespace', () => {
    // ⚠ 16 of 233 folders on this drive carry a trailing space, and a path that
    // differs only by one is the same shelf — treating it as a move would
    // rewrite the same row on every nightly run forever (§12: a value
    // normalized on READ must be normalized on WRITE, or the comparison can
    // never converge — a real invitee named `"Huge "` did exactly this).
    assert.equal(driveFolderMoved(' Land & Title ', { path: 'Land & Title' }), false)
  })

  test('treats arriving in or leaving the room root as a move', () => {
    // `listFolder` reports an empty path for a file loose in the room root, and
    // a document with no stored path at all is one the platform has never seen
    // in a folder. Both are real changes.
    assert.equal(driveFolderMoved('', { path: '00.0 — _Unsorted' }), true)
    assert.equal(driveFolderMoved('00.0 — _Unsorted', { path: '' }), true)
    assert.equal(driveFolderMoved(null, { path: '' }), false)
    assert.equal(driveFolderMoved(null, { path: '01 — Power & Property' }), true)
    assert.equal(driveFolderMoved(undefined, { path: undefined }), false)
  })

  test('survives the slash inside a section name', () => {
    // 01.6 is named `On-Site / Behind-the-Meter Generation`. Nothing here
    // splits a path, so the extra slash is just a character.
    const path = '01 — Power & Property/01.6 — On-Site / Behind-the-Meter Generation'
    assert.equal(driveFolderMoved(path, { path }), false)
    assert.equal(driveFolderMoved('01 — Power & Property/01.5 — Utility Power Commitment', { path }), true)
  })
})
