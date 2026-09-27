/**
 * Construction Executive Agent — Gemini-backed agentic loop.
 *
 * Uses gemini-2.5-pro for the main reasoning and gemini-2.5-flash for tool preprocessing.
 */

import { GoogleGenerativeAI, type Content, type Part, type FunctionDeclaration } from '@google/generative-ai'
import { createAdminClient } from '@/lib/supabase/admin'
import { AGENT_SYSTEM_PROMPT, projectContextPreamble } from './prompts/agent'
import { agentTools, executeToolCall } from './agent-tools'
import { getCompanyContext } from './company-context'
import { isLocalAI, localChatModel, localChatStream, type LocalChatMessage } from './local'

const AGENT_MODEL = 'gemini-2.5-pro'

// ---------------------------------------------------------------------------
// Turn budget.
//
// The loop used to run `round < 5` and then simply fall out of the bottom. When
// the model was still calling tools on round five — which combing a project's
// documents reliably is — the turn ended with no answer at all, and what got
// stored was the narration from the earlier rounds: "Let me pull the claim list
// and lease document." Three consecutive turns of a real Alaska conversation
// (2026-09-27) ended exactly that way, burning 6, 6 and 9 tool calls and
// answering nothing. Nothing told the model it was out of rounds and nothing
// told the reader either, so a budget cliff was indistinguishable from the
// assistant giving up mid-sentence.
//
// Two things fix that, and the round count is the lesser of them: the LAST
// round always runs with the tools removed (see `closing` below), so the model
// cannot ask for more evidence and the only thing it can produce is the answer.
// A turn therefore always ends on an answer — complete, or partial with its
// gaps named.
//
// Generation is free on this box (§2), so the round count is a runaway guard
// rather than a cost control. The real constraint is wall clock: each round is
// roughly 10-30s against the local model, so the time budget below is what
// normally brings a long investigation in to land, by promoting the next round
// to the closing one.
// ---------------------------------------------------------------------------

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw > 0 ? raw : fallback
}

// Raised 2026-09-26 on Richard's instruction — "I don't care how long it takes,
// I just want the most accurate answers as possible." 30 rounds and 30 minutes
// are a runaway guard, not a budget: a turn that genuinely needs 25 rounds of
// evidence now gets them, and the closing round still guarantees an answer at
// the end of whichever limit is reached first.
const maxToolRounds = () => envInt('AGENT_MAX_TOOL_ROUNDS', 30)
const timeBudgetMs = () => envInt('AGENT_TIME_BUDGET_MS', 1_800_000)

/**
 * Appended as a user turn for the closing round. It has to do two jobs: forbid
 * further tool requests (the tools are already gone, but saying so stops the
 * model narrating a call it cannot make), and make a PARTIAL answer the
 * required output. Naming the gap — which document holds it, which system it
 * sits in — is the answer when the evidence is incomplete; silence is not.
 */
const CLOSING_INSTRUCTION = `[SYSTEM] You have used the full tool budget for this turn. No further tools are available — answer NOW from the evidence already gathered above.

Do not say you are about to look something up, and do not promise follow-up work: this is your last output for this turn. Give the answer you can support, cite the document or email it came from, and then state plainly what you could NOT determine and which specific file or system would hold it. A partial answer with its gaps named is the required result. Producing no answer is not an option.`

/**
 * Said only when even an un-tooled retry produced nothing. It is deliberately
 * an admission rather than an error: the reader needs to know the search
 * happened and came back empty-handed, which is actionable, instead of watching
 * the assistant trail off, which is not.
 */
const NO_ANSWER_FALLBACK =
  'I gathered evidence for this but could not produce a written answer before the turn ended. ' +
  'Ask again — and if it happens twice, narrow the question to one document or one record so the search has less ground to cover.'

let _client: GoogleGenerativeAI | null = null

function getClient(): GoogleGenerativeAI {
  if (!_client) {
    _client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  }
  return _client
}

export interface AgentContext {
  userId: string
  projectId?: string
  /** Scope the conversation to a single reference document (digest / Q&A). */
  documentId?: string
  conversationId: string
}

export interface AgentResponse {
  content: string
  toolCalls?: Array<{ name: string; args: Record<string, unknown>; result: unknown }>
  model: string
  tokensIn: number
  tokensOut: number
  latencyMs: number
}

/** Optional live-progress hooks — used by the streaming API route. */
export interface AgentStreamCallbacks {
  /** Fired when the agent starts executing a tool call. */
  onToolCall?: (name: string, args: Record<string, unknown>) => void
  /** Fired for each chunk of generated answer text, in order. */
  onTextDelta?: (delta: string) => void
  /**
   * Fired when the text streamed so far turned out to be narration before more
   * tool work ("Let me pull the lease document...") rather than the answer.
   *
   * The reader should see that narration — it is the only evidence the agent is
   * still working — but it must not survive into the finished message, or the
   * stored answer and the live view disagree the moment the page reloads. The
   * route forwards this as a `reset` event and the client clears what it has
   * rendered for this turn.
   */
  onTextReset?: () => void
}

/**
 * Run the agent loop: send user message, execute any tool calls, return final response.
 * Pass `callbacks` to receive tool-call and text-delta events as they happen.
 */
/**
 * Run a tool and turn any throw into a normal error result.
 *
 * Tool implementations are expected to RETURN `{ error }` rather than throw,
 * but there are 40+ of them and the model supplies their arguments — so a
 * missing or null-valued param is a routine event, not an exceptional one.
 * Without this, one such tool takes the whole turn down and the user sees the
 * assistant fail rather than the tool fail, which is both worse and much
 * harder to diagnose. The model can recover from an error result; it cannot
 * recover from a dead turn.
 */
async function runTool(
  name: string,
  args: Record<string, unknown>,
  context: AgentContext
): Promise<unknown> {
  try {
    return await executeToolCall(name, args, context)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[agent] tool ${name} threw:`, message)
    return { error: `Tool ${name} failed: ${message}` }
  }
}

export async function runAgent(
  userMessage: string,
  context: AgentContext,
  history: Content[] = [],
  callbacks?: AgentStreamCallbacks
): Promise<AgentResponse> {
  const supabase = createAdminClient()

  // Build system prompt: start with base, append company qualifications, then optional project context
  let systemPrompt = AGENT_SYSTEM_PROMPT

  // Always inject the company profile + pursuit criteria so the agent knows
  // Ber Wilson's qualifications and appetite without needing a tool call.
  const company = await getCompanyContext()
  if (company) {
    systemPrompt += `\n\n${company.text}\n\nUse get_company_qualifications for the full detail including expiry dates and cert numbers.`
  }

  if (context.projectId) {
    const { data: project } = await supabase
      .from('projects')
      .select('name, sector, status, stage, location, client_entity, estimated_value, parent_project_id')
      .eq('id', context.projectId)
      .single()

    if (project) {
      // Resolve parent name and child count for hierarchy context
      let parentName: string | null = null
      let childCount = 0

      const [parentResult, childCountResult] = await Promise.all([
        project.parent_project_id
          ? supabase.from('projects').select('name').eq('id', project.parent_project_id).single()
          : Promise.resolve({ data: null }),
        supabase.from('projects').select('id', { count: 'exact', head: true }).eq('parent_project_id', context.projectId!),
      ])

      if (parentResult.data) parentName = (parentResult.data as { name: string }).name
      childCount = childCountResult.count ?? 0

      systemPrompt += projectContextPreamble({
        ...project,
        parent_name: parentName,
        child_count: childCount,
      })
    }
  }

  // Document-scoped chat: inject the document so the agent answers from it.
  if (context.documentId) {
    const { data: doc } = await supabase
      .from('documents')
      .select('file_name, ai_summary, extracted_text')
      .eq('id', context.documentId)
      .single()

    if (doc) {
      // Cap the injected text so a huge document can't blow the context window;
      // the agent can still pull more via get_document_content / search_knowledge_base.
      const MAX_DOC_CHARS = 120_000
      const fullText = doc.extracted_text ?? ''
      const truncated = fullText.length > MAX_DOC_CHARS
      const body = truncated ? fullText.slice(0, MAX_DOC_CHARS) : fullText

      systemPrompt += `\n\n## DOCUMENT UNDER REVIEW: "${doc.file_name}"
You are helping the user read and understand this specific document. Answer questions primarily from its contents below. Quote and cite specific passages, clauses, dates, and dollar figures. If the answer isn't in the document, say so plainly rather than guessing. When asked, produce clear outlines and plain-language explanations of dense sections.${
        doc.ai_summary ? `\n\nSummary: ${doc.ai_summary}` : ''
      }\n\n--- DOCUMENT TEXT${truncated ? ' (truncated — use get_document_content or search_knowledge_base for the rest)' : ''} ---\n${
        body || '(No extractable text was stored for this document. Use get_document_content or search_knowledge_base to retrieve what is indexed.)'
      }\n--- END DOCUMENT TEXT ---`
    }
  }

  if (isLocalAI()) {
    return runAgentLocal(userMessage, systemPrompt, context, history, callbacks)
  }

  const client = getClient()
  const withTools = client.getGenerativeModel({
    model: AGENT_MODEL,
    systemInstruction: systemPrompt,
    tools: [{ functionDeclarations: agentTools as unknown as FunctionDeclaration[] }],
  })
  // The closing round binds NO tools, so a function call is not a reply the
  // model can give — the answer is the only thing left to produce.
  const withoutTools = client.getGenerativeModel({
    model: AGENT_MODEL,
    systemInstruction: systemPrompt,
  })

  const contents: Content[] = [
    ...history,
    { role: 'user', parts: [{ text: userMessage }] },
  ]

  const start = Date.now()
  const toolCallLog: AgentResponse['toolCalls'] = []

  let finalText = ''
  let totalTokensIn = 0
  let totalTokensOut = 0
  const maxRounds = maxToolRounds()
  const budgetMs = timeBudgetMs()

  for (let round = 0; round < maxRounds; round++) {
    // Last allowed round, or the wall clock is spent: close the turn out.
    const closing = round === maxRounds - 1 || Date.now() - start > budgetMs
    if (closing) {
      contents.push({ role: 'user', parts: [{ text: CLOSING_INSTRUCTION }] })
    }

    // Stream each round so answer tokens reach the client as they're generated.
    let roundText = ''
    const result = await (closing ? withoutTools : withTools).generateContentStream({ contents })

    for await (const chunk of result.stream) {
      let delta = ''
      try { delta = chunk.text() } catch { /* chunk holds a functionCall, not text */ }
      if (delta) {
        roundText += delta
        callbacks?.onTextDelta?.(delta)
      }
    }

    const response = await result.response

    totalTokensIn += response.usageMetadata?.promptTokenCount ?? 0
    totalTokensOut += response.usageMetadata?.candidatesTokenCount ?? 0

    const candidate = response.candidates?.[0]
    if (!candidate) {
      finalText = roundText || finalText
      break
    }

    const parts = candidate.content.parts
    const functionCalls = closing ? [] : parts.filter((p: Part) => 'functionCall' in p)

    if (functionCalls.length === 0) {
      // No tool calls — this round's text IS the answer.
      finalText = roundText
      break
    }

    // This round's text was narration before more work. Drop it from the live
    // view so it cannot end up prefixed to the answer.
    if (roundText.trim()) callbacks?.onTextReset?.()

    // Execute tool calls
    const toolResponseParts: Part[] = []

    for (const fc of functionCalls) {
      const call = (fc as { functionCall: { name: string; args: Record<string, unknown> } }).functionCall
      callbacks?.onToolCall?.(call.name, call.args)
      const result = await runTool(call.name, call.args, context)
      toolCallLog.push({ name: call.name, args: call.args, result })

      toolResponseParts.push({
        functionResponse: {
          name: call.name,
          response: { result },
        },
      } as unknown as Part)
    }

    // Add assistant response + tool results to conversation
    contents.push({ role: 'model', parts })
    contents.push({ role: 'user', parts: toolResponseParts })
  }

  // Last-resort guard: a turn must never come back empty. Reaching here with no
  // text means the closing round produced none — a candidate with no parts, or
  // a generation spent entirely on reasoning — so ask once more, plainly.
  if (!finalText.trim()) {
    finalText = await forceCloseGemini(withoutTools, contents, callbacks)
  }

  const latencyMs = Date.now() - start

  return {
    content: finalText,
    toolCalls: toolCallLog.length > 0 ? toolCallLog : undefined,
    model: AGENT_MODEL,
    tokensIn: totalTokensIn,
    tokensOut: totalTokensOut,
    latencyMs,
  }
}

/** One un-tooled retry when a turn would otherwise return nothing. */
async function forceCloseGemini(
  model: ReturnType<GoogleGenerativeAI['getGenerativeModel']>,
  contents: Content[],
  callbacks?: AgentStreamCallbacks
): Promise<string> {
  callbacks?.onTextReset?.()
  try {
    const result = await model.generateContentStream({
      contents: [...contents, { role: 'user', parts: [{ text: CLOSING_INSTRUCTION }] }],
    })
    let text = ''
    for await (const chunk of result.stream) {
      let delta = ''
      try { delta = chunk.text() } catch { /* not text */ }
      if (delta) {
        text += delta
        callbacks?.onTextDelta?.(delta)
      }
    }
    if (text.trim()) return text
  } catch (err) {
    console.error('[agent] forced close failed:', err)
  }
  callbacks?.onTextDelta?.(NO_ANSWER_FALLBACK)
  return NO_ANSWER_FALLBACK
}

// ---------------------------------------------------------------------------
// Local provider (AI_PROVIDER=local) — same loop against the LM Studio
// OpenAI-compatible endpoint. agentTools declarations are plain JSON Schema,
// so they map straight into OpenAI tool format.
// ---------------------------------------------------------------------------

const localToolDeclarations = agentTools.map((t) => ({
  type: 'function' as const,
  function: {
    name: t.name,
    description: t.description,
    parameters: t.parameters as unknown,
  },
}))

/** Convert stored Gemini-format history into OpenAI-format messages. */
function historyToLocalMessages(history: Content[]): LocalChatMessage[] {
  return history
    .map((c): LocalChatMessage | null => {
      const text = (c.parts ?? [])
        .map((p) => ('text' in p && typeof p.text === 'string' ? p.text : ''))
        .join('')
      if (!text) return null
      return { role: c.role === 'model' ? 'assistant' : 'user', content: text }
    })
    .filter((m): m is LocalChatMessage => m !== null)
}

// ---------------------------------------------------------------------------
// Context guard for the local path.
//
// Raising the round budget without this would trade one silent failure for a
// worse one. Measured on this box: the system prompt is ~17.5k characters, the
// company context ~4.9k and the 42 tool declarations ~30.2k — about 13k tokens
// of fixed overhead on every request, against the model's context window (read
// it off `lms ps` — 131,072 as configured on 2026-09-26, and it was 65,536 when
// these figures were first measured).
// A single get_document_content window is 20k characters (~5k tokens), so ten
// document reads fill the rest, and a thorough investigation now makes more
// calls than that by design.
//
// So the oldest tool RESULTS are shrunk to a stub as the conversation grows.
// Results are dropped rather than the question or the recent evidence because
// the model has already read the old ones and reasoned from them, and the answer
// is written from what it looked at last. Messages are never removed — only
// their content replaced: an OpenAI-format `tool` message must keep following
// the `assistant` message whose tool_calls it answers, and deleting one breaks
// that pairing.
//
// The Gemini path needs none of this: a 1M-token window swallows the whole
// investigation.
// ---------------------------------------------------------------------------

/**
 * Chars of conversation (excluding the system prompt) to keep in play.
 *
 * This one CANNOT be raised by fiat — it is set by the model's context window,
 * which is LM Studio's setting, not ours. At the 65,536-token window the Studio
 * shipped with, this 120,000-character default plus ~13k tokens of fixed overhead
 * was already most of the window. **The window is 131,072 as of 2026-09-26** —
 * `--ctx-size 131072` with a q8_0 K/V cache, which cost +2.12 GiB rather than the
 * +5 hand arithmetic predicted (`lms load --estimate-only`) — and `.env.local`
 * therefore sets this to 300,000. The default here stays at the conservative
 * figure so a machine without that configuration cannot overflow; §7 documents
 * the pair. Raise it WITH the LM Studio context, never ahead of it.
 */
const contextBudgetChars = () => envInt('AGENT_CONTEXT_BUDGET_CHARS', 120_000)

/** Most recent tool results always kept in full — the evidence being reasoned from. */
const KEEP_RECENT_TOOL_RESULTS = 6

function messageChars(m: LocalChatMessage): number {
  const body = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
  return body.length + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0)
}

/**
 * Shrink the oldest tool results until the conversation fits the budget.
 * Mutates in place and returns how many were shrunk, for the log.
 */
function trimToolHistory(messages: LocalChatMessage[], budget: number): number {
  // Index 0 is the system prompt; it is fixed cost, not conversation.
  let total = messages.reduce((n, m, i) => n + (i === 0 ? 0 : messageChars(m)), 0)
  if (total <= budget) return 0

  const toolIdx = messages
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m.role === 'tool' && typeof m.content === 'string' && !m.content.startsWith('[dropped'))
    .map(({ i }) => i)

  let shrunk = 0
  // Oldest first, stopping before the results the answer will be written from.
  for (const i of toolIdx.slice(0, Math.max(0, toolIdx.length - KEEP_RECENT_TOOL_RESULTS))) {
    if (total <= budget) break
    const before = messageChars(messages[i])
    if (before < 400) continue // already small — dropping it buys nothing
    messages[i] = {
      ...messages[i],
      content: `[dropped from context to stay within the model's window — this result was already read. Re-request it if you need it again.]`,
    }
    total -= before - messageChars(messages[i])
    shrunk++
  }
  return shrunk
}

async function runAgentLocal(
  userMessage: string,
  systemPrompt: string,
  context: AgentContext,
  history: Content[],
  callbacks?: AgentStreamCallbacks
): Promise<AgentResponse> {
  const model = localChatModel()

  const messages: LocalChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...historyToLocalMessages(history),
    { role: 'user', content: userMessage },
  ]

  const start = Date.now()
  const toolCallLog: NonNullable<AgentResponse['toolCalls']> = []

  let finalText = ''
  let totalTokensIn = 0
  let totalTokensOut = 0
  const maxRounds = maxToolRounds()
  const budgetMs = timeBudgetMs()

  // Agentic loop, matching the Gemini path: tool rounds until the model stops
  // asking for tools, then a closing round that has none to ask for.
  for (let round = 0; round < maxRounds; round++) {
    const closing = round === maxRounds - 1 || Date.now() - start > budgetMs
    if (closing) {
      messages.push({ role: 'user', content: CLOSING_INSTRUCTION })
    }

    const shrunk = trimToolHistory(messages, contextBudgetChars())
    if (shrunk > 0) {
      console.log(`[agent] round ${round}: shrank ${shrunk} old tool result(s) to stay inside the context window`)
    }

    let roundText = ''
    const result = await localChatStream({
      model,
      messages,
      // No tools on the closing round: the model cannot ask for more evidence,
      // so the only thing it can emit is the answer.
      ...(closing ? {} : { tools: localToolDeclarations }),
      onTextDelta: (delta) => {
        roundText += delta
        callbacks?.onTextDelta?.(delta)
      },
    })

    totalTokensIn += result.tokensIn
    totalTokensOut += result.tokensOut

    if (closing || result.toolCalls.length === 0) {
      finalText = roundText
      break
    }

    // Narration before more work — never part of the answer.
    if (roundText.trim()) callbacks?.onTextReset?.()

    messages.push({
      role: 'assistant',
      content: result.text,
      tool_calls: result.toolCalls,
    })

    for (const tc of result.toolCalls) {
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(tc.function.arguments) as Record<string, unknown>
      } catch {
        // malformed args from the model — run the tool with none
      }
      callbacks?.onToolCall?.(tc.function.name, args)
      const toolResult = await runTool(tc.function.name, args, context)
      toolCallLog.push({ name: tc.function.name, args, result: toolResult })

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(toolResult),
      })
    }
  }

  // A turn must never come back empty. Qwen's thinking variants can spend a
  // whole generation inside <think> and emit no visible token, which the filter
  // in local.ts correctly suppresses — leaving nothing to store.
  if (!finalText.trim()) {
    callbacks?.onTextReset?.()
    try {
      const retry = await localChatStream({
        model,
        messages: [...messages, { role: 'user', content: CLOSING_INSTRUCTION }],
        onTextDelta: (delta) => callbacks?.onTextDelta?.(delta),
      })
      totalTokensIn += retry.tokensIn
      totalTokensOut += retry.tokensOut
      finalText = retry.text
    } catch (err) {
      console.error('[agent] forced close failed:', err)
    }
    if (!finalText.trim()) {
      // Emit it rather than only returning it: the client treats a turn that
      // streamed nothing as a failed request, so a fallback that is stored but
      // never sent shows up as an error instead of as the admission it is.
      finalText = NO_ANSWER_FALLBACK
      callbacks?.onTextDelta?.(finalText)
    }
  }

  return {
    content: finalText,
    toolCalls: toolCallLog.length > 0 ? toolCallLog : undefined,
    model,
    tokensIn: totalTokensIn,
    tokensOut: totalTokensOut,
    latencyMs: Date.now() - start,
  }
}
