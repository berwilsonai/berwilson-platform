/**
 * The guard on text that LEAVES the box.
 *
 * ⚠ WHY THIS EXISTS. §2 and §5 of CLAUDE.md both state that web research sends
 * "only the search query ... never platform data". That was PROSE, NOT CODE.
 * `researchQuery(query: string)` forwarded its argument to Gemini verbatim: no
 * validation, no containment check, and — worse — no logging at all, so there
 * was no record anywhere that a query had left the machine. Meanwhile
 * `run_research` lets the MODEL compose that string with the full platform
 * context of the turn in its head, and `/api/ai/research` accepted a
 * `project_id` it never read. A protected project's name could go out, and
 * nothing would have known.
 *
 * WHAT THIS CAN AND CANNOT DO. It is a NAME guard, not a semantics guard. It
 * refuses a query that names a protected project; it cannot tell that "the
 * counterparty wants to close on the first of November" discloses a negotiating
 * position. That limit is the reason the real rule stands unchanged: a
 * confidential record's CONTENT must never be handed to an external model at
 * all, by any path. This stops the cheap, obvious leak and writes an audit row
 * for everything else.
 *
 * MATCHING, AND THE TWO LESSONS IT ALREADY COST (§12):
 *   - A SHARED INDUSTRY WORD IS THE ONE THING AN IDENTIFIER MUST NOT BE.
 *     Matching "energy" or "capital" would refuse every legitimate query, so
 *     those live in GENERIC_TERMS below.
 *   - PLACE NAMES STAY IN. Myton, Delta, Heber, Steelton and Stockton are
 *     exactly what distinguishes these records from each other, so they are
 *     deliberately NOT treated as generic.
 *
 * The failure direction is chosen on purpose: refusing a query costs a web
 * search and says which term triggered it, so it can be rephrased. Letting one
 * through costs the secret, silently and permanently.
 */

import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Words too common to identify a record on their own.
 *
 * Industry nouns, legal suffixes and corporate filler only. No place names —
 * see the header.
 */
const GENERIC_TERMS = new Set([
  'the', 'and', 'of', 'for', 'at', 'in', 'on', 'to', 'a', 'an',
  'llc', 'lp', 'llp', 'inc', 'incorporated', 'corp', 'corporation', 'co',
  'company', 'companies', 'holdings', 'holding', 'group', 'partners',
  'partnership', 'ventures', 'capital', 'development', 'developments',
  'project', 'projects', 'program', 'site', 'sites', 'campus', 'park',
  'energy', 'power', 'solar', 'wind', 'steel', 'mining', 'minerals',
  'industrial', 'commercial', 'residential', 'housing', 'land', 'ranch',
  'data', 'center', 'centre', 'datacenter', 'infrastructure', 'utility',
  'construction', 'builders', 'contracting', 'contractors', 'properties',
  'property', 'realty', 'estate', 'investments', 'fund', 'phase', 'north',
  'south', 'east', 'west', 'new', 'old', 'upper', 'lower',
])

/** Tokens from a record name that are distinctive enough to match on. */
export function distinctiveTerms(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !GENERIC_TERMS.has(t))
}

export type EgressVerdict =
  | { ok: true }
  | { ok: false; reason: string }

/** Whole-word containment, so "delta" does not match "deltas" or "deltoid". */
function namesTerm(haystack: string, term: string): boolean {
  return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(haystack)
}

/**
 * May this text be sent to an external service?
 *
 * ⚠ FAILS CLOSED. A database error means the protected set is unknown, and an
 * unknown protected set is not an empty one. Research is a convenience; the
 * refusal names the fault so it does not read as a mysterious outage.
 */
export async function guardOutboundText(text: string): Promise<EgressVerdict> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('projects')
    .select('name')
    .eq('confidential', true)

  if (error) {
    return {
      ok: false,
      reason: `the protected-project list could not be read, so nothing can be sent out right now (${error.message})`,
    }
  }

  const names = ((data ?? []) as { name: string | null }[])
    .map((r) => r.name)
    .filter((n): n is string => !!n && n.trim().length > 0)

  for (const name of names) {
    // The full name as a phrase first — the unambiguous case.
    if (namesTerm(text, name.toLowerCase().replace(/\s+/g, ' '))) {
      return { ok: false, reason: `it names a protected project ("${name}")` }
    }
    for (const term of distinctiveTerms(name)) {
      if (namesTerm(text, term)) {
        return {
          ok: false,
          reason: `it contains "${term}", which identifies a protected project. Rephrase without that term if the question is genuinely about something else.`,
        }
      }
    }
  }

  return { ok: true }
}
