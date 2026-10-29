/**
 * The free-text filter behind a list the reader is looking AT.
 *
 * ⚠ EVERY WORD, ANYWHERE, IN ANY ORDER — never the whole phrase. §12: a keyword
 * search that only matches the phrase answers "nothing" where it means "not
 * adjacent", and the names in this platform are exactly the shape that provokes
 * it. `cleveland steelton` finds nothing against *Steelton — Cleveland-Cliffs
 * (PA)* under a substring test, and `grid edge` finds nothing against
 * *GridEdge*; both are what a person types.
 *
 * ⚠ AND IT IS AN AND, NOT AN OR, WHICH IS THE OPPOSITE OF THE RETRIEVAL RULE
 * BESIDE IT. The §12 rule about falling back to any-word governs a corpus
 * search, where the alternative to a loose match is the answer "nothing exists"
 * about something that does. Here the reader can SEE the list and is narrowing
 * it: a filter that widens as you type more is one that never converges.
 *
 * Not a fuzzy match and deliberately not ranked. A filter over a list already
 * on screen either keeps a row or does not; scoring would reorder a queue whose
 * order carries meaning.
 */

/** The query's words, folded. Empty means "no filter". */
export function searchWords(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean)
}

/**
 * Does this text contain every word of the query?
 *
 * `words` is passed in rather than the raw query so a caller filtering a list
 * splits once instead of once per row.
 */
export function matchesWords(text: string, words: string[]): boolean {
  if (words.length === 0) return true
  const hay = text.toLowerCase()
  return words.every((w) => hay.includes(w))
}

/**
 * Filter a list by a query, over whatever text each row chooses to expose.
 *
 * The `haystack` callback is the row's decision about what it is searchable BY
 * — a record picker offers the name, a decision queue offers the title, the
 * subtitle, the model's note and the deal each button would file onto. Nothing
 * here guesses at an object's shape.
 */
export function filterByWords<T>(
  rows: T[],
  query: string,
  haystack: (row: T) => string
): T[] {
  const words = searchWords(query)
  if (words.length === 0) return rows
  return rows.filter((row) => matchesWords(haystack(row), words))
}
