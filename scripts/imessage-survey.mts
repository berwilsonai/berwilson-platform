/**
 * What would a text-message ingestion actually select? A DRY RUN.
 *
 *   node --experimental-strip-types --import ./deploy/register.mjs \
 *        --env-file=.env.local scripts/imessage-survey.mts [--days 365] [--show 40]
 *
 * ⚠ IT WRITES NOTHING, AND IT EXISTS BECAUSE §12 SAYS SO: print the set a bulk
 * predicate selects before letting it write. The predicate here runs over the
 * most personal file on the machine — 305,107 messages, overwhelmingly family,
 * friends and 2FA codes — so "the filter looks reasonable" is not good enough.
 * The point of this script is to be read by a human who can say "that thread is
 * not business" before a single row is stored.
 *
 * It prints the selected conversations, the reason each was selected, and the
 * counts either side of the threshold — because a fuzzy threshold is measured
 * against the real corpus, never chosen.
 *
 * Identities are shown in a redacted form (last four digits, or a display name)
 * so the output can be read and discussed without being a copy of the address
 * book. Message bodies are never printed.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { messagesReadable, readChats } from '@/lib/imessage/read'
import { PRIMARY_MAILBOX } from '@/lib/integrations/google-workspace'
import {
  BUSINESS_SCORE_FLOOR,
  classifyChat,
  nameTokens,
  normalizePhone,
  termRegex,
  type ChatVerdict,
} from '@/lib/imessage/classify'

const args = process.argv.slice(2)
function flag(name: string, fallback: number): number {
  const i = args.indexOf(`--${name}`)
  if (i < 0 || !args[i + 1]) return fallback
  const n = Number(args[i + 1])
  return Number.isFinite(n) && n > 0 ? n : fallback
}
const DAYS = flag('days', 365)
const SHOW = flag('show', 40)

const access = messagesReadable()
if (!access.ok) {
  console.error(`Cannot read Messages: ${access.reason}`)
  process.exit(1)
}

const supabase = createAdminClient()

// ── What the classifier matches against ──────────────────────────────────────
const [projects, parties, entities] = await Promise.all([
  supabase.from('projects').select('name, confidential'),
  supabase.from('parties').select('full_name, phone, is_organization'),
  supabase.from('entities').select('name'),
])

/**
 * ⚠ CONFIDENTIAL PROJECT NAMES ARE NOT USED AS MATCH TOKENS.
 *
 * Matching on them would make this survey's output report which conversations
 * mention a protected deal — turning a containment boundary into a disclosure
 * in the one artifact meant to be read and shared. A protected deal's texts are
 * simply not sought.
 */
const { data: teamRowsForOwner } = await supabase
  .from('team_members')
  .select('name, email, parties(phone)')

const candidates = new Map<string, string>()
const tokensPerLabel = new Map<string, string[]>()
let skippedConfidential = 0

function offer(name: string | null, confidential = false) {
  if (!name) return
  if (confidential) {
    skippedConfidential += 1
    return
  }
  const toks = nameTokens(name)
  if (toks.length === 0) return
  tokensPerLabel.set(name, toks)
  for (const t of toks) if (!candidates.has(t)) candidates.set(t, name)
}

for (const p of (projects.data ?? []) as { name: string; confidential: boolean }[]) {
  offer(p.name, p.confidential)
}
for (const e of (entities.data ?? []) as { name: string | null }[]) offer(e.name)
for (const p of (parties.data ?? []) as { full_name: string | null; is_organization: boolean }[]) {
  // Organisations only. A person's surname is a common word far more often than
  // a company name is — "Rich" or "White" would match half the corpus.
  if (p.is_organization) offer(p.full_name)
}

const partyPhones = new Set<string>()
for (const p of (parties.data ?? []) as { phone: string | null }[]) {
  const n = p.phone ? normalizePhone(p.phone) : null
  if (n) partyPhones.add(n)
}
/**
 * ⚠ THE OWNER IS NOT A COUNTERPARTY. `knownParty` means "someone we have on
 * file is in this conversation", and it clears the whole bar by itself. Richard
 * has a party record with his own number, so his notes-to-self thread was
 * selected on the strength of being himself — 427 messages qualifying with no
 * record named and no deal term in them. The same shape as printing a reader's
 * own name back at them as a third party.
 */
const ownerPhone = ((teamRowsForOwner ?? []) as { email: string | null; parties: { phone: string | null } | null }[])
  .find((t) => t.email && t.email.toLowerCase() === PRIMARY_MAILBOX.toLowerCase())
  ?.parties?.phone
const ownerNormalized = ownerPhone ? normalizePhone(ownerPhone) : null
if (ownerNormalized) partyPhones.delete(ownerNormalized)

/**
 * Colleagues, whose conversations are never ingested.
 *
 * Derived from `team_members` so it maintains itself as the directory fills in
 * — and overridable by env because it does NOT maintain itself today. Measured
 * 2026-10-11: Eric's thread is the single largest selection at 3,654 messages
 * and scores 5 on real deal vocabulary, but the number he texts from (…6519)
 * is not the one on his party record (…5507, same 385-436 prefix, different
 * line). So the directory cannot yet name the handle that matters, and
 * `IMESSAGE_EXCLUDE_HANDLES` carries it until `parties` can hold more than one
 * number per person.
 */
const excludedHandles = new Set<string>()
for (const t of (teamRowsForOwner ?? []) as {
  name: string
  email: string | null
  parties: { phone: string | null } | null
}[]) {
  /**
   * ⚠ NEVER EXCLUDE THE OWNER'S OWN NUMBER.
   *
   * The first version derived this from `team_members` wholesale and swept in
   * Richard himself. In a 1:1 the handle is the OTHER party so it cost only one
   * self-thread — but Messages lists the owner's own number as a handle on some
   * group chats, and any deal group where it appeared would have been dropped
   * silently. The owner is the team member on PRIMARY_MAILBOX, which is the
   * same identity the mail stack already uses.
   */
  if (t.email && t.email.toLowerCase() === PRIMARY_MAILBOX.toLowerCase()) continue
  const n = t.parties?.phone ? normalizePhone(t.parties.phone) : null
  if (n) excludedHandles.add(n)
}
for (const raw of (process.env.IMESSAGE_EXCLUDE_HANDLES ?? '').split(',')) {
  const n = normalizePhone(raw.trim())
  if (n) excludedHandles.add(n)
}

console.log(
  `${candidates.size} candidate name tokens from ${tokensPerLabel.size} records; ${partyPhones.size} known party phone numbers` +
    (skippedConfidential ? `; ${skippedConfidential} confidential project(s) deliberately excluded` : '') +
    `\nWindow: last ${DAYS} days. Threshold: score >= ${BUSINESS_SCORE_FLOOR}.\n`
)

// ── Read and classify ────────────────────────────────────────────────────────
const since = new Date(Date.now() - DAYS * 86_400_000)
const chats = readChats({ since })

/**
 * ⚠ CALIBRATE THE TOKENS AGAINST THE CORPUS. THIS IS THE WHOLE FIX.
 *
 * The first run of this survey selected 94.4% of a personal message history —
 * 400 of 822 conversations including a 3,689-message rugby group chat — because
 * record names tokenize into ordinary English. `Case Garage` contributed
 * **case**, `Harvest Time Holdings` contributed **time**, and `State of Utah
 * Department of Workforce Services` contributed **state** and **services**. A
 * hand-written stopword list cannot anticipate that; it is a property of this
 * company's record names meeting this person's text history.
 *
 * So the corpus decides. A token appearing in more than COMMON_SHARE of
 * conversations is, by definition, not identifying here — and this is measured
 * rather than chosen, which §12 insists on for every threshold.
 */
const COMMON_SHARE = 0.03
const df = new Map<string, number>()
for (const chat of chats) {
  if (chat.messages.length === 0) continue
  const hay = chat.messages.join('\n').toLowerCase()
  for (const token of candidates.keys()) {
    if (termRegex(token).test(hay)) df.set(token, (df.get(token) ?? 0) + 1)
  }
}
const chatCount = chats.filter((c) => c.messages.length > 0).length
const commonCutoff = Math.max(2, Math.ceil(chatCount * COMMON_SHARE))

const dropped: { token: string; chats: number; from: string }[] = []
const recordTokens = new Map<string, string>()
for (const [token, label] of candidates) {
  const n = df.get(token) ?? 0
  if (n >= commonCutoff) dropped.push({ token, chats: n, from: label })
  else recordTokens.set(token, label)
}

/**
 * ⚠ A ONE-TOKEN RECORD NEEDS A MUCH RARER TOKEN — TWO TIERS, NOT ONE CUTOFF.
 *
 * The 3% cutoff is the right bar for a token that only ever fires ALONGSIDE
 * another one. It is far too loose for a name that can match on a single word:
 * the second run dropped `case` and kept `garage`, which left `Case Garage`
 * matching on "garage" alone and still claimed a 3,836-message personal thread.
 * `Renew Development` did the same through "renew".
 *
 * So a lone token must be genuinely distinctive — under half a percent of
 * conversations. That keeps place names like `tooele`, which is what actually
 * identifies these deals, and discards ordinary nouns that happen to appear in
 * a record's name.
 */
const SINGLE_TOKEN_SHARE = 0.005
const singleCutoff = Math.max(1, Math.ceil(chatCount * SINGLE_TOKEN_SHARE))
const singleTokenRecords = new Set<string>()
const soloRejected: { label: string; token: string; chats: number }[] = []
for (const [label, toks] of tokensPerLabel) {
  const surviving = toks.filter((t) => recordTokens.has(t))
  if (surviving.length !== 1) continue
  const token = surviving[0]
  const n = df.get(token) ?? 0
  if (n <= singleCutoff) singleTokenRecords.add(label)
  else soloRejected.push({ label, token, chats: n })
}

console.log(
  `Token calibration: ${recordTokens.size} kept, ${dropped.length} dropped for appearing in >=${commonCutoff} of ${chatCount} conversations (${(COMMON_SHARE * 100).toFixed(0)}%).`
)
console.log('  dropped (the ordinary-English ones the record names contributed):')
for (const d of dropped.sort((a, b) => b.chats - a.chats).slice(0, 18)) {
  console.log(`    ${String(d.chats).padStart(4)} chats  "${d.token}"  (from ${d.from})`)
}
console.log(
  `  single-token records must be rarer still (<=${singleCutoff} chats): ${singleTokenRecords.size} qualify, ${soloRejected.length} rejected`
)
for (const r of soloRejected.sort((a, b) => b.chats - a.chats).slice(0, 10)) {
  console.log(`    ${String(r.chats).padStart(4)} chats  "${r.token}" too common to name ${r.label} alone`)
}
console.log()

interface Scored {
  label: string
  verdict: ChatVerdict
  total: number
  lastAt: Date | null
}

const scored: Scored[] = []
for (const chat of chats) {
  if (chat.messages.length === 0) continue
  const verdict = classifyChat({
    handles: chat.handles,
    messages: chat.messages,
    sentByMe: chat.sentByMe,
    partyPhones,
    recordTokens,
    singleTokenRecords,
    excludedHandles,
  })
  // Redacted label: a display name if the conversation has one, else the last
  // four digits. Enough to recognise, not a copy of the address book.
  const label =
    chat.displayName?.trim() ||
    (chat.handles.length > 1
      ? `group of ${chat.handles.length} (…${(chat.handles[0] ?? '').slice(-4)} +)`
      : `…${(chat.handles[0] ?? '?').slice(-4)}`)
  scored.push({ label, verdict, total: chat.total, lastAt: chat.lastAt })
}

const selected = scored.filter((s) => s.verdict.business)
const excluded = scored.filter((s) => s.verdict.reason.startsWith('excluded number'))
const automated = scored.filter((s) => !s.verdict.business && s.verdict.signals.automated)
const quiet = scored.filter(
  (s) => !s.verdict.business && !s.verdict.signals.automated && !s.verdict.reason.startsWith('excluded number')
)

// ── Report ───────────────────────────────────────────────────────────────────
const msgs = (list: Scored[]) => list.reduce((a, s) => a + s.total, 0)

console.log('─'.repeat(72))
console.log(`conversations in window:      ${scored.length}  (${msgs(scored)} messages)`)
console.log(`WOULD INGEST:                 ${selected.length}  (${msgs(selected)} messages)`)
console.log(`excluded, colleague's number:  ${excluded.length}  (${msgs(excluded)} messages)`)
console.log(`excluded, automated/broadcast: ${automated.length}  (${msgs(automated)} messages)`)
console.log(`excluded, no business signal:  ${quiet.length}  (${msgs(quiet)} messages)`)
console.log(
  `=> ${((100 * msgs(selected)) / Math.max(1, msgs(scored))).toFixed(1)}% of your messages in this window would be read into the platform`
)
console.log('─'.repeat(72))

if (excludedHandles.size > 0) {
  console.log(
    `\n${excludedHandles.size} number(s) excluded by name. What that costs — these conversations are NOT ingested:\n`
  )
  for (const e of [...excluded]
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)) {
    console.log(`  ${String(e.total).padStart(5)} msgs  ${e.label}  —  ${e.verdict.reason}`)
  }
  if (excluded.length > 8) console.log(`  …and ${excluded.length - 8} more`)
  console.log(
    '  ⚠ Group chats where an excluded number sits alongside a counterparty go too.'
  )
}

console.log(`\nWould ingest (top ${Math.min(SHOW, selected.length)} by recency):\n`)
for (const s of [...selected]
  .sort((a, b) => (b.lastAt?.getTime() ?? 0) - (a.lastAt?.getTime() ?? 0))
  .slice(0, SHOW)) {
  const when = s.lastAt ? s.lastAt.toISOString().slice(0, 10) : '—'
  console.log(`  ${when}  ${String(s.total).padStart(5)} msgs  score ${s.verdict.score}  ${s.label}`)
  console.log(`              ${s.verdict.reason}`)
}

/**
 * The rows either side of the line, which is the only way to judge a threshold.
 * A conversation scoring exactly at the floor is the one most likely to be
 * wrong in either direction.
 */
console.log(`\nAt the threshold (score == ${BUSINESS_SCORE_FLOOR}) — the ones to argue about:\n`)
const marginal = selected.filter((s) => s.verdict.score === BUSINESS_SCORE_FLOOR)
for (const s of marginal.slice(0, 15)) {
  console.log(`  ${String(s.total).padStart(5)} msgs  ${s.label}  —  ${s.verdict.reason}`)
}
console.log(`  (${marginal.length} conversations sit exactly on the line)`)

console.log(`\nJust BELOW the line (score ${BUSINESS_SCORE_FLOOR - 1}) — what raising coverage would add:\n`)
const nearMiss = quiet.filter((s) => s.verdict.score === BUSINESS_SCORE_FLOOR - 1)
for (const s of nearMiss.slice(0, 15)) {
  console.log(`  ${String(s.total).padStart(5)} msgs  ${s.label}  —  ${s.verdict.reason}`)
}
console.log(`  (${nearMiss.length} conversations would be added by dropping the floor by one)`)

console.log('\nNothing was written. Decide the set, then ingestion can be wired to it.')
