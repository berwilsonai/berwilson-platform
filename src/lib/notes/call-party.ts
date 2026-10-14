/**
 * Who was on the call — resolved from iOS's own title, deterministically.
 *
 * ⚠ THE TITLE IS THE BEST EVIDENCE ON THE WHOLE ARTIFACT, AND IT IS THE ONE
 * THING THE PLATFORM WAS THROWING AWAY. A recorded call arrives as a note
 * titled `Call with <name>`, where the name is copied from the Contacts card on
 * the phone — somebody Richard has already decided is worth storing, written
 * the way he writes it. The transcript, by contrast, may never say a surname.
 *
 * ⚠ AND THE NAME ON THE PHONE IS NOT THE NAME IN THE CRM. Measured on the one
 * real call in this corpus: the note says **Eric Tuaone** and `parties` holds
 * **Ericson Tua'one**. Exact match fails. `match_parties_by_name` scores them
 * at 0.47 — a number that means nothing on its own, and §12 is explicit that a
 * lone hit on a weak key is an unchallenged match rather than a unique one ("Cliff"
 * resolved to an unrelated academic on a live deal). So this does not use a
 * similarity score at all.
 *
 * What it uses instead is the structure of a human name:
 *
 *   - punctuation is noise — `Tua'one` and `Tuaone` are the same word;
 *   - a surname is the rare token, and it must match WHOLE;
 *   - a first name is routinely shortened, so `Eric` → `Ericson` is allowed as a
 *     prefix, and only as a prefix of something longer.
 *
 * Both halves must hold, the rare token must be rare IN THE CORPUS (one party
 * answers to it), and two candidates mean no match. That is §12's rule applied
 * rather than a threshold chosen: require the whole name or one token rare in
 * the corpus.
 */

import { createAdminClient } from '@/lib/supabase/admin'

/** PostgREST caps a response at 1000 rows and says nothing about it (§12). */
const PAGE = 1000

/**
 * iOS's title, reduced to the name it names.
 *
 * Kept deliberately dumb: everything after `Call with` is the name, minus the
 * `(2)` iOS appends when two calls with one person land on the same day. A
 * number instead of a name is returned as-is and will simply resolve to nobody
 * — which is the correct outcome, not an error, and reads that way in the log.
 */
export function callCounterpartyName(title: string): string | null {
  const m = /^\s*call with\s+(.+?)\s*$/i.exec(title)
  if (!m) return null
  const name = m[1]
    // A trailing "(2)" / "(3)" is iOS's own disambiguator, not part of a name.
    .replace(/\s*\(\d+\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
  return name.length > 0 ? name : null
}

/**
 * Lowercase name tokens.
 *
 * ⚠ AN APOSTROPHE IS DELETED, NOT TREATED AS A SEPARATOR, AND THE LIVE CASE IS
 * WHY. The obvious `[^a-z0-9]+ → ' '` turns `Tua'one` into TWO tokens, `tua`
 * and `one`, so the one name this had to match stopped matching and `one`
 * became a token short enough and common enough to collide with anything. A
 * hyphen or a space does separate names (`Mary-Jane` is two), an apostrophe or
 * a period never does.
 */
export function nameTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
}

export interface PartyCandidate {
  id: string
  full_name: string
  is_organization: boolean
  company: string | null
  email: string | null
}

export interface CallPartyMatch {
  party: PartyCandidate
  /** Why, in words a reader can argue with. Stored on the meeting's attendee. */
  reason: string
}

export type CallPartyResolution =
  | { match: CallPartyMatch; ambiguous: null }
  /** Two or more parties answer to this name — named, so a human can fix it. */
  | { match: null; ambiguous: string }
  | { match: null; ambiguous: null }

/**
 * Does this party answer to the name on the call?
 *
 * Returns the reason when it does, so the decision travels with the record
 * instead of being re-derived by whoever doubts it later.
 */
export function nameMatches(callName: string, partyName: string): string | null {
  const call = nameTokens(callName)
  const party = nameTokens(partyName)
  if (call.length === 0 || party.length === 0) return null

  // The whole name, punctuation aside. "Tua'one Enterprises" is not this.
  if (call.length === party.length && call.every((t, i) => t === party[i])) {
    return call.join(' ') === partyName.toLowerCase() ? 'same name' : `matches "${partyName}"`
  }

  // Every token on the call must be accounted for on the party, each used once:
  // a surname whole, a first name as a prefix of something longer. A party with
  // EXTRA tokens is fine — a middle name or a suffix on the CRM record is not a
  // disagreement — but a call token with nothing to match is.
  const unused = [...party]
  const notes: string[] = []
  let exactRare: string | null = null

  for (const token of call) {
    const whole = unused.findIndex((p) => p === token)
    if (whole >= 0) {
      // Four characters is where a shared token stops being a coincidence —
      // "ben", "ann" and "lee" are fragments of other names, "tuaone" is not.
      if (token.length >= 4 && (!exactRare || token.length > exactRare.length)) exactRare = token
      unused.splice(whole, 1)
      continue
    }
    // A shortened first name: strictly a prefix of a LONGER token, and at least
    // three characters of it. "Eric" → "Ericson" passes; "E" → "Ericson" and
    // "Ericson" → "Eric" do not.
    const prefix =
      token.length >= 3 ? unused.findIndex((p) => p.length > token.length && p.startsWith(token)) : -1
    if (prefix >= 0) {
      notes.push(`${token} → ${unused[prefix]}`)
      unused.splice(prefix, 1)
      continue
    }
    return null
  }

  // ⚠ A PREFIX ALONE IS NEVER ENOUGH. Without this, "Call with Chris" matches
  // Christopher, Christina and Chris Holdings at once — and with only one of
  // them in the directory it would match that one confidently, which is exactly
  // the failure §12 records. One token must have matched whole and be long
  // enough to be a name rather than a fragment.
  if (!exactRare) return null

  const how = notes.length > 0 ? `${notes.join(', ')}; ${exactRare} matches` : `${exactRare} matches`
  return `${how} "${partyName}"`
}

/**
 * The directory contact a recorded call was with, or nobody.
 *
 * People are tried before organizations: a phone call is with a person, and a
 * Contacts card named for a company is the weaker reading of the same string.
 * Within either group, two matches mean no match.
 */
export async function resolveCallParty(callName: string): Promise<CallPartyResolution> {
  const supabase = createAdminClient()
  const candidates: PartyCandidate[] = []

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('parties')
      .select('id, full_name, is_organization, company, email')
      .not('full_name', 'is', null)
      .order('id')
      .range(from, from + PAGE - 1)
    if (error || !data || data.length === 0) break
    candidates.push(...(data as PartyCandidate[]))
    if (data.length < PAGE) break
  }

  const hits: CallPartyMatch[] = []
  for (const party of candidates) {
    const reason = nameMatches(callName, party.full_name)
    if (reason) hits.push({ party, reason })
  }

  // Aliases a human typed onto a contact count the same as the name itself —
  // the same argument route-phase.ts makes for an alias being `linked` rather
  // than `inferred`: setting one is a filing decision expressed in advance.
  const { data: aliases } = await supabase
    .from('contact_aliases')
    .select('party_id, alias')
    .limit(PAGE)
  for (const row of (aliases ?? []) as { party_id: string | null; alias: string }[]) {
    if (!row.party_id) continue
    if (hits.some((h) => h.party.id === row.party_id)) continue
    if (nameTokens(row.alias).join(' ') !== nameTokens(callName).join(' ')) continue
    const party = candidates.find((c) => c.id === row.party_id)
    if (party) hits.push({ party, reason: `known as "${row.alias}"` })
  }

  const people = hits.filter((h) => !h.party.is_organization)
  const orgs = hits.filter((h) => h.party.is_organization)
  const group = people.length > 0 ? people : orgs

  if (group.length === 1) return { match: group[0], ambiguous: null }
  if (group.length > 1) {
    return {
      match: null,
      ambiguous: `"${callName}" matches ${group.length} contacts (${group
        .map((h) => h.party.full_name)
        .join(', ')}) — refused rather than guessed`,
    }
  }
  return { match: null, ambiguous: null }
}
