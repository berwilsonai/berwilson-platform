import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages'
import { PROPOSAL_INTAKE_SYSTEM_PROMPT, PROPOSAL_INTAKE_PROMPT_VERSION } from '@/lib/ai/prompts/proposal-intake'
import { findMatchingProjects, matchExtractedParties, type ProposalExtraction } from '@/lib/ai/proposal-matching'

const PDF_MIME_TYPE = 'application/pdf'
const TEXT_MIME_TYPES = new Set(['text/plain', 'text/markdown', 'text/csv', 'text/html'])

export async function POST(request: NextRequest) {
  // Auth check
  const userSupabase = await createClient()
  const { data: { user } } = await userSupabase.auth.getUser()
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return Response.json({ error: 'Invalid form data' }, { status: 400 })
  }

  // Collect files
  const files: File[] = []
  const entries = formData.getAll('files')
  for (const entry of entries) {
    if (entry instanceof File) files.push(entry)
  }
  // Also support single 'file' field
  const singleFile = formData.get('file')
  if (singleFile instanceof File && !files.length) {
    files.push(singleFile)
  }

  if (!files.length) {
    return Response.json({ error: 'At least one file is required' }, { status: 400 })
  }

  const primaryIndex = parseInt(formData.get('primary_file_index') as string || '0', 10)
  const primaryFile = files[primaryIndex] || files[0]

  // Upload all files to temp storage
  const uploadedFiles: Array<{
    temp_path: string
    file_name: string
    file_size_bytes: number
    mime_type: string
    is_primary: boolean
  }> = []

  for (const file of files) {
    const timestamp = Date.now()
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const tempPath = `proposals/pending/${timestamp}_${safeName}`

    const fileBuffer = await file.arrayBuffer()
    const { error: storageError } = await supabase.storage
      .from('documents')
      .upload(tempPath, fileBuffer, {
        contentType: file.type || 'application/octet-stream',
        cacheControl: '3600',
        upsert: false,
      })

    if (storageError) {
      return Response.json({ error: `Failed to upload ${file.name}: ${storageError.message}` }, { status: 500 })
    }

    uploadedFiles.push({
      temp_path: tempPath,
      file_name: file.name,
      file_size_bytes: file.size,
      mime_type: file.type || 'application/octet-stream',
      is_primary: file === primaryFile,
    })
  }

  // Run AI extraction on primary file
  let extraction: ProposalExtraction
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
    const model = 'claude-haiku-4-5-20251001'
    const start = Date.now()

    const primaryBuffer = await primaryFile.arrayBuffer()
    let content: ContentBlockParam[]

    if (primaryFile.type === PDF_MIME_TYPE) {
      const base64 = Buffer.from(primaryBuffer).toString('base64')
      content = [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: base64 },
          title: primaryFile.name,
        },
        { type: 'text', text: 'Extract all project metadata from this proposal document.' },
      ]
    } else if (TEXT_MIME_TYPES.has(primaryFile.type)) {
      const text = new TextDecoder().decode(primaryBuffer)
      content = [
        { type: 'text', text: `Extract all project metadata from this proposal document:\n\n${text.slice(0, 50000)}` },
      ]
    } else {
      // Attempt text extraction for other types
      const text = new TextDecoder().decode(primaryBuffer)
      content = [
        { type: 'text', text: `Extract all project metadata from this proposal document:\n\n${text.slice(0, 50000)}` },
      ]
    }

    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: PROPOSAL_INTAKE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
    })

    const latencyMs = Date.now() - start
    const textBlock = response.content.find((b) => b.type === 'text')
    const rawText = textBlock && 'text' in textBlock ? textBlock.text : ''

    // Log AI call
    supabase.from('ai_queries').insert({
      user_id: user.id,
      query_text: `Proposal intake: ${primaryFile.name}`,
      response_text: rawText.slice(0, 10000),
      model_used: model,
      prompt_version: PROPOSAL_INTAKE_PROMPT_VERSION,
      tokens_in: response.usage.input_tokens,
      tokens_out: response.usage.output_tokens,
      latency_ms: latencyMs,
    }).then(() => {})

    try {
      extraction = JSON.parse(rawText) as ProposalExtraction
    } catch {
      return Response.json({
        error: 'AI extraction returned invalid JSON. The document may not be a recognizable proposal.',
        raw_response: rawText.slice(0, 500),
      }, { status: 422 })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ error: `AI extraction failed: ${message}` }, { status: 500 })
  }

  // Find matching projects
  const matchCandidates = await findMatchingProjects(extraction)

  // Match extracted parties to existing contacts
  const partyMatches = extraction.parties?.length
    ? await matchExtractedParties(extraction.parties)
    : []

  // Create intake session
  const { data: session, error: sessionError } = await supabase
    .from('proposal_intake_sessions')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .insert({
      user_id: user.id,
      status: 'pending',
      extraction_result: extraction as any,
      match_candidates: matchCandidates as any,
      uploaded_files: uploadedFiles as any,
    })
    .select()
    .single()

  if (sessionError || !session) {
    return Response.json({ error: 'Failed to create intake session' }, { status: 500 })
  }

  return Response.json({
    session_id: session.id,
    extraction,
    match_candidates: matchCandidates,
    party_matches: partyMatches,
    uploaded_files: uploadedFiles,
  })
}
