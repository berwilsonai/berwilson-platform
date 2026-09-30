/**
 * Move a document to the record it actually belongs to, or mark it as not
 * knowledge at all.
 *
 * Why this exists: the nightly Drive knowledge sync indexes everything inside a
 * nominated folder as company knowledge, so a Phase 1 environmental report, a
 * USACE contract award and a set of acquisition patents were all sitting in the
 * corpus that grounds every fit assessment and widens every project-scoped
 * question. There was no way to re-file a document anywhere in the app — the
 * project documents tab's own tooltip said "Move it in Drive".
 *
 * ⚠ NOTHING HERE RE-EMBEDS. A stored vector is only meaningful against the
 * model and the width that produced it (§12) — but the TEXT has not changed, so
 * the existing vectors stay exactly as valid at their new address. Chunks are
 * RE-POINTED, never rebuilt. That is what keeps re-filing off the local model:
 * one document AI pass is 30–135s on a box that already swaps, so rebuilding
 * the 142 company documents would have been hours of contended GPU for no
 * change in the numbers.
 */

import { deleteDocumentChunks, repointChunksToProject, repointChunksToOpportunity } from './chunks'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

export type RefileTarget =
  | { kind: 'project'; id: string }
  | { kind: 'opportunity'; id: string }
  | { kind: 'steel_deal'; id: string }

type Db = SupabaseClient<Database>

export interface RefileResult {
  /** Where it went, for the activity line and the toast. */
  target: RefileTarget
  /** Chunks carried across. A count of 0 means the document was never indexed. */
  chunks: number
  /** True when the row moved tables (the opportunity path). */
  crossedTables: boolean
}

/** Columns the opportunity row inherits. */
interface SourceDoc {
  id: string
  storage_path: string
  file_name: string
  mime_type: string | null
  file_size_bytes: number | null
  doc_type: string | null
  ai_summary: string | null
  extracted_text: string | null
  embedding_status: string | null
  drive_file_id: string | null
  drive_modified_at: string | null
  drive_folder_path: string | null
  content_sha256: string | null
}

const SOURCE_COLUMNS =
  'id, storage_path, file_name, mime_type, file_size_bytes, doc_type, ai_summary, extracted_text, embedding_status, drive_file_id, drive_modified_at, drive_folder_path, content_sha256'

export async function refileDocument(
  supabase: Db,
  documentId: string,
  target: RefileTarget
): Promise<RefileResult> {
  const { data: raw, error: readErr } = await supabase
    .from('documents')
    .select(SOURCE_COLUMNS)
    .eq('id', documentId)
    .single()
  if (readErr || !raw) {
    throw new Error(readErr?.message ?? 'Document not found')
  }
  const doc: SourceDoc = raw

  // A project or a steel deal is a column on this same table, so the move is
  // one UPDATE and the storage object never moves. Clearing is_company is the
  // whole point: it is what takes the document out of the company corpus, and
  // it also makes the nightly Drive sync treat the file as owned elsewhere, so
  // it is never re-claimed as knowledge again.
  if (target.kind === 'project' || target.kind === 'steel_deal') {
    const patch =
      target.kind === 'project'
        ? { project_id: target.id, steel_deal_id: null, is_company: false }
        : { steel_deal_id: target.id, project_id: null, is_company: false }

    const { error } = await supabase.from('documents').update(patch).eq('id', documentId)
    if (error) throw new Error(`could not re-file document: ${error.message}`)

    const chunks = await repointChunksToProject(
      supabase,
      documentId,
      target.kind === 'project' ? target.id : null
    )
    return { target, chunks, crossedTables: false }
  }

  // An opportunity's documents live in their OWN TABLE, so this one crosses.
  // The storage object is deliberately NOT copied: storage_path is only a key
  // and both tables sign and remove by it verbatim, so re-using it avoids both
  // a needless copy and an orphaned object.
  const { data: inserted, error: insErr } = await supabase
    .from('opportunity_documents')
    .insert({
      opportunity_id: target.id,
      storage_path: doc.storage_path,
      file_name: doc.file_name,
      mime_type: doc.mime_type,
      file_size_bytes: doc.file_size_bytes,
      doc_type: doc.doc_type,
      ai_summary: doc.ai_summary,
      extracted_text: doc.extracted_text,
      embedding_status: doc.embedding_status,
      content_sha256: doc.content_sha256,
      // Carried so BOTH Drive importers recognise the file as owned here. The
      // company sync now reads this table for exactly that reason; without it
      // the file would be re-imported as knowledge on the next nightly run.
      drive_file_id: doc.drive_file_id,
      drive_modified_at: doc.drive_modified_at,
      drive_folder_path: doc.drive_folder_path,
    })
    .select('id')
    .single()
  if (insErr || !inserted) {
    throw new Error(`could not create the opportunity document: ${insErr?.message ?? 'insert failed'}`)
  }
  const newId = (inserted as { id: string }).id

  // ⚠ ORDER IS LOAD-BEARING. chunks.document_id is ON DELETE CASCADE, so
  // deleting the documents row first would destroy every vector this move
  // exists to preserve. Re-point, THEN delete.
  const chunks = await repointChunksToOpportunity(supabase, documentId, target.id, newId)

  const { error: delErr } = await supabase.from('documents').delete().eq('id', documentId)
  if (delErr) {
    // The chunks already point at the new row, so the document is filed and
    // answering questions. A stale source row is untidy, not broken — say so
    // rather than failing a move that has already happened.
    console.error(`[refile] ${documentId} copied to opportunity_documents but the source row remains:`, delErr.message)
  }

  return { target, chunks, crossedTables: true }
}

/**
 * "Not knowledge" — a filing decision, not a deletion.
 *
 * The ROW IS THE TOMBSTONE. Keeping it preserves drive_file_id, whose unique
 * index blocks a re-insert, and the sync skips an excluded row outright. Before
 * this existed neither delete nor retire survived the night: a delete was
 * re-imported (the sync's `known` map is built from existing rows only) and a
 * retire was actively un-retired by restoreDocument(). The chunks go, so the
 * file leaves retrieval immediately; the bytes stay, so the call is reversible.
 */
export async function excludeDocument(
  supabase: Db,
  documentId: string,
  reason: string
): Promise<{ chunks: number }> {
  const chunks = await deleteDocumentChunks(supabase, documentId)

  const { error } = await supabase
    .from('documents')
    .update({
      excluded_at: new Date().toISOString(),
      excluded_reason: reason,
    })
    .eq('id', documentId)
  if (error) throw new Error(`could not exclude document: ${error.message}`)

  return { chunks }
}

/**
 * "It is right where it is" — a decision, recorded.
 *
 * Changes nothing about the document. It exists because the unfiled queue is
 * COMPUTED from the records rather than stored, so a proposal the reader has
 * already rejected reappears on every page load until the rejection is written
 * down. A queue that cannot reach zero teaches people to accept rows to clear
 * them, which is the opposite of what a filing decision is for.
 */
export async function confirmDocumentFiling(
  supabase: Db,
  documentId: string,
  confirmed = true
): Promise<void> {
  const { error } = await supabase
    .from('documents')
    .update({ filing_confirmed_at: confirmed ? new Date().toISOString() : null })
    .eq('id', documentId)
  if (error) throw new Error(`could not record the filing decision: ${error.message}`)
}

/** Undo an exclusion. The next Drive sync re-indexes the file. */
export async function restoreExcludedDocument(supabase: Db, documentId: string): Promise<void> {
  const { error } = await supabase
    .from('documents')
    .update({ excluded_at: null, excluded_reason: null, embedding_status: 'pending' })
    .eq('id', documentId)
  if (error) throw new Error(`could not restore document: ${error.message}`)
}
