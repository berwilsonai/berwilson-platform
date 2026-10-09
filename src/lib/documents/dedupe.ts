/**
 * Is this file already on this record?
 *
 * Three independent doors import documents — hand upload, email attachment, and
 * the two Drive syncs — and each used to dedupe only within its own key:
 * `drive_file_id` for Drive, content hash for attachments, file name for uploads.
 * A key that one door writes and another leaves NULL is not a shared key at all,
 * and that is the whole mechanism behind the duplicate pile measured 2026-10-09:
 *
 *   * the attachment importer hashes bytes and skips a match, but Drive imports
 *     stored no `content_sha256`, so every Drive-imported document was invisible
 *     to it. The name collided instead, `disambiguateName` appended the email
 *     subject, and a second row landed — 37 of 185 near-identical pairs carried
 *     exactly that signature;
 *   * two Drive files holding the same bytes (the GridEdge MNDA filed under both
 *     `Signed MNDA's` and `NDA NC`) are two different `drive_file_id`s, so
 *     neither Drive importer could see the collision either.
 *
 * The cost is retrieval quality, not storage: a duplicate doubles a document's
 * chunks and biases every search toward whatever was duplicated.
 *
 * ⚠ THE SCOPE IS ONE RECORD, NEVER THE PLATFORM. The same bytes on two records
 * are routinely both correct — the Cleveland-Cliffs due-diligence package is
 * byte-identical on Weirton, Steelton and Riverdale because it genuinely covers
 * all three sites. A platform-wide hash check would retire two thirds of that.
 */

import { createHash } from 'node:crypto'
import type { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

/** sha256 of the stored bytes. The one definition — callers never roll their own. */
export function hashDocumentBytes(bytes: ArrayBuffer | Buffer | Uint8Array): string {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes as ArrayBuffer)
  return createHash('sha256').update(buf).digest('hex')
}

/** Which record's documents to compare against. */
export type DocumentScope =
  | { kind: 'project'; projectId: string }
  | { kind: 'opportunity'; opportunityId: string }
  | { kind: 'company' }

export interface ScopeDocument {
  id: string
  fileName: string | null
  /** A retired copy still counts — see loadScopeHashes. */
  superseded: boolean
}

/** PostgREST truncates at 1000 rows silently, so every page is asked for. */
const PAGE = 1000

/**
 * Every document on this record, by content hash.
 *
 * Superseded rows are INCLUDED on purpose. If only live documents were indexed,
 * a file whose duplicate was retired last week would import again the moment it
 * appeared under a new Drive id — recreating the duplicate and undoing the
 * decision, which is the same trap `excluded_at` exists to close. The row is the
 * tombstone; its hash is part of the tombstone.
 */
export async function loadScopeHashes(
  supabase: AdminClient,
  scope: DocumentScope
): Promise<Map<string, ScopeDocument>> {
  const byHash = new Map<string, ScopeDocument>()

  for (let from = 0; ; from += PAGE) {
    const base =
      scope.kind === 'opportunity'
        ? supabase
            .from('opportunity_documents')
            .select('id, file_name, content_sha256, superseded_at')
            .eq('opportunity_id', scope.opportunityId)
        : scope.kind === 'project'
          ? supabase
              .from('documents')
              .select('id, file_name, content_sha256, superseded_at')
              .eq('project_id', scope.projectId)
          : supabase
              .from('documents')
              .select('id, file_name, content_sha256, superseded_at')
              .eq('is_company', true)

    const { data, error } = await base.range(from, from + PAGE - 1)
    // ⚠ A read that failed must never read as "nothing on file": that would turn
    // a transient error into a fresh import of every file in the folder.
    if (error) throw new Error(`could not read document hashes: ${error.message}`)

    const rows = (data ?? []) as {
      id: string
      file_name: string | null
      content_sha256: string | null
      superseded_at: string | null
    }[]
    for (const row of rows) {
      if (!row.content_sha256) continue
      const existing = byHash.get(row.content_sha256)
      // A live copy is the better thing to point a reader at than a retired one.
      if (existing && !existing.superseded) continue
      byHash.set(row.content_sha256, {
        id: row.id,
        fileName: row.file_name,
        superseded: !!row.superseded_at,
      })
    }
    if (rows.length < PAGE) break
  }

  return byHash
}

/**
 * The document on this record already holding these bytes, if any.
 *
 * `ignoreId` is the row being updated in place. Without it a Drive file whose
 * own hash is already stored matches ITSELF and every edited file is skipped as
 * a duplicate of the version it is replacing.
 */
export function findDuplicate(
  hashes: Map<string, ScopeDocument>,
  digest: string,
  ignoreId?: string | null
): ScopeDocument | null {
  const hit = hashes.get(digest)
  if (!hit || (ignoreId && hit.id === ignoreId)) return null
  return hit
}
