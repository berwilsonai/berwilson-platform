/**
 * "Is this person already in the directory?" — one answer, used by every door
 * that creates a contact.
 *
 * Email is identity and wins outright. A name is a guess, so a name match that
 * is not unique comes back `ambiguous` with its candidates and NO chosen id:
 * the reviewer is asked instead of two people being quietly merged. (§12:
 * ambiguity must mean NO match; one match is not a unique match.)
 *
 * Lifted out of profile-intake.ts when the business-card scanner needed the
 * same answer. Forking it would have given the two intake doors two different
 * notions of "already have them", which is exactly the bug that produces
 * duplicate contacts nobody notices for months.
 */

import { createAdminClient } from '@/lib/supabase/admin'

/** A directory record that could be this person. */
export interface PartyCandidate {
  id: string
  full_name: string
  company: string | null
  email: string | null
}

export type DirectoryMatchType = 'exact_email' | 'exact_name' | 'fuzzy_name' | 'none'

export interface DirectoryMatch {
  existing_party_id: string | null
  existing_party_name: string | null
  match_type: DirectoryMatchType
  /** Several records fit equally well — the match refuses to choose. */
  ambiguous: boolean
  candidates: PartyCandidate[]
}

export const NO_DIRECTORY_MATCH: DirectoryMatch = {
  existing_party_id: null,
  existing_party_name: null,
  match_type: 'none',
  ambiguous: false,
  candidates: [],
}

/** Find the contact this person already is, if any. */
export async function matchDirectory(
  email: string | null,
  name: string | null,
  company: string | null
): Promise<DirectoryMatch> {
  const db = createAdminClient()

  if (email) {
    const { data } = await db
      .from('parties')
      .select('id, full_name, company, email')
      .ilike('email', email)
      .limit(2)
    if (data && data.length === 1) {
      return {
        existing_party_id: data[0].id,
        existing_party_name: data[0].full_name,
        match_type: 'exact_email',
        ambiguous: false,
        candidates: data,
      }
    }
    if (data && data.length > 1) {
      // Two contacts holding one address is a duplicate to resolve, not a match.
      return { ...NO_DIRECTORY_MATCH, ambiguous: true, candidates: data }
    }
  }

  if (!name) return NO_DIRECTORY_MATCH

  const { data: byName } = await db
    .from('parties')
    .select('id, full_name, company, email')
    .ilike('full_name', name)
    .limit(5)
  if (byName && byName.length === 1) {
    return {
      existing_party_id: byName[0].id,
      existing_party_name: byName[0].full_name,
      match_type: 'exact_name',
      ambiguous: false,
      candidates: byName,
    }
  }
  if (byName && byName.length > 1) {
    // Same name, different people — unless the company settles it.
    const narrowed = company
      ? byName.filter((p) => (p.company ?? '').toLowerCase() === company.toLowerCase())
      : []
    if (narrowed.length === 1) {
      return {
        existing_party_id: narrowed[0].id,
        existing_party_name: narrowed[0].full_name,
        match_type: 'exact_name',
        ambiguous: false,
        candidates: byName,
      }
    }
    return { ...NO_DIRECTORY_MATCH, ambiguous: true, candidates: byName }
  }

  const { data: fuzzy } = (await db.rpc('match_parties_by_name', {
    search_name: name,
    threshold: 0.4,
  })) as unknown as { data: Array<{ id: string; full_name: string; similarity: number }> | null }

  if (fuzzy?.length) {
    // Within 0.05 of each other is a tie, not a winner.
    const tied = fuzzy.length > 1 && fuzzy[1].similarity >= fuzzy[0].similarity - 0.05
    const candidates: PartyCandidate[] = fuzzy.slice(0, 5).map((f) => ({
      id: f.id,
      full_name: f.full_name,
      company: null,
      email: null,
    }))
    if (tied) return { ...NO_DIRECTORY_MATCH, ambiguous: true, candidates }
    return {
      existing_party_id: fuzzy[0].id,
      existing_party_name: fuzzy[0].full_name,
      match_type: 'fuzzy_name',
      ambiguous: false,
      candidates,
    }
  }

  return NO_DIRECTORY_MATCH
}
