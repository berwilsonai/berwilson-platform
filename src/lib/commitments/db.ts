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
 */
export function commitmentKey(what: string): string {
  return what
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

/**
 * Words that carry no identity. Dropped before comparing two phrasings so that
 * "the october 1 briefing" and "the oct 1 briefing" are recognisably the same
 * obligation.
 */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'for', 'of', 'on', 'in', 'at', 'by', 'and', 'or',
  'with', 'from', 'is', 'be', 'will', 'please', 'their', 'our', 'your', 'his',
  'her', 'its', 'this', 'that', 'these', 'those',
])

/** Month names collapse to their number so "october 1" ≡ "oct 1". */
const MONTHS: Record<string, string> = {
  jan: '1', january: '1', feb: '2', february: '2', mar: '3', march: '3',
  apr: '4', april: '4', may: '5', jun: '6', june: '6', jul: '7', july: '7',
  aug: '8', august: '8', sep: '9', sept: '9', september: '9', oct: '10',
  october: '10', nov: '11', november: '11', dec: '12', december: '12',
}

function tokens(what: string): Set<string> {
  return new Set(
    commitmentKey(what)
      .split(' ')
      .map((t) => MONTHS[t] ?? t)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t))
  )
}

/**
 * How alike two phrasings of an obligation are, 0-1.
 *
 * OVERLAP COEFFICIENT, not Jaccard — the same choice the thread router makes
 * and for the same reason: Jaccard punishes a longer phrasing for being longer,
 * so "complete the delegation group preference survey" and "complete the group
 * preference survey" would score far apart despite plainly being one thing.
 */
export function commitmentSimilarity(a: string, b: string): number {
  const ta = tokens(a)
  const tb = tokens(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let shared = 0
  for (const t of ta) if (tb.has(t)) shared++
  return shared / Math.min(ta.size, tb.size)
}

/**
 * Above this, two phrasings are treated as the SAME commitment.
 *
 * ⚠ THIS EXISTS BECAUSE EXACT-KEY MATCHING FAILED IMMEDIATELY IN PRACTICE.
 * Measured on the first real re-extraction: a thread re-read minutes later
 * produced "oct 1" for "october 1" and dropped the word "delegation", so both
 * of its commitments auto-resolved and reappeared as new rows. Left unfixed,
 * every hourly sweep would churn the whole ledger and reset each item's
 * outstanding age — which is precisely the signal a follow-up list is for.
 *
 * 0.6 rather than higher: the failure it guards against (a duplicate pair, and
 * a lost age) is worse than the failure it risks (two genuinely different
 * obligations on ONE thread being merged), and the candidate set is only ever
 * the handful of commitments already on that same thread.
 */
export const COMMITMENT_MATCH_THRESHOLD = 0.6
