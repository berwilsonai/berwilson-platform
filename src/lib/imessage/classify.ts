/**
 * Decide whether a text conversation is business, at the CONVERSATION level.
 *
 * ⚠ PER CHAT, NOT PER MESSAGE, AND THAT IS A PRIVACY DECISION BEFORE IT IS AN
 * ACCURACY ONE. 305,107 messages here are overwhelmingly personal — family,
 * friends, 2FA codes, marketing. Classifying each message would leak the odd
 * private line out of an otherwise-personal thread every time a word matched
 * ("the closing is Friday" in a conversation about a house move). Classifying
 * the CONVERSATION means a personal thread is excluded whole, and the unit a
 * human can review and overrule is the unit the filter works on.
 *
 * The signals are deliberately boring and countable. §12: a noise filter must be
 * measured against the corpus and every clever version costs evidence — the
 * share-of-prose and share-of-short-tokens filters each withheld >11% of the
 * mail index including real bid invitations, while "density of ordinary words"
 * withheld 2.2% with no false positives. So: named records and deal vocabulary,
 * counted, with a floor. No model call, nothing probabilistic.
 *
 * ⚠ INDUSTRY WORDS ARE NOT EVIDENCE. `energy`, `power`, `steel`, `capital` and
 * `development` are in half this company's record names and also in ordinary
 * speech, so they are excluded from the name matcher for exactly the reason
 * `bfaenergy.com` once put its logo on Bloom Energy. Place names stay in —
 * Myton, Delta, Heber, Steelton and Stockton are what tell these deals apart.
 */

/**
 * Words that identify a trade conversation rather than a personal one.
 *
 * Chosen to be things people do not say to their family. "contract" and
 * "invoice" earn their place; "meeting", "call" and "tomorrow" do not, and are
 * deliberately absent — every personal thread contains them.
 */
const DEAL_TERMS = [
  // instruments and process
  'psa', 'loi', 'mnda', 'nda', 'term sheet', 'purchase agreement', 'subcontract',
  'change order', 'punch list', 'scope of work', 'rfp', 'rfq', 'bid', 'proposal',
  'addendum', 'solicitation', 'bonding', 'surety', 'lien waiver', 'retainage',
  'draw request', 'pay app', 'invoice', 'escrow', 'closing', 'due diligence',
  'title commitment', 'quitclaim', 'easement', 'right of way', 'entitlement',
  'rezone', 'zoning', 'plat', 'parcel', 'appraisal', 'survey', 'phase i', 'phase 1',
  // the trade
  'general contractor', 'subcontractor', 'punchlist', 'submittal', 'shop drawing',
  'permit', 'inspection', 'certificate of occupancy', 'notice to proceed',
  'mobilization', 'prefab', 'steel erection', 'tilt-up', 'megawatt', 'substation',
  'interconnect', 'offtake', 'ppa', 'acreage', 'acres',
  // money shapes
  'per square foot', 'psf', 'cost plus', 'gmp', 'lump sum', 'change directive',
]

/** Legal/industry filler that must never on its own identify a record. */
const GENERIC_NAME_WORDS = new Set([
  'the', 'and', 'of', 'for', 'at', 'in', 'on', 'to', 'a', 'an',
  'llc', 'lp', 'llp', 'inc', 'incorporated', 'corp', 'corporation', 'co',
  'company', 'companies', 'holdings', 'holding', 'group', 'partners',
  'partnership', 'ventures', 'capital', 'development', 'developments',
  'project', 'projects', 'program', 'site', 'sites', 'campus', 'park',
  'energy', 'power', 'solar', 'wind', 'steel', 'mining', 'minerals',
  'industrial', 'commercial', 'residential', 'housing', 'land', 'ranch',
  'data', 'center', 'centre', 'datacenter', 'infrastructure', 'utility',
  'construction', 'builders', 'contracting', 'contractors', 'properties',
  'property', 'realty', 'estate', 'investments', 'fund', 'phase',
  'north', 'south', 'east', 'west', 'new', 'old', 'upper', 'lower',
])

/**
 * Match a term as whole words, escaping regex metacharacters.
 *
 * Multi-word terms ("term sheet") keep their internal spacing; the boundaries
 * only guard the ends, so "term sheets" still matches.
 */
export function termRegex(term: string): RegExp {
  return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
}

/** A money figure big enough to be a deal rather than dinner. */
const BIG_MONEY = /\$\s?\d{1,3}(?:,\d{3}){1,}(?:\.\d+)?|\$\s?\d+(?:\.\d+)?\s?(?:k|m|mm|million|billion)\b/i

/**
 * Distinctive tokens of a record name — the matchable part.
 *
 * Shared with the egress guard's reasoning: ≥4 characters and not an industry
 * or legal word. A name made entirely of generic words yields nothing rather
 * than a token that matches half the corpus.
 */
export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !GENERIC_NAME_WORDS.has(t))
}

export interface ChatSignals {
  /** Handle matched a phone number on a known party. */
  knownParty: boolean
  /** Distinct record names named in the conversation. */
  namedRecords: string[]
  /** Distinct deal terms used. */
  dealTerms: string[]
  /** A money figure of deal size appeared. */
  bigMoney: boolean
  /** Looks like an automated sender — a short code, or no reply ever sent. */
  automated: boolean
}

export interface ChatVerdict {
  business: boolean
  score: number
  reason: string
  signals: ChatSignals
  /**
   * Every other participant is a team member.
   *
   * ⚠ THIS IS NOT A DEGREE OF BUSINESS, IT IS A DIFFERENT KIND. Ber Wilson is
   * two people — Eric is CEO, Richard is EVP — so their thread is the single
   * richest vein of real obligation in the corpus, not a thread to be scored
   * against deal vocabulary. What the flag changes is DOWNSTREAM:
   *
   *   - A commitment here is between two insiders, so `side` and `owner` must
   *     resolve to one of THEM. §12: for `side='them'` the owner is the
   *     counterparty, and resolving that to a teammate says someone owes
   *     themselves — and never print a reader's own name back at them as a
   *     third party.
   *   - No party or contact record should be created from it. Both people are
   *     already `team_members`; inventing a counterparty from a colleague is
   *     the same error one screen later.
   *   - An internal thread is the MOST likely place a protected deal is
   *     discussed, so containment matters more here, not less.
   */
  internal: boolean
}

export interface ClassifyInput {
  /** The chat's handle(s) — phone numbers or emails, as Messages stores them. */
  handles: string[]
  /** Decoded message bodies, in any order. */
  messages: string[]
  /** How many messages in this chat were sent BY Richard. */
  sentByMe: number
  /** Normalized 10-digit phone numbers belonging to known parties. */
  partyPhones: Set<string>
  /** Distinctive tokens of every project / party / entity name, pre-computed. */
  recordTokens: Map<string, string>
  /**
   * Records whose name reduces to a single distinctive token, which may
   * therefore match on their own. The caller decides this, because deciding it
   * requires knowing how rare the token is across the corpus — see
   * `rareTokens` in the survey.
   */
  singleTokenRecords: Set<string>
  /**
   * Normalized numbers whose conversations are never ingested, whatever they
   * score.
   *
   * ⚠ THIS IS FOR COLLEAGUES, AND IT IS NOT A NOISE FILTER. Richard's thread
   * with Eric scored 5 on six deal terms and a deal-size figure — it is
   * genuinely about the business, and it is also 3,654 messages of mixed
   * internal chatter with the other executive. A score cannot tell those
   * apart, because both halves are real. A named exclusion can.
   *
   * The cost is accepted deliberately: promises the two of them make to each
   * other by text will not reach the commitment ledger.
   */
  excludedHandles: Set<string>
  /**
   * Team members' numbers, excluding the owner's own.
   *
   * Derived from `team_members`, so adding a colleague needs no code change.
   */
  internalHandles: Set<string>
}

/** Digits only, US 10-digit form, so `+1 (801) 555-0100` and `8015550100` agree. */
export function normalizePhone(handle: string): string | null {
  const digits = handle.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1)
  if (digits.length === 10) return digits
  return null
}

/**
 * A short code is marketing or 2FA and never a counterparty.
 *
 * Five- and six-digit senders are the shape; an `@` handle is an iMessage
 * account and perfectly normal, so length is only consulted for numbers.
 */
function isShortCode(handle: string): boolean {
  const digits = handle.replace(/\D/g, '')
  return digits.length > 0 && digits.length <= 6 && !handle.includes('@')
}

/**
 * The bar. Two independent signals, or one strong one.
 *
 * Set here rather than inline so the survey script can report what moving it
 * would do, which is the only honest way to choose a threshold (§12: a fuzzy
 * threshold is measured against the real corpus, never chosen).
 */
export const BUSINESS_SCORE_FLOOR = 2

export function classifyChat(input: ClassifyInput): ChatVerdict {
  const {
    handles,
    messages,
    sentByMe,
    partyPhones,
    recordTokens,
    singleTokenRecords,
    excludedHandles,
    internalHandles,
  } = input

  /**
   * ⚠ CHECKED FIRST, AND IT OVERRIDES EVERY OTHER SIGNAL INCLUDING A KNOWN
   * PARTY. An excluded number is a decision a human made about a person, which
   * outranks anything the text of the conversation can suggest. Checked before
   * any body is examined, so an excluded thread is not even scanned.
   */
  const excludedHandle = handles.find((h) => {
    const n = normalizePhone(h)
    return n !== null && excludedHandles.has(n)
  })
  if (excludedHandle) {
    return {
      business: false,
      score: 0,
      reason: `excluded number (…${excludedHandle.slice(-4)})`,
      signals: {
        knownParty: false,
        namedRecords: [],
        dealTerms: [],
        bigMoney: false,
        automated: false,
      },
      internal: false,
    }
  }

  /**
   * ⚠ AN INTERNAL THREAD IS WORK, AND IS NOT SCORED.
   *
   * Eric's thread scores 5 on deal vocabulary, but that is incidental — it
   * would be the business whatever words were in it, because there are two
   * people in this company and that is the channel they run it on. Scoring a
   * colleague against the same vocabulary as a stranger was the mistake: it
   * first selected the thread for the wrong reason, then excluded it for the
   * wrong reason.
   *
   * The cost is accepted and stated plainly: the CONVERSATION is the unit, so
   * the personal part of a colleague's thread comes along with the work. That
   * is a real trade, and it is only acceptable because this index is local to
   * the two people already in the conversation.
   */
  const others = handles.filter((h) => {
    const n = normalizePhone(h)
    return n === null || !internalHandles.has(n)
  })
  const internal = handles.length > 0 && others.length === 0

  const knownParty = handles.some((h) => {
    const p = normalizePhone(h)
    return p !== null && partyPhones.has(p)
  })

  const automated =
    handles.every(isShortCode) ||
    // Never once replied to, across a conversation of any length: a broadcast.
    (sentByMe === 0 && messages.length >= 3)

  const haystack = messages.join('\n').toLowerCase()

  /**
   * ⚠ ONE TOKEN IS NOT A NAME MATCH — IT IS AN UNCHALLENGED ONE (§12).
   *
   * A record is named only when TWO of its distinctive tokens appear, or when
   * it has just one token and that token is rare in this corpus. The first
   * version accepted any single token and reported "names Case Garage, Harvest
   * Time Holdings" against a rugby group chat, because those names tokenize to
   * `case` and `time`. Co-occurrence is what makes "Delta Industrial Campus"
   * identifying without `delta` alone being so.
   */
  const hitsByLabel = new Map<string, number>()
  for (const [token, label] of recordTokens) {
    if (termRegex(token).test(haystack)) {
      hitsByLabel.set(label, (hitsByLabel.get(label) ?? 0) + 1)
    }
  }
  const namedRecords: string[] = []
  for (const [label, hits] of hitsByLabel) {
    const needed = singleTokenRecords.has(label) ? 1 : 2
    if (hits >= needed) namedRecords.push(label)
  }

  /**
   * ⚠ WORD BOUNDARIES, NOT `includes`. §12: a substring hint matches any word
   * that contains it. The first version used `includes` and `nda` matched
   * **Monday**, `bid` matched *forbid*, `plat` matched *plate* — which put "1
   * deal term" on almost every conversation in the corpus and was most of why
   * the first survey selected 94% of a personal message history.
   */
  const dealTerms = DEAL_TERMS.filter((t) => termRegex(t).test(haystack))
  const bigMoney = BIG_MONEY.test(haystack)

  const signals: ChatSignals = { knownParty, namedRecords, dealTerms, bigMoney, automated }

  // A known counterparty's own number is worth the whole bar by itself: the
  // directory entry is a human filing decision, which is the strongest evidence
  // available and the same reasoning that governs learned identifiers.
  let score = 0
  if (knownParty) score += 2
  if (namedRecords.length > 0) score += 2
  if (dealTerms.length >= 2) score += 1
  if (dealTerms.length >= 4) score += 1
  if (bigMoney) score += 1

  /**
   * ⚠ AUTOMATED OVERRIDES EVERYTHING EXCEPT A KNOWN PARTY. Insurance and
   * mortgage spam is written in deal vocabulary on purpose — "Self Employed or
   * Business Owner? You may qualify…" is in this corpus and scores on terms
   * alone. But a real counterparty texting from their own number is not
   * reclassified as spam because they happened to send three messages without a
   * reply yet.
   */
  if (internal) {
    return {
      business: true,
      score: 99,
      reason: 'internal — every other participant is on the team',
      signals,
      internal: true,
    }
  }

  if (automated && !knownParty) {
    return {
      business: false,
      score,
      reason: handles.every(isShortCode)
        ? 'short-code sender (marketing or 2FA)'
        : 'broadcast — never replied to',
      signals,
      internal: false,
    }
  }

  const business = score >= BUSINESS_SCORE_FLOOR
  const why: string[] = []
  if (knownParty) why.push('known party phone')
  if (namedRecords.length) why.push(`names ${namedRecords.slice(0, 3).join(', ')}`)
  if (dealTerms.length) why.push(`${dealTerms.length} deal term${dealTerms.length === 1 ? '' : 's'}`)
  if (bigMoney) why.push('deal-size figure')

  return {
    business,
    score,
    reason: why.length ? why.join('; ') : 'no business signal',
    signals,
    internal: false,
  }
}
