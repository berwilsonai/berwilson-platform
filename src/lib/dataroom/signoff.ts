/**
 * Signing off one data-room section, and knowing when that sign-off went stale.
 *
 * Richard, 2026-10-30: *"next to each folder, there is a check box. When checked
 * it will log which user checked it off… Checking it off will mean a human
 * adjudicated it and verified that is the most accurate and up to date doc."*
 *
 * ⚠ A SIGN-OFF IS A STATEMENT ABOUT A SET OF DOCUMENTS, NOT A BOOLEAN ABOUT A
 * FOLDER. That distinction is the whole design. The moment a document is added,
 * removed or replaced, the statement stops describing what is there — the tick
 * has not become false, it has become STALE, and those are different things a
 * reader needs told apart. So the set is fingerprinted at sign-off and compared
 * on every read:
 *
 *   - clearing the tick silently would lose WHO looked, which is the one fact
 *     the feature exists to record;
 *   - keeping it silently would let a room read fully verified while documents
 *     landed in it unexamined — §12's orphaned projection, which looks
 *     perfectly live.
 *
 * ⚠ AND IT ONLY WORKS BECAUSE THE IMPORTER NOW NOTICES A MOVE. Until
 * 2026-10-30 a Drive move did not change `modifiedTime`, so `drive_folder_path`
 * never updated and a document dragged between sections changed NEITHER
 * section's fingerprint. A sign-off would have looked current while the shelf it
 * described was rearranged underneath it. `driveFolderMoved` closed that, and
 * this feature rests on it.
 */

import { createHash } from 'node:crypto'
import type { RoomDocument } from './status'

/** What a stored sign-off says, read back. */
export interface SectionSignoff {
  id: string
  sectionKey: string
  by: string | null
  byAuthUserId: string
  at: string
  /** Documents in the section when it was signed. */
  documentCount: number
  fingerprint: string | null
  note: string | null
  /** The set has changed since. The tick stands; it wants re-checking. */
  stale: boolean
  /** How many documents are in the section NOW, for the drift message. */
  currentCount: number
}

/**
 * A fingerprint of the documents in one section.
 *
 * ⚠ NOT THE COUNT. A count misses a one-for-one swap, and on a data room that
 * is the single most important change there is: a draft replaced by an executed
 * copy leaves the count identical and makes every statement about the folder
 * wrong in the direction that matters. The ids are what identify the set.
 *
 * Keyed on `drive_file_id` where there is one, falling back to the row id — a
 * document uploaded in the platform has no Drive file but is still part of what
 * somebody signed off. Sorted, so Drive's listing order cannot change the
 * answer; §12's lesson that a value normalized on read must be normalized on
 * write, or the comparison never converges.
 *
 * An empty section fingerprints as `null` rather than the hash of an empty
 * string, so "signed off while empty" and "never signed" stay distinguishable.
 */
export function fingerprintDocuments(documents: RoomDocument[]): string | null {
  if (documents.length === 0) return null
  const ids = documents.map((d) => d.driveFileId ?? d.id).sort()
  return createHash('sha256').update(ids.join('\n')).digest('hex')
}

/** Is a stored sign-off still describing what is in the section? */
export function isStale(
  stored: { fingerprint: string | null; documentCount: number },
  documents: RoomDocument[]
): boolean {
  const now = fingerprintDocuments(documents)
  /*
    ⚠ COMPARED ON THE FINGERPRINT, WITH THE COUNT ONLY AS A BACKSTOP. A row
    written before fingerprints existed, or by a path that could not compute
    one, carries `null` — and treating that as "matches anything" would make
    every such sign-off permanently fresh. Falling back to the count is the
    weaker test but it is honest about being weaker, and it still catches an
    addition or a removal.
  */
  if (stored.fingerprint === null && now === null) return stored.documentCount !== documents.length
  if (stored.fingerprint === null) return true
  return stored.fingerprint !== now
}

interface SignoffRow {
  id: string
  section_key: string
  signed_off_by: string
  signed_off_by_name: string | null
  signed_off_at: string
  document_count: number
  document_fingerprint: string | null
  note: string | null
}

/**
 * Attach each section's sign-off to the documents currently in it.
 *
 * Pure, so the staleness rule has one home and is testable without a database —
 * §12: a predicate transcribed into its readers has a home per reader, and the
 * one that lies to you is found last.
 */
export function attachSignoffs(
  rows: SignoffRow[],
  documentsBySection: Map<string, RoomDocument[]>
): Map<string, SectionSignoff> {
  const out = new Map<string, SectionSignoff>()
  for (const row of rows) {
    const documents = documentsBySection.get(row.section_key) ?? []
    out.set(row.section_key, {
      id: row.id,
      sectionKey: row.section_key,
      by: row.signed_off_by_name,
      byAuthUserId: row.signed_off_by,
      at: row.signed_off_at,
      documentCount: row.document_count,
      fingerprint: row.document_fingerprint,
      note: row.note,
      stale: isStale(
        { fingerprint: row.document_fingerprint, documentCount: row.document_count },
        documents
      ),
      currentCount: documents.length,
    })
  }
  return out
}

/** How a stale sign-off reads to a person. Words, never a bare number. */
export function driftLabel(signoff: SectionSignoff): string | null {
  if (!signoff.stale) return null
  const delta = signoff.currentCount - signoff.documentCount
  if (delta > 0) {
    return `${delta} document${delta === 1 ? '' : 's'} added since — re-check`
  }
  if (delta < 0) {
    const gone = -delta
    return `${gone} document${gone === 1 ? '' : 's'} removed since — re-check`
  }
  /*
    ⚠ THE SAME COUNT WITH A DIFFERENT SET IS THE CASE WORTH NAMING LOUDEST. It
    is a document having been REPLACED — a draft swapped for an executed copy,
    or one survey for another — which is exactly the change a diligence index
    exists to catch and the one a count-based check would have missed entirely.
  */
  return 'a document was replaced since — re-check'
}
