/**
 * Classifying an outlier.
 *
 * Two properties matter and both were bugs first: that a row in Drive by EITHER
 * route counts as mirrored, and that the most specific true reason wins. Getting
 * the first wrong offered a one-press delete on documents Drive holds, under a
 * warning saying nothing else did.
 */

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { OUTLIER_HINTS, OUTLIER_LABELS, classifyOutlier } from './mirror'

const row = (over: Partial<Parameters<typeof classifyOutlier>[0]> = {}) => ({
  id: 'd1',
  file_name: 'x.pdf',
  drive_file_id: 'drive-1',
  drive_folder_path: '01 — Power & Property/01.1 — Site Control & Title',
  uploaded_at: '2026-10-30T00:00:00Z',
  superseded_at: null,
  superseded_by_hand: null,
  duplicate_of: null,
  excluded_at: null,
  storage_path: 'projects/p/drive/x.pdf',
  drive_published_id: null,
  ...over,
})

describe('classifyOutlier', () => {
  test('a healthy mirrored document is not an outlier', () => {
    assert.equal(classifyOutlier(row()), null)
  })

  test('⚠ A PUBLISHED FILE IS IN DRIVE, by the other column', () => {
    // `drive_file_id` means we read it IN; `drive_published_id` means we pushed
    // it OUT. 20 rows carry the second with the first null, and reading only
    // the first called them "Not in Drive" and flagged them as the only copy —
    // a one-press delete on documents Drive holds, under a warning saying
    // nothing else did.
    assert.equal(
      classifyOutlier(row({ drive_file_id: null, drive_published_id: 'drive-pub-1' })),
      null
    )
  })

  test('no Drive file by either route is the one that may be the only copy', () => {
    assert.equal(
      classifyOutlier(row({ drive_file_id: null, drive_published_id: null })),
      'never_in_drive'
    )
  })

  test('the most specific true reason wins', () => {
    // ⚠ A row satisfies several of these at once — a duplicate is ALSO
    // superseded — and reporting the vaguest true answer is how a queue becomes
    // unactionable: "Removed from Drive" tells you nothing to do, "Duplicate of
    // a file we keep" tells you it is safe to delete and where the keeper is.
    assert.equal(
      classifyOutlier(row({ superseded_at: 'now', duplicate_of: 'd0' })),
      'duplicate'
    )
    assert.equal(
      classifyOutlier(row({ superseded_at: 'now', superseded_by_hand: true })),
      'retired_by_hand'
    )
    assert.equal(classifyOutlier(row({ superseded_at: 'now' })), 'gone_from_drive')
    // A human's decision outranks every mechanical one.
    assert.equal(
      classifyOutlier(row({ excluded_at: 'now', duplicate_of: 'd0', superseded_at: 'now' })),
      'excluded'
    )
  })

  test('every reason has a label and a hint', () => {
    // ⚠ A reason with no hint renders as a chip with nothing beside it, and the
    // reader has to guess which of five different actions resolves it. The
    // `Record<OutlierReason, …>` type is what makes the build name a gap, and
    // this walks every member to prove the type is doing that job.
    for (const reason of Object.keys(OUTLIER_LABELS) as Array<keyof typeof OUTLIER_LABELS>) {
      assert.ok(OUTLIER_LABELS[reason]?.length > 0, reason)
      assert.ok(OUTLIER_HINTS[reason]?.length > 0, `${reason} has no hint`)
    }
    assert.equal(Object.keys(OUTLIER_LABELS).length, Object.keys(OUTLIER_HINTS).length)
  })
})
