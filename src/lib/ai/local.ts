/**
 * Local AI provider — OpenAI-compatible client for LM Studio on the Mac Studio.
 *
 * Activated by AI_PROVIDER=local (+ LOCAL_AI_BASE_URL). No SDK — runtime AI
 * stays a single provider surface (§11): gemini.ts / embeddings.ts / agent.ts
 * branch here when local mode is on, and nothing else changes. Embeddings go
 * over plain fetch; the chat stream does not, for the reason set out above
 * `postJsonStream`.
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
// Hang guards.
//
// Generation is deliberately UNBUDGETED (no max_tokens — see LocalChatOptions):
// the model is free, so it may think as long as it likes. But "no token budget"
// is not "wait forever". With no timeout at all, a wedged LM Studio — or a
// socket left stalled across one of the Studio's maintenance-sleep windows —
// hangs the caller indefinitely. That is what killed the daily brief on
// 2026-08-27 and 08-28: the cron sat for 16.5 minutes and no brief was written
// on either day, with nothing in any log naming a cause.
//
// These caps sit far above any real call (the slowest observed is a ~95s
// portfolio brief), so they only ever fire on a genuine stall.
// ---------------------------------------------------------------------------

function envMs(name: string, fallback: number): number {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw > 0 ? raw : fallback
}

/**
 * Gap cap BETWEEN stream chunks. Deliberately not a whole-call cap: a long
 * answer is legitimate, a silent socket is not, and only the gap tells them
 * apart.
 */
const streamIdleTimeoutMs = () => envMs('LOCAL_AI_STREAM_IDLE_TIMEOUT_MS', 180_000)

/**
 * Cap on the wait for the FIRST chunk, which is a different wait entirely.
 *
 * Nothing is streamed while the server ingests the prompt, and prompt
 * processing scales with the prompt — so the silence before the first token
 * grows with the conversation, while the silence between tokens does not
 * (generation holds ~75 tok/s whatever the context). One number for both meant
 * the gap cap had to be set by the worst case of the first wait, and it was
 * still too small: a real Ber AI turn — 19 tool calls, several 40,000-character
 * document windows against the 131,072-token window — died on
 * "Local AI stream stalled — no data for 180s" after six minutes of work, with
 * the model still reading. The same error is in the production log twice.
 *
 * So the first wait is generous and the gap stays tight, which is what actually
 * distinguishes a loaded model from a dead socket.
 *
 * SIZED FROM MEASUREMENTS, 2026-09-29. Three of them, because the first was
 * misleading and the third is the one that explains the bug:
 *
 *   prefill, uncontended  — 21,025 prompt tokens → first token at 68.3s
 *                           (~308 tok/s). A FULL 131,072-token window is
 *                           therefore ~425s of silence before the first token.
 *   prefill, queued       — the same test behind an in-flight request measured
 *                           29,121 tokens at 135.5s (~215 tok/s). LM Studio
 *                           serves ONE request at a time, so a cron holding the
 *                           model is added to the caller's own wait.
 *   prefix cache          — the SAME prefix re-sent came back in 3.2s against
 *                           68.3s cold. Reuse works, and is worth 21x.
 *
 * That cache is why a round is normally fast and why the ceiling below still
 * bit: an agent turn only re-pays full prefill when the prefix CHANGES, which
 * is exactly what shrinking the oldest tool results to stubs does
 * (AGENT_CONTEXT_BUDGET_CHARS). Rewriting the middle of the conversation
 * invalidates the cache from that point, so the next round re-prefills ~88k
 * tokens — ~285s uncontended, and over 300s the moment anything else is using
 * the model. Which is to say the failure landed precisely on the longest,
 * best-evidenced turns, and was worse whenever a cron was running.
 *
 * 900s clears a full window with margin even under contention.
 */
const streamFirstChunkTimeoutMs = () =>
  envMs('LOCAL_AI_STREAM_FIRST_CHUNK_TIMEOUT_MS', 900_000)

/** Embeddings are small and fast; a slow one means something is wrong. */
const embeddingTimeoutMs = () => envMs('LOCAL_AI_EMBEDDING_TIMEOUT_MS', 120_000)

/**
 * Cap on the wait for response HEADERS, which with stream:true arrive at once
 * (measured: 0.1s). A wait here means LM Studio is not answering at all, which
 * is a different thing from a model that is thinking — so this stays modest
 * while the body guards above stay generous.
 */
const headersTimeoutMs = () => envMs('LOCAL_AI_TIMEOUT_MS', 900_000)

// ---------------------------------------------------------------------------
// Why this is `node:http` and not `fetch`.
//
// undici — the HTTP client behind Node's global fetch — enforces TWO timeouts
// of its OWN, both defaulting to 300s and NEITHER of them reachable from the
// AbortSignal or from any option this code can pass:
//
//   headersTimeout — dodged already, by asking for stream:true so the headers
//                    come back immediately instead of after generation.
//   bodyTimeout    — the gap between BODY chunks, and the trap that replaced
//                    it. With stream:true the headers arrive in 0.1s and the
//                    socket then goes deliberately silent while the server
//                    ingests the prompt. undici reads that silence as a dead
//                    body and destroys the socket at 300s, surfacing as a bare
//                    `TypeError: terminated` with cause UND_ERR_BODY_TIMEOUT.
//
// That is a hard five-minute ceiling on prompt processing, and prompt
// processing is exactly what scales with the conversation: a real Ber AI turn
// over a deal's full correspondence spends minutes in prefill before the first
// token. So the 600s first-chunk guard written on 2026-09-27 to allow for that
// was never once reachable — undici killed the socket at 300s first, the turn's
// tool work was discarded, and the reader saw the answer stop dead.
//
// `node:http` applies no such timeout, which makes the guards in this file the
// only limits — which is what they were written to be. Fixing it by raising an
// undici setting would have meant adding a dependency (§11) to configure a
// client we do not otherwise want.
// ---------------------------------------------------------------------------

/**
 * POST JSON and hand back the response stream, with a timeout on the HEADERS
 * only. The body is left entirely to the caller's own guards.
 */
async function postJsonStream(
  url: string,
  payload: unknown,
  ms: number,
): Promise<{ status: number; reader: ChunkReader }> {
  const { request: httpRequest } = await import('node:http')
  const { request: httpsRequest } = await import('node:https')
  const target = new URL(url)
  const send = target.protocol === 'https:' ? httpsRequest : httpRequest
  const data = Buffer.from(JSON.stringify(payload))

  return new Promise((resolve, reject) => {
    const req = send(
      target,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': data.byteLength },
      },
      (res) => {
        clearTimeout(timer)
        const iterator = res[Symbol.asyncIterator]()
        resolve({
          status: res.statusCode ?? 0,
          reader: {
            async read() {
              const next = await iterator.next()
              return next.done ? { done: true } : { done: false, value: next.value }
            },
            async cancel() {
              res.destroy()
            },
          },
        })
      },
    )

    // Explicitly disable the socket-level inactivity timeout: silence during
    // prompt processing is normal and must not close the connection.
    req.setTimeout(0)
    const timer = setTimeout(() => {
      req.destroy(new Error(`Local AI sent no response headers within ${Math.round(ms / 1000)}s`))
    }, ms)
    req.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    req.end(data)
  })
}

/** Drain a reader to a string — used only for error bodies. */
async function readAllText(reader: ChunkReader): Promise<string> {
  const decoder = new TextDecoder()
  let out = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) out += decoder.decode(value, { stream: true })
  }
  return out + decoder.decode()
}

/**
 * Turn an abort into something a log reader can act on. `AbortSignal.timeout`
 * surfaces as a bare "This operation was aborted", which in a cron log is
 * indistinguishable from a crash.
 */
function localStallError(err: unknown, ms: number, what: string): Error {
  const aborted = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
  if (!aborted) return err instanceof Error ? err : new Error(String(err))
  return new Error(
    `Local AI ${what} timed out after ${Math.round(ms / 1000)}s — no response from LM Studio at ` +
      `${localBaseUrl()}. Check that it is running and the model is loaded.`,
  )
}

/**
 * The minimal reader shape the stream loop needs. Deliberately not
 * `ReadableStreamDefaultReader`: the chat stream is read straight off a
 * `node:http` response (see `postJsonStream`), and this is the common surface.
 */
interface ChunkReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>
  cancel(): Promise<void>
}

/**
 * One `reader.read()`, bounded by an idle timeout. Rejects rather than hanging
 * when the stream goes quiet.
 */
async function readWithIdleTimeout(
  reader: ChunkReader,
  ms: number,
): Promise<{ done: boolean; value?: Uint8Array }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Local AI stream stalled — no data for ${Math.round(ms / 1000)}s`)),
          ms,
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
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
  /**
   * Sampling temperature. Unset uses the server's default, which LM Studio
   * ships at roughly 0.8 — fine for prose, wrong for judgement.
   *
   * Measured on the real lead backlog 2026-09-14: re-running the SAME fit
   * assessment over the SAME eight leads at the default temperature held only
   * three of eight verdicts, and one swung from pursue (75) to pass (35). A
   * triage that answers differently each time it is asked is not a triage. Any
   * call whose output is a classification, a score, or a structured extraction
   * should pin this low; drafting and briefs can leave it alone.
   */
  temperature?: number
  /** OpenAI-format tool declarations. */
  tools?: Array<{ type: 'function'; function: { name: string; description: string; parameters: unknown } }>
  /** Fired with each answer-text delta (think blocks already filtered out). */
  onTextDelta?: (delta: string) => void
}

/**
 * One chat completion, awaited whole.
 *
 * Delegates to the streaming path rather than asking for stream:false, and the
 * reason is a trap rather than a preference: a non-streamed request produces no
 * headers until the model has finished thinking and generating, so any call
 * slower than five minutes died with an opaque "fetch failed" on undici's
 * headersTimeout — regardless of LOCAL_AI_TIMEOUT_MS, which is 15 minutes and
 * was therefore never reachable. Measured here: a 104-item grouping call takes
 * ~4.6 minutes and failed intermittently on exactly this.
 *
 * With stream:true the headers arrive at once (0.1s), so the guards in this
 * file become the real limits — which is what they were written to be. That
 * only actually held once the transport stopped being fetch: see the comment
 * above `postJsonStream` for the second, longer-lived half of the same trap.
 * It also leaves one implementation of tool-call accumulation and
 * think-filtering instead of two.
 */
export async function localChat(options: LocalChatOptions): Promise<LocalChatResult> {
  return localChatStream(options)
}

/**
 * Streaming chat completion with tool-call accumulation. Text deltas are
 * think-filtered before reaching onTextDelta and the returned text.
 */
export async function localChatStream(options: LocalChatOptions): Promise<LocalChatResult> {
  const timeout = headersTimeoutMs()
  let status: number
  let reader: ChunkReader
  try {
    ;({ status, reader } = await postJsonStream(
      `${localBaseUrl()}/chat/completions`,
      {
        model: options.model ?? localChatModel(),
        messages: options.messages,
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(options.tools?.length ? { tools: options.tools } : {}),
        stream: true,
        stream_options: { include_usage: true },
      },
      timeout,
    ))
  } catch (err) {
    throw localStallError(err, timeout, 'chat completion')
  }

  if (status < 200 || status >= 300) {
    const errText = await readAllText(reader)
    throw new Error(`Local AI error ${status}: ${errText.slice(0, 500)}`)
  }

  const filter = createThinkFilter()
  let text = ''
  let tokensIn = 0
  let tokensOut = 0
  // tool-call fragments accumulate by index across deltas
  const toolAccum = new Map<number, { id: string; name: string; args: string }>()

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

  const idle = streamIdleTimeoutMs()
  const firstChunk = streamFirstChunkTimeoutMs()
  let started = false
  try {
    for (;;) {
      const { done, value } = await readWithIdleTimeout(reader, started ? idle : firstChunk)
      if (done) break
      started = true
      if (value) buffer += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n')) !== -1) {
        handleLine(buffer.slice(0, nl))
        buffer = buffer.slice(nl + 1)
      }
    }
  } catch (err) {
    // Release the socket — an abandoned reader keeps the connection open.
    await reader.cancel().catch(() => {})
    // Named apart so a log reader can tell "the model never started" (a prompt
    // too big, or a model still loading) from "it stopped mid-answer".
    //
    // The phase is prefixed onto EVERY failure here, not just the timeouts:
    // a socket that dies during prompt processing arrives as a bare
    // `terminated` or `ECONNRESET`, which is what the reader saw for this bug
    // — a one-word error where an explanation should be. Whatever went wrong,
    // the message should at least say which wait it went wrong in.
    const phase = started ? 'chat stream' : 'chat stream (no first token)'
    const named = localStallError(err, started ? idle : firstChunk, phase)
    throw /timed out after/.test(named.message)
      ? named
      : new Error(`Local AI ${phase} failed: ${named.message}`, { cause: err })
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
  const timeout = embeddingTimeoutMs()
  let res: Response
  try {
    res = await fetch(`${localBaseUrl()}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: localEmbeddingModel(), input: text }),
      signal: AbortSignal.timeout(timeout),
    })
  } catch (err) {
    throw localStallError(err, timeout, 'embedding')
  }

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

/**
 * Cap on STORED document text.
 *
 * Raised from 240,000 on 2026-09-26 (Richard: "I don't care how long it takes, I
 * just want the most accurate answers as possible"). The old figure was chosen
 * when the whole document was fed to the model in one go, so it doubled as a
 * context guard — and it silently truncated: `SOO lode report.pdf` was stored at
 * exactly 240,000 characters, meaning the tail was simply gone.
 *
 * It is no longer a context guard, because `get_document_content` now reads in
 * windows and the agent follows `next_offset`. So the only thing this bounds is
 * a Postgres text column and an embedding pass, both of which are cheap. A
 * document the platform holds should be held whole.
 */
export const LOCAL_PDF_TEXT_MAX_CHARS = Number(process.env.LOCAL_PDF_TEXT_MAX_CHARS) || 2_000_000

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
