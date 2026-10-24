/**
 * Read the findings queue: every person heard on a recording who is not yet a
 * contact, classified, with the calls they were on.
 *
 * The classification itself is pure and lives in `attendee-findings.ts`; this is
 * the reading half — who "we" are, which meetings may be shown, and which names
 * a human has already tombstoned.
 *
 * ⚠ IT IS A CROSS-PORTFOLIO SURFACE, SO THE CONFIDENTIALITY FILTER IS NOT
 * OPTIONAL. §8: a project marked `confidential` leaves every cross-portfolio
 * surface and all portfolio-wide retrieval. A meeting filed on a protected
 * project names its attendees, so an unfiltered queue would list the people in a
 * protected deal's calls on a page anybody can open — containment broken by a
 * page that has nothing to do with projects. The exclusion runs in SQL, before
 * the limit (§12), and the WITHHELD COUNT is returned rather than derived: once
 * the rows are gone, `rows.length - visible.length` is structurally zero.
 *
 * ⚠ AND THE HIDDEN SET IS A REQUIRED PARAMETER RATHER THAN A DEFAULT, WHICH IS
 * THE ONE PLACE THIS FILE DEPARTS FROM §12's "a security filter belongs at the
 * choke point as a default". Resolving the viewer here would mean importing
 * `viewerHiddenProjectIds` → `getViewer` → `supabase/server` → `next/headers`,
 * and §12 records what that costs: `next/headers` does not resolve under
 * `deploy/register.mjs` AT ALL, so a top-level import of it poisons the whole
 * module including its pure functions — which is precisely how the access layer
 * became untestable. A REQUIRED parameter is the stronger guard anyway: a
 * default can be forgotten silently, while `tsc` names every caller that omits
 * this one. The rule's own remedy is "make the parameter explicit so a job that
 * forgets gets the SAFE behaviour", and there is no way to forget a required
 * argument.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { notInList } from '@/lib/security/confidential'
import {
  buildAttendeeFindings,
  type AttendeeFinding,
  type DirectoryFacts,
  type MeetingWithAttendees,
} from '@/lib/contacts/attendee-findings'
import { parseAttendees } from '@/lib/utils/meetings'

export interface AttendeeQueue {
  findings: AttendeeFinding[]
  /** Meetings withheld because they sit on a protected project. */
  withheldMeetings: number
  /** Names a human has already said are not contacts. */
  skipped: number
  /** Attendee slots examined, so an empty queue is distinguishable from a dead one. */
  slotsExamined: number
}

/**
 * Who "we" are — names, addresses, and how many of us answer to each first name.
 *
 * ⚠ FROM `team_members`, WHICH IS A TABLE, NOT FROM A NAME TEST. §12: a
 * self-loop guard keyed on a display name is defeated by a rename that is itself
 * a good idea. The first-name map carries a COUNT rather than a name so a second
 * Eric joining the company makes "Eric" undecidable instead of silently
 * resolving to the first one.
 */
export async function internalIdentities(): Promise<
  DirectoryFacts & { partyByName: Map<string, string> }
> {
  const supabase = createAdminClient()
  const names = new Set<string>()
  const addresses = new Set<string>()
  const addressLocalParts = new Set<string>()
  const firstNames = new Map<string, number>()
  const organizationNames = new Set<string>()
  const partyByName = new Map<string, string>()

  const [{ data: members }, { data: orgs }] = await Promise.all([
    supabase.from('team_members').select('name, email, party_id, active').eq('active', true),
    supabase.from('parties').select('full_name').eq('is_organization', true),
  ])

  for (const member of members ?? []) {
    const name = (member.name ?? '').trim().toLowerCase()
    if (name) {
      names.add(name)
      if (member.party_id) partyByName.set(name, member.party_id)
      const first = name.split(/\s+/)[0]
      if (first) firstNames.set(first, (firstNames.get(first) ?? 0) + 1)
    }
    const email = (member.email ?? '').trim().toLowerCase()
    if (email) {
      addresses.add(email)
      const local = email.split('@')[0]
      if (local) addressLocalParts.add(local)
    }
  }

  for (const org of orgs ?? []) {
    const name = (org.full_name ?? '').trim().toLowerCase()
    if (name) organizationNames.add(name)
  }

  return { names, addresses, addressLocalParts, firstNames, organizationNames, partyByName }
}

/**
 * Read the queue.
 *
 * `hidden` is the set of project ids this viewer may not see —
 * `viewerHiddenProjectIds()` on a page, `confidentialProjectIds()` in a cron.
 * Pass an empty set only where there is deliberately nothing to hide.
 */
export async function readAttendeeQueue(
  hidden: Set<string>,
  limit = 300,
): Promise<AttendeeQueue> {
  const supabase = createAdminClient()

  const [internal, skipRows] = await Promise.all([
    internalIdentities(),
    supabase.from('meeting_attendee_skips').select('name_key'),
  ])

  const skippedNameKeys = new Set(
    (skipRows.data ?? []).map((r) => (r.name_key ?? '').trim()).filter(Boolean),
  )

  // ⚠ THE EXCLUSION IS IN SQL AND THE COUNT COMES FROM ITS OWN QUERY.
  // `or(project_id.is.null, project_id.not.in.(…))` rather than a bare
  // `not.in` — §12: `not.in` is NULL, and therefore not true, for a nullable
  // column, so a bare exclusion would have dropped every meeting that is NOT on
  // a project, which is the whole point of this queue.
  const exclusion = notInList(hidden)

  let query = supabase
    .from('meetings')
    .select('id, title, meeting_date, scope, summary, attendees, project_id')
    .order('meeting_date', { ascending: false, nullsFirst: false })
    .limit(limit)
  if (exclusion) query = query.or(`project_id.is.null,project_id.not.in.${exclusion}`)

  const { data, error } = await query
  if (error) {
    console.error('[contacts/attendee-queue] could not read the meetings:', error.message)
    return { findings: [], withheldMeetings: 0, skipped: skippedNameKeys.size, slotsExamined: 0 }
  }

  let withheldMeetings = 0
  if (exclusion) {
    const { count } = await supabase
      .from('meetings')
      .select('id', { count: 'exact', head: true })
      .in('project_id', [...hidden])
    withheldMeetings = count ?? 0
  }

  const meetings: MeetingWithAttendees[] = (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    meeting_date: row.meeting_date,
    scope: row.scope,
    summary: row.summary,
    // ⚠ THROUGH `parseAttendees`, NEVER BY CASTING THE JSONB — and with no
    // `as unknown as` either, which §12 records as having hidden a real missing
    // field until a grep found it. `MeetingAttendee` is assignable to
    // `RawAttendee` on its own, so `tsc` is still checking the shape.
    //
    // ⚠ AND IT IS A NARROWER SHAPE THAN THE MODEL PRODUCED. parseAttendees
    // keeps name / role / org / party_id / team_member_id and drops `email` and
    // `is_organization`, so a stored row carries neither — verified against the
    // live jsonb, which holds exactly those five keys. The classifier therefore
    // cannot lean on the model's organization flag for anything already
    // registered; it reads the flag when a caller hands it one (the review
    // screen does) and falls back on the additive name and role tests here.
    attendees: parseAttendees(row.attendees),
  }))

  const slotsExamined = meetings.reduce((n, m) => n + (m.attendees?.length ?? 0), 0)

  return {
    findings: buildAttendeeFindings(meetings, internal, skippedNameKeys),
    withheldMeetings,
    skipped: skippedNameKeys.size,
    slotsExamined,
  }
}

/**
 * How many rows of the queue a reader can actually ACT on.
 *
 * ⚠ ONE QUANTITY, ONE DEFINITION, AND IT IS DERIVED RATHER THAN TRANSCRIBED.
 * §12: three "needs attention" numbers on one screen were 1, 99+ and 197, and a
 * label written inline on four screens is a label with no owner. This is the
 * count the directory's badge shows AND the number the queue's default lane
 * shows when it opens, because both come from this function reading the same
 * findings — not from two similar predicates written in two places.
 *
 * `candidate` and nothing else: those are the rows where a contact can be
 * created. The organizations, the one-word names and our own people are real
 * work too, but they are a tidy-up rather than a person we have met and failed
 * to write down, and a badge counting them would never reach zero.
 */
export async function countActionableAttendees(hidden: Set<string>): Promise<number> {
  const queue = await readAttendeeQueue(hidden)
  return queue.findings.filter((f) => f.classification.kind === 'candidate').length
}
