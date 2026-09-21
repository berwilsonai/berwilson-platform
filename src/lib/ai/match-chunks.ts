/**
 * Resilient wrapper around the match_chunks RPC.
 *
 * The `filter_include_company` argument + `is_company` column only exist after
 * migration 20260625000002. To keep retrieval working in the window between a
 * code deploy and the DB migration (a zero-downtime concern), we call with the
 * new argument and, if the live function doesn't accept it yet, transparently
 * retry against the older signature. Once the migration is applied the first
 * call succeeds and the company knowledge base unions in automatically.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { dedupeByContent, DEDUPE_OVERFETCH } from './dedupe'

export interface MatchChunksArgs {
  query_embedding: string
  filter_project_ids: string[]
  filter_after: string
  match_count: number
  filter_entity_ids: string[]
  filter_include_company: boolean
  /** Scope to one or more opportunities (migration 20260919000001). */
  filter_opportunity_ids?: string[]
  /**
   * Search ONLY the Ber Wilson knowledge base, excluding project and deal
   * material. `filter_include_company` cannot express this: it is an OR branch
   * that widens a project-scoped search, so with an empty project filter it is
   * a no-op and the search covers the whole table.
   */
  filter_company_only?: boolean
}

type Admin = SupabaseClient<Database>

export async function matchChunks(client: Admin, args: MatchChunksArgs) {
  // Ask for more than the caller wants so identical passages can be collapsed
  // without costing them results. This corpus holds the same document twice
  // whenever a file arrives both as an email attachment and from the team's
  // Drive folder, and a duplicate spends a retrieval slot saying nothing new.
  const wanted = args.match_count
  const overfetched: MatchChunksArgs = { ...args, match_count: wanted * DEDUPE_OVERFETCH }
  const result = await client.rpc('match_chunks', overfetched)

  // PGRST202 = function with this argument set not found in the schema cache,
  // i.e. a migration adding one of the newer arguments hasn't run yet. Retry
  // against the older signature so retrieval keeps working in the window
  // between a code deploy and the DB migration.
  const missingNewArg =
    result.error &&
    (result.error.code === 'PGRST202' ||
      /filter_include_company|filter_opportunity_ids|filter_company_only/i.test(
        result.error.message ?? ''
      ))

  if (missingNewArg) {
    const legacy = await client.rpc('match_chunks', {
      query_embedding: overfetched.query_embedding,
      filter_project_ids: overfetched.filter_project_ids,
      filter_after: overfetched.filter_after,
      match_count: overfetched.match_count,
      filter_entity_ids: overfetched.filter_entity_ids,
    })
    return collapse(legacy, wanted)
  }

  return collapse(result, wanted)
}

/**
 * Drop repeated passages and trim back to what the caller asked for.
 *
 * An error result passes through untouched — callers branch on `error`, and
 * rewriting `data` on a failed call would turn a database error into an empty
 * answer, which reads as "nothing matched".
 */
function collapse<T extends { data: unknown; error: unknown }>(result: T, wanted: number): T {
  if (result.error || !Array.isArray(result.data)) return result
  const rows = result.data as Array<{ content?: string | null }>
  return {
    ...result,
    data: dedupeByContent(rows, (r) => r.content ?? '', wanted),
  }
}
