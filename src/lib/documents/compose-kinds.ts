/**
 * THE REGISTRY OF DOCUMENTS BER AI CAN WRITE.
 *
 * Every kind here was asked for out loud. Measured 2026-10-22 across all 78
 * questions ever put to the agent: 20 ask for a deliverable rather than an
 * answer, and these eight shapes cover all 20. The counts are in the comments
 * because a kind nobody asked for is a kind that will rot.
 *
 * ⚠ ONE HOME, AND EVERY KIND-KEYED STRUCTURE IS DERIVED FROM IT (§12). The
 * picker, the prompt's enumeration, the `doc_type` on the filed row and the
 * file name all read this map. The thing being replaced is the `draft` tool's
 * hand-written `kind: 'email' | 'agenda' | 'report'` — three values that had
 * already drifted against the 20 real asks before anyone counted them, because
 * a hand-written enumeration beside a registry drifts and a comment saying so
 * does not stop it.
 *
 * ⚠ THE DECLARATION ORDER IS THE READING ORDER. The picker renders this map in
 * sequence, so the order below is a UI decision, not an alphabetical accident.
 *
 * ⚠ NOT A DATABASE TABLE, AND THAT IS DELIBERATE. Each kind carries a prompt
 * shape and a structural choice in code, so adding one is necessarily a code
 * change — the test §12 sets for CHECK-vs-table, answered the opposite way from
 * `lead_categories`. `composed_documents.document_kind` is plain text so an
 * older row's kind survives this file dropping it.
 */

/**
 * Whether a kind is legally consequential.
 *
 * ⚠ THIS IS THE AGENT PERSONA'S OWN RULE, NOT A NEW ONE. The Construction
 * Executive Agent is defined to "never substitute for legal/tax counsel"
 * (CLAUDE.md §5), and an offer to purchase or a partnership structure is
 * exactly where that bites. A document carrying this flag says on its face that
 * it was drafted from the corpus and reviewed by nobody — so it can be sent to
 * counsel as a starting point, which is what it is, rather than read as a
 * cleared instrument because it came out of the company's own system.
 */
export type LegalWeight = 'routine' | 'needs_counsel'

export interface ComposeKindSpec {
  /** The picker's label. */
  label: string
  /** One line under the label: what this produces, in the reader's words. */
  description: string
  /**
   * `doc_type` on the filed row. ⚠ `doc_type` has no CHECK and several writers,
   * so the ROWS are its registry (§12) — a new value here simply appears in the
   * Documents tab's derived filter, which is the intended behaviour.
   */
  docType: string
  /** Used to build the file name, e.g. "GridEdge — Offer". */
  fileNoun: string
  /**
   * What this document has to contain, read to the model verbatim. Written as
   * instructions to a construction EVP, because that is the persona answering.
   */
  guidance: string
  legal: LegalWeight
  /**
   * Whether the deal's own figures are injected and the figure guard runs.
   *
   * False for the kinds that are structurally about people or sequence rather
   * than money — an agenda with no figures in it is correct, and running the
   * guard over one only invites a false refusal.
   */
  usesFigures: boolean
}

export const COMPOSE_KINDS: Record<string, ComposeKindSpec> = {
  // Asked six times for GridEdge and three times for IAN, and never delivered.
  // The single most-repeated unmet request in the log.
  offer: {
    label: 'Offer to purchase',
    description: 'An offer or acquisition proposal, built from everything on the deal.',
    docType: 'offer',
    fileNoun: 'Offer',
    guidance: [
      'Write an offer to purchase. Open with what is being acquired and from whom.',
      'State the consideration, the structure (what is paid at closing and what is',
      'contingent or deferred), the conditions to closing, the diligence period, and',
      'what happens to existing contracts, licences and key people. Close with a',
      'response date. Where a term has not been agreed, write the term and mark it',
      '[TO BE AGREED] — never invent a number, a date or a percentage.',
    ].join(' '),
    legal: 'needs_counsel',
    usesFigures: true,
  },

  // "I want to create a 1 pager document describing our master development plan",
  // "I need to create a 1 pager document that describes a single site architecture
  // and data resilience plan." Twice, in the same shape.
  one_pager: {
    label: 'One-pager',
    description: 'A single page explaining the deal or the plan to someone outside it.',
    docType: 'capability',
    fileNoun: 'One-pager',
    guidance: [
      'Write ONE page for a reader who knows nothing about this. Lead with what it',
      'is and why it is worth their time, then the substance in three or four short',
      'sections with headings, then what you are asking of the reader. No preamble,',
      'no restating the question. If it does not fit on a page it is not a one-pager.',
    ].join(' '),
    legal: 'routine',
    usesFigures: true,
  },

  proposal: {
    label: 'Proposal',
    description: 'A response to an opportunity: approach, qualifications, why us.',
    docType: 'proposal',
    fileNoun: 'Proposal',
    guidance: [
      'Write a proposal. Cover the understanding of the requirement, the approach,',
      'the team and relevant past performance, the schedule, and the commercial',
      'terms. Ground the qualifications in the company profile you were given and',
      'claim nothing it does not support.',
    ].join(' '),
    legal: 'routine',
    usesFigures: true,
  },

  // "I want create a partnership agreement with Tensor."
  // Deliberately an OUTLINE: see LegalWeight above.
  term_sheet: {
    label: 'Term sheet / structure outline',
    description: 'The deal terms as a structured outline for counsel to paper.',
    docType: 'term_sheet',
    fileNoun: 'Term sheet',
    guidance: [
      'Write a term sheet, not an executed agreement. One line per term, grouped:',
      'parties and vehicle, contributions, economics and splits, governance and',
      'control, exclusivity, term and termination, conditions precedent. This goes',
      'to counsel to paper, so where the corpus does not settle a term, write the',
      'term and mark it [TO BE AGREED] rather than drafting around the gap.',
    ].join(' '),
    legal: 'needs_counsel',
    usesFigures: true,
  },

  // "Review the documents on this project and tell me everything I need to know",
  // asked four times in the dock — which is a document, not a chat turn.
  memo: {
    label: 'Briefing memo',
    description: 'Everything you need to know about this deal, written down.',
    docType: 'diligence',
    fileNoun: 'Briefing memo',
    guidance: [
      'Write an internal briefing memo. Where the deal stands, what is agreed and',
      'what is not, who the parties are and what each wants, the money, the open',
      'risks, and the next decision to be taken. Say plainly what is not known —',
      'a gap named is useful and a gap filled in is not.',
    ].join(' '),
    legal: 'routine',
    usesFigures: true,
  },

  status_report: {
    label: 'Status report',
    description: 'Progress, risks and what changed, for someone who needs an update.',
    docType: 'report',
    fileNoun: 'Status report',
    guidance: [
      'Write a status report. What has moved since the last update, what is blocked',
      'and on whom, the dates that matter next, and the risks worth raising. Lead',
      'with anything the reader has to act on.',
    ].join(' '),
    legal: 'routine',
    usesFigures: true,
  },

  agenda: {
    label: 'Meeting agenda',
    description: 'An agenda for a call or meeting on this deal.',
    docType: 'correspondence',
    fileNoun: 'Agenda',
    guidance: [
      'Write a meeting agenda: the purpose in one line, then the items in the order',
      'they should be taken, each with who leads it and what decision or outcome is',
      'wanted. Put the open obligations on both sides at the end as a check.',
    ].join(' '),
    legal: 'routine',
    usesFigures: false,
  },

  // "copy the complete bios so I can paste them in a document", and
  // "List out each of Eric's license and why they are valuable for Ber Wilson".
  bio_sheet: {
    label: 'Team / bio sheet',
    description: 'The key people, their background and why they matter here.',
    docType: 'capability',
    fileNoun: 'Team sheet',
    guidance: [
      'Write a team sheet. One short section per person: name, role, and the',
      'background and credentials that matter for THIS deal. Use the bios and',
      'licences in the corpus as written where they exist. Do not embellish a',
      'career, and leave out anyone the corpus says nothing about.',
    ].join(' '),
    legal: 'routine',
    usesFigures: false,
  },
}

export type ComposeKindKey = keyof typeof COMPOSE_KINDS

/**
 * Look a kind up by key.
 *
 * `hasOwnProperty` against a fixed map, matching `getChild` in
 * src/lib/records/children.ts: a request naming a kind this build does not know
 * is refused by NAME before any client is built or any model is called.
 */
export function composeKind(key: string | null | undefined): ComposeKindSpec | null {
  if (!key) return null
  return Object.prototype.hasOwnProperty.call(COMPOSE_KINDS, key)
    ? COMPOSE_KINDS[key]
    : null
}

/** Declaration order, which is the reading order. Read by the picker. */
export function composeKindList(): { key: string; spec: ComposeKindSpec }[] {
  return Object.entries(COMPOSE_KINDS).map(([key, spec]) => ({ key, spec }))
}

/** Every key, for a convention test and for the route's validation. */
export const COMPOSE_KIND_KEYS: string[] = Object.keys(COMPOSE_KINDS)

/**
 * The enumeration the PROMPT sees, generated from the same map the column
 * references.
 *
 * §12: a taxonomy written into a prompt is a second schema and it drifts
 * silently, because a category the model was never told about simply never
 * fires. Nothing anywhere else may spell these out.
 */
export function composeKindMenu(): string {
  return composeKindList()
    .map(({ key, spec }) => `- ${key}: ${spec.label} — ${spec.description}`)
    .join('\n')
}

/**
 * The line a legally-consequential document carries on its face.
 *
 * One string, one home: it goes in the document body AND in the text that says
 * the document is ready, and those two must not be able to disagree about
 * whether a thing has been reviewed.
 */
export const COUNSEL_NOTICE =
  'Drafted by Ber AI from the records on this deal. It has not been reviewed by counsel and is not legal advice — treat it as a starting point for review, not as a cleared instrument.'
