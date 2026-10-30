/**
 * WHERE DRIVE AND BER INTELLIGENCE DISAGREE, AND WHAT TO DO ABOUT EACH ONE.
 *
 * Richard, 2026-10-30: *"The drive will really be the source of truth, so I
 * guess it's probably better for one directional sync where Drive syncs to the
 * exact folders mimic'd in Ber Intelligence. Any folders that dont match the
 * drive are pushed out into an area where they can be deleted or kept
 * separately. This will allow for better data hygiene."*
 *
 * That settles a question the codebase had only ever half-answered. The sync has
 * always been one-directional and `publish.ts` has said so since it was written
 * — *"Drive is a READING surface: nothing is ever read back from it into the
 * record"* — but nothing stated which side WINS when they differ, so a row the
 * platform held and Drive did not simply sat there looking live.
 *
 * Now: **Drive is custody and Drive is truth.** The platform mirrors the folder
 * a document is actually in, including through a rename or a move (fixed
 * 2026-10-30 — a Drive move does not change `modifiedTime`, so until then it
 * never reached us). Anything the platform holds that Drive does not currently
 * back is an OUTLIER: visible in one place, with the reason it is there and a
 * way to resolve it.
 *
 * ⚠ ONE AREA, NOT FOUR, BECAUSE THAT IS WHAT WAS ASKED FOR — but the reason
 * travels with every row, because the reasons are not interchangeable and one of
 * them is dangerous. A duplicate's bytes exist in the copy that was kept, so
 * deleting it costs nothing. A document that was NEVER in Drive may be the only
 * copy there is: a mail attachment the platform extracted, or a note it wrote.
 * Deleting that is destruction, not hygiene, and {@link Outlier.onlyCopy} is how
 * the surface tells them apart rather than leaving the reader to.
 */

import { createAdminClient, createUntypedAdminClient } from '@/lib/supabase/admin'

export type OutlierReason =
  /** No Drive file at all — a mail attachment, or something the platform wrote. */
  | 'never_in_drive'
  /** Had a Drive file; it stopped being listed, so the sync retired the row. */
  | 'gone_from_drive'
  /** Byte-identical to a copy that was kept. The clutter worth clearing. */
  | 'duplicate'
  /** A human said "this is not knowledge". The row IS the tombstone. */
  | 'excluded'
  /** A human retired it, and no importer may undo that. */
  | 'retired_by_hand'

export const OUTLIER_LABELS: Record<OutlierReason, string> = {
  never_in_drive: 'Not in Drive',
  gone_from_drive: 'Removed from Drive',
  duplicate: 'Duplicate of a file we keep',
  excluded: 'Excluded by hand',
  retired_by_hand: 'Retired by hand',
}

/** What the reader should understand about resolving it. */
export const OUTLIER_HINTS: Record<OutlierReason, string> = {
  never_in_drive:
    'The platform holds the only copy — it came off an email or Ber AI wrote it. Push it to Drive to mirror it, or delete it.',
  gone_from_drive:
    'It was in Drive and is not any more, so the sync retired it here. Delete it, or put the file back in Drive and it returns on the next sync.',
  duplicate:
    'The same bytes as a file that is kept, so nothing is lost by deleting this one. The Drive copy is separate — open it to remove that too.',
  excluded: 'Somebody marked this as not knowledge. It stays as a record of that decision until deleted.',
  retired_by_hand: 'Somebody retired this deliberately. No sync will bring it back.',
}

export interface Outlier {
  id: string
  fileName: string
  /** The folder it was last seen in, which may no longer exist in Drive. */
  drivePath: string | null
  driveFileId: string | null
  uploadedAt: string | null
  reason: OutlierReason
  /** The file that was kept instead, when this is a duplicate. */
  keptInstead: { id: string; fileName: string; drivePath: string | null } | null
  /**
   * ⚠ DELETING THIS DESTROYS THE ONLY COPY.
   *
   * True when the platform's own storage is the only place the bytes exist: no
   * Drive file, and no kept duplicate holding the same content. The surface must
   * say so rather than offering an identical-looking Delete beside a duplicate
   * where deleting costs nothing.
   */
  onlyCopy: boolean
}

export interface MirrorStatus {
  kind: 'project' | 'opportunity'
  recordId: string
  recordName: string
  driveFolderId: string | null
  /** Live documents backed by a Drive file — the healthy case. */
  mirrored: number
  /** Live documents with no Drive file. A subset of the outliers. */
  liveNotInDrive: number
  outliers: Outlier[]
  byReason: Record<OutlierReason, number>
  /** Outliers whose deletion would lose the only copy. */
  onlyCopies: number
}

interface Row {
  id: string
  file_name: string
  drive_file_id: string | null
  drive_folder_path: string | null
  uploaded_at: string | null
  superseded_at: string | null
  superseded_by_hand: boolean | null
  duplicate_of: string | null
  excluded_at: string | null
  storage_path: string | null
  /** Set when the PLATFORM pushed this file to Drive, rather than read it in. */
  drive_published_id: string | null
}

/**
 * Does Drive hold this file, by either route?
 *
 * ⚠ TWO COLUMNS, NOT ONE, AND READING ONLY THE FIRST WAS A BUG IN THIS FILE.
 * `drive_file_id` means the platform read the file IN from Drive;
 * `drive_published_id` means the platform pushed it OUT. Either way Drive has
 * it — and 20 rows carry the second with the first null, so the first draft of
 * this classifier called them "Not in Drive" and flagged them as the ONLY copy.
 * That is the false assurance this whole panel exists to avoid, inverted: it
 * would have offered a one-press delete on documents Drive holds, under a
 * warning saying nothing else did.
 */
function inDrive(row: Pick<Row, 'drive_file_id' | 'drive_published_id'>): boolean {
  return !!row.drive_file_id || !!row.drive_published_id
}

/**
 * Which bucket a row falls in.
 *
 * ⚠ ORDER IS LOAD-BEARING AND THE SPECIFIC REASON WINS. A row can satisfy
 * several of these at once — a duplicate is also superseded, an excluded row may
 * also have lost its Drive file — and reporting the vaguest true answer is how a
 * surface becomes unactionable. `excluded` first because it is a human's
 * decision and outranks any mechanical one; `duplicate` before the generic
 * retirements because it is the only reason that comes with somewhere else to
 * look.
 *
 * Returns null for a healthy, mirrored, live document.
 */
export function classifyOutlier(row: Row): OutlierReason | null {
  if (row.excluded_at) return 'excluded'
  if (row.duplicate_of) return 'duplicate'
  if (row.superseded_at && row.superseded_by_hand) return 'retired_by_hand'
  if (row.superseded_at) return 'gone_from_drive'
  if (!inDrive(row)) return 'never_in_drive'
  return null
}

const EMPTY: Record<OutlierReason, number> = {
  never_in_drive: 0,
  gone_from_drive: 0,
  duplicate: 0,
  excluded: 0,
  retired_by_hand: 0,
}

/**
 * Read one record's mirror.
 *
 * Covers BOTH document tables — §9's two-table split means asking only
 * `documents` reports every opportunity as perfectly mirrored, which is the
 * shape of bug that has reached production here more than once.
 */
export async function readMirror(
  kind: 'project' | 'opportunity',
  recordId: string
): Promise<MirrorStatus | null> {
  const supabase = createAdminClient()
  const table = kind === 'project' ? 'projects' : 'opportunities'
  const docTable = kind === 'project' ? 'documents' : 'opportunity_documents'
  const parentCol = kind === 'project' ? 'project_id' : 'opportunity_id'

  const { data: record, error: recErr } = await supabase
    .from(table)
    .select('id, name, drive_source_folder_id')
    .eq('id', recordId)
    .maybeSingle()
  if (recErr) throw new Error(`${table}: ${recErr.message}`)
  if (!record) return null

  // The untyped client, because the TABLE is chosen at run time — §4 keeps it
  // for exactly this. `Row` is the contract and the column list below is it.
  const { data, error } = await createUntypedAdminClient()
    .from(docTable)
    .select(
      'id, file_name, drive_file_id, drive_folder_path, uploaded_at, superseded_at, superseded_by_hand, duplicate_of, excluded_at, storage_path, drive_published_id'
    )
    .eq(parentCol, recordId)
    .order('uploaded_at', { ascending: false })
    .limit(2000)
  if (error) throw new Error(`${docTable}: ${error.message}`)

  const rows = (data ?? []) as unknown as Row[]
  const byId = new Map(rows.map((r) => [r.id, r]))

  const outliers: Outlier[] = []
  const byReason = { ...EMPTY }
  let mirrored = 0
  let liveNotInDrive = 0

  for (const row of rows) {
    const reason = classifyOutlier(row)
    if (!reason) {
      mirrored++
      continue
    }
    if (reason === 'never_in_drive') liveNotInDrive++
    byReason[reason]++

    const kept = row.duplicate_of ? byId.get(row.duplicate_of) : undefined
    outliers.push({
      id: row.id,
      fileName: row.file_name,
      drivePath: row.drive_folder_path,
      // Either route — a published file is openable in Drive just the same.
      driveFileId: row.drive_file_id ?? row.drive_published_id,
      uploadedAt: row.uploaded_at,
      reason,
      keptInstead: kept
        ? { id: kept.id, fileName: kept.file_name, drivePath: kept.drive_folder_path }
        : null,
      /*
        ⚠ The bytes exist somewhere ELSE only if Drive has the file, or a kept
        duplicate holds the same content. `duplicate_of` pointing at a row we
        cannot see in this record is NOT reassurance — it may have been deleted
        — so the kept row has to be present for the claim to hold.
      */
      onlyCopy: !inDrive(row) && !kept,
    })
  }

  return {
    kind,
    recordId,
    recordName: record.name ?? '',
    driveFolderId: record.drive_source_folder_id,
    mirrored,
    liveNotInDrive,
    outliers,
    byReason,
    onlyCopies: outliers.filter((o) => o.onlyCopy).length,
  }
}
