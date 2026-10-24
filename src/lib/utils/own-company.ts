/**
 * "Is this string OUR OWN company?" — one home for a question three modules ask.
 *
 * ⚠ IT LIVED AS A PRIVATE REGEX IN `meet-import.ts`, where it kept Ber Wilson
 * off the list of deals a meeting title could name. The attendee findings queue
 * needs the identical answer for a different reason — measured 2026-10-23, the
 * model put "Ber Wilson" in the person-shaped `attendees` field on FIVE of the
 * eighteen recorded meetings, so offering "create a contact" for every unmatched
 * attendee would have offered to make our own company a person five times.
 *
 * §12: a predicate transcribed into its readers has a home per reader, and the
 * one that lies to you is found last. One home, and both readers select from it.
 *
 * "Bear Wilson" is a standing misspelling in correspondence and in the
 * transcripts themselves, so both forms answer true.
 */

const OWN_COMPANY_NAME = /^(ber|bear)\s*wilson$/i

/**
 * True when the whole string is our own company's name.
 *
 * ⚠ ANCHORED, AND THAT IS THE POINT. A containment test would convict
 * "Ber Wilson Lead" and "Ber Wilson Executive Team" — both of which really do
 * appear in the attendee lists — and those are LABELS rather than the company,
 * so they belong in the `not_a_person` bucket with their own reason rather than
 * being silently folded into this one.
 */
export function isOwnCompanyName(value: string | null | undefined): boolean {
  if (!value) return false
  return OWN_COMPANY_NAME.test(value.trim())
}

/**
 * True when the string STARTS with our own company's name — "Ber Wilson",
 * "Ber Wilson Lead", "Ber Wilson Executive Team".
 *
 * Kept apart from the exact test because the two callers want different things:
 * filing wants "never the company itself", and the findings queue wants "this
 * whole family of strings is never a person".
 */
export function namesOwnCompany(value: string | null | undefined): boolean {
  if (!value) return false
  return /^(ber|bear)\s*wilson\b/i.test(value.trim())
}
