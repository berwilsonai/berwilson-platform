/**
 * What a thread says about WHICH PROPERTY, kept so the next thread files itself.
 *
 * The case that forced this: Highland Title sends a preliminary report and a plat
 * map per parcel, and every subject reads "62831 | Parcel No 02-0138-0000 /
 * Carbon County | NPS Holdings, LLC". Nothing in it names the deal — the project
 * is called "DUBHES Helper / Giovanni Resilience Campus" — so the router refused,
 * correctly, and the documents reached nothing. Four threads, fourteen files.
 *
 * The sender cannot be the answer. A title company works across many deals at
 * once, so "mail from Highland goes to Helper" would misfile the moment the
 * second acquisition opens. What IS durable is the property itself:
 *
 *   - A PARCEL NUMBER identifies a piece of ground permanently. It survives the
 *     sale, the rename and the re-plat.
 *   - The OWNING ENTITY identifies it for the length of a negotiation, which is
 *     the window that matters. Parcels arrive one at a time; the owner is what
 *     ties an assembly of them together, so a thread about a parcel never seen
 *     before still lands if it names an owner already on the record.
 *
 * So identifiers are LEARNED FROM A FILING DECISION rather than guessed. Filing
 * a thread onto a record is a person saying "this belongs here"; recording what
 * that thread was identified by turns one filing into a rule, which is exactly
 * the argument `match_aliases` already makes for names. The router then matches
 * them by containment as a FACT (`linked`), the way it already matches a
 * solicitation number — not as a similarity score that needs review.
 *
 * Deliberately not an AI pass. These are patterns with a shape; a regex is
 * reproducible, free, and explainable in the `reason` column a person has to be
 * able to argue with.
 */

import { sweepDb } from './db'
import type { LinkRecordKind } from './db'
import type { ThreadSummary } from '@/lib/ai/prompts/thread-summary'

/** Kinds that can own an identifier. Leads are transient; they get promoted. */
export type IdentifierRecordKind = 'project' | 'opportunity' | 'steel_deal'

export type IdentifierKind = 'parcel' | 'party'

export interface Identifier {
  kind: IdentifierKind
  /** As written, so a person can see what was recognised. */
  value: string
  /** Comparison key. */
  normalized: string
}

export function isIdentifierKind(kind: LinkRecordKind): kind is IdentifierRecordKind {
  return kind === 'project' || kind === 'opportunity' || kind === 'steel_deal'
}

/**
 * A parcel is recorded as "02-0138-0000" by the county, "02 0138 0000" on a plat
 * and "020138-0000" in an escrow file. Comparing digits and letters alone is what
 * makes a match actually a match — the same reasoning as
 * `normalizeSolicitation`, and the same floor: a handful of characters is a
 * coincidence, not an identifier.
 */
export function normalizeParcel(value: string): string | null {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9]/g, '')
  // Utah serial numbers run 8-12 digits; the shortest real APN formats are 8.
  // Below that a bare number is a year, a dollar figure or a suite number.
  if (cleaned.length < 7 || cleaned.length > 24) return null
  // Must be mostly digits. "parcelnorth" would otherwise survive the strip.
  const digits = cleaned.replace(/[^0-9]/g, '').length
  if (digits < 6) return null
  return cleaned
}

/** Legal entities compare on their words, so punctuation and case cannot split them. */
export function normalizeParty(value: string): string | null {
  const cleaned = value
    .toLowerCase()
    // Periods go FIRST so "L.L.C." collapses to "llc" rather than to "l l c",
    // which no suffix pattern would then match. The same company is written
    // "NPS Holdings, LLC", "NPS Holdings LLC" and "NPS Holdings, L.L.C." inside
    // one thread.
    .replace(/\./g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    // ⚠ ONLY GENUINE LEGAL FORMS. "Holdings", "Group", "Trust" and "Partners"
    // were in this list and should never have been: they are NAME words, and
    // stripping them reduced "NPS Holdings, LLC" to "nps", which then fell below
    // the length floor and was discarded entirely — so the owner of two of the
    // four Carbon County parcels was learned as nothing at all. Measured on the
    // real threads: Eaquinta survived, NPS did not.
    .replace(/\b(llc|inc|lp|llp|ltd|corp|corporation|company|co|incorporated)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  // One short word is not an identity — "Land", "Utah", "Title". Require either
  // two words or one long distinctive one.
  if (cleaned.length < 4) return null
  const words = cleaned.split(' ')
  if (words.length < 2 && cleaned.length < 6) return null
  return cleaned
}

/**
 * Parcel numbers, however the writer introduced them.
 *
 * Narrow on purpose, and the narrowness is the whole safety argument: a loose
 * numeric pattern matches dates, dollar figures, invoice numbers and phone
 * numbers, and a wrong identifier is worse than no identifier because a
 * containment match outranks every similarity score. So a number counts only
 * when a word announces it as a parcel.
 */
const PARCEL_PATTERN =
  /\b(?:parcel|a\.?p\.?n\.?|assessor'?s?\s+parcel|tax\s*(?:id|serial)|serial)\s*(?:no\.?|num(?:ber)?|#|id|:)?\s*([0-9][0-9a-z\s\-:.]{5,23}?)(?=\s*(?:[|,;)/]|$|\n|\sand\b|\sin\b))/gi

/**
 * Legal entities, by their suffix.
 *
 * An LLC/Inc/Trust suffix is what separates a company from a sentence, which is
 * why this reads right-to-left from the suffix rather than trying to recognise a
 * name. Capped at a short run of words so a comma-spliced paragraph cannot be
 * swallowed whole.
 */
const PARTY_PATTERN =
  /\b((?:[A-Z][A-Za-z0-9&'’.-]*\s+){0,4}[A-Z][A-Za-z0-9&'’.-]*,?\s+(?:LLC|L\.L\.C\.|Inc\.?|LP|L\.P\.|LLP|Ltd\.?|Corp\.?|Corporation|Trust|Holdings))\b/g

/**
 * Forms that describe a PLACE or a PUBLIC BODY rather than a party to one deal.
 *
 * ⚠ MEASURED, NOT GUESSED, AND THE MEASUREMENT CHANGED THE DESIGN. Run across
 * all 2,492 threads, the first version of this file produced 164 distinct party
 * identifiers, and the list was full of things that are on many deals at once by
 * their nature: "Carbon County" (10 threads), "Murray City", "City of West
 * Wendover", "Salt Lake Chamber", "U.S. Army Corps of Engineers, South Pacific
 * Division", "Bank of Utah". Learning "Carbon County" onto the Helper project
 * would file every thread in the corpus that mentions the county — which is every
 * thread about the parcels, the rail corridor and the campus alike.
 *
 * A county is not a counterparty. The test an identifier has to pass is not "is
 * this a real organisation" but "does this name belong to exactly one deal".
 */
const CIVIC = [
  'county',
  // Bare 'city', not just 'city of' — the tell in this corpus is "Salt Lake City
  // Corporation", which IS the municipality and reads exactly like a private
  // company. The cost of banning a genuine "City Electric Supply LLC" is one
  // extra click; the cost of learning a city is a whole city's mail on one deal.
  'city',
  'town of',
  'state of',
  'municipal',
  'district',
  'authority',
  'chamber',
  'department',
  'corps of engineers',
  'university',
  'school',
  'bank',
  'credit union',
  'association',
  'consulate',
  'embassy',
]

/**
 * Our own names, and the service providers who appear on every file.
 *
 * ⚠ WITHOUT THIS THE MECHANISM POISONS ITSELF. "Ber Wilson Company" is in the
 * subject line of Highland's mail, and learning it as an identifier on the
 * Helper project would file every thread in the corpus that names us — which is
 * most of them — onto that one record. The same is true of the title company,
 * the law firm and the bank: they are on many deals by their nature, which is
 * precisely what an identifier must not be.
 */
const NEVER_LEARN = [
  'ber wilson',
  'berwilson',
  'bear wilson',
  'highland title',
  'dino service',
  'dino plumbing',
  'baker law',
  'bakerhostetler',
  'first american',
  'fidelity national',
  'old republic',
  'stewart title',
  'wells fargo',
  'zions',
  'chase',
  'docusign',
  'google',
  'microsoft',
]

function banned(normalized: string): boolean {
  if (NEVER_LEARN.some((b) => normalized.includes(b))) return true
  return CIVIC.some((c) => normalized === c || normalized.includes(c))
}

/**
 * Every identifier a thread carries.
 *
 * Reads the subject, the summary's own counterparty field and the raw
 * correspondence. The subject is where a title company puts the parcel; the body
 * is where a deed abstract or a legal description does.
 */
export function extractIdentifiers(input: {
  subject: string | null
  rawMarkdown: string | null
  summary: ThreadSummary | null
}): Identifier[] {
  const out = new Map<string, Identifier>()
  const add = (kind: IdentifierKind, value: string, normalized: string | null) => {
    if (!normalized || banned(normalized)) return
    const key = `${kind}:${normalized}`
    if (out.has(key)) return
    out.set(key, { kind, value: value.trim(), normalized })
  }

  // Bounded: a long thread quotes the same header dozens of times, and the
  // identifiers worth having are always near the top of it.
  const body = (input.rawMarkdown ?? '').slice(0, 60_000)
  const haystack = [input.subject ?? '', body].join('\n')

  for (const m of haystack.matchAll(PARCEL_PATTERN)) {
    add('parcel', m[1], normalizeParcel(m[1]))
  }

  // ⚠ `summary.counterparty` IS DELIBERATELY NOT A SOURCE, and it was one until
  // the corpus was measured. It is the model's answer to "whose deal is this",
  // which sounds like exactly the right question and returns the wrong KIND of
  // answer: across 2,492 threads it produced bare personal names — "Charles
  // Manto", "Steve McCleery", "Amy Clark", and "Richard White", the reader
  // himself — alongside every civic body and bank in the portfolio. A person is
  // on many deals, and one of them is the person reading this.
  //
  // So the only source is a LEGAL-FORM SUFFIX in the SUBJECT. The suffix is what
  // separates a party from a phrase, and the subject is where the party that
  // filed the document put it. A body match sweeps up every firm in every
  // signature block — the escrow officer's own company, the lender, the surveyor
  // — and an identifier shared by many deals is the one thing this must never
  // store.
  for (const m of (input.subject ?? '').matchAll(PARTY_PATTERN)) {
    add('party', m[1], normalizeParty(m[1]))
  }

  return [...out.values()]
}

/**
 * Record what a filed thread was identified by, so the next one matches.
 *
 * Entirely non-fatal: the filing itself has already succeeded, and a missing
 * identifier costs only that the next thread needs the same click. Called from
 * every path that files with certainty — the hand-file button, a confirmed or
 * merged intake session, and the router's own `linked` matches.
 */
export async function learnIdentifiers(
  threadId: string,
  recordKind: LinkRecordKind,
  recordId: string
): Promise<Identifier[]> {
  if (!isIdentifierKind(recordKind)) return []

  try {
    const db = sweepDb()
    const { data } = await db
      .from('email_threads')
      .select('subject, raw_markdown, summary')
      .eq('id', threadId)
      .maybeSingle()
    if (!data) return []

    const row = data as {
      subject: string | null
      raw_markdown: string | null
      summary: unknown
    }
    const found = extractIdentifiers({
      subject: row.subject,
      rawMarkdown: row.raw_markdown,
      summary: (row.summary ?? null) as ThreadSummary | null,
    })
    if (found.length === 0) return []

    // Upsert rather than insert: filing a second thread about the same parcel
    // must not fail on the identifier it shares with the first.
    const { error } = await db.from('record_identifiers').upsert(
      found.map((i) => ({
        record_kind: recordKind,
        record_id: recordId,
        kind: i.kind,
        value: i.value,
        normalized: i.normalized,
        source_thread_id: threadId,
      })),
      { onConflict: 'record_kind,record_id,kind,normalized', ignoreDuplicates: true }
    )
    if (error) {
      console.error(`[identifiers] could not store for ${recordKind} ${recordId}:`, error.message)
      return []
    }
    return found
  } catch (err) {
    console.error(
      `[identifiers] learn failed for thread ${threadId}:`,
      err instanceof Error ? err.message : String(err)
    )
    return []
  }
}

export interface RecordIdentifierRow {
  record_kind: IdentifierRecordKind
  record_id: string
  kind: IdentifierKind
  value: string
  normalized: string
}

/**
 * Every stored identifier the MAIL ROUTER may match on.
 *
 * ⚠ FILTERED TO parcel/party ON PURPOSE, and the filter is a security-shaped
 * default rather than a convenience (§12: a filter belongs at the choke point).
 * The router matches identifiers by CONTAINMENT in a thread's text, as a fact
 * rather than a score — which is right for a parcel number and wrong for a
 * learned meeting title: "Uintah Basin" appears in the body of mail about three
 * different deals, and one coincidental mention would file that thread with
 * certainty. Meeting titles are matched whole, by name, in
 * {@link matchLearnedMeetingTitle} and nowhere else.
 *
 * An unfiltered `select` here is what a new identifier kind silently joins, so
 * the kinds are named rather than excluded.
 */
export async function loadIdentifiers(): Promise<RecordIdentifierRow[]> {
  const { data, error } = await sweepDb()
    .from('record_identifiers')
    .select('record_kind, record_id, kind, value, normalized')
    .in('kind', ['parcel', 'party'])
    .limit(5000)
  if (error) {
    console.error('[identifiers] could not load:', error.message)
    return []
  }
  return (data ?? []) as unknown as RecordIdentifierRow[]
}

/**
 * Threads that carry any of these identifiers and are filed on nothing.
 *
 * ⚠ THIS IS WHAT MAKES LEARNING RETROACTIVE, AND WITHOUT IT THE FEATURE HELPS
 * ONLY THE NEXT EMAIL. `routeThreads` reads `routed_at is null`, so a thread the
 * router has already refused is never reconsidered — learning a parcel from
 * thread one would leave its three siblings exactly where they were. Highland
 * sent four threads in two days; three of them were already routed and refused
 * by the time the fourth arrived.
 *
 * Returns thread ids for the caller to re-route explicitly.
 */
/**
 * The literal substring to look for in stored mail.
 *
 * Everything up to the first comma, which for a legal entity is the name without
 * its suffix ("NPS Holdings" out of "NPS Holdings, LLC") and for a parcel number
 * is the whole thing. `%` and `_` are PostgREST's own wildcards and have to go.
 */
function searchTermFor(value: string): string | null {
  const term = value.split(',')[0].replace(/[%_]/g, ' ').trim()
  return term.length >= 4 ? term : null
}

export async function threadsMatchingIdentifiers(
  identifiers: Identifier[]
): Promise<string[]> {
  if (identifiers.length === 0) return []

  const db = sweepDb()
  const hits = new Set<string>()

  for (const id of identifiers) {
    // Searched on the RAW TEXT rather than the normalized key, because raw text
    // is what is stored — the router's own normalized containment check is what
    // actually decides, so a false positive here costs one extra thread
    // considered and nothing more.
    //
    // ⚠ THE TERM IS THE VALUE UP TO ITS FIRST COMMA, not the whole value with the
    // comma scrubbed. "NPS Holdings, LLC" scrubbed becomes "NPS Holdings  LLC"
    // — two spaces where the comma was — which matches no real text anywhere,
    // and the sibling sweep would have silently found nothing for every party
    // written with a comma before its suffix. Which is how they are all written.
    const term = searchTermFor(id.value)
    if (!term) continue
    const { data, error } = await db
      .from('email_threads')
      .select('id')
      .ilike('raw_markdown', `%${term}%`)
      .limit(200)
    if (error) continue
    for (const row of (data ?? []) as Array<{ id: string }>) hits.add(row.id)
  }
  if (hits.size === 0) return []

  // Only threads filed on nothing. A thread already on a record stays there —
  // re-routing it could add a second link, and a document on two projects is a
  // misfiling that looks like thoroughness.
  const ids = [...hits]
  const { data: linked } = await db
    .from('thread_links')
    .select('thread_id')
    .in('thread_id', ids)
  const already = new Set(
    ((linked ?? []) as Array<{ thread_id: string }>).map((l) => l.thread_id)
  )
  return ids.filter((id) => !already.has(id))
}

// ─────────────────────────────────────────────────────────────────────────────
// Meeting titles
//
// Executives title a recurring call after the deal — "Ber Wilson/TensorIQ/Elite
// Solutions", "Ber Wilson/Tensor Discuss Uintah Basin" — and Meet stamps that
// title onto the transcript file. It is the ONLY filing key the importer gets:
// Drive exposes no conference id, and the body of a transcript names every deal
// anyone mentioned.
//
// So the title is learned exactly like a parcel number. The first call of a
// series is filed by a human; every later call with the same title files itself.
// The three dangers are different from a parcel's, and each has a guard:
//
//   - A GENERIC title ("Weekly Sync", "Catch up") belongs to no deal, and
//     learning one would file every future standup onto whatever record the
//     first one happened to concern. GENERIC_MEETING_WORDS plus the
//     identity-bearing-word floor is what refuses those.
//   - OUR OWN NAME leads most of these titles, so NEVER_LEARN applies here too.
//   - The MAIL ROUTER must not see these at all — see loadIdentifiers().
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Words a meeting title can be made entirely of while identifying nothing.
 *
 * Separate from the record-name stopwords in analyze-meeting.ts on purpose:
 * these are the vocabulary of CALENDAR INVITATIONS, not of project names.
 * "Review" and "Update" are in both lists for different reasons.
 */
const GENERIC_MEETING_WORDS = new Set([
  'meeting', 'meet', 'call', 'sync', 'syncup', 'standup', 'huddle', 'checkin',
  'check', 'in', 'catch', 'up', 'touch', 'base', 'weekly', 'daily', 'monthly',
  'quarterly', 'biweekly', 'recurring', 'intro', 'introduction', 'kickoff',
  'kick', 'off', 'discussion', 'discuss', 'review', 'update', 'updates',
  'followup', 'follow', 'status', 'briefing', 'brief', 'chat', 'conversation',
  'session', 'zoom', 'teams', 'google', 'notes', 'transcript', 'copy', 'draft',
  'and', 'the', 'with', 'for', 'our', 'their', 'team', 'internal', 'external',
  'new', 'old', 'next', 'last', 'morning', 'afternoon', 'am', 'pm',
])

/**
 * A meeting title reduced to its comparison key, or null when it identifies
 * nothing.
 *
 * ⚠ THE FLOOR IS "AT LEAST ONE WORD THAT IS NOT CALENDAR VOCABULARY", not a
 * length. "Weekly Project Review Meeting" is 29 characters and names no deal;
 * "Myton" is five and names one. A length rule gets both backwards.
 */
export function normalizeMeetingTitle(value: string): string | null {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned.length < 4) return null

  const words = cleaned.split(' ')
  // A date or time left on the title by a stamping convention is not identity.
  const identity = words.filter(
    (w) => w.length >= 3 && !GENERIC_MEETING_WORDS.has(w) && !/^\d+$/.test(w)
  )
  if (identity.length === 0) return null
  return cleaned
}

/**
 * Record the title segments a filed meeting was identified by.
 *
 * Non-fatal throughout, for the same reason the thread version is: the filing
 * has already succeeded, and a missing identifier costs only that the next call
 * in the series needs the same click.
 *
 * `source_thread_id` is NULL here — see the migration. A meeting is not a Gmail
 * thread and the column is an FK to one.
 */
export async function learnMeetingTitles(
  segments: string[],
  recordKind: LinkRecordKind,
  recordId: string
): Promise<string[]> {
  if (!isIdentifierKind(recordKind)) return []

  const rows = new Map<string, { value: string; normalized: string }>()
  for (const raw of segments) {
    const value = raw.trim()
    if (!value) continue
    const normalized = normalizeMeetingTitle(value)
    if (!normalized || banned(normalized)) continue
    if (!rows.has(normalized)) rows.set(normalized, { value, normalized })
  }
  if (rows.size === 0) return []

  try {
    const { error } = await sweepDb()
      .from('record_identifiers')
      .upsert(
        [...rows.values()].map((r) => ({
          record_kind: recordKind,
          record_id: recordId,
          kind: 'meeting_title',
          value: r.value,
          normalized: r.normalized,
          source_thread_id: null,
        })),
        { onConflict: 'record_kind,record_id,kind,normalized', ignoreDuplicates: true }
      )
    if (error) {
      console.error(`[identifiers] could not store meeting titles for ${recordKind} ${recordId}:`, error.message)
      return []
    }
    return [...rows.values()].map((r) => r.value)
  } catch (err) {
    console.error('[identifiers] learn meeting titles failed:', err instanceof Error ? err.message : String(err))
    return []
  }
}

/**
 * The record a meeting title was last filed onto, if exactly one.
 *
 * Matched on the WHOLE normalized segment, never by containment. A parcel number
 * is matched by containment because it appears inside a sentence; a meeting
 * title IS the field, so containment would only let "Uintah" file a call about
 * "Uintah Basin Rail Crossing" onto the wrong deal.
 *
 * Two records sharing a learned title refuses outright — §12, ambiguity must
 * mean no match. That is reachable in practice: one series of calls genuinely
 * can get filed onto two deals by two different people.
 */
export async function matchLearnedMeetingTitle(
  segments: string[]
): Promise<{ kind: IdentifierRecordKind; id: string } | null | 'ambiguous'> {
  const keys = segments
    .map((s) => normalizeMeetingTitle(s))
    .filter((k): k is string => !!k && !banned(k))
  if (keys.length === 0) return null

  const { data, error } = await sweepDb()
    .from('record_identifiers')
    .select('record_kind, record_id, normalized')
    .eq('kind', 'meeting_title')
    .in('normalized', keys)
  if (error || !data) return null

  const rows = data as unknown as Array<{
    record_kind: IdentifierRecordKind
    record_id: string
    normalized: string
  }>

  // Candidates are tried in the caller's order — narrowest segment first — so a
  // title that names both a programme and the deal inside it picks the deal.
  for (const key of keys) {
    const hits = rows.filter((r) => r.normalized === key)
    const distinct = new Map(hits.map((h) => [`${h.record_kind}:${h.record_id}`, h]))
    if (distinct.size === 1) {
      const only = [...distinct.values()][0]
      return { kind: only.record_kind, id: only.record_id }
    }
    if (distinct.size > 1) return 'ambiguous'
  }
  return null
}
