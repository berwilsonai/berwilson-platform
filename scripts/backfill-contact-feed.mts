/**
 * Put the recaps of every ALREADY-LINKED call onto the contacts' feeds.
 *
 * ⚠ §12: FIXING A GENERATOR CHANGES NOTHING THE READER SEES — the old rows
 * carry the old text. `upsertMeetingFromImport` now writes a contact note when
 * it registers a recording, which covers every recording from today onward and
 * NONE of the 18 already in `meetings`. Measured before writing this:
 * `verify-contact-capture.mts` reported 34 of 34 (contact, call) pairs with no
 * note, against 34 attendee slots that already carry a `party_id`.
 *
 * Idempotent by construction: `logMeetingOnContacts` reads the existing
 * (party, meeting) pairs first and inserts only the rest, so a second run
 * reports nothing. §12 pairs every fill-not-overwrite pass with exactly that
 * assertion, so this script runs the pass TWICE and refuses to claim success if
 * the second run writes anything.
 *
 * Run: export PATH="$HOME/.node/bin:$PATH" && node --no-deprecation \
 *        --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --env-file=.env.local --import ./deploy/register.mjs \
 *        scripts/backfill-contact-feed.mts [--apply]
 *
 * Without `--apply` it only reports what it would write.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { logMeetingOnContacts, meetingNoteBody } from '@/lib/contacts/notes'
import { parseAttendees } from '@/lib/utils/meetings'
import { confidentialProjectIds } from '@/lib/security/confidential'

const apply = process.argv.includes('--apply')
const db = createAdminClient()

const { data: meetings, error } = await db
  .from('meetings')
  .select('id, title, meeting_date, summary, minutes, scope, kind, project_id, attendees')
  .order('meeting_date', { ascending: false, nullsFirst: false })
if (error) throw new Error(`could not read the meetings: ${error.message}`)

// ⚠ A PROTECTED PROJECT'S CALLS NEVER REACH A PROFILE (§8), and that exclusion
// belongs in the backfill as much as in the live path — a one-off script is
// exactly where a containment rule gets left out.
const hidden = new Set((await confidentialProjectIds()) ?? [])

let examined = 0
let withRecap = 0
let pairs = 0
let withheld = 0
let written = 0
let alreadyHad = 0
const skipped: string[] = []

for (const meeting of meetings ?? []) {
  examined++
  if (meeting.project_id && hidden.has(meeting.project_id)) {
    withheld++
    continue
  }
  if (!meetingNoteBody(meeting)) {
    skipped.push(`${meeting.meeting_date ?? '—'}  ${meeting.title ?? 'untitled'} — no recap`)
    continue
  }
  withRecap++
  const partyIds = parseAttendees(meeting.attendees)
    .map((a) => a.party_id)
    .filter((id): id is string => !!id)
  if (partyIds.length === 0) {
    skipped.push(`${meeting.meeting_date ?? '—'}  ${meeting.title ?? 'untitled'} — no linked attendee`)
    continue
  }
  pairs += new Set(partyIds).size

  if (!apply) continue
  const result = await logMeetingOnContacts(db, meeting, partyIds)
  written += result.written
  alreadyHad += result.alreadyHad
  if (result.skipped) skipped.push(`${meeting.title ?? 'untitled'} — ${result.skipped}`)
}

console.log(`meetings examined:        ${examined}`)
console.log(`  with a recap:           ${withRecap}`)
console.log(`  withheld (protected):   ${withheld}`)
console.log(`(contact, call) pairs:    ${pairs}`)
if (!apply) {
  console.log(`\nnothing written — pass --apply to write them`)
} else {
  console.log(`notes written:            ${written}`)
  console.log(`already had the note:     ${alreadyHad}`)
}
if (skipped.length > 0) {
  // ⚠ COUNT THE REASON BESIDE THE NUMBER (§12). An unlabelled "12 skipped" is
  // not a coverage signal — "no recap yet" is a job to run again later, while
  // "no linked attendee" is work for the findings queue.
  console.log(`\nskipped, with the reason:`)
  for (const line of skipped) console.log(`  ${line}`)
}

// ── The second run, which must be a no-op ───────────────────────────────────
if (apply) {
  let second = 0
  for (const meeting of meetings ?? []) {
    if (meeting.project_id && hidden.has(meeting.project_id)) continue
    const partyIds = parseAttendees(meeting.attendees)
      .map((a) => a.party_id)
      .filter((id): id is string => !!id)
    if (partyIds.length === 0) continue
    const result = await logMeetingOnContacts(db, meeting, partyIds)
    second += result.written
  }
  console.log(`\nsecond run wrote:         ${second}`)
  if (second !== 0) {
    console.log('✖ the pass is NOT idempotent — the latch is not holding')
    process.exitCode = 1
  } else {
    console.log('✓ idempotent: the second run wrote nothing')
  }
}
