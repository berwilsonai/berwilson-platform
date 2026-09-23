/**
 * Safe construction of PostgREST `.or()` filters.
 *
 * `.or()` takes a LOGIC TREE, not a list of values: PostgREST parses the string
 * and treats `,` as the separator between conditions and `(` `)` as grouping.
 * So a user's search term containing either character is read as more filter
 * structure and the whole query fails with `failed to parse logic tree` —
 * which the callers surface as "no results" rather than as an error.
 *
 * Two defences, both needed:
 *   1. Quote the value, so a comma inside it is a comma and not a separator.
 *   2. Strip the characters a quoted value still cannot carry safely
 *      (quotes themselves, parentheses, backslash), because there is no
 *      escaping syntax to fall back on.
 *
 * This has now been fixed one site at a time three times — `search_email_threads`
 * (2026-08-28) and the thread-link scan before it — so it lives in one place.
 * Build every `.or()` whose value comes from user or model input through here.
 */

/** Strip what a PostgREST logic tree cannot carry, even inside quotes. */
export function sanitizeFilterTerm(term: string): string {
  return term.replace(/[(),."'\\*]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Build an `ilike` OR filter across `columns` for `term`.
 *
 * Returns null when nothing usable survives sanitizing — callers should skip
 * the filter entirely rather than send an empty logic tree.
 */
export function orIlike(columns: readonly string[], term: string): string | null {
  const safe = sanitizeFilterTerm(term)
  if (!safe) return null
  return columns.map((c) => `${c}.ilike."%${safe}%"`).join(',')
}

/**
 * Build an `ilike` OR filter across `columns` for EVERY word in `term`
 * (a row matching any word in any column is a hit).
 */
export function orIlikeAnyWord(columns: readonly string[], term: string, maxWords = 3): string | null {
  const words = sanitizeFilterTerm(term).split(' ').filter(Boolean).slice(0, maxWords)
  if (words.length === 0) return null
  return words.flatMap((w) => columns.map((c) => `${c}.ilike."%${w}%"`)).join(',')
}
