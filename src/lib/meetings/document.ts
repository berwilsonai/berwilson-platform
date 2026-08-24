// Keeps a meeting's generated minutes document in sync with the record, and
// (when index_ai is on) embeds it for Ber AI. The document is a self-contained
// markdown copy of the record — it doubles as the downloadable/preserved
// compliance export and as the vehicle for RAG chunks (a chunk's document_id
// satisfies chunks_source_check on its own, so no chunks-table migration is
// needed). It's tagged with meeting_id so it lives in the meeting; it is NOT
// is_company, so board minutes stay OUT of the general company Knowledge Base
// browse list. Delete-and-replace snapshot, mirroring embedInvestorSnapshot.

import type { createAdminClient } from '@/lib/supabase/admin'
import { storeExtractedText } from '@/lib/ai/document-text'
import { embedDocument } from '@/lib/ai/embeddings'
import { composeMeetingDocument, isBoard, type MeetingDocInput } from '@/lib/utils/meetings'

type AdminClient = ReturnType<typeof createAdminClient>

export interface MeetingRecord extends MeetingDocInput {
  id: string
  scope: string
  project_id: string | null
  index_ai: boolean
  minutes_document_id: string | null
}

/** Remove a meeting's generated minutes document (row cascades its chunks, then
 *  its storage object). Safe to call with a null id. */
export async function removeMeetingDocument(
  supabase: AdminClient,
  documentId: string | null,
): Promise<void> {
  if (!documentId) return
  const { data: old } = await supabase
    .from('documents')
    .select('storage_path')
    .eq('id', documentId)
    .maybeSingle()
  await supabase.from('documents').delete().eq('id', documentId)
  if (old?.storage_path) {
    await supabase.storage.from('documents').remove([old.storage_path])
  }
}

/**
 * Regenerate the meeting's minutes document from the current record and refresh
 * its embedding. Non-fatal — logs and returns on any failure so a save still
 * succeeds. Call after create and after a content/index change.
 */
export async function syncMeetingDocument(supabase: AdminClient, meeting: MeetingRecord): Promise<void> {
  try {
    // Replace the previous generated copy (chunks cascade on row delete).
    await removeMeetingDocument(supabase, meeting.minutes_document_id)

    const content = composeMeetingDocument(meeting)
    const board = isBoard(meeting.scope)
    const projectId = board ? null : meeting.project_id
    const path = `meetings/${meeting.id}/${Date.now()}_meeting_minutes.md`

    const { error: uploadErr } = await supabase.storage
      .from('documents')
      .upload(path, Buffer.from(content, 'utf-8'), { contentType: 'text/markdown', upsert: false })
    if (uploadErr) {
      console.error('[meetings] minutes upload failed:', uploadErr.message)
      return
    }

    const { data: doc, error: insertErr } = await supabase
      .from('documents')
      .insert({
        // meeting-scoped only (project_id null) so it doesn't leak into the
        // project's Documents tab; the RAG chunk is still project-scoped via
        // embedDocument(projectId) below.
        meeting_id: meeting.id,
        project_id: null,
        storage_path: path,
        file_name: `Meeting — ${meeting.title}.md`,
        file_size_bytes: Buffer.byteLength(content, 'utf-8'),
        mime_type: 'text/markdown',
        doc_type: 'other',
        source: 'document' as const,
        ai_summary: meeting.summary ?? null,
      })
      .select('id')
      .single()
    if (insertErr || !doc) {
      console.error('[meetings] minutes insert failed:', insertErr?.message)
      return
    }

    await storeExtractedText(supabase, 'documents', doc.id, content)
    await supabase.from('meetings').update({ minutes_document_id: doc.id }).eq('id', meeting.id)

    if (meeting.index_ai) {
      // board → is_company chunk (company knowledge); project → project-scoped chunk.
      await embedDocument(doc.id, projectId, content, null, board)
    } else {
      await supabase.from('documents').update({ embedding_status: 'skipped' }).eq('id', doc.id)
    }
  } catch (err) {
    console.error('[meetings] syncMeetingDocument failed:', err)
  }
}
