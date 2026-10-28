/**
 * Put the calendar invitees onto the recordings that were registered without
 * them.
 *
 * ⚠ WHY A BACKFILL IS NEEDED AT ALL. Every recording door is idempotent on its
 * `drive_file_id`, so the eleven recordings already in the register will never
 * be read again — they will report "already staged" forever, and the fix
 * shipped today would apply only to the twelfth. The measured case is the one
 * that prompted it: a two-person meeting whose invitation named both people by
 * address came back with five attendees, of whom one was our own company's
 * `parties` row wearing a person's name.
 *
 * ⚠ IT ADDS AND CORRECTS; IT NEVER DELETES. A human confirmed some of these
 * lists, and a name the transcript produced may be real even where the
 * invitation does not carry it — somebody who dialled in, somebody who was in
 * the room uninvited. So an invitee is unioned on (`unionAssertedAttendees`,
 * the same function the live path uses — §12: never fork a shared pass), a
 * slot the invitation names is corrected to the invitation's own answer, and
 * anything else is left exactly where it is and reported for a human to prune.
 *
 * ⚠ AND IT IS VERIFIABLE AS IDEMPOTENT, which §12 requires of any pass that
 * reports what it did: run it twice and the second run must report nothing.
 * `--check` reads without writing.
 *
 *   node --import ./deploy/register.mjs --env-file=.env.local \
 *        scripts/backfill-meeting-calendar-attendees.mts [--check]
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { findRecordingCalendarEvent, inviteeAttendees } from '@/lib/meetings/calendar-match'
import { unionAssertedAttendees } from '@/lib/meetings/record'
import { syncAttendeeActivity } from '@/lib/meetings/attendee-activity'
import { logMeetingOnContacts } from '@/lib/contacts/notes'
import { recordedAtFromName } from '@/lib/driveaudio/read'
import { parseAttendees, type MeetingAttendee } from '@/lib/utils/meetings'
import type { JsonIn } from '@/lib/supabase/types'

const CHECK = process.argv.includes('--check')
const RECORDING_REF = /^(voicememo|driveaudio|note|upload):/

/**
 * The clock for a recording, recovered from what was stored at the time.
 *
 * ⚠ EACH SOURCE KEEPS ITS INSTANT SOMEWHERE DIFFERENT, AND ONE OF THEM KEEPS
 * IT NOWHERE. A voice memo's `source_title` IS its ISO instant, because the
 * phone names every memo that way (§13) — which makes the source with the
 * worst titles the one with the best clock. A Drive export's name carries a
 * timestamp when the exporter wrote one. A Notes call keeps neither on the row,
 * so it gets the meeting's date at midday and may only ever join on its title.
 */
function clockFor(ref: string, sourceTitle: string | null, meetingDate: string) {
  const iso = sourceTitle?.trim() ?? ''
  if (ref.startsWith('voicememo:') && !Number.isNaN(Date.parse(iso))) {
    return { recordedAt: new Date(iso).toISOString(), exact: true }
  }
  const fromName = sourceTitle ? recordedAtFromName(sourceTitle) : null
  if (fromName) return { recordedAt: fromName, exact: true }
  return { recordedAt: new Date(`${meetingDate}T12:00:00`).toISOString(), exact: false }
}

/** Did the union actually change anything? Compared field by field, because a
 *  reordered list that says the same thing is not a change worth writing. */
function differs(before: MeetingAttendee[], after: MeetingAttendee[]): boolean {
  if (before.length !== after.length) return true
  const key = (a: MeetingAttendee) =>
    `${a.name}|${a.email ?? ''}|${a.party_id ?? ''}|${a.team_member_id ?? ''}|${a.role ?? ''}|${a.org ?? ''}`
  const b = before.map(key).sort()
  const a = after.map(key).sort()
  return b.some((v, i) => v !== a[i])
}

async function main() {
  const supabase = createAdminClient()

  const { data: meetings, error } = await supabase
    .from('meetings')
    .select('id, title, meeting_date, scope, kind, project_id, opportunity_id, summary, minutes, attendees, drive_file_id')
    .not('drive_file_id', 'is', null)
    .order('meeting_date', { ascending: false })
  if (error) throw new Error(error.message)

  const recordings = (meetings ?? []).filter((m) => RECORDING_REF.test(m.drive_file_id ?? ''))
  // §12: print what was EXAMINED — an empty population passes vacuously behind
  // the same tick as a clean one.
  console.log(`${recordings.length} recording(s) in the register${CHECK ? '  (check only — nothing will be written)' : ''}\n`)

  const refs = recordings.map((m) => m.drive_file_id as string)
  const { data: sessions } = await supabase
    .from('email_intake_sessions')
    .select('drive_file_id, source_title')
    .in('drive_file_id', refs)
  const sourceTitle = new Map((sessions ?? []).map((s) => [s.drive_file_id as string, s.source_title]))

  let matched = 0
  let changed = 0
  let dateFixed = 0

  for (const m of recordings) {
    const ref = m.drive_file_id as string
    const outside = sourceTitle.get(ref) ?? null
    const label = outside || m.title

    if (!outside) {
      // ⚠ THE MODEL'S TITLE MAY NOT FILE (§12). It names a topic; only a
      // human's title names a record, and a calendar join on a rewritten
      // summary is exactly the fuzzy match that puts a call on the wrong deal.
      console.log(`—  ${m.title}\n   no outside title on the session; not matched on the model's rewrite`)
      continue
    }

    const found = await findRecordingCalendarEvent({
      title: outside,
      clock: clockFor(ref, outside, m.meeting_date),
    })
    if (!found) {
      console.log(`—  ${label}  (${m.meeting_date})\n   no calendar event`)
      continue
    }
    matched++

    const invitees = await inviteeAttendees(found.event)
    const before = parseAttendees(m.attendees)
    const after = unionAssertedAttendees(before, invitees)
    const eventDate = new Date(found.event.start)
    const pad = (n: number) => String(n).padStart(2, '0')
    const onDate = `${eventDate.getFullYear()}-${pad(eventDate.getMonth() + 1)}-${pad(eventDate.getDate())}`

    const attendeesChanged = differs(before, after)
    const dateChanged = onDate !== m.meeting_date
    console.log(
      `✓  ${label}\n   → "${found.event.subject}" via ${found.via}, ${invitees.length} invitee(s)` +
        `\n     attendees ${before.length} → ${after.length}${attendeesChanged ? '' : '  (unchanged)'}` +
        (dateChanged ? `\n     date ${m.meeting_date} → ${onDate}  (the invitation's own)` : '')
    )
    for (const a of after) {
      const mark = before.some((b) => b.name === a.name && b.party_id === a.party_id) ? ' ' : '+'
      console.log(`     ${mark} ${a.name}${a.email ? ` <${a.email}>` : ''}${a.party_id ? '' : '   [no contact]'}`)
    }

    if (!attendeesChanged && !dateChanged) continue
    if (CHECK) {
      changed++
      if (dateChanged) dateFixed++
      continue
    }

    const patch: { attendees?: JsonIn; meeting_date?: string } = {}
    if (attendeesChanged) patch.attendees = after as unknown as JsonIn
    if (dateChanged) patch.meeting_date = onDate
    const { error: updateErr } = await supabase.from('meetings').update(patch).eq('id', m.id)
    if (updateErr) {
      console.log(`     ! could not write: ${updateErr.message}`)
      continue
    }
    changed++
    if (dateChanged) dateFixed++

    // The projections follow, or the profiles keep the old list and the old
    // date (§12: an orphaned projection looks perfectly live). Both are the
    // same calls `upsertMeetingFromImport` makes.
    const row = { ...m, meeting_date: dateChanged ? onDate : m.meeting_date }
    await syncAttendeeActivity(supabase, row, after)
    await logMeetingOnContacts(
      supabase,
      row,
      after.map((a) => a.party_id).filter((id): id is string => !!id)
    )
  }

  console.log(
    `\n${matched} matched to a calendar event, ${changed} ${CHECK ? 'would change' : 'changed'}` +
      `, ${dateFixed} ${CHECK ? 'would be' : ''} re-dated.`
  )
  if (!CHECK && changed > 0) console.log('Run again: a second run must report 0 changed.')
}

await main()
