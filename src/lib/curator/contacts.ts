/**
 * The rolodex builds itself from conversations we actually took part in.
 *
 * ⚠ THIS IS THE ONE PLACE PEPPER CREATES A RECORD, AND IT IS A NARROW,
 * EXPLICIT AMENDMENT TO §11 (Richard, 2026-10-15): *"I want all contacts from
 * mine and Eric's email to get ingested automatically if we are actually
 * responding to them."* Everything else in §11 stands — no project, no
 * opportunity, no lead, no entity is ever created without a human confirm.
 *
 * ⚠ RECIPROCITY IS THE WHOLE QUALITY BAR, AND IT IS A RULE RATHER THAN A SCORE
 * (§12). A deal mailbox holds plenty of mail from people nobody ever answered:
 * recruiters, plan rooms, newsletters, cold outreach. The signal that somebody
 * is a real contact is that one of the two executives WROTE on the thread. So a
 * candidate must either have sent a message on a thread an executive also sent
 * on, or have been a recipient of a message an executive sent. Measured against
 * the live corpus 2026-10-15: 1,755 deal threads, 438 with a reply from one of
 * ours, 171 distinct external addresses, 147 of them in no contact record.
 *
 * ⚠ `info@` IS NEVER A SOURCE HERE, BY CONSTRUCTION RATHER THAN BY A FLAG
 * (§12: a security filter belongs at the choke point as a default). The lead
 * mailbox is for lead generation; its correspondence is scored as a sales lead
 * and must not feed the directory. This pass reads `pipeline = 'deal'` only,
 * and `internalAddresses()` deliberately excludes the assistant seat, so
 * Pepper's own morning notes — which land in the deal pipeline as ordinary
 * threads — cannot read as an executive replying. That is the self-loop rule
 * that once accounted for 27% of the commitment ledger.
 *
 * ⚠ A PROTECTED PROJECT'S THREADS ARE SKIPPED, for the reason `run.ts` gives:
 * what makes unattended writing safe is that every change is REPORTED, and the
 * morning note is an outbound channel a confidential deal may never reach. A
 * counterparty created into the shared directory is itself a disclosure.
 *
 * ⚠ AND IT MAKES NO MODEL CALL. Names come from the message headers, phones
 * from the sender's own signature (./signatures), titles and companies from the
 * `people[]` the sweep already extracted into `email_threads.summary`.
 */
import { provDb } from '@/lib/provenance/db'
import { internalAddresses } from '@/lib/commitments/internal-tasks'
import { loadPepperMembers } from '@/lib/pepper/attribution'
import { createAdminClient } from '@/lib/supabase/admin'
import { confidentialProjectIds } from '@/lib/security/confidential'
import { normalizePhone } from '@/lib/imessage/classify'
import { phonesBySender, splitMessages, formatPhone } from './signatures'
import { applyPeople, type PersonMention, type PersonOutcome } from './fold'
import type { ThreadSummary } from './evidence'

/** Threads read in one page. PostgREST truncates at 1000 silently (§12). */
const PAGE = 200

/** A `To:` line under a rendered message heading. */
const TO_RE = /^To: (.+)$/gm

/**
 * A display name that identifies nobody.
 *
 * Mirrors the guards in `contacts/profile-intake.ts`: a signature writes its
 * own address as `Email: sterling <mailto:…>`, and an Outlook `To:` line
 * pasted whole reads as one enormous "name".
 */
const LABEL_NAME_RE =
  /^(e-?mail|mail|web|site|url|tel|phone|mobile|cell|direct|office|fax|http|www|sent|from|to|cc|subject)\b/i

/**
 * A mailbox no human is corresponding with.
 *
 * ⚠ FOUND BY THE FIRST DRY RUN, which was about to create `LinkedIn Customer
 * Support`, `Murray City eProcess360 Portal <postmaster@…>` and a webex
 * `messenger@` as contacts. Reciprocity does not protect against these: a
 * platform notification is a thread one of ours genuinely replied on. The test
 * is the LOCAL PART, because the domain is a real company either way.
 */
const AUTOMATED_RE =
  /^(no-?reply|noreply|donotreply|do-not-reply|notifications?|alerts?|mailer|bounce|postmaster|messenger|support|helpdesk|billing|invoices?|receipts?|news|newsletter|updates?|admin|automated|system|webmaster|abuse|security|sales|careers|jobs|hr|accounts?|accounting|payroll|service|customerservice)([.\-_+]|$)|_support$|^info$/i

/**
 * The same markers, anywhere in the local part — not only at the front.
 *
 * ⚠ `AUTOMATED_RE` IS ANCHORED AT `^`, AND A SUFFIX WALKS STRAIGHT PAST IT.
 * Measured 2026-10-21 on the 57 contacts the reciprocity rule had created:
 * `drive-shares-dm-noreply@google.com` became a party called "Merlin Corbin
 * (via Google Drive)" — a Google Drive share notification stored as a person,
 * because the marker is the LAST token of the local part rather than the first.
 *
 * This is §12's substring rule arriving inverted. There it is "a substring hint
 * matches any word that CONTAINS it — the prefix must START a token"; here the
 * anchor was so strict that a token in any other position was invisible. So the
 * test is on WHOLE TOKENS of the local part, split on the separators a vendor
 * actually uses, which keeps the precision the anchor was protecting: `noreply`
 * matches, and `norah` or `replyall` do not.
 *
 * Only the unambiguous markers are listed. `support`, `sales` and `service` stay
 * prefix-only above, because a surname can legitimately end in them.
 */
const AUTOMATED_TOKENS = new Set([
  'noreply', 'no-reply', 'donotreply', 'do-not-reply', 'notification', 'notifications',
  'mailer', 'bounce', 'postmaster', 'daemon', 'automated', 'autoreply', 'auto-reply',
])

/** Is this local part an automated mailbox, by prefix OR by any whole token? */
export function isAutomatedLocalPart(localPart: string): boolean {
  const lower = localPart.trim().toLowerCase()
  if (!lower) return false
  if (AUTOMATED_RE.test(lower)) return true
  // Split on the separators vendors put between words, then also test the
  // hyphen-joined pairs so `no-reply` is caught as the two tokens it becomes.
  const parts = lower.split(/[.\-_+]+/).filter(Boolean)
  if (parts.some((t) => AUTOMATED_TOKENS.has(t))) return true
  for (let i = 0; i < parts.length - 1; i++) {
    if (AUTOMATED_TOKENS.has(`${parts[i]}-${parts[i + 1]}`)) return true
  }
  if (parts.length >= 3) {
    for (let i = 0; i < parts.length - 2; i++) {
      if (AUTOMATED_TOKENS.has(`${parts[i]}-${parts[i + 1]}-${parts[i + 2]}`)) return true
    }
  }
  return false
}

/**
 * A name that is a company, a team or a role rather than a person.
 *
 * ⚠ §12 SAYS DECIDE ON THE `is_organization` FLAG AND NEVER ON THE NAME — our
 * own company once "attended" four of its own calls. The flag is available
 * when the thread summary described this address, and it is believed. Where
 * there is no flag (a candidate drawn from a message header) there is nothing
 * to believe, so the rule is to SKIP rather than guess: the first dry run would
 * otherwise have filed `Dino Plumbing HVAC & Electrical`, `RMGA UTAH`,
 * `Wallace Incorporated` and a `Consulate of Israel` desk as PEOPLE. A missed
 * organization costs a contact nobody typed; a company stored as a person
 * corrupts the directory's one structural distinction.
 */
const ORG_NAME_RE =
  /\b(inc|inc\.|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|plc|llp|lp|group|holdings|partners|associates|team|support|portal|consulate|embassy|department|division|services|solutions|systems|technologies|enterprises|ventures|capital|bank|trust|committee|council|chamber|board|office|dept)\b/i

export interface ContactSweepResult {
  ok: boolean
  threadsRead: number
  threadsReciprocated: number
  threadsRedacted: number
  threadsProtected: number
  candidates: number
  /** Already in the directory — handed to the enrichment path. */
  matched: number
  created: {
    partyId: string
    name: string
    email: string
    phone: string | null
    title: string | null
    company: string | null
  }[]
  /** Enrichment outcomes for candidates that already had a record. */
  outcomes: PersonOutcome[]
  /** Phones dropped because two people claimed the same number. */
  phoneCollisions: number
  /** Candidates that turned out to be one of ours under an unlisted name. */
  skippedInternal: number
  /** Candidates that are a company, a team or a desk rather than a person. */
  skippedOrganizations: number
  /** Numbers belonging to one of ours, refused on a counterparty's row. */
  internalPhonesWithheld: number
  errors: string[]
}

interface Candidate {
  email: string
  names: Map<string, number>
  title: string | null
  company: string | null
  phones: Map<string, number>
  threads: number
  /** The summary's own flag where it described this address; null when not. */
  isOrg: boolean | null
  /** The newest thread that evidences this person, for the provenance line. */
  label: string
  ref: string
  at: string | null
  /** True when they themselves sent a message, not merely received one. */
  wrote: boolean
}

function addressesIn(fragment: string): { email: string; name: string }[] {
  const out: { email: string; name: string }[] = []
  // ⚠ Comma OR semicolon: an Outlook `To:` line uses semicolons, and splitting
  // on commas alone read one whole recipient list as a single display name.
  for (const part of fragment.split(/[,;](?![^<]*>)/)) {
    const piece = part.trim()
    if (!piece) continue
    const angled = piece.match(/^(.*?)<([^>]+)>$/)
    const email = (angled ? angled[2] : piece).trim().toLowerCase().replace(/^mailto:/, '')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue
    let name = angled ? angled[1].trim().replace(/^["']|["']$/g, '') : ''
    // ⚠ A DOMAIN IS NOT A NAME, even without an `@`. One candidate came
    // through as `a.hillyard yesprintcopy.com` — a mail client had written the
    // address either side of a space, and every `@` guard passed it.
    if (
      name.includes('@') ||
      LABEL_NAME_RE.test(name) ||
      !/[a-z]/i.test(name) ||
      /\.(com|net|org|io|us|gov|edu|biz|co|info|tech|ai)\b/i.test(name)
    ) {
      name = ''
    }
    out.push({ email, name })
  }
  return out
}

/**
 * Every phone number that belongs to one of ours.
 *
 * ⚠ THE SECOND DRY RUN WAS STILL ABOUT TO WRITE ERIC'S CELL ONTO A
 * COUNTERPARTY. `Larry Fehrenbacher` came out holding 385-436-6519, which is
 * the number Eric texts from — it reaches the corpus because he signs mail
 * with it, and `internalAddresses` could not help because the leak is a
 * NUMBER, not an address. Per-message attribution stops the common case; this
 * closes the rest, including a signature quoted inside somebody else's reply.
 *
 * Drawn from the directory rather than from a constant, so a colleague's new
 * number needs no code change. `IMESSAGE_INTERNAL_HANDLES` is included because
 * that is where a texting number lives when it differs from the one on file.
 */
async function internalPhoneDigits(internal: Set<string>): Promise<Set<string>> {
  const digits = new Set<string>()
  for (const raw of (process.env.IMESSAGE_INTERNAL_HANDLES ?? '').split(',')) {
    const n = normalizePhone(raw.trim())
    if (n) digits.add(n)
  }
  for (const address of internal) {
    const m = address.match(/^(\d{10,11})@imessage\.local$/)
    if (m) {
      const n = normalizePhone(m[1])
      if (n) digits.add(n)
    }
  }
  const { data } = await provDb().from('parties').select('email, phone').not('phone', 'is', null)
  for (const row of (data ?? []) as { email: string | null; phone: string | null }[]) {
    const email = row.email?.trim().toLowerCase()
    if (!email || !internal.has(email)) continue
    const n = normalizePhone(row.phone ?? '')
    if (n) digits.add(n)
  }
  return digits
}

/**
 * Does this name belong to one of ours?
 *
 * ⚠ A THIRD TEST, BECAUSE A ROSTER IS A LIST OF LOGINS, NOT A LIST OF
 * ADDRESSES. `team_members` holds Eric, Richard and Pepper and that IS the
 * company (2026-10-16) — but an executive writes from more addresses than he
 * holds logins for, and the 10-15 dry run surfaced `berwilsonllc@outlook.com`,
 * signed `Ericson Tua'one`, as an external candidate. Our own company name
 * inside a person's display name is the structural tell, and it costs nothing
 * to honour. It is the alternate address this defends against, not a missing
 * colleague.
 */
function namesOurselves(name: string | null): boolean {
  return !!name && /\bber\s*wilson\b/i.test(name)
}

/**
 * Gather every reciprocated external address in the deal corpus.
 *
 * Read-only: this is also what the measurement script reports, so a dry run and
 * the real pass agree by construction rather than by two implementations.
 */
export async function gatherReciprocatedContacts(): Promise<{
  candidates: Map<string, Candidate>
  internal: Set<string>
  threadsRead: number
  threadsReciprocated: number
  threadsRedacted: number
  threadsProtected: number
  error: string | null
}> {
  const empty = {
    candidates: new Map<string, Candidate>(),
    internal: new Set<string>(),
    threadsRead: 0,
    threadsReciprocated: 0,
    threadsRedacted: 0,
    threadsProtected: 0,
  }

  const admin = createAdminClient()
  let internal: Set<string>
  try {
    internal = internalAddresses(await loadPepperMembers(admin))
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : String(e) }
  }
  const isInternal = (email: string) => internal.has(email) || email.endsWith('@berwilson.com')

  // ── which threads may not be read at all ───────────────────────────────────
  const protectedThreads = new Set<string>()
  const confidential = await confidentialProjectIds()
  // `null` means the confidential set could not be read — fail closed by
  // reading nothing, rather than curating a protected deal's counterparties
  // into a directory the morning note then announces.
  if (confidential === null) {
    return { ...empty, error: 'Could not read the confidential project set; read nothing.' }
  }
  if (confidential.length > 0) {
    const { data, error } = await provDb()
      .from('thread_links')
      .select('thread_id, record_id, record_kind')
      .eq('record_kind', 'project')
      .in('record_id', confidential)
    if (error) return { ...empty, error: `thread_links: ${error.message}` }
    for (const row of (data ?? []) as { thread_id: string | null }[]) {
      if (row.thread_id) protectedThreads.add(row.thread_id)
    }
  }

  const candidates = new Map<string, Candidate>()
  let threadsRead = 0
  let threadsReciprocated = 0
  let threadsRedacted = 0
  let threadsProtected = 0
  let from = 0

  for (;;) {
    const { data, error } = await provDb()
      .from('email_threads')
      .select('id, subject, last_at, raw_markdown, summary')
      .eq('pipeline', 'deal')
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) return { ...empty, error: `email_threads: ${error.message}` }
    const rows = (data ?? []) as {
      id: string
      subject: string | null
      last_at: string | null
      raw_markdown: string | null
      summary: unknown
    }[]
    if (rows.length === 0) break

    for (const row of rows) {
      threadsRead++
      if (protectedThreads.has(row.id)) {
        threadsProtected++
        continue
      }
      // A redacted thread (a private recording) has no text by design.
      if (!row.raw_markdown) {
        threadsRedacted++
        continue
      }

      const messages = splitMessages(row.raw_markdown)
      const sentByUs = messages.filter((m) => internal.has(m.from))
      if (sentByUs.length === 0) continue
      threadsReciprocated++

      // Titles and companies the sweep already extracted, by address.
      const described = new Map<
        string,
        { title: string | null; company: string | null; isOrg: boolean | null }
      >()
      const summary = (row.summary ?? null) as ThreadSummary | null
      for (const p of summary?.people ?? []) {
        const e = p?.email?.trim().toLowerCase()
        if (!e) continue
        described.set(e, {
          title: p.title ?? null,
          company: p.company ?? null,
          isOrg: typeof p.is_organization === 'boolean' ? p.is_organization : null,
        })
      }

      const phones = phonesBySender(row.raw_markdown)

      // Who counts: anyone who SENT on this thread, plus anyone WE wrote to.
      const seen = new Map<string, { name: string; wrote: boolean }>()
      for (const m of messages) {
        if (isInternal(m.from)) continue
        const heading = m.text.split('\n', 1)[0].replace(/^### .*? — /, '')
        const named = addressesIn(heading).find((a) => a.email === m.from)
        const prev = seen.get(m.from)
        seen.set(m.from, { name: named?.name || prev?.name || '', wrote: true })
      }
      for (const m of sentByUs) {
        for (const to of m.text.matchAll(TO_RE)) {
          for (const a of addressesIn(to[1])) {
            if (isInternal(a.email)) continue
            const prev = seen.get(a.email)
            seen.set(a.email, { name: a.name || prev?.name || '', wrote: prev?.wrote ?? false })
          }
        }
      }

      for (const [email, { name, wrote }] of seen) {
        // A text-message pseudo-address is a phone number, not an email: the
        // person is real but has to be matched on `parties.phone`, so counting
        // one here would propose a contact named `+13854366519`.
        if (email.endsWith('@imessage.local')) continue
        if (isAutomatedLocalPart(email.split('@')[0])) continue

        const existing = candidates.get(email)
        const c: Candidate =
          existing ??
          {
            email,
            names: new Map(),
            title: null,
            company: null,
            phones: new Map(),
            threads: 0,
            isOrg: null,
            label: row.subject ?? 'an email thread',
            ref: row.id,
            at: row.last_at,
            wrote: false,
          }
        c.threads++
        c.wrote = c.wrote || wrote
        if (name) c.names.set(name, (c.names.get(name) ?? 0) + 1)
        const d = described.get(email)
        // Newest thread wins per field; rows arrive id-ordered so compare dates.
        if (!existing || (row.last_at ?? '') > (c.at ?? '')) {
          c.label = row.subject ?? c.label
          c.ref = row.id
          c.at = row.last_at
        }
        if (d?.title && !c.title) c.title = d.title
        if (d?.company && !c.company) c.company = d.company
        if (d?.isOrg !== null && d?.isOrg !== undefined && c.isOrg === null) c.isOrg = d.isOrg
        const ph = phones.get(email)
        if (ph) c.phones.set(ph, (c.phones.get(ph) ?? 0) + 1)
        candidates.set(email, c)
      }
    }

    from += PAGE
    if (rows.length < PAGE) break
  }

  return {
    candidates,
    internal,
    threadsRead,
    threadsReciprocated,
    threadsRedacted,
    threadsProtected,
    error: null,
  }
}

/**
 * Resolve each candidate's phone, dropping any number two people claim.
 *
 * ⚠ MEASURED: a quoted forward puts somebody else's signature inside your
 * message, so one sighting handed Mark Welsko's number to Christopher Johnson
 * as well. §12 — one match is not a unique match, it is an unchallenged one.
 * The address with strictly the most sightings keeps the number; everyone else
 * loses it rather than sharing it.
 */
export function resolvePhones(candidates: Map<string, Candidate>): {
  phones: Map<string, string>
  collisions: number
} {
  const best = new Map<string, { email: string; votes: number }>()
  const claim = new Map<string, { phone: string; votes: number }>()

  for (const [email, c] of candidates) {
    const ranked = [...c.phones].sort((a, b) => b[1] - a[1])
    if (ranked.length === 0) continue
    // A tie between two numbers for one person is ambiguity, so neither wins.
    if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) continue
    claim.set(email, { phone: ranked[0][0], votes: ranked[0][1] })
  }

  for (const [email, { phone, votes }] of claim) {
    const held = best.get(phone)
    if (!held || votes > held.votes) best.set(phone, { email, votes })
  }

  const phones = new Map<string, string>()
  let collisions = 0
  for (const [email, { phone, votes }] of claim) {
    const winner = best.get(phone)
    if (winner && winner.email === email && winner.votes === votes) phones.set(email, phone)
    else collisions++
  }
  return { phones, collisions }
}

/**
 * The display name to put on a new contact record.
 *
 * ⚠ TWO WORDS MINIMUM, because that is the bar `matchParty` can ever resolve
 * against and a bare first name is not a contact anybody can find (§12, and
 * `isReportableName` in fold.ts makes the same judgement for the unmatched
 * report). A candidate with no usable name is counted, never created — an
 * address alone is not a person.
 */
export function bestName(names: Map<string, number>): string | null {
  const ranked = [...names]
    .filter(([n]) => n.trim().split(/\s+/).length >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)
  return ranked.length > 0 ? ranked[0][0].trim() : null
}

export async function runContactSweep(
  args: { dryRun?: boolean; minThreads?: number } = {}
): Promise<ContactSweepResult> {
  const { dryRun = false, minThreads = 1 } = args
  const result: ContactSweepResult = {
    ok: true,
    threadsRead: 0,
    threadsReciprocated: 0,
    threadsRedacted: 0,
    threadsProtected: 0,
    candidates: 0,
    matched: 0,
    created: [],
    outcomes: [],
    phoneCollisions: 0,
    skippedInternal: 0,
    skippedOrganizations: 0,
    internalPhonesWithheld: 0,
    errors: [],
  }

  const gathered = await gatherReciprocatedContacts()
  result.threadsRead = gathered.threadsRead
  result.threadsReciprocated = gathered.threadsReciprocated
  result.threadsRedacted = gathered.threadsRedacted
  result.threadsProtected = gathered.threadsProtected
  if (gathered.error) {
    result.ok = false
    result.errors.push(gathered.error)
    return result
  }

  const eligible = new Map(
    [...gathered.candidates].filter(([, c]) => c.threads >= minThreads && c.wrote)
  )
  result.candidates = eligible.size

  const { phones, collisions } = resolvePhones(eligible)
  result.phoneCollisions = collisions

  const ourNumbers = await internalPhoneDigits(gathered.internal)

  // ⚠ ONE CALL INTO THE SHARED PASS, NOT A SECOND COPY OF IT (§12: never fork
  // a shared pass — add a target). `applyPeople` already matches by mailbox or
  // a unique two-word name, refuses ambiguity, skips our own people by address
  // and takes the newest non-empty value per FIELD. `allowCreate` is the target
  // this pass adds; everything that makes it safe is unchanged.
  const mentions: PersonMention[] = []
  for (const [email, c] of eligible) {
    const name = bestName(c.names)
    // One of ours under a name or an address the roster does not carry.
    if (namesOurselves(name) || namesOurselves(c.company)) {
      result.skippedInternal++
      continue
    }
    // ⚠ EITHER SIGNAL IS ENOUGH, AND `??` WAS THE BUG. Reading the flag first
    // and only falling back on null let a summary asserting
    // `is_organization: false` override the name entirely — which is how
    // `Wallace Incorporated`, `Dino Plumbing HVAC & Electrical` and a
    // `Consulate of Israel` desk survived a run that had a rule against
    // exactly them. The model's flag is the unreliable half here, so it may
    // convict and never acquit.
    const isOrg = c.isOrg === true || (name ? ORG_NAME_RE.test(name) : false)
    if (isOrg) {
      result.skippedOrganizations++
      continue
    }
    const digits = phones.get(email)
    const phone = digits && !ourNumbers.has(digits) ? formatPhone(digits) : null
    if (digits && ourNumbers.has(digits)) result.internalPhonesWithheld++

    mentions.push({
      person: {
        name,
        title: c.title,
        company: c.company,
        email,
        phone,
        is_organization: false,
      },
      sourceKind: 'email_thread',
      sourceRef: c.ref,
      sourceLabel: c.label,
      at: c.at,
    })
  }

  const applied = await applyPeople({ mentions, dryRun, fillOnly: true, allowCreate: true })
  if (applied.error) {
    result.ok = false
    result.errors.push(applied.error)
    return result
  }
  result.outcomes = applied.outcomes
  result.matched = applied.outcomes.filter((o) => !o.created).length
  result.created = applied.outcomes
    .filter((o) => o.created)
    .map((o) => ({
      partyId: o.partyId,
      name: o.name,
      email: o.created?.email ?? '',
      phone: o.created?.phone ?? null,
      title: o.created?.title ?? null,
      company: o.created?.company ?? null,
    }))

  return result
}
