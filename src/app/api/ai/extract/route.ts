import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { callGemini } from '@/lib/ai/gemini'
import {
  EXTRACTION_SYSTEM_PROMPT,
  EXTRACTION_PROMPT_VERSION,
} from '@/lib/ai/prompts/extraction'
import type { ExtractionResult } from '@/types/domain'

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'

export async function POST(request: NextRequest) {
  // Try to get the authenticated user for logging; fall back to system user ID
  // Middleware already guards this route — if we're here, the request is allowed.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const userId = user?.id ?? SYSTEM_USER_ID

  const body = await request.json()
  const rawText: string | undefined = body.raw_text

  if (!rawText || rawText.trim().length === 0) {
    return Response.json(
      { error: 'raw_text is required' },
      { status: 400 }
    )
  }

  if (rawText.length > 50_000) {
    return Response.json(
      { error: 'Text exceeds 50,000 character limit' },
      { status: 400 }
    )
  }

  try {
    const result = await callGemini<ExtractionResult>({
      task: 'extract',
      systemPrompt: EXTRACTION_SYSTEM_PROMPT,
      userMessage: rawText,
      userId,
      promptVersion: EXTRACTION_PROMPT_VERSION,
      maxTokens: 4096,
    })

    return Response.json({
      extraction: result.data,
      model: result.model,
      tokens_in: result.tokensIn,
      tokens_out: result.tokensOut,
      latency_ms: result.latencyMs,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Extraction failed:', err)
    return Response.json(
      { error: 'AI extraction failed. Please try again.', detail: message },
      { status: 500 }
    )
  }
}
