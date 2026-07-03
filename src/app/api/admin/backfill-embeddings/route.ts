import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { transcribePdfText, storeExtractedText } from '@/lib/ai/document-text'
import {
  embedDocument,
  embedOpportunityDocument,
  embedOpportunitySnapshot,
  embedOpportunityNote,
} from '@/lib/ai/embeddings'

/**
 * One-time backfill for universal RAG coverage (run from the /intel page).
 * Each POST processes one small batch and reports how many items remain —
 * the client loops until remaining is 0. Requires migration 20260703000001;
 * returns 409 with a clear message before it's applied.
 */
export const maxDuration = 300

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'
const PDF_MIME_TYPE = 'application/pdf'
const TEXT_MIME_TYPES = new Set(['text/plain', 'text/markdown', 'text/csv', 'text/html'])

type Target = 'project_documents' | 'opportunity_documents' | 'opportunities' | 'opportunity_notes'

const MIGRATION_409 = 'Apply migration 20260703000001_universal_rag.sql first (then npm run gen-types).'

function isMissingColumn(message: string, column: string): boolean {
  return new RegExp(column, 'i').test(message)
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const target = body.target as Target
  if (!['project_documents', 'opportunity_documents', 'opportunities', 'opportunity_notes'].includes(target)) {
    return Response.json({ error: 'target must be one of project_documents | opportunity_documents | opportunities | opportunity_notes' }, { status: 400 })
  }

  const admin = createAdminClient()
  const errors: string[] = []

  // ── project_documents: PDFs never full-text extracted ───────────────────────
  if (target === 'project_documents') {
    const limit = Math.min(Number(body.limit) || 3, 5)
    const { data: docs, error, count } = await admin
      .from('documents')
      .select('id, project_id, entity_id, is_company, storage_path, file_name, file_size_bytes', { count: 'exact' })
      .eq('mime_type', PDF_MIME_TYPE)
      .is('extracted_text', null)
      .order('uploaded_at', { ascending: true })
      .limit(limit)

    if (error) {
      if (isMissingColumn(error.message, 'extracted_text')) {
        return Response.json({ error: MIGRATION_409 }, { status: 409 })
      }
      return Response.json({ error: error.message }, { status: 500 })
    }

    let processed = 0
    for (const doc of docs ?? []) {
      try {
        const { data: blob, error: dlErr } = await admin.storage.from('documents').download(doc.storage_path)
        if (dlErr || !blob) throw new Error(dlErr?.message ?? 'download failed')
        const buffer = await blob.arrayBuffer()
        const text = await transcribePdfText({
          dataBase64: Buffer.from(buffer).toString('base64'),
          byteLength: buffer.byteLength,
          fileName: doc.file_name,
          userId: SYSTEM_USER_ID,
        })
        if (!text) {
          // Too large or unreadable — mark with empty string so it isn't retried forever
          await admin.from('documents').update({ extracted_text: '' }).eq('id', doc.id)
          errors.push(`${doc.file_name}: no text extracted (oversize or unreadable) — kept summary-only`)
          continue
        }
        await storeExtractedText(admin, 'documents', doc.id, text)
        // Replace summary-only chunks with full-text chunks
        await admin.from('chunks').delete().eq('document_id', doc.id)
        await embedDocument(doc.id, doc.project_id, text, doc.entity_id, doc.is_company === true)
        processed++
      } catch (err) {
        errors.push(`${doc.file_name}: ${err instanceof Error ? err.message : 'failed'}`)
      }
    }

    const remaining = Math.max(0, (count ?? 0) - processed)
    return Response.json({ processed, remaining, errors })
  }

  // ── opportunity_documents: PDFs + text files never extracted/embedded ───────
  if (target === 'opportunity_documents') {
    const limit = Math.min(Number(body.limit) || 3, 5)
    const { data: docs, error, count } = await admin
      .from('opportunity_documents')
      .select('id, opportunity_id, storage_path, file_name, mime_type, ai_summary', { count: 'exact' })
      .is('extracted_text', null)
      .order('uploaded_at', { ascending: true })
      .limit(limit)

    if (error) {
      if (isMissingColumn(error.message, 'extracted_text')) {
        return Response.json({ error: MIGRATION_409 }, { status: 409 })
      }
      return Response.json({ error: error.message }, { status: 500 })
    }

    let processed = 0
    for (const doc of docs ?? []) {
      try {
        let text: string | null = null
        if (doc.mime_type === PDF_MIME_TYPE || TEXT_MIME_TYPES.has(doc.mime_type ?? '')) {
          const { data: blob, error: dlErr } = await admin.storage.from('documents').download(doc.storage_path)
          if (dlErr || !blob) throw new Error(dlErr?.message ?? 'download failed')
          if (doc.mime_type === PDF_MIME_TYPE) {
            const buffer = await blob.arrayBuffer()
            text = await transcribePdfText({
              dataBase64: Buffer.from(buffer).toString('base64'),
              byteLength: buffer.byteLength,
              fileName: doc.file_name,
              userId: SYSTEM_USER_ID,
            })
          } else {
            text = await blob.text()
          }
        }
        // Mark as visited even when no text (unsupported type/oversize) so the
        // batch always shrinks; embed whatever content we have.
        await admin.from('opportunity_documents').update({ extracted_text: text ?? '' }).eq('id', doc.id)
        const embedText = text ?? doc.ai_summary
        if (embedText) {
          await embedOpportunityDocument(doc.id, doc.opportunity_id, embedText)
        }
        processed++
      } catch (err) {
        errors.push(`${doc.file_name}: ${err instanceof Error ? err.message : 'failed'}`)
      }
    }

    const remaining = Math.max(0, (count ?? 0) - processed)
    return Response.json({ processed, remaining, errors })
  }

  // ── opportunities: snapshot chunks for every opportunity missing one ────────
  if (target === 'opportunities') {
    const limit = Math.min(Number(body.limit) || 20, 50)
    const { data: opps, error } = await admin.from('opportunities').select('id')
    if (error) return Response.json({ error: error.message }, { status: 500 })

    const { data: snapChunks, error: chunkErr } = await admin
      .from('chunks')
      .select('opportunity_id')
      .eq('source_type', 'opportunity')
      .not('opportunity_id', 'is', null)
    if (chunkErr) {
      if (isMissingColumn(chunkErr.message, 'opportunity_id') || isMissingColumn(chunkErr.message, 'source_type')) {
        return Response.json({ error: MIGRATION_409 }, { status: 409 })
      }
      return Response.json({ error: chunkErr.message }, { status: 500 })
    }

    const covered = new Set((snapChunks ?? []).map((c) => c.opportunity_id))
    const pending = (opps ?? []).filter((o) => !covered.has(o.id))
    const batch = pending.slice(0, limit)

    let processed = 0
    for (const opp of batch) {
      try {
        await embedOpportunitySnapshot(opp.id)
        processed++
      } catch (err) {
        errors.push(`${opp.id}: ${err instanceof Error ? err.message : 'failed'}`)
      }
    }

    return Response.json({ processed, remaining: Math.max(0, pending.length - processed), errors })
  }

  // ── opportunity_notes: embed notes for opportunities with no note chunks ────
  const limit = Math.min(Number(body.limit) || 20, 50)
  const { data: noteChunks, error: chunkErr } = await admin
    .from('chunks')
    .select('opportunity_id')
    .eq('source_type', 'opportunity_note')
    .not('opportunity_id', 'is', null)
  if (chunkErr) {
    if (isMissingColumn(chunkErr.message, 'opportunity_id') || isMissingColumn(chunkErr.message, 'source_type')) {
      return Response.json({ error: MIGRATION_409 }, { status: 409 })
    }
    return Response.json({ error: chunkErr.message }, { status: 500 })
  }
  const covered = new Set((noteChunks ?? []).map((c) => c.opportunity_id))

  const { data: notes, error: notesErr } = await admin
    .from('opportunity_notes')
    .select('opportunity_id, body, author, created_at')
    .order('created_at', { ascending: true })
  if (notesErr) return Response.json({ error: notesErr.message }, { status: 500 })

  // Group by opportunity and embed ALL of an opportunity's notes together —
  // otherwise the coverage check would skip its remaining notes next batch.
  const notesByOpp = new Map<string, typeof notes>()
  for (const n of notes ?? []) {
    if (covered.has(n.opportunity_id)) continue
    const list = notesByOpp.get(n.opportunity_id) ?? []
    list.push(n)
    notesByOpp.set(n.opportunity_id, list)
  }

  let processed = 0
  let remainingNotes = 0
  let budget = limit
  for (const [oppId, oppNotes] of notesByOpp) {
    if (budget <= 0) {
      remainingNotes += oppNotes.length
      continue
    }
    for (const note of oppNotes) {
      try {
        await embedOpportunityNote(oppId, note.body, note.author)
        processed++
      } catch (err) {
        errors.push(`note on ${oppId}: ${err instanceof Error ? err.message : 'failed'}`)
      }
    }
    budget -= oppNotes.length
  }

  return Response.json({ processed, remaining: remainingNotes, errors })
}
