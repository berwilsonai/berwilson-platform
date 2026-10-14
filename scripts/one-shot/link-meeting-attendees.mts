/**
 * Link the attendees of meetings that were imported before the linker existed,
 * and put each meeting on their contact profile.
 *
 * ⚠ FIXING THE PRODUCER CHANGES NOTHING THE READER SEES (§12) — the rows
 * already written carry `party_id: null` for every attendee, including exact
 * name matches like "Ericson Tua'one", so every imported meeting stays invisible
 * on every contact. Measured 2026-10-14 before this ran: 9 meetings, and ZERO
 * `meeting_attended` rows for any of the six the Meet importer wrote.
 *
 * No model call: `matchExtractedParties` is email-then-name lookups, and only
 * its IDENTITY verdicts are accepted here (see `linkAttendees`). A fuzzy hit is
 * left for a human, exactly as it is on the import path.
 *
 * Idempotent — run it twice and the second pass reports nothing.
 *
 *   node --experimental-strip-types --import ./deploy/register.mjs \
 *        --env-file=.env.local scripts/one-shot/link-meeting-attendees.mts [--apply]
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { matchExtractedParties } from '@/lib/ai/proposal-matching'
import { linkAttendees } from '@/lib/meetings/record'
import { syncAttendeeActivity } from '@/lib/meetings/attendee-activity'
import { parseAttendees } from '@/lib/utils/meetings'
import type { JsonIn } from '@/lib/supabase/types'

const apply = process.argv.includes('--apply')
const db = createAdminClient()

const { data: meetings, error } = await db
  .from('meetings')
  .select('id, title, meeting_date, scope, kind, project_id, opportunity_id, attendees')
  .order('meeting_date', { ascending: false })
if (error) throw new Error(error.message)

let changed = 0
let linkedTotal = 0

for (const m of meetings ?? []) {
  const before = parseAttendees(m.attendees)
  if (before.length === 0) continue
  const unlinked = before.filter((a) => !a.party_id)
  if (unlinked.length === 0) continue

  const matches = await matchExtractedParties(
    before.map((a) => ({
      name: a.name,
      // Deliberately NOT a.org: `matchExtractedParties` ANDs the company into
      // its exact-name lookup, and an attendee listed under "Ber Wilson"
      // against a party whose company reads "Ber Wilson LLC" then matches
      // nothing. Ambiguity is caught by name uniqueness in linkAttendees.
      company: null,
      role: a.role ?? '',
      email: null,
      phone: null,
      is_organization: false,
    }))
  ).catch(() => [])

  const after = await linkAttendees(before, matches)
  const gained = after.filter((a, i) => a.party_id && !before[i]?.party_id)
  if (gained.length === 0) continue

  changed++
  linkedTotal += gained.length
  console.log(
    `${m.meeting_date}  ${m.title.slice(0, 60)}\n   + ${gained.map((g) => g.name).join(', ')}`
  )

  if (!apply) continue
  const { error: upErr } = await db
    .from('meetings')
    .update({ attendees: after as unknown as JsonIn })
    .eq('id', m.id)
  if (upErr) {
    console.error(`   ! could not update: ${upErr.message}`)
    continue
  }
  await syncAttendeeActivity(db, m, after)
}

console.log(
  `\n${changed} meeting(s), ${linkedTotal} attendee link(s)${apply ? ' applied' : ' — dry run, pass --apply'}`
)
