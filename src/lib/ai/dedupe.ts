/**
 * Collapse retrieval hits that carry the same text.
 *
 * The same passage genuinely exists several times in this corpus, for reasons
 * that are not going away: a proposal arrives as an email attachment and again
 * from the team's Drive folder, and a quoted reply chain repeats the message it
 * is replying to in every subsequent mail. Measured on live data — 262 exactly
 * duplicated rows in `chunks`, 964 in `thread_chunks` (17% of the table).
 *
 * The cost is not storage, it is retrieval slots. Asked for the status of the
 * Stockton Power Nexus, the top six chunks held the same passage twice at 0.658
 * and again twice at 0.642 — four of six slots spent on two documents, pushing
 * out four other sources the answer needed. A model reading the same paragraph
 * twice also reads it as corroboration, which it is not.
 *
 * So: over-fetch, collapse, then trim. Cleaning the underlying rows is the other
 * half (`scripts/dedupe-documents.mts`), but that can only ever fix the
 * duplicates that exist today; this holds for the ones that arrive tomorrow.
 */

/** How many extra rows to ask the index for so there is something to collapse into. */
export const DEDUPE_OVERFETCH = 2

/**
 * Whitespace and case are not meaning. Two copies of a PDF extracted on
 * different days differ by line wrapping alone, and comparing raw strings would
 * call them distinct.
 */
export function normalizeForDedupe(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Keep the first occurrence of each distinct passage, in the order given.
 *
 * Callers pass results already sorted best-first, so "first" is "highest
 * scoring" — the copy kept is the one the index liked most, and its metadata
 * (which document, which thread) is the one cited.
 */
export function dedupeByContent<T>(
  items: T[],
  getContent: (item: T) => string,
  limit?: number
): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    const key = normalizeForDedupe(getContent(item))
    // An empty passage carries no text to compare, so it cannot be judged a
    // duplicate of anything — drop it rather than let one silently swallow
    // every other empty one.
    if (key.length === 0) continue
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
    if (limit !== undefined && out.length >= limit) break
  }
  return out
}
