import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { embedDocument } from '@/lib/ai/embeddings'
import { callGemini, callGeminiWithFile } from '@/lib/ai/gemini'

type DocSummary = { summary?: string; confidence?: number } | string

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'

const DOC_SUMMARY_SYSTEM = `You are a document analyst for a construction executive intelligence platform.
Summarize the key points of this document in 2-3 sentences. Focus on: parties involved, key obligations or dates, dollar amounts, and critical terms relevant to construction executives.
Return ONLY valid JSON: {"summary": "...", "confidence": 0.0}
confidence is 0.0–1.0 reflecting how clearly this document presents extractable construction intelligence.
Return ONLY valid JSON. No explanation. No markdown.`

const TEXT_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
])

const PDF_MIME_TYPE = 'application/pdf'

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return Response.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  const project_id = formData.get('project_id') as string | null
  const entity_id = formData.get('entity_id') as string | null
  const site_id = formData.get('site_id') as string | null
  const doc_type = (formData.get('doc_type') as string) ?? 'other'
  const extract_ai = formData.get('extract_ai') === 'true'

  if (!file || (!project_id && !entity_id && !site_id)) {
    return Response.json({ error: 'file and one of project_id, entity_id, or site_id are required' }, { status: 400 })
  }

  // Build storage path
  const timestamp = Date.now()
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storagePath = site_id && !project_id && !entity_id
    ? `sites/${site_id}/${timestamp}_${safeName}`
    : entity_id && !project_id
    ? `entities/${entity_id}/${timestamp}_${safeName}`
    : `projects/${project_id}/${timestamp}_${safeName}`

  // Upload to storage using admin client — bypasses RLS entirely
  const fileBuffer = await file.arrayBuffer()
  const { error: storageError } = await supabase.storage
    .from('documents')
    .upload(storagePath, fileBuffer, {
      contentType: file.type || 'application/octet-stream',
      cacheControl: '3600',
      upsert: false,
    })

  if (storageError) {
    return Response.json({ error: storageError.message }, { status: 500 })
  }

  // Insert document record
  const { data: doc, error: insertError } = await supabase
    .from('documents')
    .insert({
      project_id: project_id || null,
      entity_id: entity_id || null,
      site_id: site_id || null,
      storage_path: storagePath,
      file_name: file.name,
      file_size_bytes: file.size,
      mime_type: file.type || null,
      doc_type,
      source: 'document',
    })
    .select()
    .single()

  if (insertError || !doc) {
    return Response.json({ error: insertError?.message ?? 'Insert failed' }, { status: 500 })
  }

  // Optionally run AI extraction
  if (extract_ai && (TEXT_MIME_TYPES.has(file.type) || file.type === PDF_MIME_TYPE)) {
    try {
      let parsed: DocSummary
      let fullTextContent: string | null = null

      if (file.type === PDF_MIME_TYPE) {
        const base64 = Buffer.from(fileBuffer).toString('base64')
        const result = await callGeminiWithFile<DocSummary>({
          systemPrompt: DOC_SUMMARY_SYSTEM,
          prompt: 'Summarize this document.',
          file: { mimeType: PDF_MIME_TYPE, dataBase64: base64 },
          userId: SYSTEM_USER_ID,
          logLabel: `Document summary: ${file.name}`,
          promptVersion: 'doc-summary-1.0',
          maxTokens: 512,
        })
        parsed = result.data
      } else {
        const text = new TextDecoder().decode(fileBuffer)
        fullTextContent = text
        const result = await callGemini<DocSummary>({
          task: 'doc-summary',
          systemPrompt: DOC_SUMMARY_SYSTEM,
          userMessage: text.slice(0, 30000),
          userId: SYSTEM_USER_ID,
          promptVersion: 'doc-summary-1.0',
          maxTokens: 512,
        })
        parsed = result.data
      }

      let embedText: string | null = null
      if (parsed && typeof parsed === 'object') {
        await supabase.from('documents').update({
          ai_summary: parsed.summary ?? null,
          confidence: parsed.confidence ?? null,
        }).eq('id', doc.id)
        doc.ai_summary = parsed.summary ?? null
        doc.confidence = parsed.confidence ?? null
        if (fullTextContent) embedText = fullTextContent
        else if (file.type === PDF_MIME_TYPE && parsed.summary) embedText = parsed.summary
      } else {
        const raw = String(parsed ?? '')
        await supabase.from('documents').update({ ai_summary: raw.slice(0, 1000) }).eq('id', doc.id)
        doc.ai_summary = raw.slice(0, 1000)
        if (fullTextContent) embedText = fullTextContent
      }

      if (embedText) embedDocument(doc.id, project_id, embedText, entity_id).catch(console.error)
    } catch {
      // AI extraction failed — document is still saved
    }
  }

  return Response.json({ document: doc })
}
