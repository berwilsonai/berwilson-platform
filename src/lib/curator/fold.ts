/**
 * The curator: what the correspondence already says, folded onto the record.
 *
 * ⚠ NO MODEL CALL. This was going to be one extraction per record until the
 * corpus was measured. `email_threads.summary` is jsonb and the sweep has
 * already pulled out location, sector, a prose summary and — the valuable part
 * — a `people[]` array with name, title, company and email for every
 * participant. §12: check whether the data is already on the row before calling
 * it an extraction problem; the /decide page looked like schema work and was a
 * UI change. Here it looked like 26 model calls (twenty minutes of a
 * single-threaded box, nightly) and it is a read.
 *
 * ⚠ AND MEASURING CHANGED WHAT THIS IS FOR. The assumption was that deal
 * records were the dirty thing. Measured 2026-10-12: projects have ONE blank
 * location, ZERO null sectors and ONE blank description across 19 rows;
 * opportunities are thinner but there are only 7 of them. The dirt is the
 * rolodex — 52 of 76 people carry no title, 36 no email, 28 no company —
 * against 144 linked threads whose summaries name those people with their
 * titles and addresses. So the main event here is contact enrichment and the
 * deal fields are the small half, which is the reverse of how it was planned.
 *
 * WHAT IS DELIBERATELY NOT FOLDED, each for a recorded reason:
 *   - `stage_signal` → `stage`. The signal is free prose ("LOI signed",
 *     "Teaming & contract execution"); `project_stage` members are
 *     pursuit/capture/bid/award/…. Mapping them is a second schema (§12).
 *   - `counterparty` → anything. §12: that extractor answered "whose deal is
 *     this" with `Carbon County`, `Bank of Utah` and `Richard White` — the
 *     reader himself. 164 candidate identifiers became 15 once it was dropped.
 *   - `estimated_value`. A human deliberately CLEARED it on 2026-10-05 ahead of
 *     the economics engine, which was itself removed on 2026-10-23 — so this is
 *     once again the ONLY column a deal's value lives in, and one project in
 *     thirty carries one. Re-filling it from prose is precisely the "something
 *     we did manually that isn't obvious she could update" case Richard carved
 *     out, and a number in an email is usually one party's ask rather than a
 *     settled price. It stays excluded outright rather than merely guarded, so
 *     it does not generate thirty cards asking to undo a decision.
 */

import { applyFieldUpdates, type AppliedField } from '@/lib/provenance/write'
import { PROJECT_SECTORS } from '@/lib/provenance/fields'
import { provDb, PEPPER_ACTOR, provDbAs } from '@/lib/provenance/db'
import { gatherEvidence, type EvidenceItem, type RecordKind, type ThreadPerson } from './evidence'

export interface PersonOutcome {
  partyId: string
  name: string
  written: AppliedField[]
  proposed: AppliedField[]
  /** Why nothing happened, when nothing did. */
  note?: string
  /**
   * Set only when this pass CREATED the contact rather than finding it.
   *
   * Present so the morning note can say "added" rather than "updated" — a
   * created record and a filled field are different events to a reader, and
   * §12's rule about one quantity with one definition applies to both.
   */
  created?: { email: string; phone: string | null; title: string | null; company: string | null }
}

export interface CurateOutcome {
  kind: RecordKind
  recordId: string
  name: string
  /** True when the cursor said the evidence had not moved. */
  skippedUnchanged: boolean
  written: AppliedField[]
  proposed: AppliedField[]
  /** Resolved and applied by the run, not by the record. See curateRecord. */
  mentions: PersonMention[]
  evidenceItems: number
  error: string | null
}

/** One sighting of a person in one piece of evidence. */
export interface PersonMention {
  person: ThreadPerson
  sourceKind: 'email_thread' | 'text_session'
  sourceRef: string
  sourceLabel: string
  at: string | null
}

/**
 * Curate one record.
 *
 * `force` ignores the cursor. Everything else about the pass is identical
 * either way — §12: never fork a shared pass, add a parameter.
 */
export async function curateRecord(args: {
  kind: RecordKind
  recordId: string
  name: string
  dryRun?: boolean
  force?: boolean
}): Promise<CurateOutcome> {
  const { kind, recordId, name, dryRun = false, force = false } = args
  const table = kind === 'project' ? 'projects' : 'opportunities'
  const base: CurateOutcome = {
    kind,
    recordId,
    name,
    skippedUnchanged: false,
    written: [],
    proposed: [],
    mentions: [],
    evidenceItems: 0,
    error: null,
  }

  const ev = await gatherEvidence({ kind, recordId })
  if (ev.error) return { ...base, error: ev.error }
  base.evidenceItems = ev.items.length
  if (ev.items.length === 0) return base

  // ── The cursor ────────────────────────────────────────────────────────────
  const cursor = await readCursor(table, recordId)
  if (cursor.error) return { ...base, error: cursor.error }
  if (
    !force &&
    cursor.evidenceThrough &&
    ev.newestAt &&
    ev.newestAt <= cursor.evidenceThrough
  ) {
    return { ...base, skippedUnchanged: true }
  }

  // ── Deal fields ───────────────────────────────────────────────────────────
  const threads = ev.items.filter((i) => i.structured)
  const deal = await foldDealFields({ table, recordId, name, threads, dryRun })
  base.written = deal.written
  base.proposed = deal.proposed
  if (deal.error) return { ...base, error: deal.error }

  // ── People are COLLECTED here and applied once per run ────────────────────
  //
  // ⚠ NOT APPLIED PER RECORD, AND THE DRY RUN IS WHY. `parties` is global, so
  // enriching per record meant eleven writes to Eric's row in one pass, each
  // overwriting the last with a different reading of his own title — "CEO",
  // "Chief Executive", "Founder & Chief Executive" — and whichever record
  // happened to run last won. Worse, Mark Welsko appeared twice inside ONE
  // record with two different companies ("Worldwide Environmental Services
  // [WES]" and "GridEdge"), because the first pass keyed mentions on
  // email-or-name and a person mentioned once with an address and once without
  // is two keys for one human. Deduping by the MATCHED PARTY, once, across the
  // whole run is the only version where "newest wins" means anything.
  base.mentions = collectMentions(threads)

  if (!dryRun) {
    await writeCursor(table, recordId, ev.newestAt, deal.written.length, deal.proposed.length, null)
  }

  return base
}

/** The handful of record-level fields the thread summaries actually carry. */
async function foldDealFields(args: {
  table: string
  recordId: string
  name: string
  threads: EvidenceItem[]
  dryRun: boolean
}): Promise<{ written: AppliedField[]; proposed: AppliedField[]; error: string | null }> {
  const { table, recordId, name, threads, dryRun } = args

  // Newest wins. `threads` arrives newest-first from gatherEvidence, so the
  // FIRST non-empty value is the most recent one — no sort here, deliberately,
  // so there is one ordering in the pass and not two that can disagree.
  const pick = (read: (s: NonNullable<EvidenceItem['structured']>) => unknown) => {
    for (const t of threads) {
      const v = read(t.structured!)
      if (v !== null && v !== undefined && String(v).trim() !== '') {
        return { value: v, from: t }
      }
    }
    return null
  }

  const updates = []

  const location = pick((s) => s.location)
  // ⚠ A LIST OF PLACES IS NOT A PLACE. Measured on the live corpus: the IAN
  // opportunity's newest thread gives `PA, WV, Steelton, Weirton, Dauphin,
  // Brooke, Hancock` — seven names, because the thread covers a multi-site
  // acquisition. Real locations here run to three parts at most ("Riverdale,
  // Cook County, IL (Chicago)"), so four or more is the signal. Refusing
  // costs nothing: the field was blank and stays blank, where writing it
  // would put a list in a column a map and a reader both treat as one place.
  if (location && String(location.value).split(',').length <= 3) {
    updates.push({
      field: 'location',
      value: String(location.value).trim(),
      // See FieldUpdate.fillOnly. A thread covering Steelton, Riverdale and
      // Weirton is linked to all three and its location is all three names.
      fillOnly: true,
      sourceKind: location.from.kind === 'text_session' ? ('text_session' as const) : ('email_thread' as const),
      sourceRef: location.from.ref,
      evidence: `"${location.from.label}" — ${firstLine(location.from.text)}`,
      asOf: location.from.at ?? undefined,
    })
  }

  const sector = pick((s) => s.sector)
  if (sector) {
    const raw = String(sector.value).trim()
    // ⚠ A project's sector is a real enum; an opportunity's is plain text.
    // `canWrite` enforces the enum anyway, but checking here means the skip is
    // reported against a named value rather than swallowed.
    const usable = table === 'projects' ? (PROJECT_SECTORS as readonly string[]).includes(raw) : true
    if (usable) {
      updates.push({
        field: 'sector',
        value: raw,
        // One thread's guess must not overrule a considered classification:
        // the dry run moved four projects off infrastructure/government.
        fillOnly: true,
        sourceKind: 'email_thread' as const,
        sourceRef: sector.from.ref,
        evidence: `"${sector.from.label}" — ${firstLine(sector.from.text)}`,
        asOf: sector.from.at ?? undefined,
      })
    }
  }

  if (updates.length === 0) return { written: [], proposed: [], error: null }

  const result = await applyFieldUpdates({
    table,
    recordId,
    recordLabel: name,
    updates,
    dryRun,
  })
  return { written: result.written, proposed: result.proposed, error: result.error }
}

/** Every person named in this record's evidence, with where it was seen. */
function collectMentions(threads: EvidenceItem[]): PersonMention[] {
  const out: PersonMention[] = []
  for (const t of threads) {
    for (const p of t.structured?.people ?? []) {
      if (p.is_organization) continue
      if (!p.name?.trim() && !p.email?.trim()) continue
      out.push({
        person: p,
        sourceKind: t.kind === 'text_session' ? 'text_session' : 'email_thread',
        sourceRef: t.ref,
        sourceLabel: t.label,
        at: t.at,
      })
    }
  }
  return out
}

/**
 * Fill in the contacts the mail already describes — once, for the whole run.
 *
 * ⚠ MATCHED BY EMAIL, OR BY A UNIQUE FULL NAME OF AT LEAST TWO WORDS, OR NOT
 * AT ALL. §12 three times over: a mailbox is a better key than a name; one
 * match is not a unique match but an unchallenged one, and a lone hit on a weak
 * key resolved "Cliff" to an unrelated academic on a live deal; and ambiguity
 * must mean NO match rather than a guess. An unmatched person is REPORTED
 * rather than created — creating a party from mail is record creation, which
 * §11 still reserves for a human confirm, and Richard's 10-12 direction was
 * about UPDATING the CRM, not populating it unattended.
 *
 * ⚠ DEDUPED BY THE MATCHED PARTY, NOT BY THE NAME IN THE MAIL. One human can
 * be named several ways across a corpus; the party row is the identity.
 */
export async function applyPeople(args: {
  mentions: PersonMention[]
  dryRun: boolean
  /**
   * Fill blanks only, never replace a value that is already there.
   *
   * ⚠ WHICH ACT IS SAFE DEPENDS ON THE SOURCE, NOT ON THE FIELD (§12). The
   * record pass reads the evidence of ONE deal, where a person named on that
   * deal's own correspondence is being described; overwriting there is right.
   * The rolodex sweep reads every thread in the corpus, where most sightings
   * are incidental — and its dry run proved the difference: it proposed
   * `Timothy Seibert: Managing Member → CEO`, `Rebecca Leonardi: Transaction
   * lead → CEO`, `Ocean Patel: Myton Land Owner → Energence` and, worst,
   * `Mark Urbina: mark.urbina@noircgrp.com → mark.urbina@gmail.com` —
   * trading a work address for a personal one on the strength of one mention.
   * So the broad source fills and the narrow source decides.
   */
  fillOnly?: boolean
  /**
   * Create a contact when none matched, instead of reporting the name.
   *
   * ⚠ OFF BY DEFAULT, AND ONLY `curator/contacts.ts` TURNS IT ON. §11 reserves
   * record creation for a human confirm; Richard amended it on 2026-10-15 for
   * contacts alone and only where the mail is RECIPROCATED — one of the two
   * executives wrote on the thread. That gate cannot be judged here, where a
   * mention has no thread, so the caller owns it: this flag is the target
   * `applyPeople` adds rather than a second copy of the pass (§12).
   *
   * Everything that makes the matching safe runs first regardless — a creation
   * only ever happens after `matchParty` has declined, which is what stops it
   * duplicating a contact that already exists under another spelling.
   */
  allowCreate?: boolean
}): Promise<{ outcomes: PersonOutcome[]; unmatched: string[]; refused: string[]; error: string | null }> {
  const { mentions, dryRun, fillOnly = false, allowCreate = false } = args

  // ⚠ OUR OWN PEOPLE ARE NEVER CURATED FROM MAIL, AND THE DRY RUN IS WHY. It
  // proposed `Richard White: Title="Advisor"` — a model's incidental role guess
  // for one thread, about to be written onto the reader's own contact record.
  // Eric fared no better, collecting "CEO", "Chief Executive" and "Founder &
  // Chief Executive" from three threads. An internal person's title is an
  // EMPLOYMENT fact that lives in `personnel` (§4) and is set by a human; it is
  // not a thing to read out of correspondence. Related to §12's rule against
  // printing a reader's own name back at them: the platform should not tell
  // Richard who Richard is.
  const internal = await loadInternalPartyIds()
  if (internal.error) return { outcomes: [], unmatched: [], refused: [], error: internal.error }

  // Newest first, so the first mention that resolves to a party is the one
  // whose title and company are used.
  const ordered = [...mentions].sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))

  // Per party, the newest non-empty value for EACH field — not the newest
  // mention wholesale. ⚠ The dry run showed why: Richard's party row was named
  // in a later thread that carried no address, so taking that mention whole
  // discarded the email a slightly older thread had. "Newest wins" is a rule
  // about a VALUE, not about a sighting.
  const byParty = new Map<string, { party: PartyLite; fields: Map<string, { value: string; mention: PersonMention }> }>()
  const unmatched = new Set<string>()
  // Reasons a lookup declined, reported so a gate nobody can see is not a
  // black hole (§12). Keyed like `matchCache` so one address is asked once.
  const refused = new Set<string>()
  const refusalCache = new Map<string, string>()
  const matchCache = new Map<string, PartyLite | null>()
  /** Parties this call brought into existence, for the outcome's `created`. */
  const createdIds = new Map<
    string,
    { email: string; phone: string | null; title: string | null; company: string | null }
  >()

  for (const m of ordered) {
    const key = (m.person.email?.trim().toLowerCase() || m.person.name?.trim().toLowerCase()) ?? ''
    if (!key) continue
    let party = matchCache.get(key)
    let refusedReason: string | null = refusalCache.get(key) ?? null
    if (party === undefined && refusedReason === null) {
      const found = await matchParty(m.person)
      if (found.error) return { outcomes: [], unmatched: [], refused: [], error: found.error }
      if (found.lookup.kind === 'match') {
        party = found.lookup.party
        matchCache.set(key, party)
      } else if (found.lookup.kind === 'refused') {
        refusedReason = found.lookup.reason
        refusalCache.set(key, refusedReason)
      } else {
        party = null
        matchCache.set(key, null)
      }
    }
    // ⚠ A REFUSAL MAY NOT CREATE. The lookup found something it declined to
    // use — a shared address, an organization row, a contact a human archived
    // — so adding a row would be the duplicate that guarantees tomorrow's
    // refusal. Report it and move on.
    if (refusedReason) {
      refused.add(refusedReason)
      continue
    }
    if (!party) {
      const name = m.person.name?.trim()
      // ⚠ THE INTERNAL TEST COMES BEFORE CREATION, NOT AFTER. The check below
      // runs on a party that already exists; an address of ours that has no
      // contact row yet would sail past it and be created as a counterparty.
      // That is how `berwilsonllc@outlook.com` — Eric's own alternate, on no
      // `team_members` row — showed up as an external candidate in the 10-15
      // dry run.
      const created =
        allowCreate && !isInternalAddress(m.person.email ?? null)
          ? await createContact(m, dryRun)
          : null
      if (created?.error) return { outcomes: [], unmatched: [], refused: [], error: created.error }
      if (created?.party) {
        party = created.party
        matchCache.set(key, party)
        createdIds.set(party.id, {
          email: m.person.email?.trim().toLowerCase() ?? '',
          phone: m.person.phone ?? null,
          title: m.person.title ?? null,
          company: m.person.company ?? null,
        })
        // ⚠ A DRY RUN HAS NO ROW TO WRITE AGAINST. `applyFieldUpdates` reads
        // the record to capture `previous_value`, so handing it a sentinel id
        // fails the whole pass with a uuid syntax error — which is exactly what
        // the first dry run did. The creation is reported from `createdIds`
        // instead, carrying the fields it would have filled.
        if (dryRun) continue
      } else {
        if (name && isReportableName(name)) unmatched.add(name)
        continue
      }
    }
    // ⚠ THE INCOMING ADDRESS AS WELL AS THE STORED ONE. Checking only
    // `party.email` lets an internal person through whenever their contact row
    // has no address yet — which is exactly the row most in need of filling,
    // and precisely how `info@berwilson.com`, the assistant's own seat, came up
    // for writing onto a party record in the sweep's dry run.
    if (
      internal.ids.has(party.id) ||
      isInternalAddress(party.email) ||
      isInternalAddress(m.person.email ?? null)
    ) {
      continue
    }
    let entry = byParty.get(party.id)
    if (!entry) {
      entry = { party, fields: new Map() }
      byParty.set(party.id, entry)
    }
    for (const [field, raw] of [
      ['title', m.person.title],
      ['company', m.person.company],
      ['email', m.person.email],
      ['phone', m.person.phone],
    ] as const) {
      const value = raw?.trim()
      if (!value) continue
      // `ordered` is newest-first, so the first value seen for a field wins.
      if (!entry.fields.has(field)) entry.fields.set(field, { value, mention: m })
    }
  }

  const outcomes: PersonOutcome[] = []
  for (const { party, fields } of byParty.values()) {
    const updates = [...fields.entries()].map(([field, { value, mention }]) => ({
      field,
      value,
      fillOnly,
      sourceKind: mention.sourceKind,
      sourceRef: mention.sourceRef,
      evidence: `named in "${mention.sourceLabel}"`,
      asOf: mention.at ?? undefined,
    }))
    if (updates.length === 0) continue

    const result = await applyFieldUpdates({
      table: 'parties',
      recordId: party.id,
      recordLabel: party.full_name,
      updates,
      dryRun,
    })
    if (result.error) return { outcomes, unmatched: [...unmatched], refused: [...refused], error: result.error }
    const created = createdIds.get(party.id)
    if (result.written.length > 0 || result.proposed.length > 0 || created) {
      outcomes.push({
        partyId: party.id,
        name: party.full_name,
        written: result.written,
        proposed: result.proposed,
        ...(created ? { created } : {}),
      })
    }
  }

  // ⚠ A CREATION WITH NOTHING LEFT TO FILL IS STILL AN EVENT. `byParty` only
  // holds parties that collected a field, so a contact created from an address
  // and a name alone — no title, no company, no phone in the signature — would
  // otherwise be inserted and never reported, which is the one failure mode
  // unattended writing may not have (run.ts's header).
  for (const [partyId, created] of createdIds) {
    if (outcomes.some((o) => o.partyId === partyId)) continue
    const fromBatch = [...byParty.values()].find((e) => e.party.id === partyId)?.party.full_name
    const fromCache = [...matchCache.values()].find((p) => p?.id === partyId)?.full_name
    outcomes.push({
      partyId,
      name: fromBatch ?? fromCache ?? created.email,
      written: [],
      proposed: [],
      created,
    })
  }

  return { outcomes, unmatched: [...unmatched].sort(), refused: [...refused].sort(), error: null }
}

/**
 * Bring a contact into existence from correspondence.
 *
 * ⚠ THE NARROWEST POSSIBLE INSERT. Only identity goes in — the name, the
 * address, the flag and a provenance line. Title, company and phone are left
 * to `applyFieldUpdates` immediately afterwards so each one gets a
 * `record_field_provenance` row carrying its evidence and a `previous_value`,
 * which is what makes every one of them individually reversible. Writing them
 * here would create the record with no provenance at all.
 *
 * ⚠ A TWO-WORD NAME IS REQUIRED. `matchParty` can never resolve a bare first
 * name, so creating one guarantees a contact nobody can find and a duplicate
 * the next time the surname appears (§12).
 */
const DRY_RUN_ID = 'dry-run'

async function createContact(
  m: PersonMention,
  dryRun: boolean
): Promise<{ party: PartyLite | null; error: string | null }> {
  const name = m.person.name?.trim()
  const email = m.person.email?.trim().toLowerCase()
  if (!name || !email) return { party: null, error: null }
  if (!isReportableName(name) || name.split(/\s+/).length < 2) return { party: null, error: null }

  if (dryRun) {
    return {
      party: { id: `${DRY_RUN_ID}:${email}`, full_name: name, email, is_organization: false },
      error: null,
    }
  }

  const { data, error } = await provDbAs(PEPPER_ACTOR)
    .from('parties')
    .insert({
      full_name: name,
      email,
      is_organization: false,
      // The tag is the handle for undoing a whole run: every contact this pass
      // has ever created is selectable, and `/api/parties/bulk-delete` already
      // archives in bulk without deleting anything.
      tags: ['auto-contact'],
      relationship_notes: `Added by Pepper from "${m.sourceLabel}" — correspondence an executive took part in.`,
    })
    .select('id, full_name, email, is_organization')
    .single()

  if (error) return { party: null, error: `could not add ${name}: ${error.message}` }
  return { party: data as PartyLite, error: null }
}

/**
 * Party ids that belong to our own team, who are not curated from mail.
 *
 * Read from `team_members.party_id` — the link that exists precisely so a task
 * owner and a contact are one person (§9) — rather than guessed from a name.
 */
async function loadInternalPartyIds(): Promise<{ ids: Set<string>; error: string | null }> {
  const { data, error } = await provDb().from('team_members').select('party_id')
  if (error) return { ids: new Set(), error: `internal parties: ${error.message}` }
  const ids = new Set<string>()
  for (const row of (data ?? []) as { party_id: string | null }[]) {
    if (row.party_id) ids.add(row.party_id)
  }
  return { ids, error: null }
}

/**
 * A second, independent test for our own people.
 *
 * ⚠ BOTH TESTS, NOT ONE. `team_members` holds three rows; the directory holds
 * several of our own addresses that are not team members (an old alias, a
 * shared seat). Keying on the ADDRESS is the structural half — §12's lesson
 * from the Pepper self-loop, where a guard on a display name was defeated by a
 * rename that was itself a good idea.
 */
function isInternalAddress(email: string | null): boolean {
  if (!email) return false
  return /@berwilson\.com\s*$/i.test(email.trim())
}

/**
 * Is this unmatched name worth putting in front of a human?
 *
 * ⚠ THE RAW LIST WAS 104 NAMES AND MOSTLY NOISE: `Unknown`, `Unknown Sender`,
 * `+13854366519`, `Ber Wilson`, `Moose`, and forty bare first names that
 * `matchParty` can never resolve by design. A report that long is one nobody
 * reads, and §12's rule about unlabelled counts applies to lists too — the
 * number has to mean something. So this reports the names that COULD have
 * matched and did not, which is the actionable set, and the rest are counted
 * nowhere because they are not findings.
 */
function isReportableName(name: string): boolean {
  const n = name.trim()
  // A bare first name can never match (two-word minimum), so it is not a gap.
  if (n.split(/\s+/).filter(Boolean).length < 2) return false
  if (/^\+?\d[\d\s().-]{6,}$/.test(n)) return false
  if (/^unknown\b/i.test(n)) return false
  // Our own company is an organisation, not a missing contact.
  if (/^ber\s*wilson$/i.test(n)) return false
  return true
}

export interface PartyLite {
  id: string
  full_name: string
  email: string | null
  /**
   * ⚠ CARRIED SO A PERSON-MENTION CAN NEVER RESOLVE TO AN ORGANIZATION. §12: a
   * person-shaped field a model filled holds organizations — our own company
   * "attended" four of its own calls — so the decision is the
   * `is_organization` FLAG and never the name. Found by the rolodex sweep's
   * dry run, which proposed writing `Title = CEO/Founder`,
   * `Company = Ber Wilson` and `Email = info@berwilson.com` onto the party row
   * for Ber Wilson itself: the model had marked the sighting as a person, and
   * nothing downstream re-checked.
   */
  is_organization: boolean | null
  /**
   * Whether a human has archived this contact.
   *
   * Read so the archive is a mark the pass respects rather than a state it
   * re-creates around — see `PartyLookup` below.
   */
  status?: string | null
}

/**
 * The three ways a lookup can end, which are not one answer.
 *
 * ⚠ A REFUSAL IS NOT AN ABSENCE, AND COLLAPSING THEM MANUFACTURES THE
 * DUPLICATE THAT GUARANTEES THE NEXT REFUSAL. This returned
 * `{ party: null }` for all three outcomes and the caller creates a contact
 * whenever it gets null, so every refusal added a row:
 *
 *   - two parties already on one address → "a data problem, not a match"
 *     → created a THIRD, which is still two-or-more next time. Self-amplifying.
 *   - an organization row on that address → "not a person" → created a person
 *     row beside it, on the same address, which is case one tomorrow.
 *
 * Measured 2026-10-22: `dinoservicepros@gmail.com` — a role mailbox for our
 * own operating company — was archived by hand on 10-21 under the
 * `auto-contact` undo. The 10-21 merge had set `is_organization`, so the next
 * pass read the archived row, declined it for being an organization, and
 * created a person. Then a second, because by then two rows shared the
 * address. Four rows for one mailbox, the human's archive overruled twice in
 * one day — §12: an automatic pass and its undo are a LOOP unless the undo
 * leaves a mark the pass respects.
 *
 * So `refused` means STOP: do not match, do not create, say so. Only `none`
 * — nothing on this address or name at all — may create.
 */
export type PartyLookup =
  | { kind: 'match'; party: PartyLite }
  | { kind: 'none' }
  | { kind: 'refused'; reason: string }

/**
 * What the rows a lookup returned mean — the half that had the bug.
 *
 * Pure and exported so it is testable: the query is trivial and the DECISION
 * is what turned one archived role mailbox into four rows. `key` is the thing
 * searched on, quoted back in the reason a human reads.
 */
export function decidePartyLookup(
  rows: PartyLite[],
  key: string,
  by: 'address' | 'name'
): PartyLookup {
  // Two parties on one key is a data problem, not a match — and not a licence
  // to add a third. This is the self-amplifying case.
  if (rows.length > 1) {
    return {
      kind: 'refused',
      reason: by === 'address' ? `${rows.length} contacts share ${key}` : `${rows.length} contacts named ${key}`,
    }
  }
  if (rows.length === 1) {
    const row = rows[0]
    // An organization row is not a person, however person-shaped the sighting
    // was — but the key is taken, so nothing may be created against it.
    if (row.is_organization) {
      return {
        kind: 'refused',
        reason: by === 'address' ? `${key} belongs to an organization row` : `${key} is an organization row`,
      }
    }
    // A contact a human archived stays archived. Matching it would resurrect
    // what the undo retired; creating its twin would be worse.
    if (row.status === 'archived') {
      return { kind: 'refused', reason: `${row.full_name} was archived by hand` }
    }
    return { kind: 'match', party: row }
  }
  return { kind: 'none' }
}

/** Email first; then an exact, unique, multi-word name; otherwise refuse. */
async function matchParty(
  person: ThreadPerson
): Promise<{ lookup: PartyLookup; error: string | null }> {
  const email = person.email?.trim().toLowerCase()
  if (email) {
    const { data, error } = await provDb()
      .from('parties')
      .select('id, full_name, email, is_organization, status')
      .ilike('email', email)
      .limit(2)
    if (error) return { lookup: { kind: 'none' }, error: `match by email: ${error.message}` }
    const decided = decidePartyLookup((data ?? []) as PartyLite[], email, 'address')
    if (decided.kind !== 'none') return { lookup: decided, error: null }
  }

  const name = person.name?.trim()
  // ⚠ TWO WORDS MINIMUM. A bare first name is the weak key that resolved
  // "Cliff" to a stranger; and §12's token rule — require the whole name, or
  // one token rare in the corpus — is why this is exact rather than fuzzy.
  if (!name || name.split(/\s+/).filter(Boolean).length < 2) return { lookup: { kind: 'none' }, error: null }

  const { data, error } = await provDb()
    .from('parties')
    .select('id, full_name, email, is_organization, status')
    .ilike('full_name', name)
    .limit(2)
  if (error) return { lookup: { kind: 'none' }, error: `match by name: ${error.message}` }
  return { lookup: decidePartyLookup((data ?? []) as PartyLite[], name, 'name'), error: null }
}

// ── The cursor ───────────────────────────────────────────────────────────────
//
// Exported so the rolodex sweep in ./people shares them rather than growing a
// second pair — §12: never fork a shared pass.

export async function readCursor(
  table: string,
  recordId: string
): Promise<{ evidenceThrough: string | null; error: string | null }> {
  const { data, error } = await provDb()
    .from('curator_cursors')
    .select('evidence_through')
    .eq('table_name', table)
    .eq('record_id', recordId)
    .maybeSingle()
  if (error) return { evidenceThrough: null, error: `read cursor: ${error.message}` }
  return { evidenceThrough: (data as { evidence_through: string | null } | null)?.evidence_through ?? null, error: null }
}

export async function writeCursor(
  table: string,
  recordId: string,
  evidenceThrough: string | null,
  written: number,
  proposed: number,
  lastError: string | null
): Promise<void> {
  await provDbAs(PEPPER_ACTOR)
    .from('curator_cursors')
    .upsert(
      {
        table_name: table,
        record_id: recordId,
        evidence_through: evidenceThrough,
        last_run_at: new Date().toISOString(),
        last_written: written,
        last_proposed: proposed,
        last_error: lastError,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'table_name,record_id' }
    )
}

function firstLine(text: string): string {
  const line = text.split('\n').find((l) => l.trim()) ?? ''
  return line.length > 240 ? `${line.slice(0, 237)}…` : line
}
