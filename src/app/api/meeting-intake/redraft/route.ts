import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { extractMeeting } from '@/lib/email-ingestion/analyze-meeting'
import { EmailIntakeError, SYSTEM_USER_ID } from '@/lib/email-ingestion/analyze'

export const maxDuration = 300

function nullableStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/**
 * POST /api/meeting-intake/redraft
 *
 * Re-run the AI over the (edited) minutes to re-suggest tasks + attendees, WITHOUT
 * staging a new session. Used by the review screen's "Re-suggest from minutes"
 * button after the user has cleaned up names/notes. Returns the fresh extraction;
 * the client merges tasks/attendees, keeping the user's target + attendee edits.
 */
export async function POST(request: NextRequest) {
  let userId = SYSTEM_USER_ID
  try {
    const userSupabase = await createClient()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (user?.id) userId = user.id
  } catch {
    /* fall back to system user */
  }

  const body = await request.json().catch(() => ({}))
  const text = nullableStr(body.text)
  const title = nullableStr(body.title)
  const meetingDate = nullableStr(body.meeting_date)
  if (!text) {
    return Response.json({ error: 'Nothing to re-draft — add the minutes first.' }, { status: 400 })
  }

  try {
    const extraction = await extractMeeting({ rawText: text, title, meetingDate, userId })
    return Response.json({ tasks: extraction.tasks, attendees: extraction.attendees })
  } catch (err) {
    if (err instanceof EmailIntakeError) {
      return Response.json({ error: err.message }, { status: err.status })
    }
    throw err
  }
}
