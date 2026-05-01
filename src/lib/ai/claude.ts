import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/admin'

export type AiTask = 'extract' | 'classify' | 'embed' | 'synthesize' | 'agent'

const MODEL_MAP: Record<AiTask, string> = {
  extract: 'claude-haiku-4-5-20251001',
  classify: 'claude-haiku-4-5-20251001',
  embed: 'claude-haiku-4-5-20251001',
  synthesize: 'claude-sonnet-4-6-20250514',
  agent: 'claude-sonnet-4-6-20250514',
}

let _client: Anthropic | null = null

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  }
  return _client
}

export interface ClaudeCallOptions {
  task: AiTask
  systemPrompt: string
  userMessage: string
  userId: string
  promptVersion?: string
  maxTokens?: number
}

export interface ClaudeCallResult<T = unknown> {
  data: T
  model: string
  tokensIn: number
  tokensOut: number
  latencyMs: number
}

export async function callClaude<T = unknown>(
  options: ClaudeCallOptions
): Promise<ClaudeCallResult<T>> {
  const {
    task,
    systemPrompt,
    userMessage,
    userId,
    promptVersion,
    maxTokens = 4096,
  } = options

  const model = MODEL_MAP[task]
  const client = getClient()
  const start = Date.now()

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  })

  const latencyMs = Date.now() - start
  const tokensIn = response.usage.input_tokens
  const tokensOut = response.usage.output_tokens

  const textBlock = response.content.find((b) => b.type === 'text')
  const rawText = textBlock && 'text' in textBlock ? textBlock.text : ''

  let data: T
  try {
    data = JSON.parse(rawText) as T
  } catch {
    data = rawText as unknown as T
  }

  // Log to ai_queries — fire and forget
  const supabase = createAdminClient()
  supabase
    .from('ai_queries')
    .insert({
      user_id: userId,
      query_text: userMessage.slice(0, 2000),
      response_text: rawText.slice(0, 10000),
      model_used: model,
      prompt_version: promptVersion ?? null,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      latency_ms: latencyMs,
    })
    .then(() => {})

  return { data, model, tokensIn, tokensOut, latencyMs }
}
