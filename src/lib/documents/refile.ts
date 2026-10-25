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

import {
  deleteDocumentChunks,
  deleteOpportunityDocumentChunks,
  repointChunksToProject,
  repointChunksToOpportunity,
  repointOpportunityChunksToOpportunity,
  repointOpportunityChunksToProject,
} from './chunks'
import { invalidateDecideDocumentCounts } from '@/lib/decide/count'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

export type RefileTarget =
  | { kind: 'project'; id: string }
  | { kind: 'opportunity'; id: string }
  | { kind: 'steel_deal'; id: string }

type Db = SupabaseClient<Database>

/**
 * Which table the document being moved lives in.
 *
 * ⚠ DEFAULTS TO `documents`, so every caller written before the opportunity
 * side existed keeps its exact behaviour. The parameter exists because a
 * filing queue over both tables was built and the opportunity half of it would
 * have thrown "Document not found" on press: all three operations below read
 * `documents` by name, and an opportunity's documents are their own table.
 */
export type DocumentSource = 'documents' | 'opportunity_documents'

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
  target: RefileTarget,
  source: DocumentSource = 'documents'
): Promise<RefileResult> {
  // ⚠ AT THE CHOKE POINT, NOT AT EACH CALLER. The Decide badge caches the two
  // document matcher passes for 60s because it renders in the root layout
  // (see src/lib/decide/count.ts); without this, filing a document from
  // /decide left the sidebar claiming it was still waiting. Here rather than
  // in the route because `meeting-intake/confirm` also refiles, and a cache
  // that is only invalidated by the door somebody remembered is the failure
  // §12 describes — forgetting to opt in costs the correctness of the number.
  // Invalidated at ENTRY: an invalidation that only runs on success would be
  // skipped by the partial writes these functions can leave behind on a throw.
  invalidateDecideDocumentCounts()
  if (source === 'opportunity_documents') {
    return refileOpportunityDocument(supabase, documentId, target)
  }
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
    // ⚠ `is_reference` IS CLEARED TOO, AND LEAVING IT SET WAS A REAL LEAK. The
    // /intake page lists `is_reference = true` as the reference shelf, so a
    // document moved onto a deal while still flagged would sit on the project
    // AND on that shelf at once — present twice, owned once. It matters now
    // that the Meet importer files every unmatched transcript as reference and
    // the confirm step moves it: that is the common path, not an edge case.
    const patch =
      target.kind === 'project'
        // ⚠ `awaiting_filing` IS CLEARED HERE OR THE QUEUE CANNOT REACH ZERO.
        // It is the one positive discriminator /decide's unparented class reads
        // (20261025000012), so a document filed onto a deal while still
        // carrying it would sit on the record AND keep offering itself for
        // filing forever — the same leak `is_reference` had on the line above,
        // for the same reason, which is why they are cleared together.
        ? {
            project_id: target.id,
            steel_deal_id: null,
            is_company: false,
            is_reference: false,
            awaiting_filing: false,
          }
        : {
            steel_deal_id: target.id,
            project_id: null,
            is_company: false,
            is_reference: false,
            awaiting_filing: false,
          }

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
 * Move a document that lives in `opportunity_documents`.
 *
 * The mirror of the function above, and it crosses tables in the opposite
 * direction. Both halves exist for one reason: two deals genuinely swap
 * paperwork — the Alaska Strategic Materials JV brief sat on the Alaska Golden
 * Summit opportunity while a True North ore report sat on the JV project — so
 * "which table is it in" is not a property of the problem, only of the row.
 *
 * ⚠ ORDER IS LOAD-BEARING IN THE CROSSING CASE, exactly as it is going the
 * other way. `chunks.opportunity_document_id` is ON DELETE CASCADE, so deleting
 * the source row first would destroy every vector the move exists to preserve.
 * Re-point, THEN delete.
 */
async function refileOpportunityDocument(
  supabase: Db,
  documentId: string,
  target: RefileTarget
): Promise<RefileResult> {
  const { data: raw, error: readErr } = await supabase
    .from('opportunity_documents')
    .select(SOURCE_COLUMNS)
    .eq('id', documentId)
    .single()
  if (readErr || !raw) {
    throw new Error(readErr?.message ?? 'Document not found')
  }
  const doc: SourceDoc = raw

  // Staying in the same table: one UPDATE, and the storage object never moves.
  if (target.kind === 'opportunity') {
    const { error } = await supabase
      .from('opportunity_documents')
      .update({ opportunity_id: target.id })
      .eq('id', documentId)
    if (error) throw new Error(`could not re-file document: ${error.message}`)

    const chunks = await repointOpportunityChunksToOpportunity(supabase, documentId, target.id)
    return { target, chunks, crossedTables: false }
  }

  // A project or a steel deal lives on `documents`, so the row crosses. The
  // storage object is deliberately NOT copied: storage_path is only a key and
  // both tables sign and remove by it verbatim, so re-using it avoids both a
  // needless copy and an orphaned object.
  const { data: inserted, error: insErr } = await supabase
    .from('documents')
    .insert({
      project_id: target.kind === 'project' ? target.id : null,
      steel_deal_id: target.kind === 'steel_deal' ? target.id : null,
      storage_path: doc.storage_path,
      file_name: doc.file_name,
      mime_type: doc.mime_type,
      file_size_bytes: doc.file_size_bytes,
      doc_type: doc.doc_type,
      ai_summary: doc.ai_summary,
      extracted_text: doc.extracted_text,
      embedding_status: doc.embedding_status,
      content_sha256: doc.content_sha256,
      // Carried so BOTH Drive importers recognise the file as owned here;
      // without it the file looks new and is re-imported as knowledge on the
      // next nightly run.
      drive_file_id: doc.drive_file_id,
      drive_modified_at: doc.drive_modified_at,
      drive_folder_path: doc.drive_folder_path,
    })
    .select('id')
    .single()
  if (insErr || !inserted) {
    throw new Error(`could not create the document: ${insErr?.message ?? 'insert failed'}`)
  }
  const newId = (inserted as { id: string }).id

  const chunks = await repointOpportunityChunksToProject(
    supabase,
    documentId,
    newId,
    target.kind === 'project' ? target.id : null
  )

  const { error: delErr } = await supabase
    .from('opportunity_documents')
    .delete()
    .eq('id', documentId)
  if (delErr) {
    // The chunks already point at the new row, so the document is filed and
    // answering questions. A stale source row is untidy, not broken — say so
    // rather than failing a move that has already happened.
    console.error(
      `[refile] ${documentId} copied to documents but the source row remains:`,
      delErr.message
    )
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
  reason: string,
  source: DocumentSource = 'documents'
): Promise<{ chunks: number }> {
  invalidateDecideDocumentCounts()
  const patch = { excluded_at: new Date().toISOString(), excluded_reason: reason }

  // Branched rather than parameterised by table name: a union of table names
  // makes the column filter a union too, which the typed client cannot check,
  // and this repo is at zero `any` escapes.
  if (source === 'opportunity_documents') {
    const chunks = await deleteOpportunityDocumentChunks(supabase, documentId)
    const { error } = await supabase
      .from('opportunity_documents')
      .update(patch)
      .eq('id', documentId)
    if (error) throw new Error(`could not exclude document: ${error.message}`)
    return { chunks }
  }

  const chunks = await deleteDocumentChunks(supabase, documentId)
  // ⚠ `awaiting_filing` IS CLEARED ONLY ON THIS SIDE, AND NOT BECAUSE OF A
  // POLICY DIFFERENCE — `opportunity_documents` has no such column, and the
  // typed client's excess-property check refused the shared patch when it was
  // written there. That refusal was right: a tombstone that still claims to be
  // awaiting a filing decision is a lie, and the lie only exists on the table
  // that can hold the flag.
  const { error } = await supabase
    .from('documents')
    .update({ ...patch, awaiting_filing: false })
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
  confirmed = true,
  source: DocumentSource = 'documents'
): Promise<void> {
  invalidateDecideDocumentCounts()
  const patch = { filing_confirmed_at: confirmed ? new Date().toISOString() : null }
  const { error } =
    source === 'opportunity_documents'
      ? await supabase.from('opportunity_documents').update(patch).eq('id', documentId)
      : await supabase.from('documents').update(patch).eq('id', documentId)
  if (error) throw new Error(`could not record the filing decision: ${error.message}`)
}

/** Undo an exclusion. The next Drive sync re-indexes the file. */
export async function restoreExcludedDocument(supabase: Db, documentId: string): Promise<void> {
  invalidateDecideDocumentCounts()
  const { error } = await supabase
    .from('documents')
    .update({ excluded_at: null, excluded_reason: null, embedding_status: 'pending' })
    .eq('id', documentId)
  if (error) throw new Error(`could not restore document: ${error.message}`)
}
