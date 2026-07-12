/**
 * Local AI provider — OpenAI-compatible client for LM Studio on the Mac Studio.
 *
 * Activated by AI_PROVIDER=local (+ LOCAL_AI_BASE_URL). Plain fetch, no SDK —
 * runtime AI stays a single provider surface (§11): gemini.ts / embeddings.ts /
 * agent.ts branch here when local mode is on, and nothing else changes.
 */

export function isLocalAI(): boolean {
  return process.env.AI_PROVIDER === 'local'
}

/**
 * Embeddings can be staged separately from chat: EMBEDDINGS_PROVIDER overrides,
 * otherwise follows AI_PROVIDER. IMPORTANT: query embeddings must come from the
 * same model as the stored chunk embeddings — flipping this requires a full
 * re-embed of the chunks table, or retrieval silently degrades.
 */
export function isLocalEmbeddings(): boolean {
  return (process.env.EMBEDDINGS_PROVIDER ?? process.env.AI_PROVIDER) === 'local'
}

export function localBaseUrl(): string {
  const url = process.env.LOCAL_AI_BASE_URL
  if (!url) {
    throw new Error('AI_PROVIDER=local but LOCAL_AI_BASE_URL is not set (e.g. http://100.86.79.4:1234/v1)')
  }
  return url.replace(/\/$/, '')
}

export function localChatModel(): string {
  return process.env.LOCAL_AI_MODEL ?? 'qwen/qwen3-30b-a3b-2507'
}

export function localEmbeddingModel(): string {
  return process.env.LOCAL_EMBEDDING_MODEL ?? 'text-embedding-qwen3-embedding-0.6b'
}

// ---------------------------------------------------------------------------
// <think> handling — Qwen thinking variants emit <think>…</think> before the
// answer. Strip it from complete responses and filter it out of streams.
// ---------------------------------------------------------------------------

export function stripThink(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^\s*<think>[\s\S]*$/g, '').trim()
}

/**
 * Stateful stream filter: pass deltas through, suppressing everything between
 * <think> and </think> even when tags split across chunks. Call flush() at the
 * end to release any held-back tail.
 */
export function createThinkFilter() {
  let pending = ''
  let inThink = false

  const OPEN = '<think>'
  const CLOSE = '</think>'

  function drain(final: boolean): string {
    let out = ''
    for (;;) {
      if (inThink) {
        const idx = pending.indexOf(CLOSE)
        if (idx === -1) {
          // keep only enough tail to match a split closing tag
          pending = final ? '' : pending.slice(-CLOSE.length)
          return out
        }
        pending = pending.slice(idx + CLOSE.length)
        inThink = false
      } else {
        const idx = pending.indexOf(OPEN)
        if (idx === -1) {
          // hold back a partial-tag-sized tail unless flushing
          const safe = final ? pending.length : Math.max(0, pending.length - OPEN.length)
          out += pending.slice(0, safe)
          pending = pending.slice(safe)
          return out
        }
        out += pending.slice(0, idx)
        pending = pending.slice(idx + OPEN.length)
        inThink = true
      }
    }
  }

  return {
    push(delta: string): string {
      pending += delta
      return drain(false)
    },
    flush(): string {
      return drain(true)
    },
  }
}

// ---------------------------------------------------------------------------
// Chat completions
// ---------------------------------------------------------------------------

export interface LocalChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | Array<{ type: string; [key: string]: unknown }>
  tool_calls?: LocalToolCall[]
  tool_call_id?: string
}

export interface LocalToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface LocalChatResult {
  text: string
  toolCalls: LocalToolCall[]
  tokensIn: number
  tokensOut: number
}

interface LocalChatOptions {
  messages: LocalChatMessage[]
  model?: string
  /**
   * IGNORED in local mode (Richard's call 2026-07-11): the local model is
   * free, so generation is unbudgeted — no max_tokens is sent and Qwen runs
   * until it finishes (small budgets got fully eaten by reasoning tokens and
   * returned empty text). Kept in the signature so callers can share one
   * shape with the Gemini path, where maxTokens still applies.
   */
  maxTokens?: number
  /** OpenAI-format tool declarations. */
  tools?: Array<{ type: 'function'; function: { name: string; description: string; parameters: unknown } }>
  /** Fired with each answer-text delta (think blocks already filtered out). */
  onTextDelta?: (delta: string) => void
}

/**
 * Non-streaming chat completion. Returns think-stripped text.
 */
export async function localChat(options: LocalChatOptions): Promise<LocalChatResult> {
  const res = await fetch(`${localBaseUrl()}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: options.model ?? localChatModel(),
      messages: options.messages,
      ...(options.tools?.length ? { tools: options.tools } : {}),
      stream: false,
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Local AI error ${res.status}: ${errText.slice(0, 500)}`)
  }

  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string | null; tool_calls?: LocalToolCall[] } }>
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }

  const message = data.choices?.[0]?.message
  return {
    text: stripThink(message?.content ?? ''),
    toolCalls: message?.tool_calls ?? [],
    tokensIn: data.usage?.prompt_tokens ?? 0,
    tokensOut: data.usage?.completion_tokens ?? 0,
  }
}

/**
 * Streaming chat completion with tool-call accumulation. Text deltas are
 * think-filtered before reaching onTextDelta and the returned text.
 */
export async function localChatStream(options: LocalChatOptions): Promise<LocalChatResult> {
  const res = await fetch(`${localBaseUrl()}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: options.model ?? localChatModel(),
      messages: options.messages,
      ...(options.tools?.length ? { tools: options.tools } : {}),
      stream: true,
      stream_options: { include_usage: true },
    }),
  })

  if (!res.ok || !res.body) {
    const errText = await res.text()
    throw new Error(`Local AI error ${res.status}: ${errText.slice(0, 500)}`)
  }

  const filter = createThinkFilter()
  let text = ''
  let tokensIn = 0
  let tokensOut = 0
  // tool-call fragments accumulate by index across deltas
  const toolAccum = new Map<number, { id: string; name: string; args: string }>()

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const handleLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return
    const payload = trimmed.slice(5).trim()
    if (!payload || payload === '[DONE]') return

    let parsed: {
      choices?: Array<{
        delta?: {
          content?: string | null
          tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>
        }
      }>
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    try {
      parsed = JSON.parse(payload)
    } catch {
      return
    }

    if (parsed.usage) {
      tokensIn = parsed.usage.prompt_tokens ?? tokensIn
      tokensOut = parsed.usage.completion_tokens ?? tokensOut
    }

    const delta = parsed.choices?.[0]?.delta
    if (!delta) return

    if (delta.content) {
      const visible = filter.push(delta.content)
      if (visible) {
        text += visible
        options.onTextDelta?.(visible)
      }
    }

    for (const tc of delta.tool_calls ?? []) {
      const entry = toolAccum.get(tc.index) ?? { id: '', name: '', args: '' }
      if (tc.id) entry.id = tc.id
      if (tc.function?.name) entry.name += tc.function.name
      if (tc.function?.arguments) entry.args += tc.function.arguments
      toolAccum.set(tc.index, entry)
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buffer.indexOf('\n')) !== -1) {
      handleLine(buffer.slice(0, nl))
      buffer = buffer.slice(nl + 1)
    }
  }
  if (buffer) handleLine(buffer)

  const tail = filter.flush()
  if (tail) {
    text += tail
    options.onTextDelta?.(tail)
  }

  const toolCalls: LocalToolCall[] = [...toolAccum.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([i, t]) => ({
      id: t.id || `call_${i}`,
      type: 'function' as const,
      function: { name: t.name, arguments: t.args || '{}' },
    }))
    .filter((t) => t.function.name)

  return { text, toolCalls, tokensIn, tokensOut }
}

// ---------------------------------------------------------------------------
// Embeddings — truncate + renormalize to 768 dims (MRL) so the pgvector
// schema stays unchanged. Qwen3-Embedding outputs 1024 by default.
// ---------------------------------------------------------------------------

export async function localEmbedding(text: string): Promise<number[]> {
  const res = await fetch(`${localBaseUrl()}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: localEmbeddingModel(), input: text }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Local embedding error ${res.status}: ${errText.slice(0, 500)}`)
  }

  const data = await res.json() as { data?: Array<{ embedding: number[] }> }
  const values = data.data?.[0]?.embedding
  if (!values?.length) throw new Error('Local embedding returned no vector')
  if (values.length < 768) {
    throw new Error(`Local embedding model returns ${values.length} dims — need >= 768 (schema is vector(768))`)
  }
  if (values.length === 768) return values

  const truncated = values.slice(0, 768)
  const norm = Math.sqrt(truncated.reduce((sum, v) => sum + v * v, 0)) || 1
  return truncated.map((v) => v / norm)
}

// ---------------------------------------------------------------------------
// PDF text extraction — local replacement for Gemini's native PDF reading.
// ---------------------------------------------------------------------------

/** Cap document text fed into the local model (~60k tokens of a 256k window). */
export const LOCAL_PDF_TEXT_MAX_CHARS = 240_000

export async function extractPdfText(dataBase64: string): Promise<string | null> {
  try {
    const { extractText, getDocumentProxy } = await import('unpdf')
    const bytes = Uint8Array.from(Buffer.from(dataBase64, 'base64'))
    const pdf = await getDocumentProxy(bytes)
    const { text } = await extractText(pdf, { mergePages: true })
    const cleaned = (text ?? '').trim()
    return cleaned.length >= 40 ? cleaned.slice(0, LOCAL_PDF_TEXT_MAX_CHARS) : null
  } catch (err) {
    console.error('[local-ai] PDF text extraction failed:', err)
    return null
  }
}
