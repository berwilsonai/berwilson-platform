// Background transcription pipeline for a meeting's audio recording:
//   download audio → Whisper → save the transcript (editable field + immutable
//   .txt artifact) → auto-summary (only if none yet; never touches minutes) →
//   refresh the preserved/embedded minutes document. Sets meetings.transcription_status
//   so the UI can poll. Never throws — settles status to complete/error.

import { createAdminClient } from '@/lib/supabase/admin'
import type { TablesUpdate } from '@/lib/supabase/types'
import { transcribeAudio, whisperEnabled } from '@/lib/ai/whisper'
import { extractMeeting } from '@/lib/email-ingestion/analyze-meeting'
import { SYSTEM_USER_ID } from '@/lib/email-ingestion/analyze'
import { storeExtractedText } from '@/lib/ai/document-text'
import { embedDocument } from '@/lib/ai/embeddings'
import { syncMeetingDocument, type MeetingRecord } from '@/lib/meetings/document'
import { isBoard } from '@/lib/utils/meetings'

type AdminClient = ReturnType<typeof createAdminClient>

interface MeetingRow extends MeetingRecord {
  summary: string | null
}

/** Remove a meeting's previous transcript document(s) (rows cascade chunks, then
 *  their storage objects) so a re-transcribe doesn't pile up duplicates. */
async function removeTranscriptDocs(supabase: AdminClient, meetingId: string): Promise<void> {
  const { data: old } = await supabase
    .from('documents')
    .select('id, storage_path')
    .eq('meeting_id', meetingId)
    .eq('doc_type', 'transcript')
  if (!old?.length) return
  await supabase.from('documents').delete().in('id', old.map((d) => d.id))
  const paths = old.map((d) => d.storage_path).filter(Boolean)
  if (paths.length) await supabase.storage.from('documents').remove(paths)
}

/** Save the verbatim transcript as an immutable .txt artifact on the meeting,
 *  and embed it for Ber AI when the meeting opts in. */
async function saveTranscriptDocument(supabase: AdminClient, meeting: MeetingRow, text: string): Promise<void> {
  await removeTranscriptDocs(supabase, meeting.id)
  const board = isBoard(meeting.scope)
  const projectId = board ? null : meeting.project_id
  const path = `meetings/${meeting.id}/${Date.now()}_transcript.txt`

  const { error: upErr } = await supabase.storage
    .from('documents')
    .upload(path, Buffer.from(text, 'utf-8'), { contentType: 'text/plain', upsert: false })
  if (upErr) {
    console.error('[meetings] transcript upload failed:', upErr.message)
    return
  }
  const { data: doc, error } = await supabase
    .from('documents')
    .insert({
      // meeting-scoped only (see syncMeetingDocument) — kept out of the project
      // Documents tab; the chunk is still project-scoped via embedDocument.
      meeting_id: meeting.id,
      project_id: null,
      storage_path: path,
      file_name: `Transcript — ${meeting.title}.txt`,
      file_size_bytes: Buffer.byteLength(text, 'utf-8'),
      mime_type: 'text/plain',
      doc_type: 'transcript',
      source: 'document' as const,
    })
    .select('id')
    .single()
  if (error || !doc) {
    console.error('[meetings] transcript insert failed:', error?.message)
    return
  }
  await storeExtractedText(supabase, 'documents', doc.id, text)
  if (meeting.index_ai) await embedDocument(doc.id, projectId, text, null, board)
  else await supabase.from('documents').update({ embedding_status: 'skipped' }).eq('id', doc.id)
}

/**
 * Transcribe the given audio document for a meeting. Runs in the background
 * (fire-and-forget from the route). documentId must be an audio file attached to
 * the meeting.
 */
export async function runMeetingTranscription(meetingId: string, documentId: string): Promise<void> {
  const supabase = createAdminClient()
  if (!whisperEnabled()) {
    await supabase.from('meetings').update({ transcription_status: 'error' }).eq('id', meetingId)
    return
  }
  await supabase.from('meetings').update({ transcription_status: 'processing' }).eq('id', meetingId)
  try {
    const { data: doc } = await supabase
      .from('documents')
      .select('id, storage_path, file_name, meeting_id')
      .eq('id', documentId)
      .maybeSingle()
    if (!doc || doc.meeting_id !== meetingId) throw new Error('Audio document not found on this meeting.')

    const { data: blob, error: dlErr } = await supabase.storage.from('documents').download(doc.storage_path)
    if (dlErr || !blob) throw new Error(`Could not download audio: ${dlErr?.message ?? 'no data'}`)

    const text = await transcribeAudio(Buffer.from(await blob.arrayBuffer()), doc.file_name)
    if (!text) throw new Error('Transcription produced no text.')

    const { data: meeting } = await supabase.from('meetings').select('*').eq('id', meetingId).single()
    if (!meeting) throw new Error('Meeting disappeared mid-transcription.')

    const updates: Record<string, unknown> = { transcript: text, transcription_status: 'complete' }
    // Auto-summary only when there's no summary yet — never overwrites the
    // authoritative minutes, and never clobbers a summary the user wrote.
    if (!meeting.summary || !String(meeting.summary).trim()) {
      try {
        const ex = await extractMeeting({
          rawText: text,
          title: meeting.title,
          meetingDate: meeting.meeting_date,
          userId: SYSTEM_USER_ID,
        })
        if (ex.summary) updates.summary = ex.summary
      } catch (e) {
        console.error('[meetings] auto-summary failed:', e)
      }
    }
    await supabase.from('meetings').update(updates as TablesUpdate<'meetings'>).eq('id', meetingId)

    const fresh = { ...meeting, ...updates } as unknown as MeetingRow
    await saveTranscriptDocument(supabase, fresh, text)
    await syncMeetingDocument(supabase, fresh)
  } catch (err) {
    console.error('[meetings] transcription failed:', err)
    await supabase.from('meetings').update({ transcription_status: 'error' }).eq('id', meetingId)
  }
}
