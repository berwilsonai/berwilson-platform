/**
 * Whose desk does a commitment belong on?
 *
 * TWO KEYS, IN PRIORITY ORDER, because the obvious one is not trustworthy on
 * its own. `commitments.owner_name` is free text straight out of extraction,
 * and the live distribution says exactly how free: for side='us' it holds
 * `Ericson Tua'one` 22, `Ber Wilson` 19, `Eric` 10, `Bear Wilson` 9,
 * `Ericson H. Tua'one` 4, `Richard White` 4, `Erikson Tua'One` 2,
 * `Richard M White` 2, `Eric Tua' One` 1, `Hola` 1 — and 31 nulls. Four
 * spellings of one man, the company itself twice under two spellings, and a
 * Spanish greeting.
 *
 * So the name is tried first and must clear a strict bar, and when it does not,
 * the thread's MAILBOX decides. That key is complete (every commitment has one)
 * and deterministic: mail in tuaone@ landed on Eric's desk whoever the model
 * thought owed the thing. `contact_aliases` would have been the natural place
 * to resolve the spellings and it is empty — 0 rows — so nothing is built on it.
 *
 * ⚠ Per CLAUDE.md §12: ambiguity must mean NO match, and one match is not a
 * unique match. A name that could be two members resolves to neither; it falls
 * through to the mailbox rather than guessing. Nothing here ever invents an
 * owner, and the rendered line always quotes `owner_name` as written, so a
 * reader sees "Ber Wilson" and knows the company was named, not a person.
 */

import type { createAdminClient } from '@/lib/supabase/admin'
import { LEAD_MAILBOXES } from '@/lib/integrations/google-workspace'

type AdminClient = ReturnType<typeof createAdminClient>

export interface PepperMember {
  id: string
  name: string
  email: string
  /** First name, for addressing the note. */
  firstName: string
  /** The mailbox whose correspondence lands on this person's desk. */
  mailbox: string
  /**
   * True for the assistant's own seat (info@). It holds a login and a task
   * list, but it is not a person and never receives a note — its mail is the
   * company's front door, so its commitments are shared rather than hers.
   */
  isAssistantSeat: boolean
  /** Normalized name tokens that identify this person in free text. */
  tokens: Set<string>
}

/** Tokens shorter than this are too weak to resolve a person on their own. */
const MIN_TOKEN_LENGTH = 4

/**
 * Lowercase, strip accents and punctuation, collapse whitespace.
 *
 * Apostrophes are removed rather than kept, which is the whole point:
 * `Tua'one`, `Tua' One` and `Tuaone` have to land on the same token or the four
 * spellings of Eric's surname stay four different people.
 */
export function normalizeName(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // Apostrophes are DELETED, not turned into separators, and the order
    // matters: `Tua'One` has to become the single token `tuaone`. Replacing
    // it with a space instead yields `tua` + `one`, two tokens too short to
    // resolve anyone, and Eric's surname stops matching in three of its four
    // recorded spellings.
    .replace(/['\u2019\u02bc]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function tokenize(raw: string): string[] {
  return normalizeName(raw).split(' ').filter(Boolean)
}

/**
 * Load the people a note can be addressed to, with their name tokens resolved.
 *
 * `team_members.party_id` already links each member to their contact record
 * (Richard → "Richard White", Eric → "Ericson Tua'one"), which is where the
 * full-name spellings come from — the team_members row itself only carries a
 * first name.
 */
export async function loadPepperMembers(supabase: AdminClient): Promise<PepperMember[]> {
  const { data, error } = await supabase
    .from('team_members')
    .select('id, name, email, party:parties(full_name)')
    .eq('active', true)

  if (error) throw new Error(`Could not read the team roster: ${error.message}`)

  const leadMailboxes = new Set(LEAD_MAILBOXES.map((m) => m.toLowerCase()))
  const members: PepperMember[] = []

  for (const row of data ?? []) {
    const email = (row.email ?? '').trim().toLowerCase()
    if (!email) continue

    const party = Array.isArray(row.party) ? row.party[0] : row.party
    const fullName = (party as { full_name?: string } | null)?.full_name ?? ''

    const tokens = new Set<string>()
    for (const t of [...tokenize(row.name), ...tokenize(fullName)]) {
      if (t.length >= MIN_TOKEN_LENGTH) tokens.add(t)
    }
    // The mailbox local part too: "moose" and "tuaone" both appear in mail as
    // how these two are addressed, and neither collides with anything.
    const local = email.split('@')[0]
    if (local && local.length >= MIN_TOKEN_LENGTH) tokens.add(normalizeName(local))

    members.push({
      id: row.id,
      name: row.name,
      email,
      firstName: row.name.split(' ')[0],
      mailbox: email,
      isAssistantSeat: leadMailboxes.has(email),
      tokens,
    })
  }

  return members
}

export type Attribution =
  | { kind: 'member'; memberId: string; via: 'name' | 'mailbox' }
  | { kind: 'shared'; reason: string }

/**
 * Resolve a free-text owner to exactly one member, or to nobody.
 *
 * A token must be distinctive (>= 4 characters) AND belong to exactly one
 * member. "tuaone" resolves Eric through every misspelling of his first name;
 * "eric" resolves him on its own because no other member shares it; "wilson"
 * in `Bear Wilson` resolves nobody, which is correct — that is the company.
 */
export function resolveOwnerName(
  ownerName: string | null,
  members: PepperMember[]
): { memberId: string } | null {
  if (!ownerName?.trim()) return null

  const matched = new Set<string>()
  for (const token of tokenize(ownerName)) {
    if (token.length < MIN_TOKEN_LENGTH) continue
    const owners = members.filter((m) => m.tokens.has(token))
    // A token two members share identifies neither of them.
    if (owners.length === 1) matched.add(owners[0].id)
  }

  // Two different distinctive tokens pointing at two different people is the
  // ambiguous case that must refuse — "Richard and Eric" owes nothing to one
  // person's list.
  if (matched.size !== 1) return null
  return { memberId: [...matched][0] }
}

/**
 * Whose desk this commitment sits on: the named owner when it resolves,
 * otherwise the mailbox the conversation lives in.
 *
 * ⚠ SIDE DECIDES WHETHER THE NAME MEANS ANYTHING. For `us` the owner_name is
 * the internal person who took the thing on, so resolving it is the point. For
 * `them` it is the COUNTERPARTY — the person being waited on — and resolving it
 * to a team member produces nonsense: a real row reads "Ensure team access to
 * Google Drive business plans — Moose", side `them`, which under a naive read
 * lands on Richard's waiting-on list as something Richard owes himself. So for
 * `them` only the mailbox is consulted, which answers the question actually
 * being asked: whose correspondence is this stuck in.
 */
export function attribute(
  ownerName: string | null,
  mailbox: string | null,
  members: PepperMember[],
  side: 'us' | 'them'
): Attribution {
  const byName = side === 'us' ? resolveOwnerName(ownerName, members) : null
  if (byName) return { kind: 'member', memberId: byName.memberId, via: 'name' }

  const box = (mailbox ?? '').trim().toLowerCase()
  const member = members.find((m) => m.mailbox === box)

  // The front-door mailbox belongs to no executive, so its obligations are the
  // company's rather than one person's — they appear in everyone's note.
  if (member && !member.isAssistantSeat) {
    return { kind: 'member', memberId: member.id, via: 'mailbox' }
  }
  if (member?.isAssistantSeat) return { kind: 'shared', reason: 'front-door mailbox' }
  return { kind: 'shared', reason: box ? `unrecognized mailbox ${box}` : 'no mailbox recorded' }
}
