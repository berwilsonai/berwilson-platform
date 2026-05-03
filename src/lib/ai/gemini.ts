import { GoogleGenerativeAI } from '@google/generative-ai'
import { createAdminClient } from '@/lib/supabase/admin'

const GEMINI_MODEL = 'gemini-2.5-flash'

let _client: GoogleGenerativeAI | null = null

function getClient(): GoogleGenerativeAI {
  if (!_client) {
    _client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  }
  return _client
}

export interface GeminiCallOptions {
  task: string
  systemPrompt: string
  userMessage: string
  userId: string
  promptVersion?: string
  maxTokens?: number
  /** Set false for prose/synthesis tasks — default true for structured JSON tasks */
  jsonMode?: boolean
}

export interface GeminiCallResult<T = unknown> {
  data: T
  model: string
  tokensIn: number
  tokensOut: number
  latencyMs: number
}

/**
 * Strip markdown code fences that Gemini sometimes wraps around JSON output.
 */
function stripCodeFences(text: string): string {
  let cleaned = text.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  }
  return cleaned
}

export async function callGemini<T = unknown>(
  options: GeminiCallOptions
): Promise<GeminiCallResult<T>> {
  const {
    systemPrompt,
    userMessage,
    userId,
    promptVersion,
    jsonMode = true,
  } = options

  const client = getClient()
  const model = client.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: systemPrompt,
  })

  const start = Date.now()

  const response = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    generationConfig: jsonMode ? { responseMimeType: 'application/json' } : {},
  })

  const latencyMs = Date.now() - start
  const tokensIn = response.response.usageMetadata?.promptTokenCount ?? 0
  const tokensOut = response.response.usageMetadata?.candidatesTokenCount ?? 0

  const rawText = response.response.text()
  const cleanedText = stripCodeFences(rawText)

  let data: T
  try {
    data = JSON.parse(cleanedText) as T
  } catch {
    data = cleanedText as unknown as T
  }

  // Log to ai_queries — fire and forget
  const supabase = createAdminClient()
  supabase
    .from('ai_queries')
    .insert({
      user_id: userId,
      query_text: userMessage.slice(0, 2000),
      response_text: rawText.slice(0, 10000),
      model_used: GEMINI_MODEL,
      prompt_version: promptVersion ?? null,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      latency_ms: latencyMs,
    })
    .then(() => {})

  return { data, model: GEMINI_MODEL, tokensIn, tokensOut, latencyMs }
}
