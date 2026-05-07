import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { embedDocument } from '@/lib/ai/embeddings'
import Anthropic from '@anthropic-ai/sdk'

const PDF_MIME = 'application/pdf'
const ALLOWED_TYPES = new Set([PDF_MIME, 'image/jpeg', 'image/png', 'image/webp'])
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'

const CERT_SUMMARY_SYSTEM = `You are analyzing a certification or license document for a construction company.
Extract the key details: certification name, issuing authority, certificate number, issue date, expiration date, and scope of certification.
Return ONLY valid JSON: {"summary": "...", "confidence": 0.0}
confidence is 0.0–1.0. Return ONLY valid JSON. No markdown.`

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return Response.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  const cert_id = formData.get('cert_id') as string | null

  if (!file || !cert_id) {
    return Response.json({ error: 'file and cert_id are required' }, { status: 400 })
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return Response.json({ error: 'Only PDF, JPEG, PNG, or WebP files are allowed' }, { status: 400 })
  }

  // Verify cert exists
  const { data: cert } = await supabase
    .from('certifications')
    .select('id, name, document_id')
    .eq('id', cert_id)
    .single()

  if (!cert) {
    return Response.json({ error: 'Certification not found' }, { status: 404 })
  }

  // Remove old document if one exists
  if (cert.document_id) {
    const { data: oldDoc } = await supabase
      .from('documents')
      .select('storage_path')
      .eq('id', cert.document_id)
      .single()
    if (oldDoc) {
      await supabase.storage.from('documents').remove([oldDoc.storage_path])
      await supabase.from('documents').delete().eq('id', cert.document_id)
    }
  }

  // Upload to documents bucket
  const timestamp = Date.now()
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storagePath = `company/certifications/${cert_id}/${timestamp}_${safeName}`

  const fileBuffer = await file.arrayBuffer()
  const { error: storageError } = await supabase.storage
    .from('documents')
    .upload(storagePath, fileBuffer, {
      contentType: file.type,
      cacheControl: '3600',
      upsert: false,
    })

  if (storageError) {
    return Response.json({ error: storageError.message }, { status: 500 })
  }

  // Insert document record (no project_id or entity_id — company-level)
  const { data: doc, error: insertError } = await supabase
    .from('documents')
    .insert({
      storage_path: storagePath,
      file_name: file.name,
      file_size_bytes: file.size,
      mime_type: file.type,
      doc_type: 'certification',
      source: 'document',
    })
    .select()
    .single()

  if (insertError || !doc) {
    await supabase.storage.from('documents').remove([storagePath])
    return Response.json({ error: insertError?.message ?? 'Insert failed' }, { status: 500 })
  }

  // Link cert to document
  await supabase
    .from('certifications')
    .update({ document_id: doc.id })
    .eq('id', cert_id)

  // AI extraction for PDFs
  if (file.type === PDF_MIME) {
    try {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
      const model = 'claude-haiku-4-5-20251001'
      const base64 = Buffer.from(fileBuffer).toString('base64')
      const start = Date.now()

      const response = await client.messages.create({
        model,
        max_tokens: 512,
        system: CERT_SUMMARY_SYSTEM,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 }, title: file.name },
            { type: 'text', text: 'Extract the certification details.' },
          ],
        }],
      })

      const block = response.content.find(b => b.type === 'text')
      const rawText = block && 'text' in block ? block.text : ''
      const latencyMs = Date.now() - start

      supabase.from('ai_queries').insert({
        user_id: SYSTEM_USER_ID,
        query_text: `Cert scan: ${file.name}`,
        response_text: rawText.slice(0, 10000),
        model_used: model,
        prompt_version: 'cert-scan-1.0',
        tokens_in: response.usage.input_tokens,
        tokens_out: response.usage.output_tokens,
        latency_ms: latencyMs,
      }).then(() => {})

      try {
        const parsed = JSON.parse(rawText) as { summary: string; confidence: number }
        await supabase.from('documents').update({
          ai_summary: parsed.summary ?? null,
          confidence: parsed.confidence ?? null,
        }).eq('id', doc.id)
        doc.ai_summary = parsed.summary ?? null

        // Embed for AI search
        embedDocument(doc.id, null, parsed.summary).catch(console.error)
      } catch {
        await supabase.from('documents').update({ ai_summary: rawText.slice(0, 1000) }).eq('id', doc.id)
      }
    } catch {
      // AI extraction failed — document is still saved
    }
  }

  return Response.json({ document: doc })
}
