import { createAdminClient } from '@/lib/supabase/admin'
import { viewerHiddenProjectIds } from '@/lib/security/request'
import { readAttendeeQueue } from '@/lib/contacts/attendee-queue'
import UnlinkedAttendees from '@/components/contacts/UnlinkedAttendees'

export const metadata = { title: 'People we have met — Ber Wilson Intelligence' }

/**
 * The findings queue for people heard on recordings who are not contacts yet.
 *
 * ⚠ THE CONFIDENTIALITY ANSWER IS RESOLVED HERE AND PASSED DOWN, because this
 * is where a viewer exists. `readAttendeeQueue` takes the hidden set as a
 * REQUIRED argument rather than resolving it itself — see that module's header:
 * importing `viewerHiddenProjectIds` there would drag `next/headers` into a
 * module the crons and the verification scripts load, and §12 records that
 * `next/headers` does not resolve under `deploy/register.mjs` at all, poisoning
 * the whole module including its pure functions.
 */
export default async function UnlinkedAttendeesPage() {
  const supabase = createAdminClient()

  const [hidden, { data: contacts }] = await Promise.all([
    viewerHiddenProjectIds(),
    // The whole directory, for the "link to an existing contact" type-ahead.
    // Organizations included: an attendee classified `organization` may
    // legitimately be linked to the organization contact it names. Merged rows
    // are excluded — `merged_into_party_id` is the tombstone (§4), and offering
    // a merged duplicate as a link target would undo the merge.
    supabase
      .from('parties')
      .select('id, full_name, company, email, is_organization')
      .is('merged_into_party_id', null)
      .order('full_name'),
  ])

  const queue = await readAttendeeQueue(hidden)

  return (
    <UnlinkedAttendees
      findings={queue.findings}
      contacts={contacts ?? []}
      withheldMeetings={queue.withheldMeetings}
      slotsExamined={queue.slotsExamined}
      skipped={queue.skipped}
    />
  )
}
