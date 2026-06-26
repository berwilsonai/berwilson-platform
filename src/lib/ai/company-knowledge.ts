import { createAdminClient } from '@/lib/supabase/admin'
import { embedQuery } from './embeddings'
import { matchChunks } from './match-chunks'

/**
 * Retrieval over the Ber Wilson company knowledge base — the `is_company`
 * chunks fed from /company (capability statements, past performance, resumes,
 * credentials, safety record).
 *
 * Company chunks carry no project_id, so match_chunks with an empty project
 * filter would also return project/vendor chunks. To get company-ONLY results
 * we pass a sentinel project filter that matches no real project and turn on
 * filter_include_company — the RPC's WHERE then reduces to "company chunks
 * only" while keeping full vector ordering + the whole match_count budget.
 */

// A UUID no project will ever have (projects use gen_random_uuid()).
const NO_PROJECT_SENTINEL = '00000000-0000-0000-0000-000000000000'

export interface CompanyKnowledgeSnippet {
  content: string
  similarity: number
}

/**
 * Semantic search of the company knowledge base. Returns [] when nothing is
 * indexed yet (the common case until docs are uploaded) — callers treat the
 * evidence as optional and degrade gracefully.
 */
export async function getCompanyKnowledge(
  query: string,
  limit = 6,
): Promise<CompanyKnowledgeSnippet[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  let embedding: number[]
  try {
    embedding = await embedQuery(trimmed)
  } catch (err) {
    console.error('[company-knowledge] embed failed:', err)
    return []
  }

  const supabase = createAdminClient()
  const { data, error } = await matchChunks(supabase, {
    query_embedding: `[${embedding.join(',')}]`,
    filter_project_ids: [NO_PROJECT_SENTINEL],
    filter_after: '2000-01-01T00:00:00.000Z',
    match_count: limit,
    filter_entity_ids: [],
    filter_include_company: true,
  })

  if (error) {
    console.error('[company-knowledge] match_chunks failed:', error.message)
    return []
  }

  return (data ?? [])
    .filter((c: { is_company?: boolean }) => c.is_company)
    .map((c: { content: string; similarity: number }) => ({
      content: c.content,
      similarity: c.similarity,
    }))
}

/**
 * Format retrieved snippets as a prompt-ready markdown block, or null when the
 * knowledge base has no relevant material yet.
 */
export function formatCompanyKnowledge(snippets: CompanyKnowledgeSnippet[]): string | null {
  if (snippets.length === 0) return null
  const lines = snippets.map(
    (s, i) => `${i + 1}. ${s.content.trim().slice(0, 700)}`,
  )
  return [
    '### RELEVANT BER WILSON EVIDENCE (from the company knowledge base)',
    'Cite this real past-performance / capability material where it supports or undercuts the fit.',
    ...lines,
  ].join('\n')
}
