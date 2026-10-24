/**
 * Act on one row of the findings queue: add the contact, link them to one that
 * exists, or record that the name is not a contact at all.
 *
 * ⚠ CREATING A CONTACT HERE IS SANCTIONED PRECISELY BECAUSE A HUMAN PRESSED
 * THE BUTTON. §11 forbids the platform creating a project, opportunity, party or
 * lead on its own and carries exactly one contact exception (reciprocated mail,
 * `src/lib/curator/contacts.ts`). Nothing in this module runs on a schedule;
 * every function takes a decision somebody made in the queue. That is the same
 * standing as the meeting-intake confirm step, which has created parties since
 * the day it shipped.
 *
 * ⚠ AND RESOLVING A NAME RESOLVES EVERY SLOT THAT CARRIES IT, which is what the
 * queue's one-row-per-name promise means. "Ber Wilson" is an attendee on five
 * meetings; being asked five times is how a queue becomes something nobody
 * works. The stamp therefore walks every meeting, not just the one on screen.
 *
 * ⚠ THEN IT ASKS FROM THE SIDE THAT JUST CHANGED. §12: a cleanup that is a side
 * effect of having work to do never reaches the rows with no work. The
 * conversations already happened — linking the name today is what makes them
 * reachable — so `backfillContactFeed` runs on the resolution, and the contact's
 * feed carries August's call the moment somebody is identified in October.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { syncAttendeeActivity } from '@/lib/meetings/attendee-activity'
import { parseAttendees, type MeetingAttendee } from '@/lib/utils/meetings'
import { backfillContactFeed } from '@/lib/contacts/notes'
import { categorizePlayerRole } from '@/lib/contacts/roles'
import type { Database, JsonIn, TablesInsert } from '@/lib/supabase/types'

type AdminClient = SupabaseClient<Database>

export interface ResolveInput {
  /** The name as the queue showed it. Matched case-insensitively on the slots. */
  name: string
  /** Project ids this viewer may not see — meetings on them are left alone. */
  hidden: Set<string>
}

export interface StampResult {
  /** Attendee slots that gained a `party_id`. */
  slotsLinked: number
  /** Meetings touched. */
  meetingsTouched: number
  /** Meetings skipped because they sit on a protected project. */
  meetingsWithheld: number
  /** Notes written onto the contact's feed by the backfill. */
  notesWritten: number
}

/**
 * Point every attendee slot carrying `name` at this contact, then catch the
 * contact's profile and feed up.
 */
export async function linkAttendeeName(
  supabase: AdminClient,
  partyId: string,
  input: ResolveInput,
): Promise<StampResult> {
  const wanted = input.name.trim().toLowerCase()
  const result: StampResult = {
    slotsLinked: 0,
    meetingsTouched: 0,
    meetingsWithheld: 0,
    notesWritten: 0,
  }
  if (!wanted) return result

  const { data: meetings, error } = await supabase
    .from('meetings')
    .select('id, title, meeting_date, scope, kind, project_id, opportunity_id, summary, minutes, attendees')
  if (error) {
    console.error('[attendee-resolve] could not read the meetings:', error.message)
    return result
  }

  for (const meeting of meetings ?? []) {
    // ⚠ FILTERED IN THE LOOP RATHER THAN IN SQL, and only because this read has
    // no LIMIT: §12's rule is that an exclusion must be applied before the
    // LIMIT, since withheld rows at the top would otherwise return an empty
    // answer. With every row read there is no cliff to fall off, and
    // `dropHidden`'s own header says these sets are small enough that a filter
    // in memory cannot misparse a comma the way a malformed `.or()` can.
    if (meeting.project_id && input.hidden.has(meeting.project_id)) {
      result.meetingsWithheld++
      continue
    }

    const attendees = parseAttendees(meeting.attendees)
    let changed = false
    const next: MeetingAttendee[] = attendees.map((a) => {
      if (a.party_id) return a
      if (a.name.trim().toLowerCase() !== wanted) return a
      changed = true
      result.slotsLinked++
      return { ...a, party_id: partyId }
    })
    if (!changed) continue

    const { error: updateErr } = await supabase
      .from('meetings')
      .update({ attendees: next as unknown as JsonIn })
      .eq('id', meeting.id)
    if (updateErr) {
      console.error('[attendee-resolve] could not stamp the attendee:', updateErr.message)
      continue
    }
    result.meetingsTouched++

    // The profile's "Meetings" list is a projection of these links, and it is
    // written by exactly one function however the link was made (§12: an
    // automatic producer must write the same table the manual one does).
    await syncAttendeeActivity(supabase, { ...meeting, kind: meeting.kind }, next)
  }

  const feed = await backfillContactFeed(supabase, partyId)
  result.notesWritten = feed.written
  return result
}

export interface CreateContactInput extends ResolveInput {
  /** What the recordings heard. Editable by the reviewer before they press it. */
  fullName: string
  role: string | null
  company: string | null
  email: string | null
  isOrganization: boolean
}

export interface CreateContactResult {
  partyId: string | null
  stamp: StampResult | null
  error: string | null
}

/**
 * Create the contact a recording named, then link every slot to it.
 *
 * ⚠ TAGGED `from-recording`, WHICH IS THE UNDO HANDLE. The 10-15 contact
 * creation does the same with `auto-contact`, and §13 records why it mattered:
 * when 50 rows needed reviewing, the tag is what selected them together so the
 * existing bulk archive could reverse a whole run. A reviewer working through 21
 * candidates in one sitting is the same situation.
 *
 * ⚠ AND IT REFUSES A NAME THAT IS ALREADY A CONTACT. The queue only lists names
 * no contact answered to when it was BUILT, and a reviewer may sit on the page
 * while another door creates the same person — or press the button twice. §12: a
 * refusal must not be reported as an absence, because the caller creates on
 * absence and makes the duplicate that guarantees the next refusal. So this
 * answers with the EXISTING id and links to it, which is what the reviewer
 * wanted either way.
 */
export async function createContactFromRecording(
  supabase: AdminClient,
  input: CreateContactInput,
): Promise<CreateContactResult> {
  const fullName = input.fullName.trim()
  if (!fullName) return { partyId: null, stamp: null, error: 'a name is required' }

  // ⚠ A SURNAME IS REQUIRED FOR A PERSON, which is the queue's `fragment` rule
  // enforced at the write rather than only in the UI. A reviewer can type the
  // surname the recording never said; what they cannot do is create "Mike".
  // §12: allow a first name only as a prefix of something longer, never a
  // prefix alone — a directory of first names cannot be matched against ever
  // again, so this is cheaper to refuse than to undo.
  if (!input.isOrganization && fullName.split(/\s+/).filter(Boolean).length < 2) {
    return {
      partyId: null,
      stamp: null,
      error: `"${fullName}" is one word — add a surname, or link them to a contact that already exists`,
    }
  }

  const { data: already } = await supabase
    .from('parties')
    .select('id')
    .ilike('full_name', fullName)
    .is('merged_into_party_id', null)
    .limit(2)

  if (already && already.length === 1) {
    const stamp = await linkAttendeeName(supabase, already[0].id, input)
    return { partyId: already[0].id, stamp, error: null }
  }
  if (already && already.length > 1) {
    // Two rows already answer to this name. §12: ambiguity must mean NO match —
    // picking one would attach a conversation to whichever sorted first.
    return {
      partyId: null,
      stamp: null,
      error: `two contacts already answer to "${fullName}" — link to the right one instead`,
    }
  }

  const row: TablesInsert<'parties'> = {
    full_name: fullName,
    title: input.role,
    company: input.company,
    email: input.email,
    is_organization: input.isOrganization,
    tags: ['from-recording'],
    relationship_notes: null,
  }
  const { data, error } = await supabase.from('parties').insert(row).select('id').single()
  if (error || !data) {
    return { partyId: null, stamp: null, error: error?.message ?? 'could not create the contact' }
  }

  // What they ARE, through the one resolver every writer goes through (§4) —
  // never the model's prose passed straight into a column, which is how 103 of
  // 104 role values came to be free text.
  if (input.role) {
    const roleKey = await categorizePlayerRole(input.role)
    if (roleKey) {
      await supabase
        .from('party_roles')
        .insert({ party_id: data.id, role_key: roleKey })
        .then(({ error: roleErr }) => {
          // One role tag, never the contact.
          if (roleErr) console.error('[attendee-resolve] could not set the role:', roleErr.message)
        })
    }
  }

  const stamp = await linkAttendeeName(supabase, data.id, input)
  return { partyId: data.id, stamp, error: null }
}

/** Record that a heard name is not a contact, so the queue can reach zero. */
export async function skipAttendeeName(
  supabase: AdminClient,
  name: string,
  reason: 'organization' | 'internal' | 'not_a_person' | 'declined',
  note?: string | null,
): Promise<{ ok: boolean; error: string | null }> {
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, error: 'a name is required' }

  // `name_key` is a STORED GENERATED column, so it is a legitimate `ON CONFLICT`
  // target where an expression index would not be (§12) — and the conflict is on
  // the key, never on `name`, exactly as `contact_aliases` does it.
  const { error } = await supabase
    .from('meeting_attendee_skips')
    .upsert({ name: trimmed, reason, note: note ?? null }, { onConflict: 'name_key' })
  if (error) return { ok: false, error: error.message }
  return { ok: true, error: null }
}
