import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { embedDocument } from '@/lib/ai/embeddings'
import Anthropic from '@anthropic-ai/sdk'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages'

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
  const doc_type = (formData.get('doc_type') as string) ?? 'other'
  const extract_ai = formData.get('extract_ai') === 'true'

  if (!file || !project_id) {
    return Response.json({ error: 'file and project_id are required' }, { status: 400 })
  }

  // Build storage path
  const timestamp = Date.now()
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storagePath = `projects/${project_id}/${timestamp}_${safeName}`

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
      project_id,
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
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
      const model = 'claude-haiku-4-5-20251001'
      let rawText = ''
      let fullTextContent: string | null = null
      const start = Date.now()

      if (file.type === PDF_MIME_TYPE) {
        const base64 = Buffer.from(fileBuffer).toString('base64')
        const pdfContent: ContentBlockParam[] = [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64 },
            title: file.name,
          },
          { type: 'text', text: 'Summarize this document.' },
        ]
        const response = await client.messages.create({
          model,
          max_tokens: 512,
          system: DOC_SUMMARY_SYSTEM,
          messages: [{ role: 'user', content: pdfContent }],
        })
        const block = response.content.find((b) => b.type === 'text')
        rawText = block && 'text' in block ? block.text : ''
        const latencyMs = Date.now() - start
        supabase.from('ai_queries').insert({
          user_id: SYSTEM_USER_ID,
          query_text: `Document summary: ${file.name}`,
          response_text: rawText.slice(0, 10000),
          model_used: model,
          prompt_version: 'doc-summary-1.0',
          tokens_in: response.usage.input_tokens,
          tokens_out: response.usage.output_tokens,
          latency_ms: latencyMs,
        }).then(() => {})
      } else {
        const text = new TextDecoder().decode(fileBuffer)
        fullTextContent = text
        const response = await client.messages.create({
          model,
          max_tokens: 512,
          system: DOC_SUMMARY_SYSTEM,
          messages: [{ role: 'user', content: text.slice(0, 30000) }],
        })
        const block = response.content.find((b) => b.type === 'text')
        rawText = block && 'text' in block ? block.text : ''
        const latencyMs = Date.now() - start
        supabase.from('ai_queries').insert({
          user_id: SYSTEM_USER_ID,
          query_text: `Document summary: ${file.name}`,
          response_text: rawText.slice(0, 10000),
          model_used: model,
          prompt_version: 'doc-summary-1.0',
          tokens_in: response.usage.input_tokens,
          tokens_out: response.usage.output_tokens,
          latency_ms: latencyMs,
        }).then(() => {})
      }

      let embedText: string | null = null
      try {
        const parsed = JSON.parse(rawText) as { summary: string; confidence: number }
        await supabase.from('documents').update({
          ai_summary: parsed.summary ?? null,
          confidence: parsed.confidence ?? null,
        }).eq('id', doc.id)
        doc.ai_summary = parsed.summary ?? null
        doc.confidence = parsed.confidence ?? null
        if (fullTextContent) embedText = fullTextContent
        else if (file.type === PDF_MIME_TYPE && parsed.summary) embedText = parsed.summary
      } catch {
        await supabase.from('documents').update({ ai_summary: rawText.slice(0, 1000) }).eq('id', doc.id)
        doc.ai_summary = rawText.slice(0, 1000)
        if (fullTextContent) embedText = fullTextContent
      }

      if (embedText) embedDocument(doc.id, project_id, embedText).catch(console.error)
    } catch {
      // AI extraction failed — document is still saved
    }
  }

  return Response.json({ document: doc })
}
