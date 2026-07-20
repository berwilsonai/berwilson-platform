import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { analyzeMeetingNotes } from '@/lib/email-ingestion/analyze-meeting'
import { EmailIntakeError, SYSTEM_USER_ID } from '@/lib/email-ingestion/analyze'

export const maxDuration = 300

function nullableStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()

  let userId = SYSTEM_USER_ID
  try {
    const userSupabase = await createClient()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (user?.id) userId = user.id
  } catch {
    /* fall back to system user */
  }

  const body = await request.json().catch(() => ({}))
  const title = nullableStr(body.title)
  const meetingDate = nullableStr(body.meeting_date) // validated (ISO) in normalize
  let text = nullableStr(body.raw_text) ?? ''

  // Uploaded .md/.txt path: read from the documents bucket.
  if (!text && body.storage_path) {
    const { data, error } = await supabase.storage.from('documents').download(body.storage_path)
    if (error || !data) {
      return Response.json({ error: 'Could not read the uploaded file.' }, { status: 400 })
    }
    text = (await data.text()).trim()
  }

  if (!text) {
    return Response.json({ error: 'Paste the meeting notes or upload a file first.' }, { status: 400 })
  }

  try {
    const result = await analyzeMeetingNotes({ rawText: text, title, meetingDate, userId })
    return Response.json(result)
  } catch (err) {
    if (err instanceof EmailIntakeError) {
      return Response.json({ error: err.message }, { status: err.status })
    }
    throw err
  }
}
