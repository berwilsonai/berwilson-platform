import { GoogleGenerativeAI } from '@google/generative-ai'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  isLocalAI,
  localChat,
  localChatModel,
  extractPdfText,
  type LocalChatMessage,
} from './local'

const GEMINI_MODEL = 'gemini-2.5-flash'

const JSON_MODE_SUFFIX =
  '\n\nRespond with valid JSON only — no prose before or after, no markdown code fences.'

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
 * Strip markdown code fences that models sometimes wrap around JSON output.
 */
function stripCodeFences(text: string): string {
  let cleaned = text.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  }
  return cleaned
}

function parseMaybeJson<T>(rawText: string): T {
  const cleaned = stripCodeFences(rawText)
  try {
    return JSON.parse(cleaned) as T
  } catch {
    return cleaned as unknown as T
  }
}

/** Log an AI call to ai_queries — fire and forget. */
function logAiQuery(input: {
  userId: string
  queryText: string
  responseText: string
  model: string
  promptVersion?: string
  tokensIn: number
  tokensOut: number
  latencyMs: number
}): void {
  const supabase = createAdminClient()
  supabase
    .from('ai_queries')
    .insert({
      user_id: input.userId,
      query_text: input.queryText.slice(0, 2000),
      response_text: input.responseText.slice(0, 10000),
      model_used: input.model,
      prompt_version: input.promptVersion ?? null,
      tokens_in: input.tokensIn,
      tokens_out: input.tokensOut,
      latency_ms: input.latencyMs,
    })
    .then(() => {})
}

/**
 * Local-provider path for callGemini/callGeminiWithFile: one text call to the
 * LM Studio OpenAI-compatible endpoint, same result shape + ai_queries logging.
 */
async function callLocalText<T>(input: {
  systemPrompt: string
  userMessage: string
  userId: string
  logLabel?: string
  promptVersion?: string
  maxTokens?: number
  jsonMode: boolean
}): Promise<GeminiCallResult<T>> {
  const model = localChatModel()
  const messages: LocalChatMessage[] = [
    {
      role: 'system',
      content: input.jsonMode ? input.systemPrompt + JSON_MODE_SUFFIX : input.systemPrompt,
    },
    { role: 'user', content: input.userMessage },
  ]

  const start = Date.now()
  const result = await localChat({ messages, maxTokens: input.maxTokens })
  const latencyMs = Date.now() - start

  logAiQuery({
    userId: input.userId,
    queryText: input.logLabel ?? input.userMessage,
    responseText: result.text,
    model,
    promptVersion: input.promptVersion,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    latencyMs,
  })

  return {
    data: input.jsonMode ? parseMaybeJson<T>(result.text) : (result.text as unknown as T),
    model,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    latencyMs,
  }
}

export async function callGemini<T = unknown>(
  options: GeminiCallOptions
): Promise<GeminiCallResult<T>> {
  const {
    systemPrompt,
    userMessage,
    userId,
    promptVersion,
    maxTokens,
    jsonMode = true,
  } = options

  if (isLocalAI()) {
    return callLocalText<T>({ systemPrompt, userMessage, userId, promptVersion, maxTokens, jsonMode })
  }

  const client = getClient()
  const model = client.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: systemPrompt,
  })

  const start = Date.now()

  const response = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    generationConfig: {
      ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
      ...(maxTokens ? { maxOutputTokens: maxTokens } : {}),
    },
  })

  const latencyMs = Date.now() - start
  const tokensIn = response.response.usageMetadata?.promptTokenCount ?? 0
  const tokensOut = response.response.usageMetadata?.candidatesTokenCount ?? 0

  const rawText = response.response.text()
  const data = parseMaybeJson<T>(rawText)

  logAiQuery({
    userId,
    queryText: userMessage,
    responseText: rawText,
    model: GEMINI_MODEL,
    promptVersion,
    tokensIn,
    tokensOut,
    latencyMs,
  })

  return { data, model: GEMINI_MODEL, tokensIn, tokensOut, latencyMs }
}

export interface GeminiFileInput {
  /** MIME type of the file, e.g. 'application/pdf' or 'image/png'. */
  mimeType: string
  /** Base64-encoded file bytes. */
  dataBase64: string
}

export interface GeminiFileCallOptions {
  systemPrompt: string
  /** Text instruction sent alongside the file, e.g. 'Summarize this document.' */
  prompt: string
  file: GeminiFileInput
  userId: string
  /** What to store in ai_queries.query_text. Defaults to the prompt. */
  logLabel?: string
  promptVersion?: string
  maxTokens?: number
  /** Set false for prose output — default true for structured JSON. */
  jsonMode?: boolean
}

/**
 * Multimodal Gemini call: sends a file (PDF, image) plus a text prompt and
 * returns the same shape as callGemini. Used for document/certification
 * summarization where the source is a binary file rather than plain text.
 */
export async function callGeminiWithFile<T = unknown>(
  options: GeminiFileCallOptions
): Promise<GeminiCallResult<T>> {
  const {
    systemPrompt,
    prompt,
    file,
    userId,
    logLabel,
    promptVersion,
    maxTokens,
    jsonMode = true,
  } = options

  if (isLocalAI()) {
    if (file.mimeType === 'application/pdf') {
      // Local models can't read PDFs natively — extract the text first, then
      // run a plain text call. Scanned/image-only PDFs yield no text and fail
      // here; callers' existing fallbacks handle that.
      const pdfText = await extractPdfText(file.dataBase64)
      if (!pdfText) {
        throw new Error('Local AI: could not extract text from PDF (scanned or image-only document?)')
      }
      return callLocalText<T>({
        systemPrompt,
        userMessage: `${prompt}\n\nDOCUMENT TEXT:\n${pdfText}`,
        userId,
        logLabel: logLabel ?? prompt,
        promptVersion,
        maxTokens,
        jsonMode,
      })
    }

    // Images: send OpenAI vision content — works when a vision-capable model
    // is loaded in LM Studio; otherwise the server's error propagates.
    const model = localChatModel()
    const start = Date.now()
    const result = await localChat({
      messages: [
        { role: 'system', content: jsonMode ? systemPrompt + JSON_MODE_SUFFIX : systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${file.mimeType};base64,${file.dataBase64}` } },
            { type: 'text', text: prompt },
          ],
        },
      ],
      maxTokens,
    })
    const latencyMs = Date.now() - start
    logAiQuery({
      userId,
      queryText: logLabel ?? prompt,
      responseText: result.text,
      model,
      promptVersion,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      latencyMs,
    })
    return {
      data: jsonMode ? parseMaybeJson<T>(result.text) : (result.text as unknown as T),
      model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      latencyMs,
    }
  }

  const client = getClient()
  const model = client.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: systemPrompt,
  })

  const start = Date.now()

  const response = await model.generateContent({
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: file.mimeType, data: file.dataBase64 } },
          { text: prompt },
        ],
      },
    ],
    generationConfig: {
      ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
      ...(maxTokens ? { maxOutputTokens: maxTokens } : {}),
    },
  })

  const latencyMs = Date.now() - start
  const tokensIn = response.response.usageMetadata?.promptTokenCount ?? 0
  const tokensOut = response.response.usageMetadata?.candidatesTokenCount ?? 0

  const rawText = response.response.text()
  const data = parseMaybeJson<T>(rawText)

  logAiQuery({
    userId,
    queryText: logLabel ?? prompt,
    responseText: rawText,
    model: GEMINI_MODEL,
    promptVersion,
    tokensIn,
    tokensOut,
    latencyMs,
  })

  return { data, model: GEMINI_MODEL, tokensIn, tokensOut, latencyMs }
}
