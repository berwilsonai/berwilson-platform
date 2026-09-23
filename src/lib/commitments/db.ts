/**
 * Commitment row types.
 *
 * Hand-maintained, like the rest of the sweep's tables: `npm run gen-types`
 * cannot run against this self-hosted stack (the Supabase CLI needs a DB host
 * reachable from both the host and its postgres-meta container, which Colima
 * does not provide), so `database.ts` does not know this table exists.
 */

export type CommitmentSide = 'us' | 'them'

/**
 * open      — outstanding as of the last reading of the thread.
 * resolved  — the model no longer sees it (automatic).
 * done      — a HUMAN settled it.
 * dismissed — a HUMAN rejected it as a bad read.
 *
 * The line between `resolved` and the two human states is load-bearing: one is
 * the machine changing its mind and may be rewritten on every sweep; the others
 * are a person's decision and must never be overwritten by one.
 */
export type CommitmentStatus = 'open' | 'resolved' | 'done' | 'dismissed'

/** Statuses a human set. Re-extraction must leave these completely alone. */
export const HUMAN_SETTLED: CommitmentStatus[] = ['done', 'dismissed']

export interface CommitmentRow {
  id: string
  thread_id: string
  item_key: string
  what: string
  side: CommitmentSide
  owner_name: string | null
  due_date: string | null
  status: CommitmentStatus
  confidence: number | null
  project_id: string | null
  opportunity_id: string | null
  settled_at: string | null
  settled_by: string | null
  created_at: string | null
  updated_at: string | null
}

/**
 * Stable identity for a commitment WITHIN its thread.
 *
 * Readable text rather than a hash, deliberately: when a row looks wrong the
 * key itself says which sentence produced it, and the table can be reasoned
 * about with psql alone.
 *
 * The trade-off is accepted and worth stating: if the model rewords an item
 * between runs the key changes, so the old row auto-resolves and a new one
 * appears. A reworded commitment surfacing once more is a small annoyance;
 * losing a human's "done" would not be, and that is the failure this shape
 * rules out.
 */
export function commitmentKey(what: string): string {
  return what
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}
