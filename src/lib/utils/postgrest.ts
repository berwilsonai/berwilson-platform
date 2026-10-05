/**
 * Safe construction of PostgREST `.or()` filters.
 *
 * `.or()` takes a LOGIC TREE, not a list of values: PostgREST parses the string
 * and treats `,` as the separator between conditions and `(` `)` as grouping.
 * So a user's search term containing either character is read as more filter
 * structure and the whole query fails with `failed to parse logic tree` —
 * which the callers surface as "no results" rather than as an error.
 *
 * This has now been fixed one site at a time three times — `search_email_threads`
 * (2026-08-28) and the thread-link scan before it — so it lives in one place.
 * Build every `.or()` whose value comes from user or model input through here.
 *
 * ⚠ QUOTING IS THE DEFENCE; STRIPPING IS NOT. Measured against live PostgREST
 * 2026-10-05, a DOUBLE-QUOTED value carries `( ) , . ' / &` as plain text —
 * `name.ilike."%IAN (EMP)%"` matches, and a comma inside the quotes stays a
 * comma (the same filter unquoted answers PGRST100). Only three characters
 * genuinely cannot survive: `"` ends the quote, `\` escapes, and `*` is
 * PostgREST's own wildcard. This function used to strip parentheses and
 * periods too, and that cost real matches rather than widening them:
 * `Arthur P. Valencia`, `Paul Hunsaker (Vancon Inc.)` and `PrivateLenders.com`
 * are all live `parties` rows that could not be found by their own exact names.
 */

/**
 * Strip only what a DOUBLE-QUOTED PostgREST value cannot carry.
 *
 * Everything else is left alone on purpose — see the note above. The result is
 * only ever safe inside quotes, which is what `orIlike` builds.
 */
export function sanitizeFilterTerm(term: string): string {
  return term.replace(/["\\*]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Split a term into words for MATCHING and RANKING, not for a phrase filter.
 *
 * Punctuation goes here, where `orIlike` keeps it: a word carrying a trailing
 * comma matches nothing, and `hay.includes('commitment,')` is false for text
 * that says "commitment". Kept separate from `sanitizeFilterTerm` so the
 * phrase search can stay exact while the word search stays forgiving.
 */
export function filterWords(term: string, maxWords = 3): string[] {
  return term
    .replace(/[(),."'\\*/&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, maxWords)
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
  const words = filterWords(term, maxWords)
  if (words.length === 0) return null
  return words.flatMap((w) => columns.map((c) => `${c}.ilike."%${w}%"`)).join(',')
}
