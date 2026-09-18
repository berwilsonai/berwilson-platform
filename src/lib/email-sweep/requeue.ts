/**
 * Re-queue stored mail for routing when a record gains a new alias.
 *
 * The router only examines threads with `routed_at` null — a deliberate
 * frontier, or it would re-read the newest page forever. The cost of that
 * frontier is that an alias added TODAY says nothing about mail routed LAST
 * MONTH: the 2026-09-18 Stockton pass had to re-run the router by hand to pull
 * the mayor's reply onto the record. This helper is that manual step made
 * automatic — clear the frontier marker on exactly the threads the new alias
 * could now match, and the hourly sweep's route phase re-examines them in its
 * normal batches.
 *
 * Matching here is a coarse ilike prefilter, not the router's scoring: it only
 * decides which threads are WORTH re-scoring, so a false positive costs one
 * wasted comparison and a false negative is impossible for any thread the
 * router itself could match (the router requires every alias token to appear,
 * which implies the alias text appears somewhere in the subject or deal name).
 */
import { sweepDb } from './db'

/** PostgREST ilike patterns treat %, _ and \ as syntax; the alias is literal text. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`)
}

export async function requeueThreadsForAliases(aliases: string[]): Promise<number> {
  const cleaned = [...new Set(aliases.map((a) => a.trim()).filter((a) => a.length >= 3))]
  if (cleaned.length === 0) return 0

  const db = sweepDb()
  let requeued = 0
  for (const alias of cleaned) {
    const pattern = `%${escapeLike(alias)}%`
    // Subject and the summarizer's deal name are the two fields the router
    // scores; one update per field keeps the filters simple enough that an
    // alias containing commas or parens can never be parsed as query syntax.
    for (const column of ['subject', 'summary->>deal_name'] as const) {
      const { data, error } = await db
        .from('email_threads')
        .update({ routed_at: null })
        .eq('summary_state', 'summarized')
        .not('routed_at', 'is', null)
        .ilike(column, pattern)
        .select('id')
      if (error) {
        // Requeueing is a convenience on top of a save that already succeeded;
        // surfacing it as a failure would read as "the record did not save".
        console.error(`[requeue] alias "${alias}" on ${column}: ${error.message}`)
        continue
      }
      requeued += data?.length ?? 0
    }
  }
  return requeued
}
