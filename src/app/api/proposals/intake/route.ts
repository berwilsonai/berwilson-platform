import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { PROPOSAL_INTAKE_SYSTEM_PROMPT, PROPOSAL_INTAKE_PROMPT_VERSION } from '@/lib/ai/prompts/proposal-intake'
import { findMatchingProjects, matchExtractedParties, type ProposalExtraction } from '@/lib/ai/proposal-matching'

export const maxDuration = 120

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'
const GEMINI_MODEL = 'gemini-2.5-flash'
const PDF_MIME_TYPE = 'application/pdf'

interface IntakeRequestBody {
  files: Array<{
    storage_path: string
    file_name: string
    file_size_bytes: number
    mime_type: string
  }>
  primary_file_index: number
}

export async function POST(request: NextRequest) {
  try {
  const supabase = createAdminClient()

  // Get user if logged in — not a hard gate
  let userId = SYSTEM_USER_ID
  try {
    const userSupabase = await createClient()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (user?.id) userId = user.id
  } catch {
    // continue as system user
  }

  // Accept JSON body with pre-uploaded file paths (client uploads directly to Supabase)
  let body: IntakeRequestBody
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { files, primary_file_index } = body

  if (!files?.length) {
    return Response.json({ error: 'At least one file is required' }, { status: 400 })
  }

  const primaryIndex = primary_file_index || 0
  const primaryFileInfo = files[primaryIndex] || files[0]

  // Build uploaded files metadata
  const uploadedFiles = files.map((f, i) => ({
    temp_path: f.storage_path,
    file_name: f.file_name,
    file_size_bytes: f.file_size_bytes,
    mime_type: f.mime_type,
    is_primary: i === primaryIndex,
  }))

  // Download primary file from Supabase Storage for AI processing
  const { data: fileData, error: downloadError } = await supabase.storage
    .from('documents')
    .download(primaryFileInfo.storage_path)

  if (downloadError || !fileData) {
    return Response.json({ error: `Failed to read uploaded file: ${downloadError?.message || 'File not found'}` }, { status: 500 })
  }

  // Run AI extraction on primary file using Gemini
  let extraction: ProposalExtraction
  try {
    const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
    const model = gemini.getGenerativeModel({
      model: GEMINI_MODEL,
      systemInstruction: PROPOSAL_INTAKE_SYSTEM_PROMPT,
    })
    const start = Date.now()

    const primaryBuffer = await fileData.arrayBuffer()
    const base64 = Buffer.from(primaryBuffer).toString('base64')
    const mimeType = primaryFileInfo.mime_type || 'application/octet-stream'

    // Gemini supports PDF and common text/image types as inline data
    const parts = mimeType === PDF_MIME_TYPE || mimeType.startsWith('image/')
      ? [
          { inlineData: { mimeType, data: base64 } },
          { text: 'Analyze this document and extract all project and company information.' },
        ]
      : [
          { text: `Analyze this document and extract all project and company information:\n\n${new TextDecoder().decode(primaryBuffer).slice(0, 50000)}` },
        ]

    const response = await model.generateContent({
      contents: [{ role: 'user', parts }],
      generationConfig: { responseMimeType: 'application/json' },
    })

    const latencyMs = Date.now() - start
    const rawText = response.response.text()

    supabase.from('ai_queries').insert({
      user_id: userId,
      query_text: `Proposal intake: ${primaryFileInfo.file_name}`,
      response_text: rawText.slice(0, 10000),
      model_used: GEMINI_MODEL,
      prompt_version: PROPOSAL_INTAKE_PROMPT_VERSION,
      tokens_in: response.response.usageMetadata?.promptTokenCount ?? 0,
      tokens_out: response.response.usageMetadata?.candidatesTokenCount ?? 0,
      latency_ms: latencyMs,
    }).then(() => {})

    // Strip markdown fences if present
    const cleanedText = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    try {
      extraction = JSON.parse(cleanedText) as ProposalExtraction
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

  // Find matching projects for each extracted project (non-fatal)
  let matchCandidates: Awaited<ReturnType<typeof findMatchingProjects>> = []
  let partyMatches: Awaited<ReturnType<typeof matchExtractedParties>> = []
  try {
    if (extraction.projects?.length) {
      matchCandidates = await findMatchingProjects(extraction.projects)
    }
    if (extraction.parties?.length) {
      partyMatches = await matchExtractedParties(extraction.parties)
    }
  } catch {
    // matching failures are non-fatal — continue without match candidates
  }

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
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ error: `Intake failed: ${message}` }, { status: 500 })
  }
}
