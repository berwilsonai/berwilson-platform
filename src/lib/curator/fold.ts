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
 *   - `estimated_value`. A human deliberately CLEARED it so the pipeline reads
 *     $0 until the first economics model exists (an open item, "intended, not
 *     a fault"). Re-filling it from prose is precisely the "something we did
 *     manually that isn't obvious she could update" case Richard carved out —
 *     and it is guarded, so it would only ever be proposed; it is excluded
 *     outright so it does not generate twenty cards asking to undo a decision.
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
}): Promise<{ outcomes: PersonOutcome[]; unmatched: string[]; error: string | null }> {
  const { mentions, dryRun } = args

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
  if (internal.error) return { outcomes: [], unmatched: [], error: internal.error }

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
  const matchCache = new Map<string, PartyLite | null>()

  for (const m of ordered) {
    const key = (m.person.email?.trim().toLowerCase() || m.person.name?.trim().toLowerCase()) ?? ''
    if (!key) continue
    let party = matchCache.get(key)
    if (party === undefined) {
      const found = await matchParty(m.person)
      if (found.error) return { outcomes: [], unmatched: [], error: found.error }
      party = found.party
      matchCache.set(key, party)
    }
    if (!party) {
      const name = m.person.name?.trim()
      if (name && isReportableName(name)) unmatched.add(name)
      continue
    }
    if (internal.ids.has(party.id) || isInternalAddress(party.email)) continue
    let entry = byParty.get(party.id)
    if (!entry) {
      entry = { party, fields: new Map() }
      byParty.set(party.id, entry)
    }
    for (const [field, raw] of [
      ['title', m.person.title],
      ['company', m.person.company],
      ['email', m.person.email],
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
    if (result.error) return { outcomes, unmatched: [...unmatched], error: result.error }
    if (result.written.length > 0 || result.proposed.length > 0) {
      outcomes.push({
        partyId: party.id,
        name: party.full_name,
        written: result.written,
        proposed: result.proposed,
      })
    }
  }

  return { outcomes, unmatched: [...unmatched].sort(), error: null }
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

interface PartyLite {
  id: string
  full_name: string
  email: string | null
}

/** Email first; then an exact, unique, multi-word name; otherwise refuse. */
async function matchParty(
  person: ThreadPerson
): Promise<{ party: PartyLite | null; error: string | null }> {
  const email = person.email?.trim().toLowerCase()
  if (email) {
    const { data, error } = await provDb()
      .from('parties')
      .select('id, full_name, email')
      .ilike('email', email)
      .limit(2)
    if (error) return { party: null, error: `match by email: ${error.message}` }
    const rows = (data ?? []) as PartyLite[]
    // Two parties on one address is a data problem, not a match. Refuse.
    if (rows.length === 1) return { party: rows[0], error: null }
    if (rows.length > 1) return { party: null, error: null }
  }

  const name = person.name?.trim()
  // ⚠ TWO WORDS MINIMUM. A bare first name is the weak key that resolved
  // "Cliff" to a stranger; and §12's token rule — require the whole name, or
  // one token rare in the corpus — is why this is exact rather than fuzzy.
  if (!name || name.split(/\s+/).filter(Boolean).length < 2) return { party: null, error: null }

  const { data, error } = await provDb()
    .from('parties')
    .select('id, full_name, email')
    .ilike('full_name', name)
    .limit(2)
  if (error) return { party: null, error: `match by name: ${error.message}` }
  const rows = (data ?? []) as PartyLite[]
  if (rows.length === 1) return { party: rows[0], error: null }
  return { party: null, error: null }
}

// ── The cursor ───────────────────────────────────────────────────────────────

async function readCursor(
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

async function writeCursor(
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
