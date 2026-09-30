/**
 * Re-pointing a document's chunks at a new owner.
 *
 * The embeddings themselves are untouched. A vector is only meaningful against
 * the model and the width that produced it (§12) — and neither changes when a
 * document is re-filed, because the TEXT does not change. So the honest
 * operation is an UPDATE of the scope columns, not a re-embed: it is instant,
 * needs no model, and is exact rather than approximately-the-same.
 *
 * Counts are read BEFORE the update rather than from a returning clause:
 * PostgREST truncates a returned representation at 1000 rows silently (§12), so
 * `.select()` on a large document would under-report the move it just made.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

type Db = SupabaseClient<Database>

async function countChunks(supabase: Db, documentId: string): Promise<number> {
  const { count, error } = await supabase
    .from('chunks')
    .select('id', { count: 'exact', head: true })
    .eq('document_id', documentId)
  if (error) throw new Error(`could not count chunks: ${error.message}`)
  return count ?? 0
}

/**
 * Carry a document's chunks onto a project (or off the company corpus with no
 * project, for a steel deal — `chunks` has no steel_deal_id column, so the deal
 * keeps its document and the passage simply stops being company evidence).
 */
export async function repointChunksToProject(
  supabase: Db,
  documentId: string,
  projectId: string | null
): Promise<number> {
  const total = await countChunks(supabase, documentId)
  if (total === 0) return 0

  const { error } = await supabase
    .from('chunks')
    .update({ project_id: projectId, is_company: false })
    .eq('document_id', documentId)
  if (error) throw new Error(`could not re-point chunks: ${error.message}`)

  return total
}

/**
 * Carry a document's chunks onto an opportunity document.
 *
 * `document_id` MUST be cleared: it is ON DELETE CASCADE, so leaving it set
 * would have the caller's subsequent delete of the source row destroy every
 * vector. `chunks_source_check` is satisfied by opportunity_id. `source_type`
 * matches what insertOpportunityChunks writes, so these rows are
 * indistinguishable from natively-embedded ones.
 */
export async function repointChunksToOpportunity(
  supabase: Db,
  documentId: string,
  opportunityId: string,
  opportunityDocumentId: string
): Promise<number> {
  const total = await countChunks(supabase, documentId)
  if (total === 0) return 0

  const { error } = await supabase
    .from('chunks')
    .update({
      document_id: null,
      project_id: null,
      is_company: false,
      opportunity_id: opportunityId,
      opportunity_document_id: opportunityDocumentId,
      source_type: 'opportunity_document',
    })
    .eq('document_id', documentId)
  if (error) throw new Error(`could not re-point chunks: ${error.message}`)

  return total
}

/** Drop a document's chunks so it leaves retrieval. The file itself stays. */
export async function deleteDocumentChunks(supabase: Db, documentId: string): Promise<number> {
  const total = await countChunks(supabase, documentId)
  if (total === 0) return 0

  const { error } = await supabase.from('chunks').delete().eq('document_id', documentId)
  if (error) throw new Error(`could not remove chunks: ${error.message}`)

  return total
}
