import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { actorAdminClient } from '@/lib/auth/viewer'
import { createClient } from '@/lib/supabase/server'
import { GoogleGenerativeAI, type Part } from '@google/generative-ai'
import { GoogleAIFileManager } from '@google/generative-ai/server'
import { PROPOSAL_INTAKE_SYSTEM_PROMPT, PROPOSAL_INTAKE_PROMPT_VERSION } from '@/lib/ai/prompts/proposal-intake'
import { findMatchingProjects, matchExtractedParties, type ProposalExtraction } from '@/lib/ai/proposal-matching'
import { assessFit, type FitAssessment } from '@/lib/ai/fit-assessment'
import { writeFile, unlink } from 'fs/promises'
import { join } from 'path'

export const maxDuration = 300

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'
const GEMINI_MODEL = 'gemini-2.5-flash'
const PDF_MIME_TYPE = 'application/pdf'
// Gemini inline data limit — above this we use the File API
const INLINE_LIMIT_BYTES = 15 * 1024 * 1024

interface DirectFileInfo {
  storage_path: string
  file_name: string
  file_size_bytes: number
  mime_type: string
}

interface IntakeRequestBody {
  // Mode A: files already stored in Supabase (small files)
  files?: DirectFileInfo[]
  primary_file_index?: number
  // Mode B: chunked upload (large files)
  chunk_session?: string
  total_chunks?: number
  file_name?: string
  mime_type?: string
  file_size_bytes?: number
}

async function downloadFileFromSupabase(supabase: ReturnType<typeof createAdminClient>, path: string): Promise<Buffer> {
  const { data, error } = await supabase.storage.from('documents').download(path)
  if (error || !data) throw new Error(`Failed to download ${path}: ${error?.message}`)
  return Buffer.from(await data.arrayBuffer())
}

async function assembleChunks(
  supabase: ReturnType<typeof createAdminClient>,
  sessionId: string,
  totalChunks: number
): Promise<Buffer> {
  // Download all chunks in parallel — sequential downloads time out on large files
  const chunkPaths = Array.from({ length: totalChunks }, (_, i) =>
    `proposals/chunks/${sessionId}/chunk_${String(i).padStart(5, '0')}`
  )
  const buffers = await Promise.all(
    chunkPaths.map(path => downloadFileFromSupabase(supabase, path))
  )
  return Buffer.concat(buffers)
}

async function cleanupChunks(
  supabase: ReturnType<typeof createAdminClient>,
  sessionId: string,
  totalChunks: number
): Promise<void> {
  const paths = Array.from({ length: totalChunks }, (_, i) =>
    `proposals/chunks/${sessionId}/chunk_${String(i).padStart(5, '0')}`
  )
  await supabase.storage.from('documents').remove(paths)
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await actorAdminClient()

    // Get user if logged in
    let userId = SYSTEM_USER_ID
    try {
      const userSupabase = await createClient()
      const { data: { user } } = await userSupabase.auth.getUser()
      if (user?.id) userId = user.id
    } catch {
      // continue as system user
    }

    let body: IntakeRequestBody
    try {
      body = await request.json()
    } catch {
      return Response.json({ error: 'Invalid request body' }, { status: 400 })
    }

    // Determine mode and get primary file buffer + metadata
    let primaryBuffer: Buffer
    let primaryFileName: string
    let primaryMimeType: string
    let primaryFileSizeBytes: number
    let uploadedFiles: Array<{
      temp_path: string
      file_name: string
      file_size_bytes: number
      mime_type: string
      is_primary: boolean
    }>

    if (body.chunk_session && body.total_chunks && body.file_name) {
      // Mode B: large file assembled from chunks
      primaryBuffer = await assembleChunks(supabase, body.chunk_session, body.total_chunks)
      primaryFileName = body.file_name
      primaryMimeType = body.mime_type || 'application/octet-stream'
      primaryFileSizeBytes = body.file_size_bytes || primaryBuffer.byteLength

      // Store the assembled file in Supabase (best-effort — may fail for >50MB on free plan)
      const timestamp = Date.now()
      const safeName = primaryFileName.replace(/[^a-zA-Z0-9._-]/g, '_')
      const assembledPath = `proposals/pending/${timestamp}_${safeName}`
      const { error: storeError } = await supabase.storage
        .from('documents')
        .upload(assembledPath, primaryBuffer, { contentType: primaryMimeType, upsert: false })

      const storedPath = storeError ? null : assembledPath

      uploadedFiles = [{
        temp_path: storedPath || `proposals/chunks/${body.chunk_session}/assembled`,
        file_name: primaryFileName,
        file_size_bytes: primaryFileSizeBytes,
        mime_type: primaryMimeType,
        is_primary: true,
      }]

      // Clean up chunks (fire and forget)
      cleanupChunks(supabase, body.chunk_session, body.total_chunks).catch(() => {})

    } else if (body.files?.length) {
      // Mode A: files already in Supabase Storage
      const primaryIndex = body.primary_file_index ?? 0
      const primaryFileInfo = body.files[primaryIndex] || body.files[0]

      primaryBuffer = await downloadFileFromSupabase(supabase, primaryFileInfo.storage_path)
      primaryFileName = primaryFileInfo.file_name
      primaryMimeType = primaryFileInfo.mime_type
      primaryFileSizeBytes = primaryFileInfo.file_size_bytes

      uploadedFiles = body.files.map((f, i) => ({
        temp_path: f.storage_path,
        file_name: f.file_name,
        file_size_bytes: f.file_size_bytes,
        mime_type: f.mime_type,
        is_primary: i === primaryIndex,
      }))
    } else {
      return Response.json({ error: 'Provide either files[] or chunk_session + total_chunks' }, { status: 400 })
    }

    // Run AI extraction
    let extraction: ProposalExtraction
    try {
      const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
      const model = gemini.getGenerativeModel({
        model: GEMINI_MODEL,
        systemInstruction: PROPOSAL_INTAKE_SYSTEM_PROMPT,
      })
      const start = Date.now()

      const base64 = primaryBuffer.toString('base64')
      const mimeType = primaryMimeType

      let parts: Part[]

      if (primaryBuffer.byteLength > INLINE_LIMIT_BYTES && (mimeType === PDF_MIME_TYPE || mimeType.startsWith('image/'))) {
        // Large file: use Gemini File API to avoid inline data limits
        const tmpPath = join('/tmp', `${Date.now()}_${primaryFileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`)
        await writeFile(tmpPath, primaryBuffer)
        try {
          const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY!)
          const uploadResult = await fileManager.uploadFile(tmpPath, {
            mimeType,
            displayName: primaryFileName,
          })
          parts = [
            { fileData: { mimeType: uploadResult.file.mimeType, fileUri: uploadResult.file.uri } },
            { text: 'Analyze this document and extract all project and company information.' },
          ]
        } finally {
          unlink(tmpPath).catch(() => {})
        }
      } else if (mimeType === PDF_MIME_TYPE || mimeType.startsWith('image/')) {
        parts = [
          { inlineData: { mimeType, data: base64 } },
          { text: 'Analyze this document and extract all project and company information.' },
        ]
      } else {
        parts = [
          { text: `Analyze this document and extract all project and company information:\n\n${primaryBuffer.toString('utf-8').slice(0, 50000)}` },
        ]
      }

      const response = await model.generateContent({
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json' },
      })

      const latencyMs = Date.now() - start
      const rawText = response.response.text()

      supabase.from('ai_queries').insert({
        user_id: userId,
        query_text: `Proposal intake: ${primaryFileName}`,
        response_text: rawText.slice(0, 10000),
        model_used: GEMINI_MODEL,
        prompt_version: PROPOSAL_INTAKE_PROMPT_VERSION,
        tokens_in: response.response.usageMetadata?.promptTokenCount ?? 0,
        tokens_out: response.response.usageMetadata?.candidatesTokenCount ?? 0,
        latency_ms: latencyMs,
      }).then(() => {})

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

    // Find matching projects and parties (non-fatal)
    let matchCandidates: Awaited<ReturnType<typeof findMatchingProjects>> = []
    let partyMatches: Awaited<ReturnType<typeof matchExtractedParties>> = []
    try {
      if (extraction.projects?.length) matchCandidates = await findMatchingProjects(extraction.projects)
      if (extraction.parties?.length) partyMatches = await matchExtractedParties(extraction.parties)
    } catch {
      // non-fatal
    }

    // Score the opportunity against Ber Wilson's pursuit profile (non-fatal —
    // a missing/sparse profile just yields no assessment).
    let fitAssessment: FitAssessment | null = null
    try {
      fitAssessment = await assessFit(extraction, userId)
    } catch {
      // non-fatal
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fit_assessment: fitAssessment as any,
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
      fit_assessment: fitAssessment,
      uploaded_files: uploadedFiles,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ error: `Intake failed: ${message}` }, { status: 500 })
  }
}
