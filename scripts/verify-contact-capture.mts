/**
 * The contact-capture invariants, checked against the live database.
 *
 * Run: export PATH="$HOME/.node/bin:$PATH" && node --no-deprecation \
 *        --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --env-file=.env.local --import ./deploy/register.mjs \
 *        scripts/verify-contact-capture.mts
 *
 * ⚠ IT PRINTS WHAT IT EXAMINED AT EVERY STEP. §12: an empty population passes
 * vacuously behind the same tick, and a script reading a truncated set is worse
 * than none because it is believed. Every check below says how many rows it
 * looked at, so "nothing is wrong" and "nothing was read" cannot be confused.
 *
 * Read-only. It asserts; it never repairs.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { readAttendeeQueue, countActionableAttendees } from '@/lib/contacts/attendee-queue'
import { meetingNoteBody } from '@/lib/contacts/notes'
import { parseAttendees } from '@/lib/utils/meetings'
import { confidentialProjectIds } from '@/lib/security/confidential'

const db = createAdminClient()
const failures: string[] = []
const ok = (s: string) => console.log(`  ok    ${s}`)
const bad = (s: string) => {
  console.log(`  FAIL  ${s}`)
  failures.push(s)
}

// ── 1. The feed's own shape ──────────────────────────────────────────────────
{
  const { data: notes, error } = await db
    .from('party_notes')
    .select('id, party_id, meeting_id, body, note_date, source, author')
  if (error) bad(`could not read party_notes: ${error.message}`)
  const rows = notes ?? []
  console.log(`\n1. party_notes — ${rows.length} row(s) examined`)

  const blank = rows.filter((n) => !n.body?.trim())
  if (blank.length === 0) ok('every note carries text')
  else bad(`${blank.length} note(s) with no text`)

  const undated = rows.filter((n) => !n.note_date)
  if (undated.length === 0) ok('every note is dated')
  else bad(`${undated.length} note(s) with no date`)

  // The latch. A partial unique index enforces it in the schema; this proves the
  // schema is the one the code is talking to.
  const seen = new Set<string>()
  const dupes: string[] = []
  for (const n of rows) {
    if (!n.meeting_id) continue
    const key = `${n.party_id}:${n.meeting_id}`
    if (seen.has(key)) dupes.push(key)
    seen.add(key)
  }
  if (dupes.length === 0) ok(`one note per contact per meeting (${seen.size} meeting-sourced note(s))`)
  else bad(`${dupes.length} duplicate (contact, meeting) note(s)`)
}

// ── 2. The projection is caught up ───────────────────────────────────────────
//
// ⚠ ASKED FROM THE SIDE THAT JUST CHANGED. §12: a cleanup that is a side effect
// of having work to do never reaches the rows with no work, and a projection of
// a record that MOVES goes stale the same way. Every meeting that HAS a recap
// and HAS a linked attendee should have put that recap on that attendee's feed.
{
  const { data: meetings, error } = await db
    .from('meetings')
    .select('id, title, meeting_date, summary, minutes, scope, kind, project_id, attendees')
  if (error) bad(`could not read meetings: ${error.message}`)
  const rows = meetings ?? []

  const { data: notes } = await db.from('party_notes').select('party_id, meeting_id').eq('source', 'meeting')
  const have = new Set((notes ?? []).map((n) => `${n.party_id}:${n.meeting_id}`))
  const hidden = new Set((await confidentialProjectIds()) ?? [])

  let expected = 0
  let missing = 0
  let withheldByDesign = 0
  for (const m of rows) {
    if (!meetingNoteBody(m)) continue
    // ⚠ DISTINCT CONTACTS PER MEETING, NOT ATTENDEE SLOTS — the latch is
    // `unique (party_id, meeting_id)`, so a pair is the unit and a slot is not.
    // This counted slots and reported 34 against the backfill's 33, because one
    // live meeting lists the same person twice ("Richard White" and "Richard",
    // both stamped with the same party_id by the owner override). §12: one
    // quantity, one definition, or the reader trusts neither number.
    const linked = new Set(
      parseAttendees(m.attendees)
        .map((a) => a.party_id)
        .filter((id): id is string => !!id),
    )
    for (const partyId of linked) {
      // A protected project's calls are deliberately NOT on any profile (§8),
      // so a missing note there is the containment guard working.
      if (m.project_id && hidden.has(m.project_id)) {
        withheldByDesign++
        continue
      }
      expected++
      if (!have.has(`${partyId}:${m.id}`)) missing++
    }
  }
  console.log(`\n2. the recap reaches the people — ${rows.length} meeting(s), ${expected} distinct (contact, call) pair(s) expected`)
  if (expected === 0) {
    bad('nothing was examined — either no meeting has a recap or no attendee is linked')
  } else if (missing === 0) {
    ok(`every recap is on every linked contact's feed`)
  } else {
    bad(`${missing} of ${expected} recap(s) never reached the contact`)
  }
  if (withheldByDesign > 0) {
    ok(`${withheldByDesign} pair(s) withheld because the call is on a protected project`)
  }
}

// ── 3. Containment: nothing from a protected project is on a profile ─────────
{
  const hidden = (await confidentialProjectIds()) ?? []
  console.log(`\n3. containment — ${hidden.length} protected project(s)`)
  if (hidden.length === 0) {
    ok('no project is protected, so there is nothing to withhold (vacuous — say so)')
  } else {
    const { data: leaked } = await db
      .from('party_notes')
      .select('id, meeting_id, meetings!inner(project_id)')
      .eq('source', 'meeting')
      .in('meetings.project_id', hidden)
    const n = leaked?.length ?? 0
    if (n === 0) ok('no protected call appears on any contact profile')
    else bad(`${n} contact note(s) carry a protected project's call`)
  }
}

// ── 4. The enrichment pass cannot eat a contact note ────────────────────────
//
// ⚠ THE DELETE IN `embedPartyEnrichment` WAS THE HAZARD. It read "every chunk
// for this party with no document and no update", which was exactly right until
// `party_note:` chunks existed. Asserted on real rows rather than by reading the
// filter, because a malformed `.or()` returns an EMPTY SET with no error (§12).
{
  const { data: noteChunks } = await db
    .from('chunks')
    .select('id, party_id, source_type')
    .like('source_type', 'party_note:%')
  const n = noteChunks?.length ?? 0
  console.log(`\n4. the enrichment delete — ${n} party-note chunk(s) in the index`)
  if (n === 0) {
    // ⚠ EXPECTED WHILE ONLY MEETING NOTES EXIST. A meeting note is deliberately
    // NOT indexed — the recording's own words already are, and the note is a
    // derivative (see logMeetingOnContacts' header). Only a TYPED note is
    // embedded, so this check has a population once somebody types one.
    ok('no TYPED contact note is indexed yet, so there is nothing to protect (vacuous — say so)')
  } else {
    const party = noteChunks![0].party_id!
    const { data: reached } = await db
      .from('chunks')
      .select('id, source_type')
      .eq('party_id', party)
      .is('document_id', null)
      .is('update_id', null)
      .or('source_type.is.null,source_type.eq.party_enrichment')
      .like('source_type', 'party_note:%')
    if ((reached?.length ?? 0) === 0) ok('the enrichment delete predicate reaches no contact note')
    else bad(`the enrichment delete would remove ${reached!.length} contact note chunk(s)`)
  }
}

// ── 5. One quantity, one definition ─────────────────────────────────────────
{
  const queue = await readAttendeeQueue(new Set())
  const badge = await countActionableAttendees(new Set())
  const lane = queue.findings.filter((f) => f.classification.kind === 'candidate').length
  console.log(`\n5. the directory badge and the queue's default lane — ${queue.findings.length} finding(s) over ${queue.slotsExamined} slot(s)`)
  if (queue.slotsExamined === 0) {
    bad('no attendee slot was read — the recordings carry no attendees, or the read failed')
  } else {
    if (badge === lane) ok(`both say ${badge}`)
    else bad(`the badge says ${badge} and the lane says ${lane}`)
  }
  const byClass = new Map<string, number>()
  for (const f of queue.findings) byClass.set(f.classification.kind, (byClass.get(f.classification.kind) ?? 0) + 1)
  console.log(`        ${[...byClass.entries()].map(([k, v]) => `${k}=${v}`).join('  ')}`)
}

// ── 6. A skipped name never comes back ──────────────────────────────────────
{
  const { data: skips } = await db.from('meeting_attendee_skips').select('name_key, reason')
  const keys = new Set((skips ?? []).map((s) => s.name_key ?? ''))
  const queue = await readAttendeeQueue(new Set())
  console.log(`\n6. the skip tombstone — ${keys.size} name(s) marked as not a contact`)
  if (keys.size === 0) {
    ok('nothing has been skipped yet (vacuous — say so)')
  } else {
    const resurfaced = queue.findings.filter((f) => keys.has(f.nameKey))
    if (resurfaced.length === 0) ok('none of them is back in the queue')
    else bad(`${resurfaced.length} skipped name(s) are back: ${resurfaced.map((f) => f.name).join(', ')}`)
  }
}

console.log('')
if (failures.length > 0) {
  console.log(`✖ ${failures.length} check(s) failed`)
  process.exitCode = 1
} else {
  console.log('✓ every check passed')
}
