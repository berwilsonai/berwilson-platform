/**
 * Repair: a recording's `meetings` row that never followed its filed thread.
 *
 *   node --experimental-strip-types --import ./deploy/register.mjs \
 *        --env-file=.env.local scripts/one-shot/file-stranded-recording-meetings.mts [--apply]
 *
 * ⚠ WHY ANY ROW IS IN THIS STATE. Every recording sweep writes the `meetings`
 * row LAST, because the recap costs a model pass — so at the moment
 * `applyThreadUpdates` visits that thread's link there is no meeting to move,
 * and by the next run the link is caught up on text and attachments and is
 * never visited again. The thread sits correctly filed on the deal while the
 * register still says the call belonged to nobody, which is also what
 * `search_meetings` filtered by project answers. §12: a cleanup that is a side
 * effect of having work to do never reaches the rows with no work.
 *
 * Fixed forward in `fileMeetingFromThreadLinks`, which both sweeps now call at
 * the moment they write the row. This is the backfill for the rows written
 * before that existed. Idempotent — a filed meeting is left alone by
 * `attachMeetingToRecord`, which refuses to relocate one that carries a record.
 *
 * ⚠ A SYSTEM ACTION AND NOT A HUMAN'S FILING DECISION, which is the distinction
 * §12 draws about scripted refiling. Nobody is being credited with a judgement
 * here: the judgement was already made and recorded on `thread_links`, and this
 * only makes the projection agree with it.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { fileMeetingFromThreadLinks } from '@/lib/meetings/attach-recording'
import { LOCAL_THREAD_PREFIXES } from '@/lib/email-sweep/thread-source'

const apply = process.argv.includes('--apply')
const supabase = createAdminClient()

const { data: threads, error } = await supabase
  .from('email_threads')
  .select('id, gmail_thread_id, subject')
  .or(LOCAL_THREAD_PREFIXES.map((p) => `gmail_thread_id.like."${p}%"`).join(','))
if (error) throw new Error(error.message)

let candidates = 0
let moved = 0
for (const t of threads ?? []) {
  const { data: meeting } = await supabase
    .from('meetings')
    .select('id, project_id, opportunity_id')
    .eq('drive_file_id', t.gmail_thread_id ?? '')
    .maybeSingle()
  if (!meeting || meeting.project_id || meeting.opportunity_id) continue

  const { data: links } = await supabase
    .from('thread_links')
    .select('record_kind, record_id')
    .eq('thread_id', t.id)
    .eq('certainty', 'linked')
    .in('record_kind', ['project', 'opportunity'])
  if (!links?.length) continue

  candidates++
  console.log(
    `${apply ? 'FILING' : 'WOULD FILE'}  ${t.subject} — ${links.length} linked record(s)`
  )
  if (!apply) continue

  const result = await fileMeetingFromThreadLinks(t.id)
  console.log(`          → ${result.moved ? 'moved' : `not moved: ${result.reason}`}`)
  if (result.moved) moved++
}

console.log(
  `\n${candidates} stranded meeting(s)` + (apply ? `, ${moved} filed.` : '. Re-run with --apply.')
)
