import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages'
import { PROPOSAL_INTAKE_SYSTEM_PROMPT, PROPOSAL_INTAKE_PROMPT_VERSION } from '@/lib/ai/prompts/proposal-intake'
import { findMatchingProjects, matchExtractedParties, type ProposalExtraction } from '@/lib/ai/proposal-matching'

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'
const PDF_MIME_TYPE = 'application/pdf'
const TEXT_MIME_TYPES = new Set(['text/plain', 'text/markdown', 'text/csv', 'text/html'])

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()

  // Get user if logged in — not a hard gate (matches upload route pattern)
  let userId = SYSTEM_USER_ID
  try {
    const userSupabase = await createClient()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (user?.id) userId = user.id
  } catch {
    // continue as system user
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return Response.json({ error: 'Invalid form data' }, { status: 400 })
  }

  // Collect files
  const files: File[] = []
  for (const entry of formData.getAll('files')) {
    if (entry instanceof File) files.push(entry)
  }
  const singleFile = formData.get('file')
  if (singleFile instanceof File && !files.length) files.push(singleFile)

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
    // Use Sonnet for complex multi-project portfolios — better at extracting many items accurately
    const model = 'claude-sonnet-4-6-20250514'
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
        { type: 'text', text: 'Analyze this document and extract all project and company information.' },
      ]
    } else {
      const text = new TextDecoder().decode(primaryBuffer)
      content = [
        { type: 'text', text: `Analyze this document and extract all project and company information:\n\n${text.slice(0, 50000)}` },
      ]
    }

    const response = await client.messages.create({
      model,
      max_tokens: 8192,
      system: PROPOSAL_INTAKE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
    })

    const latencyMs = Date.now() - start
    const textBlock = response.content.find((b) => b.type === 'text')
    const rawText = textBlock && 'text' in textBlock ? textBlock.text : ''

    supabase.from('ai_queries').insert({
      user_id: userId,
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
        error: 'AI extraction returned invalid JSON. The document may be unreadable or contain only images.',
        raw_response: rawText.slice(0, 500),
      }, { status: 422 })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ error: `AI extraction failed: ${message}` }, { status: 500 })
  }

  // Find matching projects for each extracted project
  const matchCandidates = extraction.projects?.length
    ? await findMatchingProjects(extraction.projects)
    : []

  // Match extracted parties to existing contacts
  const partyMatches = extraction.parties?.length
    ? await matchExtractedParties(extraction.parties)
    : []

  // Create intake session
  const { data: session, error: sessionError } = await supabase
    .from('proposal_intake_sessions')
    .insert({
      user_id: userId,
      status: 'pending',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      extraction_result: extraction as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      match_candidates: matchCandidates as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
