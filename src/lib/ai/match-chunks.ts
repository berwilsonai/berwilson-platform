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

export interface MatchChunksArgs {
  query_embedding: string
  filter_project_ids: string[]
  filter_after: string
  match_count: number
  filter_entity_ids: string[]
  filter_include_company: boolean
}

type Admin = SupabaseClient<Database>

export async function matchChunks(client: Admin, args: MatchChunksArgs) {
  const result = await client.rpc('match_chunks', args)

  // PGRST202 = function with this argument set not found in the schema cache,
  // i.e. the migration adding filter_include_company hasn't run yet.
  const missingNewArg =
    result.error &&
    (result.error.code === 'PGRST202' ||
      /filter_include_company/i.test(result.error.message ?? ''))

  if (missingNewArg) {
    return client.rpc('match_chunks', {
      query_embedding: args.query_embedding,
      filter_project_ids: args.filter_project_ids,
      filter_after: args.filter_after,
      match_count: args.match_count,
      filter_entity_ids: args.filter_entity_ids,
    })
  }

  return result
}
