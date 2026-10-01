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
import { createAdminClient } from '@/lib/supabase/admin'
import { confidentialProjectIds } from '@/lib/security/confidential'
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
  /**
   * Confidential projects to keep out of the result (migration
   * 20260930000012). Set by matchChunks itself — callers pass
   * `unlockedProjectIds` instead and never this.
   */
  filter_exclude_project_ids?: string[]
}

export interface MatchChunksOptions {
  /**
   * Confidential projects the CALLER has cleared with a step-up.
   *
   * Omitted — which is what the agent, the daily brief, Pepper's note and every
   * other portfolio-wide caller do — means none, so every confidential project
   * is excluded. That default is the whole point: a new caller gets the safe
   * behaviour without having to know this exists.
   */
  unlockedProjectIds?: readonly string[]
}

type Admin = SupabaseClient<Database>

export async function matchChunks(
  client: Admin,
  args: MatchChunksArgs,
  options?: MatchChunksOptions
) {
  // ── Confidential projects ──────────────────────────────────────────────────
  //
  // The exclusion is applied HERE rather than at each of the five call sites,
  // because this is the only place every one of them passes through. A caller
  // that forgets a filter gets a leak with no error anywhere; a caller that
  // forgets `unlockedProjectIds` only gets fewer results, which is the failure
  // worth having.
  //
  // It must be done in SQL, not after: the RPC's LIMIT is applied before any
  // post-filter, so twenty confidential passages at the top of the ranking
  // would return an empty answer rather than the next twenty real ones.
  const unlocked = new Set(options?.unlockedProjectIds ?? [])
  const confidential = await confidentialProjectIds()
  const exclude =
    confidential === null
      ? await allProjectIdsForExclusion() // fail closed: could not read the set
      : confidential.filter((id) => !unlocked.has(id))

  // Ask for more than the caller wants so identical passages can be collapsed
  // without costing them results. This corpus holds the same document twice
  // whenever a file arrives both as an email attachment and from the team's
  // Drive folder, and a duplicate spends a retrieval slot saying nothing new.
  const wanted = args.match_count
  const overfetched: MatchChunksArgs = {
    ...args,
    match_count: wanted * DEDUPE_OVERFETCH,
    filter_exclude_project_ids: exclude,
  }
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
    // ⚠ The legacy signature has no exclusion argument, so this path would
    // otherwise FAIL OPEN on the one thing that must not. The post-filter below
    // is what makes the guarantee a property of this function rather than of
    // whether the migration happens to be applied.
    if (exclude.length) {
      console.warn('[match-chunks] legacy RPC signature — excluding confidential projects in app code')
    }
    return collapse(legacy, wanted, exclude)
  }

  return collapse(result, wanted, exclude)
}

/**
 * Every project id, for the fail-closed path when the confidential set could
 * not be read. If this fails too the database is not answering, and the RPC
 * about to run is going to fail for the same reason.
 */
async function allProjectIdsForExclusion(): Promise<string[]> {
  const { data, error } = await createAdminClient().from('projects').select('id')
  if (error) {
    console.error('[match-chunks] could not enumerate projects while failing closed:', error.message)
    return []
  }
  return (data ?? []).map((r) => r.id)
}

/**
 * Drop repeated passages and trim back to what the caller asked for.
 *
 * An error result passes through untouched — callers branch on `error`, and
 * rewriting `data` on a failed call would turn a database error into an empty
 * answer, which reads as "nothing matched".
 */
function collapse<T extends { data: unknown; error: unknown }>(
  result: T,
  wanted: number,
  exclude: readonly string[]
): T {
  if (result.error || !Array.isArray(result.data)) return result
  const rows = result.data as Array<{ content?: string | null; project_id?: string | null }>
  // Belt and braces over the SQL filter. Costs one pass over at most a few
  // hundred rows and means a rolled-back migration, a stale schema cache or a
  // future edit to the RPC cannot turn this into a disclosure.
  const excluded = new Set(exclude)
  const safe = excluded.size
    ? rows.filter((r) => !r.project_id || !excluded.has(r.project_id))
    : rows
  return {
    ...result,
    data: dedupeByContent(safe, (r) => r.content ?? '', wanted),
  }
}
