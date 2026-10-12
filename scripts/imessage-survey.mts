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
 *
 * ⚠ THE SELECTION LOGIC IS NO LONGER IN THIS FILE. It lives in
 * src/lib/imessage/{targets,to-thread}.ts, which the cron sweep calls too — so
 * what this prints is what that writes, by construction rather than by
 * agreement. The calibration this script used to own is the reason: it is what
 * makes classify.ts usable, and a copy of it in a script the ingestion could
 * not import would have had to be reimplemented (§12, never fork a shared
 * pass).
 */

import { messagesReadable, readChats, messagesDbPath } from '@/lib/imessage/read'
import { buildTargets, scoreChats, type ScoredChat } from '@/lib/imessage/targets'
import { SESSION_GAP_MS, splitSessions } from '@/lib/imessage/to-thread'

const args = process.argv.slice(2)
function flag(name: string, fallback: number): number {
  const i = args.indexOf(`--${name}`)
  if (i < 0 || !args[i + 1]) return fallback
  const n = Number(args[i + 1])
  return Number.isFinite(n) && n > 0 ? n : fallback
}
const DAYS = flag('days', 365)
const SHOW = flag('show', 40)

const access = messagesReadable(messagesDbPath())
if (!access.ok) {
  console.error(`Cannot read Messages: ${access.reason}`)
  process.exit(1)
}

const since = new Date(Date.now() - DAYS * 86_400_000)
const chats = readChats({ since })

const { targets, calibration, directory } = await buildTargets(chats)

console.log(
  `${calibration.candidateTokens} candidate name tokens from ${calibration.records} records; ${calibration.partyPhones} known party phone numbers` +
    (calibration.skippedConfidential
      ? `; ${calibration.skippedConfidential} confidential project(s) deliberately excluded`
      : '') +
    `\nWindow: last ${DAYS} days. A conversation is read if it CLEARLY names a record, or if somebody on it is a CRM contact AND there is a work signal.\n`
)

console.log(
  `Token calibration: ${calibration.keptTokens} kept, ${calibration.dropped.length} dropped for appearing in >=${calibration.commonCutoff} of ${calibration.chatCount} conversations.`
)
console.log('  dropped (the ordinary-English ones the record names contributed):')
for (const d of [...calibration.dropped].sort((a, b) => b.chats - a.chats).slice(0, 18)) {
  console.log(`    ${String(d.chats).padStart(4)} chats  "${d.token}"  (from ${d.from})`)
}
console.log(
  `  of the ${calibration.keptTokens} kept, ${calibration.rareTokens} are rare enough (<=${calibration.rareCutoff} of ${calibration.chatCount} chats) to name a record on their own.`
)
console.log(
  '  Every other token can only name a record by covering its WHOLE name — see the hospital/airport lesson in classify.ts.'
)
console.log()

const scored = scoreChats(chats, targets)

const selected = scored.filter((s) => s.verdict.business)
const internalThreads = selected.filter((s) => s.verdict.internal)
const excluded = scored.filter((s) => s.verdict.reason.startsWith('excluded number'))
const automated = scored.filter((s) => !s.verdict.business && s.verdict.signals.automated)
const quiet = scored.filter(
  (s) =>
    !s.verdict.business &&
    !s.verdict.signals.automated &&
    !s.verdict.reason.startsWith('excluded number')
)

// ── Report ───────────────────────────────────────────────────────────────────
const msgs = (list: ScoredChat[]) => list.reduce((a, s) => a + s.chat.total, 0)

console.log('─'.repeat(72))
console.log(`conversations in window:      ${scored.length}  (${msgs(scored)} messages)`)
console.log(`WOULD INGEST:                 ${selected.length}  (${msgs(selected)} messages)`)
console.log(`  of which INTERNAL (colleagues): ${internalThreads.length}  (${msgs(internalThreads)} messages)`)
console.log(`excluded, colleague's number:  ${excluded.length}  (${msgs(excluded)} messages)`)
console.log(`excluded, automated/broadcast: ${automated.length}  (${msgs(automated)} messages)`)
console.log(`excluded, no business signal:  ${quiet.length}  (${msgs(quiet)} messages)`)
console.log(
  `=> ${((100 * msgs(selected)) / Math.max(1, msgs(scored))).toFixed(1)}% of your messages in this window would be read into the platform`
)
console.log('─'.repeat(72))

/**
 * ⚠ THE ROW THAT GETS WRITTEN IS A SESSION, NOT A CONVERSATION, so the count
 * that matters downstream is this one: every session is one `email_threads`
 * row, one model summary, and a candidate for one `updates` row on a record.
 */
let sessionCount = 0
let openSessions = 0
const perChat: { label: string; sessions: number; longest: number }[] = []
for (const s of selected) {
  const sessions = splitSessions(s.chat)
  sessionCount += sessions.length
  const longest = sessions.reduce((n, x) => Math.max(n, x.length), 0)
  // A conversation whose newest message is inside the gap has a session still
  // being written. It is deliberately not emitted yet — see splitSessions.
  if (s.chat.lastAt && Date.now() - s.chat.lastAt.getTime() <= SESSION_GAP_MS) openSessions += 1
  perChat.push({ label: s.label, sessions: sessions.length, longest })
}
console.log(
  `\nSessions (the unit actually stored, split on ${SESSION_GAP_MS / 3600000}h of silence): ${sessionCount} closed rows from ${selected.length} conversations.`
)
console.log(
  `  ${openSessions} conversation(s) have a session still open — not written until the gap passes.`
)
const longest = perChat.sort((a, b) => b.longest - a.longest)[0]
if (longest) {
  console.log(
    `  longest single session: ${longest.longest} messages (${longest.label}) — the local model's input cap is 40,000 chars.`
  )
}

if (calibration.partyPhones >= 0 && excluded.length > 0) {
  console.log(
    `\n${excluded.length} conversation(s) excluded by name. What that costs — these are NOT ingested:\n`
  )
  for (const e of [...excluded].sort((a, b) => b.chat.total - a.chat.total).slice(0, 8)) {
    console.log(`  ${String(e.chat.total).padStart(5)} msgs  ${e.label}  —  ${e.verdict.reason}`)
  }
  if (excluded.length > 8) console.log(`  …and ${excluded.length - 8} more`)
  console.log('  ⚠ Group chats where an excluded number sits alongside a counterparty go too.')
}

console.log(`\nWould ingest (top ${Math.min(SHOW, selected.length)} by recency):\n`)
for (const s of [...selected]
  .sort((a, b) => (b.chat.lastAt?.getTime() ?? 0) - (a.chat.lastAt?.getTime() ?? 0))
  .slice(0, SHOW)) {
  const when = s.chat.lastAt ? s.chat.lastAt.toISOString().slice(0, 10) : '—'
  console.log(
    `  ${when}  ${String(s.chat.total).padStart(5)} msgs  score ${s.verdict.score}  ${s.label}`
  )
  console.log(`              ${s.verdict.reason}`)
}

/**
 * ⚠ THE NEAR-MISSES ARE THE POINT OF THIS SECTION, AND THEY SPLIT IN TWO.
 *
 * There is no threshold to argue about any more, so the useful question is
 * which conversations were withheld and what would change that. The two buckets
 * want opposite responses: the first is a directory gap and one phone number
 * fixes it, the second is working exactly as intended.
 */
const needsContact = quiet.filter((s) => s.verdict.reason.startsWith('work vocabulary'))
console.log(
  `\nWITHHELD, but talks like work — a CRM contact on any of these admits it (${needsContact.length}):\n`
)
for (const s of needsContact.sort((a, b) => b.chat.total - a.chat.total).slice(0, 15)) {
  console.log(`  ${String(s.chat.total).padStart(5)} msgs  ${s.label}  —  ${s.verdict.reason.replace(' — private', '')}`)
}
console.log('  → If one of these is a real counterparty, put their number on their contact record.')

const contactNoWork = quiet.filter((s) => s.verdict.reason.startsWith('a CRM contact'))
console.log(`\nWITHHELD, a contact but nothing work-related in it (${contactNoWork.length}) — private, as asked:\n`)
for (const s of contactNoWork.sort((a, b) => b.chat.total - a.chat.total).slice(0, 10)) {
  console.log(`  ${String(s.chat.total).padStart(5)} msgs  ${s.label}`)
}

console.log(
  `\nDirectory: ${directory.nameByPhone.size} number(s) resolve to a named contact, ${directory.emailByPhone.size} to an email address.`
)
console.log('\nNothing was written. `runIMessageSweep({ dryRun: true })` is the same selection, as the cron sees it.')
