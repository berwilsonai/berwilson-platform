/**
 * A vehicle's own documents — its operating agreement, subscription docs, cap
 * table, consents, K-1s.
 *
 * ⚠ THEY HANG OFF THE LEGAL ENTITY, NOT OFF THE DEAL, AND THAT IS THE WHOLE
 * DESIGN. `documents` already carries five owner columns (`project_id`,
 * `entity_id`, `meeting_id`, `steel_deal_id`, `is_company`) beside a PARALLEL
 * `opportunity_documents` table, and every one of them makes "is this file
 * already filed?" another question nobody remembers to ask — `drive-sync`'s
 * `ownedElsewhere` read one table of two and re-claimed filed documents as
 * company knowledge (CLAUDE.md §12, 09-30). A sixth column would be a sixth
 * place to forget.
 *
 * It is also simply where they belong. An operating agreement is a fact about
 * the LLC: it survives the deal being renamed, re-phased, split into
 * sub-projects or closed, and it follows the entity if the same vehicle is
 * reused on a second site. `documents.entity_id` already exists, the upload
 * route already accepts it, and the vendor page already reads it — so a vehicle
 * with an `entity_id` gets documents for free, and a vehicle without one gets
 * told why it has none.
 *
 * ⚠ AND THAT IS ALSO THE LIMIT OF IT. An entity-filed document has
 * `project_id` NULL, so the confidential-project scrub — which works by project
 * id — does not reach it: it stays visible on the entity's own page and to
 * portfolio retrieval even when the deal is protected. That is pre-existing
 * behaviour for every entity document, not something this read introduces, but
 * a vehicle on a protected deal is the case where it matters, so the card SAYS
 * SO rather than implying containment it does not have.
 */

import { spvDb } from './db'

export interface VehicleDocument {
  id: string
  fileName: string
  docType: string | null
  summary: string | null
  mimeType: string | null
  sizeBytes: number | null
  uploadedAt: string | null
}

interface DocumentRow {
  id: string
  entity_id: string | null
  file_name: string
  doc_type: string | null
  ai_summary: string | null
  mime_type: string | null
  file_size_bytes: number | null
  uploaded_at: string | null
}

/**
 * The documents filed against each of these entities.
 *
 * ⚠ `superseded_at is null` AND `excluded_at is null`, OR THE GRAVEYARD READS
 * AS THE FILE (§12, 09-27 / 09-30). A retired duplicate and a human's "this is
 * not knowledge" are both still rows — the row IS the tombstone — so a reader
 * that does not filter them shows a vehicle holding three copies of its own
 * operating agreement with no way to tell which one is live.
 */
export async function loadVehicleDocuments(
  entityIds: readonly (string | null)[]
): Promise<Map<string, VehicleDocument[]>> {
  const ids = [...new Set(entityIds.filter((id): id is string => !!id))]
  if (ids.length === 0) return new Map()

  const { data, error } = await spvDb()
    .from('documents')
    .select(
      'id,entity_id,file_name,doc_type,ai_summary,mime_type,file_size_bytes,uploaded_at'
    )
    .in('entity_id', ids)
    .is('superseded_at', null)
    .is('excluded_at', null)
    .order('uploaded_at', { ascending: false })
    .limit(1000)
  if (error) {
    // Said out loud, not swallowed into an empty list. A vehicle that silently
    // shows no documents reads as a vehicle with none, and "there is no
    // operating agreement on file" is the one wrong answer here.
    console.error('[spvs] could not read vehicle documents:', error.message)
    return new Map()
  }

  const out = new Map<string, VehicleDocument[]>()
  for (const row of (data ?? []) as DocumentRow[]) {
    if (!row.entity_id) continue
    const doc: VehicleDocument = {
      id: row.id,
      fileName: row.file_name,
      docType: row.doc_type,
      summary: row.ai_summary,
      mimeType: row.mime_type,
      sizeBytes: row.file_size_bytes,
      uploadedAt: row.uploaded_at,
    }
    const list = out.get(row.entity_id)
    if (list) list.push(doc)
    else out.set(row.entity_id, [doc])
  }
  return out
}

/**
 * The paperwork a formed vehicle is expected to have, for the empty state.
 *
 * Deliberately a prompt and NOT a checklist with state: a checklist that cannot
 * record "not applicable" becomes a queue that can never reach zero (§12,
 * 09-30), and these vary by structure. The governance registers are where an
 * obligation with a date belongs.
 */
export const VEHICLE_DOCUMENT_PROMPTS = [
  'Operating agreement',
  'Certificate of organization',
  'EIN letter',
  'Subscription agreements',
  'Member consents',
] as const
