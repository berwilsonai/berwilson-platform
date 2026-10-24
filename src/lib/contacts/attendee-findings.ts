/**
 * THE PEOPLE WE HAVE MET AND NEVER WROTE DOWN.
 *
 * Richard, 2026-10-23: "When it sounds like someone new, capture the contacts
 * the best you can and if you can't relate to an actual [contact] in the system
 * present in your finding the ability to add a new contact or merge that call
 * summary with an existing contact. As we do so much networking it is really
 * important to capture and track our contacts."
 *
 * ⚠ THE SIZE OF THE LEAK, MEASURED ON THE LIVE DATABASE 2026-10-23: 135 of 169
 * attendee slots across the 18 recorded meetings carry no `party_id` — 96
 * distinct names — and 11 of 151 contacts have ever had a meeting logged
 * against them. Every recording sweep adds to that pile, because `linkAttendees`
 * stamps a contact only on an IDENTITY match and quite rightly refuses the rest
 * (§12: one hit on a weak key is an unchallenged match, and it once resolved
 * "Cliff" to an unrelated academic on a live deal).
 *
 * ⚠ SO THE QUEUE IS A CLASSIFIER, NOT A LIST OF "CREATE?" BUTTONS. Reading the
 * 96 names is what decided this module's shape:
 *
 *   `moose@berwilson.com` ×5, `tuaone@berwilson.com` ×5   → our own executives
 *   "Ber Wilson" ×5, "Ber Wilson Lead", "…Executive Team" → our own company
 *   "Army Corps of Engineers", "Department of Defense",
 *   "Dell", "Bloom Energy", "DA Davidson", "Hunt Electric" → organizations
 *   "Eric", "Mike", "Abe", "Brad", "Amy", "Chris", "Calvin" → first names alone
 *   "Chip Hoisington", "Calvin Vass", "Dave Huffiness"      → real new people
 *
 * Offering "add as a contact" for all 96 would manufacture the rolodex the
 * 10-21 and 10-22 sessions spent two days cleaning up, where `matchParty`
 * reporting a refusal as an absence turned one archived row into two fresh ones
 * inside a day. So each name is classified, the classification decides which
 * actions are even offered, and **nothing in this module writes anything**.
 *
 * ⚠ AND A FIRST NAME IS A REFUSAL, NOT A CANDIDATE. §12: a human name has
 * structure a similarity score throws away — allow a first name only as a
 * prefix of something longer, never a prefix alone. "Eric" is our own Eric on
 * one call and could be anybody on the next, so the queue asks for a surname or
 * a link to an existing contact and will not create from the fragment. That is
 * the single largest bucket here, and getting it wrong is how a directory fills
 * with people called Mike.
 */

import { isOwnCompanyName, namesOwnCompany } from '@/lib/utils/own-company'
import { nameMatches } from '@/lib/notes/call-party'

/** One attendee slot as the model left it on a `meetings` row. */
export interface RawAttendee {
  name?: string | null
  role?: string | null
  org?: string | null
  company?: string | null
  email?: string | null
  party_id?: string | null
  is_organization?: boolean | null
}

/**
 * What a name IS, which decides what the queue may offer for it.
 *
 *   `internal`     — one of ours. Resolvable to a team member's contact, never
 *                    created: they are already in the directory.
 *   `organization` — a company, agency or firm in a person-shaped field. May be
 *                    linked to an organization contact; never made a person.
 *   `label`        — not a name at all ("Ber Wilson Executive Team"). Skip only.
 *   `fragment`     — a first name with no surname. A link or a typed surname;
 *                    never created as it stands.
 *   `candidate`    — a human name we can act on. Add, or link to an existing.
 */
export type AttendeeClass = 'internal' | 'organization' | 'label' | 'fragment' | 'candidate'

export interface ClassifiedName {
  kind: AttendeeClass
  /** Why, in the words the queue shows the reader. Never a bare enum (§12). */
  reason: string
  /** The address, when the "name" was one. Identity, so it is kept. */
  email: string | null
  /** The name with an address removed — what to show and what to match on. */
  display: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Words that make a string an ORGANIZATION rather than a person.
 *
 * ⚠ MATCHED AS WHOLE TOKENS, NEVER AS SUBSTRINGS. §12: a substring hint matches
 * any word that CONTAINS it — `title` is inside `Entitlements`, which silently
 * killed every land/title filing rule. `Corp` inside a surname and `Energy`
 * inside nothing in particular are the same trap, so the test is tokenised.
 *
 * ⚠ AND THESE ARE SUFFICIENT, NOT NECESSARY. "Dell" and "Abe" are both one
 * word with no suffix; one is a supplier and one is a consultant, and no word
 * list can tell them apart. That is exactly why the ROLE text is read too and
 * why a one-word name that nothing convicts lands in `fragment` — a refusal
 * with a reason, which the reader can resolve in one click.
 */
const ORG_TOKENS = new Set([
  'inc', 'llc', 'llp', 'lp', 'corp', 'corporation', 'company', 'co', 'ltd',
  'partners', 'partnership', 'holdings', 'group', 'capital', 'ventures',
  'associates', 'consultants', 'consulting', 'engineering', 'engineers',
  'construction', 'contractors', 'electric', 'electrical', 'mechanical',
  'energy', 'power', 'utilities', 'bank', 'financial', 'advisors', 'advisory',
  'university', 'college', 'hospital', 'hospitals', 'clinic', 'department',
  'agency', 'bureau', 'commission', 'authority', 'district', 'county', 'city',
  'state', 'federal', 'administration', 'corps', 'institute', 'foundation',
  'association', 'solutions', 'technologies', 'technology', 'systems',
  'services', 'industries', 'properties', 'realty', 'development', 'developers',
  'management', 'enterprises', 'network', 'networks', 'labs', 'works',
  // Added after the first live measurement, each for a named row it got wrong:
  // "Israel Government", "Golden Dome" (role 'Government Initiative').
  'government', 'initiative', 'ministry',
])

/**
 * Role words that describe an ENTITY's part in a deal rather than a job.
 *
 * Read from the live corpus: "Engineering Firm", "Federal Agency", "GPU
 * Supplier", "Cooling Technology Partner", "Deal Network", "Talent Source".
 * A person's role reads "Broker", "Underwriting Consultant", "JP Morgan
 * Strategic Resiliency Lead" — a job, not a category of counterparty.
 */
const ORG_ROLE_TOKENS = new Set([
  'firm', 'agency', 'supplier', 'provider', 'vendor', 'manufacturer',
  'organization', 'organisation', 'contractor', 'subcontractor', 'lender',
  'bank', 'institution', 'source', 'network',
  // From the live corpus: "Site Lessee" (QTS), "Government Initiative"
  // (Golden Dome), "PPA off-taker" (Neo Clouds).
  'lessee', 'tenant', 'initiative', 'government', 'offtaker', 'fund',
])

/** Strings that are a GROUP or a SEAT, never one person. */
const LABEL_TOKENS = new Set([
  'team', 'board', 'committee', 'council', 'staff', 'group', 'leadership',
  'executives', 'everyone', 'all', 'attendees', 'participants', 'others',
  'unknown', 'unidentified', 'speaker', 'host', 'guest', 'caller',
  // ⚠ A SEAT IS NOT A NAME, and the model writes seats into this field:
  // "Deseret New CEO" and "Tensor Representative" are both live rows. Tested
  // against the NAME only, never the role — "Tensor Principal" is a perfectly
  // good role for the perfectly real Jonathan Houk.
  'ceo', 'cfo', 'coo', 'cto', 'president', 'representative', 'rep',
  'officer', 'director', 'chairman', 'chairperson',
])

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

function hasToken(value: string | null | undefined, set: Set<string>): boolean {
  if (!value) return false
  return tokens(value).some((t) => set.has(t))
}

/**
 * Who "we" are and what the directory already holds — the facts a
 * classification is allowed to rest on.
 *
 * ⚠ EVERY ONE OF THESE IS A ROW IN A TABLE, NOT A WORD TEST. §12: decide on the
 * flag or the row, never on the string, and a self-loop guard keyed on a display
 * name is defeated by a rename that is itself a good idea. `firstNames` carries
 * a COUNT rather than a name so a second Eric joining makes "Eric" undecidable
 * instead of silently resolving to the first one.
 */
export interface DirectoryFacts {
  /** Lowercased full names of active team members. */
  names: Set<string>
  /** Lowercased addresses of active team members. */
  addresses: Set<string>
  /** First name → how many of us answer to it. */
  firstNames: Map<string, number>
  /**
   * Local parts of our own addresses — `moose`, `tuaone`, `info`.
   *
   * ⚠ MEASURED: "Moose" appears as an attendee name with no surname and the
   * company "Ber Wilson", and the first-name map cannot see it because the team
   * row says "Eric". A nickname that IS one of our mailboxes is one of ours.
   */
  addressLocalParts: Set<string>
  /** Lowercased names of contacts already filed as organizations. */
  organizationNames: Set<string>
}

/** Classify one attendee name. */
export function classifyAttendee(
  attendee: RawAttendee,
  internal: DirectoryFacts,
): ClassifiedName {
  const rawName = (attendee.name ?? '').trim()
  const org = (attendee.org ?? attendee.company ?? '')?.trim() || null

  // ── The "name" is an address ────────────────────────────────────────────────
  // Five calls each list `moose@berwilson.com` and `tuaone@berwilson.com` as
  // attendees. An address is IDENTITY (§12: a mailbox is a better key than a
  // name), so it is kept and used — and if it is one of ours, that settles it.
  const asEmail = EMAIL_RE.test(rawName) ? rawName.toLowerCase() : null
  const email = (attendee.email ?? '').trim().toLowerCase() || asEmail || null
  const display = asEmail ? rawName : rawName

  if (email && internal.addresses.has(email)) {
    return { kind: 'internal', reason: 'one of our own mailboxes', email, display }
  }

  if (!rawName) {
    return { kind: 'label', reason: 'the recording named no one here', email, display: '' }
  }

  // ── Our own company, and the labels built on it ─────────────────────────────
  if (isOwnCompanyName(rawName)) {
    return { kind: 'organization', reason: 'our own company, in the person field', email, display }
  }
  if (namesOwnCompany(rawName)) {
    return { kind: 'label', reason: 'a group inside Ber Wilson, not a person', email, display }
  }

  const name = display.trim()
  const words = tokens(name)

  // ── One of ours, by name ────────────────────────────────────────────────────
  if (internal.names.has(name.toLowerCase())) {
    return { kind: 'internal', reason: 'on the team', email, display }
  }
  // ⚠ A FIRST NAME RESOLVES TO ONE OF OURS ONLY WHEN IT IS UNAMBIGUOUS AMONG
  // US. "Eric" appears on five calls and there is exactly one Eric on the team,
  // so it is ours with certainty; a second Eric would make the same string
  // undecidable and it must then fall through to `fragment` rather than guess.
  if (words.length === 1 && internal.firstNames.get(words[0]) === 1) {
    return { kind: 'internal', reason: 'a first name that matches one person on the team', email, display }
  }
  // A nickname that is one of our own mailboxes — "Moose".
  if (words.length === 1 && internal.addressLocalParts.has(words[0])) {
    return { kind: 'internal', reason: 'the name on one of our own mailboxes', email, display }
  }
  // ⚠ THE COMPANY THE RECORDING HEARD IS EVIDENCE ABOUT THE PERSON. "Brad"
  // (Regional Sales) and "David" (Internal Team/Estimator) both carry the org
  // "Ber Wilson" and are plainly ours; without this they sit in `fragment`
  // forever, because no first-name map can hold somebody who is not a team
  // member row. It only ever moves a row INTO `internal`, where `create` is
  // withheld, so a mis-heard company costs a link the reader can make anyway.
  if (isOwnCompanyName(org)) {
    return { kind: 'internal', reason: 'the recording placed them inside Ber Wilson', email, display }
  }

  // ── A group or a seat ───────────────────────────────────────────────────────
  if (hasToken(name, LABEL_TOKENS)) {
    return { kind: 'label', reason: 'a group or a seat, not a person', email, display }
  }

  // ── An organization ─────────────────────────────────────────────────────────
  //
  // ⚠ THE TESTS ARE ADDITIVE AND THE MODEL'S FLAG MAY CONVICT BUT NEVER ACQUIT.
  // §12, measured the hard way: reading the flag with `??` and falling back to a
  // name test only when it was absent let `is_organization: false` silently
  // disable the rule. So a true flag decides, and a false or missing one simply
  // does not vote.
  if (attendee.is_organization === true) {
    return { kind: 'organization', reason: 'the recording called this an organization', email, display }
  }
  if (hasToken(name, ORG_TOKENS)) {
    return { kind: 'organization', reason: 'the name reads as a company or an agency', email, display }
  }
  if (hasToken(attendee.role, ORG_ROLE_TOKENS)) {
    return {
      kind: 'organization',
      reason: `described as a ${attendee.role!.trim().toLowerCase()} rather than a job`,
      email,
      display,
    }
  }
  // The model repeats the company into `name` when it has no person for it.
  if (org && name.toLowerCase() === org.toLowerCase()) {
    return { kind: 'organization', reason: 'the name and the company are the same string', email, display }
  }
  // ⚠ THE DIRECTORY ALREADY KNOWS SOME OF THESE, AND A ROW BEATS A WORD LIST.
  // "Bloom Energy" and "Zenthium AI" are filed as organization contacts, so the
  // same strings heard on a call are organizations as a matter of record rather
  // than of spelling. Matched through `nameMatches`, the §12 name rule, so
  // "Zenthium" reaches "Zenthium AI" (surname whole, extra tokens on the
  // directory record are not a disagreement) without a trigram threshold.
  if (internal.organizationNames.has(name.toLowerCase())) {
    return { kind: 'organization', reason: 'already in the directory as an organization', email, display }
  }
  for (const orgName of internal.organizationNames) {
    if (nameMatches(name, orgName)) {
      return {
        kind: 'organization',
        reason: `reads as the organization already on file as "${orgName}"`,
        email,
        display,
      }
    }
  }
  // An acronym. "GRC", "HTS", "QTS" are all live rows, and no person here is
  // written in block capitals.
  if (/^[A-Z0-9]{2,5}$/.test(name)) {
    return { kind: 'organization', reason: 'an acronym, not a name', email, display }
  }
  // Internal capitals — "TensorIQ", "GoAvant". A product name, never a surname.
  if (/[a-z][A-Z]/.test(name)) {
    return { kind: 'organization', reason: 'a brand name rather than a person', email, display }
  }

  // ── A real address with a one-word name is still actionable ──────────────────
  // An address is identity, so "Calvin <calvin.vass@goavant.net>" can be created
  // and matched even though "Calvin" alone could not.
  if (email) {
    return { kind: 'candidate', reason: 'heard with an email address', email, display }
  }

  // ── One word, and it cannot be decided ─────────────────────────────────────
  //
  // ⚠ THE REASON SAYS BOTH READINGS, BECAUSE THE MEASUREMENT SAYS BOTH ARE
  // HERE. Of the 33 one-word names in the live corpus, roughly half are first
  // names with no surname ("Abe", "Amy", "Brooke", "Chuck") and half are
  // companies with no suffix ("Shell", "Oracle", "Raytheon", "Lumen"). Nothing
  // in the string separates them: "Erickson" is a surname and "Oracle" is not,
  // and the shape is identical. The decisive signals above (an acronym, internal
  // capitals, an organization already on file, an org-shaped role) take the ones
  // that CAN be settled; the rest land here and say so.
  //
  // ⚠ AND THAT COSTS NOTHING, WHICH IS WHY IT IS HONEST RATHER THAN LAZY:
  // `fragment` withholds `create` exactly as `organization` does, so a row in
  // the wrong one of the two is a different sentence on screen and the same set
  // of buttons. §12 — a fuzzy threshold is measured against the real corpus,
  // never chosen, and two identically shaped names fall either side of any
  // number you pick.
  if (words.length < 2) {
    return {
      kind: 'fragment',
      reason: 'only one word was said — it could be a first name or a company, so it cannot be created as it stands',
      email,
      display,
    }
  }

  return { kind: 'candidate', reason: 'a name no contact answers to', email, display }
}

/** The actions the queue may offer for a classification. */
export interface OfferedActions {
  /** Create a `parties` row from what the recording heard. */
  create: boolean
  /** Point the attendee slot at a contact that already exists. */
  link: boolean
  /** Tombstone the name so the queue can reach zero. */
  skip: boolean
  /** The reason a skip would be recorded under. */
  skipReason: 'organization' | 'internal' | 'not_a_person' | 'declined'
}

/**
 * Which buttons a row gets.
 *
 * ⚠ CREATE IS WITHHELD FROM THREE OF THE FIVE CLASSES ON PURPOSE, and that is
 * the whole protection. A queue that offers the same two buttons for every row
 * has not classified anything — it has just moved the 96-way guess from the
 * model to a tired human at the end of a day.
 */
export function offeredActions(kind: AttendeeClass): OfferedActions {
  switch (kind) {
    case 'internal':
      // They are on the team, so they already have a contact. Linking is the
      // whole job; creating would make a second row for one of our own.
      return { create: false, link: true, skip: true, skipReason: 'internal' }
    case 'organization':
      // An organization belongs in `parties` with `is_organization`, which the
      // directory already holds — so it may be LINKED to one. It is never made
      // a person, because `meeting_attended` exists to answer "when did I last
      // speak to this person" and our own company cannot answer it.
      return { create: false, link: true, skip: true, skipReason: 'organization' }
    case 'label':
      return { create: false, link: false, skip: true, skipReason: 'not_a_person' }
    case 'fragment':
      return { create: false, link: true, skip: true, skipReason: 'declined' }
    case 'candidate':
      return { create: true, link: true, skip: true, skipReason: 'declined' }
  }
}

/** One row of the findings queue: a name, and every call it was heard on. */
export interface AttendeeFinding {
  /** `lower(trim(name))` — the key the skip tombstone and the grouping use. */
  nameKey: string
  name: string
  classification: ClassifiedName
  actions: OfferedActions
  /** The best role and company the recordings offered, for pre-filling a contact. */
  role: string | null
  company: string | null
  email: string | null
  /**
   * Other rows in this same queue that may be the same person.
   *
   * ⚠ A WARNING, NOT A MERGE. See pass three of buildAttendeeFindings.
   */
  alsoHeardAs?: string[]
  /** The conversations this name was heard on, newest first. */
  meetings: {
    id: string
    title: string | null
    date: string | null
    scope: string | null
    summary: string | null
  }[]
}

export interface MeetingWithAttendees {
  id: string
  title: string | null
  meeting_date: string | null
  scope: string | null
  summary: string | null
  attendees: RawAttendee[]
}

/**
 * Group every unlinked attendee across a set of meetings into one row per name.
 *
 * ⚠ ONE ROW PER NAME AND NOT PER SLOT, because the decision is about the name.
 * "Ber Wilson" appears on five calls; being asked five times is how a queue
 * becomes something nobody works. Resolving it once must resolve all five,
 * which is also why the skip tombstone is keyed on the name.
 *
 * Pure: it takes the rows and the facts about who we are, and returns the
 * findings. The caller does the reading and the writing.
 */
export function buildAttendeeFindings(
  meetings: MeetingWithAttendees[],
  internal: DirectoryFacts,
  skippedNameKeys: Set<string>,
): AttendeeFinding[] {
  // ── Pass one: gather every sighting of each name ────────────────────────────
  //
  // ⚠ CLASSIFY THE MERGED RECORD, NOT THE FIRST SIGHTING. This grouped first
  // and classified first-sighting-wins, and the live corpus caught it
  // immediately: "Brad" is heard twice, once with the company "Ber Wilson" and
  // once with nothing, and whichever came first decided the row — so a person
  // the recording placed inside our own company was being offered as an
  // external candidate, while the company column on the very same line said
  // "Ber Wilson". The screen was showing the merged facts and the verdict was
  // reading one of them. "New York Life" was the same bug in the other
  // direction: its name and its company are the same string, which is the test
  // that convicts it, and only one of its two sightings carried the company.
  const sightings = new Map<
    string,
    { attendee: RawAttendee; meetings: AttendeeFinding['meetings'] }
  >()

  for (const meeting of meetings) {
    for (const attendee of meeting.attendees ?? []) {
      // Already somebody's contact — nothing to decide.
      if (attendee.party_id) continue
      const rawName = (attendee.name ?? '').trim()
      if (!rawName) continue
      const nameKey = rawName.toLowerCase()
      if (skippedNameKeys.has(nameKey)) continue

      const sighting = {
        id: meeting.id,
        title: meeting.title,
        date: meeting.meeting_date,
        scope: meeting.scope,
        summary: meeting.summary,
      }

      const existing = sightings.get(nameKey)
      if (!existing) {
        sightings.set(nameKey, { attendee: { ...attendee }, meetings: [sighting] })
        continue
      }

      // Fill what an earlier sighting did not say; never overwrite what it did.
      // §12: filling a blank and overwriting a value are different acts, and
      // only one is safe to automate — the first sighting is as good evidence as
      // the second, so a coin flip between them is not an improvement.
      const merged = existing.attendee
      merged.role ??= attendee.role ?? null
      merged.org ??= attendee.org ?? null
      merged.company ??= attendee.company ?? null
      merged.email ??= attendee.email ?? null
      // ⚠ ADDITIVE, AND IT MAY CONVICT BUT NEVER ACQUIT (§12). One sighting
      // saying "organization" is evidence; another saying nothing is not a
      // rebuttal, and `??=` would let a `false` from the first sighting silence
      // a `true` from the second.
      if (attendee.is_organization === true) merged.is_organization = true

      if (!existing.meetings.some((m) => m.id === sighting.id)) {
        existing.meetings.push(sighting)
      }
    }
  }

  // ── Pass two: one verdict per name, from everything known about it ──────────
  const findings: AttendeeFinding[] = []
  for (const [nameKey, { attendee, meetings: seen }] of sightings) {
    const classification = classifyAttendee(attendee, internal)
    const name = classification.display.trim()
    if (!name) continue
    findings.push({
      nameKey,
      name,
      classification,
      actions: offeredActions(classification.kind),
      role: (attendee.role ?? '').trim() || null,
      company: (attendee.org ?? attendee.company ?? '').trim() || null,
      email: classification.email,
      meetings: [...seen].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')),
    })
  }

  // ── Pass three: flag the rows that look like each other ────────────────────
  //
  // ⚠ FLAG, NEVER FOLD. §12: prefer FLAGGING a suspected duplicate to folding
  // it, because marking is safe where it is wrong and merging is not. The live
  // corpus has "Jaren Davis", "Jaren L. Davis" and "Jiren Davis" as three rows
  // for what is almost certainly one person (the third being a transcription
  // slip), and "R. Thompson" beside "rthompson@goavant.com". Creating all five
  // would put three duplicates in the directory on the reader's first pass
  // through this queue — the exact failure the 10-22 session spent a day undoing.
  //
  // Matched with `nameMatches`, the §12 name rule already written and tested for
  // recorded calls: a surname whole, a first name only as a prefix of something
  // longer, and a prefix alone is never enough. That rule is why "Jaren Davis"
  // reaches "Jaren L. Davis" (the extra middle initial is not a disagreement)
  // and why "Mike Lee" does not reach "Mike".
  for (const finding of findings) {
    const alike: string[] = []
    for (const other of findings) {
      if (other === finding) continue
      if (nameMatches(finding.name, other.name) || nameMatches(other.name, finding.name)) {
        alike.push(other.name)
      }
    }
    if (alike.length > 0) finding.alsoHeardAs = alike
  }

  const order: Record<AttendeeClass, number> = {
    candidate: 0,
    fragment: 1,
    internal: 2,
    organization: 3,
    label: 4,
  }

  return findings.sort((a, b) => {
    // People we can act on first, then by how often we have met them — a name
    // heard on four calls is a relationship, and a name heard once may be a
    // passing mention.
    const byClass = order[a.classification.kind] - order[b.classification.kind]
    if (byClass !== 0) return byClass
    const byCount = b.meetings.length - a.meetings.length
    if (byCount !== 0) return byCount
    return a.name.localeCompare(b.name)
  })
}
