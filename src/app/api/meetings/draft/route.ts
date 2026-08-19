import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getViewer, forbiddenJson } from '@/lib/auth/viewer'
import { extractMeeting } from '@/lib/email-ingestion/analyze-meeting'
import { EmailIntakeError, SYSTEM_USER_ID } from '@/lib/email-ingestion/analyze'

// AI pass over a pasted transcript — used by the "Draft summary" button on the
// project Meetings form. Returns a structured draft (summary, minutes,
// attendees, decisions, tasks) to prefill the form; it does NOT stage a session
// or create any records (unlike the /intake meeting flow).
export const maxDuration = 300

export async function POST(request: NextRequest) {
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) return forbiddenJson()

  let userId = SYSTEM_USER_ID
  try {
    const userSupabase = await createClient()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (user?.id) userId = user.id
  } catch {
    /* fall back to system user */
  }

  const body = await request.json().catch(() => ({}))
  const text = typeof body.transcript === 'string' ? body.transcript.trim() : ''
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : null
  const meetingDate =
    typeof body.meeting_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.meeting_date)
      ? body.meeting_date
      : null

  if (!text) {
    return Response.json({ error: 'Paste a transcript first.' }, { status: 400 })
  }

  try {
    const extraction = await extractMeeting({ rawText: text, title, meetingDate, userId })
    return Response.json({ extraction })
  } catch (err) {
    if (err instanceof EmailIntakeError) {
      return Response.json({ error: err.message }, { status: err.status })
    }
    console.error('Meeting draft failed:', err)
    return Response.json({ error: 'AI drafting failed. Check the AI provider and try again.' }, { status: 500 })
  }
}
