/**
 * How many contacts would a reciprocity rule actually create, and how many
 * info@-sourced ones would leave?
 *
 * ⚠ READ-ONLY. Measures before anything is built, because the premise is
 * usually wrong (CLAUDE.md golden rule, §12). Two questions:
 *
 *   1. Richard's rule: "all contacts from mine and Eric's email ... if we are
 *      actually responding to them". So: over the DEAL mailboxes only, which
 *      external addresses appear on a thread where one of the two executives
 *      personally sent a message?
 *   2. "Remove any contacts that came through info@berwilson.com". Which
 *      parties carry the `inbound-lead` tag `leads/promote.ts` writes, and
 *      which of those did we later actually talk to?
 *
 * ⚠ `info@` IS NOT "US" FOR THIS PURPOSE. It is Pepper's own seat, and her
 * morning notes land in the deal pipeline as ordinary threads — a reciprocity
 * test that counted them would read her own mail as the executives replying.
 * That is §12's self-loop rule, which cost 27% of the commitment ledger once.
 * `internalAddresses()` already excludes the assistant seat, which is why this
 * reuses it rather than testing the domain.
 *
 * ⚠ The signal is the MESSAGE HEADERS, not the body. `namedAddressesIn` in
 * contacts/profile-intake.ts scans whole bodies and so also finds everyone
 * quoted in a signature or a forwarded chain — right for a targeted people
 * search, wrong here, where the question is who we exchanged mail WITH.
 *
 * Run: node --import ./deploy/register.mjs --env-file=.env.local \
 *        scripts/measure-rolodex.mts
 */
import { sweepDb } from '@/lib/email-sweep/db'
import { createAdminClient } from '@/lib/supabase/admin'
import { internalAddresses } from '@/lib/commitments/internal-tasks'
import { loadPepperMembers } from '@/lib/pepper/attribution'

/** One rendered message heading: `### 2026-10-08 14:32 — Name <addr>`. */
const HEADING_RE = /^### .*? — (.+)$/gm
/** A `To:` line under a heading. */
const TO_RE = /^To: (.+)$/gm
/** Senders no human is corresponding with. */
const AUTOMATED_RE =
  /(^|[.\-_])(no-?reply|noreply|donotreply|do-not-reply|notifications?|alerts?|mailer|bounce|postmaster|support|billing|invoice|receipts?|news|newsletter|updates?|info|admin|automated|system|calendar-notification)([.\-_@]|$)/i

function addressesIn(fragment: string): { email: string; name: string }[] {
  const out: { email: string; name: string }[] = []
  // ⚠ `Name <addr>` or a bare `addr`, separated by a comma OR A SEMICOLON.
  // Splitting on commas alone read one Outlook `To:` line as a single
  // recipient and offered the whole list as somebody's display name.
  for (const part of fragment.split(/[,;](?![^<]*>)/)) {
    const piece = part.trim()
    if (!piece) continue
    const angled = piece.match(/^(.*?)<([^>]+)>$/)
    const email = (angled ? angled[2] : piece).trim().toLowerCase().replace(/^mailto:/, '')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue
    const name = angled ? angled[1].trim().replace(/^["']|["']$/g, '') : ''
    out.push({ email, name })
  }
  return out
}

const db = sweepDb()
const admin0 = createAdminClient()
/**
 * Who counts as "us".
 *
 * ⚠ REUSED, NOT REWRITTEN. `internalAddresses` already covers the two
 * mailboxes, every address on a team member's own contact record (Tarek is COO
 * and corresponds from a gmail address; Richard attends some meetings from a
 * personal one) and the `<digits>@imessage.local` handles Eric texts from. It
 * also deliberately excludes the assistant seat, which is exactly what this
 * measurement needs — Pepper's own morning notes land in the deal pipeline.
 */
const internal = internalAddresses(await loadPepperMembers(admin0))
const isInternal = (email: string) =>
  internal.has(email) || email.endsWith('@berwilson.com')

const PAGE = 100

type Seen = { threads: number; sentToByUs: number; names: Set<string> }
const external = new Map<string, Seen>()

let threads = 0
let redacted = 0
let reciprocated = 0
let from = 0

for (;;) {
  const { data, error } = await db
    .from('email_threads')
    .select('id, mailbox, raw_markdown')
    .eq('pipeline', 'deal')
    .order('id')
    .range(from, from + PAGE - 1)
  if (error) throw new Error(`read failed: ${error.message}`)
  const rows = (data ?? []) as { id: string; mailbox: string | null; raw_markdown: string | null }[]
  if (rows.length === 0) break

  for (const row of rows) {
    threads++
    const md = row.raw_markdown
    if (!md) {
      redacted++
      continue
    }

    const senders = [...md.matchAll(HEADING_RE)].map((m) => m[1])
    // Did one of OURS send on this thread? (Pepper's seat is not one of ours.)
    if (!senders.some((s) => addressesIn(s).some((a) => internal.has(a.email)))) continue
    reciprocated++

    const parties: { email: string; name: string }[] = []
    for (const s of senders) parties.push(...addressesIn(s))
    for (const m of md.matchAll(TO_RE)) parties.push(...addressesIn(m[1]))

    const uniq = new Map<string, string>()
    for (const p of parties) {
      if (isInternal(p.email)) continue
      // A text-message pseudo-address is a phone number, not an email. The
      // person is real but has to be matched on `parties.phone`, so counting
      // one here would propose a contact named `+13854366519`.
      if (p.email.endsWith('@imessage.local')) continue
      if (!uniq.has(p.email) || (!uniq.get(p.email) && p.name)) uniq.set(p.email, p.name)
    }
    for (const [email, name] of uniq) {
      const seen = external.get(email) ?? { threads: 0, sentToByUs: 0, names: new Set<string>() }
      seen.threads++
      if (name) seen.names.add(name)
      external.set(email, seen)
    }
  }

  from += PAGE
  if (rows.length < PAGE) break
}

// ── which of these do we already have? ───────────────────────────────────────
const admin = createAdminClient()
const haveEmail = new Set<string>()
let pFrom = 0
for (;;) {
  const { data, error } = await admin
    .from('parties')
    .select('email')
    .not('email', 'is', null)
    .order('email')
    .range(pFrom, pFrom + 999)
  if (error) throw new Error(`parties read failed: ${error.message}`)
  const rows = (data ?? []) as { email: string | null }[]
  if (rows.length === 0) break
  for (const r of rows) if (r.email) haveEmail.add(r.email.trim().toLowerCase())
  pFrom += 1000
  if (rows.length < 1000) break
}

const auto: string[] = []
const known: string[] = []
const fresh: [string, Seen][] = []
for (const [email, seen] of external) {
  if (AUTOMATED_RE.test(email.split('@')[0]) || AUTOMATED_RE.test(email)) auto.push(email)
  else if (haveEmail.has(email)) known.push(email)
  else fresh.push([email, seen])
}
fresh.sort((a, b) => b[1].threads - a[1].threads)

console.log('\n=== Reciprocated correspondence (deal mailboxes only) ===')
console.log(`  deal threads scanned:                 ${threads}`)
console.log(`    redacted (raw_markdown NULL):       ${redacted}`)
console.log(`    an executive personally sent on it: ${reciprocated}`)
console.log(`  distinct external addresses:          ${external.size}`)
console.log(`    automated / role senders:           ${auto.length}`)
console.log(`    already a contact:                  ${known.length}`)
console.log(`    NEW, would be created:              ${fresh.length}`)

const curve = [1, 2, 3, 5, 10]
console.log('\n  new addresses by thread count (the threshold curve):')
for (const n of curve) {
  console.log(`    on >= ${String(n).padStart(2)} thread(s): ${fresh.filter(([, s]) => s.threads >= n).length}`)
}
console.log(`    with a display name we could use: ${fresh.filter(([, s]) => s.names.size > 0).length}`)

console.log('\n  top 25 new addresses:')
for (const [email, seen] of fresh.slice(0, 25)) {
  console.log(`    ${String(seen.threads).padStart(3)}x  ${email.padEnd(42)} ${[...seen.names][0] ?? '(no name)'}`)
}

// ── archive candidates ───────────────────────────────────────────────────────
const { data: tagged, error: tagErr } = await admin
  .from('parties')
  .select('id, full_name, email, relationship_notes, status')
  .contains('tags', ['inbound-lead'])
  .limit(1000)
if (tagErr) throw new Error(`tagged read failed: ${tagErr.message}`)
const rows = (tagged ?? []) as {
  id: string
  full_name: string
  email: string | null
  relationship_notes: string | null
  status: string | null
}[]

const byOrigin = new Map<string, number>()
let alsoReciprocated = 0
let alreadyArchived = 0
for (const r of rows) {
  const note = r.relationship_notes ?? ''
  const origin = note.includes('deal submission')
    ? 'web form'
    : note.includes('raised in a meeting')
      ? 'meeting'
      : note.includes('inbound lead')
        ? 'info@ mail sweep'
        : 'unknown'
  byOrigin.set(origin, (byOrigin.get(origin) ?? 0) + 1)
  if (r.status === 'archived') alreadyArchived++
  if (r.email && external.has(r.email.trim().toLowerCase())) alsoReciprocated++
}

console.log('\n=== Archive candidates (tagged `inbound-lead`) ===')
console.log(`  tagged parties:              ${rows.length}`)
console.log(`    already archived:          ${alreadyArchived}`)
for (const [origin, n] of [...byOrigin].sort((a, b) => b[1] - a[1])) {
  console.log(`    origin ${origin.padEnd(18)} ${n}`)
}
console.log(`  ⚠ also reciprocated (KEEP): ${alsoReciprocated}`)
console.log()
