import { NextRequest } from 'next/server'
import { getViewer, forbiddenJson, actorAdminClient } from '@/lib/auth/viewer'
import { canAccessMeeting } from '@/lib/meetings/access'
import { whisperEnabled } from '@/lib/ai/whisper'
import { runMeetingTranscription } from '@/lib/meetings/transcribe'

interface RouteContext {
  params: Promise<{ id: string }>
}

// Kicks off local Whisper transcription of an attached audio file and returns
// immediately; the work runs in the background and updates meetings.transcription_status
// (poll via GET /api/meetings/[id]).
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const supabase = await actorAdminClient()

  const { data: meeting } = await supabase
    .from('meetings')
    .select('scope, project_id, transcript, transcription_status')
    .eq('id', id)
    .maybeSingle()
  if (!meeting) return Response.json({ error: 'Meeting not found' }, { status: 404 })

  const viewer = await getViewer()
  if (viewer && !(await canAccessMeeting(viewer, meeting))) return forbiddenJson()

  if (!whisperEnabled()) {
    return Response.json({ error: 'Transcription is not available on this server.' }, { status: 501 })
  }

  const body = await request.json().catch(() => ({}))
  const documentId = typeof body.document_id === 'string' ? body.document_id : null
  const force = body.force === true
  if (!documentId) return Response.json({ error: 'document_id is required' }, { status: 400 })

  const { data: doc } = await supabase
    .from('documents')
    .select('id, mime_type, meeting_id')
    .eq('id', documentId)
    .maybeSingle()
  if (!doc || doc.meeting_id !== id) {
    return Response.json({ error: 'That file is not attached to this meeting.' }, { status: 400 })
  }
  if (!doc.mime_type?.startsWith('audio/') && !doc.mime_type?.startsWith('video/')) {
    return Response.json({ error: 'Only audio or video files can be transcribed.' }, { status: 400 })
  }

  // Already running, or already transcribed and not explicitly re-run → no-op.
  if (meeting.transcription_status === 'processing') return Response.json({ status: 'processing' })
  if (!force && meeting.transcript && meeting.transcript.trim()) {
    return Response.json({ status: meeting.transcription_status ?? 'complete', skipped: true })
  }

  void runMeetingTranscription(id, documentId)
  return Response.json({ status: 'processing' })
}
